# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the sourcebook helpers unit so this responsibility stays isolated, testable, and easy to evolve.

from typing import List, Optional, Dict
from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.core.config import load_story_config, save_story_config

_UNSET = object()


def _get_story_data():
    active = get_active_project_dir()
    if not active:
        return None, None
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    return story, story_path


def sb_list() -> List[Dict]:
    story, _ = _get_story_data()
    if not story:
        return []

    sb_dict = story.get("sourcebook", {})
    if not isinstance(sb_dict, dict):
        return []

    results = []
    for name in sorted(sb_dict.keys(), key=str.lower):
        e_data = sb_dict.get(name) or {}
        if not isinstance(e_data, dict):
            continue
        results.append({"id": name, "name": name, **e_data})

    return results


def sb_search(query: str) -> List[Dict]:
    story, _ = _get_story_data()
    if not story:
        return []
    sb_dict = story.get("sourcebook", {})

    query = query.lower()
    results = []

    for name, e_data in sb_dict.items():
        e = {"id": name, "name": name, **e_data}
        # Search in name
        if query in name.lower():
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
    sb_dict = story.get("sourcebook", {})

    # Case-insensitive name lookup
    target = name_or_id.lower()
    for name, e_data in sb_dict.items():
        if name.lower() == target:
            return {"id": name, "name": name, **e_data}
        if any(target == s.lower() for s in e_data.get("synonyms", [])):
            return {"id": name, "name": name, **e_data}

    return None


def sb_create(
    name: str,
    description: str,
    category: str = None,
    synonyms: List[str] | object = _UNSET,
) -> Dict:
    if not name or not isinstance(name, str) or not name.strip():
        return {"error": "Invalid name: Name must be a non-empty string."}

    if description is None or not isinstance(description, str):
        return {"error": "Invalid description: Description must be a string."}

    if not category or not isinstance(category, str) or not category.strip():
        return {"error": "Invalid category: Category must be a non-empty string."}

    if synonyms is _UNSET:
        synonyms = []
    elif synonyms is None or not isinstance(synonyms, list):
        return {"error": "Invalid synonyms: Synonyms must be a list of strings."}

    story, story_path = _get_story_data()
    if not story:
        return {"error": "No active project"}

    sb_dict = story.get("sourcebook", {})

    if name in sb_dict:
        # Check if it was because of migration
        pass

    new_entry_data = {
        "description": description,
        "category": category,
        "synonyms": synonyms,
        "images": [],
    }

    sb_dict[name] = new_entry_data
    story["sourcebook"] = sb_dict
    save_story_config(story_path, story)
    return {"id": name, "name": name, **new_entry_data}


def sb_delete(name_or_id: str) -> bool:
    if not name_or_id:
        return False

    story, story_path = _get_story_data()
    if not story:
        return False
    sb_dict = story.get("sourcebook", {})

    target = name_or_id.lower()

    found_key = None
    for name in sb_dict:
        if name.lower() == target:
            found_key = name
            break

    if found_key:
        del sb_dict[found_key]
        story["sourcebook"] = sb_dict
        save_story_config(story_path, story)
        return True

    return False


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

    sb_dict = story.get("sourcebook", {})
    target = name_or_id.lower()

    found_key = None
    for k in sb_dict:
        if k.lower() == target:
            found_key = k
            break

    if found_key is None:
        return {"error": "Entry not found."}

    entry_data = sb_dict[found_key]

    # Handle rename
    new_name = name
    if new_name is not None:
        if not isinstance(new_name, str) or not new_name.strip():
            return {"error": "Invalid name: Name must be a non-empty string."}

        if new_name != found_key:
            if new_name in sb_dict:
                return {"error": f"Entry '{new_name}' already exists."}
            del sb_dict[found_key]
            found_key = new_name

    # Validation for updates
    if description is not None:
        if not isinstance(description, str):
            return {"error": "Invalid description: Description must be a string."}
        entry_data["description"] = description

    if category is not None:
        if not isinstance(category, str):
            return {"error": "Invalid category: Category must be a string."}
        entry_data["category"] = category

    if synonyms is not None:
        if not isinstance(synonyms, list):
            return {"error": "Invalid synonyms: Synonyms must be a list of strings."}
        entry_data["synonyms"] = synonyms

    sb_dict[found_key] = entry_data
    story["sourcebook"] = sb_dict
    save_story_config(story_path, story)

    return {"id": found_key, "name": found_key, **entry_data}
