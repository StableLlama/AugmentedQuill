# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the sourcebook unit so this responsibility stays isolated, testable, and easy to evolve.

API endpoints for managing the sourcebook (knowledge base) associated with a project.
"""

from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.models.sourcebook import (
    SourcebookEntry,
    SourcebookEntryCreate,
    SourcebookEntryUpdate,
    SourcebookKeywordsRequest,
    SourcebookKeywordsResponse,
)
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    sourcebook_create_entry,
    sourcebook_delete_entry,
    sourcebook_generate_keywords_with_editing_model,
    sourcebook_list_entries,
    sourcebook_refresh_entry_keywords,
    sourcebook_search_entries_with_keyword_refresh,
    sourcebook_update_entry,
)

router = APIRouter(prefix="/projects/{project_name}", tags=["Sourcebook"])


@router.post("/sourcebook/keywords")
async def generate_sourcebook_keywords(
    request: SourcebookKeywordsRequest,
) -> SourcebookKeywordsResponse:
    """Generate keywords from an entry description without persisting the entry."""
    name = (request.name or "").strip()
    description = (request.description or "").strip()
    synonyms = request.synonyms or []

    if not name or not description:
        raise HTTPException(
            status_code=400,
            detail="Both name and description are required to generate keywords.",
        )

    keywords = await sourcebook_generate_keywords_with_editing_model(
        name=name, description=description, synonyms=synonyms, payload={}
    )
    return SourcebookKeywordsResponse(keywords=keywords)


@router.get("/sourcebook")
async def get_sourcebook(
    project_dir: ProjectDep,
    query: str | None = None,
    match_mode: Literal["direct", "extensive"] = "extensive",
    split_query_fallback: bool = False,
) -> list[SourcebookEntry]:
    """Return sourcebook."""
    if query:
        return [
            SourcebookEntry(**entry)
            for entry in await sourcebook_search_entries_with_keyword_refresh(
                query,
                match_mode=match_mode,
                split_query_fallback=split_query_fallback,
                payload={},
                active=project_dir,
            )
        ]
    return [
        SourcebookEntry(**entry)
        for entry in sourcebook_list_entries(active=project_dir)
    ]


@router.post("/sourcebook")
async def create_sourcebook_entry(
    entry: SourcebookEntryCreate,
    background_tasks: BackgroundTasks,
    project_dir: ProjectDep,
) -> SourcebookEntry:
    """Create Sourcebook Entry."""
    created = sourcebook_create_entry(
        name=entry.name,
        description=entry.description,
        category=entry.category,
        synonyms=entry.synonyms,
        relations=[r.model_dump() for r in entry.relations],
        images=entry.images,
        origin_date=entry.origin_date,
        destination_datetime=entry.destination_datetime,
        destination_relative=entry.destination_relative,
        creates_new_timeline=entry.creates_new_timeline,
        timeline_id=entry.timeline_id,
        active=project_dir,
    )
    if "error" in created:
        raise HTTPException(status_code=400, detail=created["error"])

    background_tasks.add_task(
        sourcebook_refresh_entry_keywords,
        created["id"],
        payload={},
        active=project_dir,
    )
    return SourcebookEntry(**created)


@router.put("/sourcebook/{entry_name:path}")
async def update_sourcebook_entry(
    entry_name: str,
    updates: SourcebookEntryUpdate,
    background_tasks: BackgroundTasks,
    project_dir: ProjectDep,
) -> SourcebookEntry:
    """Update Sourcebook Entry."""
    result = sourcebook_update_entry(
        name_or_id=entry_name,
        name=updates.name,
        description=updates.description,
        category=updates.category,
        synonyms=updates.synonyms,
        relations=(
            [r.model_dump() for r in updates.relations]
            if updates.relations is not None
            else None
        ),
        images=updates.images,
        origin_date=updates.origin_date,
        destination_datetime=updates.destination_datetime,
        destination_relative=updates.destination_relative,
        creates_new_timeline=updates.creates_new_timeline,
        timeline_id=updates.timeline_id,
        active=project_dir,
    )
    if "error" in result:
        detail = str(result["error"])
        status = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status, detail=detail)
    background_tasks.add_task(
        sourcebook_refresh_entry_keywords,
        result["id"],
        payload={},
        active=project_dir,
    )
    return SourcebookEntry(**result)


@router.delete("/sourcebook/{entry_name:path}")
async def delete_sourcebook_entry(entry_name: str, project_dir: ProjectDep) -> Any:
    """Delete Sourcebook Entry."""
    if not sourcebook_delete_entry(entry_name, active=project_dir):
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"ok": True}
