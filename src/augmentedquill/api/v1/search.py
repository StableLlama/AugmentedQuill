# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the search API unit so this responsibility stays isolated, testable, and easy to evolve.

REST endpoints for project-wide search and replace.
"""

from fastapi import APIRouter, HTTPException

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.models.search import (
    ReplaceAllRequest,
    ReplaceResponse,
    ReplaceSingleRequest,
    SearchOptions,
    SearchResponse,
)
from augmentedquill.services.search.replace_service import replace_all, replace_single
from augmentedquill.services.search.search_service import run_search

router = APIRouter(prefix="/projects/{project_name}", tags=["Search"])


@router.post("/search", response_model=SearchResponse)
async def search_project(
    opts: SearchOptions, project_dir: ProjectDep
) -> SearchResponse:
    """Search across the active project.

    Supported scopes: current_chapter, all_chapters, sourcebook, metadata, all.
    Supported modes: literal (default), regex (is_regex=true), phonetic (is_phonetic=true).
    """
    try:
        return run_search(opts, project_dir)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/search/replace-all", response_model=ReplaceResponse)
async def replace_all_in_project(
    req: ReplaceAllRequest, project_dir: ProjectDep
) -> ReplaceResponse:
    """Replace every occurrence of a query throughout the active project.

    All matching text in the specified scope is substituted with *replacement*.
    After completion the frontend should refresh story/chapter state.
    """
    return replace_all(req, project_dir)


@router.post("/search/replace-single", response_model=ReplaceResponse)
async def replace_single_in_project(
    req: ReplaceSingleRequest, project_dir: ProjectDep
) -> ReplaceResponse:
    """Replace a single specifically identified match.

    The match is identified by section_type, section_id, field, and match_index
    (zero-based ordinal of the match within that field).
    """
    return replace_single(req, project_dir)
