# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
from pathlib import Path
import shutil
import zipfile
import io
import uuid

from app.projects import (
    load_registry,
    select_project,
    delete_project,
    create_project,
    list_projects,
    get_active_project_dir,
    get_projects_root,
)
from app.config import load_story_config
from app.helpers.image_helpers import (
    update_image_metadata,
    delete_image_metadata,
    get_project_images,
)
from app.helpers.project_helpers import normalize_story_for_frontend

router = APIRouter()


def normalize_registry(reg: dict) -> dict:
    cur = reg.get("current") or ""
    if cur:
        cur = Path(cur).name
    recent = [Path(p).name for p in reg.get("recent", []) if p]
    return {"current": cur, "recent": recent}


@router.get("/api/projects")
async def api_projects() -> dict:
    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    available = list_projects()
    return {
        "current": normalized_reg["current"],
        "recent": normalized_reg["recent"][:5],
        "available": available,
    }


@router.post("/api/projects/delete")
async def api_projects_delete(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    name = (payload or {}).get("name") or ""
    ok, msg = delete_project(name)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})
    # Return updated registry and available list
    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    available = list_projects()
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": msg,
            "registry": normalized_reg,
            "available": available,
        },
    )


@router.post("/api/projects/select")
async def api_projects_select(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    name = (payload or {}).get("name") or ""
    ok, msg = select_project(name)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})
    # On success, return current registry and the story that was loaded/created
    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    active = get_active_project_dir()
    try:
        story = load_story_config((active / "story.json") if active else None)
    except ValueError as e:
        error_msg = str(e)
        if "outdated version" in error_msg:
            # Extract version info
            import re

            match = re.search(r"version (\d+).*Current version is (\d+)", error_msg)
            if match:
                current_version = int(match.group(1))
                required_version = int(match.group(2))
                return JSONResponse(
                    status_code=200,
                    content={
                        "ok": True,
                        "message": msg,
                        "registry": normalized_reg,
                        "story": None,
                        "error": "version_outdated",
                        "current_version": current_version,
                        "required_version": required_version,
                    },
                )
        elif "Invalid story config" in error_msg or "unknown version" in error_msg:
            return JSONResponse(
                status_code=200,
                content={
                    "ok": True,
                    "message": msg,
                    "registry": normalized_reg,
                    "story": None,
                    "error": "invalid_config",
                    "error_message": error_msg,
                },
            )
        else:
            raise  # Re-raise other ValueErrors
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": msg,
            "registry": normalized_reg,
            "story": normalize_story_for_frontend(story),
        },
    )


@router.post("/api/projects/create")
async def api_projects_create(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    name = (payload or {}).get("name") or ""
    project_type = (payload or {}).get("type") or "novel"

    ok, msg = create_project(name, project_type=project_type)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})

    # On success, return registry and loaded story to avoid 400 in frontend
    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None)

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": msg,
            "registry": normalized_reg,
            "story": normalize_story_for_frontend(story),
        },
    )


@router.post("/api/projects/convert")
async def api_projects_convert(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    new_type = (payload or {}).get("new_type")
    if not new_type:
        raise HTTPException(status_code=400, detail="new_type is required")

    from app.projects import change_project_type

    ok, msg = change_project_type(new_type)

    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})

    # Return updated story
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None)
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": msg,
            "story": normalize_story_for_frontend(story),
        },
    )


@router.post("/api/books/create")
async def api_books_create(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    title = (payload or {}).get("title")
    if not title:
        raise HTTPException(status_code=400, detail="Book title is required")

    from app.projects import create_new_book

    try:
        bid = create_new_book(title)

        # Return updated story
        active = get_active_project_dir()
        story = load_story_config((active / "story.json") if active else None)
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "message": "Book created",
                "book_id": bid,
                "story": normalize_story_for_frontend(story),
            },
        )
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "detail": str(e)})


@router.post("/api/books/delete")
async def api_books_delete(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    book_id = (payload or {}).get("book_id")
    if not book_id:
        raise HTTPException(status_code=400, detail="book_id is required")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    books = story.get("books", [])

    exists = any(str(b.get("id")) == str(book_id) for b in books)
    if not exists:
        return JSONResponse(
            status_code=404, content={"ok": False, "detail": "Book not found"}
        )

    new_books = [b for b in books if str(b.get("id")) != str(book_id)]
    story["books"] = new_books

    from app.config import save_story_config

    save_story_config(story_path, story)

    # Also delete directory?
    # Ideally yes.
    book_dir = active / "books" / book_id
    if book_dir.exists():
        shutil.rmtree(book_dir)

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": "Book deleted",
            "story": normalize_story_for_frontend(story),
        },
    )


@router.get("/api/projects/images/list")
async def api_list_images() -> JSONResponse:
    images = get_project_images()
    return JSONResponse(status_code=200, content={"images": images})


@router.post("/api/projects/images/update_description")
async def api_update_image_description(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    filename = payload.get("filename")
    description = payload.get("description")
    title = payload.get("title")

    if not filename:
        raise HTTPException(status_code=400, detail="Filename required")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    update_image_metadata(filename, description=description, title=title)
    return JSONResponse(status_code=200, content={"ok": True})


@router.post("/api/projects/images/create_placeholder")
async def api_create_image_placeholder(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    description = payload.get("description") or ""
    title = payload.get("title") or "Untitled Placeholder"

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    filename = f"placeholder_{uuid.uuid4().hex[:8]}.png"

    update_image_metadata(filename, description=description, title=title)

    return JSONResponse(status_code=200, content={"ok": True, "filename": filename})


@router.post("/api/projects/images/upload")
async def api_upload_image(
    file: UploadFile = File(...), target_name: str | None = None
) -> JSONResponse:
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    images_dir = active / "images"
    images_dir.mkdir(exist_ok=True)

    original_name = Path(file.filename).name

    if target_name:
        # Secure target name
        safe_target = "".join(
            c for c in target_name if c.isalnum() or c in "._-"
        ).strip()
        if safe_target:
            target_path = images_dir / safe_target
        else:
            # Fallback if provided name is bad
            safe_name = "".join(
                c for c in original_name if c.isalnum() or c in "._-"
            ).strip()
            target_path = images_dir / safe_name
    else:
        safe_name = "".join(
            c for c in original_name if c.isalnum() or c in "._-"
        ).strip()
        if not safe_name:
            safe_name = f"image_{uuid.uuid4().hex[:8]}.png"

        target_path = images_dir / safe_name
        if target_path.exists():
            stem = target_path.stem
            suffix = target_path.suffix
            target_path = images_dir / f"{stem}_{uuid.uuid4().hex[:6]}{suffix}"

    try:
        content = await file.read()
        target_path.write_bytes(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save image: {e}")

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "filename": target_path.name,
            "url": f"/api/projects/images/{target_path.name}",
        },
    )


@router.post("/api/projects/images/delete")
async def api_delete_image(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    filename = payload.get("filename")
    if not filename:
        raise HTTPException(status_code=400, detail="Filename required")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    img_path = active / "images" / Path(filename).name
    if img_path.exists():
        img_path.unlink()

    # Remove from metadata if exists
    clean_filename = Path(filename).name
    delete_image_metadata(clean_filename)

    return JSONResponse(status_code=200, content={"ok": True})


@router.get("/api/projects/images/{filename}")
async def api_projects_get_image(filename: str):
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=404, detail="No active project")

    # Sanitize filename
    filename = Path(filename).name
    img_path = active / "images" / filename
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(img_path)


@router.get("/api/projects/export")
async def api_projects_export(name: str = None):
    path = None
    if name:
        path = get_projects_root() / name
    else:
        path = get_active_project_dir()

    if not path or not path.exists():
        raise HTTPException(status_code=400, detail="Project not found")

    # Create a zip in memory
    mem_zip = io.BytesIO()

    with zipfile.ZipFile(mem_zip, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Walk the directory
        for root, dirs, files in shutil.os.walk(path):
            for file in files:
                file_path = Path(root) / file
                archive_name = file_path.relative_to(path)
                zf.write(file_path, arcname=archive_name)

    from fastapi.responses import Response

    mem_zip.seek(0)
    return Response(
        content=mem_zip.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={path.name}.zip"},
    )


@router.post("/api/projects/import")
async def api_projects_import(file: UploadFile = File(...)):
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="File must be a ZIP archive")

    projects_root = get_projects_root()

    # Extract to temp to check validity
    temp_id = str(uuid.uuid4())
    temp_dir = projects_root / f"temp_{temp_id}"
    temp_dir.mkdir(exist_ok=True)

    try:
        content = await file.read()
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            zf.extractall(temp_dir)

        # Check if it has story.json
        if not (temp_dir / "story.json").exists():
            shutil.rmtree(temp_dir)
            raise HTTPException(
                status_code=400, detail="Invalid project: missing story.json"
            )

        story = load_story_config(temp_dir / "story.json") or {}
        proposed_name = story.get("project_title") or "imported_project"

        # Sanitize name
        proposed_name = "".join(
            x for x in proposed_name if x.isalnum() or x in " -_"
        ).strip()
        if not proposed_name:
            proposed_name = "imported_project"

        # Handle name clash
        final_name = proposed_name
        counter = 1
        while (projects_root / final_name).exists():
            final_name = f"{proposed_name}_{counter}"
            counter += 1

        # Rename temp dir to final name
        final_path = projects_root / final_name
        temp_dir.rename(final_path)

        select_project(final_name)

        reg = load_registry()
        normalized_reg = normalize_registry(reg)
        available = list_projects()

        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "message": f"Imported as {final_name}",
                "registry": normalized_reg,
                "available": available,
            },
        )

    except Exception as e:
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        raise HTTPException(status_code=500, detail=str(e))
