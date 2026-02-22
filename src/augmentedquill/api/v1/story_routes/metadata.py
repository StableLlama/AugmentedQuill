# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the metadata unit so this responsibility stays isolated, testable, and easy to evolve.

from fastapi import APIRouter, Request, HTTPException, Path as FastAPIPath
from fastapi.responses import JSONResponse

from augmentedquill.core.config import save_story_config
from augmentedquill.services.projects.project_helpers import (
    normalize_story_for_frontend,
)
from augmentedquill.services.story.story_api_state_ops import (
    get_active_story_or_http_error,
)
from augmentedquill.api.v1.story_routes.common import (
    parse_json_body,
    map_story_exception,
    StoryBadRequestError,
)

router = APIRouter(tags=["Story"])


@router.post("/story/title")
async def api_story_title(request: Request) -> JSONResponse:
    try:
        payload = await parse_json_body(request)
        title = str(payload.get("title", "")).strip()
        if not title:
            raise StoryBadRequestError("Title cannot be empty")

        try:
            _, story_path, story = get_active_story_or_http_error()
        except HTTPException:
            raise StoryBadRequestError("No active project")

        story["project_title"] = title
        save_story_config(story_path, story)
        return JSONResponse(content={"ok": True})
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/story/settings")
async def api_story_settings(request: Request) -> JSONResponse:
    try:
        payload = await parse_json_body(request)

        try:
            _, story_path, story = get_active_story_or_http_error()
        except HTTPException:
            raise StoryBadRequestError("No active project")

        if "image_style" in payload:
            story["image_style"] = str(payload["image_style"])
        if "image_additional_info" in payload:
            story["image_additional_info"] = str(payload["image_additional_info"])

        save_story_config(story_path, story)

        return JSONResponse(
            status_code=200,
            content={"ok": True, "story": normalize_story_for_frontend(story)},
        )
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/story/metadata")
async def api_story_metadata(request: Request) -> JSONResponse:
    try:
        payload = await parse_json_body(request)

        try:
            get_active_story_or_http_error()
        except HTTPException:
            raise StoryBadRequestError("No active project")

        title = payload.get("title")
        summary = payload.get("summary")
        tags = payload.get("tags")
        notes = payload.get("notes")
        private_notes = payload.get("private_notes")

        from augmentedquill.services.projects.projects import update_story_metadata

        try:
            update_story_metadata(
                title=title,
                summary=summary,
                tags=tags,
                notes=notes,
                private_notes=private_notes,
            )
        except ValueError as exc:
            return JSONResponse(
                status_code=400, content={"ok": False, "detail": str(exc)}
            )
        return JSONResponse(content={"ok": True})
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/books/{book_id}/metadata")
async def api_book_metadata(
    request: Request, book_id: str = FastAPIPath(...)
) -> JSONResponse:
    try:
        payload = await parse_json_body(request)

        try:
            get_active_story_or_http_error()
        except HTTPException:
            raise StoryBadRequestError("No active project")

        title = payload.get("title")
        summary = payload.get("summary")
        notes = payload.get("notes")
        private_notes = payload.get("private_notes")

        from augmentedquill.services.projects.projects import update_book_metadata

        try:
            update_book_metadata(
                book_id,
                title=title,
                summary=summary,
                notes=notes,
                private_notes=private_notes,
            )
        except ValueError as exc:
            return JSONResponse(
                status_code=404, content={"ok": False, "detail": str(exc)}
            )

        return JSONResponse(content={"ok": True})
    except Exception as exc:
        return map_story_exception(exc)
