# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Pydantic models for story, project mutation and image API responses.

These models define the transport contract for endpoints that return story
data, project lifecycle responses, and project images.  Keeping them here
ensures FastAPI includes them in the OpenAPI schema so the frontend can use
auto-generated TypeScript types.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel
from augmentedquill.models.scene import Scene

# ---------------------------------------------------------------------------
# Story payload (returned inside several project endpoints)
# ---------------------------------------------------------------------------


class StoryLLMPrefs(BaseModel):
    """Per-project LLM preference overrides embedded in story data."""

    prompt_overrides: Optional[dict[str, str]] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


class StoryChapterSummary(BaseModel):
    """Lightweight chapter descriptor embedded in the story payload."""

    title: Optional[str] = None
    summary: Optional[str] = None
    filename: Optional[str] = None
    book_id: Optional[str] = None
    notes: Optional[str] = None
    private_notes: Optional[str] = None
    conflicts: Optional[list[Any]] = None


class StoryBook(BaseModel):
    """Book descriptor embedded in the story payload."""

    id: Optional[str] = None
    folder: Optional[str] = None
    title: Optional[str] = None
    chapters: Optional[list[StoryChapterSummary]] = None


class StorySourcebookEntry(BaseModel):
    """Minimal sourcebook entry embedded in the story payload."""

    id: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    synonyms: Optional[list[str]] = None
    images: Optional[list[str]] = None
    keywords: Optional[list[str]] = None
    relations: Optional[list[Any]] = None
    origin_date: Optional[str] = None
    destination_datetime: Optional[str] = None
    destination_relative: Optional[str] = None
    creates_new_timeline: Optional[bool] = None
    timeline_id: Optional[str] = None


class StoryPayload(BaseModel):
    """Story data as returned by project selection and mutation endpoints.

    This matches the shape produced by
    ``services.projects.project_helpers.normalize_story_for_frontend``.
    All fields are optional because the payload depends on what the author
    has filled in for a given project.
    """

    project_title: Optional[str] = None
    story_summary: Optional[str] = None
    language: Optional[str] = None
    notes: Optional[str] = None
    private_notes: Optional[str] = None
    tags: Optional[list[str]] = None
    annotations: Optional[list[Any]] = None
    image_style: Optional[str] = None
    image_additional_info: Optional[str] = None
    project_type: Optional[str] = None
    books: Optional[list[StoryBook]] = None
    sourcebook: Optional[list[StorySourcebookEntry]] = None
    conflicts: Optional[list[Any]] = None
    llm_prefs: Optional[StoryLLMPrefs] = None
    chapters: Optional[list[StoryChapterSummary]] = None
    scenes: Optional[list[Scene]] = None


# ---------------------------------------------------------------------------
# Project mutation responses
# ---------------------------------------------------------------------------


class ProjectRegistryEntry(BaseModel):
    """A single project registry entry embedded in mutation responses."""

    name: str
    path: str
    is_valid: bool = True


class ProjectRegistry(BaseModel):
    """Registry summary returned alongside project mutations."""

    current: Optional[str] = None
    recent: Optional[list[str]] = None
    available: Optional[list[ProjectRegistryEntry]] = None


class ProjectSelectResponse(BaseModel):
    """Response body for ``POST /api/v1/projects/select``."""

    ok: bool
    message: Optional[str] = None
    registry: Optional[ProjectRegistry] = None
    story: Optional[StoryPayload] = None
    error: Optional[str] = None
    error_message: Optional[str] = None


class ProjectMutationResponse(BaseModel):
    """Generic response for project create/delete/convert operations."""

    ok: bool
    message: Optional[str] = None
    detail: Optional[str] = None
    registry: Optional[ProjectRegistry] = None
    story: Optional[StoryPayload] = None


# ---------------------------------------------------------------------------
# Story content
# ---------------------------------------------------------------------------


class StoryContentResponse(BaseModel):
    """Response body for ``GET /api/v1/story/content``."""

    ok: bool
    content: str


# ---------------------------------------------------------------------------
# Project images
# ---------------------------------------------------------------------------


class ProjectImageInfo(BaseModel):
    """Describes a single project image or image placeholder."""

    filename: str
    url: Optional[str] = None
    description: Optional[str] = None
    title: Optional[str] = None
    is_placeholder: Optional[bool] = None


class ListImagesResponse(BaseModel):
    """Response body for ``GET /api/v1/projects/images/list``."""

    images: list[ProjectImageInfo]


class ImageFilenameResponse(BaseModel):
    """Response body for endpoints that return a single filename."""

    ok: bool
    filename: Optional[str] = None
    detail: Optional[str] = None


class BookMutationResponse(BaseModel):
    """Response body for book create/delete/restore endpoints."""

    ok: bool
    message: Optional[str] = None
    book_id: Optional[str] = None
    restore_id: Optional[str] = None
    story: Optional[StoryPayload] = None
    detail: Optional[str] = None
