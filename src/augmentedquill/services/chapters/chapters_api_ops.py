# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chapters api ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from pathlib import Path

from augmentedquill.core.config import load_story_config, save_story_config
from augmentedquill.services.chapters.chapter_helpers import (
    _normalize_chapter_entry,
    _get_chapter_metadata_entry,
    _scan_chapter_files,
)


def _resolve_title(path: Path, chapter_entry: dict) -> str:
    """Resolve Title."""
    raw_title = (chapter_entry.get("title") or "").strip()
    if raw_title and raw_title.lower() != "[object object]":
        return raw_title
    stem = path.stem
    if stem.isdigit():
        return stem
    return stem.replace("_", " ").replace("-", " ").title()


def _normalize_conflicts(conflicts: list) -> list:
    normalized = conflicts or []
    for index, conflict in enumerate(normalized):
        if isinstance(conflict, dict) and "id" not in conflict:
            conflict["id"] = f"conf_{index}"
    return normalized


def build_chapter_entry(
    idx: int, path: Path, story: dict, files: list[tuple[int, Path]]
) -> dict:
    """Build Chapter Entry."""
    chapter_entry = _get_chapter_metadata_entry(story, idx, path, files) or {}
    conflicts = _normalize_conflicts(chapter_entry.get("conflicts") or [])

    book_id = chapter_entry.get("book_id", chapter_entry.get("_parent_book_id"))
    if not book_id and story.get("project_type") == "series":
        book_id = path.parent.parent.name

    return {
        "id": idx,
        "title": _resolve_title(path, chapter_entry),
        "filename": path.name,
        "summary": (chapter_entry.get("summary") or "").strip(),
        "notes": (chapter_entry.get("notes") or "").strip(),
        "private_notes": (chapter_entry.get("private_notes") or "").strip(),
        "conflicts": conflicts,
        "book_id": book_id,
    }


def list_chapters_payload(active: Path | None) -> list[dict]:
    files = _scan_chapter_files()
    if not active:
        return []
    story = load_story_config(active / "story.json") or {}
    return [build_chapter_entry(idx, path, story, files) for idx, path in files]


def chapter_detail_payload(active: Path | None, chap_id: int, path: Path) -> dict:
    """Chapter Detail Payload."""
    files = _scan_chapter_files()
    story = load_story_config((active / "story.json") if active else None) or {}
    base = build_chapter_entry(chap_id, path, story, files)
    return {
        "id": chap_id,
        "title": base["title"],
        "filename": base["filename"],
        "summary": base["summary"],
        "notes": base["notes"],
        "private_notes": base["private_notes"],
        "conflicts": base["conflicts"],
    }


def reorder_chapters_in_project(active: Path, payload: dict) -> None:
    """Reorder Chapters In Project."""
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    project_type = story.get("project_type", "novel")

    if project_type == "series":
        book_id = payload.get("book_id")
        if not book_id:
            # Check if this project is a series but the request came without book_id
            raise ValueError("book_id required for series projects")

        chapter_ids = payload.get("chapter_ids", [])
        if not isinstance(chapter_ids, list):
            raise ValueError("chapter_ids must be a list")

        all_files = _scan_chapter_files()

        all_metadata = []
        for book in story.get("books", []):
            bid = book.get("id") or book.get("folder")
            for chapter in book.get("chapters", []):
                norm = _normalize_chapter_entry(chapter)
                norm["_parent_book_id"] = bid
                norm["_original_object"] = chapter
                all_metadata.append(norm)

        id_to_data = {}
        used_m_ids = set()
        for i, (idx, path) in enumerate(all_files):
            fname = path.name
            f_bid = path.parent.parent.name

            match = next(
                (
                    chapter
                    for chapter in all_metadata
                    if chapter.get("filename") == fname
                    and chapter.get("_parent_book_id") == f_bid
                    and id(chapter) not in used_m_ids
                ),
                None,
            )

            if not match:
                match = next(
                    (
                        chapter
                        for chapter in all_metadata
                        if chapter.get("filename") == fname
                        and id(chapter) not in used_m_ids
                    ),
                    None,
                )

            if not match:
                book_m = [
                    chapter
                    for chapter in all_metadata
                    if chapter.get("_parent_book_id") == f_bid
                ]
                book_files = [
                    file_item
                    for file_item in all_files
                    if file_item[1].parent.parent.name == f_bid
                ]
                f_pos = next(
                    (
                        pos
                        for pos, file_item in enumerate(book_files)
                        if file_item[0] == idx
                    ),
                    0,
                )
                if f_pos < len(book_m):
                    cand = book_m[f_pos]
                    if id(cand) not in used_m_ids and (
                        not cand.get("filename") or cand.get("filename") == fname
                    ):
                        match = cand

            if not match and i < len(all_metadata):
                cand = all_metadata[i]
                if id(cand) not in used_m_ids:
                    match = cand

            if match:
                used_m_ids.add(id(match))

            id_to_data[idx] = (
                path,
                match or {"title": "", "summary": "", "filename": fname},
            )

        target_book = next(
            (
                book
                for book in story.get("books", [])
                if (book.get("id") == book_id or book.get("folder") == book_id)
            ),
            None,
        )
        if not target_book:
            raise LookupError(
                f"Book with ID '{book_id}' not found. Please use the UUID from the project overview."
            )

        existing_ids = [
            idx
            for idx, (path, meta) in id_to_data.items()
            if path.parent.parent.name == book_id
        ]

        final_ids = []
        for cid in chapter_ids:
            if cid in id_to_data:
                final_ids.append(cid)
            else:
                raise ValueError(
                    f"Chapter ID {cid} not found in project. Available: {list(id_to_data.keys())}"
                )
        for cid in existing_ids:
            if cid not in final_ids:
                final_ids.append(cid)

        target_dir = active / "books" / book_id / "chapters"
        target_dir.mkdir(parents=True, exist_ok=True)

        triplets = []
        for cid in final_ids:
            path, metadata = id_to_data[cid]
            triplets.append((path, metadata))

            original_bid = metadata.get("_parent_book_id")
            if original_bid and original_bid != book_id:
                orig_book = next(
                    (
                        book
                        for book in story.get("books", [])
                        if (
                            book.get("id") == original_bid
                            or book.get("folder") == original_bid
                        )
                    ),
                    None,
                )
                if orig_book:
                    orig_book["chapters"] = [
                        chapter
                        for chapter in orig_book.get("chapters", [])
                        if id(chapter) != id(metadata.get("_original_object"))
                    ]

        temp_renames = []
        final_renames = []
        new_chapters_metadata = []

        for i, (old_path, metadata) in enumerate(triplets):
            new_filename = f"{i + 1:04d}.txt"
            clean_metadata = metadata.get("_original_object")
            if clean_metadata is None:
                clean_metadata = {
                    "title": metadata.get("title", ""),
                    "summary": metadata.get("summary", ""),
                }
            clean_metadata["filename"] = new_filename
            new_chapters_metadata.append(clean_metadata)

            temp_path = target_dir / f"temp_{new_filename}"
            final_path = target_dir / new_filename
            temp_renames.append((old_path, temp_path))
            final_renames.append((temp_path, final_path))

        for old_p, temp_p in temp_renames:
            if old_p.exists():
                old_p.rename(temp_p)
        for temp_p, final_p in final_renames:
            if temp_p.exists():
                if final_p.exists():
                    final_p.unlink()
                temp_p.rename(final_p)

        target_book["chapters"] = new_chapters_metadata

    else:
        chapter_ids = payload.get("chapter_ids", [])
        if not isinstance(chapter_ids, list):
            raise ValueError("chapter_ids must be a list")

        chapters_data = story.get("chapters", [])
        chapters_data = [_normalize_chapter_entry(chapter) for chapter in chapters_data]

        files = _scan_chapter_files()
        all_ids = [item[0] for item in files]

        for cid in chapter_ids:
            if cid not in all_ids:
                raise ValueError(
                    f"Chapter ID {cid} not found. Available chapter IDs: {all_ids}."
                )

        triplets = []
        used_metadata_ids = set()

        for i, (idx, path) in enumerate(files):
            fname = path.name
            match_data = next(
                (
                    chapter
                    for chapter in chapters_data
                    if chapter.get("filename") == fname
                    and id(chapter) not in used_metadata_ids
                ),
                None,
            )

            if not match_data and i < len(chapters_data):
                candidate = chapters_data[i]
                if id(candidate) not in used_metadata_ids:
                    if (
                        not candidate.get("filename")
                        or candidate.get("filename") == fname
                    ):
                        match_data = candidate

            if not match_data and i < len(chapters_data):
                candidate = chapters_data[i]
                if id(candidate) not in used_metadata_ids:
                    match_data = candidate

            if match_data:
                used_metadata_ids.add(id(match_data))

            triplets.append(
                (
                    idx,
                    path,
                    match_data or {"title": "", "summary": "", "filename": fname},
                )
            )

        reordered_triplets = sorted(
            triplets,
            key=lambda item: (
                chapter_ids.index(item[0])
                if item[0] in chapter_ids
                else len(chapter_ids) + files.index((item[0], item[1]))
            ),
        )

        reordered_chapters = [item[2] for item in reordered_triplets]
        for chapter in chapters_data:
            if not any(chapter is item[2] for item in reordered_triplets):
                reordered_chapters.append(chapter)

        chapters_dir = active / "chapters"
        temp_renames = []
        final_renames = []
        for i, triplet in enumerate(reordered_triplets):
            idx, old_path, chapter = triplet
            new_filename = f"{i + 1:04d}.txt"
            chapter["filename"] = new_filename

            temp_path = chapters_dir / f"temp_{new_filename}"
            new_path = chapters_dir / new_filename
            temp_renames.append((old_path, temp_path))
            final_renames.append((temp_path, new_path))

        for old_p, temp_p in temp_renames:
            if old_p.exists():
                old_p.rename(temp_p)
        for temp_p, new_p in final_renames:
            if temp_p.exists():
                temp_p.rename(new_p)

        story["chapters"] = reordered_chapters

    save_story_config(story_path, story)


def reorder_books_in_project(active: Path, payload: dict) -> None:
    """Reorder Books In Project."""
    book_ids = payload.get("book_ids", [])
    if not isinstance(book_ids, list):
        raise ValueError("book_ids must be a list")

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    project_type = story.get("project_type", "novel")

    if project_type != "series":
        raise ValueError("Books reordering only available for series projects")

    books = story.get("books", [])
    book_map = {(book.get("id") or book.get("folder")): book for book in books}

    reordered_books = []
    for book_id in book_ids:
        if book_id in book_map:
            reordered_books.append(book_map[book_id])

    story["books"] = reordered_books
    save_story_config(story_path, story)
