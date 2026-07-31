# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the read unit so this responsibility stays isolated, testable, and easy to evolve."""

from fastapi import APIRouter, HTTPException
from fastapi import Path as FastAPIPath

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.models.chapters import ChapterDetailResponse, ChaptersListResponse
from augmentedquill.services.chapters.chapter_helpers import _chapter_by_id_or_404
from augmentedquill.services.chapters.chapters_api_ops import (
    chapter_detail_payload,
    list_chapters_payload,
)

router = APIRouter(prefix="/projects/{project_name}", tags=["Chapters"])


@router.get("/chapters", response_model=ChaptersListResponse)
async def api_chapters(project_dir: ProjectDep) -> ChaptersListResponse:
    """Handle the API request to chapters."""
    return {"chapters": list_chapters_payload(project_dir)}


@router.get("/chapters/{chap_id}", response_model=ChapterDetailResponse)
async def api_chapter_content(
    project_dir: ProjectDep,
    chap_id: int = FastAPIPath(..., ge=0),
) -> ChapterDetailResponse:
    """Api Chapter Content."""
    _, path, _ = _chapter_by_id_or_404(chap_id, active=project_dir)
    chapter = chapter_detail_payload(project_dir, chap_id, path)

    try:
        content = path.read_text(encoding="utf-8")
    except OSError as exc:
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
