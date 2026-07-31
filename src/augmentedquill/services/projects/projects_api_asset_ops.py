# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the projects api asset ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import base64
import io
import json
import re
import shutil
import uuid
import zipfile
from pathlib import Path

from fastapi import UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from augmentedquill.core.config import load_story_config
from augmentedquill.models.story import ProjectMutationResponse
from augmentedquill.services.exceptions import (
    BadRequestError,
    NotFoundError,
    PersistenceError,
)
from augmentedquill.services.projects.projects import (
    get_active_project_dir,
    get_projects_root,
    list_projects,
    load_registry,
    select_project,
)
from augmentedquill.services.projects.projects_api_manage_ops import normalize_registry
from augmentedquill.utils.image_helpers import (
    delete_image_metadata,
    get_project_images,
    update_image_metadata,
)
from augmentedquill.utils.path_utils import safe_child_path

_RESTORE_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def _safe_child_path(base_dir: Path, *parts: str) -> Path:
    """Return a safe child path.."""
    base_resolved = base_dir.resolve()
    candidate = base_resolved.joinpath(*parts).resolve()
    if not candidate.is_relative_to(base_resolved):
        raise BadRequestError("Invalid path component")
    return candidate


def _validate_restore_id(restore_id: str) -> str:
    """Validate restore id."""
    if not _RESTORE_ID_PATTERN.fullmatch(restore_id or ""):
        raise BadRequestError("Invalid restore_id")
    return restore_id


def list_images_response() -> JSONResponse:
    """List images response."""
    images = get_project_images()
    return JSONResponse(status_code=200, content={"images": images})


def update_image_description_response(payload: dict) -> JSONResponse:
    """Update Image Description Response."""
    filename = payload.get("filename")
    description = payload.get("description")
    title = payload.get("title")

    if not filename:
        raise BadRequestError("Filename required")

    active = get_active_project_dir()
    if not active:
        raise BadRequestError("No active project")

    update_image_metadata(filename, description=description, title=title)
    return JSONResponse(status_code=200, content={"ok": True})


def create_image_placeholder_response(payload: dict) -> JSONResponse:
    """Create Image Placeholder Response."""
    description = payload.get("description") or ""
    title = payload.get("title") or "Untitled Placeholder"

    active = get_active_project_dir()
    if not active:
        raise BadRequestError("No active project")

    filename = f"placeholder_{uuid.uuid4().hex[:8]}.png"
    update_image_metadata(filename, description=description, title=title)
    return JSONResponse(status_code=200, content={"ok": True, "filename": filename})


def _sanitize_target_name(raw: str) -> str:
    """Helper for target name.."""
    return "".join(c for c in raw if c.isalnum() or c in "._-").strip()


def _get_deleted_images_dir(active: Path) -> Path:
    """Return deleted images dir."""
    deleted_dir = active / ".aq_history" / "deleted_images"
    deleted_dir.mkdir(parents=True, exist_ok=True)
    return deleted_dir


def _capture_image_restore_snapshot(active: Path, filename: str) -> str:
    """Persist an image+metadata snapshot and return its restore id."""
    clean_name = Path(filename).name
    images = get_project_images()
    image_entry = next(
        (item for item in images if item.get("filename") == clean_name), None
    )
    img_path = _safe_child_path(active, "images", clean_name)
    if not img_path.exists():
        return ""

    restore_id = uuid.uuid4().hex
    snapshot_path = _safe_child_path(
        _get_deleted_images_dir(active), f"{restore_id}.json"
    )
    snapshot = {
        "filename": clean_name,
        "content_b64": base64.b64encode(img_path.read_bytes()).decode("ascii"),
        "description": (image_entry or {}).get("description", ""),
        "title": (image_entry or {}).get("title", ""),
    }
    snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")
    return restore_id


async def upload_image_response(
    file: UploadFile, target_name: str | None = None
) -> JSONResponse:
    """Upload Image Response."""
    active = get_active_project_dir()
    if not active:
        raise BadRequestError("No active project")

    images_dir = active / "images"
    images_dir.mkdir(exist_ok=True)

    original_name = Path(file.filename).name

    overwrite_restore_id = ""
    if target_name:
        safe_target = _sanitize_target_name(target_name)
        if safe_target:
            target_path = _safe_child_path(images_dir, safe_target)
        else:
            safe_name = _sanitize_target_name(original_name)
            target_path = _safe_child_path(images_dir, safe_name)

        if target_path.exists():
            overwrite_restore_id = _capture_image_restore_snapshot(
                active, target_path.name
            )
    else:
        safe_name = _sanitize_target_name(original_name)
        if not safe_name:
            safe_name = f"image_{uuid.uuid4().hex[:8]}.png"

        target_path = _safe_child_path(images_dir, safe_name)
        if target_path.exists():
            stem = target_path.stem
            suffix = target_path.suffix
            target_path = _safe_child_path(
                images_dir, f"{stem}_{uuid.uuid4().hex[:6]}{suffix}"
            )

    try:
        content = await file.read()
        target_path.write_bytes(content)
    except Exception as e:
        raise PersistenceError(f"Failed to save image: {e}") from e

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "filename": target_path.name,
            "url": f"/api/v1/projects/images/{target_path.name}",
            "restore_id": overwrite_restore_id,
        },
    )


def delete_image_response(payload: dict) -> JSONResponse:
    """Delete Image Response."""
    filename = payload.get("filename")
    if not filename:
        raise BadRequestError("Filename required")

    active = get_active_project_dir()
    if not active:
        raise BadRequestError("No active project")

    clean_name = Path(filename).name
    img_path = _safe_child_path(active, "images", clean_name)
    restore_id = _capture_image_restore_snapshot(active, clean_name)
    if img_path.exists():
        img_path.unlink()

    delete_image_metadata(clean_name)
    return JSONResponse(status_code=200, content={"ok": True, "restore_id": restore_id})


def restore_image_response(payload: dict) -> JSONResponse:
    """Restore a previously deleted image using its restore_id."""
    restore_id = payload.get("restore_id")
    if not restore_id:
        raise BadRequestError("restore_id required")
    restore_id = _validate_restore_id(restore_id)

    active = get_active_project_dir()
    if not active:
        raise BadRequestError("No active project")

    snapshot_path = _safe_child_path(
        _get_deleted_images_dir(active), f"{restore_id}.json"
    )
    if not snapshot_path.exists():
        raise NotFoundError("Restore snapshot not found")

    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    filename = Path(snapshot.get("filename", "")).name
    if not filename:
        raise PersistenceError("Invalid restore snapshot")

    img_path = _safe_child_path(active, "images", filename)
    img_path.parent.mkdir(parents=True, exist_ok=True)
    img_path.write_bytes(
        base64.b64decode(snapshot.get("content_b64", "").encode("ascii"))
    )

    update_image_metadata(
        filename,
        description=snapshot.get("description", ""),
        title=snapshot.get("title", ""),
    )
    snapshot_path.unlink(missing_ok=True)

    return JSONResponse(status_code=200, content={"ok": True, "filename": filename})


def get_image_file_response(filename: str) -> FileResponse:
    """Get Image File Response."""
    active = get_active_project_dir()
    if not active:
        raise NotFoundError("No active project")

    clean_filename = Path(filename).name
    img_path = active / "images" / clean_filename
    if not img_path.exists():
        raise NotFoundError("Image not found")
    return FileResponse(img_path)


def export_project_response(name: str | None = None) -> Response:
    """Export Project Response."""
    projects_root = get_projects_root()
    if name:
        # Use safe child path to prevent path traversal
        path = _safe_child_path(projects_root, name)
    else:
        path = get_active_project_dir()

    if not path:
        raise BadRequestError("Project not found")

    resolved_root = projects_root.resolve()
    resolved_path = path.resolve()
    if not resolved_path.is_relative_to(resolved_root):
        raise BadRequestError("Project not found")

    if not resolved_path.exists():
        raise BadRequestError("Project not found")

    mem_zip = io.BytesIO()
    with zipfile.ZipFile(mem_zip, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in shutil.os.walk(resolved_path):
            for file in files:
                file_path = Path(root) / file
                archive_name = file_path.relative_to(resolved_path)
                zf.write(file_path, arcname=archive_name)

    mem_zip.seek(0)
    return Response(
        content=mem_zip.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={resolved_path.name}.zip"
        },
    )


async def import_project_response(file: UploadFile) -> ProjectMutationResponse:
    """Import Project Response."""
    if not file.filename.endswith(".zip"):
        raise BadRequestError("File must be a ZIP archive")

    projects_root = get_projects_root()
    temp_dir = projects_root / f"temp_{uuid.uuid4()}"
    temp_dir.mkdir(exist_ok=True)

    try:
        content = await file.read()
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for member in zf.infolist():
                # Prevent Path Traversal (ZipSlip)
                member_path = Path(member.filename)
                if member_path.is_absolute() or ".." in member_path.parts:
                    continue

                try:
                    target_path = safe_child_path(temp_dir, *member_path.parts)
                except ValueError:
                    continue

                if member.is_dir():
                    target_path.mkdir(parents=True, exist_ok=True)
                    continue

                target_path.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as source, target_path.open("wb") as dest:
                    shutil.copyfileobj(source, dest)

        if not (temp_dir / "story.json").exists():
            shutil.rmtree(temp_dir)
            raise BadRequestError("Invalid project: missing story.json")

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

        return ProjectMutationResponse(
            ok=True,
            message=f"Imported as {final_name}",
            registry={
                "current": normalized_reg["current"],
                "recent": normalized_reg["recent"],
                "available": available,
            },  # type: ignore[arg-type]
        )
    except Exception as e:
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        if isinstance(e, (BadRequestError, NotFoundError, PersistenceError)):
            raise
        raise PersistenceError(str(e)) from e
