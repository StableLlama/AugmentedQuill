# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chapter tools unit so this responsibility stays isolated, testable, and easy to evolve."""

import json as _json

from pydantic import BaseModel, Field

from augmentedquill.core.config import load_story_config
from augmentedquill.services.chapters.chapter_helpers import (
    _chapter_by_id_or_404,
    _get_chapter_metadata_entry,
    _scan_chapter_files,
)
from augmentedquill.services.chat.chat_tool_decorator import chat_tool
from augmentedquill.services.projects.project_helpers import (
    _chapter_content_slice,
    _project_overview,
)
from augmentedquill.services.story.story_generation_ops import (
    continue_chapter_from_summary,
    generate_chapter_summary,
    write_chapter_from_summary,
)
from augmentedquill.services.projects.projects import (
    create_new_chapter as _create_new_chapter,
    get_active_project_dir,
    update_chapter_metadata as _update_chapter_metadata,
    write_chapter_content as _write_chapter_content,
    write_chapter_summary as _write_chapter_summary,
    write_chapter_title,
)


def _overview_chapters():
    """Overview Chapters."""
    ov = _project_overview()
    chapters = []
    if ov.get("project_type") == "series":
        for book in ov.get("books", []):
            chapters.extend(book.get("chapters", []))
    else:
        chapters = ov.get("chapters", [])
    return ov, chapters


# ============================================================================
# Tool Parameter Models
# ============================================================================


class GetChapterMetadataParams(BaseModel):
    chap_id: int = Field(..., description="The chapter ID to get metadata for")


class UpdateChapterMetadataParams(BaseModel):
    chap_id: int = Field(..., description="The chapter ID to update metadata for")
    title: str | None = Field(None, description="The chapter title")
    summary: str | None = Field(None, description="The chapter summary")
    notes: str | None = Field(None, description="Public notes about the chapter")
    private_notes: str | None = Field(
        None, description="Private notes about the chapter"
    )
    conflicts: list | str | None = Field(
        None, description="List of conflicts in the chapter (can be JSON string)"
    )


class GetChapterSummariesParams(BaseModel):
    pass


class GetChapterContentParams(BaseModel):
    chap_id: int | None = Field(
        None,
        description="The chapter ID to get content for. If not provided, uses active chapter.",
    )
    start: int = Field(0, description="The starting character position")
    max_chars: int = Field(8000, description="Maximum characters to return (1-8000)")


class WriteChapterContentParams(BaseModel):
    chap_id: int = Field(..., description="The chapter ID to write content to")
    content: str = Field(..., description="The content to write")


class WriteChapterSummaryParams(BaseModel):
    chap_id: int = Field(..., description="The chapter ID to write summary to")
    summary: str = Field(..., description="The summary to write")


class SyncSummaryParams(BaseModel):
    chap_id: int = Field(..., description="The chapter ID to generate summary for")
    mode: str = Field(
        "",
        description="The mode for summary generation (e.g., 'detailed', 'brief')",
    )


class WriteChapterParams(BaseModel):
    chap_id: int = Field(
        ..., description="The chapter ID to write full chapter content for"
    )


class ContinueChapterParams(BaseModel):
    chap_id: int = Field(..., description="The chapter ID to continue writing")


class CreateNewChapterParams(BaseModel):
    title: str = Field("", description="The title for the new chapter")
    book_id: str | None = Field(
        None, description="The book ID (UUID) if project is a series"
    )


class GetChapterHeadingParams(BaseModel):
    chap_id: int = Field(..., description="The chapter ID to get heading for")


class WriteChapterHeadingParams(BaseModel):
    chap_id: int = Field(..., description="The chapter ID to write heading to")
    heading: str = Field(..., description="The heading to write")


class GetChapterSummaryParams(BaseModel):
    chap_id: int = Field(..., description="The chapter ID to get summary for")


class DeleteChapterParams(BaseModel):
    chap_id: int = Field(..., description="The chapter ID to delete")
    confirm: bool = Field(False, description="Set to true to confirm deletion")


# ============================================================================
# Tool Implementations
# ============================================================================


@chat_tool(
    description="Get metadata for a specific chapter including title, summary, notes, and conflicts."
)
async def get_chapter_metadata(
    params: GetChapterMetadataParams, payload: dict, mutations: dict
):
    """Get Chapter Metadata."""
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    _, path, _ = _chapter_by_id_or_404(params.chap_id)
    meta = _get_chapter_metadata_entry(story, params.chap_id, path) or {}
    return {
        "title": meta.get("title", "") or path.name,
        "summary": meta.get("summary", ""),
        "notes": meta.get("notes", ""),
        "conflicts": meta.get("conflicts") or [],
    }


@chat_tool(
    description="Update metadata for a specific chapter (title, summary, notes, private_notes, conflicts)."
)
async def update_chapter_metadata(
    params: UpdateChapterMetadataParams, payload: dict, mutations: dict
):
    """Update Chapter Metadata."""
    conflicts = params.conflicts
    if isinstance(conflicts, str):
        try:
            conflicts = _json.loads(conflicts)
        except Exception:
            conflicts = None

    _update_chapter_metadata(
        params.chap_id,
        title=params.title,
        summary=params.summary,
        notes=params.notes,
        private_notes=params.private_notes,
        conflicts=conflicts,
    )
    mutations["story_changed"] = True
    return {"ok": True}


@chat_tool(
    description="Get summaries for all chapters in the project (across all books if series)."
)
async def get_chapter_summaries(
    params: GetChapterSummariesParams, payload: dict, mutations: dict
):
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
            summary = chapter.get("summary", "").strip()
            if summary:
                summaries.append(
                    {"chapter_id": chap_id, "title": title, "summary": summary}
                )
    return {"chapter_summaries": summaries}


@chat_tool(description="Get content from a specific chapter with pagination support.")
async def get_chapter_content(
    params: GetChapterContentParams, payload: dict, mutations: dict
):
    """Get Chapter Content."""
    chap_id = params.chap_id
    if chap_id is None:
        ac = payload.get("active_chapter_id")
        if isinstance(ac, int):
            chap_id = ac
    if not isinstance(chap_id, int):
        return {"error": "chap_id is required"}

    start = max(0, params.start)
    max_chars = max(1, min(8000, params.max_chars))
    data = _chapter_content_slice(chap_id, start=start, max_chars=max_chars)
    return data


@chat_tool(description="Write content to a specific chapter.")
async def write_chapter_content(
    params: WriteChapterContentParams, payload: dict, mutations: dict
):
    _write_chapter_content(params.chap_id, params.content)
    mutations["story_changed"] = True
    return {"message": f"Content written to chapter {params.chap_id} successfully"}


@chat_tool(description="Write summary to a specific chapter.")
async def write_chapter_summary(
    params: WriteChapterSummaryParams, payload: dict, mutations: dict
):
    _write_chapter_summary(params.chap_id, params.summary)
    mutations["story_changed"] = True
    return {"message": f"Summary written to chapter {params.chap_id} successfully"}


@chat_tool(
    description="Generate a chapter summary from its content using AI. Optionally specify a mode for generation style."
)
async def sync_summary(params: SyncSummaryParams, payload: dict, mutations: dict):
    mode = str(params.mode).lower()
    data = await generate_chapter_summary(chap_id=params.chap_id, mode=mode)
    mutations["story_changed"] = True
    return data


@chat_tool(description="Write a full chapter from its summary using AI.")
async def write_chapter(params: WriteChapterParams, payload: dict, mutations: dict):
    data = await write_chapter_from_summary(chap_id=params.chap_id)
    mutations["story_changed"] = True
    return data


@chat_tool(description="Continue writing a chapter from its summary using AI.")
async def continue_chapter(
    params: ContinueChapterParams, payload: dict, mutations: dict
):
    data = await continue_chapter_from_summary(chap_id=params.chap_id)
    mutations["story_changed"] = True
    return data


@chat_tool(description="Create a new chapter with an optional title and book_id.")
async def create_new_chapter(
    params: CreateNewChapterParams, payload: dict, mutations: dict
):
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


@chat_tool(description="Get the heading (title) of a specific chapter.")
async def get_chapter_heading(
    params: GetChapterHeadingParams, payload: dict, mutations: dict
):
    """Get Chapter Heading."""
    _chapter_by_id_or_404(params.chap_id)
    _, chapters = _overview_chapters()
    chapter = next((c for c in chapters if c["id"] == params.chap_id), None)
    heading = chapter.get("title", "") if chapter else ""
    return {"heading": heading}


@chat_tool(description="Write the heading (title) of a specific chapter.")
async def write_chapter_heading(
    params: WriteChapterHeadingParams, payload: dict, mutations: dict
):
    """Write Chapter Heading."""
    heading = params.heading.strip()
    write_chapter_title(params.chap_id, heading)
    mutations["story_changed"] = True
    return {
        "heading": heading,
        "message": f"Heading for chapter {params.chap_id} updated successfully",
    }


@chat_tool(description="Get the summary of a specific chapter.")
async def get_chapter_summary(
    params: GetChapterSummaryParams, payload: dict, mutations: dict
):
    """Get Chapter Summary."""
    _chapter_by_id_or_404(params.chap_id)
    _, chapters = _overview_chapters()
    chapter = next((c for c in chapters if c["id"] == params.chap_id), None)
    summary = chapter.get("summary", "") if chapter else ""
    return {"summary": summary}


@chat_tool(
    description="Delete a specific chapter. Requires confirmation by setting confirm=true."
)
async def delete_chapter(params: DeleteChapterParams, payload: dict, mutations: dict):
    """Delete Chapter."""
    if not params.confirm:
        return {
            "status": "confirmation_required",
            "message": "This operation deletes the chapter. Call again with confirm=true to proceed.",
        }

    active = get_active_project_dir()
    files = _scan_chapter_files()
    match = next(((idx, p) for (idx, p) in files if idx == params.chap_id), None)
    if not match:
        return {"error": "Chapter not found"}

    _, path = match
    if path.exists():
        path.unlink()

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters = story.get("chapters", [])
    if params.chap_id < len(chapters):
        idx_to_remove = params.chap_id - 1
        if 0 <= idx_to_remove < len(chapters):
            chapters.pop(idx_to_remove)
            story["chapters"] = chapters
            with open(story_path, "w", encoding="utf-8") as f:
                _json.dump(story, f, indent=2, ensure_ascii=False)

    mutations["story_changed"] = True
    return {"ok": True, "message": "Chapter deleted"}
