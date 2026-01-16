# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

from typing import List, Optional, Dict
import uuid
from app.projects import get_active_project_dir
from app.config import load_story_config, save_story_config


def _get_story_data():
    active = get_active_project_dir()
    if not active:
        return None, None
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    return story, story_path


def sb_search(query: str) -> List[Dict]:
    story, _ = _get_story_data()
    if not story:
        return []
    entries = story.get("sourcebook", [])

    query = query.lower()
    results = []

    for e in entries:
        # Search in name
        if query in e.get("name", "").lower():
            results.append(e)
            continue

        # Search in synonyms
        if any(query in s.lower() for s in e.get("synonyms", [])):
            results.append(e)
            continue

        # Search in description
        if query in e.get("description", "").lower():
            results.append(e)
            continue

    return results


def sb_get(name_or_id: str) -> Optional[Dict]:
    if not name_or_id:
        return None

    story, _ = _get_story_data()
    if not story:
        return None
    entries = story.get("sourcebook", [])

    target = name_or_id.lower()

    for e in entries:
        if e.get("id") == name_or_id:
            return e
        if e.get("name", "").lower() == target:
            return e
        if any(target == s.lower() for s in e.get("synonyms", [])):
            return e

    return None


def sb_create(
    name: str, description: str, category: str = None, synonyms: List[str] = []
) -> Dict:
    if not name or not isinstance(name, str) or not name.strip():
        return {"error": "Invalid name: Name must be a non-empty string."}

    if description is None or not isinstance(description, str):
        return {"error": "Invalid description: Description must be a string."}

    if not category or not isinstance(category, str) or not category.strip():
        return {"error": "Invalid category: Category must be a non-empty string."}

    if synonyms is None or not isinstance(synonyms, list):
        return {"error": "Invalid synonyms: Synonyms must be a list of strings."}

    story, story_path = _get_story_data()
    if not story:
        return {"error": "No active project"}

    entries = story.get("sourcebook", [])

    new_entry = {
        "id": str(uuid.uuid4()),
        "name": name,
        "description": description,
        "category": category,
        "synonyms": synonyms,
        "images": [],
    }

    entries.append(new_entry)
    story["sourcebook"] = entries
    save_story_config(story_path, story)
    return new_entry


def sb_delete(name_or_id: str) -> bool:
    if not name_or_id:
        return False

    story, story_path = _get_story_data()
    if not story:
        return False
    entries = story.get("sourcebook", [])

    target = name_or_id.lower()
    # If using ID, exact match
    # If using name, case insensitive match on name or synonyms? Usually delete by name is risky if duplicates.
    # The requirement says "create and delete an entry".

    new_entries = []
    deleted = False

    for e in entries:
        match = False
        if e.get("id") == name_or_id:
            match = True
        elif e.get("name", "").lower() == target:
            match = True

        if match:
            deleted = True
        else:
            new_entries.append(e)

    if deleted:
        story["sourcebook"] = new_entries
        save_story_config(story_path, story)

    return deleted


def sb_update(
    name_or_id: str,
    name: str = None,
    description: str = None,
    category: str = None,
    synonyms: List[str] = None,
) -> Dict:
    if not name_or_id:
        return {"error": "Invalid identifier: name_or_id is required."}

    story, story_path = _get_story_data()
    if not story:
        return {"error": "No active project"}

    entries = story.get("sourcebook", [])
    target = name_or_id.lower()

    found_idx = -1
    for i, e in enumerate(entries):
        if e.get("id") == name_or_id:
            found_idx = i
            break
        if e.get("name", "").lower() == target:
            found_idx = i
            break

    if found_idx == -1:
        return {"error": "Entry not found."}

    entry = entries[found_idx]

    # Validation for updates
    if name is not None:
        if not isinstance(name, str) or not name.strip():
            return {"error": "Invalid name: Name must be a non-empty string."}
        entry["name"] = name

    if description is not None:
        if not isinstance(description, str):
            return {"error": "Invalid description: Description must be a string."}
        entry["description"] = description

    if category is not None:
        if not isinstance(category, str):
            return {"error": "Invalid category: Category must be a string."}
        entry["category"] = category

    if synonyms is not None:
        if not isinstance(synonyms, list):
            return {"error": "Invalid synonyms: Synonyms must be a list of strings."}
        entry["synonyms"] = synonyms

    entries[found_idx] = entry
    story["sourcebook"] = entries
    save_story_config(story_path, story)

    return entry
