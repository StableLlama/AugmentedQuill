# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import uuid
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.projects import get_active_project_dir
from app.config import load_story_config, save_story_config

router = APIRouter()


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


def get_story_data():
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    return story, story_path


@router.get("/api/sourcebook")
async def get_sourcebook() -> List[SourcebookEntry]:
    story, _ = get_story_data()
    entries = story.get("sourcebook", [])
    return [SourcebookEntry(**e) for e in entries]


@router.post("/api/sourcebook")
async def create_sourcebook_entry(entry: SourcebookEntryCreate) -> SourcebookEntry:
    story, story_path = get_story_data()
    entries = story.get("sourcebook", [])

    new_entry = SourcebookEntry(id=str(uuid.uuid4()), **entry.dict())

    entries.append(new_entry.dict())
    story["sourcebook"] = entries
    save_story_config(story_path, story)
    return new_entry


@router.put("/api/sourcebook/{entry_id}")
async def update_sourcebook_entry(
    entry_id: str, updates: SourcebookEntryUpdate
) -> SourcebookEntry:
    story, story_path = get_story_data()
    entries = story.get("sourcebook", [])

    idx = -1
    for i, e in enumerate(entries):
        if e["id"] == entry_id:
            idx = i
            break

    if idx == -1:
        raise HTTPException(status_code=404, detail="Entry not found")

    current = entries[idx]
    update_data = updates.dict(exclude_unset=True)

    # Merge updates
    updated_entry = {**current, **update_data}
    entries[idx] = updated_entry

    story["sourcebook"] = entries
    save_story_config(story_path, story)
    return SourcebookEntry(**updated_entry)


@router.delete("/api/sourcebook/{entry_id}")
async def delete_sourcebook_entry(entry_id: str):
    story, story_path = get_story_data()
    entries = story.get("sourcebook", [])

    new_entries = [e for e in entries if e["id"] != entry_id]

    if len(new_entries) == len(entries):
        raise HTTPException(status_code=404, detail="Entry not found")

    story["sourcebook"] = new_entries
    save_story_config(story_path, story)
    return {"ok": True}
