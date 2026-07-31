# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the project chapter ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from augmentedquill.core.config import load_story_config, save_story_config
from augmentedquill.services.chapters.chapter_helpers import (
    _chapter_by_id_or_404,
    _get_chapter_metadata_entry,
    _scan_chapter_files,
)
from augmentedquill.services.projects.project_locks import run_locked
from augmentedquill.services.scenes.scene_markers import (
    parse_scene_spans,
    remove_markers,
    transfer_scene_markers,
    validate_scene_marker_tokens,
)
from augmentedquill.utils.json_repair import apply_typographic_quotes


def write_chapter_content_in_project(
    chap_id: int, content: str, active: Path | None = None
) -> None:
    """Write content to a chapter by its ID."""
    _, path, _ = _chapter_by_id_or_404(chap_id, active=active)
    existing_content = path.read_text(encoding="utf-8") if path.exists() else ""
    validate_scene_marker_tokens(existing_content)

    story_root = path
    for _ in range(5):
        candidate = story_root / "story.json"
        if candidate.exists():
            break
        story_root = story_root.parent

    story = load_story_config(story_root / "story.json") or {}
    project_lang = str(story.get("language", "en") or "en")

    converted_content = apply_typographic_quotes(content, language=project_lang)
    preserved = transfer_scene_markers(existing_content, converted_content)
    validate_scene_marker_tokens(preserved)
    path.write_text(preserved, encoding="utf-8")


def update_chapter_metadata_in_project(
    active: Path,
    chap_id: int,
    title: str | None = None,
    summary: str | None = None,
    notes: str | None = None,
    private_notes: str | None = None,
    conflicts: list | None = None,
) -> None:
    """Update metadata fields for a chapter by its ID across all project types."""
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}

    if story.get("project_type") == "short-story":
        raise ValueError("Short Story projects do not have chapter metadata")

    _, path, _ = _chapter_by_id_or_404(chap_id, active=active)
    files = _scan_chapter_files(active)

    target_entry = _get_chapter_metadata_entry(
        story, chap_id, path, files, active=active
    )

    if target_entry is None:
        p_type = story.get("project_type", "novel")
        if p_type == "series":
            book_id = path.parent.parent.name
            books = story.setdefault("books", [])
            book = next((b for b in books if b.get("id") == book_id), None)
            if book:
                book_chapters = book.setdefault("chapters", [])
                target_entry = {
                    "title": path.stem,
                    "summary": "",
                    "filename": path.name,
                }
                book_chapters.append(target_entry)
        else:
            chapters_data = story.setdefault("chapters", [])
            target_entry = {
                "title": path.stem,
                "summary": "",
                "filename": path.name,
            }
            chapters_data.append(target_entry)

    if target_entry is not None:
        if title is not None:
            new_title_str = str(title).strip()
            if new_title_str.lower() != "[object object]":
                target_entry["title"] = new_title_str

        if summary is not None:
            target_entry["summary"] = summary.strip()
        if notes is not None:
            target_entry["notes"] = notes
        if private_notes is not None:
            target_entry["private_notes"] = private_notes
        if conflicts is not None:
            target_entry["conflicts"] = conflicts

        save_story_config(story_path, story)
    else:
        raise ValueError(
            f"Could not find or create metadata entry for chapter {chap_id}"
        )


def _get_chapter_target_and_story(active: Path, chap_id: int) -> Any:
    """Return chapter target and story."""
    _, path, _ = _chapter_by_id_or_404(chap_id, active=active)
    files = _scan_chapter_files(active)
    story_path = active / "story.json"

    story = load_story_config(story_path) or {}
    target = _get_chapter_metadata_entry(story, chap_id, path, files, active=active)
    if target is None:
        raise ValueError(f"Chapter {chap_id} metadata not found.")
    return story, story_path, target


def add_chapter_conflict_in_project(
    active: Path,
    chap_id: int,
    description: str,
    resolution: str,
    index: int | None = None,
) -> None:
    """Add a conflict to a chapter. If index is provided, inserts there; else appends."""
    story, story_path, target = _get_chapter_target_and_story(active, chap_id)

    conflicts = target.setdefault("conflicts", [])
    new_conflict = {"description": description, "resolution": resolution}

    if index is not None and 0 <= index <= len(conflicts):
        conflicts.insert(index, new_conflict)
    else:
        conflicts.append(new_conflict)

    save_story_config(story_path, story)


def update_chapter_conflict_in_project(
    active: Path,
    chap_id: int,
    index: int,
    description: str | None = None,
    resolution: str | None = None,
) -> None:
    """Update a specific conflict in a chapter by its index."""
    story, story_path, target = _get_chapter_target_and_story(active, chap_id)

    conflicts = target.get("conflicts", [])
    if not (0 <= index < len(conflicts)):
        raise IndexError(
            f"Conflict index {index} out of range (total {len(conflicts)})"
        )

    if description is not None:
        conflicts[index]["description"] = description
    if resolution is not None:
        conflicts[index]["resolution"] = resolution

    save_story_config(story_path, story)


def remove_chapter_conflict_in_project(active: Path, chap_id: int, index: int) -> None:
    """Remove a conflict from a chapter by its index."""
    story, story_path, target = _get_chapter_target_and_story(active, chap_id)

    conflicts = target.get("conflicts", [])
    if not (0 <= index < len(conflicts)):
        raise IndexError(
            f"Conflict index {index} out of range (total {len(conflicts)})"
        )

    conflicts.pop(index)
    save_story_config(story_path, story)


def reorder_chapter_conflicts_in_project(
    active: Path, chap_id: int, new_indices: list[int]
) -> None:
    """Reorder conflicts in a chapter providing the new sequence of indices."""
    story, story_path, target = _get_chapter_target_and_story(active, chap_id)

    conflicts = target.get("conflicts", [])
    if len(new_indices) != len(conflicts):
        raise ValueError("List of indices must match total number of conflicts.")

    new_list = []
    for idx in new_indices:
        if not (0 <= idx < len(conflicts)):
            raise IndexError(f"Index {idx} out of range.")
        new_list.append(conflicts[idx])

    target["conflicts"] = new_list
    save_story_config(story_path, story)


def write_chapter_title_in_project(active: Path, chap_id: int, title: str) -> None:
    """Update the title of a chapter in the story.json across all project types."""
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}

    if story.get("project_type") == "short-story":
        raise ValueError("Short Story projects do not have chapter titles")

    _, path, _ = _chapter_by_id_or_404(chap_id, active=active)
    files = _scan_chapter_files(active)

    new_title_str = str(title).strip()
    if new_title_str.lower() == "[object object]":
        new_title_str = ""

    target_entry = _get_chapter_metadata_entry(
        story, chap_id, path, files, active=active
    )

    if target_entry is not None:
        target_entry["title"] = new_title_str
        save_story_config(story_path, story)
    else:
        raise ValueError(f"Could not find metadata entry for chapter {chap_id}")


def delete_chapter_in_project(active: Path, chap_id: int) -> None:
    """Delete a chapter file and remove its metadata from story.json."""
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    if story.get("project_type") == "short-story":
        raise ValueError("Short Story projects do not have chapters")

    _, path, _ = _chapter_by_id_or_404(chap_id, active=active)
    files = _scan_chapter_files(active)

    def _migrate_scene_markers_before_delete() -> None:
        if not path.exists():
            return

        same_scope_files = [
            f_path for _, f_path in files if f_path.parent == path.parent
        ]
        try:
            removed_index = same_scope_files.index(path)
        except ValueError:
            return

        destination_path: Path | None = None
        if removed_index > 0:
            destination_path = same_scope_files[removed_index - 1]
        elif removed_index + 1 < len(same_scope_files):
            destination_path = same_scope_files[removed_index + 1]

        if destination_path is None or not destination_path.exists():
            return

        source_content = path.read_text(encoding="utf-8")
        validate_scene_marker_tokens(source_content)
        moved_scene_ids = {span.scene_id for span in parse_scene_spans(source_content)}
        if not moved_scene_ids:
            return

        destination_content = destination_path.read_text(encoding="utf-8")
        validate_scene_marker_tokens(destination_content)
        destination_without_duplicates = remove_markers(
            destination_content, moved_scene_ids
        )

        source_payload = source_content.strip("\n")
        if not source_payload:
            return

        if destination_without_duplicates:
            separator = (
                "\n\n" if not destination_without_duplicates.endswith("\n") else "\n"
            )
            merged_content = (
                f"{destination_without_duplicates}{separator}{source_payload}"
            )
        else:
            merged_content = source_payload
        destination_path.write_text(merged_content, encoding="utf-8")

    _migrate_scene_markers_before_delete()
    path.unlink()
    p_type = story.get("project_type", "novel")

    if p_type == "series":
        book_id = path.parent.parent.name
        books = story.get("books", [])
        book = next((b for b in books if b.get("id") == book_id), None)
        if book:
            book_chapters = book.get("chapters", [])
            book_files = [f for f in files if f[1].parent.parent.name == book_id]

            target_id = None
            used_ids = set()
            for i, (f_idx, f_p) in enumerate(book_files):
                fname = f_p.name
                curr_match = next(
                    (
                        c
                        for c in book_chapters
                        if isinstance(c, dict)
                        and c.get("filename") == fname
                        and id(c) not in used_ids
                    ),
                    None,
                )
                if not curr_match and i < len(book_chapters):
                    candidate = book_chapters[i]
                    if id(candidate) not in used_ids and (
                        not isinstance(candidate, dict)
                        or not candidate.get("filename")
                        or candidate.get("filename") == fname
                    ):
                        curr_match = candidate

                if curr_match:
                    used_ids.add(id(curr_match))
                    if f_idx == chap_id:
                        target_id = id(curr_match)
                        break

            if target_id:
                book["chapters"] = [c for c in book_chapters if id(c) != target_id]
    else:
        chapters_data = story.get("chapters") or []
        used_ids = set()
        target_id = None
        for i, (f_idx, f_p) in enumerate(files):
            fname = f_p.name
            curr_match = next(
                (
                    c
                    for c in chapters_data
                    if isinstance(c, dict)
                    and c.get("filename") == fname
                    and id(c) not in used_ids
                ),
                None,
            )
            if not curr_match and i < len(chapters_data):
                candidate = chapters_data[i]
                if id(candidate) not in used_ids and (
                    not isinstance(candidate, dict)
                    or not candidate.get("filename")
                    or candidate.get("filename") == fname
                ):
                    curr_match = candidate

            if curr_match:
                used_ids.add(id(curr_match))
                if f_idx == chap_id:
                    target_id = id(curr_match)
                    break

        if target_id:
            story["chapters"] = [c for c in chapters_data if id(c) != target_id]

    save_story_config(story_path, story)


# ---------------------------------------------------------------------------
# Async locked wrappers — preferred for use inside FastAPI route handlers
# ---------------------------------------------------------------------------


async def async_write_chapter_content_in_project(
    chap_id: int, content: str, active: Path | None = None
) -> None:
    """Async, per-project-locked variant of write_chapter_content_in_project."""
    if active is None:
        # Determine the project root the same way the sync function would.
        from augmentedquill.services.chapters.chapter_helpers import (
            _chapter_by_id_or_404,
        )

        _, path, _ = _chapter_by_id_or_404(chap_id, active=None)
        project_dir = path.parent
        while project_dir != project_dir.parent:
            if (project_dir / "story.json").exists():
                break
            project_dir = project_dir.parent
    else:
        project_dir = active
    await run_locked(
        project_dir,
        lambda: write_chapter_content_in_project(chap_id, content, active=active),
    )


async def async_update_chapter_metadata_in_project(
    active: Path,
    chap_id: int,
    title: str | None = None,
    summary: str | None = None,
    notes: str | None = None,
    private_notes: str | None = None,
    conflicts: list | None = None,
) -> None:
    """Async, per-project-locked variant of update_chapter_metadata_in_project."""
    await run_locked(
        active,
        lambda: update_chapter_metadata_in_project(
            active,
            chap_id,
            title=title,
            summary=summary,
            notes=notes,
            private_notes=private_notes,
            conflicts=conflicts,
        ),
    )


async def async_write_chapter_title_in_project(
    active: Path, chap_id: int, title: str
) -> None:
    """Async, per-project-locked variant of write_chapter_title_in_project."""
    await run_locked(
        active, lambda: write_chapter_title_in_project(active, chap_id, title)
    )


async def async_delete_chapter_in_project(active: Path, chap_id: int) -> None:
    """Async, per-project-locked variant of delete_chapter_in_project."""
    await run_locked(active, lambda: delete_chapter_in_project(active, chap_id))
