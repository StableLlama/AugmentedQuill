# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the metadata unit so this responsibility stays isolated, testable, and easy to evolve."""

from typing import Any

from fastapi import APIRouter, Request
from fastapi import Path as FastAPIPath
from fastapi.responses import JSONResponse

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.api.v1.story_routes.common import (
    StoryBadRequestError,
    map_story_exception,
    parse_json_body,
)
from augmentedquill.core.config import save_story_config
from augmentedquill.models.story import StoryContentResponse
from augmentedquill.services.exceptions import ServiceError
from augmentedquill.services.projects.project_helpers import (
    normalize_story_for_frontend,
)
from augmentedquill.services.projects.projects import (
    read_story_content,
    update_book_metadata,
    update_story_metadata,
    write_story_content,
)
from augmentedquill.services.story.story_api_state_ops import (
    get_active_story_or_raise,
)

router = APIRouter(prefix="/projects/{project_name}", tags=["Story"])


def _require_active_story_context(project_dir: ProjectDep) -> tuple[str, object, dict]:
    """Return active project context or raise a uniform bad-request error."""
    try:
        return get_active_story_or_raise(project_dir)
    except ServiceError:
        raise StoryBadRequestError("No active project")


async def _dispatch_metadata_request(request: Request, handler: Any) -> JSONResponse:
    """Parse body, execute handler, and map story exceptions."""
    try:
        payload = await parse_json_body(request)
        return await handler(payload)
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/story/title")
async def api_story_title(request: Request, project_dir: ProjectDep) -> JSONResponse:
    """Api Story Title."""

    async def _handler(payload: dict) -> JSONResponse:
        """Helper for the requested value.."""
        title = str(payload.get("title", "")).strip()
        if not title:
            raise StoryBadRequestError("Title cannot be empty")

        _, story_path, story = _require_active_story_context(project_dir)

        story["project_title"] = title
        save_story_config(story_path, story)
        return JSONResponse(content={"ok": True})

    return await _dispatch_metadata_request(request, _handler)


@router.post("/story/settings")
async def api_story_settings(request: Request, project_dir: ProjectDep) -> JSONResponse:
    """Api Story Settings."""

    async def _handler(payload: dict) -> JSONResponse:
        """Helper for the requested value.."""
        _, story_path, story = _require_active_story_context(project_dir)

        if "image_style" in payload:
            story["image_style"] = str(payload["image_style"])
        if "image_additional_info" in payload:
            story["image_additional_info"] = str(payload["image_additional_info"])

        save_story_config(story_path, story)

        return JSONResponse(
            status_code=200,
            content={"ok": True, "story": normalize_story_for_frontend(story)},
        )

    return await _dispatch_metadata_request(request, _handler)


@router.post("/story/metadata")
async def api_story_metadata(request: Request, project_dir: ProjectDep) -> JSONResponse:
    """Api Story Metadata."""

    async def _handler(payload: dict) -> JSONResponse:
        """Helper for the requested value.."""
        _require_active_story_context(project_dir)

        title = payload.get("title")
        summary = payload.get("summary")
        tags = payload.get("tags")
        notes = payload.get("notes")
        private_notes = payload.get("private_notes")
        conflicts = payload.get("conflicts")
        language = payload.get("language")

        try:
            update_story_metadata(
                title=title,
                summary=summary,
                tags=tags,
                notes=notes,
                private_notes=private_notes,
                conflicts=conflicts,
                language=language,
                active=project_dir,
            )
        except ValueError as exc:
            return JSONResponse(
                status_code=400, content={"ok": False, "detail": str(exc)}
            )
        return JSONResponse(content={"ok": True})

    return await _dispatch_metadata_request(request, _handler)


@router.get("/story/content", response_model=StoryContentResponse)
async def api_story_content(project_dir: ProjectDep) -> StoryContentResponse:
    """Api Story Content."""
    try:
        _require_active_story_context(project_dir)
        return StoryContentResponse(ok=True, content=read_story_content(project_dir))
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/story/content")
async def api_story_content_update(
    request: Request, project_dir: ProjectDep
) -> JSONResponse:
    """Api Story Content Update."""

    async def _handler(payload: dict) -> JSONResponse:
        """Helper for the requested value.."""
        _require_active_story_context(project_dir)

        content = payload.get("content")
        if not isinstance(content, str):
            raise StoryBadRequestError("content must be a string")

        write_story_content(content, active=project_dir)
        return JSONResponse(content={"ok": True})

    return await _dispatch_metadata_request(request, _handler)


@router.post("/books/{book_id}/metadata")
async def api_book_metadata(
    request: Request,
    project_dir: ProjectDep,
    book_id: str = FastAPIPath(...),
) -> JSONResponse:
    """Api Book Metadata."""

    async def _handler(payload: dict) -> JSONResponse:
        """Helper for the requested value.."""
        _require_active_story_context(project_dir)

        title = payload.get("title")
        summary = payload.get("summary")
        notes = payload.get("notes")
        private_notes = payload.get("private_notes")

        try:
            update_book_metadata(
                book_id,
                title=title,
                summary=summary,
                notes=notes,
                private_notes=private_notes,
                active=project_dir,
            )
        except ValueError as exc:
            return JSONResponse(
                status_code=404, content={"ok": False, "detail": str(exc)}
            )

        return JSONResponse(content={"ok": True})

    return await _dispatch_metadata_request(request, _handler)
