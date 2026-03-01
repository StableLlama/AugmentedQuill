# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the mutate unit so this responsibility stays isolated, testable, and easy to evolve."""

from fastapi import APIRouter, Path as FastAPIPath
from fastapi.responses import JSONResponse

from augmentedquill.api.v1.http_responses import error_json
from augmentedquill.models.chapters import (
    BooksReorderRequest,
    ChapterContentUpdate,
    ChapterCreate,
    ChapterMetadataUpdate,
    ChapterSummaryUpdate,
    ChapterTitleUpdate,
    ChaptersReorderRequest,
)
from augmentedquill.services.chapters.chapter_helpers import _chapter_by_id_or_404
from augmentedquill.services.chapters.chapters_api_ops import (
    reorder_books_in_project,
    reorder_chapters_in_project,
)
from augmentedquill.services.projects.projects import (
    create_new_chapter,
    delete_chapter,
    get_active_project_dir,
    update_chapter_metadata,
    write_chapter_title,
)

router = APIRouter(tags=["Chapters"])


@router.put("/chapters/{chap_id}/metadata")
async def api_update_chapter_metadata(
    body: ChapterMetadataUpdate, chap_id: int = FastAPIPath(..., ge=0)
):
    """Api Update Chapter Metadata."""
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    try:
        update_chapter_metadata(
            chap_id,
            title=body.title.strip() if body.title is not None else None,
            summary=body.summary.strip() if body.summary is not None else None,
            notes=body.notes,
            private_notes=body.private_notes,
            conflicts=body.conflicts,
        )
    except ValueError as exc:
        return error_json(str(exc), status_code=404)

    return JSONResponse(
        content={"ok": True, "id": chap_id, "message": "Metadata updated"}
    )


@router.put("/chapters/{chap_id}/title")
async def api_update_chapter_title(
    body: ChapterTitleUpdate, chap_id: int = FastAPIPath(..., ge=0)
):
    """Api Update Chapter Title."""
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    new_title_str = body.title.strip()
    if new_title_str.lower() == "[object object]":
        new_title_str = ""

    try:
        write_chapter_title(chap_id, new_title_str)
    except ValueError as exc:
        return error_json(str(exc), status_code=404)

    _, path, _ = _chapter_by_id_or_404(chap_id)
    return JSONResponse(
        content={
            "ok": True,
            "chapter": {
                "id": chap_id,
                "title": new_title_str or path.name,
                "filename": path.name,
            },
        }
    )


@router.post("/chapters")
async def api_create_chapter(body: ChapterCreate):
    """Api Create Chapter."""
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    title = body.title.strip()

    try:
        chap_id = create_new_chapter(title, book_id=body.book_id)
        if body.content:
            from augmentedquill.services.projects.projects import write_chapter_content

            write_chapter_content(chap_id, body.content)
    except ValueError as exc:
        return error_json(str(exc), status_code=400)
    except Exception as exc:
        return error_json(f"Failed to create chapter: {exc}", status_code=500)

    return JSONResponse(
        content={
            "ok": True,
            "id": chap_id,
            "title": title,
            "book_id": body.book_id,
            "summary": "",
            "message": "Chapter created",
        }
    )


@router.put("/chapters/{chap_id}/content")
async def api_update_chapter_content(
    body: ChapterContentUpdate, chap_id: int = FastAPIPath(..., ge=0)
):
    """Api Update Chapter Content."""
    _, path, _ = _chapter_by_id_or_404(chap_id)

    try:
        path.write_text(body.content, encoding="utf-8")
    except Exception as exc:
        return error_json(f"Failed to write chapter: {exc}", status_code=500)

    return JSONResponse(content={"ok": True})


@router.put("/chapters/{chap_id}/summary")
async def api_update_chapter_summary(
    body: ChapterSummaryUpdate, chap_id: int = FastAPIPath(..., ge=0)
):
    """Api Update Chapter Summary."""
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    try:
        from augmentedquill.services.projects.projects import write_chapter_summary

        write_chapter_summary(chap_id, body.summary.strip())
    except ValueError as exc:
        return error_json(str(exc), status_code=404)

    _, path, _ = _chapter_by_id_or_404(chap_id)
    return JSONResponse(
        content={
            "ok": True,
            "chapter": {
                "id": chap_id,
                "filename": path.name,
                "summary": body.summary.strip(),
            },
        }
    )


@router.delete("/chapters/{chap_id}")
async def api_delete_chapter(chap_id: int = FastAPIPath(..., ge=0)):
    """Api Delete Chapter."""
    try:
        delete_chapter(chap_id)
        return JSONResponse(content={"ok": True})
    except ValueError as exc:
        return error_json(str(exc), status_code=404)
    except Exception as exc:
        return error_json(f"Failed to delete chapter: {exc}", status_code=500)


@router.post("/chapters/reorder")
async def api_reorder_chapters(body: ChaptersReorderRequest):
    """Api Reorder Chapters."""
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    try:
        reorder_chapters_in_project(active, body.model_dump())
    except LookupError as exc:
        return error_json(str(exc), status_code=404)
    except ValueError as exc:
        import logging

        logging.error(f"Reorder Error: {exc}")
        return error_json(str(exc), status_code=400)
    except Exception as exc:
        return error_json(f"Failed to update story.json: {exc}", status_code=500)

    return JSONResponse(content={"ok": True})


@router.post("/books/reorder")
async def api_reorder_books(body: BooksReorderRequest):
    """Api Reorder Books."""
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    try:
        reorder_books_in_project(active, body.model_dump())
    except ValueError as exc:
        return error_json(str(exc), status_code=400)
    except Exception as exc:
        return error_json(f"Failed to update story.json: {exc}", status_code=500)

    return JSONResponse(content={"ok": True})
