# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the settings machine ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import datetime

import httpx

from augmentedquill.services.llm.llm import add_llm_log, create_log_entry
from augmentedquill.services.llm.llm_completion_ops import _validate_base_url


def auth_headers(api_key: str | None) -> dict[str, str]:
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
        # We allow any user-provided URL during the testing phase in settings.
        # This is because the user is explicitly providing this URL, which confirms trust.
        _validate_base_url(base_url, skip_validation=True)
    except ValueError as e:
        return False, [], str(e)

    headers = auth_headers(api_key)
    log_entry = create_log_entry(url, "GET", headers, None)
    add_llm_log(log_entry)

    try:
        timeout_obj = httpx.Timeout(float(timeout_s))
    except Exception:
        timeout_obj = httpx.Timeout(10.0)

    try:
        async with httpx.AsyncClient(timeout=timeout_obj) as client:
            response = await client.get(url, headers=headers)
            log_entry["response"]["status_code"] = response.status_code
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            if not response.is_success:
                log_entry["response"]["error"] = f"HTTP {response.status_code}"
                return False, [], f"HTTP {response.status_code}"
            data = response.json()
            log_entry["response"]["body"] = data
    except Exception as exc:
        log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
        log_entry["response"]["error"] = str(exc)
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


async def remote_model_exists(
    *, base_url: str, api_key: str | None, model_id: str, timeout_s: int
) -> tuple[bool, str | None]:
    """Remote Model Exists."""
    base = str(base_url or "").strip().rstrip("/")
    try:
        # We allow any user-provided URL during the testing phase in settings.
        # This is because the user is explicitly providing this URL, which confirms trust.
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
        async with httpx.AsyncClient(timeout=timeout_obj) as client:
            url1 = f"{base}/models/{model_id}"
            log_entry1 = create_log_entry(url1, "GET", auth_headers(api_key), None)
            add_llm_log(log_entry1)

            response = await client.get(url1, headers=auth_headers(api_key))
            log_entry1["response"]["status_code"] = response.status_code
            log_entry1["timestamp_end"] = datetime.datetime.now().isoformat()

            if response.is_success:
                log_entry1["response"]["body"] = response.json()
                return True, None

            url2 = f"{base}/chat/completions"
            payload = {
                "model": model_id,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1,
                "temperature": 0,
            }
            log_entry2 = create_log_entry(url2, "POST", headers, payload)
            add_llm_log(log_entry2)

            response2 = await client.post(url2, headers=headers, json=payload)
            log_entry2["response"]["status_code"] = response2.status_code
            log_entry2["timestamp_end"] = datetime.datetime.now().isoformat()

            if response2.is_success:
                log_entry2["response"]["body"] = response2.json()
                return True, None

            log_entry2["response"]["error"] = f"HTTP {response2.status_code}"
            return False, f"HTTP {response2.status_code}"
    except Exception as exc:
        return False, str(exc)
