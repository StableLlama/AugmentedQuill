# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chat unit so this responsibility stays isolated, testable, and easy to evolve.

API endpoints for chat sessions and conversational interactions with the LLM writing partner.
"""

import asyncio
import base64
import datetime
import re
import augmentedquill.services.llm.llm as llm
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pathlib import Path
from uuid import uuid4

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.core.config import (
    load_machine_config,
    load_story_config,
    DEFAULT_STORY_CONFIG_PATH,
)
from augmentedquill.services.llm.llm import add_llm_log, create_log_entry
from augmentedquill.services.chat.chat_tool_decorator import (
    execute_registered_tool,
    get_registered_tool_schemas,
    tool_message,
    CHAT_ROLE,
    WRITING_ROLE,
)
from augmentedquill.services.chat.chat_api_helpers import (
    inject_chat_attachments,
    inject_project_images,
    normalize_chat_messages,
)
from augmentedquill.services.chat.chat_api_stream_ops import (
    resolve_stream_model_context,
    ensure_system_message_if_missing,
    resolve_story_llm_prefs,
    inject_chat_user_context,
)
from augmentedquill.services.projects.project_snapshots import (
    capture_project_snapshot,
    restore_project_snapshot,
)
from augmentedquill.services.projects.projects import (
    get_active_project_dir,
    use_project_context,
)
from augmentedquill.services.chat.chat_api_session_ops import (
    list_active_chats,
    load_active_chat,
    save_active_chat,
    delete_active_chat,
    delete_all_active_chats,
)
import augmentedquill.services.chat.chat_api_proxy_ops as _chat_api_proxy_ops
import json as _json
from typing import Any, Dict
from collections import OrderedDict
from augmentedquill.models.chat import (
    ChatInitialStateResponse,
    ChatToolBatchMutationResponse,
    ChapterBeforeContentResponse,
    ChatListItem,
    ChatListResponse,
    ChatDetailResponse,
    OkResponse,
)
from augmentedquill.utils.json_repair import try_parse_json_robust
from augmentedquill.api.v1.request_body import parse_json_object_body
from augmentedquill.utils.path_utils import safe_child_path

router = APIRouter(tags=["Chat"])

proxy_openai_models = _chat_api_proxy_ops.proxy_openai_models
httpx = _chat_api_proxy_ops.httpx


_CHAT_TOOL_BATCH_DIR = ".aq_history/chat_tool_batches"
_BATCH_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,80}$")

_TOOLS_ALWAYS_INCLUDED_FOR_NARROWING = frozenset({"undo_last_tool_changes"})

# High-confidence intent signatures that are safe to narrow.
_INTENT_TOOL_CLOSURE_RULES: tuple[tuple[re.Pattern[str], frozenset[str]], ...] = (
    (
        re.compile(
            r"\b(scene|scenes)\b.*\b(move|reorder|re-order|before|after|relink|re-link|scope|chapter)\b"
            r"|\b(move|reorder|re-order|relink|re-link)\b.*\b(scene|scenes)\b",
            re.IGNORECASE,
        ),
        frozenset({"manage_scenes"}),
    ),
    (
        re.compile(r"\b(scene|scenes)\b.*\b(list|show|get|read)\b", re.IGNORECASE),
        frozenset({"manage_scenes"}),
    ),
    (
        re.compile(
            r"\b(chapter|chapters)\b.*\b(summary|summaries|metadata|heading|content|write)\b"
            r"|\b(summary|summaries|metadata|heading|content)\b.*\b(chapter|chapters)\b",
            re.IGNORECASE,
        ),
        frozenset(
            {
                "get_chapter_metadata",
                "update_chapter_metadata",
                "get_chapter_summaries",
                "get_chapter_content",
                "get_current_chapter_id",
                "write_chapter_summary",
                "write_chapter_heading",
                "sync_summary",
            }
        ),
    ),
    (
        re.compile(
            r"\b(sourcebook|character|location|worldbuilding|world-building)\b",
            re.IGNORECASE,
        ),
        frozenset({"manage_sourcebook"}),
    ),
    (
        re.compile(
            r"\b(image|images|cover|art|illustration|illustrate)\b", re.IGNORECASE
        ),
        frozenset({"manage_images"}),
    ),
    (
        re.compile(r"\b(search|replace|find all|regex)\b", re.IGNORECASE),
        frozenset({"search_and_replace"}),
    ),
)


def _extract_latest_user_text(messages: list[dict[str, Any]]) -> str:
    """Extract the latest user textual content for deterministic intent routing."""
    for msg in reversed(messages):
        if str(msg.get("role") or "").lower() != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_parts: list[str] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                if str(part.get("type") or "") == "text":
                    text_val = part.get("text")
                    if isinstance(text_val, str):
                        text_parts.append(text_val)
            return "\n".join(text_parts)
    return ""


def _extract_recent_user_text(
    messages: list[dict[str, Any]], max_user_messages: int = 3
) -> str:
    """Extract recent user text across turns to preserve follow-up intent context."""
    if max_user_messages < 1:
        max_user_messages = 1

    collected: list[str] = []
    for msg in reversed(messages):
        if str(msg.get("role") or "").lower() != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            collected.append(content)
        elif isinstance(content, list):
            text_parts: list[str] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                if str(part.get("type") or "") == "text":
                    text_val = part.get("text")
                    if isinstance(text_val, str) and text_val.strip():
                        text_parts.append(text_val)
            if text_parts:
                collected.append("\n".join(text_parts))
        if len(collected) >= max_user_messages:
            break

    return "\n".join(reversed(collected))


def _narrow_story_tools_for_messages(
    story_tools: list[dict[str, Any]] | None,
    messages: list[dict[str, Any]],
    tool_choice: Any,
) -> list[dict[str, Any]] | None:
    """Narrow tool list for high-confidence intents, else keep full list.

    The selector is deterministic and conservative:
    - If no confident intent is detected, return full tools.
    - If narrowing would result in an empty/missing required set, return full tools.
    - Explicit client tool_choice overrides bypass narrowing.
    """
    if not story_tools:
        return story_tools

    # Respect explicit tool-choice directives from clients.
    if tool_choice not in (None, "", "auto"):
        return story_tools

    intent_context_text = _extract_recent_user_text(messages)
    if not intent_context_text.strip():
        return story_tools

    required_tool_names: set[str] = set()
    for pattern, required in _INTENT_TOOL_CLOSURE_RULES:
        if pattern.search(intent_context_text):
            required_tool_names.update(required)

    if not required_tool_names:
        return story_tools

    required_tool_names.update(_TOOLS_ALWAYS_INCLUDED_FOR_NARROWING)
    available_tool_names = {
        str((tool.get("function") or {}).get("name") or "") for tool in story_tools
    }

    # Fallback to full set if mandatory closure tools are not available in this role/project.
    if not required_tool_names.intersection(available_tool_names):
        return story_tools

    selected = [
        tool
        for tool in story_tools
        if str((tool.get("function") or {}).get("name") or "") in required_tool_names
    ]
    # Safety fallback: never send an empty or effectively empty narrowed set.
    if not selected:
        return story_tools

    return selected


def _is_manage_scenes_update_batch(
    tool_calls: list, project_language: str, model_type: str
) -> bool:
    """Return true when a tool-call batch is exclusively manage_scenes updates."""
    if model_type != CHAT_ROLE or len(tool_calls) < 2:
        return False

    for call in tool_calls:
        if not isinstance(call, dict):
            return False
        func = call.get("function") or {}
        name = (func.get("name") if isinstance(func, dict) else None) or ""
        if str(name) != "manage_scenes":
            return False
        args_raw = (func.get("arguments") if isinstance(func, dict) else None) or "{}"
        try:
            args_obj = (
                try_parse_json_robust(args_raw, language=project_language)
                if isinstance(args_raw, str)
                else (args_raw or {})
            )
        except (ValueError, TypeError):
            return False
        if not isinstance(args_obj, dict):
            return False
        if str(args_obj.get("action") or "").strip().lower() != "update":
            return False
    return True


def _aggregate_manage_scenes_update_batch_payload(
    buffered_messages: list[dict],
) -> tuple[Any | None, bool]:
    """Aggregate manage_scenes update messages into one payload.

    Returns (payload, ok). When ok is false, caller should fall back to raw messages.
    """
    content_scenes_by_id: OrderedDict[int, dict[str, Any]] = OrderedDict()
    scene_list_by_id: OrderedDict[int, dict[str, Any]] = OrderedDict()
    saw_content = False
    saw_placement = False

    for msg in buffered_messages:
        if not isinstance(msg, dict):
            return None, False
        content_raw = msg.get("content")
        if not isinstance(content_raw, str):
            return None, False
        try:
            payload = _json.loads(content_raw)
        except (TypeError, ValueError):
            return None, False

        if isinstance(payload, dict) and payload.get("error"):
            return None, False

        if isinstance(payload, list):
            saw_placement = True
            for entry in payload:
                if not isinstance(entry, dict):
                    continue
                scene_id = int(entry.get("scene_id") or 0)
                if scene_id <= 0:
                    continue
                if scene_id in scene_list_by_id:
                    del scene_list_by_id[scene_id]
                scene_list_by_id[scene_id] = entry
            continue

        if isinstance(payload, dict) and "scene" in payload and "scene_list" in payload:
            scene_obj = payload.get("scene")
            scene_list = payload.get("scene_list")
            if isinstance(scene_obj, dict):
                scene_id = int(scene_obj.get("id") or 0)
                if scene_id > 0:
                    if scene_id in content_scenes_by_id:
                        del content_scenes_by_id[scene_id]
                    content_scenes_by_id[scene_id] = scene_obj
                    saw_content = True
            if isinstance(scene_list, list):
                saw_placement = True
                for entry in scene_list:
                    if not isinstance(entry, dict):
                        continue
                    scene_id = int(entry.get("scene_id") or 0)
                    if scene_id <= 0:
                        continue
                    if scene_id in scene_list_by_id:
                        del scene_list_by_id[scene_id]
                    scene_list_by_id[scene_id] = entry
            continue

        if isinstance(payload, dict) and int(payload.get("id") or 0) > 0:
            scene_id = int(payload.get("id") or 0)
            if scene_id in content_scenes_by_id:
                del content_scenes_by_id[scene_id]
            content_scenes_by_id[scene_id] = payload
            saw_content = True
            continue

        return None, False

    content_scenes = list(content_scenes_by_id.values())
    scene_list = list(scene_list_by_id.values())
    if saw_placement and saw_content:
        return {
            "scenes": content_scenes,
            "scene_list": scene_list,
        }, True
    if saw_placement:
        return scene_list, True
    if saw_content:
        return content_scenes, True
    return None, False


async def _run_tool_calls(
    tool_calls: list,
    payload: dict,
    model_type: str,
    active_dir: Path | None,
    initial_mutations: dict | None = None,
) -> tuple[list[dict], dict, list[str]]:
    """Execute raw tool_calls and return (appended_messages, mutations, tool_names)."""
    appended: list[dict] = []
    mutations: dict = (
        initial_mutations if initial_mutations is not None else {"story_changed": False}
    )
    if "story_changed" not in mutations:
        mutations["story_changed"] = False
    tool_names: list[str] = []

    # Determine project language for typographic quote handling in tool arguments.
    project_language = "en"
    if active_dir:
        story_cfg = load_story_config(active_dir / "story.json") or {}
        project_language = str(story_cfg.get("language", "en") or "en")

    current_active_dir = active_dir
    aggregate_manage_scenes_updates = _is_manage_scenes_update_batch(
        tool_calls=tool_calls,
        project_language=project_language,
        model_type=model_type,
    )
    manage_scenes_update_buffer: list[dict] = []
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        call_id = str(call.get("id") or "")
        func = call.get("function") or {}
        name = (func.get("name") if isinstance(func, dict) else None) or ""
        args_raw = (func.get("arguments") if isinstance(func, dict) else None) or "{}"
        try:
            args_obj = (
                try_parse_json_robust(args_raw, language=project_language)
                if isinstance(args_raw, str)
                else (args_raw or {})
            )
        except (ValueError, TypeError):
            args_obj = {}
        if not name or not call_id:
            continue
        tool_names.append(name)

        with use_project_context(current_active_dir):
            msg = await execute_registered_tool(
                name,
                args_obj,
                call_id,
                payload,
                mutations,
                tool_role=model_type,
            )
        if isinstance(msg, dict) and "role" not in msg:
            msg = tool_message(name, call_id, msg)
        if aggregate_manage_scenes_updates:
            manage_scenes_update_buffer.append(msg)
        else:
            appended.append(msg)

        # Follow project switches initiated by tools (e.g., manage_project/create)
        # so subsequent tool calls in the same batch operate on the new project.
        switched_project_dir = get_active_project_dir()
        if switched_project_dir is not None:
            current_active_dir = switched_project_dir

    if aggregate_manage_scenes_updates:
        aggregated_payload, ok = _aggregate_manage_scenes_update_batch_payload(
            manage_scenes_update_buffer
        )
        if ok and aggregated_payload is not None and manage_scenes_update_buffer:
            aggregate_call_id = str(
                manage_scenes_update_buffer[-1].get("tool_call_id")
                or manage_scenes_update_buffer[-1].get("id")
                or "batch_manage_scenes_update"
            )
            appended.append(
                tool_message("manage_scenes", aggregate_call_id, aggregated_payload)
            )
        else:
            appended.extend(manage_scenes_update_buffer)

    return appended, mutations, tool_names


def _safe_child_path(base_dir: Path, *parts: str) -> Path:
    """Return a safe child path.."""
    try:
        return safe_child_path(base_dir, *parts)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path component")


def _validated_batch_id(batch_id: str) -> str:
    """Return a validated batch id.."""
    if not _BATCH_ID_PATTERN.fullmatch(batch_id or ""):
        raise HTTPException(status_code=400, detail="Invalid batch id")
    return batch_id


def _snapshot_storage_dir(project_dir: Path, batch_id: str) -> Path:
    """Create a snapshot storage dir.."""
    safe_batch_id = _validated_batch_id(batch_id)
    return _safe_child_path(project_dir, _CHAT_TOOL_BATCH_DIR, safe_batch_id)


def _compute_changed_chapter_ids(
    project_dir: Path,
    before: Dict[str, str],
    after: Dict[str, str],
) -> list[int]:
    """Return the virtual chapter IDs whose file content differs between snapshots."""
    from augmentedquill.services.chapters.chapter_helpers import _scan_chapter_files

    changed: list[int] = []
    for vid, abs_path in _scan_chapter_files(project_dir):
        rel_path = str(abs_path.relative_to(project_dir))
        if before.get(rel_path) != after.get(rel_path):
            changed.append(vid)
    return changed


def _store_chat_tool_batch_snapshot(
    project_dir: Path,
    batch_id: str,
    before_snapshot: Dict[str, str],
    after_snapshot: Dict[str, str],
    tool_names: list[str],
    before_chapter_id_paths: Dict[str, str],
) -> list[int]:
    """Persist before/after snapshots for reversible tool-call batches.

    Returns the list of changed chapter IDs so callers can include them in
    the mutations payload without recomputing.
    """
    target_dir = _snapshot_storage_dir(project_dir, batch_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    changed_chapter_ids = _compute_changed_chapter_ids(
        project_dir, before_snapshot, after_snapshot
    )
    metadata = {
        "batch_id": batch_id,
        "created_at": datetime.datetime.now().isoformat(),
        "tool_names": tool_names,
        "changed_chapter_ids": changed_chapter_ids,
        "chapter_id_paths": before_chapter_id_paths,
        "before": before_snapshot,
        "after": after_snapshot,
    }
    (target_dir / "batch.json").write_text(_json.dumps(metadata), encoding="utf-8")
    return changed_chapter_ids


def _load_chat_tool_batch_snapshot(project_dir: Path, batch_id: str) -> Dict[str, Any]:
    """Load chat tool batch snapshot."""
    batch_file = _snapshot_storage_dir(project_dir, batch_id) / "batch.json"
    if not batch_file.exists():
        raise HTTPException(
            status_code=404, detail=f"Unknown chat tool batch: {batch_id}"
        )
    return _json.loads(batch_file.read_text(encoding="utf-8"))


def _build_chat_tool_batch_label(tool_names: list[str]) -> str:
    """Build chat tool batch label."""
    if not tool_names:
        return "AI tool batch"
    if len(tool_names) == 1:
        return f"AI tool: {tool_names[0]}"
    if len(tool_names) == 2:
        return f"AI tools: {tool_names[0]}, {tool_names[1]}"
    return f"AI tools: {tool_names[0]} (+{len(tool_names) - 1})"


@router.get("/chat", response_model=ChatInitialStateResponse)
async def api_get_chat() -> ChatInitialStateResponse:
    """Return initial state for chat view: models and current selection."""
    machine = load_machine_config() or {}
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


@router.post("/projects/{project_name}/chat/tools")
async def api_chat_tools(
    request: Request, project_dir: ProjectDep
) -> StreamingResponse:
    """Execute OpenAI-style tool calls and stream tool messages as SSE.

    The endpoint does not call the upstream LLM; it only executes provided
    tool_calls from the last assistant message and returns corresponding
    {role:"tool"} messages.  When call_writing_llm is among the tools, prose
    chunks are streamed as ``prose_chunk`` events before the final ``result``.

    Body JSON:
      {
        "model_name": str | null,
        "messages": [
          {"role":"user|assistant|system|tool", "content": str,
           "tool_calls"?: [{"id":str, "type":"function",
                            "function": {"name": str, "arguments": str}}],
           "tool_call_id"?: str, "name"?: str}
        ],
        "active_chapter_id"?: int
      }

    SSE events emitted:
      {"type": "prose_start", "chap_id": N, "write_mode": str}  (optional)
      {"type": "prose_chunk", "accumulated": str, "chap_id": N, "write_mode": str}
      {"type": "result", "ok": true, "appended_messages": [...], "mutations": {...}}
    """
    payload = await parse_json_object_body(request)

    messages = payload.get("messages") or []
    model_type = str((payload or {}).get("model_type") or "CHAT").upper()
    if not isinstance(messages, list):
        raise HTTPException(status_code=400, detail="messages must be an array")

    last = messages[-1] if messages else None
    tool_calls: list = []
    if isinstance(last, dict):
        t = last.get("tool_calls")
        if isinstance(t, list):
            tool_calls = t

    active_project_dir = project_dir
    before_snapshot: Dict[str, str] | None = None
    before_chapter_id_paths: Dict[str, str] | None = None
    batch_id: str | None = None

    if active_project_dir and tool_calls:
        before_snapshot = capture_project_snapshot(active_project_dir)
        from augmentedquill.services.chapters.chapter_helpers import _scan_chapter_files

        before_chapter_id_paths = {
            str(vid): str(abs_path.relative_to(active_project_dir))
            for vid, abs_path in _scan_chapter_files(active_project_dir)
        }
        batch_id = f"batch-{uuid4().hex}"

    async def _gen() -> Any:
        """Helper for the requested value.."""
        stream_queue: asyncio.Queue = asyncio.Queue()
        initial_mutations: dict = {
            "story_changed": False,
            "_stream_queue": stream_queue,
        }

        result_holder: list = []

        async def _run_and_signal() -> Any:
            """Helper for and signal.."""
            try:
                appended_inner, mutations_inner, names_inner = await _run_tool_calls(
                    tool_calls,
                    payload,
                    model_type,
                    active_project_dir,
                    initial_mutations=initial_mutations,
                )
                result_holder.append(
                    (appended_inner, mutations_inner, names_inner, None)
                )
            except asyncio.CancelledError:
                result_holder.append(([], initial_mutations, [], None))
                raise
            except Exception as exc:  # noqa: BLE001
                result_holder.append(([], initial_mutations, [], exc))
            finally:
                await stream_queue.put(None)  # sentinel – signals end of stream

        task = asyncio.create_task(_run_and_signal())

        # Cancel the tool task if the client disconnects mid-stream.
        async def _watch_disconnect() -> None:
            """Cancel the running tool task when the HTTP client disconnects."""
            disconnected = await request.is_disconnected()
            if disconnected:
                task.cancel()

        watcher = asyncio.create_task(_watch_disconnect())

        # Relay prose-streaming events emitted by call_writing_llm.
        try:
            while True:
                try:
                    item = await stream_queue.get()
                except asyncio.CancelledError:
                    task.cancel()
                    raise
                if item is None:
                    break
                kind, data = item
                if kind == "prose_start":
                    yield f"data: {_json.dumps({'type': 'prose_start', **data})}\n\n"
                elif kind == "prose_chunk":
                    yield f"data: {_json.dumps({'type': 'prose_chunk', **data})}\n\n"
        finally:
            watcher.cancel()

        try:
            await task  # ensure the background task has fully finished
        except asyncio.CancelledError:
            return

        if not result_holder:
            yield f"data: {_json.dumps({'type': 'error', 'error': 'Tool execution produced no result'})}\n\n"
            yield "data: [DONE]\n\n"
            return

        appended, mutations, tool_names, exc = result_holder[0]

        if exc is not None:
            yield f"data: {_json.dumps({'type': 'error', 'error': str(exc)})}\n\n"
            yield "data: [DONE]\n\n"
            return

        # Remove internal _stream_queue key before sending mutations to client.
        mutations.pop("_stream_queue", None)

        if (
            active_project_dir
            and batch_id
            and before_snapshot is not None
            and before_chapter_id_paths is not None
            and mutations.get("story_changed")
        ):
            after_snapshot = capture_project_snapshot(active_project_dir)
            changed_chapter_ids = _store_chat_tool_batch_snapshot(
                active_project_dir,
                batch_id,
                before_snapshot,
                after_snapshot,
                tool_names,
                before_chapter_id_paths,
            )
            mutations["tool_batch"] = {
                "batch_id": batch_id,
                "tool_names": tool_names,
                "operation_count": len(tool_names),
                "label": _build_chat_tool_batch_label(tool_names),
                "changed_chapter_ids": changed_chapter_ids,
            }

        # Log tool execution if there were any
        if appended:
            log_entry = create_log_entry(
                "/api/v1/chat/tools", "POST", {}, {"tool_calls": tool_calls}
            )
            log_entry["response"]["status_code"] = 200
            log_entry["response"]["body"] = {"appended_messages": appended}
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            add_llm_log(log_entry)

        yield f"data: {_json.dumps({'type': 'result', 'ok': True, 'appended_messages': appended, 'mutations': mutations})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.post(
    "/projects/{project_name}/chat/tools/undo/{batch_id}",
    response_model=ChatToolBatchMutationResponse,
)
async def api_chat_tools_undo(
    batch_id: str, project_dir: ProjectDep
) -> ChatToolBatchMutationResponse:
    """Undo a previously executed chat-tool batch by restoring snapshot content."""
    batch = _load_chat_tool_batch_snapshot(project_dir, batch_id)
    before_snapshot = batch.get("before")
    if not isinstance(before_snapshot, dict):
        raise HTTPException(status_code=500, detail="Invalid chat tool batch snapshot")

    restore_project_snapshot(project_dir, before_snapshot)
    return ChatToolBatchMutationResponse(ok=True, batch_id=batch_id)


@router.post(
    "/projects/{project_name}/chat/tools/redo/{batch_id}",
    response_model=ChatToolBatchMutationResponse,
)
async def api_chat_tools_redo(
    batch_id: str, project_dir: ProjectDep
) -> ChatToolBatchMutationResponse:
    """Redo a previously undone chat-tool batch by restoring post-batch snapshot."""
    batch = _load_chat_tool_batch_snapshot(project_dir, batch_id)
    after_snapshot = batch.get("after")
    if not isinstance(after_snapshot, dict):
        raise HTTPException(status_code=500, detail="Invalid chat tool batch snapshot")

    restore_project_snapshot(project_dir, after_snapshot)
    return ChatToolBatchMutationResponse(ok=True, batch_id=batch_id)


@router.get(
    "/projects/{project_name}/chat/tools/batches/{batch_id}/chapter-before/{chapter_id}",
    response_model=ChapterBeforeContentResponse,
)
async def api_chat_batch_chapter_before(
    batch_id: str, chapter_id: int, project_dir: ProjectDep
) -> ChapterBeforeContentResponse:
    """Return the pre-batch content of a chapter for diff-baseline restoration.

    Used by the frontend to reconstruct the baseline state for chapters that
    were not loaded in memory when an AI tool modified them.
    """
    from augmentedquill.services.chapters.chapter_helpers import _scan_chapter_files

    batch = _load_chat_tool_batch_snapshot(project_dir, batch_id)
    before_snapshot: Dict[str, str] = batch.get("before") or {}
    chapter_id_paths = batch.get("chapter_id_paths") or {}

    original_rel_path: str | None = None
    if isinstance(chapter_id_paths, dict):
        original_rel_path = chapter_id_paths.get(str(chapter_id))

    chapter_files = _scan_chapter_files(project_dir)
    current_rel_path: str | None = None
    for vid, abs_path in chapter_files:
        if vid == chapter_id:
            current_rel_path = str(abs_path.relative_to(project_dir))
            break

    candidates = [path for path in (current_rel_path, original_rel_path) if path]
    rel_path: str | None = None
    content_b64: str | None = None
    for candidate in candidates:
        content_b64 = before_snapshot.get(candidate)
        if content_b64 is not None:
            rel_path = candidate
            break

    if rel_path is None or content_b64 is None:
        # If the chapter exists now but had no prior snapshot entry, it was
        # likely created during the batch. In that case the baseline is empty.
        if current_rel_path is not None:
            return ChapterBeforeContentResponse(content="")
        raise HTTPException(
            status_code=404, detail="Chapter not found in batch before-snapshot"
        )

    content = base64.b64decode(content_b64.encode("ascii")).decode(
        "utf-8", errors="replace"
    )
    return ChapterBeforeContentResponse(content=content)


@router.post("/projects/{project_name}/chat/stream")
async def api_chat_stream(
    request: Request, project_dir: ProjectDep
) -> StreamingResponse:
    """Stream chat with the configured OpenAI-compatible model.

    Body JSON:
      {
        "model_name": "name-of-configured-entry" | null,
        "model_type": "CHAT" | "WRITING" | "EDITING" | null,
        "messages": [{"role": "system|user|assistant", "content": str}, ...],
        // optional overrides (otherwise pulled from runtime user machine config)
        "base_url": str,
        "api_key": str,
        "model": str,
        "timeout_s": int
      }

    Returns: Streaming text response with the assistant's message.
    """
    payload = await parse_json_object_body(request)

    req_messages = normalize_chat_messages((payload or {}).get("messages"))
    if not req_messages:
        raise HTTPException(status_code=400, detail="messages array is required")

    try:
        inject_chat_attachments(req_messages, (payload or {}).get("attachments"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Load config to determine model capabilities and overrides
    machine = load_machine_config() or {}
    stream_ctx = resolve_stream_model_context(payload, machine)
    model_type = stream_ctx["model_type"]
    selected_name = stream_ctx["selected_name"]
    base_url = stream_ctx["base_url"]
    api_key = stream_ctx["api_key"]
    model_id = stream_ctx["model_id"]
    timeout_s = stream_ctx["timeout_s"]
    is_multimodal = stream_ctx["is_multimodal"]
    supports_function_calling = stream_ctx["supports_function_calling"]
    chosen = stream_ctx["chosen"]

    # Inject images if referenced in the last user message and supported
    if is_multimodal:
        await inject_project_images(req_messages)

    # Prepend system message if not present
    ensure_system_message_if_missing(
        req_messages,
        model_type=model_type,
        machine=machine,
        selected_name=selected_name,
        active_project_dir=project_dir,
    )

    # If web search is enabled, append the RESEARCH PROTOCOL to the system message
    # and track the flag for tool injection below.
    _allow_web_search: bool = bool((payload or {}).get("allow_web_search"))
    if _allow_web_search:
        for _msg in req_messages:
            if _msg.get("role") == "system":
                _content = _msg.get("content") or ""
                if "web_search" not in _content:
                    _msg["content"] = (
                        _content
                        + "\n\nWEB SEARCH ENABLED: You have access to 'web_search', "
                        "'wikipedia_search', and 'visit_page'.\n"
                        "RESEARCH PROTOCOL:\n"
                        "1. Start with 'wikipedia_search' for entities/facts, or "
                        "'web_search' for news/general info.\n"
                        "2. IMPORTANT: Do NOT rely solely on snippets. You MUST use "
                        "'visit_page' to read the full content of the top 1-3 most "
                        "relevant URLs found in the search results before formulating "
                        "your final response.\n"
                        "3. This multi-step process is required so the user can see "
                        "your research path and the actual data you are using."
                    )
                break

    # If it's a chat, inject current chapter context into the latest user message
    if model_type == CHAT_ROLE:
        try:
            story = load_story_config((project_dir or Path(".")) / "story.json") or {}
            project_lang = str(story.get("language", "en") or "en")
        except (OSError, ValueError, TypeError):
            project_lang = "en"
        inject_chat_user_context(req_messages, payload, language=project_lang)

    if not base_url or not model_id:
        raise HTTPException(
            status_code=400, detail="Missing base_url or model in configuration"
        )

    temperature, max_tokens = resolve_story_llm_prefs(
        config_dir=DEFAULT_STORY_CONFIG_PATH.parent,
        active_project_dir=project_dir,
    )

    def _to_float(value: Any) -> None:
        """Convert float."""
        try:
            if value is None or value == "":
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    def _to_int(value: Any) -> None:
        """Convert int."""
        try:
            if value is None or value == "":
                return None
            return int(value)
        except (TypeError, ValueError):
            return None

    model_temperature = _to_float((chosen or {}).get("temperature"))
    if model_temperature is None:
        model_temperature = temperature

    model_max_tokens = _to_int((chosen or {}).get("max_tokens"))
    if model_max_tokens is None:
        model_max_tokens = max_tokens

    extra_body: Dict[str, Any] = {}
    for key in (
        "top_p",
        "presence_penalty",
        "frequency_penalty",
        "seed",
        "top_k",
        "min_p",
    ):
        value = (chosen or {}).get(key)
        if value is not None:
            extra_body[key] = value

    stop = (chosen or {}).get("stop")
    if isinstance(stop, list) and stop:
        extra_body["stop"] = [str(entry) for entry in stop]

    raw_extra_body = (chosen or {}).get("extra_body")
    if isinstance(raw_extra_body, str) and raw_extra_body.strip():
        try:
            parsed_extra = _json.loads(raw_extra_body)
            if isinstance(parsed_extra, dict):
                extra_body.update(parsed_extra)
        except (_json.JSONDecodeError, TypeError):
            # Invalid JSON is ignored by design so users can save drafts safely.
            pass

    # Resolve active project type for tool schema filtering
    _active_project_type: str | None = None
    try:
        _active_story = load_story_config(project_dir / "story.json") or {}
        _active_project_type = _active_story.get("project_type") or None
    except Exception:
        pass

    # Pass through OpenAI tool-calling fields if provided
    tool_choice = None
    story_tools = get_registered_tool_schemas(
        model_type=model_type, project_type=_active_project_type
    )
    if _allow_web_search and model_type == CHAT_ROLE:
        from augmentedquill.services.chat.chat_tool_decorator import (
            get_opt_in_tool_schemas,
        )

        story_tools = (story_tools or []) + get_opt_in_tool_schemas("web-search")
    if supports_function_calling:
        tool_choice = (payload or {}).get("tool_choice")
        # If the client explicitly requests "none", do not send tools.
        # This prevents some models from hallucinating tool usage even when told not to.
        if tool_choice == "none":
            pass
        elif model_type == CHAT_ROLE:
            story_tools = _narrow_story_tools_for_messages(
                story_tools=story_tools,
                messages=req_messages,
                tool_choice=tool_choice,
            )
    if model_type == WRITING_ROLE:
        story_tools = None
        tool_choice = None
        supports_function_calling = False

    async def _gen() -> Any:
        """Gen."""
        try:
            async for chunk in llm.unified_chat_stream(
                caller_id="api.chat.stream",
                model_type=model_type,
                messages=req_messages,
                base_url=base_url,
                api_key=api_key,
                model_id=model_id,
                timeout_s=timeout_s,
                model_name=selected_name,
                supports_function_calling=supports_function_calling,
                tools=story_tools,
                tool_choice=tool_choice if tool_choice != "none" else None,
                temperature=model_temperature,
                max_tokens=model_max_tokens,
                extra_body=extra_body,
                skip_validation=True,  # Trust configured models
            ):
                # Transform to client expected format
                if "content" in chunk:
                    yield f"data: {_json.dumps({'content': chunk['content']})}\n\n"
                if "thinking" in chunk:
                    yield f"data: {_json.dumps({'thinking': chunk['thinking']})}\n\n"
                if "tool_calls" in chunk:
                    yield f"data: {_json.dumps({'tool_calls': chunk['tool_calls']})}\n\n"
        except Exception as e:
            # Mask internal errors to prevent information exposure, but log for debugability
            import logging

            logging.error(f"Chat stream error: {e}", exc_info=True)
            yield f"data: {_json.dumps({'error': f'An internal chat stream error occurred: {e}'})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.get("/projects/{project_name}/chats", response_model=ChatListResponse)
async def api_list_chats(project_dir: ProjectDep) -> ChatListResponse:
    """Handle the API request to list chats."""
    items = list_active_chats(project_dir)
    return ChatListResponse(chats=[ChatListItem(**item) for item in items])


@router.get(
    "/projects/{project_name}/chats/{chat_id}", response_model=ChatDetailResponse
)
async def api_load_chat(project_dir: ProjectDep, chat_id: str) -> ChatDetailResponse:
    """Handle the API request to load chat."""
    data = load_active_chat(project_dir, chat_id)
    return ChatDetailResponse(**data)


@router.post("/projects/{project_name}/chats/{chat_id}", response_model=OkResponse)
async def api_save_chat(
    project_dir: ProjectDep, chat_id: str, request: Request
) -> OkResponse:
    """Api Save Chat."""
    data = await parse_json_object_body(request)
    save_active_chat(project_dir, chat_id, data)
    return OkResponse(ok=True)


@router.delete("/projects/{project_name}/chats/{chat_id}", response_model=OkResponse)
async def api_delete_chat(project_dir: ProjectDep, chat_id: str) -> OkResponse:
    """Handle the API request to delete chat."""
    delete_active_chat(project_dir, chat_id)
    return OkResponse(ok=True)


@router.delete("/projects/{project_name}/chats", response_model=OkResponse)
async def api_delete_all_chats(project_dir: ProjectDep) -> OkResponse:
    """Handle the API request to delete all chats."""
    delete_all_active_chats(project_dir)
    return OkResponse(ok=True)


@router.post("/openai/models")
async def proxy_list_models(request: Request) -> JSONResponse:
    """Fetch `${base_url}/models` using provided credentials.

    Body JSON:
      {"base_url": str, "api_key": str | None, "timeout_s": int | None}

    Returns the JSON payload from the upstream (expected to include a `data` array).
    """
    payload = await parse_json_object_body(request)
    return await proxy_openai_models(payload)
