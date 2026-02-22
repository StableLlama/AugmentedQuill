# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the chapters unit so this responsibility stays isolated, testable, and easy to evolve.

"""
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
