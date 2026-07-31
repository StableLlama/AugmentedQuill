# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the story api stream ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable

from augmentedquill.services.chat.chat_tool_decorator import (
    EDITING_ROLE,
    execute_registered_tool,
    tool_message,
)
from augmentedquill.services.llm import llm


async def stream_unified_chat_content(
    *,
    messages: list,
    response_prefill: str | None = None,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    model_name: str | None = None,
    model_type: str | None = None,
    tools: list[dict] | None = None,
    extra_body: dict | None = None,
    max_rounds: int = 4,
) -> AsyncIterator[dict]:
    """Stream Unified Chat Content as event dictionaries (content, thinking, tool_calls).

    This implementation handles multi-round tool calling by executing tools returned
    in the stream and restarting the LLM generation with the tool results.
    """
    current_messages = [dict(m) for m in messages]
    if response_prefill:
        # Seed the assistant turn so generation continues from this exact prefix.
        current_messages.append({"role": "assistant", "content": response_prefill})

    for round_idx in range(max_rounds):
        round_content = ""
        round_thinking = ""
        round_tool_calls: list[dict] = []
        # Native streaming tool call fragments keyed by delta index
        _tc_acc: dict[int, dict] = {}

        async for chunk_dict in llm.unified_chat_stream(
            caller_id="story_api_stream.stream_unified_chat_content",
            messages=current_messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
            model_name=model_name,
            model_type=model_type,
            tools=tools,
            extra_body=extra_body,
        ):
            # Yield everything from the stream to the frontend
            yield chunk_dict

            # Accumulate values for the next round if needed
            if chunk_dict.get("content"):
                round_content += chunk_dict["content"]
            if chunk_dict.get("thinking"):
                round_thinking += chunk_dict["thinking"]

            tc = chunk_dict.get("tool_calls")
            if tc:
                for tc_delta in tc:
                    idx = tc_delta.get("index") or 0
                    if idx not in _tc_acc:
                        _tc_acc[idx] = {
                            "id": "",
                            "type": "function",
                            "function": {"name": "", "arguments": ""},
                        }
                    if tc_delta.get("id"):
                        _tc_acc[idx]["id"] = tc_delta["id"]
                    if tc_delta.get("type"):
                        _tc_acc[idx]["type"] = tc_delta["type"]
                    fn = tc_delta.get("function") or {}
                    if fn.get("name"):
                        _tc_acc[idx]["function"]["name"] += fn["name"]
                    if fn.get("arguments"):
                        _tc_acc[idx]["function"]["arguments"] += fn["arguments"]

        # Once the stream for this round is finished, check if we have tool calls to execute
        round_tool_calls = list(_tc_acc.values())
        if not round_tool_calls:
            # If no tool calls were made in this round, we are done
            break

        # Prepare the assistant message with tool calls for the conversation history
        assistant_msg = {"role": "assistant"}
        if round_content:
            assistant_msg["content"] = round_content
        # Note: we don't usually put thinking back in history unless the model supports it,
        # but for internal continuity in this loop it's often ignored by providers anyway.
        assistant_msg["tool_calls"] = round_tool_calls
        current_messages.append(assistant_msg)

        # Execute each tool call and add results to history
        for tcall in round_tool_calls:
            func = tcall.get("function", {})
            name = func.get("name")
            arguments = func.get("arguments", "{}")
            if isinstance(arguments, str):
                try:
                    args_obj = json.loads(arguments)
                except Exception:
                    args_obj = {}
            elif isinstance(arguments, dict):
                args_obj = arguments
            else:
                args_obj = {}

            # Use EDITING_ROLE for story generation tasks
            tool_role = model_type if model_type else EDITING_ROLE
            tool_response = await execute_registered_tool(
                name,
                args_obj,
                tcall.get("id") or "",
                {"_tool_role": tool_role},
                {},
                tool_role=tool_role,
            )
            if "role" not in tool_response:
                tool_response = tool_message(name, tcall.get("id") or "", tool_response)

            current_messages.append(tool_response)
            # We don't yield tool results to the frontend here as they are internal LLM "thoughts",
            # though some frontends might want them. AugmentedQuill currently doesn't show them.

        # The loop will now restart with the updated current_messages


async def stream_collect_and_persist(
    stream_factory: Callable[[], AsyncIterator[dict]],
    persist_on_complete: Callable[[str], None],
    chunk_transformer: Callable[[str], str] | None = None,
) -> AsyncIterator[str]:
    """Stream Collect And Persist.

    This helper consumes an upstream stream of dicts and yields only the
    `content` fragments as plain strings. That makes it compatible with
    Starlette StreamingResponse which expects byte/str chunks.
    """
    buf: list[str] = []
    try:
        async for chunk_dict in stream_factory():
            content = chunk_dict.get("content", "")
            if content:
                # Store transformed (raw) chunk for persistence
                raw_chunk = chunk_transformer(content) if chunk_transformer else content
                buf.append(raw_chunk)
            yield content
    except asyncio.CancelledError:
        return

    try:
        persist_on_complete("".join(buf))
    except Exception:
        pass
