# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the search models unit so this responsibility stays isolated, testable, and easy to evolve.

Pydantic models for search-and-replace API request/response contracts.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class SearchScope(str, Enum):
    """The scope of content to search within a project."""

    current_chapter = "current_chapter"
    all_chapters = "all_chapters"
    sourcebook = "sourcebook"
    metadata = "metadata"
    all = "all"


class SearchOptions(BaseModel):
    """Parameters controlling what and how to search."""

    model_config = ConfigDict(extra="forbid")

    query: str = Field(..., description="Text or pattern to search for")
    scope: SearchScope = Field(
        SearchScope.all, description="Which parts of the project to search"
    )
    case_sensitive: bool = Field(
        False, description="Whether the search is case-sensitive"
    )
    is_regex: bool = Field(False, description="Treat query as a regular expression")
    is_phonetic: bool = Field(
        False, description="Use phonetic (soundex) matching instead of literal"
    )
    active_chapter_id: Optional[int] = Field(
        None, description="Chapter ID to use when scope is current_chapter"
    )


class SearchMatch(BaseModel):
    """A single occurrence of the query in a body of text."""

    start: int = Field(..., description="Character offset of the start of the match")
    end: int = Field(..., description="Character offset of the end of the match")
    match_text: str = Field(..., description="The matched text")
    context_before: str = Field(..., description="Up to 80 characters before the match")
    context_after: str = Field(..., description="Up to 80 characters after the match")


class SearchResultSection(BaseModel):
    """All matches found within one logical section of the project."""

    section_type: str = Field(
        ...,
        description=(
            "One of: chapter_content, chapter_metadata, story_metadata, sourcebook"
        ),
    )
    section_id: str = Field(
        ..., description="Unique identifier for the section (chapter ID, entry name, …)"
    )
    section_title: str = Field(..., description="Human-readable title for the section")
    field: str = Field(
        ...,
        description=(
            "Which data field contains the match, e.g. 'content', 'summary', "
            "'notes', 'conflicts[0].description'"
        ),
    )
    field_display: str = Field(
        ..., description="Human-readable field label, e.g. 'Content', 'Summary'"
    )
    matches: list[SearchMatch] = Field(default_factory=list)


class ReplaceChangeLocation(BaseModel):
    """Structured information about a single replaced section."""

    type: str = Field(
        ..., description="One of: chapter, story, metadata, sourcebook, book"
    )
    target_id: str | None = Field(
        None,
        description="Target identifier for the changed section, e.g. chapter ID or sourcebook entry name",
    )
    field: str | None = Field(
        None,
        description="Optional field name or metadata subfield affected by the replacement",
    )
    label: str = Field(..., description="Human-readable label for the changed section")


class SearchResponse(BaseModel):
    """Top-level response for a search request."""

    results: list[SearchResultSection] = Field(default_factory=list)
    total_matches: int = Field(0, description="Total number of individual matches")


class ReplaceAllRequest(BaseModel):
    """Request to replace all occurrences of a search query."""

    model_config = ConfigDict(extra="forbid")

    query: str = Field(..., description="Text or pattern to search for")
    replacement: str = Field(
        ..., description="Text to substitute in place of each match"
    )
    scope: SearchScope = Field(SearchScope.all)
    case_sensitive: bool = Field(False)
    is_regex: bool = Field(False)
    is_phonetic: bool = Field(False)
    active_chapter_id: Optional[int] = Field(None)


class ReplaceSingleRequest(BaseModel):
    """Request to replace one specific match (identified by its ordinal index)."""

    model_config = ConfigDict(extra="forbid")

    query: str = Field(..., description="Text or pattern to search for")
    replacement: str = Field(
        ..., description="Text to substitute in place of the match"
    )
    scope: SearchScope = Field(SearchScope.all)
    case_sensitive: bool = Field(False)
    is_regex: bool = Field(False)
    is_phonetic: bool = Field(False)
    active_chapter_id: Optional[int] = Field(None)
    section_type: str = Field(
        ..., description="The section_type value from SearchResultSection"
    )
    section_id: str = Field(
        ..., description="The section_id value from SearchResultSection"
    )
    field: str = Field(..., description="The field value from SearchResultSection")
    match_index: int = Field(
        ..., ge=0, description="Zero-based index of the match within this section+field"
    )


class ReplaceResponse(BaseModel):
    """Result of a replace operation."""

    replacements_made: int = Field(
        0, description="Total number of occurrences replaced"
    )
    changed_sections: list[str] = Field(
        default_factory=list,
        description="Human-readable labels for each changed section",
    )
    changed_sections_meta: list[ReplaceChangeLocation] = Field(
        default_factory=list,
        description="Structured information for each changed section",
    )
