# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chapters unit so this responsibility stays isolated, testable, and easy to evolve.

Pydantic models for chapter-related API responses.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ChapterSummary(BaseModel):
    """Lightweight chapter descriptor used in list responses."""

    id: int
    title: str
    filename: str
    summary: str
    notes: str
    private_notes: str
    conflicts: list[Any]
    book_id: str | None = None


class ChaptersListResponse(BaseModel):
    """Response body for ``GET /api/v1/chapters``."""

    chapters: list[ChapterSummary]


class ChapterDetailResponse(BaseModel):
    """Response body for ``GET /api/v1/chapters/{chap_id}``."""

    id: int
    title: str
    filename: str
    content: str
    summary: str
    notes: str
    private_notes: str
    conflicts: list[Any]


class ChapterMetadataUpdate(BaseModel):
    """Request body for updating chapter metadata."""

    title: str | None = None
    summary: str | None = None
    notes: str | None = None
    private_notes: str | None = None
    conflicts: list[Any] | None = None


class ChapterTitleUpdate(BaseModel):
    """Request body for updating chapter title."""

    title: str


class ChapterCreate(BaseModel):
    """Request body for creating a new chapter."""

    title: str
    content: str | None = ""
    book_id: str | None = None


class ChapterContentUpdate(BaseModel):
    """Request body for updating chapter content."""

    content: str


class ChapterSummaryUpdate(BaseModel):
    """Request body for updating chapter summary."""

    summary: str


class ChaptersReorderRequest(BaseModel):
    """Request body for reordering chapters."""

    chapter_ids: list[int]
    book_id: str | None = None


class BooksReorderRequest(BaseModel):
    """Request body for reordering books."""

    book_ids: list[str]
