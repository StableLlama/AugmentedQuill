# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""LLM adapter module.

This module encapsulates all interactions with the LLM provider (OpenAI-compatible
APIs). It centralizes credential resolution, request shaping, and streaming, so
the rest of the application can remain provider-agnostic.

Design goals:
- Single responsibility: Only LLM concerns live here.
- Testability: Functions are small and deterministic given inputs.
"""

from __future__ import annotations

from typing import Any, Dict, AsyncIterator, Tuple, List
from pathlib import Path
import os
import datetime
import uuid

import httpx
import re
import json as _json

from app.config import load_machine_config, load_story_config
from app.projects import get_active_project_dir
from app.helpers.stream_helpers import ChannelFilter

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = BASE_DIR / "config"

# Global list to store LLM communication logs for the current session
llm_logs: List[Dict[str, Any]] = []


def parse_tool_calls_from_content(content: str) -> list[dict] | None:
    """Parse tool calls from assistant content if not provided in structured format.

    Handles various formats like:
    - <tool_call>get_project_overview</tool_call>
    - <tool_call><function=get_project_overview></function></tool_call>
    - [TOOL_CALL]get_project_overview[/TOOL_CALL]
    - Tool: get_project_overview
    """

    calls = []

    # 1. Look for <tool_call> tags
    pattern1 = r"<tool_call>(.*?)</tool_call>"
    matches1 = re.finditer(pattern1, content, re.IGNORECASE | re.DOTALL)

    for m in matches1:
        content_inner = m.group(1).strip()

        # Try JSON format: {"name": "...", "arguments": ...}
        if content_inner.startswith("{"):
            try:
                json_obj = _json.loads(content_inner)
                if isinstance(json_obj, dict) and "name" in json_obj:
                    name = json_obj["name"]
                    args_obj = json_obj.get("arguments", {})

                    call_id = f"call_{name}"
                    if any(c["id"] == call_id for c in calls):
                        call_id = f"{call_id}_{len(calls)}"

                    calls.append(
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": _json.dumps(args_obj),
                            },
                            "original_text": m.group(0),
                        }
                    )
                    continue
            except Exception:
                pass

        # Try XML-like format: <function=NAME>ARGS</function>
        xml_match = re.search(
            r"<function=(\w+)>(.*?)</function>",
            content_inner,
            re.IGNORECASE | re.DOTALL,
        )
        if xml_match:
            name = xml_match.group(1)
            args_str = xml_match.group(2).strip() or "{}"
            try:
                args_obj = _json.loads(args_str)
            except Exception:
                args_obj = {}

            call_id = f"call_{name}"
            # Ensure unique ID if multiple calls to same tool
            if any(c["id"] == call_id for c in calls):
                call_id = f"{call_id}_{len(calls)}"

            calls.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": _json.dumps(args_obj)},
                    "original_text": m.group(0),
                }
            )
            continue

        # Try NAME(ARGS) format
        func_match = re.match(r"(\w+)(?:\((.*)\))?", content_inner, re.DOTALL)
        if func_match:
            name = func_match.group(1)
            args_str = func_match.group(2) or "{}"
            try:
                args_obj = _json.loads(args_str)
            except Exception:
                args_obj = {}

            call_id = f"call_{name}"
            if any(c["id"] == call_id for c in calls):
                call_id = f"{call_id}_{len(calls)}"

            calls.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": _json.dumps(args_obj)},
                    "original_text": m.group(0),
                }
            )

    # 2. Look for [TOOL_CALL] tags
    pattern2 = r"\[TOOL_CALL\]\s*(.*?)\s*\[/TOOL_CALL\]"
    matches2 = re.finditer(pattern2, content, re.IGNORECASE | re.DOTALL)

    for m in matches2:
        content_inner = m.group(1).strip()
        func_match = re.match(r"(\w+)(?:\s*\((.*?)\))?", content_inner, re.DOTALL)
        if func_match:
            name = func_match.group(1)
            args_str = func_match.group(2).strip() if func_match.group(2) else "{}"
            try:
                args_obj = _json.loads(args_str)
            except Exception:
                args_obj = {}

            call_id = f"call_{name}"
            if any(c["id"] == call_id for c in calls):
                call_id = f"{call_id}_{len(calls)}"

            calls.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": _json.dumps(args_obj)},
                    "original_text": m.group(0),
                }
            )

    # 3. Look for "Tool:" prefix (must be at start of line or after whitespace)
    pattern3 = r"(?:^|(?<=\s))Tool:\s+(\w+)(?:\(([^)]*)\))?"
    matches3 = re.finditer(pattern3, content, re.IGNORECASE)

    for m in matches3:
        name = m.group(1)
        args_str = m.group(2).strip() if m.group(2) else "{}"
        try:
            args_obj = _json.loads(args_str) if args_str != "{}" else {}
        except Exception:
            args_obj = {}

        call_id = f"call_{name}"
        if any(c["id"] == call_id for c in calls):
            call_id = f"{call_id}_{len(calls)}"

        calls.append(
            {
                "id": call_id,
                "type": "function",
                "function": {"name": name, "arguments": _json.dumps(args_obj)},
                "original_text": m.group(0),
            }
        )

    # 4. Look for <|channel|>commentary to=functions.NAME ... <|message|>JSON
    pattern4 = r"(?:<\|start\|>assistant)?<\|channel\|>commentary to=functions\.(\w+).*?<\|message\|>(.*?)(?=<\||$)"
    matches4 = re.finditer(pattern4, content, re.IGNORECASE | re.DOTALL)

    for m in matches4:
        name = m.group(1)
        args_str = m.group(2).strip() or "{}"
        try:
            args_obj = _json.loads(args_str)
        except Exception:
            args_obj = {}

        call_id = f"call_{name}"
        if any(c["id"] == call_id for c in calls):
            call_id = f"{call_id}_{len(calls)}"

        calls.append(
            {
                "id": call_id,
                "type": "function",
                "function": {"name": name, "arguments": _json.dumps(args_obj)},
                "original_text": m.group(0),
            }
        )

    return calls if calls else None


async def unified_chat_stream(
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
    log_entry: dict | None = None,
) -> AsyncIterator[dict]:
    """Stream chat with unified tool handling and automatic fallback.

    Yields:
        {"content": str} - Normal content chunks
        {"thinking": str} - Thinking/analysis chunks
        {"tool_calls": list} - Parsed tool calls
        {"error": str, ...} - Error information
        {"done": True} - End of stream
    """
    url = str(base_url).rstrip("/") + "/chat/completions"
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

    if supports_function_calling and tools and tool_choice != "none":
        body["tools"] = tools
        if tool_choice:
            body["tool_choice"] = tool_choice

    # Retry loop for fallback (tool choice error)
    attempts = 2 if supports_function_calling and tools else 1

    for attempt in range(attempts):
        is_fallback = attempt == 1
        channel_filter = ChannelFilter()
        sent_tool_call_ids = set()
        full_content = ""

        current_body = body.copy()
        if is_fallback:
            current_body.pop("tools", None)
            current_body.pop("tool_choice", None)

            # Clone messages to avoid modifying original
            new_msgs = [m.copy() for m in current_body.get("messages", [])]
            current_body["messages"] = new_msgs

            # Inject fallback instructions
            found_system = False
            tools_desc = "\nAvailable Tools:\n"
            for t in tools or []:
                f = t.get("function", {})
                name = f.get("name")
                desc = f.get("description", "")
                if name:
                    tools_desc += f"- {name}: {desc}\n"

            fallback_instr = (
                "\n\n[SYSTEM NOTICE: Native tool calling is unavailable. "
                "To use tools, you MUST output the tool call strictly using this format:]\n"
                '[TOOL_CALL]tool_name({"arg": "value"})[/TOOL_CALL]\n'
                f"{tools_desc}\n"
            )

            for m in new_msgs:
                if m.get("role") == "system":
                    m["content"] = (m.get("content", "") or "") + fallback_instr
                    found_system = True
                    break
            if not found_system:
                new_msgs.insert(
                    0,
                    {
                        "role": "system",
                        "content": "You are a helpful assistant." + fallback_instr,
                    },
                )

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(float(timeout_s or 60))
            ) as client:
                async with client.stream(
                    "POST", url, headers=headers, json=current_body
                ) as resp:
                    if log_entry:
                        log_entry["response"]["status_code"] = resp.status_code

                    if resp.status_code >= 400:
                        error_content = await resp.aread()
                        if not is_fallback and supports_function_calling:
                            err_text_check = error_content.decode(
                                "utf-8", errors="ignore"
                            )
                            if "tool choice requires" in err_text_check:
                                continue

                        if log_entry:
                            log_entry["timestamp_end"] = (
                                datetime.datetime.now().isoformat()
                            )
                        try:
                            error_data = _json.loads(error_content)
                            if log_entry:
                                log_entry["response"]["error"] = error_data
                            yield {
                                "error": "Upstream error",
                                "status": resp.status_code,
                                "data": error_data,
                            }
                        except Exception:
                            err_text = error_content.decode("utf-8", errors="ignore")
                            if log_entry:
                                log_entry["response"]["error"] = err_text
                            yield {
                                "error": "Upstream error",
                                "status": resp.status_code,
                                "data": err_text,
                            }
                        return

                    content_type = resp.headers.get("content-type", "")
                    if "text/event-stream" not in content_type:
                        # Non-SSE logic
                        try:
                            response_data = await resp.json()
                            if log_entry:
                                log_entry["response"]["body"] = response_data
                                log_entry["timestamp_end"] = (
                                    datetime.datetime.now().isoformat()
                                )

                            choices = response_data.get("choices", [])
                            if choices:
                                choice = choices[0]
                                message = choice.get("message", {})
                                content = message.get("content", "")

                                if content:
                                    for res in channel_filter.feed(content):
                                        if res["channel"] == "thinking":
                                            yield {"thinking": res["content"]}
                                        elif res["channel"] == "final":
                                            yield {"content": res["content"]}

                                    # Content handling with tool call parsing from original content
                                    parsed = parse_tool_calls_from_content(content)
                                    if parsed:
                                        yield {"tool_calls": parsed}

                                if message.get("tool_calls"):
                                    yield {"tool_calls": message["tool_calls"]}

                            yield {"done": True}
                        except Exception as e:
                            yield {
                                "error": "Failed to parse response",
                                "message": str(e),
                            }
                        break

                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        if line.startswith("data: "):
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                # Final tool check
                                if full_content:
                                    parsed = parse_tool_calls_from_content(full_content)
                                    if parsed:
                                        new_calls = [
                                            c
                                            for c in parsed
                                            if c["id"] not in sent_tool_call_ids
                                        ]
                                        if new_calls:
                                            yield {"tool_calls": new_calls}

                                # Flush channel filter
                                for res in channel_filter.flush():
                                    if res["channel"] == "thinking":
                                        yield {"thinking": res["content"]}
                                    elif res["channel"].startswith("call:"):
                                        func_name = res["channel"][5:]
                                        call_id = f"call_{func_name}"
                                        if call_id not in sent_tool_call_ids:
                                            yield {
                                                "tool_calls": [
                                                    {
                                                        "id": call_id,
                                                        "type": "function",
                                                        "function": {
                                                            "name": func_name,
                                                            "arguments": res["content"],
                                                        },
                                                    }
                                                ]
                                            }
                                    elif res["channel"] == "tool_def":
                                        continue
                                    elif res["content"]:
                                        yield {"content": res["content"]}

                                yield {"done": True}
                                break

                            try:
                                chunk = _json.loads(data_str)
                                if log_entry:
                                    log_entry["response"]["chunks"].append(chunk)

                                choices = chunk.get("choices", [])
                                if not choices:
                                    continue
                                delta = choices[0].get("delta", {})

                                # Reasoning
                                reasoning = delta.get("reasoning_content")
                                if reasoning:
                                    yield {"thinking": reasoning}

                                # Content
                                content = delta.get("content")
                                if content:
                                    full_content += content
                                    if log_entry:
                                        log_entry["response"]["full_content"] += content

                                    for res in channel_filter.feed(content):
                                        if res["channel"] == "thinking":
                                            yield {"thinking": res["content"]}
                                        elif res["channel"].startswith("call:"):
                                            func_name = res["channel"][5:]
                                            yield {
                                                "tool_calls": [
                                                    {
                                                        "id": f"call_{func_name}",
                                                        "type": "function",
                                                        "function": {
                                                            "name": func_name,
                                                            "arguments": res["content"],
                                                        },
                                                    }
                                                ]
                                            }
                                        elif res["channel"] == "tool_def":
                                            # Inside tool tags, skip yielding as content
                                            continue
                                        else:
                                            # Regular content
                                            c_lower = res["content"].lower()
                                            has_syntax = (
                                                "<tool_call" in c_lower
                                                or "[tool_call" in c_lower
                                                or c_lower.strip().startswith("tool:")
                                            )
                                            if has_syntax:
                                                parsed = parse_tool_calls_from_content(
                                                    res["content"]
                                                )
                                                if parsed:
                                                    new_calls = [
                                                        c
                                                        for c in parsed
                                                        if c["id"]
                                                        not in sent_tool_call_ids
                                                    ]
                                                    if new_calls:
                                                        for c in new_calls:
                                                            sent_tool_call_ids.add(
                                                                c["id"]
                                                            )
                                                        yield {"tool_calls": new_calls}
                                                    # If it was a full tool call, don't yield it as content
                                                    continue
                                            yield {"content": res["content"]}

                                # Native tool calls
                                tc = delta.get("tool_calls")
                                if tc:
                                    yield {"tool_calls": tc}

                            except Exception:
                                continue
                    break

        except Exception as e:
            if log_entry:
                log_entry["response"]["error"] = str(e)
            yield {"error": "Connection error", "message": str(e)}
            break


def strip_thinking_tags(content: str) -> str:
    """Strip thinking/analysis tags from content, returning only the final message."""
    if not content:
        return content

    # Handle <|channel|>analysis<|message|>...<|end|><|start|>assistant<|channel|>final<|message|>
    if "<|channel|>analysis<|message|>" in content:
        # Try to find the final channel
        final_match = re.search(
            r"<\|channel\|>final<\|message\|>(.*)", content, re.DOTALL
        )
        if final_match:
            return final_match.group(1).strip()
        # If no final channel found but analysis is present, it might be just analysis or incomplete
        # Remove the analysis part
        content = re.sub(
            r"<\|channel\|>analysis<\|message\|>.*?<\|end\|>",
            "",
            content,
            flags=re.DOTALL,
        )
        content = re.sub(
            r"<\|start\|>assistant<\|channel\|>final<\|message\|>", "", content
        )
        return content.strip()

    # Handle <thought>...</thought> or <thinking>...</thinking>
    content = re.sub(r"<(thought|thinking)>.*?</\1>", "", content, flags=re.DOTALL)

    return content.strip()


def add_llm_log(log_entry: Dict[str, Any]):
    """Add a log entry to the global list, keeping only the last 100 entries."""
    llm_logs.append(log_entry)
    if len(llm_logs) > 100:
        llm_logs.pop(0)


def create_log_entry(
    url: str, method: str, headers: Dict[str, str], body: Any, streaming: bool = False
) -> Dict[str, Any]:
    """Create a new log entry structure."""
    return {
        "id": str(uuid.uuid4()),
        "timestamp_start": datetime.datetime.now().isoformat(),
        "timestamp_end": None,
        "request": {
            "url": url,
            "method": method,
            "headers": {
                k: ("***" if k.lower() == "authorization" else v)
                for k, v in headers.items()
            },
            "body": body,
        },
        "response": {
            "status_code": None,
            "streaming": streaming,
            "chunks": [] if streaming else None,
            "full_content": "" if streaming else None,
            "body": None if not streaming else None,
        },
    }


def get_selected_model_name(
    payload: Dict[str, Any], model_type: str | None = None
) -> str | None:
    """Get the selected model name based on payload and model_type."""
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}

    selected_name = payload.get("model_name")
    if not selected_name and model_type:
        if model_type == "WRITING":
            selected_name = openai_cfg.get("selected_writing")
        elif model_type == "CHAT":
            selected_name = openai_cfg.get("selected_chat")
        elif model_type == "EDITING":
            selected_name = openai_cfg.get("selected_editing")

    if not selected_name:
        selected_name = openai_cfg.get("selected")
    return selected_name


def resolve_openai_credentials(
    payload: Dict[str, Any],
    model_type: str | None = None,
) -> Tuple[str, str | None, str, int]:
    """Resolve (base_url, api_key, model_id, timeout_s) from machine config and overrides.

    Precedence:
    1. Environment variables OPENAI_BASE_URL / OPENAI_API_KEY
    2. Payload overrides: base_url, api_key, model, timeout_s or model_name (by name)
    3. machine.json -> openai.models[] (selected by name based on model_type)
    """
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}

    selected_name = get_selected_model_name(payload, model_type)

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
    """Perform a non-streaming chat call with unified response parsing.

    Returns:
        {
            "content": str,
            "tool_calls": list,
            "thinking": str,
            "raw": dict
        }
    """
    extra_body = {}
    if supports_function_calling and tools and tool_choice != "none":
        extra_body["tools"] = tools
        if tool_choice:
            extra_body["tool_choice"] = tool_choice

    # For non-streaming, we don't handle fallbacks automatically yet as it's less critical
    # but we do unify the response parsing.

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

        # Handle text-based tool calls if content exists
        if content:
            parsed = parse_tool_calls_from_content(content)
            if parsed:
                # Merge if both exist, or use parsed
                tool_calls = list(tool_calls) + parsed

            # Strip thinking tags
            thinking = ""
            if "<thought>" in content or "<thinking>" in content:
                # Simple extraction for non-streaming
                match = re.search(
                    r"<(thought|thinking)>(.*?)</\1>",
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

    log_entry = create_log_entry(url, "POST", headers, body)
    add_llm_log(log_entry)

    try:
        timeout_obj = httpx.Timeout(float(timeout_s or 60))
    except Exception:
        timeout_obj = httpx.Timeout(60.0)

    if _llm_debug_enabled():
        print(
            "LLM REQUEST:",
            {
                "url": url,
                "headers": log_entry["request"]["headers"],
                "body": body,
            },
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

    log_entry = create_log_entry(url, "POST", headers, body)
    add_llm_log(log_entry)

    try:
        timeout_obj = httpx.Timeout(float(timeout_s or 60))
    except Exception:
        timeout_obj = httpx.Timeout(60.0)

    if _llm_debug_enabled():
        print(
            "LLM REQUEST:",
            {
                "url": url,
                "headers": log_entry["request"]["headers"],
                "body": body,
            },
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

    log_entry = create_log_entry(url, "POST", headers, body, streaming=True)
    add_llm_log(log_entry)

    try:
        timeout_obj = httpx.Timeout(float(timeout_s or 60))
    except Exception:
        timeout_obj = httpx.Timeout(60.0)

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

    log_entry = create_log_entry(url, "POST", headers, body, streaming=True)
    add_llm_log(log_entry)

    try:
        timeout_obj = httpx.Timeout(float(timeout_s or 60))
    except Exception:
        timeout_obj = httpx.Timeout(60.0)

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
