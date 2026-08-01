# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the sourcebook helpers unit so this responsibility stays isolated, testable, and easy to evolve."""

import re
from typing import Any, Literal

from augmentedquill.core.config import (
    load_story_config,
    save_story_config,
)
from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.services.sourcebook.sourcebook_keyword_service import (
    _keyword_budget,
    _normalize_keyword_value,
    _normalize_keywords,
    _rank_and_limit_keywords,
    sourcebook_generate_keywords_with_editing_model,  # noqa: F401
    sourcebook_generate_missing_keywords,  # noqa: F401
    sourcebook_refresh_entry_keywords,  # noqa: F401
    sourcebook_search_entries_with_keyword_refresh,  # noqa: F401
)

_UNSET = object()

KNOWN_SOURCEBOOK_CATEGORIES: tuple[str, ...] = (
    "Character",
    "Location",
    "Organization",
    "Item",
    "Event",
    "Lore",
    "Other",
    "Time Travel",
)

_CATEGORY_NORMALIZATION_MAP = {
    category.lower(): category for category in KNOWN_SOURCEBOOK_CATEGORIES
}

SOURCEBOOK_SEARCH_MODE = Literal["direct", "extensive"]


def _get_entry_relations(entry_id: str, story: dict) -> list[dict]:
    """Return entry relations."""
    global_rels = story.get("sourcebook_relations") or []
    out = []
    for r in global_rels:
        if r.get("source_id") == entry_id:
            rel = dict(r)
            rel["target_id"] = rel.pop("target_id", "")
            rel.pop("source_id", None)
            rel["direction"] = "forward"
            if rel.get("start_scene") is not None:
                rel["start_scene"] = rel.get("start_scene")
            if rel.get("end_scene") is not None:
                rel["end_scene"] = rel.get("end_scene")
            out.append(rel)
        elif r.get("target_id") == entry_id:
            rel = dict(r)
            rel["target_id"] = rel.pop("source_id", "")
            rel.pop("source_id", None)
            rel["direction"] = "reverse"
            if rel.get("start_scene") is not None:
                rel["start_scene"] = rel.get("start_scene")
            if rel.get("end_scene") is not None:
                rel["end_scene"] = rel.get("end_scene")
            out.append(rel)
    return out


def _normalize_relation_input(entry_id: str, relation: dict) -> dict:
    """Normalize a sourcebook relation payload from tool data."""
    if not isinstance(relation, dict):
        raise ValueError("Invalid relation: relation must be an object.")

    normalized: dict[str, str | int | None] = {}
    raw_relation = relation.get("relation")

    if isinstance(raw_relation, list):
        if len(raw_relation) != 3 or not all(
            isinstance(item, str) for item in raw_relation
        ):
            raise ValueError(
                "Invalid relation shape: expected [source, relation, target] strings."
            )
        source, relation_type, target = [item.strip() for item in raw_relation]
        normalized["relation"] = relation_type

        direction = (
            str(relation.get("direction", "forward") or "forward").strip().lower()
        )
        if direction == "reverse":
            normalized["source_id"] = target
            normalized["target_id"] = entry_id
        else:
            if source.lower() == entry_id.lower():
                normalized["source_id"] = entry_id
                normalized["target_id"] = target
            elif target.lower() == entry_id.lower():
                normalized["source_id"] = source
                normalized["target_id"] = entry_id
                normalized["direction"] = "reverse"
            else:
                normalized["source_id"] = entry_id
                normalized["target_id"] = target
    else:
        normalized["relation"] = str(raw_relation or "")
        direction = (
            str(relation.get("direction", "forward") or "forward").strip().lower()
        )
        if direction == "reverse":
            normalized["source_id"] = relation.get("target_id") or relation.get(
                "source_id"
            )
            normalized["target_id"] = entry_id
            normalized["direction"] = "reverse"
        else:
            normalized["source_id"] = entry_id
            normalized["target_id"] = relation.get("target_id")

    for key in ("start_scene", "end_scene", "start_book", "end_book"):
        if key in relation and relation.get(key) is not None:
            value = relation.get(key)
            if key in ("start_scene", "end_scene") and not isinstance(value, int):
                raise ValueError("Invalid relation: scene IDs must be integers.")
            normalized[key] = value

    return normalized


def _update_global_relations(
    entry_id: str, new_relations: list[dict] | None, story: dict
) -> Any:
    """Update global relations."""
    if new_relations is None:
        return

    global_rels = story.get("sourcebook_relations") or []
    # Remove all relations involving entry_id
    filtered_rels = [
        r
        for r in global_rels
        if r.get("source_id") != entry_id and r.get("target_id") != entry_id
    ]

    # Add new relations
    for r in new_relations:
        normalized = _normalize_relation_input(entry_id, r)
        d = normalized.get("direction", "forward")
        new_r = {
            "relation": normalized.get("relation", ""),
            "start_scene": normalized.get("start_scene"),
            "end_scene": normalized.get("end_scene"),
            "start_book": normalized.get("start_book"),
            "end_book": normalized.get("end_book"),
        }
        if d == "reverse":
            new_r["source_id"] = normalized.get("source_id", "")
            new_r["target_id"] = entry_id
        else:
            new_r["source_id"] = entry_id
            new_r["target_id"] = normalized.get("target_id", "")

        filtered_rels.append({k: v for k, v in new_r.items() if v is not None})

    story["sourcebook_relations"] = filtered_rels


def sourcebook_add_relation(
    source_id: str,
    relation_type: str,
    target_id: str,
    start_scene: int | None = None,
    end_scene: int | None = None,
    start_book: str | None = None,
    end_book: str | None = None,
) -> dict:
    """Add a single directed relation between two sourcebook entries atomically."""
    story, story_path = _get_story_data()
    if not story:
        return {"error": "No active project"}

    sb_dict = story.get("sourcebook", {})
    known_ids = {k.lower() for k in sb_dict}
    if source_id.lower() not in known_ids:
        return {"error": f"Source entry '{source_id}' not found"}
    if target_id.lower() not in known_ids:
        return {"error": f"Target entry '{target_id}' not found"}

    global_rels = story.get("sourcebook_relations") or []
    for r in global_rels:
        if (
            r.get("source_id") == source_id
            and r.get("target_id") == target_id
            and r.get("relation") == relation_type
        ):
            return {"error": "Relation already exists"}

    new_rel: dict = {
        "source_id": source_id,
        "relation": relation_type,
        "target_id": target_id,
    }
    if start_scene is not None:
        if type(start_scene) is not int:
            return {"error": "Invalid start_scene: scene IDs must be integers."}
        new_rel["start_scene"] = start_scene
    if end_scene is not None:
        if type(end_scene) is not int:
            return {"error": "Invalid end_scene: scene IDs must be integers."}
        new_rel["end_scene"] = end_scene
    if start_book:
        new_rel["start_book"] = start_book
    if end_book:
        new_rel["end_book"] = end_book

    global_rels.append(new_rel)
    story["sourcebook_relations"] = global_rels
    save_story_config(story_path, story)
    return {"ok": True, "relation": new_rel}


def sourcebook_remove_relation(
    source_id: str,
    relation_type: str,
    target_id: str,
) -> dict:
    """Remove a single directed relation between two sourcebook entries atomically."""
    story, story_path = _get_story_data()
    if not story:
        return {"error": "No active project"}

    global_rels = story.get("sourcebook_relations") or []
    original_len = len(global_rels)
    new_rels = [
        r
        for r in global_rels
        if not (
            r.get("source_id") == source_id
            and r.get("relation") == relation_type
            and r.get("target_id") == target_id
        )
    ]
    if len(new_rels) == original_len:
        return {"error": "Relation not found"}

    story["sourcebook_relations"] = new_rels
    save_story_config(story_path, story)
    return {"ok": True, "removed": original_len - len(new_rels)}


def _normalize_category_value(category: str | None) -> str | None:
    """Normalize category to a known canonical value, or None when unknown."""
    if not isinstance(category, str):
        return None
    normalized = _CATEGORY_NORMALIZATION_MAP.get(category.strip().lower())
    return normalized


def _normalize_entry_data(e_data: dict) -> dict:
    """Normalize sourcebook entry payload so callers always see stable keys."""
    description = e_data.get("description", "")
    if not isinstance(description, str):
        description = str(description or "")

    category = e_data.get("category")
    category = _normalize_category_value(category)

    raw_synonyms = e_data.get("synonyms")
    synonyms: list[str] = []
    if isinstance(raw_synonyms, list):
        for synonym in raw_synonyms:
            if isinstance(synonym, str):
                cleaned = synonym.strip()
                if cleaned and cleaned not in synonyms:
                    synonyms.append(cleaned)

    raw_images = e_data.get("images")
    images: list[str] = []
    if isinstance(raw_images, list):
        for image in raw_images:
            if isinstance(image, str):
                cleaned = image.strip()
                if cleaned:
                    images.append(cleaned)

    keywords = _normalize_keywords(e_data.get("keywords") or [])
    keywords = keywords[: _keyword_budget(description)]

    return {
        "description": description,
        "category": category,
        "synonyms": synonyms,
        "images": images,
        "keywords": keywords,
        "origin_date": e_data.get("origin_date"),
        "destination_datetime": e_data.get("destination_datetime"),
        "destination_relative": e_data.get("destination_relative"),
        "creates_new_timeline": e_data.get("creates_new_timeline", False),
        "timeline_id": e_data.get("timeline_id"),
    }


def _get_story_data(active: Any = None) -> Any:
    """Get Story Data."""
    active = active or get_active_project_dir()
    if not active:
        return None, None
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    return story, story_path


def sourcebook_list_entries(active: Any = None) -> list[dict]:
    """Sourcebook List Entries."""
    story, _ = _get_story_data(active)
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
        norm = _normalize_entry_data(e_data)
        norm["id"] = name
        norm["name"] = name
        norm["relations"] = _get_entry_relations(name, story)
        results.append(norm)

    return results


def _matches_extensive_query(entry: dict, normalized_query: str) -> bool:
    """Return whether entry matches extensive query against name/synonyms/keywords."""
    if normalized_query in entry["name"].lower():
        return True
    if any(normalized_query in s.lower() for s in entry.get("synonyms", [])):
        return True
    return bool(any(normalized_query in k.lower() for k in entry.get("keywords", [])))


def _split_query_tokens(query: str) -> list[str]:
    """Split query into meaningful tokens for fallback matching."""
    tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9'_-]*", query.lower())
    return _normalize_keywords(tokens)


def sourcebook_search_entries(
    query: str,
    match_mode: SOURCEBOOK_SEARCH_MODE = "extensive",
    split_query_fallback: bool = False,
    active: Any = None,
) -> list[dict]:
    """Search sourcebook entries with direct/extensive matching and optional split fallback."""
    story, _ = _get_story_data(active)
    if not story:
        return []

    normalized_query = _normalize_keyword_value(query)
    if not normalized_query:
        return sourcebook_list_entries(active)

    sb_dict = story.get("sourcebook", {})
    all_entries: list[dict] = []

    for name, e_data in sb_dict.items():
        if not isinstance(e_data, dict):
            continue
        all_entries.append({"id": name, "name": name, **_normalize_entry_data(e_data)})

    if match_mode == "direct":
        for entry in all_entries:
            if entry["name"].lower() == normalized_query:
                return [entry]
            if any(s.lower() == normalized_query for s in entry.get("synonyms", [])):
                return [entry]
        return []

    results = [
        entry
        for entry in all_entries
        if _matches_extensive_query(entry, normalized_query)
    ]
    if results or not split_query_fallback:
        return results

    fallback_tokens = _split_query_tokens(normalized_query)
    if not fallback_tokens:
        return []

    seen_ids: set[str] = set()
    fallback_results: list[dict] = []
    for token in fallback_tokens:
        token_matches = [
            entry for entry in all_entries if _matches_extensive_query(entry, token)
        ]
        for entry in token_matches:
            entry_id = str(entry.get("id"))
            if entry_id in seen_ids:
                continue
            seen_ids.add(entry_id)
            fallback_results.append(entry)
    return fallback_results


def sourcebook_get_entry(name_or_id: str, active: Any = None) -> dict | None:
    """Sourcebook Get Entry."""
    if not name_or_id:
        return None

    story, _ = _get_story_data(active)
    if not story:
        return None
    sb_dict = story.get("sourcebook", {})

    # Case-insensitive name lookup
    target = name_or_id.lower()
    for name, e_data in sb_dict.items():
        if not isinstance(e_data, dict):
            continue
        normalized = _normalize_entry_data(e_data)
        if name.lower() == target or any(
            target == s.lower() for s in normalized.get("synonyms", [])
        ):
            entry = {"id": name, "name": name, **normalized}
            entry["relations"] = _get_entry_relations(name, story)
            return entry

    return None


def sourcebook_create_entry(
    name: str,
    description: str,
    category: str | None = None,
    synonyms: list[str] | object = _UNSET,
    images: list[str] | object = _UNSET,
    keywords: list[str] | object = _UNSET,
    relations: list[dict] | object = _UNSET,
    origin_date: str | None = None,
    destination_datetime: str | None = None,
    destination_relative: str | None = None,
    creates_new_timeline: bool = False,
    timeline_id: str | None = None,
    active: Any = None,
) -> dict:
    """Create a sourcebook entry for the active project."""
    if not name or not isinstance(name, str) or not name.strip():
        return {"error": "Invalid name: Name must be a non-empty string."}

    if description is None or not isinstance(description, str):
        return {"error": "Invalid description: Description must be a string."}

    if not category or not isinstance(category, str) or not category.strip():
        return {"error": "Invalid category: Category must be a non-empty string."}

    normalized_category = _normalize_category_value(category)
    if normalized_category is None:
        allowed = ", ".join(KNOWN_SOURCEBOOK_CATEGORIES)
        return {"error": f"Invalid category: Category must be one of: {allowed}."}

    if synonyms is _UNSET:
        synonyms = []
    elif synonyms is None or not isinstance(synonyms, list):
        return {"error": "Invalid synonyms: Synonyms must be a list of strings."}

    cleaned_synonyms: list[str] = []
    for synonym in synonyms:
        if not isinstance(synonym, str):
            return {"error": "Invalid synonyms: Synonyms must be a list of strings."}
        cleaned = synonym.strip()
        if cleaned and cleaned not in cleaned_synonyms:
            cleaned_synonyms.append(cleaned)

    if images is _UNSET:
        images = []
    elif images is None or not isinstance(images, list):
        return {"error": "Invalid images: Images must be a list of strings."}

    cleaned_images: list[str] = []
    for image in images:
        if not isinstance(image, str):
            return {"error": "Invalid images: Images must be a list of strings."}
        cleaned_image = image.strip()
        if cleaned_image and cleaned_image not in cleaned_images:
            cleaned_images.append(cleaned_image)

    if keywords is _UNSET:
        cleaned_keywords = []
    elif keywords is None or not isinstance(keywords, list):
        return {"error": "Invalid keywords: Keywords must be a list of strings."}
    else:
        cleaned_keywords = _rank_and_limit_keywords(
            keywords,
            name=name,
            description=description,
            synonyms=cleaned_synonyms,
        )

    # Relations are optional and currently stored as-is for later use.
    cleaned_relations: list[dict] = []
    if relations is _UNSET or relations is None:
        cleaned_relations = []
    elif not isinstance(relations, list):
        return {"error": "Invalid relations: Relations must be a list of objects."}
    else:
        for rel in relations:
            if not isinstance(rel, dict):
                return {
                    "error": "Invalid relations: Relations must be a list of objects."
                }
            cleaned_relations.append(rel)

    story, story_path = _get_story_data(active)
    if not story:
        return {"error": "No active project"}

    sb_dict = story.get("sourcebook", {})

    if name in sb_dict:
        return {"error": f"Entry '{name}' already exists."}

    new_entry_data = {
        "description": description,
        "category": normalized_category,
        "synonyms": cleaned_synonyms,
        "images": cleaned_images,
        "keywords": cleaned_keywords,
        "relations": cleaned_relations,
    }
    if origin_date is not None:
        new_entry_data["origin_date"] = origin_date
    if destination_datetime is not None:
        new_entry_data["destination_datetime"] = destination_datetime
    if destination_relative is not None:
        new_entry_data["destination_relative"] = destination_relative
    if creates_new_timeline:
        new_entry_data["creates_new_timeline"] = creates_new_timeline
        if isinstance(timeline_id, str) and timeline_id.strip():
            new_entry_data["timeline_id"] = timeline_id.strip()
        else:
            new_entry_data["timeline_id"] = f"branch:{name}"

    sb_dict[name] = new_entry_data
    story["sourcebook"] = sb_dict
    save_story_config(story_path, story)
    return {"id": name, "name": name, **new_entry_data}


def sourcebook_delete_entry(name_or_id: str, active: Any = None) -> bool:
    """Sourcebook Delete Entry."""
    if not name_or_id:
        return False

    story, story_path = _get_story_data(active)
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


def sourcebook_update_entry(
    name_or_id: str,
    name: str | None = None,
    description: str | None = None,
    category: str | None = None,
    synonyms: list[str] | None = None,
    images: list[str] | None = None,
    keywords: list[str] | None = None,
    relations: list[dict] | None = None,
    origin_date: str | None | object = _UNSET,
    destination_datetime: str | None | object = _UNSET,
    destination_relative: str | None | object = _UNSET,
    creates_new_timeline: bool | None | object = _UNSET,
    timeline_id: str | None | object = _UNSET,
    active: Any = None,
) -> dict:
    """Sourcebook Update Entry."""
    if not name_or_id:
        return {"error": "Invalid identifier: name_or_id is required."}

    story, story_path = _get_story_data(active)
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

    original_name = found_key

    # Handle rename
    new_name = name
    if new_name is not None:
        if not isinstance(new_name, str) or not new_name.strip():
            return {"error": "Invalid name: Name must be a non-empty string."}

        if new_name != found_key:
            if new_name in sb_dict:
                return {"error": f"Entry '{new_name}' already exists."}

            # fix external relations pointing to this entry
            global_rels = story.get("sourcebook_relations") or []
            for r in global_rels:
                if r.get("source_id") == found_key:
                    r["source_id"] = new_name
                if r.get("target_id") == found_key:
                    r["target_id"] = new_name

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
        normalized_category = _normalize_category_value(category)
        if normalized_category is None:
            allowed = ", ".join(KNOWN_SOURCEBOOK_CATEGORIES)
            return {"error": f"Invalid category: Category must be one of: {allowed}."}
        entry_data["category"] = normalized_category

    if synonyms is not None:
        if not isinstance(synonyms, list):
            return {"error": "Invalid synonyms: Synonyms must be a list of strings."}
        cleaned_synonyms: list[str] = []
        for synonym in synonyms:
            if not isinstance(synonym, str):
                return {
                    "error": "Invalid synonyms: Synonyms must be a list of strings."
                }
            cleaned = synonym.strip()
            if cleaned and cleaned not in cleaned_synonyms:
                cleaned_synonyms.append(cleaned)
        entry_data["synonyms"] = cleaned_synonyms

    if images is not None:
        if not isinstance(images, list):
            return {"error": "Invalid images: Images must be a list of strings."}
        cleaned_images: list[str] = []
        for image in images:
            if not isinstance(image, str):
                return {"error": "Invalid images: Images must be a list of strings."}
            cleaned_image = image.strip()
            if cleaned_image and cleaned_image not in cleaned_images:
                cleaned_images.append(cleaned_image)
        entry_data["images"] = cleaned_images

    if relations is not None:
        if not isinstance(relations, list):
            return {"error": "Invalid relations: Relations must be a list of dicts."}
        cleaned_relations: list[dict] = []
        for relation in relations:
            if not isinstance(relation, dict):
                return {
                    "error": "Invalid relations: Relations must be a list of dicts."
                }
            cleaned_relations.append(relation)

        _update_global_relations(found_key, cleaned_relations, story)

    if keywords is not None:
        if not isinstance(keywords, list):
            return {"error": "Invalid keywords: Keywords must be a list of strings."}
        effective_name = found_key if found_key else original_name
        effective_description = str(entry_data.get("description") or "")
        effective_synonyms = entry_data.get("synonyms")
        if not isinstance(effective_synonyms, list):
            effective_synonyms = []
        entry_data["keywords"] = _rank_and_limit_keywords(
            keywords,
            name=effective_name,
            description=effective_description,
            synonyms=effective_synonyms,
        )

    # Keep keywords updated even before async EDITING-model refresh.
    fields_affecting_keywords_changed = (
        name is not None or description is not None or synonyms is not None
    )
    if keywords is None and fields_affecting_keywords_changed:
        entry_data["keywords"] = []

    if origin_date is not _UNSET:
        if origin_date is None:
            entry_data.pop("origin_date", None)
        else:
            entry_data["origin_date"] = origin_date

    if destination_datetime is not _UNSET:
        if destination_datetime is None:
            entry_data.pop("destination_datetime", None)
        else:
            entry_data["destination_datetime"] = destination_datetime

    if destination_relative is not _UNSET:
        if destination_relative is None:
            entry_data.pop("destination_relative", None)
        else:
            entry_data["destination_relative"] = destination_relative

    if creates_new_timeline is not _UNSET:
        if creates_new_timeline is None:
            entry_data.pop("creates_new_timeline", None)
        else:
            entry_data["creates_new_timeline"] = creates_new_timeline
            if creates_new_timeline and not isinstance(
                entry_data.get("timeline_id"), str
            ):
                entry_data["timeline_id"] = f"branch:{found_key}"

    if timeline_id is not _UNSET:
        if timeline_id is None:
            entry_data.pop("timeline_id", None)
        elif isinstance(timeline_id, str):
            trimmed = timeline_id.strip()
            if trimmed:
                entry_data["timeline_id"] = trimmed
            else:
                entry_data.pop("timeline_id", None)
        else:
            return {"error": "Invalid timeline_id: timeline_id must be a string."}

    sb_dict[found_key] = entry_data
    story["sourcebook"] = sb_dict
    save_story_config(story_path, story)

    return {"id": found_key, "name": found_key, **_normalize_entry_data(entry_data)}
