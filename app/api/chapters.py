# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

from fastapi import APIRouter, Request, HTTPException, Path as FastAPIPath
from fastapi.responses import JSONResponse
import json as _json

from app.projects import get_active_project_dir
from app.config import load_story_config
from app.helpers.chapter_helpers import (
    _scan_chapter_files,
    _normalize_chapter_entry,
)

router = APIRouter()


@router.get("/api/chapters")
async def api_chapters() -> dict:
    files = _scan_chapter_files()
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}

    p_type = story.get("project_type", "novel")
    chapters_data = []

    if p_type == "series":
        for book in story.get("books", []):
            bid = book.get("id")
            for c in book.get("chapters", []):
                norm = _normalize_chapter_entry(c)
                norm["book_id"] = bid
                chapters_data.append(norm)
    else:
        chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]

    result = []
    used_metadata_ids = set()

    for i, (idx, p) in enumerate(files):
        # Try to find metadata by filename matching if possible
        fname = p.name
        match_data = None

        # 1. Try filename match
        match_data = next(
            (
                c
                for c in chapters_data
                if c.get("filename") == fname and id(c) not in used_metadata_ids
            ),
            None,
        )

        # 2. Simple heuristic: try index first, checking if filename matches or is empty
        if not match_data and i < len(chapters_data):
            candidate = chapters_data[i]
            if id(candidate) not in used_metadata_ids:
                if candidate.get("filename") == fname or not candidate.get("filename"):
                    match_data = candidate

        # 3. Fallback to index if still no match and valid index
        if not match_data and i < len(chapters_data):
            candidate = chapters_data[i]
            if id(candidate) not in used_metadata_ids:
                match_data = candidate

        if match_data:
            used_metadata_ids.add(id(match_data))

        chap_entry = match_data or {"title": "", "summary": ""}

        raw_title = (chap_entry.get("title") or "").strip()
        if raw_title:
            title = raw_title
        else:
            # General fallback: pretty print the filename stem
            stem = p.stem
            if stem.isdigit():
                # Keep numeric names simple
                title = stem
            else:
                # content -> Content, my_chapter -> My Chapter
                title = stem.replace("_", " ").replace("-", " ").title()

        summary = (chap_entry.get("summary") or "").strip()
        book_id = chap_entry.get("book_id")

        result.append(
            {
                "id": idx,
                "title": title,
                "filename": p.name,
                "summary": summary,
                "book_id": book_id,
            }
        )
    return {"chapters": result}


@router.get("/api/chapters/{chap_id}")
async def api_chapter_content(chap_id: int = FastAPIPath(..., ge=0)) -> dict:
    files = _scan_chapter_files()
    # Find by numeric id
    match = next(
        ((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None
    )
    if not match:
        raise HTTPException(status_code=404, detail="Chapter not found")
    idx, path, pos = match

    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    p_type = story.get("project_type", "novel")

    # Robust metadata matching matching api_chapters()
    chapters_data = []
    if p_type == "series":
        for book in story.get("books", []):
            for c in book.get("chapters", []):
                chapters_data.append(_normalize_chapter_entry(c))
    else:
        chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]

    # Find the specific metadata for THIS file using the same logic as the list endpoint
    used_metadata_ids = set()
    chap_entry = None
    for i, (f_idx, f_p) in enumerate(files):
        fname = f_p.name
        match_data = next(
            (
                c
                for c in chapters_data
                if c.get("filename") == fname and id(c) not in used_metadata_ids
            ),
            None,
        )
        if not match_data and i < len(chapters_data):
            candidate = chapters_data[i]
            if id(candidate) not in used_metadata_ids:
                if candidate.get("filename") == fname or not candidate.get("filename"):
                    match_data = candidate
        if not match_data and i < len(chapters_data):
            candidate = chapters_data[i]
            if id(candidate) not in used_metadata_ids:
                match_data = candidate

        if match_data:
            used_metadata_ids.add(id(match_data))

        if f_idx == chap_id:
            chap_entry = match_data
            break

    chap_entry = chap_entry or {"title": "", "summary": ""}

    # Consistent fallback logic with the list endpoint
    raw_title = (chap_entry.get("title") or "").strip()
    if raw_title:
        title = raw_title
    else:
        # General fallback: pretty print the filename stem
        stem = path.stem
        if stem.isdigit():
            title = stem
        else:
            title = stem.replace("_", " ").replace("-", " ").title()

    summary = (chap_entry.get("summary") or "").strip()

    try:
        content = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")
    return {
        "id": idx,
        "title": title,
        "filename": path.name,
        "content": content,
        "summary": summary,
    }


@router.put("/api/chapters/{chap_id}/title")
async def api_update_chapter_title(
    request: Request, chap_id: int = FastAPIPath(..., ge=0)
) -> JSONResponse:
    """Update the title of a chapter in the active project's story.json."""
    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    new_title = (payload or {}).get("title")
    if new_title is None:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "title is required"}
        )
    new_title_str = str(new_title).strip()
    # Sanitize bogus JS toString leakage
    if new_title_str.lower() == "[object object]":
        new_title_str = ""

    files = _scan_chapter_files()
    match = next(
        ((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None
    )
    if not match:
        raise HTTPException(status_code=404, detail="Chapter not found")
    _, path, pos = match

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    p_type = story.get("project_type", "novel")

    # Find and update the correct entry
    target_entry = None
    if p_type == "series":
        book_id = path.parent.parent.name
        book = next((b for b in story.get("books", []) if b.get("id") == book_id), None)
        if not book:
            return JSONResponse(
                status_code=404, content={"ok": False, "detail": "Book not found"}
            )

        # Consistent matching logic
        book_chapters = book.get("chapters", [])
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
                        # Convert to dict if it was a string
                        idx_in_book = book_chapters.index(curr_match)
                        curr_match = {
                            "title": str(curr_match),
                            "summary": "",
                            "filename": fname,
                        }
                        book_chapters[idx_in_book] = curr_match
                    target_entry = curr_match
                    break
    else:
        chapters_data = story.get("chapters") or []
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
                    target_entry = curr_match
                    break
        story["chapters"] = chapters_data

    if target_entry is not None:
        target_entry["title"] = new_title_str
    else:
        # If we reached here, something is out of sync, fallback to creating an entry
        # or doing nothing if we can't find where to put it.
        pass

    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to write story.json: {e}"},
        )

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "chapter": {
                "id": chap_id,
                "title": new_title_str or path.name,
                "filename": path.name,
                "summary": (target_entry.get("summary") or "") if target_entry else "",
            },
        },
    )


@router.post("/api/chapters")
async def api_create_chapter(request: Request) -> JSONResponse:
    """Create a new chapter file at the end and update titles list.
    Body: {"title": str | None, "content": str | None, "book_id": str | None}
    """
    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    title = str(payload.get("title", "")).strip() if isinstance(payload, dict) else ""
    content = (
        payload.get("content") if isinstance(payload, dict) else ""
    )  # Default content?
    if content is None:
        content = ""

    book_id = payload.get("book_id") if isinstance(payload, dict) else None

    # Use centralized logic
    from app.projects import create_new_chapter, write_chapter_content

    try:
        # Create chapter entry & file
        chap_id = create_new_chapter(title, book_id=book_id)

        # If content provided, write it
        if content:
            write_chapter_content(chap_id, str(content))

        # Re-fetch info to return compliant response
        # Currently the response expects {ok: true, id: ..., title: ..., ...}
        # But frontend `addChapter` calls api then `api.chapters.list()`.
        # Frontend API `create` returns `res.json()`.
        # Let's return the new chapter object.
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "id": chap_id,
                "title": title,
                "book_id": book_id,
                "summary": "",
                "message": "Chapter created",
            },
        )

    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "detail": str(e)})
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to create chapter: {e}"},
        )


@router.put("/api/chapters/{chap_id}/content")
async def api_update_chapter_content(
    request: Request, chap_id: int = FastAPIPath(..., ge=0)
) -> JSONResponse:
    """Persist chapter content to its file.
    Body: {"content": str}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    if not isinstance(payload, dict) or "content" not in payload:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "content is required"}
        )
    new_content = str(payload.get("content", ""))

    files = _scan_chapter_files()
    match = next(
        ((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None
    )
    if not match:
        raise HTTPException(status_code=404, detail="Chapter not found")
    _, path, _ = match

    try:
        path.write_text(new_content, encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to write chapter: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True})


@router.put("/api/chapters/{chap_id}/summary")
async def api_update_chapter_summary(
    request: Request, chap_id: int = FastAPIPath(..., ge=0)
) -> JSONResponse:
    """Update the summary of a chapter in the active project's story.json.

    Body: {"summary": str}
    """
    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )

    # Parse body
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    if not isinstance(payload, dict) or "summary" not in payload:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "summary is required"}
        )
    new_summary = str(payload.get("summary", "")).strip()

    # Locate chapter by id
    files = _scan_chapter_files()
    match = next(
        ((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None
    )
    if not match:
        raise HTTPException(status_code=404, detail="Chapter not found")
    _, path, pos = match

    # Load and normalize story.json
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    p_type = story.get("project_type", "novel")

    # Find and update the correct entry
    target_entry = None
    if p_type == "series":
        book_id = path.parent.parent.name
        book = next((b for b in story.get("books", []) if b.get("id") == book_id), None)
        if not book:
            return JSONResponse(
                status_code=404, content={"ok": False, "detail": "Book not found"}
            )

        # Consistent matching logic
        book_chapters = book.get("chapters", [])
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
                        # Convert to dict if it was a string
                        idx_in_book = book_chapters.index(curr_match)
                        curr_match = {
                            "title": str(curr_match),
                            "summary": "",
                            "filename": fname,
                        }
                        book_chapters[idx_in_book] = curr_match
                    target_entry = curr_match
                    break
    else:
        chapters_data = story.get("chapters") or []
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
                    target_entry = curr_match
                    break
        story["chapters"] = chapters_data

    if target_entry is not None:
        target_entry["summary"] = new_summary
    else:
        # Fallback if synchronization failed
        pass

    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to write story.json: {e}"},
        )

    title_for_response = (
        (target_entry.get("title") or path.name) if target_entry else path.name
    )
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "chapter": {
                "id": chap_id,
                "title": title_for_response,
                "filename": path.name,
                "summary": new_summary,
            },
        },
    )


@router.delete("/api/chapters/{chap_id}")
async def api_delete_chapter(chap_id: int = FastAPIPath(..., ge=0)) -> JSONResponse:
    """Delete a chapter file and update story.json.
    Removes the file and shifts subsequent chapters' metadata.
    """
    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )

    files = _scan_chapter_files()
    match = next(
        ((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None
    )
    if not match:
        raise HTTPException(status_code=404, detail="Chapter not found")
    _, path, pos = match

    # Delete the file
    try:
        path.unlink()
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to delete chapter file: {e}"},
        )

    # Update story.json
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    p_type = story.get("project_type", "novel")

    if p_type == "series":
        book_id = path.parent.parent.name
        book = next((b for b in story.get("books", []) if b.get("id") == book_id), None)
        if book:
            book_chapters = book.get("chapters", [])
            book_files = [f for f in files if f[1].parent.parent.name == book_id]

            # Find which entry to remove using identity matching
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
                    target_id = id(curr_match)
                    break

        if target_id:
            story["chapters"] = [c for c in chapters_data if id(c) != target_id]

    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update story.json: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True})


@router.post("/api/chapters/reorder")
async def api_reorder_chapters(request: Request) -> JSONResponse:
    """Reorder chapters in a novel project or within a book in a series project.
    Body: {"chapter_ids": [id1, id2, ...]} for novel projects
    Body: {"book_id": "book_id", "chapter_ids": [id1, id2, ...]} for series projects
    """
    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    p_type = story.get("project_type", "novel")

    if p_type == "series":
        book_id = payload.get("book_id")
        if not book_id:
            return JSONResponse(
                status_code=400,
                content={"ok": False, "detail": "book_id required for series projects"},
            )

        chapter_ids = payload.get("chapter_ids", [])
        if not isinstance(chapter_ids, list):
            return JSONResponse(
                status_code=400,
                content={"ok": False, "detail": "chapter_ids must be a list"},
            )

        # Find the book
        books = story.get("books", [])
        book = next((b for b in books if b.get("id") == book_id), None)
        if not book:
            return JSONResponse(
                status_code=404, content={"ok": False, "detail": "Book not found"}
            )

        # Reorder chapters within the book using global IDs
        from app.helpers.chapter_helpers import _scan_chapter_files

        files = _scan_chapter_files()

        # Get (idx, path) for this book only
        book_files = [(idx, p) for idx, p in files if p.parent.parent.name == book_id]

        # Correlate files with metadata for THIS book
        book_chapters = book.get("chapters", [])

        # To match precisely, we'll build a list of (idx, path, metadata)
        # using the same matching logic as api_chapters() but limited to this book.
        triplets = []
        used_metadata_ids = set()  # Track by id() to handle identical-looking dicts

        for i, (idx, p) in enumerate(book_files):
            fname = p.name
            match_data = None

            # 1. Try filename match
            match_data = next(
                (
                    c
                    for c in book_chapters
                    if c.get("filename") == fname and id(c) not in used_metadata_ids
                ),
                None,
            )

            # 2. Try heuristic (index match if no specific filename assigned or matching)
            if not match_data and i < len(book_chapters):
                candidate = book_chapters[i]
                if id(candidate) not in used_metadata_ids:
                    if (
                        not candidate.get("filename")
                        or candidate.get("filename") == fname
                    ):
                        match_data = candidate

            # 3. Fallback to any unused metadata at this index position
            if not match_data and i < len(book_chapters):
                candidate = book_chapters[i]
                if id(candidate) not in used_metadata_ids:
                    match_data = candidate

            if match_data:
                used_metadata_ids.add(id(match_data))

            triplets.append(
                (idx, p, match_data or {"title": "", "summary": "", "filename": fname})
            )

        # Now sort the triplets according to the provided chapter_ids
        # Any idx not in chapter_ids stays at the end in its original relative order
        reordered_triplets = sorted(
            triplets,
            key=lambda x: (
                chapter_ids.index(x[0])
                if x[0] in chapter_ids
                else len(chapter_ids) + book_files.index((x[0], x[1]))
            ),
        )

        # Build the new reordered_chapters metadata list
        reordered_chapters = [t[2] for t in reordered_triplets]

        # Add any remaining metadata that wasn't matched to a file (safety)
        for chap in book_chapters:
            if not any(chap is t[2] for t in reordered_triplets):
                reordered_chapters.append(chap)

        # Update filenames and rename files
        chapters_dir = active / "books" / book_id / "chapters"
        temp_renames = []
        final_renames = []

        for i, triplet in enumerate(reordered_triplets):
            idx, old_path, chap = triplet
            new_filename = f"{i+1:04d}.txt"
            chap["filename"] = new_filename

            temp_path = chapters_dir / f"temp_{new_filename}"
            new_path = chapters_dir / new_filename
            temp_renames.append((old_path, temp_path))
            final_renames.append((temp_path, new_path))

        # Execute renames
        for old_p, temp_p in temp_renames:
            if old_p.exists():
                old_p.rename(temp_p)
        for temp_p, new_p in final_renames:
            if temp_p.exists():
                temp_p.rename(new_p)

        book["chapters"] = reordered_chapters

    else:  # novel or short-story
        chapter_ids = payload.get("chapter_ids", [])
        if not isinstance(chapter_ids, list):
            return JSONResponse(
                status_code=400,
                content={"ok": False, "detail": "chapter_ids must be a list"},
            )

        # For novel projects, reorder the chapters array
        chapters_data = story.get("chapters", [])
        chapters_data = [_normalize_chapter_entry(c) for c in chapters_data]

        from app.helpers.chapter_helpers import _scan_chapter_files

        files = _scan_chapter_files()

        # Correlate files with metadata using the SAME logic as api_chapters()
        triplets = []
        used_metadata_ids = set()

        for i, (idx, p) in enumerate(files):
            fname = p.name
            match_data = None

            # 1. Try filename match
            match_data = next(
                (
                    c
                    for c in chapters_data
                    if c.get("filename") == fname and id(c) not in used_metadata_ids
                ),
                None,
            )

            # 2. Try heuristic (index match if no specific filename assigned or matching)
            if not match_data and i < len(chapters_data):
                candidate = chapters_data[i]
                if id(candidate) not in used_metadata_ids:
                    if (
                        not candidate.get("filename")
                        or candidate.get("filename") == fname
                    ):
                        match_data = candidate

            # 3. Fallback to any unused metadata at this index position
            if not match_data and i < len(chapters_data):
                candidate = chapters_data[i]
                if id(candidate) not in used_metadata_ids:
                    match_data = candidate

            if match_data:
                used_metadata_ids.add(id(match_data))

            triplets.append(
                (idx, p, match_data or {"title": "", "summary": "", "filename": fname})
            )

        # Reorder based on provided chapter_ids
        reordered_triplets = sorted(
            triplets,
            key=lambda x: (
                chapter_ids.index(x[0])
                if x[0] in chapter_ids
                else len(chapter_ids) + files.index((x[0], x[1]))
            ),
        )

        # New reordered metadata list
        reordered_chapters = [t[2] for t in reordered_triplets]

        # Add any metadata that wasn't matched (safety)
        for chap in chapters_data:
            if not any(chap is t[2] for t in reordered_triplets):
                reordered_chapters.append(chap)

        # Update filenames and rename files
        chapters_dir = active / "chapters"
        temp_renames = []
        final_renames = []
        for i, triplet in enumerate(reordered_triplets):
            idx, old_path, chap = triplet
            new_filename = f"{i+1:04d}.txt"
            chap["filename"] = new_filename

            temp_path = chapters_dir / f"temp_{new_filename}"
            new_path = chapters_dir / new_filename
            temp_renames.append((old_path, temp_path))
            final_renames.append((temp_path, new_path))

        # Execute renames
        for old_p, temp_p in temp_renames:
            if old_p.exists():
                old_p.rename(temp_p)
        for temp_p, new_p in final_renames:
            if temp_p.exists():
                temp_p.rename(new_p)

        story["chapters"] = reordered_chapters

    # Save the updated story
    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update story.json: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True})


@router.post("/api/books/reorder")
async def api_reorder_books(request: Request) -> JSONResponse:
    """Reorder books in a series project.
    Body: {"book_ids": [id1, id2, ...]}
    """
    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    book_ids = payload.get("book_ids", [])
    if not isinstance(book_ids, list):
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "book_ids must be a list"}
        )

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    p_type = story.get("project_type", "novel")

    if p_type != "series":
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "detail": "Books reordering only available for series projects",
            },
        )

    books = story.get("books", [])

    # Create a mapping of book IDs to books
    book_map = {b.get("id"): b for b in books}

    # Reorder based on provided IDs
    reordered_books = []
    for book_id in book_ids:
        if book_id in book_map:
            reordered_books.append(book_map[book_id])

    story["books"] = reordered_books

    # Save the updated story
    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update story.json: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True})
