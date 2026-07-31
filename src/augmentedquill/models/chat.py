# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chat unit so this responsibility stays isolated, testable, and easy to evolve.

Pydantic models for chat-related API responses.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ChatInitialStateResponse(BaseModel):
    """Response body for ``GET /api/v1/chat``.

    Returns the available LLM models and initial (empty) message history so
    the frontend can initialise the chat panel without a separate request.
    """

    models: list[str]
    current_model: str
    messages: list[Any]


# ---------------------------------------------------------------------------
# Chat undo / redo batch mutations
# ---------------------------------------------------------------------------


class ChatToolBatchMutationResponse(BaseModel):
    """Response body for ``POST /api/v1/chat/tools/undo/{batch_id}``
    and ``POST /api/v1/chat/tools/redo/{batch_id}``."""

    ok: bool
    batch_id: str | None = None
    detail: str | None = None


class ChapterBeforeContentResponse(BaseModel):
    """Response body for ``GET /api/v1/chat/tools/batches/{batch_id}/chapter-before/{chapter_id}``."""

    content: str


# ---------------------------------------------------------------------------
# Chat session list / load
# ---------------------------------------------------------------------------


class ChatListItem(BaseModel):
    """Summary of a saved chat session returned in the chat list."""

    id: str
    name: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ChatListResponse(BaseModel):
    """Response body for ``GET /api/v1/chats`` (list of saved chats)."""

    chats: list[ChatListItem]


class ChatDetailResponse(BaseModel):
    """Response body for ``GET /api/v1/chats/{chat_id}``."""

    id: str
    name: str | None = None
    messages: list[Any] | None = None
    systemPrompt: str | None = None
    allowWebSearch: bool | None = None
    scratchpad: str | None = None
    editing_scratchpad: str | None = None
    projectContextRevision: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class OkResponse(BaseModel):
    """Generic ``{ok: true}`` response used by save/delete chat endpoints."""

    ok: bool
