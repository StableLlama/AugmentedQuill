# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

from fastapi import APIRouter, Request, HTTPException, Path as FastAPIPath
from fastapi.responses import JSONResponse

from app.projects import get_active_project_dir
from app.helpers.chapter_helpers import (
    _chapter_by_id_or_404,
)
from app.helpers.chapters_api_ops import (
    list_chapters_payload,
    chapter_detail_payload,
    reorder_chapters_in_project,
    reorder_books_in_project,
)

router = APIRouter()


@router.get("/api/chapters")
async def api_chapters() -> dict:
    active = get_active_project_dir()
    return {"chapters": list_chapters_payload(active)}


@router.get("/api/chapters/{chap_id}")
async def api_chapter_content(chap_id: int = FastAPIPath(..., ge=0)) -> dict:
    _, path, _ = _chapter_by_id_or_404(chap_id)
    active = get_active_project_dir()
    chapter = chapter_detail_payload(active, chap_id, path)

    try:
        content = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")
    return {
        "id": chap_id,
        "title": chapter["title"],
        "filename": path.name,
        "content": content,
        "summary": chapter["summary"],
        "notes": chapter["notes"],
        "private_notes": chapter["private_notes"],
        "conflicts": chapter["conflicts"],
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

    try:
        reorder_chapters_in_project(active, payload)
    except LookupError as e:
        return JSONResponse(status_code=404, content={"ok": False, "detail": str(e)})
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "detail": str(e)})
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

    try:
        reorder_books_in_project(active, payload)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "detail": str(e)})
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update story.json: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True})
