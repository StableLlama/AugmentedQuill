# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the project helpers unit so this responsibility stays isolated, testable, and easy to evolve."""

from typing import Any

from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.core.config import load_story_config
from augmentedquill.services.chapters.chapter_helpers import (
    _scan_chapter_files,
    _normalize_chapter_entry,
    _chapter_by_id_or_404,
)


def normalize_story_for_frontend(story: dict) -> dict:
    """Prepare story data for the frontend by converting internal storage formats
    (like dict-based sourcebook) back into frontend-friendly formats (like sorted lists).
    Also ensures missing internal IDs (which are not stored on disk) are injected
    using stable filesystem-based identifiers where possible.
    """
    if not story:
        return {}
    res = story.copy()

    # ensure language field is surfaced; frontend may use it to display
    # or to pass back when creating new content.
    if "language" not in res:
        res["language"] = "en"

    # Frontend expects a list shape; normalizing here keeps storage format
    # decoupled from UI transport format.
    sb = res.get("sourcebook", {})
    if isinstance(sb, dict):
        new_sb = []
        for name, data in sorted(sb.items(), key=lambda x: x[0].lower()):
            new_sb.append({"id": name, "name": name, **data})
        res["sourcebook"] = new_sb
    elif not isinstance(sb, list):
        res["sourcebook"] = []

    # Stable book IDs are required to keep chapter routing deterministic
    # when titles change.
    if res.get("project_type") == "series" and "books" in res:
        books = res["books"]
        if isinstance(books, list):
            from augmentedquill.services.projects.projects import get_active_project_dir

            active = get_active_project_dir()
            if active:
                books_dir = active / "books"
                if books_dir.exists():
                    folders = sorted(
                        [d.name for d in books_dir.iterdir() if d.is_dir()]
                    )

                    new_books = []
                    for i, book in enumerate(books):
                        if isinstance(book, dict):
                            b_copy = book.copy()
                            if not b_copy.get("id"):
                                b_copy["id"] = b_copy.get("folder")

                            if not b_copy.get("id"):
                                # that predate explicit IDs.
                                if i < len(folders):
                                    b_copy["id"] = folders[i]
                            new_books.append(b_copy)
                    res["books"] = new_books

    # Scenes: normalise from dict (on-disk format) to sorted list for frontend.
    scenes_raw = res.get("scenes", {})
    if isinstance(scenes_raw, dict):
        scenes_list = [{"id": sid, **data} for sid, data in scenes_raw.items()]
        scenes_list.sort(key=lambda s: (s.get("pinboard_y", 0), s.get("pinboard_x", 0)))
        res["scenes"] = scenes_list
    elif not isinstance(scenes_raw, list):
        res["scenes"] = []

    # Conflict IDs are synthesized when missing so editing and reordering
    # remain stable in the frontend.
    def _handle_chapters(chapters: Any) -> Any:
        """Handle Chapters."""
        if not isinstance(chapters, list):
            return
        for chap in chapters:
            if isinstance(chap, dict) and "conflicts" in chap:
                conflicts = chap["conflicts"]
                if isinstance(conflicts, list):
                    for i, conflict in enumerate(conflicts):
                        if isinstance(conflict, dict) and "id" not in conflict:
                            conflict["id"] = f"conf_{i}"

    story_conflicts = res.get("conflicts")
    if isinstance(story_conflicts, list):
        for i, conflict in enumerate(story_conflicts):
            if isinstance(conflict, dict) and "id" not in conflict:
                conflict["id"] = f"story_conf_{i}"

    if res.get("project_type") == "series" and "books" in res:
        for book in res["books"]:
            if isinstance(book, dict):
                _handle_chapters(book.get("chapters", []))
    else:
        _handle_chapters(res.get("chapters", []))

    return res


def _project_overview(include_notes: bool = False) -> dict:
    """Return project title and a list of chapters with id, title, and summary.

    Notes are excluded by default to keep the overview lightweight.
    """
    active = get_active_project_dir()
    raw_story = (
        load_story_config(active / "story.json") if active is not None else {}
    ) or {}
    story = normalize_story_for_frontend(raw_story)
    p_type = story.get("project_type", "novel")

    base_info = {
        "project_title": story.get("project_title") or (active.name if active else ""),
        "project_type": p_type,
        "sourcebook_entry_count": len(story.get("sourcebook", {})),
        "scene_count": len(story.get("scenes", [])),
        "story_summary": story.get("story_summary") or "",
        "notes": story.get("notes") or "",
    }

    if p_type == "short-story":
        draft = {
            "title": story.get("project_title") or (active.name if active else ""),
            "summary": story.get("story_summary") or "",
        }
        if include_notes:
            draft["notes"] = story.get("notes") or ""

        return {
            **base_info,
            "draft": draft,
        }

    if p_type == "series":
        files = _scan_chapter_files()
        books = story.get("books", [])
        enriched_books = []

        # Build a metadata map from filesystem order to keep chapter identity
        # aligned with persisted files even after renames.
        all_meta = []
        for b in books:
            bid = b.get("id") or b.get("folder")
            for c in b.get("chapters", []):
                norm = _normalize_chapter_entry(c)
                norm["_parent_book_id"] = bid
                all_meta.append(norm)

        id_to_meta = {}
        used_m_ids = set()
        for b in books:
            bid = b.get("id") or b.get("folder")
            book_files = [(idx, p) for (idx, p) in files if p.parent.parent.name == bid]
            book_meta = [m for m in all_meta if m.get("_parent_book_id") == bid]

            for i, (idx, p) in enumerate(book_files):
                fname = p.name
                match = next(
                    (
                        c
                        for c in book_meta
                        if c.get("filename") == fname and id(c) not in used_m_ids
                    ),
                    None,
                )
                if not match and i < len(book_meta):
                    cand = book_meta[i]
                    if not cand.get("filename") and id(cand) not in used_m_ids:
                        match = cand

                if match:
                    used_m_ids.add(id(match))
                    id_to_meta[idx] = match

        for b in books:
            bid = b.get("id") or b.get("folder")
            b_chapters = []
            for vid, path in files:
                if f"books/{bid}/" in str(path):
                    meta = id_to_meta.get(vid, {})
                    chapter_item = {
                        "id": vid,
                        "title": meta.get("title") or path.stem,
                        "summary": meta.get("summary") or "",
                    }
                    if include_notes:
                        chapter_item["notes"] = meta.get("notes") or ""
                    b_chapters.append(chapter_item)
            enriched_books.append(
                {
                    "id": bid,
                    "title": b.get("title", ""),
                    "chapters": b_chapters,
                }
            )
        return {**base_info, "books": enriched_books}

    chapters_meta = [_normalize_chapter_entry(c) for c in (story.get("chapters") or [])]
    files = _scan_chapter_files()
    out: list[dict] = []
    for idx, path in files:
        pos = next((i for i, (cid, _) in enumerate(files) if cid == idx), None)
        title = None
        summary = ""
        notes = ""
        if isinstance(pos, int) and pos < len(chapters_meta):
            title = chapters_meta[pos].get("title")
            summary = chapters_meta[pos].get("summary") or ""
            notes = chapters_meta[pos].get("notes") or ""
        if not title or str(title).strip() in ("[object Object]", "object Object"):
            title = path.name
        chapter_item = {
            "id": idx,
            "title": title,
            "summary": summary,
        }
        if include_notes:
            chapter_item["notes"] = notes
        out.append(chapter_item)
    return {**base_info, "chapters": out}


def _chapter_content_slice(chap_id: int, start: int = 0, max_chars: int = 8000) -> dict:
    """Return a safe slice of chapter content with metadata."""
    if start < 0:
        start = 0
    if max_chars <= 0:
        max_chars = 1
    _, path, _pos = _chapter_by_id_or_404(chap_id)
    text = path.read_text(encoding="utf-8")
    total = len(text)
    end = min(total, start + max_chars)
    return {
        "id": chap_id,
        "start": start,
        "end": end,
        "total": total,
        "content": text[start:end],
    }


def _snap_to_boundary(
    text: str,
    pos: int,
    forward: bool,
    word_scan: int = 20,
    sentence_scan: int = 100,
) -> int:
    """Adjust a character boundary to avoid mid-word or mid-sentence cuts.

    When forward=True, adjusts an end boundary forward (scans right).
    When forward=False, adjusts a start boundary backward (scans left).
    Prefers a newline (sentence boundary) over a space (word boundary).
    Returns pos unchanged if it is already on a clean break.
    """
    total = len(text)
    _WS = (" ", "\n", "\t", "\r")

    if forward:
        # Clean if pos is at end or the next char is whitespace.
        if pos >= total or text[pos] in _WS:
            return pos
        snippet_far = text[pos : min(total, pos + sentence_scan)]
        nl_idx = snippet_far.find("\n")
        if nl_idx >= 0:
            return pos + nl_idx + 1
        snippet_near = text[pos : min(total, pos + word_scan)]
        sp_idx = snippet_near.find(" ")
        if sp_idx >= 0:
            return pos + sp_idx + 1
        return pos
    else:
        # Clean if pos is at start or the previous char is whitespace.
        if pos <= 0 or text[pos - 1] in _WS:
            return pos
        snippet_far = text[max(0, pos - sentence_scan) : pos]
        nl_idx = snippet_far.rfind("\n")
        if nl_idx >= 0:
            return max(0, pos - sentence_scan) + nl_idx + 1
        snippet_near = text[max(0, pos - word_scan) : pos]
        sp_idx = snippet_near.rfind(" ")
        if sp_idx >= 0:
            return max(0, pos - word_scan) + sp_idx + 1
        return pos
