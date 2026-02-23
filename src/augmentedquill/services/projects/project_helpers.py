# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the project helpers unit so this responsibility stays isolated, testable, and easy to evolve."""

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

    # Conflict IDs are synthesized when missing so editing and reordering
    # remain stable in the frontend.
    def _handle_chapters(chapters):
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

    if res.get("project_type") == "series" and "books" in res:
        for book in res["books"]:
            if isinstance(book, dict):
                _handle_chapters(book.get("chapters", []))
    else:
        _handle_chapters(res.get("chapters", []))

    return res


def _project_overview() -> dict:
    """Return project title and a list of chapters with id, filename, title, summary."""
    active = get_active_project_dir()
    raw_story = load_story_config((active / "story.json") if active else None) or {}
    story = normalize_story_for_frontend(raw_story)
    p_type = story.get("project_type", "novel")

    base_info = {
        "project_title": story.get("project_title") or (active.name if active else ""),
        "project_type": p_type,
        "sourcebook_entry_count": len(story.get("sourcebook", {})),
    }

    if p_type == "short-story":
        fn = story.get("content_file", "content.md")

        # Preserve authored metadata so single-file projects still present
        # rich chapter details in the same shape as multi-chapter projects.
        chapters = story.get("chapters", [])
        title = "Story Content"
        summary = "Full content of the story"

        if chapters and len(chapters) > 0:
            c0 = chapters[0]
            if isinstance(c0, dict):
                t = c0.get("title")
                if t and str(t).strip():
                    title = str(t).strip()
                s = c0.get("summary")
                if s and str(s).strip():
                    summary = str(s).strip()
                notes = c0.get("notes", "")
                conflicts = c0.get("conflicts", [])
            else:
                notes = ""
                conflicts = []
        else:
            notes = ""
            conflicts = []

        return {
            **base_info,
            "content_file": fn,
            "chapters": [
                {
                    "id": 1,
                    "filename": fn,
                    "title": title,
                    "summary": summary,
                    "notes": notes,
                    "conflicts": conflicts,
                }
            ],
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
                    b_chapters.append(
                        {
                            "id": vid,
                            "filename": path.name,
                            "title": meta.get("title") or path.stem,
                            "summary": meta.get("summary") or "",
                            "notes": meta.get("notes") or "",
                            "conflicts": meta.get("conflicts") or [],
                        }
                    )
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
        conflicts = []
        if isinstance(pos, int) and pos < len(chapters_meta):
            title = chapters_meta[pos].get("title")
            summary = chapters_meta[pos].get("summary") or ""
            notes = chapters_meta[pos].get("notes") or ""
            conflicts = chapters_meta[pos].get("conflicts") or []
        if not title or str(title).strip() in ("[object Object]", "object Object"):
            title = path.name
        out.append(
            {
                "id": idx,
                "filename": path.name,
                "title": title,
                "summary": summary,
                "notes": notes,
                "conflicts": conflicts,
            }
        )
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
