# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the common unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


class StoryApiError(Exception):
    def __init__(self, detail: str, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class StoryBadRequestError(StoryApiError):
    def __init__(self, detail: str):
        super().__init__(detail=detail, status_code=400)


class StoryNotFoundError(StoryApiError):
    def __init__(self, detail: str):
        super().__init__(detail=detail, status_code=404)


class StoryPersistenceError(StoryApiError):
    def __init__(self, detail: str):
        super().__init__(detail=detail, status_code=500)


async def parse_json_body(request: Request) -> dict:
    try:
        payload = await request.json()
    except Exception as exc:
        raise StoryBadRequestError("Invalid JSON body") from exc
    return payload if isinstance(payload, dict) else {}


def error_json(detail: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        status_code=status_code, content={"ok": False, "detail": detail}
    )


def map_story_exception(exc: Exception) -> JSONResponse:
    if isinstance(exc, StoryApiError):
        return error_json(exc.detail, exc.status_code)
    if isinstance(exc, HTTPException):
        return error_json(str(exc.detail), exc.status_code)
    return error_json(str(exc), 500)
