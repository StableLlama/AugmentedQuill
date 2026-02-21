from fastapi import APIRouter, Path as FastAPIPath, Request

from app.api.chapters_routes.common import parse_json_body
from app.api.http_responses import error_json, ok_json
from app.services.chapters.chapter_helpers import _chapter_by_id_or_404
from app.services.chapters.chapters_api_ops import (
    reorder_books_in_project,
    reorder_chapters_in_project,
)
from app.services.projects.projects import get_active_project_dir

router = APIRouter(tags=["Chapters"])


@router.put("/api/chapters/{chap_id}/metadata")
async def api_update_chapter_metadata(
    request: Request, chap_id: int = FastAPIPath(..., ge=0)
):
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    payload = await parse_json_body(request)

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
    if conflicts is not None and not isinstance(conflicts, list):
        return error_json("conflicts must be a list", status_code=400)

    from app.services.projects.projects import update_chapter_metadata

    try:
        update_chapter_metadata(
            chap_id,
            title=title,
            summary=summary,
            notes=notes,
            private_notes=private_notes,
            conflicts=conflicts,
        )
    except ValueError as exc:
        return error_json(str(exc), status_code=404)

    return ok_json({"ok": True, "id": chap_id, "message": "Metadata updated"})


@router.put("/api/chapters/{chap_id}/title")
async def api_update_chapter_title(
    request: Request, chap_id: int = FastAPIPath(..., ge=0)
):
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    payload = await parse_json_body(request)
    new_title = payload.get("title")
    if new_title is None:
        return error_json("title is required", status_code=400)

    new_title_str = str(new_title).strip()
    if new_title_str.lower() == "[object object]":
        new_title_str = ""

    from app.services.projects.projects import write_chapter_title

    try:
        write_chapter_title(chap_id, new_title_str)
    except ValueError as exc:
        return error_json(str(exc), status_code=404)

    _, path, _ = _chapter_by_id_or_404(chap_id)
    return ok_json(
        {
            "ok": True,
            "chapter": {
                "id": chap_id,
                "title": new_title_str or path.name,
                "filename": path.name,
            },
        }
    )


@router.post("/api/chapters")
async def api_create_chapter(request: Request):
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    payload = await parse_json_body(request)
    title = str(payload.get("title", "")).strip()
    content = payload.get("content") or ""
    book_id = payload.get("book_id")

    from app.services.projects.projects import create_new_chapter, write_chapter_content

    try:
        chap_id = create_new_chapter(title, book_id=book_id)
        if content:
            write_chapter_content(chap_id, str(content))
    except ValueError as exc:
        return error_json(str(exc), status_code=400)
    except Exception as exc:
        return error_json(f"Failed to create chapter: {exc}", status_code=500)

    return ok_json(
        {
            "ok": True,
            "id": chap_id,
            "title": title,
            "book_id": book_id,
            "summary": "",
            "message": "Chapter created",
        }
    )


@router.put("/api/chapters/{chap_id}/content")
async def api_update_chapter_content(
    request: Request, chap_id: int = FastAPIPath(..., ge=0)
):
    payload = await parse_json_body(request)
    if "content" not in payload:
        return error_json("content is required", status_code=400)

    new_content = str(payload.get("content", ""))
    _, path, _ = _chapter_by_id_or_404(chap_id)

    try:
        path.write_text(new_content, encoding="utf-8")
    except Exception as exc:
        return error_json(f"Failed to write chapter: {exc}", status_code=500)

    return ok_json({"ok": True})


@router.put("/api/chapters/{chap_id}/summary")
async def api_update_chapter_summary(
    request: Request, chap_id: int = FastAPIPath(..., ge=0)
):
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    payload = await parse_json_body(request)
    if "summary" not in payload:
        return error_json("summary is required", status_code=400)

    new_summary = str(payload.get("summary", "")).strip()

    from app.services.projects.projects import write_chapter_summary

    try:
        write_chapter_summary(chap_id, new_summary)
    except ValueError as exc:
        return error_json(str(exc), status_code=404)

    _, path, _ = _chapter_by_id_or_404(chap_id)
    return ok_json(
        {
            "ok": True,
            "chapter": {
                "id": chap_id,
                "filename": path.name,
                "summary": new_summary,
            },
        }
    )


@router.delete("/api/chapters/{chap_id}")
async def api_delete_chapter(chap_id: int = FastAPIPath(..., ge=0)):
    from app.services.projects.projects import delete_chapter

    try:
        delete_chapter(chap_id)
        return ok_json({"ok": True})
    except ValueError as exc:
        return error_json(str(exc), status_code=404)
    except Exception as exc:
        return error_json(f"Failed to delete chapter: {exc}", status_code=500)


@router.post("/api/chapters/reorder")
async def api_reorder_chapters(request: Request):
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    payload = await parse_json_body(request)
    try:
        reorder_chapters_in_project(active, payload)
    except LookupError as exc:
        return error_json(str(exc), status_code=404)
    except ValueError as exc:
        return error_json(str(exc), status_code=400)
    except Exception as exc:
        return error_json(f"Failed to update story.json: {exc}", status_code=500)

    return ok_json({"ok": True})


@router.post("/api/books/reorder")
async def api_reorder_books(request: Request):
    active = get_active_project_dir()
    if not active:
        return error_json("No active project", status_code=400)

    payload = await parse_json_body(request)
    try:
        reorder_books_in_project(active, payload)
    except ValueError as exc:
        return error_json(str(exc), status_code=400)
    except Exception as exc:
        return error_json(f"Failed to update story.json: {exc}", status_code=500)

    return ok_json({"ok": True})
