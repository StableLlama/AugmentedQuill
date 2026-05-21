# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the search tools unit so this responsibility stays isolated, testable, and easy to evolve.

LLM-callable chat tools for searching and replacing text within a project.
These tools are available to the CHAT and EDITING model roles.
"""

from typing import Literal

from pydantic import Field
from augmentedquill.services.chat.chat_tool_decorator import ToolModel

from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
    chat_tool,
)


class SearchAndReplaceParams(ToolModel):
    """Action router parameters for search_and_replace."""

    action: Literal["search", "replace"] = Field(
        ...,
        description="Operation to execute: 'search' or 'replace'.",
    )
    query: str = Field(..., description="Text or pattern to search for")
    replacement: str | None = Field(
        None,
        description="Required when action='replace'.",
    )
    scope: str = Field(
        "all",
        description=(
            "Where to search/replace. One of: 'all', 'all_chapters', "
            "'current_chapter', 'sourcebook', 'metadata'."
        ),
    )
    case_sensitive: bool = Field(
        False,
        description="Whether matching is case-sensitive",
    )
    is_regex: bool = Field(False, description="Treat query as a regular expression")


@chat_tool(
    description=(
        "Unified search and replace tool. Use action='search' to find matches "
        "or action='replace' to replace all matches (requires replacement)."
    ),
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="search",
)
async def search_and_replace(
    params: SearchAndReplaceParams, payload: dict, mutations: dict
) -> dict:
    """Route search/replace actions using existing search services."""
    if params.action == "search":
        return _run_search_in_project(
            query=params.query,
            scope=params.scope,
            case_sensitive=params.case_sensitive,
            is_regex=params.is_regex,
            payload=payload,
        )

    if params.action == "replace":
        if params.replacement is None:
            return {"error": "replacement is required when action='replace'."}
        return _run_replace_in_project(
            query=params.query,
            replacement=params.replacement,
            scope=params.scope,
            case_sensitive=params.case_sensitive,
            is_regex=params.is_regex,
            payload=payload,
            mutations=mutations,
        )

    return {"error": f"Unsupported action: {params.action}"}


def _run_search_in_project(
    *,
    query: str,
    scope: str,
    case_sensitive: bool,
    is_regex: bool,
    payload: dict,
) -> dict:
    """Execute a text search across the project and return readable results."""
    from augmentedquill.models.search import SearchOptions, SearchScope
    from augmentedquill.services.projects.projects import get_active_project_dir
    from augmentedquill.services.search.search_service import run_search

    active = get_active_project_dir()
    if not active:
        return {"error": "No active project"}

    # Resolve scope string to enum (fall back to 'all' for invalid values)
    scope_map = {s.value: s for s in SearchScope}
    scope = scope_map.get(scope, SearchScope.all)

    active_chap_id: int | None = None
    if scope == SearchScope.current_chapter:
        raw_id = payload.get("active_chapter_id")
        if raw_id is not None:
            try:
                active_chap_id = int(raw_id)
            except (TypeError, ValueError):
                pass

    opts = SearchOptions(
        query=query,
        scope=scope,
        case_sensitive=case_sensitive,
        is_regex=is_regex,
        is_phonetic=False,  # Phonetic search not exposed as LLM tool
        active_chapter_id=active_chap_id,
    )

    try:
        response = run_search(opts, active)
    except ValueError as exc:
        return {"error": str(exc)}

    # Build an LLM-friendly flat summary (no raw character offsets)
    llm_results = []
    for section in response.results:
        for match in section.matches:
            llm_results.append(
                {
                    "section": section.section_title,
                    "field": section.field_display,
                    "match": match.match_text,
                    "context": f"…{match.context_before}[{match.match_text}]{match.context_after}…",
                }
            )

    return {
        "total_matches": response.total_matches,
        "results": llm_results,
    }


def _run_replace_in_project(
    *,
    query: str,
    replacement: str,
    scope: str,
    case_sensitive: bool,
    is_regex: bool,
    payload: dict,
    mutations: dict,
) -> dict:
    """Replace text throughout the project and report the changes."""
    from augmentedquill.models.search import ReplaceAllRequest, SearchScope
    from augmentedquill.services.projects.projects import get_active_project_dir
    from augmentedquill.services.search.replace_service import replace_all

    active = get_active_project_dir()
    if not active:
        return {"error": "No active project"}

    scope_map = {s.value: s for s in SearchScope}
    scope = scope_map.get(scope, SearchScope.all)

    active_chap_id: int | None = None
    if scope == SearchScope.current_chapter:
        raw_id = payload.get("active_chapter_id")
        if raw_id is not None:
            try:
                active_chap_id = int(raw_id)
            except (TypeError, ValueError):
                pass

    req = ReplaceAllRequest(
        query=query,
        replacement=replacement,
        scope=scope,
        case_sensitive=case_sensitive,
        is_regex=is_regex,
        is_phonetic=False,
        active_chapter_id=active_chap_id,
    )

    result = replace_all(req, active)

    if result.replacements_made > 0:
        mutations["story_changed"] = True
    if result.changed_sections_meta:
        mutations["change_locations"] = [
            loc.model_dump() for loc in result.changed_sections_meta
        ]

    return {
        "replacements_made": result.replacements_made,
        "changed_sections": result.changed_sections,
        "change_locations": [loc.model_dump() for loc in result.changed_sections_meta],
    }
