# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the llm stream ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from typing import Any, Dict, AsyncIterator
import json as _json
import os

import httpx

from augmentedquill.core.config import (
    load_machine_config,
)
from augmentedquill.services.llm.llm_http_ops import logged_stream_request
from augmentedquill.services.chat.chat_tool_decorator import EDITING_ROLE
from augmentedquill.services.llm.llm_request_helpers import (
    apply_native_tool_calling_mode,
)
from augmentedquill.utils.stream_helpers import ChannelFilter
from augmentedquill.utils.llm_parsing import (
    parse_complete_assistant_output,
    parse_stream_channel_fragments,
    parse_tool_calls_from_content,
)


def _enforce_writing_no_thinking(
    extra_body: Dict[str, Any], model_type: str | None
) -> Dict[str, Any]:
    """Ensure WRITING requests never enable provider thinking templates."""
    if model_type != "WRITING":
        return extra_body

    merged = dict(extra_body or {})
    chat_template_kwargs = merged.get("chat_template_kwargs")
    if isinstance(chat_template_kwargs, dict):
        next_kwargs = dict(chat_template_kwargs)
        if next_kwargs.get("enable_thinking") is True:
            next_kwargs["enable_thinking"] = False
        merged["chat_template_kwargs"] = next_kwargs

    if merged.get("enable_thinking") is True:
        merged["enable_thinking"] = False

    return merged


def _validate_base_url(base_url: str, skip_validation: bool = False) -> None:
    """Validate base_url against configured models or environment overrides to prevent SSRF."""
    if not base_url or skip_validation:
        return

    # Check for suspicious schemes or non-HTTP/HTTPS URLs
    if not (base_url.startswith("http://") or base_url.startswith("https://")):
        raise ValueError(f"Invalid base_url scheme: {base_url}")

    # Check for forbidden characters in URL (basic SSRF protection)
    if any(c in base_url for c in "@[]"):
        raise ValueError(f"Potentially dangerous base_url: {base_url}")

    # 1. Check environment overrides (trusted)
    overrides = {
        os.getenv("OPENAI_BASE_URL"),
        os.getenv("ANTHROPIC_BASE_URL"),
        os.getenv("GOOGLE_BASE_URL"),
    }
    if base_url in overrides:
        return

    # 2. Check machine.json models
    machine_config = load_machine_config()
    if not machine_config:
        from augmentedquill.services.exceptions import ConfigurationError

        raise ConfigurationError(
            "No OpenAI models configured. Configure openai.models[] in machine.json.",
        )

    for provider in ["openai", "anthropic", "google"]:
        all_models = machine_config.get(provider, {}).get("models", [])
        for model in all_models:
            model_url = model.get("base_url")
            if model_url and base_url == model_url:
                return

    # 3. Allow explicitly trusted local inference servers (e.g. Ollama, LM Studio)
    trusted_locals = {
        "http://localhost",
        "http://127.0.0.1",
        "http://0.0.0.0",
        "https://localhost",
        "https://127.0.0.1",
        "http://fake",  # Trusted for unit tests
    }
    for trusted in trusted_locals:
        if base_url == trusted or base_url.startswith(trusted + ":"):
            suffix = base_url[len(trusted) :]
            if not suffix or (
                suffix.startswith(":") and suffix[1:].split("/")[0].isdigit()
            ):
                return

    raise ValueError(f"Untrusted or unconfirmed base_url: {base_url}")


async def unified_chat_stream(
    *,
    caller_id: str,
    model_type: str | None = None,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    model_name: str | None = None,
    supports_function_calling: bool = True,
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    extra_body: dict | None = None,
    skip_validation: bool = False,
) -> AsyncIterator[dict]:
    """Unified Chat Stream."""
    from augmentedquill.services.llm.llm_completion_ops import (
        _resolve_machine_model_cfg,
        _resolve_temperature_max_tokens,
        _build_model_extra_body,
    )

    _validate_base_url(base_url, skip_validation=skip_validation)

    model_cfg = _resolve_machine_model_cfg(base_url, model_id, model_name)
    temperature, max_tokens = _resolve_temperature_max_tokens(
        temperature, max_tokens, model_cfg
    )

    # For EDITING tasks (like summarization), if we have a thinking model, we likely need more tokens.
    # We boost max_tokens to 16k if it's below that, to allow for extensive reasoning.
    if model_type == EDITING_ROLE and (max_tokens is None or max_tokens < 16384):
        # We check for known reasoning model patterns if possible, or just apply it for all editing tasks
        # since summaries usually don't reach 16k anyway, so it's a safe upper bound.
        max_tokens = 16384

    model_extra_body = _build_model_extra_body(model_cfg)
    request_extra_body = apply_native_tool_calling_mode(
        extra_body,
        supports_function_calling=supports_function_calling,
        tools=tools,
        tool_choice=tool_choice,
    )

    # Model config acts as defaults; request-level extra_body must be able to
    # override them (e.g. disable thinking for assistant-prefill continuation).
    merged_extra_body = dict(model_extra_body)
    for key, value in request_extra_body.items():
        if (
            key == "chat_template_kwargs"
            and isinstance(merged_extra_body.get(key), dict)
            and isinstance(value, dict)
        ):
            merged_extra_body[key] = {**merged_extra_body[key], **value}
        else:
            merged_extra_body[key] = value
    merged_extra_body = _enforce_writing_no_thinking(merged_extra_body, model_type)

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
    if merged_extra_body:
        body.update(merged_extra_body)

    if supports_function_calling and tools and tool_choice != "none":
        body["tools"] = tools
        if tool_choice:
            body["tool_choice"] = tool_choice

    attempts = 2 if supports_function_calling and tools else 1

    for attempt in range(attempts):
        is_fallback = attempt == 1
        request_log_entry: dict | None = None
        channel_filter = ChannelFilter()
        sent_tool_call_ids = set()
        full_content = ""
        full_reasoning = ""
        # Accumulate native streaming tool call fragments keyed by delta index
        _tc_acc: dict[int, dict] = {}

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
            async with logged_stream_request(
                caller_id=caller_id,
                model_type=model_type,
                method="POST",
                url=url,
                headers=headers,
                body=current_body,
                timeout=httpx.Timeout(float(timeout_s or 60)),
            ) as (resp, request_log_entry):
                if resp.status_code >= 400:
                    error_content = await resp.aread()
                    if not is_fallback and supports_function_calling:
                        err_text_check = error_content.decode("utf-8", errors="ignore")
                        if "tool choice requires" in err_text_check:
                            continue

                    try:
                        error_data = _json.loads(error_content)
                        if request_log_entry:
                            request_log_entry["response"]["error"] = error_data
                        yield {
                            "error": "Upstream error",
                            "status": resp.status_code,
                            "data": error_data,
                        }
                    except Exception:
                        err_text = error_content.decode("utf-8", errors="ignore")
                        if request_log_entry:
                            request_log_entry["response"]["error"] = err_text
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
                        if request_log_entry:
                            request_log_entry["response"]["body"] = response_data
                            if response_data.get("usage") is not None:
                                request_log_entry["response"]["usage"] = response_data[
                                    "usage"
                                ]

                        usage = response_data.get("usage")
                        if usage is not None:
                            yield {"usage": usage}

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
                    except Exception as e:
                        if request_log_entry:
                            request_log_entry["response"]["error_detail"] = str(e)
                            request_log_entry["response"][
                                "error"
                            ] = "Failed to parse non-stream response"
                        yield {
                            "error": "Failed to parse response",
                            "message": f"An error occurred while processing the response: {e}",
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
                                    full_content,
                                    extra_tool_call_content=full_reasoning,
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
                                        if request_log_entry:
                                            request_log_entry["response"][
                                                "tool_calls"
                                            ] = (
                                                request_log_entry["response"].get(
                                                    "tool_calls"
                                                )
                                                or []
                                            ) + new_calls

                            # Store assembled native tool calls in the log entry
                            if _tc_acc and request_log_entry:
                                assembled = list(_tc_acc.values())
                                existing = (
                                    request_log_entry["response"].get("tool_calls")
                                    or []
                                )
                                request_log_entry["response"]["tool_calls"] = (
                                    existing + assembled
                                )

                            events = parse_stream_channel_fragments(
                                channel_filter.flush(), sent_tool_call_ids
                            )
                            for event in events:
                                yield event

                            yield {"done": True}
                            break

                        try:
                            chunk = _json.loads(data_str)
                            if request_log_entry:
                                request_log_entry["response"]["chunks"].append(chunk)
                            usage = chunk.get("usage")
                            if usage is not None:
                                if request_log_entry:
                                    request_log_entry["response"]["usage"] = usage
                                yield {"usage": usage}
                            choices = chunk.get("choices", [])
                            if not choices:
                                continue
                            delta = choices[0].get("delta", {})

                            reasoning = delta.get("reasoning_content") or delta.get(
                                "reasoning"
                            )
                            if reasoning:
                                full_reasoning += reasoning
                                if request_log_entry:
                                    if "thinking" not in request_log_entry["response"]:
                                        request_log_entry["response"]["thinking"] = ""
                                    request_log_entry["response"][
                                        "thinking"
                                    ] += reasoning
                                parsed_reasoning_calls = (
                                    parse_tool_calls_from_content(full_reasoning) or []
                                )
                                if parsed_reasoning_calls:
                                    new_calls = [
                                        c
                                        for c in parsed_reasoning_calls
                                        if c.get("id") not in sent_tool_call_ids
                                    ]
                                    if new_calls:
                                        for call in new_calls:
                                            call_id = call.get("id")
                                            if isinstance(call_id, str):
                                                sent_tool_call_ids.add(call_id)
                                        yield {"tool_calls": new_calls}
                                yield {"thinking": reasoning}

                            content = delta.get("content")
                            if content:
                                full_content += content
                                if request_log_entry:
                                    request_log_entry["response"][
                                        "full_content"
                                    ] += content

                                events = parse_stream_channel_fragments(
                                    channel_filter.feed(content),
                                    sent_tool_call_ids,
                                )
                                for event in events:
                                    yield event

                            tc = delta.get("tool_calls")
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
                                        _tc_acc[idx]["function"]["arguments"] += fn[
                                            "arguments"
                                        ]
                                yield {"tool_calls": tc}

                        except Exception:
                            continue
                break

        except Exception as e:
            err_text = str(e).strip() or f"{type(e).__name__}: {repr(e)}"
            if request_log_entry:
                request_log_entry["response"]["error_detail"] = err_text
                request_log_entry["response"][
                    "error"
                ] = f"An internal error occurred during the LLM request: {err_text}"
            yield {
                "error": "Connection error",
                "message": f"An error occurred: {err_text}.",
            }
            break
