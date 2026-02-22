# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the llm completion ops unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

from typing import Any, Dict, AsyncIterator
import datetime
import os
import re

import httpx

from augmentedquill.core.config import load_story_config, CONFIG_DIR
from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.utils.llm_parsing import (
    parse_tool_calls_from_content,
    strip_thinking_tags,
)
from augmentedquill.services.llm.llm_logging import add_llm_log, create_log_entry
from augmentedquill.services.llm.llm_request_helpers import (
    get_story_llm_preferences,
    build_headers,
    build_timeout,
)


def _llm_debug_enabled() -> bool:
    return os.getenv("AUGQ_LLM_DEBUG", "0") in ("1", "true", "TRUE", "yes", "on")


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
        content = message.get("content") or ""
        tool_calls = message.get("tool_calls") or []

        if content:
            parsed = parse_tool_calls_from_content(content)
            if parsed:
                tool_calls = list(tool_calls) + parsed

            if "<thought>" in content or "<thinking>" in content:
                match = re.search(
                    r"<(thought|thinking)>(.*?)</\\1>",
                    content,
                    re.DOTALL | re.IGNORECASE,
                )
                if match:
                    thinking = match.group(2).strip()

            content = strip_thinking_tags(content)

    return {
        "content": content,
        "tool_calls": tool_calls,
        "thinking": thinking,
        "raw": resp_json,
    }


async def openai_chat_complete(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    extra_body: dict | None = None,
) -> dict:
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

    log_entry = create_log_entry(url, "POST", headers, body)
    add_llm_log(log_entry)

    timeout_obj = build_timeout(timeout_s)

    if _llm_debug_enabled():
        print(
            "LLM REQUEST:",
            {"url": url, "headers": log_entry["request"]["headers"], "body": body},
        )

    async with httpx.AsyncClient(timeout=timeout_obj) as client:
        try:
            r = await client.post(url, headers=headers, json=body)
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            log_entry["response"]["status_code"] = r.status_code
            if _llm_debug_enabled():
                print("LLM RESPONSE:", r.status_code)

            r.raise_for_status()
            resp_json = r.json()
            log_entry["response"]["body"] = resp_json
            return resp_json
        except Exception as e:
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            log_entry["response"]["error"] = str(e)
            raise


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

    log_entry = create_log_entry(url, "POST", headers, body)
    add_llm_log(log_entry)

    timeout_obj = build_timeout(timeout_s)

    if _llm_debug_enabled():
        print(
            "LLM REQUEST:",
            {"url": url, "headers": log_entry["request"]["headers"], "body": body},
        )

    async with httpx.AsyncClient(timeout=timeout_obj) as client:
        try:
            r = await client.post(url, headers=headers, json=body)
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            log_entry["response"]["status_code"] = r.status_code
            if _llm_debug_enabled():
                print("LLM RESPONSE:", r.status_code)

            r.raise_for_status()
            resp_json = r.json()
            log_entry["response"]["body"] = resp_json
            return resp_json
        except Exception as e:
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            log_entry["response"]["error"] = str(e)
            raise


async def openai_chat_complete_stream(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
) -> AsyncIterator[str]:
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

    log_entry = create_log_entry(url, "POST", headers, body, streaming=True)
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
            log_entry["response"]["error"] = str(e)
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

    log_entry = create_log_entry(url, "POST", headers, body, streaming=True)
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
            log_entry["response"]["error"] = str(e)
            raise
        finally:
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
