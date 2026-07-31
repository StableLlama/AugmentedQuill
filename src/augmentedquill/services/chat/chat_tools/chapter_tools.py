# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chapter tools unit so this responsibility stays isolated, testable, and easy to evolve."""

import json as _json
from typing import Any

from pydantic import Field

from augmentedquill.core.config import load_story_config
from augmentedquill.services.chapters.chapter_helpers import (
    _chapter_by_id_or_404,
    _get_chapter_metadata_entry,
    _scan_chapter_files,
)
from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
    WRITING_ROLE,
    ToolModel,
    chat_tool,
)
from augmentedquill.services.chat.chat_tools.metadata_patching import (
    ConflictEntry,
    ConflictListPatch,
    TextPatch,
    apply_conflict_list_patch,
    apply_text_patch,
)
from augmentedquill.services.projects.project_helpers import (
    _project_overview,
    _snap_to_boundary,
)
from augmentedquill.services.projects.projects import (
    create_new_chapter as _create_new_chapter,
)
from augmentedquill.services.projects.projects import (
    get_active_project_dir,
    write_chapter_title,
)
from augmentedquill.services.projects.projects import (
    update_chapter_metadata as _update_chapter_metadata,
)
from augmentedquill.services.projects.projects import (
    write_chapter_content as _write_chapter_content,
)
from augmentedquill.services.projects.projects import (
    write_chapter_summary as _write_chapter_summary,
)
from augmentedquill.services.story.story_generation_ops import (
    continue_chapter_from_summary,
    generate_chapter_summary,
    write_chapter_from_summary,
)

_MAX_CHAPTER_CHARS = 8000


def _overview_chapters() -> Any:
    """Overview Chapters."""
    ov = _project_overview()
    chapters = []
    if ov.get("project_type") == "series":
        for book in ov.get("books", []):
            chapters.extend(book.get("chapters", []))
    else:
        chapters = ov.get("chapters", [])
    return ov, chapters


def _find_chapter(
    ov: dict, chap_id: int | None = None, book_id: str | None = None
) -> Any:
    """Find a chapter record by ID and optional book_id."""
    if chap_id is None:
        return None, None

    p_type = ov.get("project_type", "novel")
    if p_type == "series":
        for book in ov.get("books", []):
            if book_id is not None and str(book.get("id")) != str(book_id):
                continue
            for chap in book.get("chapters", []):
                if isinstance(chap, dict) and chap.get("id") == chap_id:
                    return chap, book
        return None, None

    for chap in ov.get("chapters", []):
        if isinstance(chap, dict) and chap.get("id") == chap_id:
            return chap, None
    return None, None


def compose_current_chapter_state(payload: dict) -> dict | None:
    """Compose centralized current-chapter state payload for tool injection and explicit call.

    Returns only the minimal required fields:
      - chapter_id
      - chapter_title
      - book_id (series only)

    This ensures LLM tool is minimal and explicit additional data must be requested.
    """
    if not isinstance(payload, dict):
        return None

    # Resolve IDs from explicit fields or current_chapter helper object
    chap_id = payload.get("active_chapter_id")
    book_id = payload.get("active_book_id")
    if not isinstance(chap_id, int):
        cc = payload.get("current_chapter")
        if isinstance(cc, dict):
            chap_id = cc.get("id")
            if not isinstance(chap_id, int):
                try:
                    chap_id = int(chap_id)
                except Exception:
                    chap_id = None
            if book_id is None:
                book_id = cc.get("book_id")

    if not isinstance(chap_id, int):
        return None

    ov, _ = _overview_chapters()
    chap, book = _find_chapter(ov, chap_id=chap_id, book_id=book_id)
    if not chap:
        # fall back to minimal current_chapter object to avoid hidden context failure
        cc = payload.get("current_chapter")
        if isinstance(cc, dict) and cc.get("id") == chap_id:
            fallback = {
                "chapter_id": chap_id,
                "chapter_title": cc.get("title"),
            }
            if "book_id" in cc:
                fallback["book_id"] = cc.get("book_id")
            return fallback
        return None

    state = {
        "chapter_id": chap.get("id"),
        "chapter_title": chap.get("title"),
    }
    if book:
        state["book_id"] = book.get("id")

    return state


# ============================================================================
# Tool Parameter Models
# ============================================================================


class GetChapterMetadataParams(ToolModel):
    """Represents the GetChapterMetadataParams type."""

    chap_id: int | None = Field(
        None,
        description="The chapter ID to get metadata for. If omitted and current is true, the active chapter is used.",
    )
    book_id: str | None = Field(
        None,
        description="Optional book id for series projects to narrow the chapter lookup.",
    )
    current: bool = Field(
        False,
        description="If true, return metadata for the current active chapter from payload rather than the explicit chap_id.",
    )


class UpdateChapterMetadataParams(ToolModel):
    """Represents the UpdateChapterMetadataParams type."""

    chap_id: int = Field(..., description="The chapter ID to update metadata for")
    title: str | None = Field(None, description="The chapter title")
    summary: str | None = Field(None, description="The chapter summary")
    notes: str | None = Field(None, description="Public notes about the chapter")
    summary_patch: TextPatch | None = Field(
        None,
        description=(
            "Optional partial summary edit object. "
            "Use {operation:'replace'|'append'|'prepend', value:'...'} or "
            "{operation:'replace_text', old_text:'...', new_text:'...', occurrence:'first|last|all|unique'}."
        ),
    )
    notes_patch: TextPatch | None = Field(
        None,
        description=(
            "Optional partial notes edit object. "
            "Use {operation:'replace'|'append'|'prepend', value:'...'} or "
            "{operation:'replace_text', old_text:'...', new_text:'...', occurrence:'first|last|all|unique'}."
        ),
    )
    conflicts: list[ConflictEntry] | str | None = Field(
        None,
        description=(
            "List of chapter conflicts (or a JSON string containing that list). "
            "Each conflict should include description, optional resolution, and a "
            "resolved flag when the conflict is no longer active."
        ),
    )
    conflicts_patch: ConflictListPatch | None = Field(
        None,
        description=(
            "Optional conflict patch object: {operations:[...]}. "
            "Each operation: {index:<int>, updates:{...}} to update fields of an existing conflict, "
            "{conflict:{...}} to append a new conflict, "
            "{index:<int>} to remove a conflict. "
            "op is inferred automatically; only set it explicitly for 'insert' or 'clear'."
        ),
    )


class GetChapterSummariesParams(ToolModel):
    """Represents the GetChapterSummariesParams type."""


class GetChapterContentParams(ToolModel):
    """Represents the GetChapterContentParams type."""

    chap_id: int | None = Field(
        None,
        description="The chapter ID to get content for. If not provided, uses active chapter.",
    )
    start: int = Field(
        0,
        description="The starting character position. Ignored when read_from_end=True.",
    )
    max_chars: int = Field(
        _MAX_CHAPTER_CHARS,
        description=f"Maximum characters to return (1-{_MAX_CHAPTER_CHARS})",
    )
    read_from_end: bool = Field(
        False,
        description="When True, return the last max_chars characters instead of reading from start. Useful for reading the most recent prose before appending.",
    )


class GetCurrentChapterParams(ToolModel):
    """No parameters required, active chapter is inferred from context."""


class WriteChapterContentParams(ToolModel):
    """Represents the WriteChapterContentParams type."""

    chap_id: int = Field(..., description="The chapter ID to write content to")
    content: str = Field(..., description="The content to write")


class ReplaceTextInChapterParams(ToolModel):
    """Represents the ReplaceTextInChapterParams type."""

    chap_id: int = Field(..., description="The chapter ID to edit")
    old_text: str = Field(..., description="The exact literal text to replace")
    new_text: str = Field(..., description="The new text to insert instead")


class WriteChapterSummaryParams(ToolModel):
    """Represents the WriteChapterSummaryParams type."""

    chap_id: int = Field(..., description="The chapter ID to write summary to")
    summary: str = Field(..., description="The summary to write")


class SyncSummaryParams(ToolModel):
    """Represents the SyncSummaryParams type."""

    chap_id: int = Field(..., description="The chapter ID to generate summary for")
    mode: str = Field(
        "",
        description="The mode for summary generation (e.g., 'detailed', 'brief')",
    )


class WriteChapterParams(ToolModel):
    """Represents the WriteChapterParams type."""

    chap_id: int = Field(
        ..., description="The chapter ID to write full chapter content for"
    )


class ContinueChapterParams(ToolModel):
    """Represents the ContinueChapterParams type."""

    chap_id: int = Field(..., description="The chapter ID to continue writing")


class CreateNewChapterParams(ToolModel):
    """Represents the CreateNewChapterParams type."""

    title: str = Field("", description="The title for the new chapter")
    book_id: str | None = Field(
        None, description="The book ID (UUID) if project is a series"
    )


class GetChapterHeadingParams(ToolModel):
    """Represents the GetChapterHeadingParams type."""

    chap_id: int = Field(..., description="The chapter ID to get heading for")


class WriteChapterHeadingParams(ToolModel):
    """Represents the WriteChapterHeadingParams type."""

    chap_id: int = Field(..., description="The chapter ID to write heading to")
    heading: str = Field(..., description="The heading to write")


class GetChapterSummaryParams(ToolModel):
    """Represents the GetChapterSummaryParams type."""

    chap_id: int = Field(..., description="The chapter ID to get summary for")


class DeleteChapterParams(ToolModel):
    """Represents the DeleteChapterParams type."""

    chap_id: int = Field(..., description="The chapter ID to delete")
    confirm: bool = Field(False, description="Set to true to confirm deletion")


class RecommendMetadataUpdatesParams(ToolModel):
    """Represents the RecommendMetadataUpdatesParams type."""

    story_summary: str | None = Field(
        None,
        description="Suggested replacement or refinement for the story summary.",
    )
    story_notes: str | None = Field(
        None,
        description="Suggested addition or revision for story-level notes.",
    )
    story_tags: list[str] | None = Field(
        None,
        description="Suggested story style tags if they should be revised.",
    )
    chapter_updates: list[dict] = Field(
        default_factory=list,
        description="Suggested chapter metadata changes such as summary, notes, conflicts, or reminders.",
    )
    sourcebook_updates: list[dict] = Field(
        default_factory=list,
        description="Suggested sourcebook additions or updates for CHAT to review and apply.",
    )
    rationale: str | None = Field(
        None,
        description="Short explanation of why these metadata changes are recommended.",
    )


# ============================================================================
# Tool Implementations
# ============================================================================


@chat_tool(
    description=(
        "Get metadata for a specific chapter including title, summary, notes, and conflicts. "
        "Conflicts are treated as current unresolved story threads that the assistant should prioritize when generating text."
    ),
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="metadata-read",
)
async def get_chapter_metadata(
    params: GetChapterMetadataParams, payload: dict, mutations: dict
) -> Any:
    """Get Chapter Metadata."""
    ov, _ = _overview_chapters()

    if params.current:
        chap_id = payload.get("active_chapter_id")
        book_id = payload.get("active_book_id")
    else:
        chap_id = params.chap_id
        book_id = params.book_id

    if not isinstance(chap_id, int):
        return {"error": "chap_id is required unless current=true is set"}

    chap, book = _find_chapter(ov, chap_id=chap_id, book_id=book_id)
    if not chap:
        return {"error": f"Chapter {chap_id} not found"}

    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    _, path, _ = _chapter_by_id_or_404(chap_id)
    meta = _get_chapter_metadata_entry(story, chap_id, path) or {}

    result = {
        "chapter": {
            "id": chap.get("id"),
            "title": chap.get("title"),
            "summary": chap.get("summary"),
            "notes": meta.get("notes", ""),
            "conflicts": meta.get("conflicts") or [],
        },
        "project_type": ov.get("project_type"),
    }

    # Add lightweight size hints so callers can budget read calls
    _, chap_path, _ = _chapter_by_id_or_404(chap_id)
    try:
        raw = chap_path.read_bytes()
        char_count = len(raw.decode("utf-8", errors="replace"))
        word_count = len(
            chap_path.read_text(encoding="utf-8", errors="replace").split()
        )
        result["char_count"] = char_count
        result["word_count"] = word_count
    except OSError:
        pass

    if book:
        result["current_book"] = {
            "id": book.get("id"),
            "title": book.get("title"),
        }

    return result


@chat_tool(
    description=(
        "Update metadata for a specific chapter (title, summary, notes, conflicts). "
        "Use summary_patch/notes_patch/conflicts_patch for safe partial edits that keep existing content. "
        "summary_patch/notes_patch must be patch objects. "
        "conflicts_patch should be {operations:[...]} with index-based operations. "
        "Chapter conflicts are treated as active story arcs; include resolved status changes when needed. "
        "conflicts_patch is index-based (operations[].index) and does not support JSON Patch path pointers."
    ),
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="metadata-write",
)
async def update_chapter_metadata(
    params: UpdateChapterMetadataParams, payload: dict, mutations: dict
) -> Any:
    """Update Chapter Metadata."""
    conflicts = params.conflicts
    if isinstance(conflicts, str):
        try:
            conflicts = _json.loads(conflicts)
        except Exception:
            conflicts = None
    elif isinstance(conflicts, list):
        conflicts = [
            conflict.model_dump() if hasattr(conflict, "model_dump") else conflict
            for conflict in conflicts
        ]

    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    files = _scan_chapter_files(active)
    _, path, _ = _chapter_by_id_or_404(params.chap_id, active=active)
    current_meta = (
        _get_chapter_metadata_entry(
            story,
            params.chap_id,
            path,
            files=files,
            active=active,
        )
        or {}
    )

    summary_value = params.summary
    if params.summary_patch is not None:
        summary_value = apply_text_patch(
            current_meta.get("summary", ""), params.summary_patch
        )

    notes_value = params.notes
    if params.notes_patch is not None:
        notes_value = apply_text_patch(
            current_meta.get("notes", ""), params.notes_patch
        )

    conflicts_value = conflicts
    if params.conflicts_patch is not None:
        current_conflicts = current_meta.get("conflicts")
        if not isinstance(current_conflicts, list):
            current_conflicts = []
        conflicts_value = apply_conflict_list_patch(
            current_conflicts,
            params.conflicts_patch,
        )

    fields_set = set(params.model_fields_set)
    current_summary = current_meta.get("summary") or ""
    current_notes = current_meta.get("notes")
    current_conflicts = current_meta.get("conflicts")
    if not isinstance(current_conflicts, list):
        current_conflicts = []

    changed_fields: list[str] = []

    title_to_write: str | None = None
    if "title" in fields_set and params.title is not None:
        next_title = params.title.strip()
        if next_title != str(current_meta.get("title") or "").strip():
            title_to_write = params.title
            changed_fields.append("title")

    summary_requested = "summary" in fields_set or params.summary_patch is not None
    summary_to_write: str | None = None
    if summary_requested and summary_value is not None:
        next_summary = summary_value.strip()
        if next_summary != current_summary:
            summary_to_write = summary_value
            changed_fields.append("summary")

    notes_requested = "notes" in fields_set or params.notes_patch is not None
    notes_to_write: str | None = None
    if notes_requested and notes_value is not None and notes_value != current_notes:
        notes_to_write = notes_value
        changed_fields.append("notes")

    conflicts_requested = (
        "conflicts" in fields_set or params.conflicts_patch is not None
    )
    conflicts_to_write: list | None = None
    if (
        conflicts_requested
        and conflicts_value is not None
        and conflicts_value != current_conflicts
    ):
        conflicts_to_write = conflicts_value
        changed_fields.append("conflicts")

    if not changed_fields:
        return {
            "ok": True,
            "changed": False,
            "changed_fields": [],
            "message": f"No metadata changes for chapter {params.chap_id}",
            "chap_id": params.chap_id,
        }

    _update_chapter_metadata(
        params.chap_id,
        title=title_to_write,
        summary=summary_to_write,
        notes=notes_to_write,
        conflicts=conflicts_to_write,
        active=active,
    )
    mutations["story_changed"] = True
    return {
        "ok": True,
        "changed": True,
        "changed_fields": changed_fields,
        "message": f"Metadata updated for chapter {params.chap_id}",
        "chap_id": params.chap_id,
    }


@chat_tool(
    description="Get summaries for all chapters in the project (across all books if series).",
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="metadata-read",
)
async def get_chapter_summaries(
    params: GetChapterSummariesParams, payload: dict, mutations: dict
) -> Any:
    """Get Chapter Summaries."""
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
            summary = chapter.get("summary", "")
            summaries.append(
                {"chapter_id": chap_id, "title": title, "summary": summary}
            )
    return {"chapter_summaries": summaries}


@chat_tool(
    description="Get content from a specific chapter with pagination support. Use read_from_end=True to read the last max_chars characters, which is recommended before appending prose.",
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="prose-read",
)
async def get_chapter_content(
    params: GetChapterContentParams, payload: dict, mutations: dict
) -> Any:
    """Get Chapter Content."""
    chap_id = params.chap_id
    if chap_id is None:
        ac = payload.get("active_chapter_id")
        if isinstance(ac, int):
            chap_id = ac
    if not isinstance(chap_id, int):
        return {"error": "chap_id is required"}

    max_chars = max(1, min(_MAX_CHAPTER_CHARS, params.max_chars))
    _, path, _ = _chapter_by_id_or_404(chap_id)
    text = path.read_text(encoding="utf-8")
    total = len(text)

    if params.read_from_end:
        raw_start = max(0, total - max_chars)
        start = _snap_to_boundary(text, raw_start, forward=False)
        end = total
    else:
        start = max(0, params.start)
        raw_end = min(total, start + max_chars)
        end = min(total, _snap_to_boundary(text, raw_end, forward=True))

    return {
        "id": chap_id,
        "start": start,
        "end": end,
        "total": total,
        "content": text[start:end],
    }


@chat_tool(
    name="get_current_chapter_id",
    description="Get current application chapter identifier (active chapter id/title + optional book id).",
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="metadata-read",
)
async def get_current_chapter_id(
    params: GetCurrentChapterParams, payload: dict, mutations: dict
) -> Any:
    """Get Current Chapter ID state."""
    state = compose_current_chapter_state(payload)
    if not state:
        return {"error": "active_chapter_id (or current_chapter object) is required"}
    return state


@chat_tool(
    description=(
        "Overwrite the ENTIRE content of a chapter. "
        "WARNING: replaces all existing text – only use for short chapters or complete rewrites. "
        "For targeted edits prefer replace_text_in_chapter or apply_chapter_replacements."
    ),
    allowed_roles=(EDITING_ROLE,),
    capability="prose-write",
)
async def write_chapter_content(
    params: WriteChapterContentParams, payload: dict, mutations: dict
) -> Any:
    """Write chapter content."""
    _write_chapter_content(params.chap_id, params.content)
    mutations["story_changed"] = True
    return {"message": f"Content written to chapter {params.chap_id} successfully"}


@chat_tool(
    description="Replace an exact literal string in a chapter with a new string. Better for small edits to avoid JSON truncation errors.",
    allowed_roles=(EDITING_ROLE,),
    capability="prose-write",
)
async def replace_text_in_chapter(
    params: ReplaceTextInChapterParams, payload: dict, mutations: dict
) -> Any:
    """Replace text in chapter."""
    # Retrieve current text
    _, path, _pos = _chapter_by_id_or_404(params.chap_id)
    text = path.read_text(encoding="utf-8")

    if params.old_text not in text:
        return {
            "error": "The exact old_text was not found in the chapter. Please ensure it matches exactly or use get_chapter_content to verify the exact string."
        }

    occurrences = text.count(params.old_text)
    if occurrences > 1:
        return {
            "error": f"The old_text was found {occurrences} times. Please provide a more specific old_text to ensure only one instance is replaced, or replace them one by one."
        }

    new_content = text.replace(params.old_text, params.new_text, 1)
    _write_chapter_content(params.chap_id, new_content)
    mutations["story_changed"] = True
    return {"message": f"Successfully replaced text in chapter {params.chap_id}"}


MARKER = "~~~"


class InsertTextAtMarkerParams(ToolModel):
    """Parameters for inserting text at the fixed marker in a chapter."""

    chap_id: int = Field(..., description="The numeric ID of the chapter.")
    insert_text: str = Field(..., description="Text to insert at the marker location.")
    mode: str = Field(
        "replace",
        description="How to insert relative to the marker: 'replace' (default), 'before', or 'after'.",
    )


@chat_tool(
    description="Insert or replace text at a specific marker string in a chapter.",
    allowed_roles=(EDITING_ROLE,),
    capability="prose-write",
)
async def insert_text_at_marker(
    params: InsertTextAtMarkerParams, payload: dict, mutations: dict
) -> Any:
    """Insert text at marker."""
    _, path, _pos = _chapter_by_id_or_404(params.chap_id)
    text = path.read_text(encoding="utf-8")

    idx = text.find(MARKER)
    if idx < 0:
        return {"error": f"Marker '{MARKER}' not found in chapter {params.chap_id}."}

    if params.mode == "replace":
        new_text = text[:idx] + params.insert_text + text[idx + len(MARKER) :]
    elif params.mode == "before":
        new_text = text[:idx] + params.insert_text + text[idx:]
    elif params.mode == "after":
        new_text = (
            text[: idx + len(MARKER)] + params.insert_text + text[idx + len(MARKER) :]
        )
    else:
        return {
            "error": f"Unknown mode '{params.mode}'. Use 'replace', 'before', or 'after'."
        }

    _write_chapter_content(params.chap_id, new_text)
    mutations["story_changed"] = True
    return {
        "chap_id": params.chap_id,
        "marker": MARKER,
        "mode": params.mode,
        "inserted_length": len(params.insert_text),
    }


class ApplyChapterReplacementsParams(ToolModel):
    """Parameters for applying multiple replacements in a chapter."""

    chap_id: int = Field(..., description="The numeric ID of the chapter.")
    replacements: list[dict] = Field(
        ...,
        description=(
            "A list of replacements, each an object with 'old_text' and 'new_text'. "
            "Each replacement will be applied sequentially."
        ),
    )


@chat_tool(
    description="Apply one or more search-and-replace edits to a chapter in sequence.",
    allowed_roles=(EDITING_ROLE,),
    capability="prose-write",
)
async def apply_chapter_replacements(
    params: ApplyChapterReplacementsParams, payload: dict, mutations: dict
) -> Any:
    """Apply chapter replacements."""
    _, path, _pos = _chapter_by_id_or_404(params.chap_id)
    text = path.read_text(encoding="utf-8")

    for i, rep in enumerate(params.replacements):
        if not isinstance(rep, dict):
            return {"error": f"Replacement #{i} is not an object."}
        old_text = rep.get("old_text")
        new_text = rep.get("new_text")
        if not isinstance(old_text, str) or not isinstance(new_text, str):
            return {
                "error": f"Replacement #{i} must have string 'old_text' and 'new_text'."
            }

        occurrences = text.count(old_text)
        if occurrences == 0:
            return {"error": f"Replacement #{i}: old_text not found in chapter."}
        if occurrences > 1:
            return {
                "error": (
                    f"Replacement #{i}: old_text found {occurrences} times. "
                    "Please make it more specific so only one instance matches."
                )
            }

        text = text.replace(old_text, new_text, 1)

    _write_chapter_content(params.chap_id, text)
    mutations["story_changed"] = True
    return {"chap_id": params.chap_id, "replacements_applied": len(params.replacements)}


@chat_tool(
    description="Write summary to a specific chapter.",
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="metadata-write",
)
async def write_chapter_summary(
    params: WriteChapterSummaryParams, payload: dict, mutations: dict
) -> Any:
    """Write chapter summary."""
    _write_chapter_summary(params.chap_id, params.summary)
    mutations["story_changed"] = True
    return {
        "ok": True,
        "message": f"Summary written to chapter {params.chap_id} successfully",
    }


@chat_tool(
    description="Generate a chapter summary from its content using AI. Optionally specify a mode for generation style.",
    allowed_roles=(CHAT_ROLE,),
    capability="metadata-write",
)
async def sync_summary(
    params: SyncSummaryParams, payload: dict, mutations: dict
) -> Any:
    """Helper for summary.."""
    mode = str(params.mode).lower()
    data = await generate_chapter_summary(chap_id=params.chap_id, mode=mode)
    mutations["story_changed"] = True
    return data


@chat_tool(
    description="Write a full chapter from its summary using AI.",
    allowed_roles=(WRITING_ROLE,),
    capability="prose-write",
)
async def write_chapter(
    params: WriteChapterParams, payload: dict, mutations: dict
) -> Any:
    """Write chapter."""
    data = await write_chapter_from_summary(chap_id=params.chap_id)
    mutations["story_changed"] = True
    return data


@chat_tool(
    description="Continue writing a chapter from its summary using AI.",
    allowed_roles=(WRITING_ROLE,),
    capability="prose-write",
)
async def continue_chapter(
    params: ContinueChapterParams, payload: dict, mutations: dict
) -> Any:
    """Continue the current chapter from its summary and persist the resulting text."""
    data = await continue_chapter_from_summary(chap_id=params.chap_id)
    mutations["story_changed"] = True
    return data


@chat_tool(
    description="Create a new chapter with an optional title and book_id.",
    allowed_roles=(CHAT_ROLE,),
    capability="metadata-write",
    project_types=("novel", "series"),
)
async def create_new_chapter(
    params: CreateNewChapterParams, payload: dict, mutations: dict
) -> Any:
    """Create New Chapter."""
    active = get_active_project_dir()
    if not active:
        return {"error": "No active project"}

    title = params.title.strip()
    chap_id = _create_new_chapter(title, book_id=params.book_id)
    mutations["story_changed"] = True
    return {
        "chap_id": chap_id,
        "title": title,
        "message": f"New chapter {chap_id} created successfully",
    }


async def get_chapter_heading(
    params: GetChapterHeadingParams, payload: dict, mutations: dict
) -> Any:
    """Get Chapter Heading — internal helper; use get_chapter_metadata."""
    _chapter_by_id_or_404(params.chap_id)
    _, chapters = _overview_chapters()
    chapter = next((c for c in chapters if c["id"] == params.chap_id), None)
    heading = chapter.get("title", "") if chapter else ""
    return {"heading": heading}


@chat_tool(
    description="Write the heading (title) of a specific chapter.",
    allowed_roles=(CHAT_ROLE,),
    capability="metadata-write",
)
async def write_chapter_heading(
    params: WriteChapterHeadingParams, payload: dict, mutations: dict
) -> Any:
    """Write Chapter Heading."""
    heading = params.heading.strip()
    write_chapter_title(params.chap_id, heading)
    mutations["story_changed"] = True
    return {
        "heading": heading,
        "message": f"Heading for chapter {params.chap_id} updated successfully",
    }


async def get_chapter_summary(
    params: GetChapterSummaryParams, payload: dict, mutations: dict
) -> Any:
    """Get Chapter Summary — internal helper; use get_chapter_metadata."""
    _chapter_by_id_or_404(params.chap_id)
    _, chapters = _overview_chapters()
    chapter = next((c for c in chapters if c["id"] == params.chap_id), None)
    summary = chapter.get("summary", "") if chapter else ""
    return {"summary": summary}


@chat_tool(
    description="Delete a specific chapter. Requires confirmation by setting confirm=true.",
    allowed_roles=(CHAT_ROLE,),
    capability="metadata-write",
)
async def delete_chapter(
    params: DeleteChapterParams, payload: dict, mutations: dict
) -> Any:
    """Delete Chapter."""
    if not params.confirm:
        return {
            "status": "confirmation_required",
            "message": "This operation deletes the chapter. Call again with confirm=true to proceed.",
        }

    active = get_active_project_dir()
    chap_id, path, _pos = _chapter_by_id_or_404(params.chap_id)

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    p_type = story.get("project_type", "novel")
    chap_filename = path.name

    if p_type == "short-story":
        if path.exists():
            path.unlink()
        mutations["story_changed"] = True
        return {"ok": True, "message": "Content file removed (short-story project.)"}

    if p_type == "series":
        # path layout: <active>/books/<book_id>/chapters/<filename>
        book_id_str = path.parent.parent.name
        books = story.get("books", [])
        target_book = next((b for b in books if b.get("id") == book_id_str), None)
        if target_book is not None:
            chapters_list = target_book.setdefault("chapters", [])
            # Prefer filename match; fall back to linear scan.
            # Resolve BEFORE deleting the file so glob-based scan still works.
            c_idx = next(
                (
                    i
                    for i, c in enumerate(chapters_list)
                    if isinstance(c, dict) and c.get("filename") == chap_filename
                ),
                None,
            )
            if c_idx is None:
                book_files = [
                    p
                    for _, p in _scan_chapter_files()
                    if p.parent.parent.name == book_id_str
                ]
                c_idx = next((li for li, p in enumerate(book_files) if p == path), None)
            if c_idx is not None and c_idx < len(chapters_list):
                chapters_list.pop(c_idx)
    else:
        chapters_list = story.get("chapters", [])
        c_idx = next(
            (
                i
                for i, c in enumerate(chapters_list)
                if isinstance(c, dict) and c.get("filename") == chap_filename
            ),
            None,
        )
        if c_idx is None and _pos < len(chapters_list):
            c_idx = _pos
        if c_idx is not None:
            chapters_list.pop(c_idx)
        story["chapters"] = chapters_list

    if path.exists():
        path.unlink()

    with open(story_path, "w", encoding="utf-8") as f:
        _json.dump(story, f, indent=2, ensure_ascii=False)

    mutations["story_changed"] = True
    return {"ok": True, "message": "Chapter deleted"}


@chat_tool(
    description=(
        "Return structured metadata or sourcebook updates that CHAT should review and apply after an editing task. "
        "This tool does not modify project files. "
        "If story content directly contradicts sourcebook or character data in a way you cannot resolve via prose edits alone, "
        "describe the discrepancy in `rationale` so the user can be informed and decide how to proceed."
    ),
    allowed_roles=(EDITING_ROLE,),
    capability="metadata-recommendation",
)
async def recommend_metadata_updates(
    params: RecommendMetadataUpdatesParams, payload: dict, mutations: dict
) -> Any:
    """Recommend structured metadata updates based on story content and return them for review."""
    return {
        "recommended_updates": {
            "story_summary": params.story_summary,
            "story_notes": params.story_notes,
            "story_tags": params.story_tags,
            "chapter_updates": params.chapter_updates,
            "sourcebook_updates": params.sourcebook_updates,
            "rationale": params.rationale,
        }
    }
