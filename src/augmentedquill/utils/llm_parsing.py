# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the llm parsing unit so this responsibility stays isolated, testable, and easy to evolve.

Utilities for parsing assistant messages, extracting tool calls, and handling generated Markdown.
"""

from __future__ import annotations

import json as _json
import re
from typing import Any

from augmentedquill.utils.json_repair import try_parse_json_robust


def _parse_tool_argument_value(raw_value: str) -> Any:
    """Best-effort parse for tool argument values embedded in text formats."""
    text = (raw_value or "").strip()
    if not text:
        return ""
    try:
        return try_parse_json_robust(text)
    except Exception:
        return text


def _normalize_gemini_tokens(value: str) -> str:
    """Normalize Gemini-style token markers to standard punctuation."""
    if not value:
        return value
    return (
        value.replace("<|“|>", '"')
        .replace("<|”|>", '"')
        .replace("<|‘|>", "'")
        .replace("<|’|>", "'")
    )


def _sanitize_visible_prose(content: str) -> str:
    """Return user-visible prose with model reasoning scaffolding removed.

    This is the canonical sanitizer for streamed and non-streamed assistant text.
    """
    if not content:
        return content

    had_channel_marker = bool(re.search(r"<\|?channel", content, re.IGNORECASE))
    had_leaked_thought_header = bool(
        re.search(
            r"<\|?channel\|?>\s*(thought|thinking|analysis|reasoning)\s*<\|?channel\|?>",
            content,
            re.IGNORECASE,
        )
    )

    cleaned = content

    # Remove complete reasoning blocks in common channel formats.
    cleaned = re.sub(
        r"<\|channel\|>\s*(analysis|thinking|thought|reasoning)\s*<\|message\|>.*?(?=(<\|channel\|>\s*final\s*<\|message\|>|$))",
        "",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Remove malformed channel headers like <|channel>thought<channel|>.
    cleaned = re.sub(
        r"<\|?channel\|?>\s*(?:analysis|thought|thinking|reasoning|final)\s*<\|?channel\|?>",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )

    # Remove inline thought/thinking sections (closed and unclosed).
    cleaned = re.sub(
        r"<(thought|thinking|think)>.*?</\1>",
        "",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )
    cleaned = re.sub(r"<(thought|thinking|think)>.*$", "", cleaned, flags=re.IGNORECASE)

    # Remove channel protocol tokens, keep actual prose.
    cleaned = re.sub(r"<\|?channel\|?>", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<\|?message\|?>", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<\|?start\|?>assistant", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<\|?end\|?>", "", cleaned, flags=re.IGNORECASE)

    if had_leaked_thought_header:
        boundary = cleaned.find("\n\n")
        if boundary >= 0:
            cleaned = cleaned[boundary + 2 :]
        elif "\n" in cleaned:
            return ""

    # If a marker label still leaks at the beginning, drop it and any following
    # line noise until paragraph boundary when available.
    prefix_match = re.match(
        r"^\s*(thought|thinking|analysis|reasoning|final)\b", cleaned, re.IGNORECASE
    )
    if prefix_match and had_channel_marker:
        boundary = cleaned.find("\n\n")
        if boundary >= 0:
            cleaned = cleaned[boundary + 2 :]
        else:
            cleaned = re.sub(
                r"^\s*(thought|thinking|analysis|reasoning|final)\s*",
                "",
                cleaned,
                flags=re.IGNORECASE,
            )

    # Drop standalone marker words left behind after token cleanup.
    if cleaned.strip().lower() in {
        "thought",
        "thinking",
        "think",
        "analysis",
        "reasoning",
        "final",
    }:
        return ""
    return cleaned


def _is_reasoning_channel(channel: str) -> bool:
    """Return True when channel name represents reasoning/thinking content."""
    value = (channel or "").strip().lower()
    return value in {"thinking", "thought", "analysis", "reasoning"}


def _parse_xml_style_tool_call(content_inner: str) -> tuple[str, dict[str, Any]] | None:
    """Parse legacy XML-like tool call bodies with optional parameter tags."""
    xml_match = re.search(
        r"<function=(\w+)>(.*?)</function>",
        content_inner,
        re.IGNORECASE | re.DOTALL,
    )
    if not xml_match:
        return None

    name = xml_match.group(1)
    function_body = (xml_match.group(2) or "").strip()
    param_matches = list(
        re.finditer(
            r"<parameter=([^>\s]+)>(.*?)</parameter>",
            function_body,
            re.IGNORECASE | re.DOTALL,
        )
    )
    if param_matches:
        args_obj: dict[str, Any] = {}
        for param_match in param_matches:
            param_name = str(param_match.group(1) or "").strip()
            if not param_name:
                continue
            param_value = _parse_tool_argument_value(param_match.group(2) or "")
            if param_name in args_obj:
                existing = args_obj[param_name]
                if isinstance(existing, list):
                    existing.append(param_value)
                else:
                    args_obj[param_name] = [existing, param_value]
            else:
                args_obj[param_name] = param_value
        return name, args_obj

    try:
        args_obj = try_parse_json_robust(function_body or "{}")
        if not isinstance(args_obj, dict):
            args_obj = {}
    except Exception:
        args_obj = {}
    return name, args_obj


def parse_tool_calls_from_content(content: str) -> list[dict] | None:
    """Parse tool calls from assistant content if not provided in structured format.

    Handles various formats like:
    - <tool_call>get_project_overview</tool_call>
    - <tool_call><function=get_project_overview></function></tool_call>
    - [TOOL_CALL]get_project_overview[/TOOL_CALL]
    - Tool: get_project_overview
    """

    calls = []

    # 1. Look for <tool_call> tags and Gemini-style <|tool_call|> wrappers
    pattern1 = r"(?:<tool_call>|<\|tool_call\>)(.*?)(?:</tool_call>|<\|tool_call\|>|<tool_call\|>)"
    matches1 = re.finditer(pattern1, content, re.IGNORECASE | re.DOTALL)

    for m in matches1:
        content_inner = m.group(1).strip()

        # Try JSON format: {"name": "...", "arguments": ...}
        if content_inner.startswith("{"):
            try:
                json_obj = try_parse_json_robust(content_inner)
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
        xml_call = _parse_xml_style_tool_call(content_inner)
        if xml_call:
            name, args_obj = xml_call

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

        # Try call:NAME{ARGS} format
        normalized_content = _normalize_gemini_tokens(content_inner)
        call_match = re.match(
            r"^call:(\w+)\s*\{(.*)\}\s*$", normalized_content, re.DOTALL
        )
        if call_match:
            name = call_match.group(1)
            args_str = call_match.group(2).strip()
            args_obj: dict[str, Any] = {}
            if args_str:
                try:
                    args_obj = try_parse_json_robust(f"{{{args_str}}}")
                    if not isinstance(args_obj, dict):
                        args_obj = {}
                except Exception:
                    try:
                        quoted_args = re.sub(r"([A-Za-z0-9_]+)\s*:", r'"\1":', args_str)
                        args_obj = try_parse_json_robust(f"{{{quoted_args}}}")
                        if not isinstance(args_obj, dict):
                            args_obj = {}
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
                args_obj = try_parse_json_robust(args_str)
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
            args_obj = try_parse_json_robust(args_str) if args_str != "{}" else {}
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
            args_obj = try_parse_json_robust(args_str)
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
        # Fall back to stripping analysis sections when the stream terminates
        # before a final channel block is emitted.
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

    content = _sanitize_visible_prose(content)

    return content.strip()


def strip_tool_call_tags(content: str) -> str:
    """Strip inline tool-call markup from assistant content."""
    if not content:
        return content
    content = re.sub(r"<tool_call>.*?</tool_call>", "", content, flags=re.DOTALL)
    content = re.sub(
        r"<\|tool_call\>.*?(?:<\|tool_call\|>|<tool_call\|>)",
        "",
        content,
        flags=re.DOTALL,
    )
    content = re.sub(
        r"\[TOOL_CALL\]\s*.*?\s*\[/TOOL_CALL\]",
        "",
        content,
        flags=re.DOTALL,
    )
    return content.strip()


def extract_thinking_from_content(content: str) -> str:
    """Extract first thinking/thought block content from assistant text."""
    if not content:
        return ""

    match = re.search(
        r"<(thought|thinking|think)>(.*?)</\1>",
        content,
        re.DOTALL | re.IGNORECASE,
    )
    if not match:
        return ""
    return (match.group(2) or "").strip()


def parse_complete_assistant_output(
    content: str,
    structured_tool_calls: list[dict] | None = None,
    extra_tool_call_content: str = "",
) -> dict[str, Any]:
    """Parse complete assistant output into normalized content/tool_calls/thinking."""
    tool_calls = list(structured_tool_calls or [])
    parsed_calls = parse_tool_calls_from_content(content or "") or []
    if parsed_calls:
        tool_calls.extend(parsed_calls)
    extra_calls = parse_tool_calls_from_content(extra_tool_call_content or "") or []
    if extra_calls:
        tool_calls.extend(extra_calls)

    thinking = extract_thinking_from_content(content or "")
    cleaned_content = strip_tool_call_tags(strip_thinking_tags(content or ""))
    return {
        "content": cleaned_content,
        "tool_calls": tool_calls,
        "thinking": thinking,
    }


def normalize_tool_channel_name(name: str) -> str:
    """Normalize channel-derived function names to registered tool names."""
    cleaned = (name or "").strip()
    if cleaned.startswith("functions."):
        cleaned = cleaned.split("functions.", 1)[1]
    return cleaned


def parse_stream_channel_fragments(
    fragments: list[dict[str, str]],
    sent_tool_call_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Convert ChannelFilter fragments to normalized stream events."""
    events: list[dict[str, Any]] = []
    seen_ids = sent_tool_call_ids if sent_tool_call_ids is not None else set()

    for fragment in fragments:
        channel = fragment.get("channel", "")
        piece = fragment.get("content", "")
        if not piece and channel != "tool_def":
            continue

        if _is_reasoning_channel(channel):
            if piece:
                events.append({"thinking": piece})
            continue

        if channel.startswith("commentary to="):
            func_name = normalize_tool_channel_name(
                channel.split("commentary to=", 1)[1].strip()
            )
            if not func_name:
                continue
            call_id = f"call_{func_name}"
            if call_id in seen_ids:
                continue
            seen_ids.add(call_id)
            events.append(
                {
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {"name": func_name, "arguments": piece},
                        }
                    ]
                }
            )
            continue

        if channel.startswith("call:"):
            func_name = normalize_tool_channel_name(channel[5:])
            if not func_name:
                continue
            call_id = f"call_{func_name}"
            if call_id in seen_ids:
                continue
            seen_ids.add(call_id)
            events.append(
                {
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {"name": func_name, "arguments": piece},
                        }
                    ]
                }
            )
            continue

        if channel == "tool_def":
            continue

        piece_lower = piece.lower()
        has_tool_syntax = (
            "<tool_call" in piece_lower
            or "<|tool_call" in piece_lower
            or "[tool_call" in piece_lower
            or piece_lower.strip().startswith("tool:")
            or piece_lower.strip().startswith("call:")
        )
        if has_tool_syntax:
            parsed_calls = parse_tool_calls_from_content(piece) or []
            if parsed_calls:
                new_calls = [c for c in parsed_calls if c.get("id") not in seen_ids]
                if new_calls:
                    for call in new_calls:
                        call_id = call.get("id")
                        if isinstance(call_id, str):
                            seen_ids.add(call_id)
                    events.append({"tool_calls": new_calls})
                continue

        cleaned_piece = _sanitize_visible_prose(piece)
        if cleaned_piece is None or cleaned_piece == "":
            continue
        if cleaned_piece.strip().lower() in {
            "thought",
            "thinking",
            "think",
            "analysis",
        }:
            continue
        events.append({"content": cleaned_piece})

    return events
