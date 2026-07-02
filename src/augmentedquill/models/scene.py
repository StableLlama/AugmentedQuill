# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Pydantic models for scenes – the structural planning layer of a project.

A Scene represents a narrative unit that may span part of a chapter, an entire
chapter, or remain unlinked from any prose (planning-only).  Scenes can also
have Beats – sub-units of action within a scene, each optionally linked to a
specific prose range.

Prose links record only which content *file* a scene belongs to.  The actual
byte positions are stored as HTML-comment markers embedded directly in the
content file (see ``scene_markers.py``) and are computed at read time; they are
never persisted in ``story.json``.
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Literal, Optional, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from augmentedquill.models.temporal_utils import normalize_temporal_value

# Keep a private alias for backward compat within this module
_normalize_scene_temporal_value = normalize_temporal_value

SceneId: TypeAlias = int


def _is_safe_link_identifier(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_.-]+", value or ""))


class SceneTagPersonalDatetime(BaseModel):
    """Personal age override for a single scene tag.

    ``role`` is ``'active'``, ``'passive'``, or ``'sourcebook'``.
    ``ref`` is the character name (for active/passive) or sourcebook entry ID
    (for sourcebook).
    ``index`` is the 0-based position within the role's list – this allows
    the same character to appear multiple times in one scene (e.g. a time
    traveller meeting their younger self).
    ``personal_age`` is a human-readable age string such as ``'17y'``,
    ``'17y 3m'``, ``'5m 12d'``, or ``'30d'``.
    """

    model_config = ConfigDict(extra="forbid")

    role: Literal["active", "passive", "sourcebook"] = Field(
        ..., description="Which tag list this override applies to."
    )
    ref: str = Field(
        ..., description="Character name or sourcebook entry ID for the tag."
    )
    index: int = Field(
        default=0,
        description=(
            "0-based position within the chosen tag list. Use this when the same "
            "character appears multiple times."
        ),
    )
    personal_age: str = Field(
        ..., description="Human-readable age such as '17y', '17y 3m', or '30d'."
    )

    @field_validator("personal_age", mode="before")
    @classmethod
    def _normalise(cls, v: object) -> str:
        if not isinstance(v, str):
            raise ValueError("personal_age must be a string")
        stripped = v.strip()
        if not stripped:
            raise ValueError("personal_age must not be empty")
        return stripped


class SceneAnnotation(BaseModel):
    """Inline annotation metadata mirrored from prose markers."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., description="Stable annotation identifier.")
    comment: str = Field(..., description="Human-readable annotation comment.")
    scope_type: Literal["story", "chapter", "unlinked"] = Field(
        default="story",
        description="Scope where the annotation lives.",
    )
    chapter_id: Optional[str] = Field(
        None,
        description="Chapter ID when scope_type='chapter'.",
    )
    book_id: Optional[str] = Field(
        None,
        description="Book ID when scope_type='chapter' and the chapter is nested.",
    )


class SceneProseLink(BaseModel):
    """A link between a scene (or beat) and a specific content file.

        ``scope_type`` distinguishes between:
    - ``'story'`` – the main story content file (short-story projects)
    - ``'chapter'`` – a specific chapter file (novel / series projects)
        - ``'unlinked'`` – internal planning prose for scenes not attached to
            story/chapter content

    Only the file identity is persisted.  ``start_offset`` and ``end_offset``
    are character positions derived at read time by parsing the inline HTML
    comment markers embedded in the content file (see ``scene_markers.py``).
    They are populated by the service layer before returning scenes to the API
    and are excluded from disk storage.
    """

    model_config = ConfigDict(extra="forbid")

    scope_type: Literal["story", "chapter", "unlinked"] = Field(
        ...,
        description=(
            "Which content scope the scene is linked to: 'story', 'chapter', "
            "or internal 'unlinked'."
        ),
    )
    chapter_id: Optional[str] = Field(
        None,
        description=(
            "Chapter ID when scope_type='chapter'. Leave empty for story or "
            "unlinked scope."
        ),
    )
    book_id: Optional[str] = Field(
        None,
        description=(
            "Book ID when the linked prose belongs to a book chapter. Leave "
            "empty for story or unlinked scope."
        ),
    )

    @model_validator(mode="after")
    def _validate_scope(self) -> "SceneProseLink":
        if self.scope_type == "chapter":
            if not self.chapter_id or not self.chapter_id.strip():
                raise ValueError("chapter_id is required when scope_type='chapter'")
            if not _is_safe_link_identifier(self.chapter_id):
                raise ValueError(
                    "chapter_id must only contain letters, digits, '-', '_', or '.'."
                )
            if (
                self.book_id is not None
                and self.book_id != ""
                and not _is_safe_link_identifier(self.book_id)
            ):
                raise ValueError(
                    "book_id must only contain letters, digits, '-', '_', or '.'."
                )
        elif self.scope_type == "story":
            if self.chapter_id not in (None, ""):
                raise ValueError("chapter_id must be omitted when scope_type='story'")
            if self.book_id not in (None, ""):
                raise ValueError("book_id must be omitted when scope_type='story'")
        else:
            if self.chapter_id not in (None, ""):
                raise ValueError(
                    "chapter_id must be omitted when scope_type='unlinked'"
                )
            if self.book_id not in (None, ""):
                raise ValueError("book_id must be omitted when scope_type='unlinked'")
        return self

    # Computed at read time from file markers; never written to story.json.
    start_offset: Optional[int] = Field(
        None,
        description="Computed start offset within the linked content file.",
    )
    end_offset: Optional[int] = Field(
        None,
        description="Computed end offset within the linked content file.",
    )


class SceneBeat(BaseModel):
    """A single beat within a scene – a discrete micro-action or plot step."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Stable beat identifier. Usually generated automatically.",
    )
    text: str = Field(
        ..., description="Short description of the beat's action or event."
    )
    prose_link: Optional[SceneProseLink] = Field(
        None,
        description="Optional link from this beat to a specific prose range.",
    )


class SceneChronologyTime(BaseModel):
    """Scene-local timeline point represented as a Temporal ZonedDateTime string."""

    model_config = ConfigDict(extra="forbid")

    temporal_zoned_datetime: str = Field(
        ..., description="Normalized ISO 8601 timestamp for the scene's chronology."
    )
    value: str | None = Field(
        None,
        description=(
            "Optional shorthand scene time string accepted by the tool. "
            "When provided, it is normalized into temporal_zoned_datetime."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_and_normalize_input(cls, data: object) -> object:
        """Accept shorthand scene_time payloads from tools and normalize them."""
        if isinstance(data, str):
            return {"temporal_zoned_datetime": _normalize_scene_temporal_value(data)}

        if isinstance(data, dict):
            raw = data.get("temporal_zoned_datetime")
            if raw is None and "value" in data:
                raw = data.get("value")

            if isinstance(raw, str):
                normalized = _normalize_scene_temporal_value(raw)
                merged = dict(data)
                merged["temporal_zoned_datetime"] = normalized
                merged.pop("value", None)
                return merged

        return data


class Scene(BaseModel):
    """A narrative scene used for structural story planning.

    Active characters, passive characters, location, and time are stored as
    sourcebook entry IDs so the frontend can look them up by reference.

    ``causes`` stores IDs of other scenes that this scene causally precedes.
    These are not narrative order indexes; they are dependency constraints that
    allow the pinboard to highlight cause/effect relationships.

    ``pinboard_x`` / ``pinboard_y`` store the card's free-form position on the
    pinboard canvas, in logical (unscaled) units.
    """

    id: SceneId
    summary: str = ""
    beats: list[SceneBeat] = []
    active_characters: list[str] = []
    passive_characters: list[str] = []
    sourcebook_entry_ids: list[str] = []
    location: Optional[str] = None
    time: Optional[str] = None
    scene_time: Optional[SceneChronologyTime] = None
    timeline_id: str = "main"
    color_tag: Optional[str] = None  # hex color, e.g. "#a855f7"
    prose_link: Optional[SceneProseLink] = None  # used when beats is empty
    causes: list[SceneId] = []  # scene IDs this scene causally precedes
    pinboard_x: float = 100.0
    pinboard_y: float = 100.0
    status: str = "active"  # 'active' | 'inactive' | 'draft'
    tag_personal_datetimes: list[SceneTagPersonalDatetime] = Field(
        default_factory=list
    )  # per-tag personal age overrides (supports duplicate characters)
    annotations: list[SceneAnnotation] = Field(
        default_factory=list,
        description="Optional inline annotations associated with this scene.",
    )


# ---------------------------------------------------------------------------
# Request / response bodies
# ---------------------------------------------------------------------------


class SceneCreateRequest(BaseModel):
    """Payload for creating a new scene."""

    model_config = ConfigDict(extra="forbid")

    summary: str = Field(
        default="",
        description=(
            "Scene summary / label. Scenes do not have a separate title field; "
            "use this field instead. Keep it short, specific, and suitable for a "
            "scene card heading."
        ),
    )
    beats: list[SceneBeat] = Field(
        default_factory=list,
        description=(
            "Optional ordered beats inside the scene. Use when the scene needs a "
            "micro-beat breakdown."
        ),
    )
    active_characters: list[str] = Field(
        default_factory=list,
        description=(
            "Character IDs actively participating in the scene. Use sourcebook/"
            "character IDs, not display names, when available."
        ),
    )
    passive_characters: list[str] = Field(
        default_factory=list,
        description=(
            "Character IDs present but not actively driving the scene. Use "
            "sourcebook/character IDs, not display names, when available."
        ),
    )
    sourcebook_entry_ids: list[str] = Field(
        default_factory=list,
        description=(
            "Sourcebook entry IDs needed to ground the scene's facts, setting, or "
            "canon references. Always include relevant sourcebook entries when creating a scene so the scene remains connected to existing world knowledge."
        ),
    )
    location: Optional[str] = Field(
        None,
        description="Location identifier or location name for where the scene occurs.",
    )
    time: Optional[str] = Field(
        None,
        description="Human-readable scene time string when a formal chronology is not needed.",
    )
    scene_time: Optional[SceneChronologyTime] = Field(
        None,
        description=(
            "Formal timeline position for the scene. Always set this when the scene can be placed on the story timeline; if an exact timestamp is not known, use causes to capture relative chronology. Accepts ISO-like timestamps and normalizes them."
        ),
    )
    timeline_id: str = Field(
        default="main",
        description=(
            "Explicit timeline identity for this scene. Use 'main' for the "
            "primary timeline and stable IDs for branch timelines."
        ),
    )
    color_tag: Optional[str] = Field(
        None,
        description="Optional color label for the scene card, usually a hex string.",
    )
    prose_link: Optional[SceneProseLink] = Field(
        None,
        description=(
            "Optional prose link showing which content file the scene is linked to "
            "prose. Use this when the scene is already anchored to prose."
        ),
    )
    causes: list[SceneId] = Field(
        default_factory=list,
        description=(
            "IDs of scenes that this scene causally precedes. Use this to "
            "record cause/effect relationships without changing narrative order directly."
        ),
        json_schema_extra={"examples": [[1, 2]]},
    )
    pinboard_x: float = Field(
        default=100.0,
        description="Pinboard X position in logical canvas units.",
    )
    pinboard_y: float = Field(
        default=100.0,
        description="Pinboard Y position in logical canvas units.",
    )
    status: str = Field(
        default="active",
        description="Scene lifecycle status such as active, inactive, or draft.",
    )
    tag_personal_datetimes: list[SceneTagPersonalDatetime] = Field(
        default_factory=list,
        description=(
            "Per-tag personal age overrides used for time-travel or age-specific "
            "ordering. Leave empty unless you need those overrides."
        ),
    )


class SceneUpdateRequest(BaseModel):
    """Payload for updating an existing scene."""

    model_config = ConfigDict(extra="forbid")

    summary: Optional[str] = Field(
        None,
        description="Replacement scene label/summary. Use this instead of a title.",
    )
    beats: Optional[list[SceneBeat]] = Field(
        None,
        description="Full replacement beat list for the scene.",
    )
    active_characters: Optional[list[str]] = Field(
        None,
        description="Full replacement list of active character IDs.",
    )
    passive_characters: Optional[list[str]] = Field(
        None,
        description="Full replacement list of passive character IDs.",
    )
    sourcebook_entry_ids: Optional[list[str]] = Field(
        None,
        description="Full replacement list of sourcebook entry IDs.",
    )
    location: Optional[str] = Field(
        None,
        description="Replacement location identifier or name.",
    )
    time: Optional[str] = Field(
        None,
        description="Replacement human-readable time string.",
    )
    scene_time: Optional[SceneChronologyTime] = Field(
        None,
        description="Replacement formal chronology timestamp for the scene.",
    )
    timeline_id: Optional[str] = Field(
        None,
        description="Replacement explicit timeline identity for the scene.",
    )
    color_tag: Optional[str] = Field(
        None,
        description="Replacement card color tag.",
    )
    prose_link: Optional[SceneProseLink] = Field(
        None,
        description="Replacement prose link for the scene.",
    )
    causes: Optional[list[SceneId]] = Field(
        None,
        description=(
            "Replacement list of scene IDs that this scene causally precedes."
        ),
        json_schema_extra={"examples": [[1, 2]]},
    )
    pinboard_x: Optional[float] = Field(
        None,
        description="Replacement pinboard X position.",
    )
    pinboard_y: Optional[float] = Field(
        None,
        description="Replacement pinboard Y position.",
    )
    status: Optional[str] = Field(
        None,
        description="Replacement lifecycle status such as active, inactive, or draft.",
    )
    tag_personal_datetimes: Optional[list[SceneTagPersonalDatetime]] = Field(
        default=None,
        description=(
            "Replacement per-tag personal age overrides. Use None to leave the "
            "field unchanged, or an explicit list to replace it."
        ),
    )  # None = no change


class SceneLinkProseRequest(BaseModel):
    """Payload for assigning a prose-text range to a scene.

    The offsets are UTF-8 character positions within the referenced content
    file.  Validation against existing scene links happens in the service.
    """

    scope_type: str = "story"  # 'story' | 'chapter' | 'unlinked'
    chapter_id: Optional[str] = None
    book_id: Optional[str] = None
    start_offset: int
    end_offset: int


class SceneBatchLinkProseRequest(BaseModel):
    """Batch variant: atomically unlink and relink multiple scenes in one scope.

    ``assignments`` are processed together with ``relink_scope_prose`` so
    touching boundaries are never replayed through sequential single-scene
    edits that can split freshly inserted markers.
    """

    scope_type: str = "story"
    chapter_id: Optional[str] = None
    book_id: Optional[str] = None
    assignments: list[SceneBoundaryAssignment] = Field(default_factory=list)
    unlink_ids: list[SceneId] = Field(default_factory=list)


class SceneReorderProseRequest(BaseModel):
    """Payload for reordering scenes within a linked prose scope."""

    source_scene_id: SceneId
    target_scene_id: SceneId
    place_before: bool = True


class SceneReorderProseResponse(BaseModel):
    """Result of a prose reorder transaction."""

    scenes: list[Scene]
    scope_type: str
    chapter_id: Optional[str] = None
    book_id: Optional[str] = None
    scope_start: int
    scope_end: int
    rebuilt_text: str


class SceneUpdateProseContentRequest(BaseModel):
    """Payload for replacing the prose text between a scene's inline markers."""

    text: str


class SceneBoundaryAssignment(BaseModel):
    """One scene-to-prose boundary mapping in absolute offsets."""

    scene_id: SceneId
    start_offset: int
    end_offset: int


class SceneDetectBoundariesRequest(BaseModel):
    """Payload for boundary detection + optional automatic scene relinking."""

    scope_type: Literal["story", "chapter", "unlinked"] = "chapter"
    chapter_id: Optional[str] = None
    book_id: Optional[str] = None
    scene_ids: list[SceneId] = Field(default_factory=list)
    start_offset: int = 0
    end_offset: Optional[int] = None
    prose_text: Optional[str] = None

    @field_validator("end_offset")
    @classmethod
    def _validate_offsets(cls, value: Optional[int], info: Any) -> Optional[int]:
        if value is None:
            return value
        start_offset = int(info.data.get("start_offset", 0))
        if value <= start_offset:
            raise ValueError("end_offset must be greater than start_offset")
        return value


class SceneDetectBoundariesResponse(BaseModel):
    """Result of boundary detection + link updates."""

    assignments: list[SceneBoundaryAssignment] = Field(default_factory=list)
    scenes: list[Scene] = Field(default_factory=list)


class SceneWriteRequest(BaseModel):
    """Payload for generating prose for one scene and linking the result."""

    scope_type: Optional[Literal["story", "chapter", "unlinked"]] = None
    chapter_id: Optional[str] = None
    book_id: Optional[str] = None
    include_following_scenes: int = 1
    detect_boundaries: bool = True


class SceneWriteResponse(BaseModel):
    """Result of writing one scene and relinking affected scenes."""

    scene: Scene
    generated_text: str
    assignments: list[SceneBoundaryAssignment] = Field(default_factory=list)
    scenes: list[Scene] = Field(default_factory=list)
