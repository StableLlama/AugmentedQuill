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
    # Note: This assumes 1-to-1 mapping between file scan order and metadata order.
    # scan_chapters_files for Series iterates books then files.
    # Metadata iteration above iterates books then chapters.
    # If a file exists but metadata is missing, we pad.
    # If metadata exists but file is missing, scan skips file, so we might lose sync if we just zip.
    # Ideally we should match by filename if possible.
    # But files return (id, path). Path has filename.
    # Metadata for Series currently stores filename? create_new_chapter adds "filename".

    for i, (idx, p) in enumerate(files):
        # Try to find metadata by filename matching if possible
        fname = p.name
        match_data = None

        # Simple heuristic: try index first, checking if filename matches
        if i < len(chapters_data):
            candidate = chapters_data[i]
            # If candidate has filename and it matches
            if candidate.get("filename") == fname:
                match_data = candidate
            elif not candidate.get("filename"):
                # If metadata has no filename (legacy or manual edit), assume index match
                match_data = candidate

        # If strict index match failed or wasn't trusted, search?
        # Searching is safer but O(N^2). N is small.
        if not match_data:
            match_data = next(
                (c for c in chapters_data if c.get("filename") == fname), None
            )

        # Fallback to index if still no match and valid index
        if not match_data and i < len(chapters_data):
            match_data = chapters_data[i]

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
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]

    chap_entry = (
        chapters_data[pos] if pos < len(chapters_data) else {"title": "", "summary": ""}
    )

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
    """Update the title of a chapter in the active project's story.json.
    The title positions correspond to the sorted chapter files list.
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
    chapters_data = story.get("chapters") or []

    # Ensure chapters_data is a list of dicts, and pad if necessary
    count = len(files)
    chapters_data = [_normalize_chapter_entry(c) for c in chapters_data]
    if len(chapters_data) < count:
        chapters_data.extend(
            [{"title": "", "summary": ""}] * (count - len(chapters_data))
        )

    # Update title at position
    if pos < len(chapters_data):
        chapters_data[pos]["title"] = new_title_str
    else:
        # This case should ideally not happen if padding is correct
        chapters_data.append({"title": new_title_str, "summary": ""})

    story["chapters"] = chapters_data
    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to write story.json: {e}"},
        )

    # Respond with updated descriptor
    # Get the summary for response
    summary_for_response = chapters_data[pos].get("summary") or ""
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "chapter": {
                "id": files[pos][0],
                "title": new_title_str or path.name,
                "filename": path.name,
                "summary": summary_for_response,
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
    chapters_data = story.get("chapters") or []
    chapters_data = [_normalize_chapter_entry(c) for c in chapters_data]

    # Ensure alignment with number of files
    count = len(files)
    if len(chapters_data) < count:
        chapters_data.extend(
            [{"title": "", "summary": ""}] * (count - len(chapters_data))
        )

    # Update summary at position
    if pos < len(chapters_data):
        chapters_data[pos]["summary"] = new_summary
    else:
        chapters_data.append({"title": "", "summary": new_summary})

    story["chapters"] = chapters_data
    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to write story.json: {e}"},
        )

    title_for_response = chapters_data[pos].get("title") or path.name
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "chapter": {
                "id": files[pos][0],
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

    # Update story.json: remove the entry at position
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = story.get("chapters") or []
    chapters_data = [_normalize_chapter_entry(c) for c in chapters_data]

    # Ensure alignment with number of files (before deletion)
    count = len(files)
    if len(chapters_data) < count:
        chapters_data.extend(
            [{"title": "", "summary": ""}] * (count - len(chapters_data))
        )

    # Remove the entry at position
    if pos < len(chapters_data):
        chapters_data.pop(pos)

    story["chapters"] = chapters_data
    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update story.json: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True})
