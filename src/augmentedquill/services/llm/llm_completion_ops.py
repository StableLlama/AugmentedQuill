# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the llm completion ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from typing import Any, Dict, AsyncIterator
import datetime
import os
import re

import httpx

from augmentedquill.core.config import (
    load_story_config,
    CONFIG_DIR,
    load_machine_config,
)
from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.utils.llm_parsing import (
    parse_complete_assistant_output,
)
from augmentedquill.services.llm.llm_logging import add_llm_log, create_log_entry
from augmentedquill.services.llm.llm_request_helpers import (
    get_story_llm_preferences,
    build_headers,
    build_timeout,
)


def _llm_debug_enabled() -> bool:
    """Return whether verbose LLM request/response logging is enabled."""
    return os.getenv("AUGQ_LLM_DEBUG", "0") in ("1", "true", "TRUE", "yes", "on")


def _validate_base_url(base_url: str) -> None:
    """Validate base_url against configured models or environment overrides to prevent SSRF."""
    if not base_url:
        return

    # Check for suspicious schemes or non-HTTP/HTTPS URLs
    if not (base_url.startswith("http://") or base_url.startswith("https://")):
        raise ValueError(f"Invalid base_url scheme: {base_url}")

    # Check for forbidden characters in URL (basic SSRF protection)
    if "@" in base_url or "[" in base_url or "]" in base_url:
        raise ValueError(f"Potentially dangerous base_url: {base_url}")

    # 1. Check environment overrides (trusted)
    overrides = [
        os.getenv("OPENAI_BASE_URL"),
        os.getenv("ANTHROPIC_BASE_URL"),
        os.getenv("GOOGLE_BASE_URL"),
    ]
    if any(base_url == ov for ov in overrides if ov):
        return

    # 2. Check machine.json models
    config_path = os.path.join(CONFIG_DIR, "machine.json")
    machine_config = load_machine_config(config_path)
    if machine_config:
        all_models = (
            machine_config.get("openai", {}).get("models", [])
            + machine_config.get("anthropic", {}).get("models", [])
            + machine_config.get("google", {}).get("models", [])
        )
        for model in all_models:
            model_url = model.get("base_url")
            if model_url and base_url == model_url:
                return

    # 3. Allow localhost/127.0.0.1 for local inference servers (e.g. Ollama, LM Studio)
    # We use a strict regex for local addresses to prevent bypass via other hostnames
    local_pattern = re.compile(
        r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d{1,5})?(/.*)?$",
        re.IGNORECASE,
    )
    if local_pattern.match(base_url):
        return

    raise ValueError(f"Untrusted or unconfirmed base_url: {base_url}")


def _prepare_llm_request(
    base_url, api_key, model_id, messages, temperature, max_tokens, extra_body=None
):
    url = str(base_url).rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    if extra_body:
        body.update(extra_body)
    return url, headers, body


async def unified_chat_complete(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    supports_function_calling: bool = True,
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
) -> dict:
    """Execute a non-streaming chat completion and normalize tool/thinking output."""
    extra_body = {}
    if supports_function_calling and tools and tool_choice != "none":
        extra_body["tools"] = tools
        if tool_choice:
            extra_body["tool_choice"] = tool_choice

    resp_json = await openai_chat_complete(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        extra_body=extra_body,
    )

    choices = resp_json.get("choices", [])
    content = ""
    tool_calls = []
    thinking = ""

    if choices:
        message = choices[0].get("message", {})
        parsed = parse_complete_assistant_output(
            message.get("content") or "",
            structured_tool_calls=message.get("tool_calls") or [],
        )
        content = parsed["content"]
        tool_calls = parsed["tool_calls"]
        thinking = parsed["thinking"]

    return {
        "content": content,
        "tool_calls": tool_calls,
        "thinking": thinking,
        "raw": resp_json,
    }


async def _execute_llm_request(url, headers, body, timeout_s):
    # Security: Ensure sensitive headers (like Authorization) are masked BEFORE logging
    safe_log_headers = {
        k: (v if k.lower() != "authorization" else "REDACTED")
        for k, v in headers.items()
    }
    log_entry = create_log_entry(url, "POST", safe_log_headers, body)
    add_llm_log(log_entry)

    timeout_obj = build_timeout(timeout_s)

    # Security: No longer printing raw headers or body to console to avoid sensitive information exposure.
    # LLM logs are stored securely via add_llm_log.

    async with httpx.AsyncClient(timeout=timeout_obj) as client:
        try:
            r = await client.post(url, headers=headers, json=body)
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            log_entry["response"]["status_code"] = r.status_code

            r.raise_for_status()
            resp_json = r.json()
            log_entry["response"]["body"] = resp_json
            return resp_json
        except Exception as e:
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            log_entry["response"]["error_detail"] = str(e)
            log_entry["response"][
                "error"
            ] = "An internal error occurred during the LLM request."
            raise


async def openai_chat_complete(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    extra_body: dict | None = None,
) -> dict:
    """Call the OpenAI-compatible chat completions endpoint and return JSON."""
    _validate_base_url(base_url)
    temperature, max_tokens = get_story_llm_preferences(
        config_dir=CONFIG_DIR,
        get_active_project_dir=get_active_project_dir,
        load_story_config=load_story_config,
    )

    url = str(base_url).rstrip("/") + "/chat/completions"
    headers = build_headers(api_key)

    body: Dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    if extra_body:
        body.update(extra_body)

    return await _execute_llm_request(url, headers, body, timeout_s)


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
    """Call the OpenAI-compatible text completions endpoint and return JSON."""
    _validate_base_url(base_url)
    temperature, max_tokens = get_story_llm_preferences(
        config_dir=CONFIG_DIR,
        get_active_project_dir=get_active_project_dir,
        load_story_config=load_story_config,
    )

    url = str(base_url).rstrip("/") + "/completions"
    headers = build_headers(api_key)

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

    return await _execute_llm_request(url, headers, body, timeout_s)


async def openai_chat_complete_stream(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
) -> AsyncIterator[str]:
    """Stream content chunks from the chat completions endpoint."""
    _validate_base_url(base_url)
    url = str(base_url).rstrip("/") + "/chat/completions"
    temperature, max_tokens = get_story_llm_preferences(
        config_dir=CONFIG_DIR,
        get_active_project_dir=get_active_project_dir,
        load_story_config=load_story_config,
    )

    headers = build_headers(api_key)

    body: Dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens

    # Security: Ensure sensitive headers (like Authorization) are masked BEFORE logging
    safe_log_headers = {
        k: (v if k.lower() != "authorization" else "REDACTED")
        for k, v in headers.items()
    }
    log_entry = create_log_entry(url, "POST", safe_log_headers, body, streaming=True)
    add_llm_log(log_entry)

    timeout_obj = build_timeout(timeout_s)

    async with httpx.AsyncClient(timeout=timeout_obj) as client:
        try:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                log_entry["response"]["status_code"] = resp.status_code
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        data = line[len("data: ") :].strip()
                        if data == "[DONE]":
                            break

                        import json as _json

                        try:
                            obj = _json.loads(data)
                            log_entry["response"]["chunks"].append(obj)
                        except Exception:
                            obj = None
                        if not isinstance(obj, dict):
                            continue
                        try:
                            content = obj["choices"][0]["delta"].get("content")
                        except Exception:
                            content = None
                        if content:
                            log_entry["response"]["full_content"] += content
                            yield content
        except Exception as e:
            log_entry["response"]["error_detail"] = str(e)
            log_entry["response"][
                "error"
            ] = "An internal error occurred during the LLM request."
            raise
        finally:
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()


async def openai_completions_stream(
    *,
    prompt: str,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    extra_body: dict | None = None,
) -> AsyncIterator[str]:
    """Stream content chunks from the text completions endpoint."""
    _validate_base_url(base_url)
    url = str(base_url).rstrip("/") + "/completions"
    temperature, max_tokens = get_story_llm_preferences(
        config_dir=CONFIG_DIR,
        get_active_project_dir=get_active_project_dir,
        load_story_config=load_story_config,
    )

    headers = build_headers(api_key)

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

    # Security: Ensure sensitive headers (like Authorization) are masked BEFORE logging
    safe_log_headers = {
        k: (v if k.lower() != "authorization" else "REDACTED")
        for k, v in headers.items()
    }
    log_entry = create_log_entry(url, "POST", safe_log_headers, body, streaming=True)
    add_llm_log(log_entry)

    timeout_obj = build_timeout(timeout_s)

    async with httpx.AsyncClient(timeout=timeout_obj) as client:
        try:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                log_entry["response"]["status_code"] = resp.status_code
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        data = line[len("data: ") :].strip()
                        if data == "[DONE]":
                            break

                        import json as _json

                        try:
                            obj = _json.loads(data)
                            log_entry["response"]["chunks"].append(obj)
                        except Exception:
                            obj = None
                        if not isinstance(obj, dict):
                            continue
                        try:
                            content = obj["choices"][0]["text"]
                        except Exception:
                            content = None
                        if content:
                            log_entry["response"]["full_content"] += content
                            yield content
        except Exception as e:
            log_entry["response"]["error_detail"] = str(e)
            log_entry["response"][
                "error"
            ] = "An internal error occurred during the LLM request."
            raise
        finally:
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
