# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the read unit so this responsibility stays isolated, testable, and easy to evolve.

from fastapi import APIRouter, HTTPException, Path as FastAPIPath

from app.services.chapters.chapter_helpers import _chapter_by_id_or_404
from app.services.chapters.chapters_api_ops import (
    chapter_detail_payload,
    list_chapters_payload,
)
from app.services.projects.projects import get_active_project_dir

router = APIRouter(tags=["Chapters"])


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
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to read chapter: {exc}"
        ) from exc

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
