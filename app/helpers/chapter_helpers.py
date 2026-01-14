# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import re
from pathlib import Path
from typing import List, Tuple, Dict, Any
from fastapi import HTTPException

from app.config import load_story_config


def _scan_chapter_files() -> List[Tuple[str, Path]]:
    """Return list of (global_id, path) for chapter files.

    For Medium projects: global_id is likely the string of int '1', '2'.
    For Large projects: global_id could be 'book_id:chap_idx' or just linear index.

    COMPATIBILITY NOTE: The rest of the app expects integer IDs often.
    However, for Large projects, file names overlap (0001.txt in Book 1 and Book 2).

    To maintain minimal changes elsewhere, we will return a linear list where
    the returned 'ID' is the 1-based index in the *full sequence*.

    Returns: List of (virtual_id, path).
    """
    from app.projects import get_active_project_dir

    active = get_active_project_dir()
    if not active:
        return []

    story = load_story_config(active / "story.json") or {}
    p_type = story.get("project_type", "novel")

    if p_type == "short-story":
        p = active / "content.md"
        return [(1, p)]

    if p_type == "series":
        books = story.get("books", [])
        items = []
        global_idx = 1
        for book in books:
            bid = book.get("id")
            if not bid:
                continue

            # Use 'chapters' dir inside the book dir
            # Requirement: "each book should have its own directory where the chapter files ... are stored"
            b_dir = active / "books" / bid
            if not b_dir.exists():
                continue

            chapters_dir = b_dir / "chapters"
            if not chapters_dir.exists():
                continue

            # Scan book chapters
            book_items = []
            for p in chapters_dir.glob("*.txt"):
                if not p.is_file():
                    continue
                name = p.name
                m = re.match(r"^(\d{4})\.txt$", name)
                if m:
                    idx = int(m.group(1))
                    book_items.append((idx, p))

            # Sort by local filename index
            book_items.sort(key=lambda t: t[0])

            # Assign global ID
            for _, path in book_items:
                items.append((global_idx, path))
                global_idx += 1
        return items

    # Medium
    chapters_dir = active / "chapters"
    if not chapters_dir.exists() or not chapters_dir.is_dir():
        return []
    items: List[Tuple[int, Path]] = []
    for p in chapters_dir.glob("*.txt"):
        if not p.is_file():
            continue
        name = p.name
        m = re.match(r"^(\d{4})\.txt$", name)
        if m:
            idx = int(m.group(1))
            items.append((idx, p))
            continue
    items.sort(key=lambda t: t[0])

    # Remap to linear 1-based index to be safe?
    # Current system relies on ID matching filename for writes.
    # But `write_chapter_content` uses this scan function to find path.
    # So if we return `(idx, p)` where idx is from filename, it works for Medium.
    return items


def _load_chapter_titles(count: int) -> List[str]:
    """Load chapter titles from story.json chapters array if present.
    Do not pad; callers decide fallbacks (e.g., filename).
    """
    from app.projects import get_active_project_dir

    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    titles = story.get("chapters") or []
    # Normalize to strings and keep as-provided; empty strings allowed (handled by caller)
    titles = [str(x) for x in titles if isinstance(x, (str, int, float))]
    return titles[:count]


def _normalize_chapter_entry(entry: Any) -> Dict[str, Any]:
    """Ensures a chapter entry is a dict with 'title', 'summary', 'filename'.
    Preserves other existing keys. Handles JS '[object Object]' leak.
    """

    def _sanitize_text(val: Any) -> str:
        s = str(val if val is not None else "").strip()
        if s.lower() == "[object object]":
            return ""
        return s

    if isinstance(entry, dict):
        res = entry.copy()
        res["title"] = _sanitize_text(res.get("title", ""))
        res["summary"] = _sanitize_text(res.get("summary", ""))
        res["filename"] = _sanitize_text(res.get("filename", ""))
        return res
    elif isinstance(entry, (str, int, float)):
        return {"title": _sanitize_text(entry), "summary": "", "filename": ""}
    return {"title": "", "summary": "", "filename": ""}


def _chapter_by_id_or_404(chap_id: int) -> tuple[Path, int, int]:
    files = _scan_chapter_files()
    match = next(
        ((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None
    )
    if not match:
        available = [f[0] for f in files]
        raise HTTPException(
            status_code=404,
            detail=f"Chapter with ID {chap_id} not found. Available chapter IDs: {available}. "
            f"Please call get_project_overview to refresh your knowledge of chapter IDs.",
        )
    return match  # (idx, path, pos)


def _get_chapter_metadata_entry(
    story: dict, chap_id: int, path: Path, files: list = None
) -> dict | None:
    """Find the specific metadata entry in story.json for a given chapter global ID.
    Handles 'novel', 'short-story', and 'series' project types consistently.
    Returns the dict entry by reference if found.
    """
    if files is None:
        files = _scan_chapter_files()

    p_type = story.get("project_type", "novel")
    if p_type == "series":
        book_id = path.parent.parent.name
        books = story.get("books", [])
        book = next((b for b in books if b.get("id") == book_id), None)
        if not book:
            return None
        book_chapters = book.setdefault("chapters", [])
        book_files = [f for f in files if f[1].parent.parent.name == book_id]
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
                if id(candidate) not in used_ids:
                    if (
                        not isinstance(candidate, dict)
                        or not candidate.get("filename")
                        or candidate.get("filename") == fname
                    ):
                        curr_match = candidate
            if curr_match:
                used_ids.add(id(curr_match))
                if f_idx == chap_id:
                    if not isinstance(curr_match, dict):
                        idx_in_book = book_chapters.index(curr_match)
                        curr_match = {
                            "title": str(curr_match),
                            "summary": "",
                            "filename": fname,
                        }
                        book_chapters[idx_in_book] = curr_match
                    return curr_match
    else:
        chapters_data = story.setdefault("chapters", [])
        used_ids = set()
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
                if id(candidate) not in used_ids:
                    if (
                        not isinstance(candidate, dict)
                        or not candidate.get("filename")
                        or candidate.get("filename") == fname
                    ):
                        curr_match = candidate
            if curr_match:
                used_ids.add(id(curr_match))
                if f_idx == chap_id:
                    if not isinstance(curr_match, dict):
                        idx_in_root = chapters_data.index(curr_match)
                        curr_match = {
                            "title": str(curr_match),
                            "summary": "",
                            "filename": fname,
                        }
                        chapters_data[idx_in_root] = curr_match
                    return curr_match
    return None
