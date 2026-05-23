# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Pydantic models for sourcebook API requests and responses.

Moving the models here (rather than defining them in the route module) ensures
they appear in the auto-generated OpenAPI schema so the frontend can derive
TypeScript types automatically.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, field_validator

from augmentedquill.models.temporal_utils import normalize_temporal_value


def _normalize_optional_temporal_text(value: object) -> Optional[str]:
    """Normalize optional temporal text input while preserving legacy fallbacks."""
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    if not stripped:
        return None
    try:
        return normalize_temporal_value(stripped)
    except ValueError:
        return stripped


class SourcebookRelation(BaseModel):
    """Represents the SourcebookRelation type."""

    target_id: str
    relation: str
    direction: Optional[str] = "forward"
    start_scene: Optional[int] = None
    start_book: Optional[str] = None
    end_scene: Optional[int] = None
    end_book: Optional[str] = None

    @field_validator("start_scene", "end_scene", mode="before")
    @classmethod
    def _validate_scene_id(cls, value: object) -> int | None:
        if value is None:
            return None
        if type(value) is int:
            return value
        raise ValueError("Scene IDs must be integers.")


class SourcebookEntry(BaseModel):
    """Represents the SourcebookEntry type."""

    id: str
    name: str
    synonyms: List[str] = []
    category: Optional[str] = None
    description: str
    images: List[str] = []
    keywords: List[str] = []
    relations: List[SourcebookRelation] = []
    origin_date: Optional[str] = (
        None  # ISO 8601 birth/creation date for personal timeline age computation
    )
    destination_datetime: Optional[str] = (
        None  # For Time Travel entries: the absolute destination datetime
    )
    destination_relative: Optional[str] = (
        None  # For Time Travel entries: human-readable offset e.g. '30 years earlier'
    )
    creates_new_timeline: bool = (
        False  # For Time Travel entries: whether a new timeline branch is created
    )
    timeline_id: Optional[str] = (
        None  # For Time Travel branch entries: stable ID of the branch timeline
    )

    @field_validator("origin_date", mode="before")
    @classmethod
    def _normalise_origin_date(cls, v: object) -> Optional[str]:
        return _normalize_optional_temporal_text(v)

    @field_validator("destination_datetime", mode="before")
    @classmethod
    def _normalise_destination_datetime(cls, v: object) -> Optional[str]:
        return _normalize_optional_temporal_text(v)


class SourcebookEntryCreate(BaseModel):
    """Represents the SourcebookEntryCreate type."""

    name: str
    synonyms: List[str] = []
    category: Optional[str] = None
    description: str
    images: List[str] = []
    relations: List[SourcebookRelation] = []
    origin_date: Optional[str] = None
    destination_datetime: Optional[str] = None
    destination_relative: Optional[str] = None
    creates_new_timeline: bool = False
    timeline_id: Optional[str] = None

    @field_validator("origin_date", mode="before")
    @classmethod
    def _normalise_origin_date(cls, v: object) -> Optional[str]:
        return _normalize_optional_temporal_text(v)

    @field_validator("destination_datetime", mode="before")
    @classmethod
    def _normalise_destination_datetime(cls, v: object) -> Optional[str]:
        return _normalize_optional_temporal_text(v)


class SourcebookEntryUpdate(BaseModel):
    """Represents the SourcebookEntryUpdate type."""

    name: Optional[str] = None
    synonyms: Optional[List[str]] = None
    category: Optional[str] = None
    description: Optional[str] = None
    images: Optional[List[str]] = None
    relations: Optional[List[SourcebookRelation]] = None
    origin_date: Optional[str] = None
    destination_datetime: Optional[str] = None
    destination_relative: Optional[str] = None
    creates_new_timeline: Optional[bool] = None
    timeline_id: Optional[str] = None

    @field_validator("origin_date", mode="before")
    @classmethod
    def _normalise_origin_date(cls, v: object) -> Optional[str]:
        return _normalize_optional_temporal_text(v)

    @field_validator("destination_datetime", mode="before")
    @classmethod
    def _normalise_destination_datetime(cls, v: object) -> Optional[str]:
        return _normalize_optional_temporal_text(v)


class SourcebookKeywordsRequest(BaseModel):
    """Request payload for generating keywords from an entry description."""

    name: Optional[str] = None
    description: Optional[str] = None
    synonyms: Optional[List[str]] = None


class SourcebookKeywordsResponse(BaseModel):
    """Represents the SourcebookKeywordsResponse type."""

    keywords: List[str]
