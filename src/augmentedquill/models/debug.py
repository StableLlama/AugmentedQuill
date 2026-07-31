# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Pydantic models for the debug/LLM-log API.

Keeping these here ensures FastAPI includes them in the OpenAPI schema so
the frontend can import auto-generated TypeScript types.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class LLMLogRequest(BaseModel):
    """Shape of the request portion of an LLM log entry."""

    url: str
    method: str
    headers: dict[str, str]
    body: Any


class LLMLogResponse(BaseModel):
    """Shape of the response portion of an LLM log entry."""

    status_code: int | None = None
    body: Any = None
    streaming: bool | None = None
    chunks: list[Any] | None = None
    full_content: str | None = None
    thinking: str | None = None
    error: Any = None
    error_detail: Any = None
    tool_calls: list[Any] | None = None


class DebugLogEntry(BaseModel):
    """A single LLM communication log entry."""

    id: str
    caller_id: str | None = None
    model_type: str | None = None
    timestamp_start: str
    timestamp_end: str | None = None
    request: LLMLogRequest
    response: LLMLogResponse | None = None


class DebugLogsResponse(BaseModel):
    """Response body for ``GET /api/v1/debug/llm_logs``."""

    logs: list[DebugLogEntry]
