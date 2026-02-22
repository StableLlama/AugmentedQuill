# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the projects api asset ops unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

import io
import shutil
import uuid
import zipfile
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from augmentedquill.core.config import load_story_config
from augmentedquill.utils.image_helpers import (
    delete_image_metadata,
    get_project_images,
    update_image_metadata,
)
from augmentedquill.services.projects.projects import (
    get_active_project_dir,
    get_projects_root,
    list_projects,
    load_registry,
    select_project,
)
from augmentedquill.services.projects.projects_api_manage_ops import normalize_registry


def list_images_response() -> JSONResponse:
    images = get_project_images()
    return JSONResponse(status_code=200, content={"images": images})


def update_image_description_response(payload: dict) -> JSONResponse:
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


def create_image_placeholder_response(payload: dict) -> JSONResponse:
    description = payload.get("description") or ""
    title = payload.get("title") or "Untitled Placeholder"

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    filename = f"placeholder_{uuid.uuid4().hex[:8]}.png"
    update_image_metadata(filename, description=description, title=title)
    return JSONResponse(status_code=200, content={"ok": True, "filename": filename})


def _sanitize_target_name(raw: str) -> str:
    return "".join(c for c in raw if c.isalnum() or c in "._-").strip()


async def upload_image_response(
    file: UploadFile, target_name: str | None = None
) -> JSONResponse:
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    images_dir = active / "images"
    images_dir.mkdir(exist_ok=True)

    original_name = Path(file.filename).name

    if target_name:
        safe_target = _sanitize_target_name(target_name)
        if safe_target:
            target_path = images_dir / safe_target
        else:
            safe_name = _sanitize_target_name(original_name)
            target_path = images_dir / safe_name
    else:
        safe_name = _sanitize_target_name(original_name)
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
            "url": f"/api/v1/projects/images/{target_path.name}",
        },
    )


def delete_image_response(payload: dict) -> JSONResponse:
    filename = payload.get("filename")
    if not filename:
        raise HTTPException(status_code=400, detail="Filename required")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    img_path = active / "images" / Path(filename).name
    if img_path.exists():
        img_path.unlink()

    delete_image_metadata(Path(filename).name)
    return JSONResponse(status_code=200, content={"ok": True})


def get_image_file_response(filename: str) -> FileResponse:
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=404, detail="No active project")

    clean_filename = Path(filename).name
    img_path = active / "images" / clean_filename
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(img_path)


def export_project_response(name: str | None = None) -> Response:
    if name:
        path = get_projects_root() / name
    else:
        path = get_active_project_dir()

    if not path or not path.exists():
        raise HTTPException(status_code=400, detail="Project not found")

    mem_zip = io.BytesIO()
    with zipfile.ZipFile(mem_zip, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in shutil.os.walk(path):
            for file in files:
                file_path = Path(root) / file
                archive_name = file_path.relative_to(path)
                zf.write(file_path, arcname=archive_name)

    mem_zip.seek(0)
    return Response(
        content=mem_zip.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={path.name}.zip"},
    )


async def import_project_response(file: UploadFile) -> JSONResponse:
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="File must be a ZIP archive")

    projects_root = get_projects_root()
    temp_dir = projects_root / f"temp_{uuid.uuid4()}"
    temp_dir.mkdir(exist_ok=True)

    try:
        content = await file.read()
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            zf.extractall(temp_dir)

        if not (temp_dir / "story.json").exists():
            shutil.rmtree(temp_dir)
            raise HTTPException(
                status_code=400, detail="Invalid project: missing story.json"
            )

        story = load_story_config(temp_dir / "story.json") or {}
        proposed_name = story.get("project_title") or "imported_project"
        proposed_name = "".join(
            x for x in proposed_name if x.isalnum() or x in " -_"
        ).strip()
        if not proposed_name:
            proposed_name = "imported_project"

        final_name = proposed_name
        counter = 1
        while (projects_root / final_name).exists():
            final_name = f"{proposed_name}_{counter}"
            counter += 1

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
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=str(e))
