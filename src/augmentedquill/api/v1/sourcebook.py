# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the sourcebook unit so this responsibility stays isolated, testable, and easy to evolve.

API endpoints for managing the sourcebook (knowledge base) associated with a project.
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    sourcebook_list_entries,
    sourcebook_create_entry,
    sourcebook_update_entry,
    sourcebook_delete_entry,
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


@router.get("/sourcebook")
async def get_sourcebook() -> List[SourcebookEntry]:
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    return [SourcebookEntry(**entry) for entry in sourcebook_list_entries()]


@router.post("/sourcebook")
async def create_sourcebook_entry(entry: SourcebookEntryCreate) -> SourcebookEntry:
    """Create Sourcebook Entry."""
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    created = sourcebook_create_entry(
        name=entry.name,
        description=entry.description,
        category=entry.category,
        synonyms=entry.synonyms,
    )
    if "error" in created:
        raise HTTPException(status_code=400, detail=created["error"])
    return SourcebookEntry(**created)


@router.put("/sourcebook/{entry_name}")
async def update_sourcebook_entry(
    entry_name: str, updates: SourcebookEntryUpdate
) -> SourcebookEntry:
    """Update Sourcebook Entry."""
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    result = sourcebook_update_entry(
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


@router.delete("/sourcebook/{entry_name}")
async def delete_sourcebook_entry(entry_name: str):
    """Delete Sourcebook Entry."""
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    if not sourcebook_delete_entry(entry_name):
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"ok": True}
