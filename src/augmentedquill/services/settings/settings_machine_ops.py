# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the settings machine ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import asyncio
import time

import httpx

from augmentedquill.services.llm.llm_completion_ops import _validate_base_url
from augmentedquill.services.llm.llm_http_ops import logged_request


def auth_headers(api_key: str | None) -> dict[str, str]:
    """Helper for headers.."""
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def parse_connection_payload(payload: dict | None) -> tuple[str, str | None, int]:
    """Parse Connection Payload."""
    base_url = (payload or {}).get("base_url") or ""
    api_key = (payload or {}).get("api_key") or None
    timeout_s = (payload or {}).get("timeout_s")
    try:
        timeout_s = int(timeout_s) if timeout_s is not None else 10
    except Exception:
        timeout_s = 10
    return str(base_url), (str(api_key) if api_key else None), timeout_s


async def list_remote_models(
    *, base_url: str, api_key: str | None, timeout_s: int
) -> tuple[bool, list[str], str | None]:
    """List Remote Models."""
    url = str(base_url or "").strip().rstrip("/") + "/models"
    try:
        # user-specified base URLs may be arbitrary; skip strict validation
        _validate_base_url(base_url, skip_validation=True)
    except ValueError as e:
        return False, [], str(e)

    headers = auth_headers(api_key)

    try:
        timeout_obj = httpx.Timeout(float(timeout_s))
    except Exception:
        timeout_obj = httpx.Timeout(10.0)

    try:
        response = await logged_request(
            caller_id="settings_machine.list_remote_models",
            method="GET",
            url=url,
            headers=headers,
            timeout=timeout_obj,
            body=None,
            raise_for_status=False,
        )
        if not response.is_success:
            return False, [], f"HTTP {response.status_code}"
        data = response.json()
    except Exception as exc:
        return False, [], str(exc)

    models: list[str] = []
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        for item in data.get("data") or []:
            if isinstance(item, dict):
                model_id = item.get("id")
                if isinstance(model_id, str) and model_id.strip():
                    models.append(model_id.strip())
    elif isinstance(data, dict) and isinstance(data.get("models"), list):
        for item in data.get("models") or []:
            if isinstance(item, str) and item.strip():
                models.append(item.strip())
            elif isinstance(item, dict):
                model_id = item.get("id")
                if isinstance(model_id, str) and model_id.strip():
                    models.append(model_id.strip())

    seen: set[str] = set()
    deduped: list[str] = []
    for model in models:
        if model not in seen:
            seen.add(model)
            deduped.append(model)
    return True, deduped, None


_MODEL_EXISTS_CACHE_TTL_S = 60

# in‑memory caches keyed by (base_url, model_id, api_key_hash)
# - ``_model_exists_cache`` holds (expiry, exists) tuples
# - ``_model_exists_inflight`` tracks probes already underway, enabling
#    parallel callers to share one task
_model_exists_cache: dict[tuple[str, str, str], tuple[float, bool]] = {}
_model_exists_inflight: dict[tuple[str, str, str], asyncio.Task] = {}
_exists_lock = asyncio.Lock()


def _exists_cache_key(
    base_url: str,
    api_key: str | None,
    model_id: str,
) -> tuple[str, str, str]:
    """Normalize inputs for caching key."""
    normalized_base = str(base_url or "").strip().rstrip("/").lower()
    normalized_model = str(model_id or "").strip()
    # Keep key material in-memory only; avoid custom hashing of secrets.
    api_scope = str(api_key or "")
    return normalized_base, normalized_model, api_scope


async def _remote_model_exists_probe(
    *, base_url: str, api_key: str | None, model_id: str, timeout_s: int
) -> tuple[bool, str | None]:
    """Probe the provider to determine if a given model is present.

    This low‑level implementation is separated so callers can add caching
    and coalescing around it without duplicating network logic.
    """
    base = str(base_url or "").strip().rstrip("/")
    try:
        # skip validation for settings connections; the caller controls the URL
        _validate_base_url(base_url, skip_validation=True)
    except ValueError as e:
        return False, str(e)

    model_id = str(model_id or "").strip()
    if not model_id:
        return False, "Missing model_id"

    try:
        timeout_obj = httpx.Timeout(float(timeout_s))
    except Exception:
        timeout_obj = httpx.Timeout(10.0)

    headers = {"Content-Type": "application/json", **auth_headers(api_key)}

    try:
        url1 = f"{base}/models/{model_id}"
        response = await logged_request(
            caller_id="settings_machine.remote_model_exists_get_model",
            method="GET",
            url=url1,
            headers=auth_headers(api_key),
            timeout=timeout_obj,
            body=None,
            raise_for_status=False,
        )

        if response.is_success:
            return True, None

        url2 = f"{base}/chat/completions"
        payload = {
            "model": model_id,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 1,
            "temperature": 0,
        }

        response2 = await logged_request(
            caller_id="settings_machine.remote_model_exists_chat_probe",
            method="POST",
            url=url2,
            headers=headers,
            timeout=timeout_obj,
            body=payload,
            raise_for_status=False,
        )
        if response2.is_success:
            return True, None

        return False, f"HTTP {response2.status_code}"
    except Exception as exc:
        return False, str(exc)


async def remote_model_exists(
    *, base_url: str, api_key: str | None, model_id: str, timeout_s: int
) -> tuple[bool, str | None]:
    """Determine if *model_id* exists at *base_url*.

    Results are cached briefly and simultaneous callers share a single
    probe task.  Consumers of this module simply call this function; the
    implementation manages caching, validation and concurrency internally.
    """
    key = _exists_cache_key(base_url, api_key, model_id)
    now = time.monotonic()

    async with _exists_lock:
        entry = _model_exists_cache.get(key)
        if entry and entry[0] > now:
            return entry[1], None
        inflight = _model_exists_inflight.get(key)
        if inflight is None:
            inflight = asyncio.create_task(
                _remote_model_exists_probe(
                    base_url=base_url,
                    api_key=api_key,
                    model_id=model_id,
                    timeout_s=timeout_s,
                )
            )
            _model_exists_inflight[key] = inflight

    try:
        exists, detail = await inflight
        if exists and _MODEL_EXISTS_CACHE_TTL_S > 0:
            expires = time.monotonic() + _MODEL_EXISTS_CACHE_TTL_S
            async with _exists_lock:
                _model_exists_cache[key] = (expires, exists)
        return exists, detail
    finally:
        async with _exists_lock:
            current = _model_exists_inflight.get(key)
            if current is inflight:
                _model_exists_inflight.pop(key, None)
