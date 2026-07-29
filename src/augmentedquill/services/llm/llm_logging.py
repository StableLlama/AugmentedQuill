# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the llm logging unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import ast
import copy
import datetime
import uuid
import os
import json
from typing import Any, Dict, List

# Global list to store LLM communication logs for the current session
llm_logs: List[Dict[str, Any]] = []


def get_caller_origin(caller_id: str | None) -> str:
    """Derive a human-friendly source label from caller_id for diagnostics."""
    if not caller_id:
        return "Unknown"
    if caller_id.startswith("api."):
        return "User request"
    internal_patterns = [
        "story_generation",
        "sourcebook.",
        "chat_tools.",
        "llm_utils.",
        "settings_machine.",
        "story_api_stream.",
        "chat_api_proxy.",
    ]
    if any(caller_id.startswith(p) for p in internal_patterns):
        return "Internal workflow"
    return "Internal"


def get_llm_dump_level() -> str:
    """Get LLM dump verbosity level."""
    level = os.getenv("AUGQ_LLM_DUMP_LEVEL", "compact").strip().lower()
    if level not in {"compact", "normal", "debug"}:
        return "compact"
    return level


def _extract_chunk_text(chunk: Any) -> str:
    """Extract human-friendly text from a streaming chunk payload."""
    if isinstance(chunk, dict):
        if "content" in chunk and isinstance(chunk["content"], str):
            return chunk["content"]
        if "text" in chunk and isinstance(chunk["text"], str):
            return chunk["text"]
        if "delta" in chunk and isinstance(chunk["delta"], dict):
            delta = chunk["delta"]
            if "content" in delta and isinstance(delta["content"], str):
                return delta["content"]
            if "text" in delta and isinstance(delta["text"], str):
                return delta["text"]

        if "choices" in chunk and isinstance(chunk["choices"], list):
            parts = []
            for choice in chunk["choices"]:
                if isinstance(choice, dict):
                    delta = choice.get("delta")
                    if isinstance(delta, dict):
                        if "content" in delta and isinstance(delta["content"], str):
                            parts.append(delta["content"])
                        elif "text" in delta and isinstance(delta["text"], str):
                            parts.append(delta["text"])
                    else:
                        # completions endpoint: text is directly on the choice
                        if "content" in choice and isinstance(choice["content"], str):
                            parts.append(choice["content"])
                        elif "text" in choice and isinstance(choice["text"], str):
                            parts.append(choice["text"])
            if parts:
                return "".join(parts)

        # No meaningful text content for this chunk; skip it from normal previews.
        return None

    if isinstance(chunk, str):
        chunk = chunk.strip()
        if not chunk:
            return None
        if chunk.startswith("id=") and "object=" in chunk:
            # this is metadata-only, not actual content.
            return None
        # try to parse as JSON/py dict to extract content
        try:
            obj = json.loads(chunk)
            return _extract_chunk_text(obj)
        except Exception:
            try:
                obj = ast.literal_eval(chunk)
                if isinstance(obj, dict):
                    return _extract_chunk_text(obj)
            except Exception:
                pass
        return chunk
    return None


def _prepare_dump_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Prepare an entry for file dump based on verbosity level."""
    verbosity = get_llm_dump_level()
    prepared = copy.deepcopy(entry)

    if "request" in prepared and isinstance(prepared["request"], dict):
        # Strip headers in all modes (already redacted but cleaner to remove entirely)
        prepared["request"].pop("headers", None)

    response = prepared.get("response")
    if isinstance(response, dict):
        if response.get("streaming"):
            chunks = response.get("chunks") or []
            # Always record how many raw chunks were received
            if chunks:
                response["chunk_count"] = len(chunks)
            elif "chunk_count" not in response:
                response["chunk_count"] = 0

            if verbosity == "compact":
                # compact: chunk_count + full_content (assembled text), no raw chunks, no HTTP-level meta
                response.pop("chunks", None)
                response.pop("body", None)
                response.pop("error_detail", None)
                # full_content stays intact (complete assembled text)

            elif verbosity == "normal":
                # normal: text-token list only — no raw chunk objects, no full_content
                preview = []
                for chunk in chunks:
                    chunk_text = _extract_chunk_text(chunk)
                    if chunk_text is not None:
                        # preserve as-is: keep newlines and whitespace, no truncation
                        preview.append(chunk_text)

                # Fallback: if chunks were not stored but full_content was, split by lines
                if not chunks and response.get("full_content"):
                    preview = response["full_content"].splitlines(keepends=True)

                # Second fallback: chunks present but no text extracted (e.g. unknown format),
                # use full_content if available so the log always shows what was generated.
                if not preview and response.get("full_content"):
                    preview = response["full_content"].splitlines(keepends=True)

                response["chunk_text_preview"] = preview
                response.pop("chunks", None)
                response.pop("full_content", None)

            # debug: keep everything (raw chunks, full_content, body, error_detail) — no preview added

        # non-streaming: communication content (body, full_content) preserved in all modes

    prepared["response"] = response
    return prepared


def add_llm_log(log_entry: Dict[str, Any]) -> Any:
    """Add a log entry to the global list, keeping only the last 100 entries.

    If AUGQ_LLM_DUMP is set, also append the raw log to a file.

    This function stores a deep copy so future in-place modifications to the
    original log entry do not mutate the logged history shown in the debug UI.

    For entries with existing IDs, replace the old entry so the same request
    doesn't appear twice (start+finalize logging uses the same id).
    """
    entry_copy = copy.deepcopy(log_entry)
    caller_id = entry_copy.get("caller_id")
    if caller_id and not entry_copy.get("caller_origin"):
        entry_copy["caller_origin"] = get_caller_origin(caller_id)
    entry_id = entry_copy.get("id")

    if entry_id:
        for idx, existing in enumerate(llm_logs):
            if existing.get("id") == entry_id:
                llm_logs[idx] = entry_copy
                break
        else:
            llm_logs.append(entry_copy)
    else:
        llm_logs.append(entry_copy)

    if len(llm_logs) > 100:
        llm_logs.pop(0)

    # Raw logging to file if enabled — only write complete (finalized) entries.
    # Pending start entries are kept in-memory only; writing them would create
    # confusing duplicate pairs in the log file.
    if os.getenv("AUGQ_LLM_DUMP") == "1" and entry_copy.get("timestamp_end"):
        default_path = os.path.join("data", "logs", "llm_raw.log")
        log_path = os.getenv("AUGQ_LLM_DUMP_PATH") or default_path
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        try:
            # Apply level-dependent compression before dump
            processed_entry = _prepare_dump_entry(entry_copy)
            processed_entry = json.loads(json.dumps(processed_entry, default=str))
            if (
                isinstance(processed_entry, dict)
                and "caller_id" in processed_entry
                and "caller_origin" not in processed_entry
            ):
                processed_entry["caller_origin"] = get_caller_origin(
                    processed_entry.get("caller_id")
                )

            # If there are tools in the request body, collapse them
            collapsed_tools = []
            if (
                isinstance(processed_entry, dict)
                and "request" in processed_entry
                and isinstance(processed_entry["request"], dict)
                and "body" in processed_entry["request"]
                and isinstance(processed_entry["request"]["body"], dict)
                and "tools" in processed_entry["request"]["body"]
            ):
                tools = processed_entry["request"]["body"]["tools"]
                if isinstance(tools, list):
                    for tool in tools:
                        collapsed_tools.append(json.dumps(tool, default=str))
                    # Replace with the collapsed string list for the final JSON dump
                    processed_entry["request"]["body"]["tools"] = collapsed_tools

            with open(log_path, "a", encoding="utf-8") as f:
                f.write("=" * 80 + "\n")
                f.write(f"TIMESTAMP: {datetime.datetime.now().isoformat()}\n")
                f.write("-" * 80 + "\n")

                # Render JSON
                log_text = json.dumps(processed_entry, indent=2, default=str)

                # Post-process to unquote and unescape the collapsed tool strings so they appear as flat JSON lines
                if "request" in processed_entry and collapsed_tools:
                    # Look for the strings we just created that start with tool markers
                    # This is a bit hacky but keeps the output valid JSON-ish and very readable
                    for tool in collapsed_tools:
                        quoted_tool = json.dumps(tool)
                        log_text = log_text.replace(quoted_tool, tool)

                f.write(log_text + "\n")
                f.write("=" * 80 + "\n\n")
        except Exception:
            # Silently fail if log cannot be written (dev-only feature)
            pass


def create_log_entry(
    url: str,
    method: str,
    headers: Dict[str, str],
    body: Any,
    streaming: bool = False,
    include_response: bool = True,
) -> Dict[str, Any]:
    """Create a new log entry structure.

    The returned dictionary is the shape that gets stored in ``llm_logs`` along
    with the timestamp.  By default a ``response`` object is included,
    pre‑populated with placeholders for the status, body, etc.  When
    ``include_response`` is ``False`` (used for the initial "request started"
    entry) we instead set the field to ``None`` so that the resulting log is
    easier to read and doesn't misleadingly show an empty response object.
    The caller is responsible for constructing the response later when the
    response is actually available.
    """

    safe_body = body
    if isinstance(body, dict):
        safe_body = copy.deepcopy(body)
        for key in ["api_key", "secret", "password"]:
            if key in safe_body:
                safe_body[key] = "REDACTED"

    entry: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "timestamp_start": datetime.datetime.now().isoformat(),
        "timestamp_end": None,
        "request": {
            "url": url,
            "method": method,
            "headers": {
                k: ("***" if k.lower() in ("authorization", "x-api-key") else v)
                for k, v in headers.items()
            },
            "body": safe_body,
        },
    }

    if include_response:
        entry["response"] = {
            "status_code": None,
            "streaming": streaming,
            "chunks": [] if streaming else None,
            "full_content": "" if streaming else None,
            "body": None if not streaming else None,
            "error_detail": None,
        }
    else:
        entry["response"] = None

    return entry
