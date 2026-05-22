# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the replace service unit so this responsibility stays isolated, testable, and easy to evolve.

Performs in-place text replacement across chapter prose, metadata fields, and
the sourcebook.  Delegates actual file I/O to the existing project operation
helpers so write paths remain consistent.
"""

from __future__ import annotations

import re
from pathlib import Path

from augmentedquill.models.search import (
    ReplaceAllRequest,
    ReplaceChangeLocation,
    ReplaceResponse,
    ReplaceSingleRequest,
    SearchScope,
)
from augmentedquill.services.search.search_service import (
    _build_pattern,
    _get_all_chapter_ids,
    _read_chapter_content,
)


def _make_change_location(
    type: str,
    target_id: str | None,
    field: str | None,
    label: str,
) -> ReplaceChangeLocation:
    return ReplaceChangeLocation(
        type=type,
        target_id=target_id,
        field=field,
        label=label,
    )


def _apply_replace(
    text: str,
    query: str,
    replacement: str,
    case_sensitive: bool,
    is_regex: bool,
    is_phonetic: bool,
) -> tuple[str, int]:
    """Return (new_text, count) after substitution."""
    if not query or not text:
        return text, 0
    try:
        if is_phonetic:
            # Build a regex that matches each phonetic hit word by word
            import jellyfish

            query_words = re.findall(r"\b\w+\b", query)
            if not query_words:
                return text, 0
            target_code = jellyfish.soundex(query_words[0])
            count = 0

            def _replace_word(m: re.Match) -> str:
                """Replace word."""
                nonlocal count
                if jellyfish.soundex(m.group()) == target_code:
                    count += 1
                    return replacement
                return m.group()

            new_text = re.sub(r"\b\w+\b", _replace_word, text)
            return new_text, count

        pattern = _build_pattern(query, case_sensitive, is_regex)
        new_text, count = pattern.subn(replacement, text)
        return new_text, count
    except re.error:
        return text, 0


def _apply_replace_nth(
    text: str,
    query: str,
    replacement: str,
    case_sensitive: bool,
    is_regex: bool,
    is_phonetic: bool,
    match_index: int,
) -> tuple[str, int]:
    """Replace only the match at *match_index* (zero-based), leave others untouched."""
    if not query or not text:
        return text, 0
    try:
        if is_phonetic:
            import jellyfish

            query_words = re.findall(r"\b\w+\b", query)
            if not query_words:
                return text, 0
            target_code = jellyfish.soundex(query_words[0])
            current_idx = 0

            def _replace_nth_word(m: re.Match) -> str:
                """Replace nth word."""
                nonlocal current_idx
                if jellyfish.soundex(m.group()) == target_code:
                    if current_idx == match_index:
                        current_idx += 1
                        return replacement
                    current_idx += 1
                return m.group()

            new_text = re.sub(r"\b\w+\b", _replace_nth_word, text)
            replaced = 0 if new_text == text else 1
            return new_text, replaced

        pattern = _build_pattern(query, case_sensitive, is_regex)
        current_idx = 0

        def _replace_nth(m: re.Match) -> str:
            """Replace nth."""
            nonlocal current_idx
            if current_idx == match_index:
                current_idx += 1
                return replacement
            current_idx += 1
            return m.group()

        new_text = pattern.sub(_replace_nth, text)
        replaced = 0 if new_text == text else 1
        return new_text, replaced
    except re.error:
        return text, 0


# ─── Chapter content ─────────────────────────────────────────────────────────


def _replace_in_chapter_content(
    chap_id: int,
    query: str,
    replacement: str,
    case_sensitive: bool,
    is_regex: bool,
    is_phonetic: bool,
    match_index: int | None,
) -> tuple[int, str | None, ReplaceChangeLocation | None]:
    """Replace in a single chapter's prose.  Returns (count, label_or_None, location_or_None)."""
    from augmentedquill.services.projects.projects import write_chapter_content

    content = _read_chapter_content(chap_id)
    if not content:
        return 0, None, None

    if match_index is None:
        new_content, count = _apply_replace(
            content, query, replacement, case_sensitive, is_regex, is_phonetic
        )
    else:
        new_content, count = _apply_replace_nth(
            content,
            query,
            replacement,
            case_sensitive,
            is_regex,
            is_phonetic,
            match_index,
        )

    if count > 0:
        write_chapter_content(chap_id, new_content)
        label = f"Chapter {chap_id} content"
        return (
            count,
            label,
            _make_change_location("chapter", str(chap_id), "content", label),
        )
    return 0, None, None


# ─── Chapter metadata ────────────────────────────────────────────────────────


def _replace_in_chapter_metadata(
    active: Path,
    chapter_ids: list[int],
    query: str,
    replacement: str,
    case_sensitive: bool,
    is_regex: bool,
    is_phonetic: bool,
    target_section_id: str | None = None,
    target_field: str | None = None,
    match_index: int | None = None,
) -> tuple[int, list[str], list[ReplaceChangeLocation]]:
    """Replace in chapter metadata fields across all (or a targeted) chapter."""
    from augmentedquill.core.config import load_story_config, save_story_config

    story_path = active / "story.json"
    try:
        story = load_story_config(story_path) or {}
    except Exception:
        return 0, [], []

    p_type = story.get("project_type", "novel")
    if p_type == "series":
        all_chapters = []
        for book in story.get("books", []):
            all_chapters.extend(book.get("chapters", []))
    else:
        all_chapters = story.get("chapters", [])

    total = 0
    changed = []
    change_locations: list[ReplaceChangeLocation] = []

    for idx, entry in enumerate(all_chapters):
        chap_id = chapter_ids[idx] if idx < len(chapter_ids) else idx + 1
        if target_section_id is not None and str(chap_id) != target_section_id:
            continue

        title_label = entry.get("title") or f"Chapter {chap_id}"
        simple_fields = ["title", "summary", "notes", "private_notes"]

        for field_key in simple_fields:
            if target_field is not None and field_key != target_field:
                continue
            value = entry.get(field_key) or ""
            if not value:
                continue
            if match_index is not None:
                new_val, count = _apply_replace_nth(
                    value,
                    query,
                    replacement,
                    case_sensitive,
                    is_regex,
                    is_phonetic,
                    match_index,
                )
            else:
                new_val, count = _apply_replace(
                    value, query, replacement, case_sensitive, is_regex, is_phonetic
                )
            if count > 0:
                entry[field_key] = new_val
                total += count
                label = f"{title_label} {field_key}"
                changed.append(label)
                change_locations.append(
                    _make_change_location(
                        "metadata",
                        str(chap_id),
                        field_key,
                        label,
                    )
                )

        for cidx, conflict in enumerate(entry.get("conflicts") or []):
            for sub_field in ["description", "resolution"]:
                full_field = f"conflicts[{cidx}].{sub_field}"
                if target_field is not None and full_field != target_field:
                    continue
                value = conflict.get(sub_field) or ""
                if not value:
                    continue
                if match_index is not None:
                    new_val, count = _apply_replace_nth(
                        value,
                        query,
                        replacement,
                        case_sensitive,
                        is_regex,
                        is_phonetic,
                        match_index,
                    )
                else:
                    new_val, count = _apply_replace(
                        value, query, replacement, case_sensitive, is_regex, is_phonetic
                    )
                if count > 0:
                    conflict[sub_field] = new_val
                    total += count
                    label = f"{title_label} conflict {cidx + 1} {sub_field}"
                    changed.append(label)
                    change_locations.append(
                        _make_change_location(
                            "metadata",
                            str(chap_id),
                            full_field,
                            label,
                        )
                    )

    if total > 0:
        save_story_config(story_path, story)

    return total, changed, change_locations


# ─── Story metadata ──────────────────────────────────────────────────────────


def _replace_in_story_metadata(
    active: Path,
    query: str,
    replacement: str,
    case_sensitive: bool,
    is_regex: bool,
    is_phonetic: bool,
    target_section_id: str | None = None,
    target_field: str | None = None,
    match_index: int | None = None,
) -> tuple[int, list[str], list[ReplaceChangeLocation]]:
    """Replace in story metadata."""
    from augmentedquill.core.config import load_story_config, save_story_config

    story_path = active / "story.json"
    try:
        story = load_story_config(story_path) or {}
    except Exception:
        return 0, [], []

    total = 0
    changed = []
    change_locations: list[ReplaceChangeLocation] = []

    _story_field_labels: dict[str, str] = {
        "project_title": "Story title",
        "story_summary": "Story summary",
        "notes": "Story notes",
        "private_notes": "Story private notes",
    }
    story_fields = list(_story_field_labels.keys())
    for field_key in story_fields:
        if target_field is not None and field_key != target_field:
            continue
        if target_section_id is not None and target_section_id != "story":
            continue
        value = story.get(field_key) or ""
        if not value:
            continue
        if match_index is not None:
            new_val, count = _apply_replace_nth(
                value,
                query,
                replacement,
                case_sensitive,
                is_regex,
                is_phonetic,
                match_index,
            )
        else:
            new_val, count = _apply_replace(
                value, query, replacement, case_sensitive, is_regex, is_phonetic
            )
        if count > 0:
            story[field_key] = new_val
            total += count
            label = _story_field_labels[field_key]
            changed.append(label)
            change_locations.append(
                _make_change_location("metadata", "story", field_key, label)
            )

    for cidx, conflict in enumerate(story.get("conflicts") or []):
        for sub_field in ["description", "resolution"]:
            full_field = f"conflicts[{cidx}].{sub_field}"
            if target_field is not None and full_field != target_field:
                continue
            if target_section_id is not None and target_section_id != "story":
                continue
            value = conflict.get(sub_field) or ""
            if not value:
                continue
            if match_index is not None:
                new_val, count = _apply_replace_nth(
                    value,
                    query,
                    replacement,
                    case_sensitive,
                    is_regex,
                    is_phonetic,
                    match_index,
                )
            else:
                new_val, count = _apply_replace(
                    value, query, replacement, case_sensitive, is_regex, is_phonetic
                )
            if count > 0:
                conflict[sub_field] = new_val
                total += count
                label = f"Story conflict {cidx + 1} {sub_field}"
                changed.append(label)
                change_locations.append(
                    _make_change_location("metadata", "story", full_field, label)
                )

    # Series books metadata
    for book in story.get("books", []):
        book_id = book.get("id") or ""
        sec_id = f"book:{book_id}"
        if target_section_id is not None and sec_id != target_section_id:
            continue
        book_title = book.get("title") or book_id
        for field_key in ["title", "summary", "notes"]:
            if target_field is not None and field_key != target_field:
                continue
            value = book.get(field_key) or ""
            if not value:
                continue
            if match_index is not None:
                new_val, count = _apply_replace_nth(
                    value,
                    query,
                    replacement,
                    case_sensitive,
                    is_regex,
                    is_phonetic,
                    match_index,
                )
            else:
                new_val, count = _apply_replace(
                    value, query, replacement, case_sensitive, is_regex, is_phonetic
                )
            if count > 0:
                book[field_key] = new_val
                total += count
                label = f"Book '{book_title}' {field_key}"
                changed.append(label)
                change_locations.append(
                    _make_change_location(
                        "book",
                        str(book_id),
                        field_key,
                        label,
                    )
                )

    if total > 0:
        save_story_config(story_path, story)

    return total, changed, change_locations


def _replace_in_scene_metadata(
    active: Path,
    query: str,
    replacement: str,
    case_sensitive: bool,
    is_regex: bool,
    is_phonetic: bool,
    target_section_id: str | None = None,
    target_field: str | None = None,
    match_index: int | None = None,
) -> tuple[int, list[str], list[ReplaceChangeLocation]]:
    """Replace text in scene metadata fields stored inside story.json."""
    from augmentedquill.core.config import load_story_config, save_story_config

    story_path = active / "story.json"
    try:
        story = load_story_config(story_path) or {}
    except Exception:
        return 0, [], []

    scenes = story.get("scenes") or {}
    if not isinstance(scenes, (dict, list)):
        return 0, [], []

    total = 0
    changed: list[str] = []
    change_locations: list[ReplaceChangeLocation] = []

    iterable = scenes.items() if isinstance(scenes, dict) else enumerate(scenes)
    for raw_key, scene in iterable:
        if not isinstance(scene, dict):
            continue
        scene_id = scene.get("id") or raw_key
        scene_id_str = str(scene_id)
        if target_section_id is not None and target_section_id != scene_id_str:
            continue
        scene_label = scene.get("summary") or f"Scene {scene_id_str}"

        field_labels = [
            ("summary", "Summary"),
            ("location", "Location"),
            ("time", "Time"),
            ("timeline_id", "Timeline ID"),
        ]
        for field_key, field_label in field_labels:
            if target_field is not None and field_key != target_field:
                continue
            value = scene.get(field_key) or ""
            if not isinstance(value, str) or not value:
                continue
            if match_index is not None:
                new_val, count = _apply_replace_nth(
                    value,
                    query,
                    replacement,
                    case_sensitive,
                    is_regex,
                    is_phonetic,
                    match_index,
                )
            else:
                new_val, count = _apply_replace(
                    value,
                    query,
                    replacement,
                    case_sensitive,
                    is_regex,
                    is_phonetic,
                )
            if count > 0:
                scene[field_key] = new_val
                total += count
                label = f"{scene_label} {field_label}"
                changed.append(label)
                change_locations.append(
                    _make_change_location("scene", scene_id_str, field_key, label)
                )

        list_fields = [
            ("active_characters", "Active Characters"),
            ("passive_characters", "Passive Characters"),
            ("sourcebook_entry_ids", "Sourcebook Entries"),
        ]
        for field_key, field_label in list_fields:
            if target_field is not None and field_key != target_field:
                continue
            values = scene.get(field_key) or []
            if not isinstance(values, list) or not values:
                continue
            new_values: list[str] = []
            count_field = 0
            for item in values:
                if not isinstance(item, str):
                    new_values.append(item)
                    continue
                if match_index is not None:
                    new_item, c = _apply_replace_nth(
                        item,
                        query,
                        replacement,
                        case_sensitive,
                        is_regex,
                        is_phonetic,
                        match_index,
                    )
                else:
                    new_item, c = _apply_replace(
                        item,
                        query,
                        replacement,
                        case_sensitive,
                        is_regex,
                        is_phonetic,
                    )
                new_values.append(new_item)
                count_field += c
            if count_field > 0:
                scene[field_key] = new_values
                total += count_field
                label = f"{scene_label} {field_label}"
                changed.append(label)
                change_locations.append(
                    _make_change_location("scene", scene_id_str, field_key, label)
                )

        for beat_idx, beat in enumerate(scene.get("beats") or []):
            if not isinstance(beat, dict):
                continue
            field_path = f"beats[{beat_idx}].text"
            if target_field is not None and target_field != field_path:
                continue
            value = beat.get("text") or ""
            if not isinstance(value, str) or not value:
                continue
            if match_index is not None:
                new_val, count = _apply_replace_nth(
                    value,
                    query,
                    replacement,
                    case_sensitive,
                    is_regex,
                    is_phonetic,
                    match_index,
                )
            else:
                new_val, count = _apply_replace(
                    value,
                    query,
                    replacement,
                    case_sensitive,
                    is_regex,
                    is_phonetic,
                )
            if count > 0:
                beat["text"] = new_val
                total += count
                label = f"{scene_label} Beat {beat_idx + 1}"
                changed.append(label)
                change_locations.append(
                    _make_change_location("scene", scene_id_str, field_path, label)
                )

    if total > 0:
        story["scenes"] = scenes
        save_story_config(story_path, story)

    return total, changed, change_locations


# ─── Sourcebook ──────────────────────────────────────────────────────────────


def _replace_in_sourcebook(
    active: Path,
    query: str,
    replacement: str,
    case_sensitive: bool,
    is_regex: bool,
    is_phonetic: bool,
    target_section_id: str | None = None,
    target_field: str | None = None,
    match_index: int | None = None,
) -> tuple[int, list[str], list[ReplaceChangeLocation]]:
    """Replace text in sourcebook entries in story.json."""
    from augmentedquill.core.config import load_story_config, save_story_config

    story_path = active / "story.json"
    try:
        story = load_story_config(story_path) or {}
    except Exception:
        return 0, [], []

    sourcebook = story.get("sourcebook") or {}
    if not isinstance(sourcebook, dict):
        return 0, [], []

    global_rels = story.get("sourcebook_relations") or []
    if not isinstance(global_rels, list):
        global_rels = []

    total = 0
    changed = []
    change_locations: list[ReplaceChangeLocation] = []
    rename_map: dict[str, str] = {}

    for entry_key, entry_data in list(sourcebook.items()):
        if not isinstance(entry_data, dict):
            continue

        entry_id = entry_key
        if target_section_id is not None and entry_id != target_section_id:
            continue

        for field_key, field_label in [
            ("description", "Description"),
            ("name", "Name"),
        ]:
            if target_field is not None and field_key != target_field:
                continue

            value = (
                entry_key if field_key == "name" else entry_data.get(field_key) or ""
            )
            if not value:
                continue

            if match_index is not None:
                new_val, count = _apply_replace_nth(
                    value,
                    query,
                    replacement,
                    case_sensitive,
                    is_regex,
                    is_phonetic,
                    match_index,
                )
            else:
                new_val, count = _apply_replace(
                    value, query, replacement, case_sensitive, is_regex, is_phonetic
                )

            if count > 0:
                total += count
                if field_key == "name":
                    new_name = new_val
                    label = f"Sourcebook '{new_name}' {field_label}"
                    target_id = new_name
                    if new_name != entry_id and new_name not in sourcebook:
                        rename_map[entry_key] = new_name
                    else:
                        target_id = entry_id
                else:
                    label = f"Sourcebook '{entry_id}' {field_label}"
                    target_id = entry_id
                    entry_data[field_key] = new_val

                changed.append(label)
                change_locations.append(
                    _make_change_location(
                        "sourcebook",
                        target_id,
                        field_key,
                        label,
                    )
                )

        if target_field in (None, "synonyms"):
            synonyms = entry_data.get("synonyms") or []
            new_synonyms: list[str] = []
            synonym_count = 0
            for syn in synonyms:
                if match_index is not None:
                    new_syn, c = _apply_replace_nth(
                        syn,
                        query,
                        replacement,
                        case_sensitive,
                        is_regex,
                        is_phonetic,
                        match_index,
                    )
                else:
                    new_syn, c = _apply_replace(
                        syn, query, replacement, case_sensitive, is_regex, is_phonetic
                    )
                new_synonyms.append(new_syn)
                synonym_count += c
            if synonym_count > 0:
                entry_data["synonyms"] = new_synonyms
                total += synonym_count
                label = f"Sourcebook '{entry_id}' synonyms"
                changed.append(label)
                change_locations.append(
                    _make_change_location(
                        "sourcebook",
                        entry_id,
                        "synonyms",
                        label,
                    )
                )

        if target_field in (None, "relations") or (
            target_field is not None and target_field.startswith("relations[")
        ):
            for rel_idx, rel in enumerate(global_rels):
                if not isinstance(rel, dict):
                    continue
                if (
                    rel.get("source_id") != entry_id
                    and rel.get("target_id") != entry_id
                ):
                    continue

                relation_fields = [
                    ("relation", "Relation"),
                    ("source_id", "Source ID"),
                    ("target_id", "Target ID"),
                    ("start_chapter", "Start Chapter"),
                    ("end_chapter", "End Chapter"),
                    ("start_book", "Start Book"),
                    ("end_book", "End Book"),
                ]
                for rel_field, rel_label in relation_fields:
                    field_path = f"relations[{rel_idx}].{rel_field}"
                    if target_field is not None and target_field != field_path:
                        continue

                    value = rel.get(rel_field) or ""
                    if not isinstance(value, str) or not value:
                        continue

                    if match_index is not None:
                        new_val, count = _apply_replace_nth(
                            value,
                            query,
                            replacement,
                            case_sensitive,
                            is_regex,
                            is_phonetic,
                            match_index,
                        )
                    else:
                        new_val, count = _apply_replace(
                            value,
                            query,
                            replacement,
                            case_sensitive,
                            is_regex,
                            is_phonetic,
                        )

                    if count > 0:
                        rel[rel_field] = new_val
                        total += count
                        label = f"Sourcebook '{entry_id}' relation {rel_label}"
                        changed.append(label)
                        change_locations.append(
                            _make_change_location(
                                "sourcebook",
                                entry_id,
                                field_path,
                                label,
                            )
                        )

    for old_name, new_name in rename_map.items():
        if old_name in sourcebook and new_name not in sourcebook:
            sourcebook[new_name] = sourcebook.pop(old_name)
            for rel in global_rels:
                if rel.get("source_id") == old_name:
                    rel["source_id"] = new_name
                if rel.get("target_id") == old_name:
                    rel["target_id"] = new_name
            for location in change_locations:
                if location.type == "sourcebook" and location.target_id == old_name:
                    location.target_id = new_name
                    location.label = location.label.replace(
                        f"Sourcebook '{old_name}'",
                        f"Sourcebook '{new_name}'",
                    )

    if total > 0:
        story["sourcebook"] = sourcebook
        story["sourcebook_relations"] = global_rels
        save_story_config(story_path, story)

    return total, changed, change_locations


# ─── Public API ──────────────────────────────────────────────────────────────


def replace_all(req: ReplaceAllRequest, active: Path) -> ReplaceResponse:
    """Replace every occurrence of the query within the specified scope."""
    q = req.query
    r = req.replacement
    cs = req.case_sensitive
    rx = req.is_regex
    ph = req.is_phonetic

    if not q.strip():
        return ReplaceResponse(replacements_made=0, changed_sections=[])

    scope = req.scope
    total = 0
    changed: list[str] = []
    changed_locations: list[ReplaceChangeLocation] = []

    chapter_ids = _get_all_chapter_ids()

    if scope in (
        SearchScope.current_chapter,
        SearchScope.all_chapters,
        SearchScope.all,
    ):
        ids = (
            [req.active_chapter_id]
            if scope == SearchScope.current_chapter
            and req.active_chapter_id is not None
            else chapter_ids
        )
        for chap_id in ids:
            count, label, location = _replace_in_chapter_content(
                chap_id, q, r, cs, rx, ph, match_index=None
            )
            if count > 0 and label:
                total += count
                changed.append(label)
                if location is not None:
                    changed_locations.append(location)

    if scope in (SearchScope.metadata, SearchScope.all):
        n, labels, locations = _replace_in_chapter_metadata(
            active, chapter_ids, q, r, cs, rx, ph
        )
        total += n
        changed.extend(labels)
        changed_locations.extend(locations)
        n, labels, locations = _replace_in_story_metadata(active, q, r, cs, rx, ph)
        total += n
        changed.extend(labels)
        changed_locations.extend(locations)
        n, labels, locations = _replace_in_scene_metadata(active, q, r, cs, rx, ph)
        total += n
        changed.extend(labels)
        changed_locations.extend(locations)

    if scope in (SearchScope.sourcebook, SearchScope.all):
        n, labels, locations = _replace_in_sourcebook(active, q, r, cs, rx, ph)
        total += n
        changed.extend(labels)
        changed_locations.extend(locations)

    return ReplaceResponse(
        replacements_made=total,
        changed_sections=changed,
        changed_sections_meta=changed_locations,
    )


def replace_single(req: ReplaceSingleRequest, active: Path) -> ReplaceResponse:
    """Replace a single specifically identified match."""
    q = req.query
    r = req.replacement
    cs = req.case_sensitive
    rx = req.is_regex
    ph = req.is_phonetic
    sec_type = req.section_type
    sec_id = req.section_id
    field = req.field
    idx = req.match_index

    chapter_ids = _get_all_chapter_ids()

    if sec_type == "chapter_content":
        try:
            chap_id = int(sec_id)
        except ValueError:
            return ReplaceResponse(replacements_made=0, changed_sections=[])
        count, label, location = _replace_in_chapter_content(
            chap_id, q, r, cs, rx, ph, match_index=idx
        )
        return ReplaceResponse(
            replacements_made=count,
            changed_sections=[label] if count and label else [],
            changed_sections_meta=[location] if location is not None else [],
        )

    if sec_type == "chapter_metadata":
        n, labels, locations = _replace_in_chapter_metadata(
            active,
            chapter_ids,
            q,
            r,
            cs,
            rx,
            ph,
            target_section_id=sec_id,
            target_field=field,
            match_index=idx,
        )
        return ReplaceResponse(
            replacements_made=n,
            changed_sections=labels,
            changed_sections_meta=locations,
        )

    if sec_type == "story_metadata":
        n, labels, locations = _replace_in_story_metadata(
            active,
            q,
            r,
            cs,
            rx,
            ph,
            target_section_id=sec_id,
            target_field=field,
            match_index=idx,
        )
        return ReplaceResponse(
            replacements_made=n,
            changed_sections=labels,
            changed_sections_meta=locations,
        )

    if sec_type == "scene_metadata":
        n, labels, locations = _replace_in_scene_metadata(
            active,
            q,
            r,
            cs,
            rx,
            ph,
            target_section_id=sec_id,
            target_field=field,
            match_index=idx,
        )
        return ReplaceResponse(
            replacements_made=n,
            changed_sections=labels,
            changed_sections_meta=locations,
        )

    if sec_type == "sourcebook":
        n, labels, locations = _replace_in_sourcebook(
            active,
            q,
            r,
            cs,
            rx,
            ph,
            target_section_id=sec_id,
            target_field=field,
            match_index=idx,
        )
        return ReplaceResponse(
            replacements_made=n,
            changed_sections=labels,
            changed_sections_meta=locations,
        )

    return ReplaceResponse(replacements_made=0, changed_sections=[])
