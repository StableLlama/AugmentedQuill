# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the story tools unit so this responsibility stays isolated, testable, and easy to evolve."""

import os

import json as _json

from pydantic import BaseModel, Field

from augmentedquill.core.config import load_story_config
from augmentedquill.services.chat.chat_tool_decorator import chat_tool
from augmentedquill.services.projects.projects import (
    get_active_project_dir,
    read_book_content as _read_book_content,
    read_story_content as _read_story_content,
    update_book_metadata as _update_book_metadata,
    update_story_metadata as _update_story_metadata,
    write_book_content as _write_book_content,
    write_story_content as _write_story_content,
)

# Pydantic models for tool parameters


class GetStoryMetadataParams(BaseModel):
    """Parameters for get_story_metadata (no parameters needed)."""

    pass


class UpdateStoryMetadataParams(BaseModel):
    """Parameters for updating story metadata."""

    title: str | None = Field(None, description="The new story title")
    summary: str | None = Field(None, description="The new story summary")
    notes: str | None = Field(None, description="General notes for the story")
    tags: list[str] | None = Field(None, description="List of tags for the story")


class ReadStoryContentParams(BaseModel):
    """Parameters for read_story_content (no parameters needed)."""

    pass


class WriteStoryContentParams(BaseModel):
    """Parameters for writing story content."""

    content: str = Field(..., description="The new content for the story")


class GetBookMetadataParams(BaseModel):
    """Parameters for getting book metadata."""

    book_id: str = Field(..., description="The UUID of the book")


class UpdateBookMetadataParams(BaseModel):
    """Parameters for updating book metadata."""

    book_id: str = Field(..., description="The UUID of the book to update")
    title: str | None = Field(None, description="The new book title")
    summary: str | None = Field(None, description="The new book summary")
    notes: str | None = Field(None, description="General notes for the book")


class ReadBookContentParams(BaseModel):
    """Parameters for reading book content."""

    book_id: str = Field(..., description="The UUID of the book")


class WriteBookContentParams(BaseModel):
    """Parameters for writing book content."""

    book_id: str = Field(..., description="The UUID of the book")
    content: str = Field(..., description="The new content for the book")


class GetStorySummaryParams(BaseModel):
    """Parameters for get_story_summary (no parameters needed)."""

    pass


class GetStoryTagsParams(BaseModel):
    """Parameters for get_story_tags (no parameters needed)."""

    pass


class SetStoryTagsParams(BaseModel):
    """Parameters for setting story tags."""

    tags: list[str] = Field(..., description="Array of tag strings")


class SyncStorySummaryParams(BaseModel):
    """Parameters for auto-generating story summary."""

    mode: str = Field(
        "",
        description="Generation mode: 'discard' (new from scratch) or 'update' (refine existing). Empty string defaults to 'update'.",
    )


class WriteStorySummaryParams(BaseModel):
    """Parameters for directly setting story summary."""

    summary: str = Field(..., description="The new story summary text")


# Tool implementations with co-located schemas


@chat_tool(
    description="Get the overall story title, summary, notes, tags, and project type."
)
async def get_story_metadata(
    params: GetStoryMetadataParams, payload: dict, mutations: dict
):
    """Get Story Metadata."""
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    return {
        "title": story.get("project_title", ""),
        "summary": story.get("story_summary", ""),
        "notes": story.get("notes", ""),
        "tags": story.get("tags", []),
        "project_type": story.get("project_type", "novel"),
    }


@chat_tool(
    description="Update the story title, summary, notes, or tags. Provide only the fields you want to change."
)
async def update_story_metadata(
    params: UpdateStoryMetadataParams, payload: dict, mutations: dict
):
    """Update Story Metadata."""
    _update_story_metadata(
        title=params.title, summary=params.summary, notes=params.notes, tags=params.tags
    )
    mutations["story_changed"] = True
    return {"ok": True}


@chat_tool(description="Read the story-level introduction or content file.")
async def read_story_content(
    params: ReadStoryContentParams, payload: dict, mutations: dict
):
    content = _read_story_content()
    return {"content": content}


@chat_tool(description="Update the story-level introduction or content file.")
async def write_story_content(
    params: WriteStoryContentParams, payload: dict, mutations: dict
):
    _write_story_content(params.content)
    mutations["story_changed"] = True
    return {"ok": True}


@chat_tool(
    description="Get the title, summary, and notes of a specific book (only for series projects)."
)
async def get_book_metadata(
    params: GetBookMetadataParams, payload: dict, mutations: dict
):
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
    description="Update the title, summary, or notes of a specific book. Provide only the fields you want to change."
)
async def update_book_metadata(
    params: UpdateBookMetadataParams, payload: dict, mutations: dict
):
    """Update Book Metadata."""
    _update_book_metadata(
        params.book_id, title=params.title, summary=params.summary, notes=params.notes
    )
    mutations["story_changed"] = True
    return {"ok": True}


@chat_tool(description="Read the content file for a specific book.")
async def read_book_content(
    params: ReadBookContentParams, payload: dict, mutations: dict
):
    content = _read_book_content(params.book_id)
    return {"content": content}


@chat_tool(description="Update the content file for a specific book.")
async def write_book_content(
    params: WriteBookContentParams, payload: dict, mutations: dict
):
    _write_book_content(params.book_id, params.content)
    mutations["story_changed"] = True
    return {"ok": True}


@chat_tool(
    name="get_story_summary",
    description="Get only the story summary (shortcut for get_story_metadata).",
)
async def get_story_summary_tool(
    params: GetStorySummaryParams, payload: dict, mutations: dict
):
    """Get Story Summary Tool."""
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    summary = story.get("story_summary", "")
    return {"story_summary": summary}


@chat_tool(description="Get the list of tags for the story.")
async def get_story_tags(params: GetStoryTagsParams, payload: dict, mutations: dict):
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    tags = story.get("tags", [])
    return {"tags": tags}


@chat_tool(description="Set the tags for the story. Replaces all existing tags.")
async def set_story_tags(params: SetStoryTagsParams, payload: dict, mutations: dict):
    """Set Story Tags."""
    active = get_active_project_dir()
    if not active:
        return {"error": "No active project"}

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    story["tags"] = params.tags

    with open(story_path, "w", encoding="utf-8") as f:
        _json.dump(story, f, indent=2, ensure_ascii=False)

    mutations["story_changed"] = True
    return {"tags": params.tags, "message": "Story tags updated successfully"}


@chat_tool(
    description="Auto-generate a story summary from chapter content. Uses the EDIT LLM."
)
async def sync_story_summary(
    params: SyncStorySummaryParams, payload: dict, mutations: dict
):
    """Sync Story Summary."""
    from augmentedquill.services.story.story_generation_ops import (
        generate_story_summary,
    )

    data = await generate_story_summary(mode=params.mode)
    mutations["story_changed"] = True
    return data


@chat_tool(description="Directly set the story summary without LLM generation.")
async def write_story_summary(
    params: WriteStorySummaryParams, payload: dict, mutations: dict
):
    """Write Story Summary."""
    active = get_active_project_dir()
    if not active:
        return {"error": "No active project"}

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    story["story_summary"] = params.summary.strip()

    with open(story_path, "w", encoding="utf-8") as f:
        _json.dump(story, f, indent=2, ensure_ascii=False)

    mutations["story_changed"] = True
    return {"summary": params.summary, "message": "Story summary updated successfully"}
