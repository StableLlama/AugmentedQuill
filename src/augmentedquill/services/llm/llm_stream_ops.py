# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the llm stream ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from typing import Any, Dict, AsyncIterator
import datetime
import json as _json

import httpx

from augmentedquill.utils.stream_helpers import ChannelFilter
from augmentedquill.utils.llm_parsing import (
    parse_complete_assistant_output,
    parse_stream_channel_fragments,
)


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
    """Unified Chat Stream."""
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

            new_msgs = [m.copy() for m in current_body.get("messages", [])]
            current_body["messages"] = new_msgs

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
                                    events = parse_stream_channel_fragments(
                                        channel_filter.feed(content), sent_tool_call_ids
                                    )
                                    for event in events:
                                        yield event

                                    parsed_full = parse_complete_assistant_output(
                                        content,
                                    )
                                    parsed_calls = parsed_full["tool_calls"]
                                    if parsed_calls:
                                        new_calls = [
                                            c
                                            for c in parsed_calls
                                            if c.get("id") not in sent_tool_call_ids
                                        ]
                                        if new_calls:
                                            for call in new_calls:
                                                call_id = call.get("id")
                                                if isinstance(call_id, str):
                                                    sent_tool_call_ids.add(call_id)
                                            yield {"tool_calls": new_calls}

                                if message.get("tool_calls"):
                                    yield {"tool_calls": message["tool_calls"]}

                            yield {"done": True}
                        except Exception:
                            yield {
                                "error": "Failed to parse response",
                                "message": "An error occurred while processing the response.",
                            }
                        break

                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        if line.startswith("data: "):
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                if full_content:
                                    parsed_calls = parse_complete_assistant_output(
                                        full_content
                                    )["tool_calls"]
                                    if parsed_calls:
                                        new_calls = [
                                            c
                                            for c in parsed_calls
                                            if c.get("id") not in sent_tool_call_ids
                                        ]
                                        if new_calls:
                                            for call in new_calls:
                                                call_id = call.get("id")
                                                if isinstance(call_id, str):
                                                    sent_tool_call_ids.add(call_id)
                                            yield {"tool_calls": new_calls}

                                events = parse_stream_channel_fragments(
                                    channel_filter.flush(), sent_tool_call_ids
                                )
                                for event in events:
                                    yield event

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

                                reasoning = delta.get("reasoning_content")
                                if reasoning:
                                    yield {"thinking": reasoning}

                                content = delta.get("content")
                                if content:
                                    full_content += content
                                    if log_entry:
                                        log_entry["response"]["full_content"] += content

                                    events = parse_stream_channel_fragments(
                                        channel_filter.feed(content),
                                        sent_tool_call_ids,
                                    )
                                    for event in events:
                                        yield event

                                tc = delta.get("tool_calls")
                                if tc:
                                    yield {"tool_calls": tc}

                            except Exception:
                                continue
                    break

        except Exception as e:
            if log_entry:
                log_entry["response"]["error_detail"] = str(e)
                log_entry["response"][
                    "error"
                ] = "An internal error occurred during the LLM request."
            yield {"error": "Connection error", "message": "An error occurred."}
            break
