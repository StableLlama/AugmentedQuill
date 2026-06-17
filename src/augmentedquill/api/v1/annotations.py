# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""REST endpoints for annotation management.

All routes are scoped under ``/projects/{project_name}/annotations``.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.services.annotations.annotation_service import (
    create_annotation,
    delete_annotation,
    get_annotation,
    list_annotations,
    list_annotations_for_scope,
    update_annotation,
)

router = APIRouter(prefix="/projects/{project_name}", tags=["Annotations"])


# ─── Request / response models ───────────────────────────────────────────────


class AnnotationResponse(BaseModel):
    """A single annotation with runtime offsets attached."""

    id: str
    comment: str
    scope_type: str
    chapter_id: Optional[str] = None
    book_id: Optional[str] = None
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None


class CreateAnnotationRequest(BaseModel):
    """Payload for creating a new annotation."""

    scope_type: str = Field(..., description="'story', 'chapter', or 'unlinked'")
    chapter_id: Optional[str] = Field(None, description="Chapter ID for chapter scope")
    book_id: Optional[str] = Field(None, description="Book ID for nested chapter scope")
    start_offset: int = Field(
        ..., description="Raw character offset (markers included)"
    )
    end_offset: int = Field(..., description="Raw character offset (markers included)")
    comment: str = Field(..., description="Human-readable annotation comment")


class UpdateAnnotationRequest(BaseModel):
    """Payload for updating an annotation's comment."""

    comment: str


# ─── Routes ──────────────────────────────────────────────────────────────────


@router.get("/annotations", response_model=List[AnnotationResponse])
async def api_list_annotations(project_dir: ProjectDep) -> List[AnnotationResponse]:
    """List all annotations for the project."""
    return [AnnotationResponse(**a) for a in list_annotations(project_dir)]


@router.get("/annotations/scope", response_model=List[AnnotationResponse])
async def api_list_annotations_for_scope(
    project_dir: ProjectDep,
    scope_type: str = "story",
    chapter_id: Optional[str] = None,
    book_id: Optional[str] = None,
) -> List[AnnotationResponse]:
    """List annotations for a specific prose scope."""
    return [
        AnnotationResponse(**a)
        for a in list_annotations_for_scope(
            project_dir, scope_type, chapter_id, book_id
        )
    ]


@router.post("/annotations", response_model=AnnotationResponse, status_code=201)
async def api_create_annotation(
    project_dir: ProjectDep,
    payload: CreateAnnotationRequest,
) -> AnnotationResponse:
    """Create a new inline annotation."""
    try:
        result = create_annotation(
            project_dir,
            scope_type=payload.scope_type,
            chapter_id=payload.chapter_id,
            book_id=payload.book_id,
            start_offset=payload.start_offset,
            end_offset=payload.end_offset,
            comment=payload.comment,
        )
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return AnnotationResponse(**result)


@router.get("/annotations/{annotation_id}", response_model=AnnotationResponse)
async def api_get_annotation(
    project_dir: ProjectDep,
    annotation_id: str,
) -> AnnotationResponse:
    """Fetch a single annotation by ID."""
    ann = get_annotation(project_dir, annotation_id)
    if ann is None:
        raise HTTPException(
            status_code=404, detail=f"Annotation '{annotation_id}' not found"
        )
    return AnnotationResponse(**ann)


@router.put("/annotations/{annotation_id}", response_model=AnnotationResponse)
async def api_update_annotation(
    project_dir: ProjectDep,
    annotation_id: str,
    payload: UpdateAnnotationRequest,
) -> AnnotationResponse:
    """Update an annotation's comment."""
    ann = update_annotation(project_dir, annotation_id, comment=payload.comment)
    if ann is None:
        raise HTTPException(
            status_code=404, detail=f"Annotation '{annotation_id}' not found"
        )
    return AnnotationResponse(**ann)


@router.delete("/annotations/{annotation_id}", status_code=204)
async def api_delete_annotation(
    project_dir: ProjectDep,
    annotation_id: str,
) -> None:
    """Delete an annotation and remove its inline markers."""
    if not delete_annotation(project_dir, annotation_id):
        raise HTTPException(
            status_code=404, detail=f"Annotation '{annotation_id}' not found"
        )
