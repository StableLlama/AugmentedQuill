# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the chat tool dispatcher unit so this responsibility stays isolated, testable, and easy to evolve.

"""
Central dispatcher for delegating LLM tool calls to their respective domain handlers.
"""

from __future__ import annotations

import json as _json
from collections.abc import Callable

from fastapi import HTTPException

from app.services.chat.chat_tools.chapter_tools import handle_chapter_tool
from app.services.chat.chat_tools.common import tool_error
from app.services.chat.chat_tools.image_tools import handle_image_tool
from app.services.chat.chat_tools.order_tools import handle_order_tool
from app.services.chat.chat_tools.project_tools import handle_project_tool
from app.services.chat.chat_tools.sourcebook_tools import handle_sourcebook_tool
from app.services.chat.chat_tools.story_tools import handle_story_tool

# Registry maps each tool name directly to its domain handler for O(1) dispatch.
# Update this dict whenever tool names are added or removed from chat_tools_schema.py.
_TOOL_REGISTRY: dict[str, Callable] = {
    # Project tools
    "get_project_overview": handle_project_tool,
    "create_project": handle_project_tool,
    "list_projects": handle_project_tool,
    "delete_project": handle_project_tool,
    "delete_book": handle_project_tool,
    "create_new_book": handle_project_tool,
    "change_project_type": handle_project_tool,
    # Story tools
    "get_story_metadata": handle_story_tool,
    "update_story_metadata": handle_story_tool,
    "read_story_content": handle_story_tool,
    "write_story_content": handle_story_tool,
    "get_book_metadata": handle_story_tool,
    "update_book_metadata": handle_story_tool,
    "read_book_content": handle_story_tool,
    "write_book_content": handle_story_tool,
    "get_story_summary": handle_story_tool,
    "get_story_tags": handle_story_tool,
    "set_story_tags": handle_story_tool,
    "sync_story_summary": handle_story_tool,
    "write_story_summary": handle_story_tool,
    # Sourcebook tools
    "search_sourcebook": handle_sourcebook_tool,
    "get_sourcebook_entry": handle_sourcebook_tool,
    "create_sourcebook_entry": handle_sourcebook_tool,
    "update_sourcebook_entry": handle_sourcebook_tool,
    "delete_sourcebook_entry": handle_sourcebook_tool,
    # Image tools
    "list_images": handle_image_tool,
    "generate_image_description": handle_image_tool,
    "create_image_placeholder": handle_image_tool,
    "set_image_metadata": handle_image_tool,
    # Chapter tools
    "get_chapter_metadata": handle_chapter_tool,
    "update_chapter_metadata": handle_chapter_tool,
    "get_chapter_summaries": handle_chapter_tool,
    "get_chapter_content": handle_chapter_tool,
    "write_chapter_content": handle_chapter_tool,
    "write_chapter_summary": handle_chapter_tool,
    "sync_summary": handle_chapter_tool,
    "write_chapter": handle_chapter_tool,
    "continue_chapter": handle_chapter_tool,
    "create_new_chapter": handle_chapter_tool,
    "get_chapter_heading": handle_chapter_tool,
    "write_chapter_heading": handle_chapter_tool,
    "get_chapter_summary": handle_chapter_tool,
    "delete_chapter": handle_chapter_tool,
    # Order tools
    "reorder_chapters": handle_order_tool,
    "reorder_books": handle_order_tool,
}


async def exec_chat_tool(
    name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict
) -> dict:
    """Dispatch a single tool call to its domain handler."""
    handler = _TOOL_REGISTRY.get(name)
    if handler is None:
        return tool_error(name, call_id, f"Unknown tool: {name}")
    try:
        result = await handler(name, args_obj, call_id, payload, mutations)
        if result is not None:
            return result
        return tool_error(name, call_id, f"Handler returned no result for: {name}")
    except HTTPException as e:
        return tool_error(name, call_id, f"Tool failed: {e.detail}")
    except Exception as e:
        return {
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": _json.dumps(
                {"error": f"Tool failed with unexpected error: {e}"}
            ),
        }
