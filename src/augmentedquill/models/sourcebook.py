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

from pydantic import BaseModel, field_validator

from augmentedquill.models.temporal_utils import normalize_temporal_value


def _normalize_optional_temporal_text(value: object) -> str | None:
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
    direction: str | None = "forward"
    start_scene: int | None = None
    start_book: str | None = None
    end_scene: int | None = None
    end_book: str | None = None

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
    synonyms: list[str] = []
    category: str | None = None
    description: str
    images: list[str] = []
    keywords: list[str] = []
    relations: list[SourcebookRelation] = []
    origin_date: str | None = (
        None  # ISO 8601 birth/creation date for personal timeline age computation
    )
    destination_datetime: str | None = (
        None  # For Time Travel entries: the absolute destination datetime
    )
    destination_relative: str | None = (
        None  # For Time Travel entries: human-readable offset e.g. '30 years earlier'
    )
    creates_new_timeline: bool = (
        False  # For Time Travel entries: whether a new timeline branch is created
    )
    timeline_id: str | None = (
        None  # For Time Travel branch entries: stable ID of the branch timeline
    )

    @field_validator("origin_date", mode="before")
    @classmethod
    def _normalise_origin_date(cls, v: object) -> str | None:
        return _normalize_optional_temporal_text(v)

    @field_validator("destination_datetime", mode="before")
    @classmethod
    def _normalise_destination_datetime(cls, v: object) -> str | None:
        return _normalize_optional_temporal_text(v)


class SourcebookEntryCreate(BaseModel):
    """Represents the SourcebookEntryCreate type."""

    name: str
    synonyms: list[str] = []
    category: str | None = None
    description: str
    images: list[str] = []
    relations: list[SourcebookRelation] = []
    origin_date: str | None = None
    destination_datetime: str | None = None
    destination_relative: str | None = None
    creates_new_timeline: bool = False
    timeline_id: str | None = None

    @field_validator("origin_date", mode="before")
    @classmethod
    def _normalise_origin_date(cls, v: object) -> str | None:
        return _normalize_optional_temporal_text(v)

    @field_validator("destination_datetime", mode="before")
    @classmethod
    def _normalise_destination_datetime(cls, v: object) -> str | None:
        return _normalize_optional_temporal_text(v)


class SourcebookEntryUpdate(BaseModel):
    """Represents the SourcebookEntryUpdate type."""

    name: str | None = None
    synonyms: list[str] | None = None
    category: str | None = None
    description: str | None = None
    images: list[str] | None = None
    relations: list[SourcebookRelation] | None = None
    origin_date: str | None = None
    destination_datetime: str | None = None
    destination_relative: str | None = None
    creates_new_timeline: bool | None = None
    timeline_id: str | None = None

    @field_validator("origin_date", mode="before")
    @classmethod
    def _normalise_origin_date(cls, v: object) -> str | None:
        return _normalize_optional_temporal_text(v)

    @field_validator("destination_datetime", mode="before")
    @classmethod
    def _normalise_destination_datetime(cls, v: object) -> str | None:
        return _normalize_optional_temporal_text(v)


class SourcebookKeywordsRequest(BaseModel):
    """Request payload for generating keywords from an entry description."""

    name: str | None = None
    description: str | None = None
    synonyms: list[str] | None = None


class SourcebookKeywordsResponse(BaseModel):
    """Represents the SourcebookKeywordsResponse type."""

    keywords: list[str]
