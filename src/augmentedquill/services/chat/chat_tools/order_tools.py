# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the order tools unit so this responsibility stays isolated, testable, and easy to evolve."""

from typing import Any

from pydantic import Field
from augmentedquill.services.chat.chat_tool_decorator import ToolModel

from augmentedquill.services.chat.chat_tool_decorator import CHAT_ROLE  # noqa: F401

# Pydantic models for tool parameters


class ReorderChaptersParams(ToolModel):
    """Parameters for reordering chapters."""

    chapter_ids: list[int] = Field(
        ..., description="List of numeric chapter IDs in the desired order"
    )
    book_id: str | None = Field(
        None,
        description="The UUID of the book (required for series projects, omit for short-story and novel projects)",
    )


class ReorderBooksParams(ToolModel):
    """Parameters for reordering books in a series."""

    book_ids: list[str] = Field(
        ..., description="List of book UUIDs in the desired order"
    )


# Internal helpers — not registered as LLM tools; called directly by API routes.


async def reorder_chapters(
    params: ReorderChaptersParams, payload: dict, mutations: dict
) -> Any:
    """Reorder Chapters — internal helper, not an LLM tool."""
    from augmentedquill.api.v1.chapters_routes.mutate import api_reorder_chapters
    from augmentedquill.models.chapters import ChaptersReorderRequest

    request_body = ChaptersReorderRequest(
        chapter_ids=params.chapter_ids, book_id=params.book_id
    )
    result = await api_reorder_chapters(request_body)

    if result.status_code == 200:
        mutations["story_changed"] = True
        return {"ok": True, "message": "Chapters reordered successfully"}

    return {
        "error": (result.body.decode() if hasattr(result, "body") else "Reorder failed")
    }


async def reorder_books(
    params: ReorderBooksParams, payload: dict, mutations: dict
) -> Any:
    """Reorder Books — internal helper, not an LLM tool."""
    from augmentedquill.api.v1.chapters_routes.mutate import api_reorder_books
    from augmentedquill.models.chapters import BooksReorderRequest

    request_body = BooksReorderRequest(book_ids=params.book_ids)
    result = await api_reorder_books(request_body)

    if result.status_code == 200:
        mutations["story_changed"] = True
        return {"ok": True, "message": "Books reordered successfully"}

    return {
        "error": (result.body.decode() if hasattr(result, "body") else "Reorder failed")
    }
