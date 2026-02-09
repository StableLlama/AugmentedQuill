# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

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

    # Migrate from list to dict if needed
    if "sourcebook" in story and isinstance(story["sourcebook"], list):
        old_sb = story["sourcebook"]
        new_sb = {}
        for entry in old_sb:
            if isinstance(entry, dict) and "name" in entry:
                entry_copy = entry.copy()
                name = entry_copy.pop("name")
                entry_copy.pop("id", None)
                new_sb[name] = entry_copy
        story["sourcebook"] = new_sb
        save_story_config(story_path, story)

    return story, story_path


@router.get("/api/sourcebook")
async def get_sourcebook() -> List[SourcebookEntry]:
    story, _ = get_story_data()
    sb_dict = story.get("sourcebook", {})
    results = []
    # Convert dict back to list with IDs for frontend compatibility
    # User said sourcebook entries should be alphabetical
    for name in sorted(sb_dict.keys(), key=str.lower):
        entry_data = sb_dict[name]
        results.append(
            SourcebookEntry(
                id=name, name=name, **entry_data  # Use name as ID for frontend
            )
        )
    return results


@router.post("/api/sourcebook")
async def create_sourcebook_entry(entry: SourcebookEntryCreate) -> SourcebookEntry:
    story, story_path = get_story_data()
    sb_dict = story.get("sourcebook", {})

    if entry.name in sb_dict:
        raise HTTPException(
            status_code=400, detail=f"Entry '{entry.name}' already exists."
        )

    entry_data = entry.dict()
    name = entry_data.pop("name")
    entry_data.pop("id", None)  # Ensure no ID in stored data

    sb_dict[name] = entry_data
    story["sourcebook"] = sb_dict
    save_story_config(story_path, story)

    return SourcebookEntry(id=name, name=name, **entry_data)


@router.put("/api/sourcebook/{entry_name}")
async def update_sourcebook_entry(
    entry_name: str, updates: SourcebookEntryUpdate
) -> SourcebookEntry:
    story, story_path = get_story_data()
    sb_dict = story.get("sourcebook", {})

    if entry_name not in sb_dict:
        raise HTTPException(status_code=404, detail="Entry not found")

    current = sb_dict[entry_name]
    update_data = updates.dict(exclude_unset=True)

    # Handle rename if name is provided in updates
    new_name = update_data.pop("name", None)
    if new_name and new_name != entry_name:
        if new_name in sb_dict:
            raise HTTPException(
                status_code=400, detail=f"Entry '{new_name}' already exists."
            )
        del sb_dict[entry_name]
        entry_name = new_name

    # Merge updates
    updated_entry_data = {**current, **update_data}
    updated_entry_data.pop("id", None)  # Strip ID

    sb_dict[entry_name] = updated_entry_data

    story["sourcebook"] = sb_dict
    save_story_config(story_path, story)

    return SourcebookEntry(id=entry_name, name=entry_name, **updated_entry_data)


@router.delete("/api/sourcebook/{entry_name}")
async def delete_sourcebook_entry(entry_name: str):
    story, story_path = get_story_data()
    sb_dict = story.get("sourcebook", {})

    if entry_name not in sb_dict:
        raise HTTPException(status_code=404, detail="Entry not found")

    del sb_dict[entry_name]

    story["sourcebook"] = sb_dict
    save_story_config(story_path, story)
    return {"ok": True}
