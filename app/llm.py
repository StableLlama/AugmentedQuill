"""LLM adapter module.

This module encapsulates all interactions with the LLM provider (OpenAI-compatible
APIs). It centralizes credential resolution, request shaping, and streaming, so
the rest of the application can remain provider-agnostic.

Design goals:
- Single responsibility: Only LLM concerns live here.
- Testability: Functions are small and deterministic given inputs.
"""

from __future__ import annotations

from typing import Any, Dict, AsyncIterator, Tuple
from pathlib import Path
import os

import httpx

from app.config import load_machine_config, load_story_config
from app.projects import get_active_project_dir


BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = BASE_DIR / "config"


def resolve_openai_credentials(
    payload: Dict[str, Any],
) -> Tuple[str, str | None, str, int]:
    """Resolve (base_url, api_key, model_id, timeout_s) from machine config and overrides.

    Precedence:
    1. Environment variables OPENAI_BASE_URL / OPENAI_API_KEY
    2. Payload overrides: base_url, api_key, model, timeout_s or model_name (by name)
    3. machine.json -> openai.models[] (selected by name)
    """
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}

    selected_name = payload.get("model_name") or openai_cfg.get("selected")
    base_url = payload.get("base_url")
    api_key = payload.get("api_key")
    model_id = payload.get("model")
    timeout_s = payload.get("timeout_s")

    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    if not (isinstance(models, list) and models):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail="No OpenAI models configured. Configure openai.models[] in machine.json.",
        )

    chosen = None
    if selected_name:
        for m in models:
            if isinstance(m, dict) and (m.get("name") == selected_name):
                chosen = m
                break
    if chosen is None:
        chosen = models[0]

    base_url = chosen.get("base_url") or base_url
    api_key = chosen.get("api_key") or api_key
    model_id = chosen.get("model") or model_id
    timeout_s = chosen.get("timeout_s", 60) or timeout_s

    # Environment wins
    env_base = os.getenv("OPENAI_BASE_URL")
    env_key = os.getenv("OPENAI_API_KEY")
    if env_base:
        base_url = env_base
    if env_key:
        api_key = env_key

    if not base_url or not model_id:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400, detail="Missing base_url or model in configuration"
        )

    try:
        ts = int(timeout_s or 60)
    except Exception:
        ts = 60
    return str(base_url), (str(api_key) if api_key else None), str(model_id), ts


def _llm_debug_enabled() -> bool:
    return os.getenv("AUGQ_LLM_DEBUG", "0") in ("1", "true", "TRUE", "yes", "on")


async def openai_chat_complete(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    extra_body: dict | None = None,
) -> dict:
    """Perform a non-streaming chat.completions call.

    Pulls llm_prefs (temperature, max_tokens) from story.json of active project.
    """
    story = (
        load_story_config((get_active_project_dir() or CONFIG_DIR) / "story.json") or {}
    )
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = prefs.get("temperature", 0.7)
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens")

    url = str(base_url).rstrip("/") + "/chat/completions"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body: Dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    if extra_body:
        body.update(extra_body)

    try:
        timeout_obj = httpx.Timeout(float(timeout_s or 60))
    except Exception:
        timeout_obj = httpx.Timeout(60.0)

    if _llm_debug_enabled():
        print(
            "LLM REQUEST:",
            {
                "url": url,
                "headers": {
                    k: ("***" if k == "Authorization" else v)
                    for k, v in headers.items()
                },
                "body": body,
            },
        )

    async with httpx.AsyncClient(timeout=timeout_obj) as client:
        r = await client.post(url, headers=headers, json=body)
        if _llm_debug_enabled():
            print("LLM RESPONSE:", r.status_code)
        r.raise_for_status()
        return r.json()


async def openai_completions(
    *,
    prompt: str,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    n: int = 1,
    extra_body: dict | None = None,
) -> dict:
    """Perform a non-streaming completions call for text completion.

    Pulls llm_prefs (temperature, max_tokens) from story.json of active project.
    """
    story = (
        load_story_config((get_active_project_dir() or CONFIG_DIR) / "story.json") or {}
    )
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = prefs.get("temperature", 0.7)
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens")

    url = str(base_url).rstrip("/") + "/completions"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body: Dict[str, Any] = {
        "model": model_id,
        "prompt": prompt,
        "temperature": temperature,
        "n": n,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    if extra_body:
        body.update(extra_body)

    try:
        timeout_obj = httpx.Timeout(float(timeout_s or 60))
    except Exception:
        timeout_obj = httpx.Timeout(60.0)

    if _llm_debug_enabled():
        print(
            "LLM REQUEST:",
            {
                "url": url,
                "headers": {
                    k: ("***" if k == "Authorization" else v)
                    for k, v in headers.items()
                },
                "body": body,
            },
        )

    async with httpx.AsyncClient(timeout=timeout_obj) as client:
        r = await client.post(url, headers=headers, json=body)
        if _llm_debug_enabled():
            print("LLM RESPONSE:", r.status_code)
        r.raise_for_status()
        return r.json()


async def openai_chat_complete_stream(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
) -> AsyncIterator[str]:
    """Stream assistant content as plain text chunks.

    This wraps the OpenAI streaming delta format and yields concatenated content
    pieces for simplicity on the caller side.
    """
    url = str(base_url).rstrip("/") + "/chat/completions"
    story = (
        load_story_config((get_active_project_dir() or CONFIG_DIR) / "story.json") or {}
    )
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = prefs.get("temperature", 0.7)
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens")

    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body: Dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens

    try:
        timeout_obj = httpx.Timeout(float(timeout_s or 60))
    except Exception:
        timeout_obj = httpx.Timeout(60.0)

    async with httpx.AsyncClient(timeout=timeout_obj) as client:
        async with client.stream("POST", url, headers=headers, json=body) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                if line.startswith("data: "):
                    data = line[len("data: ") :].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = httpx.Response(
                            200, json={}
                        ).json()  # placeholder to keep type checkers happy
                    except Exception:
                        obj = None
                    # We cannot rely on httpx to parse each line; parse minimally
                    # Fallback: try json module
                    import json as _json

                    try:
                        obj = _json.loads(data)
                    except Exception:
                        obj = None
                    if not isinstance(obj, dict):
                        continue
                    try:
                        content = obj["choices"][0]["delta"].get("content")
                    except Exception:
                        content = None
                    if content:
                        yield content


async def openai_completions_stream(
    *,
    prompt: str,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    extra_body: dict | None = None,
) -> AsyncIterator[str]:
    """Stream completion content as plain text chunks.

    This wraps the OpenAI streaming completions format and yields concatenated content
    pieces for simplicity on the caller side.
    """
    url = str(base_url).rstrip("/") + "/completions"
    story = (
        load_story_config((get_active_project_dir() or CONFIG_DIR) / "story.json") or {}
    )
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = prefs.get("temperature", 0.7)
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens")

    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body: Dict[str, Any] = {
        "model": model_id,
        "prompt": prompt,
        "temperature": temperature,
        "stream": True,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    if extra_body:
        body.update(extra_body)

    try:
        timeout_obj = httpx.Timeout(float(timeout_s or 60))
    except Exception:
        timeout_obj = httpx.Timeout(60.0)

    async with httpx.AsyncClient(timeout=timeout_obj) as client:
        async with client.stream("POST", url, headers=headers, json=body) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                if line.startswith("data: "):
                    data = line[len("data: ") :].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = httpx.Response(
                            200, json={}
                        ).json()  # placeholder to keep type checkers happy
                    except Exception:
                        obj = None
                    # We cannot rely on httpx to parse each line; parse minimally
                    # Fallback: try json module
                    import json as _json

                    try:
                        obj = _json.loads(data)
                    except Exception:
                        obj = None
                    if not isinstance(obj, dict):
                        continue
                    try:
                        content = obj["choices"][0]["text"]
                    except Exception:
                        content = None
                    if content:
                        yield content
