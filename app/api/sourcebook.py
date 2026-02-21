# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""
API endpoints for managing the sourcebook (knowledge base) associated with a project.
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.projects.projects import get_active_project_dir
from app.services.sourcebook.sourcebook_helpers import (
    sb_list,
    sb_create,
    sb_update,
    sb_delete,
)

router = APIRouter(tags=["Sourcebook"])


class SourcebookEntry(BaseModel):
    id: str
    name: str
    synonyms: List[str] = []
    category: Optional[str] = None
    description: str
    images: List[str] = []


class SourcebookEntryCreate(BaseModel):
    name: str
    synonyms: List[str] = []
    category: Optional[str] = None
    description: str
    images: List[str] = []


class SourcebookEntryUpdate(BaseModel):
    name: Optional[str] = None
    synonyms: Optional[List[str]] = None
    category: Optional[str] = None
    description: Optional[str] = None
    images: Optional[List[str]] = None


@router.get("/api/sourcebook")
async def get_sourcebook() -> List[SourcebookEntry]:
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    return [SourcebookEntry(**entry) for entry in sb_list()]


@router.post("/api/sourcebook")
async def create_sourcebook_entry(entry: SourcebookEntryCreate) -> SourcebookEntry:
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    created = sb_create(
        name=entry.name,
        description=entry.description,
        category=entry.category,
        synonyms=entry.synonyms,
    )
    if "error" in created:
        raise HTTPException(status_code=400, detail=created["error"])
    return SourcebookEntry(**created)


@router.put("/api/sourcebook/{entry_name}")
async def update_sourcebook_entry(
    entry_name: str, updates: SourcebookEntryUpdate
) -> SourcebookEntry:
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    result = sb_update(
        name_or_id=entry_name,
        name=updates.name,
        description=updates.description,
        category=updates.category,
        synonyms=updates.synonyms,
    )
    if "error" in result:
        detail = str(result["error"])
        status = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status, detail=detail)
    return SourcebookEntry(**result)


@router.delete("/api/sourcebook/{entry_name}")
async def delete_sourcebook_entry(entry_name: str):
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    if not sb_delete(entry_name):
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"ok": True}
