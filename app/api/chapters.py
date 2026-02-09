# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

from fastapi import APIRouter, Request, HTTPException, Path as FastAPIPath
from fastapi.responses import JSONResponse

from app.projects import get_active_project_dir
from app.config import load_story_config
from app.helpers.chapter_helpers import (
    _scan_chapter_files,
    _normalize_chapter_entry,
    _chapter_by_id_or_404,
)

router = APIRouter()


@router.get("/api/chapters")
async def api_chapters() -> dict:
    from app.helpers.chapter_helpers import _get_chapter_metadata_entry

    files = _scan_chapter_files()
    active = get_active_project_dir()
    if not active:
        return {"chapters": []}
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}

    # Resulting objects
    result = []
    for i, (idx, p) in enumerate(files):
        chap_entry = _get_chapter_metadata_entry(story, idx, p, files) or {}

        # Consistent fallback logic
        raw_title = (chap_entry.get("title") or "").strip()
        if raw_title and raw_title.lower() != "[object object]":
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
        notes = (chap_entry.get("notes") or "").strip()
        private_notes = (chap_entry.get("private_notes") or "").strip()
        conflicts = chap_entry.get("conflicts") or []
        # Inject synthetic IDs if missing from disk
        for i, c in enumerate(conflicts):
            if isinstance(c, dict) and "id" not in c:
                c["id"] = f"conf_{i}"

        book_id = chap_entry.get("book_id", chap_entry.get("_parent_book_id"))
        if not book_id and story.get("project_type") == "series":
            # Parent of chapters/ is the book folder
            book_id = p.parent.parent.name

        result.append(
            {
                "id": idx,
                "title": title,
                "filename": p.name,
                "summary": summary,
                "notes": notes,
                "private_notes": private_notes,
                "conflicts": conflicts,
                "book_id": book_id,
            }
        )
    return {"chapters": result}


@router.get("/api/chapters/{chap_id}")
async def api_chapter_content(chap_id: int = FastAPIPath(..., ge=0)) -> dict:
    _, path, _ = _chapter_by_id_or_404(chap_id)
    files = _scan_chapter_files()

    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}

    from app.helpers.chapter_helpers import _get_chapter_metadata_entry

    chap_entry = _get_chapter_metadata_entry(story, chap_id, path, files) or {}

    # Consistent fallback logic with the list endpoint
    raw_title = (chap_entry.get("title") or "").strip()
    if raw_title and raw_title.lower() != "[object object]":
        title = raw_title
    else:
        # General fallback: pretty print the filename stem
        stem = path.stem
        if stem.isdigit():
            title = stem
        else:
            title = stem.replace("_", " ").replace("-", " ").title()

    summary = (chap_entry.get("summary") or "").strip()
    notes = (chap_entry.get("notes") or "").strip()
    private_notes = (chap_entry.get("private_notes") or "").strip()
    conflicts = chap_entry.get("conflicts") or []
    # Inject synthetic IDs if missing from disk
    for i, c in enumerate(conflicts):
        if isinstance(c, dict) and "id" not in c:
            c["id"] = f"conf_{i}"

    try:
        content = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")
    return {
        "id": chap_id,
        "title": title,
        "filename": path.name,
        "content": content,
        "summary": summary,
        "notes": notes,
        "private_notes": private_notes,
        "conflicts": conflicts,
    }


@router.put("/api/chapters/{chap_id}/metadata")
async def api_update_chapter_metadata(
    request: Request, chap_id: int = FastAPIPath(..., ge=0)
) -> JSONResponse:
    """Update metadata (summary, notes, private_notes, conflicts) of a chapter.
    Body: {"summary": str, "notes": str, "private_notes": str, "conflicts": list}
    Any field omitted will be left unchanged.
    """
    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if not isinstance(payload, dict):
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "Invalid payload"}
        )

    # Extract fields (None means not provided -> do not update)
    title = payload.get("title")
    summary = payload.get("summary")
    notes = payload.get("notes")
    private_notes = payload.get("private_notes")
    conflicts = payload.get("conflicts")

    if title is not None:
        title = str(title).strip()
    if summary is not None:
        summary = str(summary).strip()
    if notes is not None:
        notes = str(notes)
    if private_notes is not None:
        private_notes = str(private_notes)
    if conflicts is not None:
        if not isinstance(conflicts, list):
            return JSONResponse(
                status_code=400,
                content={"ok": False, "detail": "conflicts must be a list"},
            )
        # normalize conflicts just in case (e.g. ensure they are dicts)

    from app.projects import update_chapter_metadata

    try:
        update_chapter_metadata(
            chap_id,
            title=title,
            summary=summary,
            notes=notes,
            private_notes=private_notes,
            conflicts=conflicts,
        )

    except ValueError as e:
        return JSONResponse(status_code=404, content={"ok": False, "detail": str(e)})

    # Re-fetch for response logic could be added here if needed,
    # but for now just return success + updated fields for confirmation
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "id": chap_id,
            "message": "Metadata updated",
        },
    )


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

    from app.projects import write_chapter_title

    try:
        write_chapter_title(chap_id, new_title_str)
    except ValueError as e:
        return JSONResponse(status_code=404, content={"ok": False, "detail": str(e)})

    # Re-fetch for response
    _, path, _ = _chapter_by_id_or_404(chap_id)
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "chapter": {
                "id": chap_id,
                "title": new_title_str or path.name,
                "filename": path.name,
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

    _, path, _ = _chapter_by_id_or_404(chap_id)

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

    from app.projects import write_chapter_summary

    try:
        write_chapter_summary(chap_id, new_summary)
    except ValueError as e:
        return JSONResponse(status_code=404, content={"ok": False, "detail": str(e)})

    # Re-fetch for response
    _, path, _ = _chapter_by_id_or_404(chap_id)
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "chapter": {
                "id": chap_id,
                "filename": path.name,
                "summary": new_summary,
            },
        },
    )


@router.delete("/api/chapters/{chap_id}")
async def api_delete_chapter(chap_id: int = FastAPIPath(..., ge=0)) -> JSONResponse:
    """Delete a chapter file and update story.json."""
    from app.projects import delete_chapter

    try:
        delete_chapter(chap_id)
        return JSONResponse(status_code=200, content={"ok": True})
    except ValueError as e:
        return JSONResponse(status_code=404, content={"ok": False, "detail": str(e)})
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to delete chapter: {e}"},
        )


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

        # 1. Identify all requested chapters across the project
        from app.helpers.chapter_helpers import _scan_chapter_files

        all_files = _scan_chapter_files()

        # Build global ID -> (path, metadata) mapping
        # First, collect all metadata from all books
        all_metadata = []
        for b in story.get("books", []):
            bid = b.get("id")
            for c in b.get("chapters", []):
                norm = _normalize_chapter_entry(c)
                norm["_parent_book_id"] = bid
                norm["_original_object"] = c
                all_metadata.append(norm)

        id_to_data = {}
        used_m_ids = set()
        for i, (idx, p) in enumerate(all_files):
            fname = p.name
            # p is books/<book_id>/chapters/<num>.txt
            f_bid = p.parent.parent.name

            # 1. Try exact match: filename AND book_id
            match = next(
                (
                    c
                    for c in all_metadata
                    if c.get("filename") == fname
                    and c.get("_parent_book_id") == f_bid
                    and id(c) not in used_m_ids
                ),
                None,
            )

            # 2. Heuristic: match by filename only (if move happened but book_id shifted in metadata?)
            if not match:
                match = next(
                    (
                        c
                        for c in all_metadata
                        if c.get("filename") == fname and id(c) not in used_m_ids
                    ),
                    None,
                )

            # 3. Positional fallback within the SAME book if possible
            if not match:
                # Find all metadata for this specific book
                book_m = [c for c in all_metadata if c.get("_parent_book_id") == f_bid]
                # Find index of this file within its book
                book_files = [f for f in all_files if f[1].parent.parent.name == f_bid]
                f_pos = next(
                    (pos for pos, f in enumerate(book_files) if f[0] == idx), 0
                )

                if f_pos < len(book_m):
                    cand = book_m[f_pos]
                    if id(cand) not in used_m_ids and (
                        not cand.get("filename") or cand.get("filename") == fname
                    ):
                        match = cand

            # 4. Global positional fallback
            if not match and i < len(all_metadata):
                cand = all_metadata[i]
                if id(cand) not in used_m_ids:
                    match = cand

            if match:
                used_m_ids.add(id(match))

            id_to_data[idx] = (
                p,
                match or {"title": "", "summary": "", "filename": fname},
            )

        # 2. Find target book
        target_book = next(
            (
                b
                for b in story.get("books", [])
                if (b.get("id") == book_id or b.get("folder") == book_id)
            ),
            None,
        )
        if not target_book:
            return JSONResponse(
                status_code=404,
                content={
                    "ok": False,
                    "detail": f"Book with ID '{book_id}' not found. Please use the UUID from the project overview.",
                },
            )

        # Get existing chapter IDs in this book to preserve those not in payload
        existing_ids = [
            idx for idx, (p, m) in id_to_data.items() if p.parent.parent.name == book_id
        ]

        # Final IDs order: requested first, then remaining existing
        final_ids = []
        for cid in chapter_ids:
            if cid in id_to_data:
                final_ids.append(cid)
            else:
                return JSONResponse(
                    status_code=400,
                    content={
                        "ok": False,
                        "detail": f"Chapter ID {cid} not found in project. Available: {list(id_to_data.keys())}",
                    },
                )
        for cid in existing_ids:
            if cid not in final_ids:
                final_ids.append(cid)

        # 3. Handle data structures and moves
        target_dir = active / "books" / book_id / "chapters"
        target_dir.mkdir(parents=True, exist_ok=True)

        triplets = []  # (old_path, metadata)
        for cid in final_ids:
            path, metadata = id_to_data[cid]
            triplets.append((path, metadata))

            # If it's coming from another book, remove it from that book's metadata
            original_bid = metadata.get("_parent_book_id")
            if original_bid and original_bid != book_id:
                orig_book = next(
                    (
                        b
                        for b in story.get("books", [])
                        if (
                            b.get("id") == original_bid
                            or b.get("folder") == original_bid
                        )
                    ),
                    None,
                )
                if orig_book:
                    orig_book["chapters"] = [
                        c
                        for c in orig_book.get("chapters", [])
                        if id(c) != id(metadata.get("_original_object"))
                    ]

        # 4. Perform reordering and renames in target book
        temp_renames = []
        final_renames = []
        new_chapters_metadata = []

        for i, (old_path, metadata) in enumerate(triplets):
            new_filename = f"{i+1:04d}.txt"
            # Extract actual metadata object for cleaner update
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

        # Execute renames
        for old_p, temp_p in temp_renames:
            if old_p.exists():
                old_p.rename(temp_p)
        for temp_p, final_p in final_renames:
            if temp_p.exists():
                if final_p.exists():
                    final_p.unlink()
                temp_p.rename(final_p)

        target_book["chapters"] = new_chapters_metadata

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
        all_ids = [f[0] for f in files]

        # Validate provided IDs
        for cid in chapter_ids:
            if cid not in all_ids:
                return JSONResponse(
                    status_code=400,
                    content={
                        "ok": False,
                        "detail": f"Chapter ID {cid} not found. Available chapter IDs: {all_ids}.",
                    },
                )

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
        from app.config import save_story_config

        save_story_config(story_path, story)
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
    book_map = {(b.get("id") or b.get("folder")): b for b in books}

    # Reorder based on provided IDs
    reordered_books = []
    for book_id in book_ids:
        if book_id in book_map:
            reordered_books.append(book_map[book_id])

    story["books"] = reordered_books

    # Save the updated story
    try:
        from app.config import save_story_config

        save_story_config(story_path, story)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update story.json: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True})
