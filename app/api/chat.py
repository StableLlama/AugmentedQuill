# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import httpx
import datetime
import re
import base64
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import load_machine_config, load_story_config, save_story_config
from app.projects import (
    get_active_project_dir,
    write_chapter_content,
    write_chapter_summary,
    write_chapter_title,
    create_project,
    list_projects,
    delete_project,
    read_story_content,
    write_story_content,
    update_story_metadata,
    read_book_content,
    write_book_content,
    update_book_metadata,
    list_chats,
    load_chat,
    save_chat,
    delete_chat,
)
from app.helpers.project_helpers import _project_overview, _chapter_content_slice
from app.helpers.chapter_helpers import (
    _chapter_by_id_or_404,
)
from app.helpers.story_helpers import (
    _story_generate_summary_helper,
    _story_write_helper,
    _story_continue_helper,
)
from app.helpers.sourcebook_helpers import (
    sb_search,
    sb_get,
    sb_create,
    sb_delete,
    sb_update,
)
from app.prompts import get_system_message, load_model_prompt_overrides
from app.llm import add_llm_log, create_log_entry, finalize_llm_log_entry
import json as _json
from typing import Any, Dict

from pathlib import Path


from app.helpers.stream_helpers import ChannelFilter

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = BASE_DIR / "config"

router = APIRouter()

# Prefer using `app.main.load_machine_config` when available so tests can monkeypatch it.
try:
    import app.main as _app_main  # type: ignore
except Exception:
    _app_main = None


def _load_machine_config(path):
    if _app_main and hasattr(_app_main, "load_machine_config"):
        return _app_main.load_machine_config(path)
    return load_machine_config(path)


def _normalize_tool_name(name: str) -> str:
    cleaned = name.strip()
    if cleaned.startswith("functions."):
        cleaned = cleaned.split("functions.", 1)[1]
    return cleaned


def _parse_tool_calls_from_content(content: str) -> list[dict] | None:
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
    pattern2 = r"\[TOOL_CALL\](.*?)\[/TOOL_CALL\]"
    matches2 = re.finditer(pattern2, content, re.IGNORECASE | re.DOTALL)

    for m in matches2:
        content_inner = m.group(1).strip()
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

    # 5. Look for assistantcommentary tool-call text variants
    pattern5 = (
        r"(?:\b\w+\.)?assistantcommentary\s+to=functions\.(\w+)" r"\s+json\s*(\{.*\})"
    )
    matches5 = re.finditer(pattern5, content, re.IGNORECASE | re.DOTALL)

    for m in matches5:
        name = m.group(1)
        args_str = m.group(2).strip() if m.group(2) else "{}"
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


def _sanitize_analysis_prefix(content: str) -> str:
    if not content:
        return content
    stripped = content.lstrip()
    if not stripped:
        return content
    lowered = stripped.lower()
    if lowered.startswith("analysis"):
        remainder = lowered[len("analysis") :]
        remainder_raw = stripped[len("analysis") :]
        looks_like_prefix = not remainder or remainder[0] in (":", " ", "\n", "\t")
        glued_prefix = (
            remainder_raw and remainder_raw[0].isalpha() and remainder_raw[0].isupper()
        )
        if looks_like_prefix or glued_prefix:
            if re.search(
                r"\b(the user|we need|use|get_|tool|call|should|need to)\b",
                lowered,
            ):
                return stripped[len("analysis") :].lstrip(" :\n\t")
    return content


def _parse_tool_syntax(content: str) -> tuple[str, list[dict] | None]:
    if not content:
        return content, None

    content_lower = content.lower()
    has_tool_syntax = (
        "<tool_call" in content_lower
        or "[tool_call" in content_lower
        or content_lower.startswith("tool:")
        or "commentary to=functions." in content_lower
        or "assistantcommentary to=functions." in content_lower
        or ".assistantcommentary to=functions." in content_lower
        or "<|channel|>commentary" in content_lower
    )

    parsed_tool_calls = (
        _parse_tool_calls_from_content(content) if has_tool_syntax else None
    )

    if not has_tool_syntax:
        return _sanitize_analysis_prefix(content), parsed_tool_calls

    clean_content = re.sub(
        r"<tool_call>(.*?)</tool_call>",
        "",
        content,
        flags=re.IGNORECASE | re.DOTALL,
    )
    clean_content = re.sub(
        r"<tool_call[^>]*>",
        "",
        clean_content,
        flags=re.IGNORECASE,
    )
    clean_content = re.sub(
        r"</tool_call>",
        "",
        clean_content,
        flags=re.IGNORECASE,
    )
    clean_content = re.sub(
        r"\[TOOL_CALL\](.*?)\[/TOOL_CALL\]",
        "",
        clean_content,
        flags=re.IGNORECASE | re.DOTALL,
    )
    clean_content = re.sub(
        r"^Tool:\s*(\w+)(?:\(([^)]*)\))?",
        "",
        clean_content,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    clean_content = re.sub(
        r"<tool_call[^>]*$",
        "",
        clean_content,
        flags=re.IGNORECASE,
    )
    clean_content = re.sub(
        r"\[TOOL_CALL\][^\[]*$",
        "",
        clean_content,
        flags=re.IGNORECASE,
    )
    clean_content = re.sub(
        r"(?:\b\w+\.)?assistantcommentary\s+to=functions\.\w+\s+json\s*\{.*\}",
        "",
        clean_content,
        flags=re.IGNORECASE | re.DOTALL,
    )
    clean_content = clean_content.strip()
    if (
        "commentary to=functions." in content_lower
        or "assistantcommentary to=functions." in content_lower
        or ".assistantcommentary to=functions." in content_lower
    ):
        clean_content = ""

    return _sanitize_analysis_prefix(clean_content), parsed_tool_calls


READING_TOOL_NAMES = {
    "get_project_overview",
    "get_story_summary",
    "get_story_metadata",
    "get_story_tags",
    "read_story_content",
    "get_book_metadata",
    "read_book_content",
    "search_sourcebook",
    "get_sourcebook_entry",
    "get_chapter_metadata",
    "list_images",
    "get_chapter_summaries",
    "get_chapter_content",
    "get_chapter_heading",
    "get_chapter_summary",
    "list_projects",
}

MODIFYING_TOOL_NAMES = {
    "update_story_summary",
    "update_story_metadata",
    "set_story_tags",
    "write_story_content",
    "update_book_metadata",
    "write_book_content",
    "create_sourcebook_entry",
    "update_sourcebook_entry",
    "delete_sourcebook_entry",
    "update_chapter_metadata",
    "add_chapter_conflict",
    "update_chapter_conflict",
    "remove_chapter_conflict",
    "reorder_chapter_conflicts",
    "generate_image_description",
    "create_image_placeholder",
    "set_image_metadata",
    "write_chapter_content",
    "write_chapter_summary",
    "create_new_chapter",
    "sync_summary",
    "write_chapter",
    "continue_chapter",
    "sync_story_summary",
    "write_story_summary",
    "write_chapter_heading",
    "create_project",
    "delete_project",
    "delete_book",
    "delete_chapter",
    "create_new_book",
    "change_project_type",
    "reorder_chapters",
    "reorder_books",
}


def _filter_chat_history(messages: list[dict]) -> list[dict]:
    """Optimize chat history by removing invalidated reading calls and modifying calls.

    Strategy:
    - If a modifying tool is encountered, all previous reading tool calls and responses are removed.
    - Also binary pairs of (assistant with tool_call, tool response) for modifying tools are removed.
    """
    indices_to_remove = set()
    tcalls_to_remove = set()  # (msg_idx, tcall_id)

    reading_calls = []  # List of (msg_idx, tcall_id)
    reading_responses = []  # List of msg_idx

    # Map tool_call_id to its name for later reference in tool responses
    tcall_id_to_name = {}

    for i, msg in enumerate(messages):
        role = msg.get("role")

        if role == "assistant":
            tcalls = msg.get("tool_calls") or []
            for tc in tcalls:
                tid = tc.get("id")
                func = tc.get("function") or {}
                name = func.get("name")
                if tid:
                    tcall_id_to_name[tid] = name

                if name in MODIFYING_TOOL_NAMES:
                    # Mark THIS call for removal
                    tcalls_to_remove.add((i, tid))

                    # Mark ALL PREVIOUS reading calls and responses for removal
                    for r_msg_idx, r_tid in reading_calls:
                        tcalls_to_remove.add((r_msg_idx, r_tid))
                    for r_resp_idx in reading_responses:
                        indices_to_remove.add(r_resp_idx)

                    # Reset reading tracking
                    reading_calls = []
                    reading_responses = []

                elif name in READING_TOOL_NAMES:
                    reading_calls.append((i, tid))

        elif role == "tool":
            tid = msg.get("tool_call_id")
            name = msg.get("name") or tcall_id_to_name.get(tid)

            if name in MODIFYING_TOOL_NAMES:
                indices_to_remove.add(i)
                # Mark ALL PREVIOUS reading calls and responses for removal
                for r_msg_idx, r_tid in reading_calls:
                    tcalls_to_remove.add((r_msg_idx, r_tid))
                for r_resp_idx in reading_responses:
                    indices_to_remove.add(r_resp_idx)

                # Reset reading tracking
                reading_calls = []
                reading_responses = []
            elif name in READING_TOOL_NAMES:
                reading_responses.append(i)

    # Build final list
    result = []
    for i, msg in enumerate(messages):
        if i in indices_to_remove:
            continue

        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            new_tcalls = [
                tc
                for tc in msg["tool_calls"]
                if (i, tc.get("id")) not in tcalls_to_remove
            ]
            if not new_tcalls:
                if not msg.get("content"):
                    continue
                new_msg = msg.copy()
                del new_msg["tool_calls"]
                result.append(new_msg)
            else:
                new_msg = msg.copy()
                new_msg["tool_calls"] = new_tcalls
                result.append(new_msg)
        else:
            result.append(msg)

    return result


STORY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_project_overview",
            "description": "Get project title, type, and list of all chapters (novels) or books (series). Use this to find numeric chapter IDs and UUID book IDs. Never assume an ID.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]

WEB_SEARCH_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for real-world information. NOTE: This returns snippets only. You MUST subsequently call 'visit_page' on the top 1-3 relevant URLs to get the actual content needed for your answer.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query."},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "visit_page",
            "description": "Visit a specific web page by URL and extract its main content as text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL of the page to visit.",
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "wikipedia_search",
            "description": "Search Wikipedia for factual information. You MUST subsequently call 'visit_page' on the result URLs to read the full article content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search term."},
                },
                "required": ["query"],
            },
        },
    },
]

STORY_TOOLS += [
    {
        "type": "function",
        "function": {
            "name": "get_story_summary",
            "description": "Get the overall story title, summary, notes, and tags.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_story_metadata",
            "description": "Update the story title, summary, notes, tags, or conflicts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "New story title."},
                    "summary": {"type": "string", "description": "New story summary."},
                    "notes": {"type": "string", "description": "New story notes."},
                    "private_notes": {
                        "type": "string",
                        "description": "New private/internal notes.",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "New style tags.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_chapter_metadata",
            "description": "Get the title, summary, notes, and conflicts of a chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "Numeric chapter ID.",
                    }
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_chapter_metadata",
            "description": "Update the title, summary, or notes of a chapter. For conflicts, use add_chapter_conflict, update_chapter_conflict, remove_chapter_conflict, or reorder_chapter_conflicts for better control.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "Numeric chapter ID.",
                    },
                    "title": {"type": "string", "description": "New chapter title."},
                    "summary": {
                        "type": "string",
                        "description": "New chapter summary.",
                    },
                    "notes": {"type": "string", "description": "AI-visible notes."},
                    "private_notes": {
                        "type": "string",
                        "description": "Internal (private) notes.",
                    },
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_chapter_conflict",
            "description": "Add a new conflict to a chapter. Selective edit: only one or a few can be added at a time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {"type": "integer", "description": "Chapter ID."},
                    "description": {
                        "type": "string",
                        "description": "Description of the conflict.",
                    },
                    "resolution": {
                        "type": "string",
                        "description": "Planned resolution.",
                    },
                    "index": {
                        "type": "integer",
                        "description": "Optional index for insertion (defaults to end).",
                    },
                },
                "required": ["chap_id", "description", "resolution"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_chapter_conflict",
            "description": "Update an existing conflict in a chapter by its index.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {"type": "integer", "description": "Chapter ID."},
                    "index": {
                        "type": "integer",
                        "description": "Index of the conflict to update.",
                    },
                    "description": {
                        "type": "string",
                        "description": "New description (optional).",
                    },
                    "resolution": {
                        "type": "string",
                        "description": "New resolution (optional).",
                    },
                },
                "required": ["chap_id", "index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_chapter_conflict",
            "description": "Remove a conflict from a chapter by its index.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {"type": "integer", "description": "Chapter ID."},
                    "index": {
                        "type": "integer",
                        "description": "Index of the conflict to remove.",
                    },
                },
                "required": ["chap_id", "index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reorder_chapter_conflicts",
            "description": "Reorder conflicts by providing the new list of indices.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {"type": "integer", "description": "Chapter ID."},
                    "new_indices": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "The new sequence of old indices.",
                    },
                },
                "required": ["chap_id", "new_indices"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_chapter_summaries",
            "description": "Get summaries of all chapters in the project.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_chapter_content",
            "description": "Read a slice of a chapter's content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "Numeric chapter ID.",
                    },
                    "start": {
                        "type": "integer",
                        "description": "Start index (default 0).",
                    },
                    "max_chars": {
                        "type": "integer",
                        "description": "Max chars (max 8000).",
                    },
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_chapter_content",
            "description": "Set the full content of a chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "Numeric chapter ID.",
                    },
                    "content": {"type": "string", "description": "New content."},
                },
                "required": ["chap_id", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_new_chapter",
            "description": "Create a new chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Optional title."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_story_content",
            "description": "Read the story introductory content.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_story_content",
            "description": "Update the story introductory content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "New content."},
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_images",
            "description": "List all project images.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sync_summary",
            "description": "Auto-generate a summary for a chapter from its content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "Numeric chapter ID.",
                    },
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_image_description",
            "description": "Generate a detailed description for an existing image.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "The image filename."}
                },
                "required": ["filename"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_image_placeholder",
            "description": "Create a new image placeholder with a description.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "Image subject and style.",
                    },
                    "title": {"type": "string", "description": "Short title."},
                },
                "required": ["description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_image_metadata",
            "description": "Update an image title or description.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Image filename."},
                    "title": {"type": "string", "description": "New title."},
                    "description": {
                        "type": "string",
                        "description": "New description.",
                    },
                },
                "required": ["filename"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_sourcebook",
            "description": "Search the sourcebook (world info, characters, locations) for a query.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query."}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_sourcebook_entry",
            "description": "Get a specific sourcebook entry by name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name_or_id": {"type": "string", "description": "Entry name."}
                },
                "required": ["name_or_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_sourcebook_entry",
            "description": "Create a new sourcebook entry.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Entry name."},
                    "description": {
                        "type": "string",
                        "description": "Entry description.",
                    },
                    "category": {
                        "type": "string",
                        "description": "Optional category (Character, Location, etc.).",
                    },
                    "synonyms": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional synonyms.",
                    },
                },
                "required": ["name", "description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_sourcebook_entry",
            "description": "Update an existing sourcebook entry.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name_or_id": {
                        "type": "string",
                        "description": "Current entry name.",
                    },
                    "name": {"type": "string", "description": "New name (optional)."},
                    "description": {
                        "type": "string",
                        "description": "New description (optional).",
                    },
                    "category": {
                        "type": "string",
                        "description": "New category (optional).",
                    },
                    "synonyms": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "New synonyms (optional).",
                    },
                },
                "required": ["name_or_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_sourcebook_entry",
            "description": "Remove a sourcebook entry.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name_or_id": {
                        "type": "string",
                        "description": "Entry name to delete.",
                    }
                },
                "required": ["name_or_id"],
            },
        },
    },
]


async def _tool_generate_image_description(filename: str, payload: dict) -> str:
    from app import llm
    from app.helpers.image_helpers import get_images_dir, update_image_metadata

    # Check if image exists
    images_dir = get_images_dir()
    if not images_dir:
        return "Error: No active project."

    # Filename might be a path, sanitize it
    filename = Path(filename).name
    img_path = images_dir / filename

    if not img_path.exists():
        return f"Error: Image {filename} does not exist on disk."

    # Prepare request to EDIT LLM
    base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
        payload, model_type="EDITING"
    )

    try:
        mime_type = "image/png"
        s = img_path.suffix.lower()
        if s in [".jpg", ".jpeg"]:
            mime_type = "image/jpeg"
        elif s == ".webp":
            mime_type = "image/webp"
        elif s == ".gif":
            mime_type = "image/gif"

        with open(img_path, "rb") as f:
            base64_image = base64.b64encode(f.read()).decode("utf-8")

        messages = [
            {
                "role": "system",
                "content": "You are a helpful assistant that describes images. Provide a detailed description of the image.",
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Describe this image."},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{base64_image}"},
                    },
                ],
            },
        ]

        data = await llm.openai_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )

        choices = (data or {}).get("choices") or []
        if choices:
            msg = choices[0].get("message")
            content = msg.get("content") if msg else ""
            if content:
                # Save description
                update_image_metadata(filename, description=content)
                return content
        return "Error: Failed to generate description."

    except Exception as e:
        return f"Error generating description: {str(e)}"


async def _exec_chat_tool(
    name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict
) -> dict:
    """Helper to execute a single tool call."""
    try:
        if name == "get_project_overview":
            data = _project_overview()
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }

        if name == "get_story_summary" or name == "get_story_metadata":
            active = get_active_project_dir()
            story = load_story_config((active / "story.json") if active else None) or {}
            val = {
                "title": story.get("project_title", ""),
                "summary": story.get("story_summary", ""),
                "notes": story.get("notes", ""),
                "private_notes": story.get("private_notes", ""),
                "tags": story.get("tags", []),
                "project_type": story.get("project_type", "novel"),
            }
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(val),
            }

        if name == "update_story_summary" or name == "update_story_metadata":
            title = args_obj.get("title")
            summary = args_obj.get("summary")
            notes = args_obj.get("notes")
            private_notes = args_obj.get("private_notes")
            tags = args_obj.get("tags")

            try:
                update_story_metadata(
                    title=title,
                    summary=summary,
                    notes=notes,
                    private_notes=private_notes,
                    tags=tags,
                )
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"ok": True}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "read_story_content":
            try:
                content = read_story_content()
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"content": content}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "write_story_content":
            content = args_obj.get("content", "")

            try:
                write_story_content(content)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"ok": True}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "get_book_metadata":
            book_id = args_obj.get("book_id")
            active = get_active_project_dir()
            story = load_story_config((active / "story.json") if active else None) or {}
            books = story.get("books", [])
            target = next(
                (
                    b
                    for b in books
                    if (b.get("id") == book_id or b.get("folder") == book_id)
                ),
                None,
            )
            if not target:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": f"Book ID {book_id} not found"}),
                }
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(
                    {
                        "title": target.get("title", ""),
                        "summary": target.get("summary", ""),
                        "notes": target.get("notes", ""),
                    }
                ),
            }

        if name == "update_book_metadata":
            book_id = args_obj.get("book_id")
            title = args_obj.get("title")
            summary = args_obj.get("summary")
            notes = args_obj.get("notes")

            try:
                update_book_metadata(book_id, title=title, summary=summary, notes=notes)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"ok": True}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "read_book_content":
            book_id = args_obj.get("book_id")

            try:
                content = read_book_content(book_id)
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"content": content}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "write_book_content":
            book_id = args_obj.get("book_id")
            content = args_obj.get("content", "")

            try:
                write_book_content(book_id, content)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"ok": True}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "search_sourcebook":
            query = args_obj.get("query", "")
            results = sb_search(query)
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(results),
            }

        if name == "get_sourcebook_entry":
            name_or_id = args_obj.get("name_or_id", "")
            entry = sb_get(name_or_id)
            if not entry:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "Not found"}),
                }
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(entry),
            }

        if name == "create_sourcebook_entry":
            new_entry = sb_create(
                name=args_obj.get("name"),
                description=args_obj.get("description"),
                category=args_obj.get("category"),
                synonyms=args_obj.get("synonyms", []),
            )
            if "error" not in new_entry:
                mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(new_entry),
            }

        if name == "update_sourcebook_entry":
            result = sb_update(
                name_or_id=args_obj.get("name_or_id"),
                name=args_obj.get("name"),
                description=args_obj.get("description"),
                category=args_obj.get("category"),
                synonyms=args_obj.get("synonyms"),
            )
            if "error" not in result:
                mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(result),
            }

        if name == "delete_sourcebook_entry":
            name_or_id = args_obj.get("name_or_id")
            deleted = sb_delete(name_or_id)
            if deleted:
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"ok": True}),
                }
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"error": "Not found"}),
            }

        if name == "get_chapter_metadata":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            from app.helpers.chapter_helpers import _get_chapter_metadata_entry

            active = get_active_project_dir()
            story = load_story_config((active / "story.json") if active else None) or {}
            _, path, _ = _chapter_by_id_or_404(chap_id)
            meta = _get_chapter_metadata_entry(story, chap_id, path) or {}
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(
                    {
                        "title": meta.get("title", "") or path.name,
                        "summary": meta.get("summary", ""),
                        "notes": meta.get("notes", ""),
                        "conflicts": meta.get("conflicts") or [],
                    }
                ),
            }

        if name == "update_chapter_metadata":
            chap_id = args_obj.get("chap_id")
            title = args_obj.get("title")
            summary = args_obj.get("summary")
            notes = args_obj.get("notes")
            private_notes = args_obj.get("private_notes")

            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }

            try:
                from app.projects import update_chapter_metadata

                update_chapter_metadata(
                    chap_id,
                    title=title,
                    summary=summary,
                    notes=notes,
                    private_notes=private_notes,
                )
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"ok": True}),
                }

            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "add_chapter_conflict":
            chap_id = args_obj.get("chap_id")
            description = args_obj.get("description")
            resolution = args_obj.get("resolution")
            index = args_obj.get("index")
            try:
                from app.projects import add_chapter_conflict

                add_chapter_conflict(chap_id, description, resolution, index)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"ok": True}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "update_chapter_conflict":
            chap_id = args_obj.get("chap_id")
            index = args_obj.get("index")
            description = args_obj.get("description")
            resolution = args_obj.get("resolution")
            try:
                from app.projects import update_chapter_conflict

                update_chapter_conflict(chap_id, index, description, resolution)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"ok": True}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "remove_chapter_conflict":
            chap_id = args_obj.get("chap_id")
            index = args_obj.get("index")
            try:
                from app.projects import remove_chapter_conflict

                remove_chapter_conflict(chap_id, index)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"ok": True}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "reorder_chapter_conflicts":
            chap_id = args_obj.get("chap_id")
            new_indices = args_obj.get("new_indices")
            try:
                from app.projects import reorder_chapter_conflicts

                reorder_chapter_conflicts(chap_id, new_indices)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"ok": True}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "list_images":
            from app.helpers.image_helpers import get_project_images

            imgs = get_project_images()
            simple = [
                {
                    "filename": i["filename"],
                    "description": i["description"],
                    "title": i.get("title", ""),
                    "is_placeholder": i["is_placeholder"],
                }
                for i in imgs
            ]
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(simple),
            }
        if name == "generate_image_description":
            filename = args_obj.get("filename")
            desc = await _tool_generate_image_description(filename, payload)
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"description": desc}),
            }
        if name == "create_image_placeholder":
            desc = args_obj.get("description")
            title = args_obj.get("title")
            from app.helpers.image_helpers import update_image_metadata
            import uuid

            filename = f"placeholder_{uuid.uuid4().hex[:8]}.png"
            update_image_metadata(filename, description=desc, title=title)

            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(
                    {"filename": filename, "description": desc, "title": title}
                ),
            }
        if name == "set_image_metadata":
            filename = args_obj.get("filename")
            title = args_obj.get("title")
            desc = args_obj.get("description")
            from app.helpers.image_helpers import update_image_metadata

            update_image_metadata(filename, description=desc, title=title)
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"ok": True}),
            }

        if name == "web_search":
            query = args_obj.get("query", "")
            try:
                from duckduckgo_search import DDGS

                results = []
                with DDGS() as ddgs:
                    # Try a few variations to be robust
                    # 1. Standard text search with US region first to avoid irrelevant results
                    results = list(ddgs.text(query, max_results=8, region="us-en"))

                    # 2. If empty, try with a broader region
                    if not results:
                        results = list(ddgs.text(query, max_results=8, region="wt-wt"))

                    # 3. If still empty and contains a future year, try without the year
                    import datetime

                    current_year = datetime.datetime.now().year
                    if not results and str(current_year + 1) in query:
                        broader_query = query.replace(str(current_year + 1), "").strip()
                        results = list(ddgs.text(broader_query, max_results=8))

                    # 4. If still empty, try news
                    if not results:
                        results = list(ddgs.news(query, max_results=5))

                # If we have results, wrap them with the query for transparency
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"query": query, "results": results}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {"query": query, "error": str(e), "results": []}
                    ),
                }

        if name == "visit_page":
            url = args_obj.get("url", "")
            try:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
                async with httpx.AsyncClient(follow_redirects=True) as client:
                    resp = await client.get(url, headers=headers, timeout=15.0)
                    resp.raise_for_status()

                    from bs4 import BeautifulSoup

                    soup = BeautifulSoup(resp.text, "html.parser")

                    # Remove script and style elements
                    for script_or_style in soup(["script", "style"]):
                        script_or_style.decompose()

                    # Get text
                    text = soup.get_text(separator="\n")
                    # Break into lines and remove leading/trailing whitespace
                    lines = (line.strip() for line in text.splitlines())
                    # Break multi-headlines into a line each
                    chunks = (
                        phrase.strip() for line in lines for phrase in line.split("  ")
                    )
                    # Drop blank lines
                    text = "\n".join(chunk for chunk in chunks if chunk)

                    # Limit length
                    if len(text) > 10000:
                        text = text[:10000] + "... [TRUNCATED]"

                    return {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": name,
                        "content": _json.dumps({"url": url, "content": text}),
                    }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"url": url, "error": str(e)}),
                }

        if name == "wikipedia_search":
            query = args_obj.get("query", "")
            try:
                # Use wikipedia API
                wiki_url = f"https://en.wikipedia.org/w/api.php?action=opensearch&search={query}&limit=5&namespace=0&format=json"
                headers = {"User-Agent": "AugmentedQuill/1.0 (Research Tool)"}
                async with httpx.AsyncClient() as client:
                    resp = await client.get(wiki_url, headers=headers, timeout=10.0)
                    resp.raise_for_status()
                    data = resp.json()
                    # data format: [query, [titles], [snippets], [urls]]
                    results = []
                    if len(data) >= 4:
                        for i in range(len(data[1])):
                            results.append(
                                {
                                    "title": data[1][i],
                                    "snippet": data[2][i],
                                    "url": data[3][i],
                                }
                            )
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"query": query, "results": results}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "get_story_summary":
            active = get_active_project_dir()
            story = load_story_config((active / "story.json") if active else None) or {}
            summary = story.get("story_summary", "")
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"story_summary": summary}),
            }
        if name == "get_story_tags":
            active = get_active_project_dir()
            story = load_story_config((active / "story.json") if active else None) or {}
            tags = story.get("tags", [])
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"tags": tags}),
            }
        if name == "set_story_tags":
            tags = args_obj.get("tags")
            if not isinstance(tags, list):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {"error": "tags must be an array of strings"}
                    ),
                }

            active = get_active_project_dir()
            if not active:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "No active project"}),
                }
            story_path = active / "story.json"
            story = load_story_config(story_path) or {}
            story["tags"] = tags
            save_story_config(story_path, story)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(
                    {"tags": tags, "message": "Story tags updated successfully"}
                ),
            }
        if name == "get_chapter_summaries":
            ov = _project_overview()
            p_type = ov.get("project_type", "novel")

            all_chapters = []
            if p_type == "series":
                for book in ov.get("books", []):
                    all_chapters.extend(book.get("chapters", []))
            else:
                all_chapters = ov.get("chapters", [])

            summaries = []
            for chapter in all_chapters:
                if isinstance(chapter, dict):
                    chap_id = chapter.get("id")
                    title = chapter.get("title", "").strip() or f"Chapter {chap_id}"
                    summary = chapter.get("summary", "").strip()
                    if summary:
                        summaries.append(
                            {"chapter_id": chap_id, "title": title, "summary": summary}
                        )
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"chapter_summaries": summaries}),
            }
        if name == "get_chapter_content":
            chap_id = args_obj.get("chap_id")
            if chap_id is None:
                ac = payload.get("active_chapter_id")
                if isinstance(ac, int):
                    chap_id = ac
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            start = int(args_obj.get("start", 0) or 0)
            max_chars = int(args_obj.get("max_chars", 8000) or 8000)
            max_chars = max(1, min(8000, max_chars))
            data = _chapter_content_slice(chap_id, start=start, max_chars=max_chars)
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }
        if name == "write_chapter_content":
            chap_id = args_obj.get("chap_id")
            content = args_obj.get("content")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            if not isinstance(content, str):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "content is required"}),
                }
            try:
                write_chapter_content(chap_id, content)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {
                            "message": f"Content written to chapter {chap_id} successfully"
                        }
                    ),
                }
            except ValueError as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }
        if name == "write_chapter_summary":
            chap_id = args_obj.get("chap_id")
            summary = args_obj.get("summary")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            if not isinstance(summary, str):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "summary is required"}),
                }
            try:
                write_chapter_summary(chap_id, summary)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {
                            "message": f"Summary written to chapter {chap_id} successfully"
                        }
                    ),
                }
            except ValueError as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }
        if name == "sync_summary":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            mode = str(args_obj.get("mode", "")).lower()
            data = await _story_generate_summary_helper(chap_id=chap_id, mode=mode)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }
        if name == "write_chapter":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            data = await _story_write_helper(chap_id=chap_id)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }
        if name == "continue_chapter":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            data = await _story_continue_helper(chap_id=chap_id)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }
        if name == "sync_story_summary":
            mode = str(args_obj.get("mode", "")).lower()
            # Import the helper function
            from app.helpers.story_helpers import _story_generate_story_summary_helper

            data = await _story_generate_story_summary_helper(mode=mode)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }
        if name == "write_story_summary":
            summary = str(args_obj.get("summary", "")).strip()
            active = get_active_project_dir()
            if not active:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "No active project"}),
                }
            story_path = active / "story.json"
            story = load_story_config(story_path) or {}
            story["story_summary"] = summary
            save_story_config(story_path, story)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(
                    {
                        "summary": summary,
                        "message": "Story summary updated successfully",
                    }
                ),
            }
        if name == "create_new_chapter":
            title = str(args_obj.get("title", "")).strip()
            # Optional book_id for series projects
            book_id = args_obj.get("book_id")

            active = get_active_project_dir()
            if not active:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "No active project"}),
                }
            from app.projects import create_new_chapter

            try:
                # Assuming create_new_chapter signature updated to (title, book_id)
                chap_id = create_new_chapter(title, book_id=book_id)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {
                            "chap_id": chap_id,
                            "title": title,
                            "message": f"New chapter {chap_id} created successfully",
                        }
                    ),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }
        if name == "get_chapter_heading":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            _chapter_by_id_or_404(chap_id)
            ov = _project_overview()
            chapters = []
            if ov.get("project_type") == "series":
                for b in ov.get("books", []):
                    chapters.extend(b.get("chapters", []))
            else:
                chapters = ov.get("chapters", [])
            chapter = next((c for c in chapters if c["id"] == chap_id), None)
            heading = chapter.get("title", "") if chapter else ""
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"heading": heading}),
            }
        if name == "write_chapter_heading":
            chap_id = args_obj.get("chap_id")
            heading = str(args_obj.get("heading", "")).strip()
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            write_chapter_title(chap_id, heading)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(
                    {
                        "heading": heading,
                        "message": f"Heading for chapter {chap_id} updated successfully",
                    }
                ),
            }
        if name == "get_chapter_summary":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            _chapter_by_id_or_404(chap_id)
            ov = _project_overview()
            chapters = []
            if ov.get("project_type") == "series":
                for b in ov.get("books", []):
                    chapters.extend(b.get("chapters", []))
            else:
                chapters = ov.get("chapters", [])
            chapter = next((c for c in chapters if c["id"] == chap_id), None)
            summary = chapter.get("summary", "") if chapter else ""
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"summary": summary}),
            }
        if name == "create_project":
            p_name = args_obj.get("name")
            p_type = args_obj.get("project_type", "novel")
            if not p_name:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "Project name is required"}),
                }
            ok, msg = create_project(p_name, p_type)
            if ok:
                mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"ok": ok, "message": msg}),
            }
        if name == "list_projects":
            projs = list_projects()
            simple = [{"name": p["name"], "title": p["title"]} for p in projs]
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"projects": simple}),
            }
        if name == "delete_project":
            p_name = args_obj.get("name")
            confirmed = args_obj.get("confirm", False)
            if not p_name:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "Project name is required"}),
                }
            if not confirmed:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {
                            "status": "confirmation_required",
                            "message": "This operation deletes the project. Call again with confirm=true to proceed.",
                        }
                    ),
                }
            ok, msg = delete_project(p_name)
            if ok:
                mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"ok": ok, "message": msg}),
            }

        if name == "delete_book":
            book_id = args_obj.get("book_id")
            confirmed = args_obj.get("confirm", False)
            if not book_id:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "book_id is required"}),
                }
            if not confirmed:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {
                            "status": "confirmation_required",
                            "message": "This operation deletes the book. Call again with confirm=true to proceed.",
                        }
                    ),
                }

            active = get_active_project_dir()
            if not active:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "No active project"}),
                }
            story_path = active / "story.json"
            story = load_story_config(story_path) or {}
            books = story.get("books", [])
            new_books = [b for b in books if str(b.get("id")) != str(book_id)]

            if len(new_books) == len(books):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "Book not found"}),
                }

            story["books"] = new_books
            save_story_config(story_path, story)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"ok": True, "message": "Book deleted"}),
            }

        if name == "delete_chapter":
            chap_id = args_obj.get("chap_id")
            confirmed = args_obj.get("confirm", False)
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            if not confirmed:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {
                            "status": "confirmation_required",
                            "message": "This operation deletes the chapter. Call again with confirm=true to proceed.",
                        }
                    ),
                }

            # Logic to delete from filesystem and story.json
            active = get_active_project_dir()
            from app.helpers.chapter_helpers import _scan_chapter_files

            files = _scan_chapter_files()
            match = next(((idx, p) for (idx, p) in files if idx == chap_id), None)
            if not match:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "Chapter not found"}),
                }

            _, path = match
            if path.exists():
                path.unlink()

            # Remove from story.json if present
            story_path = active / "story.json"
            story = load_story_config(story_path) or {}
            chapters = story.get("chapters", [])
            if chap_id < len(chapters):
                # We can't shift indices easily because filenames are fixed (0001.txt).
                # Deleting chapter 2 means 0002.txt is gone.
                # Filesystem scan will now see 0001, 0003. Virtual IDs might shift or stay?
                # _scan_chapter_files returns sequential virtual IDs if we use `enumerate`.
                # If we rely on filenames for ID, then it's distinct.
                # Current logic in `projects.py` `create_new_chapter` relies on Max(Filesystem ID) + 1.
                # Current logic in `_scan_chapter_files`:
                #   files = sorted(root.glob("*.txt")) -> 0001.txt, 0003.txt
                #   returns enumerate(files, 1) -> (1, 0001.txt), (2, 0003.txt)
                # So Virtual IDs shift!
                # We should remove the chapter metadata at the specific index corresponding to the DELETED chapter.
                # But wait, if IDs shift, we need to know the mapping BEFORE deletion.
                # `chap_id` passed here is the Virtual ID (1-based index).
                idx_to_remove = chap_id - 1
                if 0 <= idx_to_remove < len(chapters):
                    chapters.pop(idx_to_remove)
                    story["chapters"] = chapters
                    save_story_config(story_path, story)

            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"ok": True, "message": "Chapter deleted"}),
            }

        if name == "create_new_book":
            title = args_obj.get("title")
            if not title:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "Book title is required"}),
                }

            from app.projects import create_new_book

            try:
                bid = create_new_book(title)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"book_id": bid, "message": "Book created"}),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "change_project_type":
            new_type = args_obj.get("new_type")
            if not new_type:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "new_type is required"}),
                }
            from app.projects import change_project_type

            ok, msg = change_project_type(new_type)
            if ok:
                mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"ok": ok, "message": msg}),
            }

        if name == "reorder_chapters":
            chapter_ids = args_obj.get("chapter_ids", [])
            book_id = args_obj.get("book_id")

            if not isinstance(chapter_ids, list):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chapter_ids must be a list"}),
                }

            try:
                # Import the reorder API function
                from app.api.chapters import api_reorder_chapters

                # We need to create a mock request object

                # Create a mock request with the payload
                payload = {"chapter_ids": chapter_ids}
                if book_id:
                    payload["book_id"] = book_id

                class MockRequest:
                    async def json(self):
                        return payload

                mock_request = MockRequest()
                result = await api_reorder_chapters(mock_request)

                if result.status_code == 200:
                    mutations["story_changed"] = True
                    return {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": name,
                        "content": _json.dumps(
                            {"ok": True, "message": "Chapters reordered successfully"}
                        ),
                    }
                else:
                    return {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": name,
                        "content": _json.dumps(
                            {
                                "error": (
                                    result.body.decode()
                                    if hasattr(result, "body")
                                    else "Reorder failed"
                                )
                            }
                        ),
                    }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        if name == "reorder_books":
            book_ids = args_obj.get("book_ids", [])

            if not isinstance(book_ids, list):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "book_ids must be a list"}),
                }

            try:
                # Import the reorder API function
                from app.api.chapters import api_reorder_books

                # We need to create a mock request object

                # Create a mock request with the payload
                class MockRequest:
                    async def json(self):
                        return {"book_ids": book_ids}

                mock_request = MockRequest()
                result = await api_reorder_books(mock_request)

                if result.status_code == 200:
                    mutations["story_changed"] = True
                    return {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": name,
                        "content": _json.dumps(
                            {"ok": True, "message": "Books reordered successfully"}
                        ),
                    }
                else:
                    return {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": name,
                        "content": _json.dumps(
                            {
                                "error": (
                                    result.body.decode()
                                    if hasattr(result, "body")
                                    else "Reorder failed"
                                )
                            }
                        ),
                    }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }

        return {
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": _json.dumps({"error": f"Unknown tool: {name}"}),
        }
    except HTTPException as e:
        return {
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": _json.dumps({"error": f"Tool failed: {e.detail}"}),
        }
    except Exception as e:
        return {
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": _json.dumps(
                {"error": f"Tool failed with unexpected error: {e}"}
            ),
        }


@router.get("/api/chat")
async def api_get_chat() -> dict:
    """Return initial state for chat view: models and current selection."""
    machine = _load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg = (machine.get("openai") or {}) if isinstance(machine, dict) else {}
    models_list = openai_cfg.get("models") if isinstance(openai_cfg, dict) else []

    model_names = []
    if isinstance(models_list, list):
        model_names = [
            m.get("name") for m in models_list if isinstance(m, dict) and m.get("name")
        ]

    selected = openai_cfg.get("selected", "") if isinstance(openai_cfg, dict) else ""
    # Coerce to a valid selection
    if model_names:
        if not selected:
            selected = model_names[0]
        elif selected not in model_names:
            selected = model_names[0]

    return {
        "models": model_names,
        "current_model": selected,
        "messages": [],  # History is client-managed; this is a placeholder.
    }


@router.post("/api/chat/tools")
async def api_chat_tools(request: Request) -> JSONResponse:
    """Execute OpenAI-style tool calls and return tool messages.

    The endpoint does not call the upstream LLM; it only executes provided tool_calls
    from the last assistant message and returns corresponding {role:"tool"} messages.

    Body JSON:
      {
        "model_name": str | null,
        "messages": [
          {"role":"user|assistant|system|tool", "content": str, "tool_calls"?: [{"id":str, "type":"function", "function": {"name": str, "arguments": str}}], "tool_call_id"?: str, "name"?: str}
        ],
        "active_chapter_id"?: int
      }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    messages = payload.get("messages") or []
    if not isinstance(messages, list):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "messages must be an array"},
        )

    last = messages[-1] if messages else None
    tool_calls: list = []
    if isinstance(last, dict):
        t = last.get("tool_calls")
        if isinstance(t, list):
            tool_calls = t

    appended: list[dict] = []
    mutations = {"story_changed": False}

    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        call_id = str(call.get("id") or "")
        func = call.get("function") or {}
        name = (func.get("name") if isinstance(func, dict) else None) or ""
        args_raw = (func.get("arguments") if isinstance(func, dict) else None) or "{}"
        try:
            args_obj = (
                _json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
            )
        except Exception:
            args_obj = {}
        if not name or not call_id:
            continue
        msg = await _exec_chat_tool(name, args_obj, call_id, payload, mutations)
        appended.append(msg)

    # Log tool execution if there were any
    if appended:
        log_entry = create_log_entry(
            "/api/chat/tools", "POST", {}, {"tool_calls": tool_calls}
        )
        log_entry["response"]["status_code"] = 200
        log_entry["response"]["body"] = {"appended_messages": appended}
        log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
        add_llm_log(log_entry)
        finalize_llm_log_entry(log_entry)

    return JSONResponse(
        status_code=200,
        content={"ok": True, "appended_messages": appended, "mutations": mutations},
    )


async def _inject_project_images(messages: list[dict]):
    if not messages:
        return

    last_msg = messages[-1]
    if last_msg.get("role") != "user":
        return

    content = last_msg.get("content")
    if not isinstance(content, str):
        return

    active = get_active_project_dir()
    if not active:
        return

    images_dir = active / "images"
    if not images_dir.exists():
        return

    found_images = []
    # Scan for common image extensions
    allowed = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

    for f in images_dir.iterdir():
        if f.is_file() and f.suffix.lower() in allowed:
            # Check if filename is in content
            if f.name in content:
                found_images.append(f)

    if not found_images:
        return

    # Construct new content
    new_content = [{"type": "text", "text": content}]

    for path in found_images:
        try:
            mime = "image/png"
            if path.suffix.lower() in [".jpg", ".jpeg"]:
                mime = "image/jpeg"
            elif path.suffix.lower() == ".webp":
                mime = "image/webp"
            elif path.suffix.lower() == ".gif":
                mime = "image/gif"

            with open(path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("utf-8")

            new_content.append(
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
            )
        except Exception:
            pass

    last_msg["content"] = new_content


@router.post("/api/chat/stream")
async def api_chat_stream(request: Request) -> StreamingResponse:
    """Stream chat with the configured OpenAI-compatible model.

    Body JSON:
      {
        "model_name": "name-of-configured-entry" | null,
        "model_type": "CHAT" | "WRITING" | "EDITING" | null,
        "messages": [{"role": "system|user|assistant", "content": str}, ...],
        // optional overrides (otherwise pulled from config/machine.json)
        "base_url": str,
        "api_key": str,
        "model": str,
        "timeout_s": int
      }

    Returns: Streaming text response with the assistant's message.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    def _normalize_chat_messages(val: Any) -> list[dict]:
        """Preserve OpenAI message fields including tool calls.

        Keeps: role, content (may be None), name, tool_call_id, tool_calls.
        """
        arr = val if isinstance(val, list) else []
        out: list[dict] = []
        for m in arr:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role", "")).strip().lower() or "user"
            msg: dict = {"role": role}
            # content can be None (e.g., assistant with tool_calls)
            if "content" in m:
                c = m.get("content")
                msg["content"] = None if c is None else str(c)
            # pass-through optional tool fields
            name = m.get("name")
            if isinstance(name, str) and name:
                msg["name"] = name
            tcid = m.get("tool_call_id")
            if isinstance(tcid, str) and tcid:
                msg["tool_call_id"] = tcid
            tcs = m.get("tool_calls")
            if isinstance(tcs, list) and tcs:
                msg["tool_calls"] = tcs
                if role == "assistant":
                    msg["content"] = None
            out.append(msg)
        return out

    req_messages = _normalize_chat_messages((payload or {}).get("messages"))
    if not req_messages:
        raise HTTPException(status_code=400, detail="messages array is required")

    # Filter and optimize chat history based on tool usage
    req_messages = _filter_chat_history(req_messages)

    # Load config to determine model capabilities and overrides
    machine = _load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}

    model_type = (payload or {}).get("model_type") or "CHAT"
    # Resolve selected name
    selected_name = (
        (payload or {}).get("model_name")
        or openai_cfg.get(f"selected_{model_type.lower()}")
        or openai_cfg.get("selected")
    )

    base_url = (payload or {}).get("base_url")
    api_key = (payload or {}).get("api_key")
    model_id = (payload or {}).get("model")
    timeout_s = (payload or {}).get("timeout_s")

    # Resolve actual model entry
    chosen = None
    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    if isinstance(models, list) and models:
        allowed_models = models
        if selected_name:
            for m in allowed_models:
                if isinstance(m, dict) and (m.get("name") == selected_name):
                    chosen = m
                    break
        if chosen is None:
            chosen = allowed_models[0]

        base_url = chosen.get("base_url") or base_url
        api_key = chosen.get("api_key") or api_key
        model_id = chosen.get("model") or model_id
        timeout_s = chosen.get("timeout_s", 60) or timeout_s

    # Match selected model to config to get capabilities
    chosen = None
    supports_function_calling = True
    if models:
        allowed_models = models
        if selected_name:
            for m in allowed_models:
                if isinstance(m, dict) and (m.get("name") == selected_name):
                    chosen = m
                    break
        if chosen is None:
            chosen = allowed_models[0]

    # Capability checks
    # Default to True/Auto unless explicitly disabled
    is_multimodal = True
    supports_function_calling = True
    if chosen:
        if chosen.get("is_multimodal") is False:
            is_multimodal = False
        if chosen.get("supports_function_calling") is False:
            supports_function_calling = False

    # Inject images if referenced in the last user message and supported
    if is_multimodal:
        await _inject_project_images(req_messages)

    # Prepend system message if not present
    system_msg = None
    for msg in req_messages:
        if msg.get("role") == "system":
            system_msg = msg
            break

    if not system_msg:
        # Map model_type to system message key
        sys_msg_key = "chat_llm"
        if model_type == "WRITING":
            sys_msg_key = "writing_llm"
        elif model_type == "EDITING":
            sys_msg_key = "editing_llm"

        model_overrides = load_model_prompt_overrides(machine, selected_name)
        system_content = get_system_message(sys_msg_key, model_overrides)
        system_msg = {"role": "system", "content": system_content}
        req_messages.insert(0, system_msg)

    # If web search is allowed, ensure the system prompt mentions it
    if (payload or {}).get("allow_web_search"):
        content = system_msg.get("content") or ""
        if "web_search" not in content:
            system_msg["content"] = (
                content
                + "\n\nWEB SEARCH ENABLED: You have access to 'web_search', 'wikipedia_search', and 'visit_page'.\n"
                "RESEARCH PROTOCOL:\n"
                "1. Start with 'wikipedia_search' for entities/facts, or 'web_search' for news/general info.\n"
                "2. IMPORTANT: Do NOT rely solely on snippets. You MUST use 'visit_page' to read the full content of the top 1-3 most relevant URLs found in the search results before formulating your final response.\n"
                "3. This multi-step process is required so the user can see your research path and the actual data you are using."
            )

    if not base_url or not model_id:
        raise HTTPException(
            status_code=400, detail="Missing base_url or model in configuration"
        )

    url = str(base_url).rstrip("/") + "/chat/completions"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Pull llm preferences for sensible defaults
    story = (
        load_story_config((get_active_project_dir() or CONFIG_DIR) / "story.json") or {}
    )
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = (
        float(prefs.get("temperature", 0.7))
        if isinstance(prefs.get("temperature", 0.7), (int, float, str))
        else 0.7
    )
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens", None)

    body: Dict[str, Any] = {
        "model": model_id,
        "messages": req_messages,
        "temperature": temperature,
        "stream": True,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens

    # Pass through OpenAI tool-calling fields if provided
    if supports_function_calling:
        tool_choice = (payload or {}).get("tool_choice")
        # If the client explicitly requests "none", do not send tools.
        # This prevents some models from hallucinating tool usage even when told not to.
        if tool_choice == "none":
            pass
        else:
            tools = STORY_TOOLS.copy()
            if (payload or {}).get("allow_web_search"):
                tools.extend(WEB_SEARCH_TOOLS)

            body["tools"] = tools
            if tool_choice:
                body["tool_choice"] = tool_choice

    log_entry = create_log_entry(url, "POST", headers, body, streaming=True)
    log_entry["model_type"] = model_type
    add_llm_log(log_entry)

    async def _gen():
        try:
            # Retry loop for fallback (tool choice error)
            attempts = 2 if supports_function_calling else 1

            for attempt in range(attempts):
                is_fallback = attempt == 1

                # Prepare logic variables
                channel_filter = ChannelFilter()
                content = ""
                chunk_content = ""

                # Prepare body
                current_body = body.copy()

                if is_fallback:
                    current_body.pop("tools", None)
                    current_body.pop("tool_choice", None)

                    # Clone messages to avoid modifying the original list/dicts
                    if "messages" in current_body:
                        new_msgs = []
                        for m in current_body["messages"]:
                            new_msgs.append(m.copy())
                        current_body["messages"] = new_msgs

                        # Inject fallback instructions into the system prompt
                        found_system = False
                        for m in current_body["messages"]:
                            if m.get("role") == "system":
                                content = m.get("content", "") or ""
                                # Append explicit instruction for text-based tool calling
                                # Construct a list of available tools
                                tools_list = STORY_TOOLS.copy()
                                if (payload or {}).get("allow_web_search"):
                                    tools_list.extend(WEB_SEARCH_TOOLS)

                                tools_desc = "\nAvailable Tools:\n"
                                for t in tools_list:
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
                                m["content"] = content + fallback_instr
                                found_system = True
                                break

                        # If no system prompt found, prepend one
                        if not found_system:
                            tools_list = STORY_TOOLS.copy()
                            if (payload or {}).get("allow_web_search"):
                                tools_list.extend(WEB_SEARCH_TOOLS)

                            tools_desc = "\nAvailable Tools:\n"
                            for t in tools_list:
                                f = t.get("function", {})
                                name = f.get("name")
                                desc = f.get("description", "")
                                if name:
                                    tools_desc += f"- {name}: {desc}\n"

                            current_body["messages"].insert(
                                0,
                                {
                                    "role": "system",
                                    "content": f'You are a helpful assistant.\n\n[SYSTEM NOTICE: Native tool calling is unavailable. To use tools, you MUST output the tool call strictly using this format:]\n[TOOL_CALL]tool_name({{"arg": "value"}})[/TOOL_CALL]\n{tools_desc}',
                                },
                            )

                try:
                    async with httpx.AsyncClient(
                        timeout=httpx.Timeout(float(timeout_s or 60))
                    ) as client:
                        async with client.stream(
                            "POST", url, headers=headers, json=current_body
                        ) as resp:
                            log_entry["response"]["status_code"] = resp.status_code
                            if resp.status_code >= 400:
                                error_content = await resp.aread()

                                # Fallback check
                                if not is_fallback and supports_function_calling:
                                    try:
                                        err_text_check = error_content.decode(
                                            "utf-8", errors="ignore"
                                        )
                                    except Exception:
                                        err_text_check = str(error_content)
                                    if "tool choice requires" in err_text_check:
                                        # Retry loop
                                        continue

                                log_entry["timestamp_end"] = (
                                    datetime.datetime.now().isoformat()
                                )
                                try:
                                    error_data = _json.loads(error_content)
                                    log_entry["response"]["error"] = error_data
                                    yield f'data: {{"error": "Upstream error", "status": {resp.status_code}, "data": {_json.dumps(error_data)}}}\n\n'
                                except Exception:
                                    err_text = error_content.decode(
                                        "utf-8", errors="ignore"
                                    )
                                    log_entry["response"]["error"] = err_text
                                    yield f'data: {{"error": "Upstream error", "status": {resp.status_code}, "data": {_json.dumps(err_text)}}}\n\n'
                                finalize_llm_log_entry(log_entry)
                                return

                            # Check if response is SSE or regular JSON
                            content_type = resp.headers.get("content-type", "")
                            if "text/event-stream" not in content_type:
                                # Not SSE, treat as regular JSON response
                                try:
                                    response_data = await resp.json()
                                    log_entry["response"]["body"] = response_data
                                    log_entry["timestamp_end"] = (
                                        datetime.datetime.now().isoformat()
                                    )
                                    if (
                                        "choices" in response_data
                                        and response_data["choices"]
                                    ):
                                        choice = response_data["choices"][0]
                                        if (
                                            "message" in choice
                                            and "content" in choice["message"]
                                        ):
                                            content = choice["message"]["content"]
                                            if content:
                                                # Separate thinking from final content
                                                filtered_results = channel_filter.feed(
                                                    content
                                                )
                                                filtered_results += (
                                                    channel_filter.flush()
                                                )

                                                for res in filtered_results:
                                                    if res["channel"] in (
                                                        "thinking",
                                                        "analysis",
                                                    ):
                                                        if res["channel"] == "thinking":
                                                            yield f'data: {{"thinking": {_json.dumps(res["content"])}}}\n\n'
                                                        continue
                                                    if res["channel"].startswith(
                                                        "commentary to="
                                                    ):
                                                        func_name = (
                                                            _normalize_tool_name(
                                                                res["channel"]
                                                                .split(
                                                                    "commentary to=", 1
                                                                )[1]
                                                                .strip()
                                                            )
                                                        )
                                                        if func_name:
                                                            tool_call = {
                                                                "id": f"call_{func_name}",
                                                                "type": "function",
                                                                "function": {
                                                                    "name": func_name,
                                                                    "arguments": res[
                                                                        "content"
                                                                    ],
                                                                },
                                                            }
                                                            yield f'data: {{"tool_calls": [{_json.dumps(tool_call)}]}}\n\n'
                                                            if (
                                                                "tool_calls"
                                                                not in log_entry[
                                                                    "response"
                                                                ]
                                                            ):
                                                                log_entry["response"][
                                                                    "tool_calls"
                                                                ] = []
                                                            log_entry["response"][
                                                                "tool_calls"
                                                            ].append(tool_call)
                                                        continue
                                                    elif res["channel"].startswith(
                                                        "call:"
                                                    ):
                                                        func_name = (
                                                            _normalize_tool_name(
                                                                res["channel"][5:]
                                                            )
                                                        )
                                                        tool_call = {
                                                            "id": f"call_{func_name}",
                                                            "type": "function",
                                                            "function": {
                                                                "name": func_name,
                                                                "arguments": res[
                                                                    "content"
                                                                ],
                                                            },
                                                        }
                                                        yield f'data: {{"tool_calls": [{_json.dumps(tool_call)}]}}\n\n'
                                                        # Update aggregated for logging
                                                        if (
                                                            "tool_calls"
                                                            not in log_entry["response"]
                                                        ):
                                                            log_entry["response"][
                                                                "tool_calls"
                                                            ] = []
                                                        log_entry["response"][
                                                            "tool_calls"
                                                        ].append(tool_call)
                                                    elif res["channel"] == "tool_def":
                                                        inner = res["content"].strip()
                                                        import re

                                                        # Try JSON parsing first
                                                        func_name = None
                                                        args_raw = "{}"

                                                        if inner.startswith("{"):
                                                            try:
                                                                jobj = _json.loads(
                                                                    inner
                                                                )
                                                                if "name" in jobj:
                                                                    func_name = jobj[
                                                                        "name"
                                                                    ]
                                                                    # Arguments can be dict or string in JSON tool call
                                                                    args_val = jobj.get(
                                                                        "arguments", {}
                                                                    )
                                                                    if isinstance(
                                                                        args_val, str
                                                                    ):
                                                                        args_raw = (
                                                                            args_val
                                                                        )
                                                                    else:
                                                                        args_raw = (
                                                                            _json.dumps(
                                                                                args_val
                                                                            )
                                                                        )
                                                            except Exception:
                                                                pass

                                                        if not func_name:
                                                            func_match = re.match(
                                                                r"(\w+)(?:\((.*)\))?",
                                                                inner,
                                                                re.DOTALL,
                                                            )
                                                            if func_match:
                                                                func_name = (
                                                                    func_match.group(1)
                                                                )
                                                                args_raw = (
                                                                    func_match.group(2)
                                                                    or "{}"
                                                                )
                                                                if not args_raw.strip():
                                                                    args_raw = "{}"

                                                        if func_name:
                                                            tool_call = {
                                                                "id": f"call_{func_name}",
                                                                "type": "function",
                                                                "function": {
                                                                    "name": func_name,
                                                                    "arguments": args_raw,
                                                                },
                                                            }
                                                            yield f'data: {{"tool_calls": [{_json.dumps(tool_call)}]}}\n\n'
                                                            if (
                                                                "tool_calls"
                                                                not in log_entry[
                                                                    "response"
                                                                ]
                                                            ):
                                                                log_entry["response"][
                                                                    "tool_calls"
                                                                ] = []
                                                            log_entry["response"][
                                                                "tool_calls"
                                                            ].append(tool_call)
                                                    else:
                                                        # Process final content for tool calls
                                                        content = res["content"]
                                                        if not content:
                                                            continue

                                                        (
                                                            clean_content,
                                                            parsed_tool_calls,
                                                        ) = _parse_tool_syntax(content)
                                                        if parsed_tool_calls:
                                                            yield f'data: {{"tool_calls": {_json.dumps(parsed_tool_calls)}}}\n\n'
                                                        if clean_content:
                                                            yield f'data: {{"content": {_json.dumps(clean_content)}}}\n\n'

                                        # Handle tool_calls in the final message
                                        message = choice.get("message", {})
                                        if (
                                            "tool_calls" in message
                                            and message["tool_calls"]
                                        ):
                                            yield f'data: {{"tool_calls": {_json.dumps(message["tool_calls"])}}}\n\n'
                                    yield 'data: {"done": true}\n\n'
                                    finalize_llm_log_entry(log_entry)
                                except Exception as e:
                                    import traceback

                                    tb = traceback.format_exc()
                                    log_entry["response"]["error"] = f"{str(e)}\n\n{tb}"
                                    yield f'data: {{"error": "Failed to parse response", "message": {_json.dumps(str(e))}, "traceback": {_json.dumps(tb)}}}\n\n'
                                    finalize_llm_log_entry(log_entry)

                                # Success, break retry loop
                                break

                            buffer = ""
                            sent_tool_call_ids = set()
                            aggregated_tool_calls = []
                            async for line in resp.aiter_lines():
                                if line.strip():
                                    if line.startswith("data: "):
                                        data_str = line[6:]  # Remove "data: " prefix
                                        if data_str.strip() == "[DONE]":
                                            # Final check for text-based tool calls
                                            final_content = log_entry["response"].get(
                                                "full_content", ""
                                            )
                                            if final_content:
                                                parsed_tool_calls = (
                                                    _parse_tool_calls_from_content(
                                                        final_content
                                                    )
                                                )
                                                if parsed_tool_calls:
                                                    new_calls = [
                                                        c
                                                        for c in parsed_tool_calls
                                                        if c["id"]
                                                        not in sent_tool_call_ids
                                                    ]
                                                    if new_calls:
                                                        for c in new_calls:
                                                            sent_tool_call_ids.add(
                                                                c["id"]
                                                            )
                                                            aggregated_tool_calls.append(
                                                                c
                                                            )
                                                        yield f'data: {{"tool_calls": {_json.dumps(new_calls)}}}\n\n'

                                            log_entry["response"][
                                                "tool_calls"
                                            ] = aggregated_tool_calls

                                            # Flush remaining content from channel filter
                                            for res in channel_filter.flush():
                                                if res["channel"] in (
                                                    "thinking",
                                                    "analysis",
                                                ):
                                                    if res["channel"] == "thinking":
                                                        yield f'data: {{"thinking": {_json.dumps(res["content"])}}}\n\n'
                                                    continue
                                                if res["channel"].startswith(
                                                    "commentary to="
                                                ):
                                                    func_name = _normalize_tool_name(
                                                        res["channel"]
                                                        .split("commentary to=", 1)[1]
                                                        .strip()
                                                    )
                                                    if func_name:
                                                        call_id = f"call_{func_name}"
                                                        if (
                                                            call_id
                                                            in sent_tool_call_ids
                                                        ):
                                                            i = 1
                                                            while (
                                                                f"{call_id}_{i}"
                                                                in sent_tool_call_ids
                                                            ):
                                                                i += 1
                                                            call_id = f"{call_id}_{i}"
                                                        if (
                                                            call_id
                                                            not in sent_tool_call_ids
                                                        ):
                                                            sent_tool_call_ids.add(
                                                                call_id
                                                            )
                                                            aggregated_tool_calls.append(
                                                                {
                                                                    "id": call_id,
                                                                    "type": "function",
                                                                    "function": {
                                                                        "name": func_name,
                                                                        "arguments": "",
                                                                    },
                                                                }
                                                            )
                                                        yield f'data: {{"tool_calls": [{{"index": 0, "id": "{call_id}", "function": {{"name": "{func_name}", "arguments": {_json.dumps(res["content"])}}}}}]}}\n\n'
                                                    continue
                                                elif res["channel"].startswith("call:"):
                                                    func_name = _normalize_tool_name(
                                                        res["channel"][5:]
                                                    )
                                                    call_id = f"call_{func_name}"
                                                    # Check if we already sent this ID, if so, append index
                                                    if call_id in sent_tool_call_ids:
                                                        i = 1
                                                        while (
                                                            f"{call_id}_{i}"
                                                            in sent_tool_call_ids
                                                        ):
                                                            i += 1
                                                        call_id = f"{call_id}_{i}"

                                                    if (
                                                        call_id
                                                        not in sent_tool_call_ids
                                                    ):
                                                        sent_tool_call_ids.add(call_id)
                                                        yield f'data: {{"tool_calls": [{{"index": 0, "id": "{call_id}", "function": {{"name": "{func_name}", "arguments": ""}}}}]}}\n\n'

                                                    if res["content"]:
                                                        yield f'data: {{"tool_calls": [{{"index": 0, "function": {{"arguments": {_json.dumps(res["content"])} }}}}]}}\n\n'
                                                elif res["content"]:
                                                    clean_content, parsed_tool_calls = (
                                                        _parse_tool_syntax(
                                                            res["content"]
                                                        )
                                                    )
                                                    if parsed_tool_calls:
                                                        new_calls = [
                                                            c
                                                            for c in parsed_tool_calls
                                                            if c["id"]
                                                            not in sent_tool_call_ids
                                                        ]
                                                        if new_calls:
                                                            for c in new_calls:
                                                                sent_tool_call_ids.add(
                                                                    c["id"]
                                                                )
                                                                aggregated_tool_calls.append(
                                                                    c
                                                                )
                                                            yield f'data: {{"tool_calls": {_json.dumps(new_calls)}}}\n\n'
                                                    if clean_content:
                                                        yield f'data: {{"content": {_json.dumps(clean_content)}}}\n\n'

                                            yield 'data: {"done": true}\n\n'
                                            log_entry["timestamp_end"] = (
                                                datetime.datetime.now().isoformat()
                                            )
                                            finalize_llm_log_entry(log_entry)
                                            break
                                        try:
                                            chunk = _json.loads(data_str)
                                            log_entry["response"]["chunks"].append(
                                                chunk
                                            )
                                            # Extract content from the chunk
                                            if "choices" in chunk and chunk["choices"]:
                                                choice = chunk["choices"][0]
                                                if "delta" in choice:
                                                    delta = choice["delta"]
                                                    # Handle reasoning_content (e.g. DeepSeek-R1)
                                                    if "reasoning_content" in delta:
                                                        reasoning = delta[
                                                            "reasoning_content"
                                                        ]
                                                        if reasoning:
                                                            yield f'data: {{"thinking": {_json.dumps(reasoning)}}}\n\n'

                                                    # Handle content
                                                    if "content" in delta:
                                                        chunk_content = delta["content"]
                                                        if chunk_content:
                                                            log_entry["response"][
                                                                "full_content"
                                                            ] += chunk_content

                                                            # Filter channels (thinking vs final)
                                                            filtered_results = (
                                                                channel_filter.feed(
                                                                    chunk_content
                                                                )
                                                            )
                                                            for res in filtered_results:
                                                                if res["channel"] in (
                                                                    "thinking",
                                                                    "analysis",
                                                                ):
                                                                    if (
                                                                        res["channel"]
                                                                        == "thinking"
                                                                    ):
                                                                        yield f'data: {{"thinking": {_json.dumps(res["content"])}}}\n\n'
                                                                    continue

                                                                if res[
                                                                    "channel"
                                                                ].startswith(
                                                                    "commentary to="
                                                                ):
                                                                    func_name = _normalize_tool_name(
                                                                        res["channel"]
                                                                        .split(
                                                                            "commentary to=",
                                                                            1,
                                                                        )[1]
                                                                        .strip()
                                                                    )
                                                                    if func_name:
                                                                        call_id = f"call_{func_name}"
                                                                        if (
                                                                            call_id
                                                                            in sent_tool_call_ids
                                                                        ):
                                                                            i = 1
                                                                            while (
                                                                                f"{call_id}_{i}"
                                                                                in sent_tool_call_ids
                                                                            ):
                                                                                i += 1
                                                                            call_id = f"{call_id}_{i}"
                                                                        if (
                                                                            call_id
                                                                            not in sent_tool_call_ids
                                                                        ):
                                                                            sent_tool_call_ids.add(
                                                                                call_id
                                                                            )
                                                                            aggregated_tool_calls.append(
                                                                                {
                                                                                    "id": call_id,
                                                                                    "type": "function",
                                                                                    "function": {
                                                                                        "name": func_name,
                                                                                        "arguments": "",
                                                                                    },
                                                                                }
                                                                            )
                                                                        yield f'data: {{"tool_calls": [{{"index": 0, "id": "{call_id}", "function": {{"name": "{func_name}", "arguments": {_json.dumps(res["content"])} }}}}]}}\n\n'
                                                                    continue

                                                                if (
                                                                    res["channel"]
                                                                    == "tool_def"
                                                                ):
                                                                    continue

                                                                if res[
                                                                    "channel"
                                                                ].startswith("call:"):
                                                                    func_name = _normalize_tool_name(
                                                                        res["channel"][
                                                                            5:
                                                                        ]
                                                                    )
                                                                    call_id = f"call_{func_name}"

                                                                    # Check if we already sent this ID, if so, append index
                                                                    # This handles multiple calls to same function in one response
                                                                    if (
                                                                        call_id
                                                                        in sent_tool_call_ids
                                                                    ):
                                                                        pass

                                                                    if (
                                                                        call_id
                                                                        not in sent_tool_call_ids
                                                                    ):
                                                                        sent_tool_call_ids.add(
                                                                            call_id
                                                                        )
                                                                        # Initial call with name
                                                                        yield f'data: {{"tool_calls": [{{"index": 0, "id": "{call_id}", "function": {{"name": "{func_name}", "arguments": ""}}}}]}}\n\n'
                                                                        # Add to aggregated for logging
                                                                        aggregated_tool_calls.append(
                                                                            {
                                                                                "id": call_id,
                                                                                "type": "function",
                                                                                "function": {
                                                                                    "name": func_name,
                                                                                    "arguments": "",
                                                                                },
                                                                            }
                                                                        )

                                                                    # Send arguments chunk
                                                                    if res["content"]:
                                                                        yield f'data: {{"tool_calls": [{{"index": 0, "function": {{"arguments": {_json.dumps(res["content"])}}}}}]}}\n\n'
                                                                        # Update aggregated arguments
                                                                        for (
                                                                            tc
                                                                        ) in aggregated_tool_calls:
                                                                            if (
                                                                                tc.get(
                                                                                    "id"
                                                                                )
                                                                                == call_id
                                                                            ):
                                                                                tc[
                                                                                    "function"
                                                                                ][
                                                                                    "arguments"
                                                                                ] += res[
                                                                                    "content"
                                                                                ]
                                                                                break
                                                                    continue

                                                                chunk_content = res[
                                                                    "content"
                                                                ]
                                                                if not chunk_content:
                                                                    continue

                                                                (
                                                                    clean_content,
                                                                    parsed_tool_calls,
                                                                ) = _parse_tool_syntax(
                                                                    chunk_content
                                                                )
                                                                if parsed_tool_calls:
                                                                    new_calls = [
                                                                        c
                                                                        for c in parsed_tool_calls
                                                                        if c["id"]
                                                                        not in sent_tool_call_ids
                                                                    ]
                                                                    if new_calls:
                                                                        for (
                                                                            c
                                                                        ) in new_calls:
                                                                            sent_tool_call_ids.add(
                                                                                c["id"]
                                                                            )
                                                                            aggregated_tool_calls.append(
                                                                                c
                                                                            )
                                                                        yield f'data: {{"tool_calls": {_json.dumps(new_calls)}}}\n\n'

                                                                if clean_content:
                                                                    buffer += (
                                                                        clean_content
                                                                    )
                                                                    yield f'data: {{"content": {_json.dumps(clean_content)}}}\n\n'
                                                    # Handle tool calls
                                                    if (
                                                        "tool_calls" in delta
                                                        and delta["tool_calls"]
                                                    ):
                                                        # Aggregate tool calls for logging
                                                        for tc in delta["tool_calls"]:
                                                            idx = tc.get("index", 0)
                                                            while (
                                                                len(
                                                                    aggregated_tool_calls
                                                                )
                                                                <= idx
                                                            ):
                                                                aggregated_tool_calls.append(
                                                                    {
                                                                        "id": "",
                                                                        "type": "function",
                                                                        "function": {
                                                                            "name": "",
                                                                            "arguments": "",
                                                                        },
                                                                    }
                                                                )

                                                            target = (
                                                                aggregated_tool_calls[
                                                                    idx
                                                                ]
                                                            )
                                                            if tc.get("id"):
                                                                target["id"] = tc["id"]
                                                            if tc.get("function"):
                                                                f = tc["function"]
                                                                if f.get("name"):
                                                                    target["function"][
                                                                        "name"
                                                                    ] += f["name"]
                                                                if f.get("arguments"):
                                                                    target["function"][
                                                                        "arguments"
                                                                    ] += f["arguments"]

                                                        # Send tool calls chunk
                                                        yield f'data: {{"tool_calls": {_json.dumps(delta["tool_calls"])}}}\n\n'
                                                # Check for finish_reason to end streaming
                                                if (
                                                    "finish_reason" in choice
                                                    and choice["finish_reason"]
                                                ):
                                                    # Final check for text-based tool calls
                                                    final_content = log_entry[
                                                        "response"
                                                    ].get("full_content", "")
                                                    if final_content:
                                                        parsed_tool_calls = _parse_tool_calls_from_content(
                                                            final_content
                                                        )
                                                        if parsed_tool_calls:
                                                            new_calls = [
                                                                c
                                                                for c in parsed_tool_calls
                                                                if c["id"]
                                                                not in sent_tool_call_ids
                                                            ]
                                                            if new_calls:
                                                                for c in new_calls:
                                                                    sent_tool_call_ids.add(
                                                                        c["id"]
                                                                    )
                                                                    aggregated_tool_calls.append(
                                                                        c
                                                                    )
                                                                yield f'data: {{"tool_calls": {_json.dumps(new_calls)}}}\n\n'

                                                    log_entry["response"][
                                                        "tool_calls"
                                                    ] = aggregated_tool_calls
                                                    yield 'data: {"done": true}\n\n'
                                                    break
                                        except _json.JSONDecodeError:
                                            continue

                            # Break outer retry loop if success
                            break

                except Exception as e:
                    import traceback

                    # Check for retry allowance
                    if is_fallback or attempt == attempts - 1:
                        tb = traceback.format_exc()
                        log_entry["response"]["error"] = f"{str(e)}\n\n{tb}"
                        yield f'data: {{"error": "Request failed", "message": {_json.dumps(str(e))}, "traceback": {_json.dumps(tb)}}}\n\n'
                        finalize_llm_log_entry(log_entry)

                    # If valid retry, loop continues

                finally:
                    if is_fallback or attempt == attempts - 1:
                        log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
                        finalize_llm_log_entry(log_entry)
        finally:
            if log_entry.get("timestamp_end") is None:
                log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            finalize_llm_log_entry(log_entry)

    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.get("/api/chats")
async def api_list_chats():
    p_dir = get_active_project_dir()
    if not p_dir:
        return []
    return list_chats(p_dir)


@router.get("/api/chats/{chat_id}")
async def api_load_chat(chat_id: str):
    p_dir = get_active_project_dir()
    if not p_dir:
        raise HTTPException(status_code=404, detail="No active project")
    data = load_chat(p_dir, chat_id)
    if not data:
        raise HTTPException(status_code=404, detail="Chat not found")
    return data


@router.post("/api/chats/{chat_id}")
async def api_save_chat(chat_id: str, request: Request):
    p_dir = get_active_project_dir()
    if not p_dir:
        raise HTTPException(status_code=404, detail="No active project")
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    data["id"] = chat_id
    save_chat(p_dir, chat_id, data)
    return {"ok": True}


@router.delete("/api/chats/{chat_id}")
async def api_delete_chat(chat_id: str):
    p_dir = get_active_project_dir()
    if not p_dir:
        raise HTTPException(status_code=404, detail="No active project")
    if delete_chat(p_dir, chat_id):
        return {"ok": True}
    raise HTTPException(status_code=404, detail="Chat not found")


@router.delete("/api/chats")
async def api_delete_all_chats():
    p_dir = get_active_project_dir()
    if not p_dir:
        raise HTTPException(status_code=404, detail="No active project")
    from app.projects import delete_all_chats as delete_all

    delete_all(p_dir)
    return {"ok": True}


@router.post("/api/openai/models")
async def proxy_list_models(request: Request) -> JSONResponse:
    """Fetch `${base_url}/models` using provided credentials.

    Body JSON:
      {"base_url": str, "api_key": str | None, "timeout_s": int | None}

    Returns the JSON payload from the upstream (expected to include a `data` array).
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    base_url = (payload or {}).get("base_url") or ""
    api_key = (payload or {}).get("api_key") or ""
    timeout_s = (payload or {}).get("timeout_s") or 60

    if not isinstance(base_url, str) or not base_url:
        raise HTTPException(status_code=400, detail="base_url is required")

    url = base_url.rstrip("/") + "/models"
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    log_entry = create_log_entry(url, "GET", headers, None)
    add_llm_log(log_entry)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(float(timeout_s))) as client:
            resp = await client.get(url, headers=headers)
            log_entry["response"]["status_code"] = resp.status_code
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            # Relay status code if not 2xx
            content = (
                resp.json()
                if resp.headers.get("content-type", "").startswith("application/json")
                else {"raw": resp.text}
            )
            log_entry["response"]["body"] = content
            if resp.status_code >= 400:
                return JSONResponse(
                    status_code=resp.status_code,
                    content={
                        "error": "Upstream error",
                        "status": resp.status_code,
                        "data": content,
                    },
                )
            return JSONResponse(status_code=200, content=content)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {e}")
    finally:
        finalize_llm_log_entry(log_entry)
