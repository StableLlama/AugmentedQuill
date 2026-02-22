# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the projects unit so this responsibility stays isolated, testable, and easy to evolve.

"""
Pydantic models for project-related API requests and responses.
"""

from pydantic import BaseModel
from typing import Optional


class ProjectDeleteRequest(BaseModel):
    name: str


class ProjectSelectRequest(BaseModel):
    name: str


class ProjectCreateRequest(BaseModel):
    name: str
    type: str  # 'short-story', 'novel', 'series'


class ProjectConvertRequest(BaseModel):
    target_type: str


class BookCreateRequest(BaseModel):
    name: str


class BookDeleteRequest(BaseModel):
    name: str


class ImageDescriptionUpdateRequest(BaseModel):
    filename: str
    description: Optional[str] = ""
    title: Optional[str] = ""


class ImagePlaceholderRequest(BaseModel):
    name: Optional[str] = ""
    title: Optional[str] = ""
    description: Optional[str] = ""


class ImageDeleteRequest(BaseModel):
    filename: str


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class ProjectInfo(BaseModel):
    """Describes a single project entry returned by the listing endpoint."""

    id: str
    name: str
    path: str
    is_valid: bool
    title: str
    type: str = "novel"


class ProjectListResponse(BaseModel):
    """Response body for ``GET /api/v1/projects``."""

    current: str
    recent: list[str]
    available: list[ProjectInfo]
