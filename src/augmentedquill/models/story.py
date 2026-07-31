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

from typing import Any

from pydantic import BaseModel

from augmentedquill.models.scene import Scene

# ---------------------------------------------------------------------------
# Story payload (returned inside several project endpoints)
# ---------------------------------------------------------------------------


class StoryLLMPrefs(BaseModel):
    """Per-project LLM preference overrides embedded in story data."""

    prompt_overrides: dict[str, str] | None = None
    temperature: float | None = None
    max_tokens: int | None = None


class StoryChapterSummary(BaseModel):
    """Lightweight chapter descriptor embedded in the story payload."""

    title: str | None = None
    summary: str | None = None
    filename: str | None = None
    book_id: str | None = None
    notes: str | None = None
    private_notes: str | None = None
    conflicts: list[Any] | None = None


class StoryBook(BaseModel):
    """Book descriptor embedded in the story payload."""

    id: str | None = None
    folder: str | None = None
    title: str | None = None
    chapters: list[StoryChapterSummary] | None = None


class StorySourcebookEntry(BaseModel):
    """Minimal sourcebook entry embedded in the story payload."""

    id: str | None = None
    name: str | None = None
    category: str | None = None
    description: str | None = None
    synonyms: list[str] | None = None
    images: list[str] | None = None
    keywords: list[str] | None = None
    relations: list[Any] | None = None
    origin_date: str | None = None
    destination_datetime: str | None = None
    destination_relative: str | None = None
    creates_new_timeline: bool | None = None
    timeline_id: str | None = None


class StoryPayload(BaseModel):
    """Story data as returned by project selection and mutation endpoints.

    This matches the shape produced by
    ``services.projects.project_helpers.normalize_story_for_frontend``.
    All fields are optional because the payload depends on what the author
    has filled in for a given project.
    """

    project_title: str | None = None
    story_summary: str | None = None
    language: str | None = None
    notes: str | None = None
    private_notes: str | None = None
    tags: list[str] | None = None
    annotations: list[Any] | None = None
    image_style: str | None = None
    image_additional_info: str | None = None
    project_type: str | None = None
    books: list[StoryBook] | None = None
    sourcebook: list[StorySourcebookEntry] | None = None
    conflicts: list[Any] | None = None
    llm_prefs: StoryLLMPrefs | None = None
    chapters: list[StoryChapterSummary] | None = None
    scenes: list[Scene] | None = None


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

    current: str | None = None
    recent: list[str] | None = None
    available: list[ProjectRegistryEntry] | None = None


class ProjectSelectResponse(BaseModel):
    """Response body for ``POST /api/v1/projects/select``."""

    ok: bool
    message: str | None = None
    registry: ProjectRegistry | None = None
    story: StoryPayload | None = None
    error: str | None = None
    error_message: str | None = None


class ProjectMutationResponse(BaseModel):
    """Generic response for project create/delete/convert operations."""

    ok: bool
    message: str | None = None
    detail: str | None = None
    registry: ProjectRegistry | None = None
    story: StoryPayload | None = None


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
    url: str | None = None
    description: str | None = None
    title: str | None = None
    is_placeholder: bool | None = None


class ListImagesResponse(BaseModel):
    """Response body for ``GET /api/v1/projects/images/list``."""

    images: list[ProjectImageInfo]


class ImageFilenameResponse(BaseModel):
    """Response body for endpoints that return a single filename."""

    ok: bool
    filename: str | None = None
    detail: str | None = None


class BookMutationResponse(BaseModel):
    """Response body for book create/delete/restore endpoints."""

    ok: bool
    message: str | None = None
    book_id: str | None = None
    restore_id: str | None = None
    story: StoryPayload | None = None
    detail: str | None = None
