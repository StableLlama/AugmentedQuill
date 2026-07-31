# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the projects unit so this responsibility stays isolated, testable, and easy to evolve.

Pydantic models for project-related API requests and responses.
"""

from pydantic import BaseModel


class ProjectDeleteRequest(BaseModel):
    """Represents the ProjectDeleteRequest type."""

    name: str


class ProjectSelectRequest(BaseModel):
    """Represents the ProjectSelectRequest type."""

    name: str


class ProjectCreateRequest(BaseModel):
    """Represents the ProjectCreateRequest type."""

    name: str
    type: str  # 'short-story', 'novel', 'series'
    language: str | None = "en"


class ProjectConvertRequest(BaseModel):
    """Represents the ProjectConvertRequest type."""

    target_type: str


class BookCreateRequest(BaseModel):
    """Represents the BookCreateRequest type."""

    name: str


class BookDeleteRequest(BaseModel):
    """Represents the BookDeleteRequest type."""

    name: str


class BookRestoreRequest(BaseModel):
    """Represents the BookRestoreRequest type."""

    restore_id: str


class ImageDescriptionUpdateRequest(BaseModel):
    """Represents the ImageDescriptionUpdateRequest type."""

    filename: str
    description: str | None = ""
    title: str | None = ""


class ImagePlaceholderRequest(BaseModel):
    """Represents the ImagePlaceholderRequest type."""

    name: str | None = ""
    title: str | None = ""
    description: str | None = ""


class ImageDeleteRequest(BaseModel):
    """Represents the ImageDeleteRequest type."""

    filename: str


class ImageRestoreRequest(BaseModel):
    """Represents the ImageRestoreRequest type."""

    restore_id: str


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
    language: str | None = None


class ProjectListResponse(BaseModel):
    """Response body for ``GET /api/v1/projects``."""

    current: str
    recent: list[str]
    available: list[ProjectInfo]
