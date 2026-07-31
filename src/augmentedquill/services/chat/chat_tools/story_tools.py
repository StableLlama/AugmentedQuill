# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the story tools unit so this responsibility stays isolated, testable, and easy to evolve."""

import os
from typing import Any, Literal

from pydantic import Field

from augmentedquill.core.config import load_story_config
from augmentedquill.services.chat.chat_session_helpers import load_chat, save_chat
from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
    ToolModel,
    chat_tool,
)
from augmentedquill.services.chat.chat_tools.metadata_patching import (
    ConflictEntry,
    ConflictListPatch,
    StringListPatch,
    TextPatch,
    apply_conflict_list_patch,
    apply_string_list_patch,
    apply_text_patch,
)
from augmentedquill.services.projects.project_helpers import _snap_to_boundary
from augmentedquill.services.projects.projects import (
    get_active_project_dir,
)
from augmentedquill.services.projects.projects import (
    read_book_content as _read_book_content,
)
from augmentedquill.services.projects.projects import (
    read_editing_scratchpad as _read_editing_scratchpad,
)
from augmentedquill.services.projects.projects import (
    read_scratchpad as _read_scratchpad,
)
from augmentedquill.services.projects.projects import (
    read_story_content as _read_story_content,
)
from augmentedquill.services.projects.projects import (
    update_book_metadata as _update_book_metadata,
)
from augmentedquill.services.projects.projects import (
    update_story_metadata as _update_story_metadata,
)
from augmentedquill.services.projects.projects import (
    write_book_content as _write_book_content,
)
from augmentedquill.services.projects.projects import (
    write_editing_scratchpad as _write_editing_scratchpad,
)
from augmentedquill.services.projects.projects import (
    write_scratchpad as _write_scratchpad,
)
from augmentedquill.services.projects.projects import (
    write_story_content as _write_story_content,
)

# Pydantic models for tool parameters


class WriteStoryContentParams(ToolModel):
    """Parameters for writing story content."""

    content: str = Field(..., description="The new content for the story")


class GetBookMetadataParams(ToolModel):
    """Parameters for getting book metadata."""

    book_id: str = Field(..., description="The UUID of the book")


class UpdateBookMetadataParams(ToolModel):
    """Parameters for updating book metadata."""

    book_id: str = Field(..., description="The UUID of the book to update")
    title: str | None = Field(None, description="The new book title")
    summary: str | None = Field(None, description="The new book summary")
    notes: str | None = Field(None, description="General notes for the book")
    summary_patch: TextPatch | None = Field(
        None,
        description="Optional patch operation for partially editing summary.",
    )
    notes_patch: TextPatch | None = Field(
        None,
        description="Optional patch operation for partially editing notes.",
    )


class ReadBookContentParams(ToolModel):
    """Parameters for reading book content."""

    book_id: str = Field(..., description="The UUID of the book")
    start: int = Field(
        0,
        description="Starting character index (0-based). Ignored when read_from_end=True.",
    )
    max_chars: int = Field(
        8000,
        description="Maximum number of characters to return (max 8000).",
    )
    read_from_end: bool = Field(
        False,
        description="When True, return the last max_chars characters instead of reading from start. Useful for reading the most recent prose before appending.",
    )


class WriteBookContentParams(ToolModel):
    """Parameters for writing book content."""

    book_id: str = Field(..., description="The UUID of the book")
    content: str = Field(..., description="The new content for the book")


class ReadEditingScratchpadParams(ToolModel):
    """Parameters for reading the EDITING scratchpad (no parameters needed)."""


class WriteEditingScratchpadParams(ToolModel):
    """Parameters for writing to the EDITING scratchpad."""

    content: str = Field(
        ...,
        description="The full new content for the EDITING scratchpad. This replaces current content.",
    )


class ManageStoryCoreReadData(ToolModel):
    """Payload for story content reads."""

    start: int = Field(
        0,
        description="Starting character index (0-based). Ignored when read_from_end=True.",
    )
    max_chars: int = Field(
        8000,
        description="Maximum number of characters to return (max 8000).",
    )
    read_from_end: bool = Field(
        False,
        description="When true, reads the tail of the content instead of start.",
    )


class ManageStoryCoreUpdateData(ToolModel):
    """Payload for story metadata updates."""

    title: str | None = Field(None, description="The new story title")
    summary: str | None = Field(None, description="The new story summary")
    notes: str | None = Field(None, description="General notes for the story")
    summary_patch: TextPatch | None = Field(
        None,
        description="Optional patch operation for partially editing summary.",
    )
    notes_patch: TextPatch | None = Field(
        None,
        description="Optional patch operation for partially editing notes.",
    )
    tags: list[str] | None = Field(None, description="List of tags for the story")
    tags_patch: StringListPatch | None = Field(
        None,
        description="Optional patch operation for tags (add/remove/set/clear).",
    )
    conflicts: list[ConflictEntry] | None = Field(
        None,
        description=(
            "List of active story conflicts. Each entry should include a "
            "description, optional resolution, and resolved flag."
        ),
    )
    conflicts_patch: ConflictListPatch | None = Field(
        None,
        description=(
            "Optional ordered operations for partial conflict updates. "
            "Use index-based operations: append new conflict with {conflict:{...}} (no index), "
            "update existing with {index:<0-based>, updates:{...}}, replace existing with "
            "{index:<0-based>, conflict:{...}}, and remove with {index:<0-based>}."
        ),
    )


class ManageStoryCoreSyncData(ToolModel):
    """Payload for story summary synchronization."""

    mode: str = Field(
        "",
        description="Generation mode: 'discard' or 'update' (empty defaults to 'update').",
    )


class ManageStoryCoreParams(ToolModel):
    """Action router parameters for manage_story_core."""

    action: Literal[
        "get_metadata", "update_metadata", "read_content", "sync_summary"
    ] = Field(
        ...,
        description=(
            "Action to execute: 'get_metadata', 'update_metadata', 'read_content', "
            "or 'sync_summary'."
        ),
    )
    update_data: ManageStoryCoreUpdateData | None = Field(
        None,
        description="Required when action='update_metadata'.",
    )
    read_data: ManageStoryCoreReadData | None = Field(
        None,
        description="Optional when action='read_content'. Defaults are applied when omitted.",
    )
    sync_data: ManageStoryCoreSyncData | None = Field(
        None,
        description="Optional when action='sync_summary'. Defaults to update mode.",
    )


class ManageScratchpadWriteData(ToolModel):
    """Payload for scratchpad writes."""

    content: str = Field(
        ...,
        description="The full new content for the scratchpad. This replaces current content.",
    )
    chat_id: str | None = Field(
        None,
        description="Optional chat ID. Falls back to request chat_id or project scratchpad.",
    )


class ManageScratchpadParams(ToolModel):
    """Action router parameters for manage_scratchpad."""

    action: Literal["read", "write"] = Field(
        ...,
        description="Scratchpad action: 'read' or 'write'.",
    )
    chat_id: str | None = Field(
        None,
        description="Optional chat ID for action='read'.",
    )
    write_data: ManageScratchpadWriteData | None = Field(
        None,
        description="Required when action='write'.",
    )


# Tool implementations with co-located schemas


@chat_tool(
    description=(
        "Unified story core manager. Use action='get_metadata' to read story-level "
        "metadata, action='update_metadata' to patch title/summary/notes/tags/conflicts "
        "(requires update_data), action='read_content' to read story-level prose "
        "(optional read_data), and action='sync_summary' to regenerate summary "
        "(optional sync_data.mode). For update_data.conflicts_patch: this is index-based. "
        "To append a new conflict, use operations:[{conflict:{description:'...',resolution:'...'}}]. "
        "To update an existing conflict, use operations:[{index:0, updates:{resolution:'...'}}]."
    ),
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="metadata-read",
)
async def manage_story_core(
    params: ManageStoryCoreParams, payload: dict, mutations: dict
) -> Any:
    """Route story-core actions to existing atomic metadata/content operations."""
    if params.action == "get_metadata":
        active = get_active_project_dir()
        story = load_story_config((active / "story.json") if active else None) or {}
        return {
            "title": story.get("project_title", ""),
            "summary": story.get("story_summary", ""),
            "notes": story.get("notes", ""),
            "tags": story.get("tags", []),
            "conflicts": story.get("conflicts", []),
            "project_type": story.get("project_type", "novel"),
        }

    if params.action == "update_metadata":
        if params.update_data is None:
            return {"error": "update_data is required when action='update_metadata'."}
        active = get_active_project_dir()
        story = load_story_config((active / "story.json") if active else None) or {}

        summary_value = params.update_data.summary
        if params.update_data.summary_patch is not None:
            summary_value = apply_text_patch(
                story.get("story_summary", ""), params.update_data.summary_patch
            )

        notes_value = params.update_data.notes
        if params.update_data.notes_patch is not None:
            notes_value = apply_text_patch(
                story.get("notes", ""), params.update_data.notes_patch
            )

        tags_value = params.update_data.tags
        if params.update_data.tags_patch is not None:
            tags_value = apply_string_list_patch(
                story.get("tags") or [], params.update_data.tags_patch
            )

        conflicts_value = params.update_data.conflicts
        if params.update_data.conflicts_patch is not None:
            conflicts_value = apply_conflict_list_patch(
                story.get("conflicts") or [],
                params.update_data.conflicts_patch,
            )
        elif isinstance(conflicts_value, list):
            conflicts_value = [
                conflict.model_dump() if hasattr(conflict, "model_dump") else conflict
                for conflict in conflicts_value
            ]

        _update_story_metadata(
            title=params.update_data.title,
            summary=summary_value,
            notes=notes_value,
            tags=tags_value,
            conflicts=conflicts_value,
        )
        mutations["story_changed"] = True
        return {"ok": True, "message": "Story metadata updated successfully"}

    if params.action == "read_content":
        read_data = params.read_data or ManageStoryCoreReadData()
        content = _read_story_content() or ""
        max_chars = max(1, min(8000, read_data.max_chars))
        total = len(content)
        if read_data.read_from_end:
            raw_start = max(0, total - max_chars)
            start = _snap_to_boundary(content, raw_start, forward=False)
            end = total
        else:
            start = max(0, read_data.start)
            raw_end = min(total, start + max_chars)
            end = min(total, _snap_to_boundary(content, raw_end, forward=True))
        return {
            "content": content[start:end],
            "start": start,
            "end": end,
            "total": total,
        }

    if params.action == "sync_summary":
        from augmentedquill.services.story.story_generation_ops import (
            generate_story_summary,
        )

        mode = (params.sync_data.mode if params.sync_data else "") or ""
        data = await generate_story_summary(mode=mode)
        mutations["story_changed"] = True
        return data

    return {"error": f"Unsupported action: {params.action}"}


@chat_tool(
    description=(
        "Unified scratchpad manager for CHAT state. Use action='read' to read the "
        "scratchpad (optional chat_id), or action='write' to replace scratchpad "
        "content (requires write_data.content)."
    ),
    allowed_roles=(CHAT_ROLE,),
    capability="metadata-read",
)
async def manage_scratchpad(
    params: ManageScratchpadParams, payload: dict, mutations: dict
) -> Any:
    """Route scratchpad read/write actions to existing scratchpad storage helpers."""
    if params.action == "read":
        chat_id = params.chat_id or (payload or {}).get("chat_id")
        if chat_id:
            return {"content": _read_scratchpad_from_chat(chat_id)}
        return {"content": _read_scratchpad()}

    if params.action == "write":
        if params.write_data is None:
            return {"error": "write_data is required when action='write'."}
        chat_id = params.write_data.chat_id or (payload or {}).get("chat_id")
        if chat_id:
            _write_scratchpad_to_chat(chat_id, params.write_data.content)
        else:
            _write_scratchpad(params.write_data.content)
        mutations["story_changed"] = True
        return {"ok": True}

    return {"error": f"Unsupported action: {params.action}"}


@chat_tool(
    description=(
        "Overwrite the ENTIRE story-level content file. WARNING: replaces all existing text. "
        "Use this only when the current task explicitly targets the story-level content file."
    ),
    allowed_roles=(EDITING_ROLE,),
    capability="prose-write",
)
async def write_story_content(
    params: WriteStoryContentParams, payload: dict, mutations: dict
) -> Any:
    """Write story content."""
    _write_story_content(params.content)
    mutations["story_changed"] = True
    return {"ok": True}


@chat_tool(
    description="Get the title, summary, and notes of a specific book (only for series projects).",
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="metadata-read",
    project_types=("series",),
)
async def get_book_metadata(
    params: GetBookMetadataParams, payload: dict, mutations: dict
) -> Any:
    """Get Book Metadata."""
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    books = story.get("books", [])

    # Security: Ensure book_id has no path traversal components
    book_id = os.path.basename(params.book_id) if params.book_id else ""

    target = next((b for b in books if b.get("id") == book_id), None)
    if not target:
        return {"error": f"Book ID {book_id} not found"}
    return {
        "title": target.get("title", ""),
        "summary": target.get("summary", ""),
        "notes": target.get("notes", ""),
    }


@chat_tool(
    description=(
        "Update the title, summary, or notes of a specific book. "
        "Use summary_patch/notes_patch for safe partial edits that preserve remaining text."
    ),
    allowed_roles=(CHAT_ROLE,),
    capability="metadata-write",
    project_types=("series",),
)
async def update_book_metadata(
    params: UpdateBookMetadataParams, payload: dict, mutations: dict
) -> Any:
    """Update Book Metadata."""
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    books = story.get("books", [])

    book_id = os.path.basename(params.book_id) if params.book_id else ""
    target = next(
        (b for b in books if b.get("id") == book_id or b.get("folder") == book_id),
        None,
    )
    if not target:
        return {"error": f"Book ID {book_id} not found"}

    summary_value = params.summary
    if params.summary_patch is not None:
        summary_value = apply_text_patch(
            target.get("summary", ""), params.summary_patch
        )

    notes_value = params.notes
    if params.notes_patch is not None:
        notes_value = apply_text_patch(target.get("notes", ""), params.notes_patch)

    _update_book_metadata(
        params.book_id,
        title=params.title,
        summary=summary_value,
        notes=notes_value,
    )
    mutations["story_changed"] = True
    return {"ok": True}


@chat_tool(
    description="Read the content file for a specific book. Use read_from_end=True to read the last max_chars characters.",
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="metadata-read",
    project_types=("series",),
)
async def read_book_content(
    params: ReadBookContentParams, payload: dict, mutations: dict
) -> Any:
    """Read book content."""
    content = _read_book_content(params.book_id) or ""
    max_chars = max(1, min(8000, params.max_chars))
    total = len(content)
    if params.read_from_end:
        raw_start = max(0, total - max_chars)
        start = _snap_to_boundary(content, raw_start, forward=False)
        end = total
    else:
        start = max(0, params.start)
        raw_end = min(total, start + max_chars)
        end = min(total, _snap_to_boundary(content, raw_end, forward=True))
    return {
        "content": content[start:end],
        "start": start,
        "end": end,
        "total": total,
    }


@chat_tool(
    description=(
        "Overwrite the ENTIRE content file for a specific book. "
        "WARNING: replaces all existing text — only use for short books or complete rewrites. "
        "For targeted edits prefer replace_text_in_chapter."
    ),
    allowed_roles=(EDITING_ROLE,),
    capability="prose-write",
    project_types=("series",),
)
async def write_book_content(
    params: WriteBookContentParams, payload: dict, mutations: dict
) -> Any:
    """Write book content."""
    _write_book_content(params.book_id, params.content)
    mutations["story_changed"] = True
    return {"ok": True}


def _normalize_chat_id(chat_id: str | None) -> str | None:
    """Normalize chat id."""
    if not chat_id or not isinstance(chat_id, str):
        return None
    normalized = os.path.basename(chat_id.strip())
    return normalized if normalized else None


def _read_scratchpad_from_chat(chat_id: str | None) -> str:
    """Read scratchpad from chat."""
    safe_id = _normalize_chat_id(chat_id)
    if not safe_id:
        return ""

    chat_data = load_chat(get_active_project_dir(), safe_id)
    if not chat_data:
        return ""

    return str(chat_data.get("scratchpad", ""))


def _write_scratchpad_to_chat(chat_id: str | None, content: str) -> None:
    """Write scratchpad to chat."""
    safe_id = _normalize_chat_id(chat_id)
    if not safe_id:
        raise ValueError("Invalid chat_id")

    project_dir = get_active_project_dir()
    if not project_dir:
        raise ValueError("No active project")

    chat_data = load_chat(project_dir, safe_id) or {
        "id": safe_id,
        "name": f"Chat {safe_id}",
        "messages": [],
        "systemPrompt": "",
        "allowWebSearch": False,
    }
    chat_data["scratchpad"] = content
    save_chat(project_dir, safe_id, chat_data)


# ---------------------------------------------------------------------------
# EDITING scratchpad (separate from the CHAT scratchpad)
# ---------------------------------------------------------------------------


@chat_tool(
    description=(
        "Read the per-chat EDITING scratchpad. "
        "Editing scratchpad is temporary and chat-specific; important decisions belong in notes or sourcebook."
    ),
    allowed_roles=(EDITING_ROLE,),
    capability="metadata-read",
)
async def read_editing_scratchpad(
    params: ReadEditingScratchpadParams, payload: dict, mutations: dict
) -> Any:
    """Read Editing Scratchpad."""
    chat_id = (payload or {}).get("chat_id")
    if chat_id:
        safe_id = _normalize_chat_id(chat_id)
        if safe_id:
            chat_data = load_chat(get_active_project_dir(), safe_id)
            return {
                "content": (
                    str(chat_data.get("editing_scratchpad", "")) if chat_data else ""
                )
            }
    return {"content": _read_editing_scratchpad()}


@chat_tool(
    description=(
        "Write the per-chat EDITING scratchpad. "
        "Editing scratchpad is temporary and chat-specific; important decisions belong in notes or sourcebook."
    ),
    allowed_roles=(EDITING_ROLE,),
    capability="metadata-write",
)
async def write_editing_scratchpad(
    params: WriteEditingScratchpadParams, payload: dict, mutations: dict
) -> Any:
    """Write Editing Scratchpad."""
    chat_id = (payload or {}).get("chat_id")
    if chat_id:
        safe_id = _normalize_chat_id(chat_id)
        if safe_id:
            project_dir = get_active_project_dir()
            if not project_dir:
                raise ValueError("No active project")
            chat_data = load_chat(project_dir, safe_id) or {
                "id": safe_id,
                "name": f"Chat {safe_id}",
                "messages": [],
                "systemPrompt": "",
                "allowWebSearch": False,
            }
            chat_data["editing_scratchpad"] = params.content
            save_chat(project_dir, safe_id, chat_data)
            return {"ok": True}
    _write_editing_scratchpad(params.content)
    return {"ok": True}
