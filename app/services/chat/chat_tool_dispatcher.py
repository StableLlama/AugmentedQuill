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

import json as _json

from fastapi import HTTPException

from app.services.chat.chat_tools.chapter_tools import handle_chapter_tool
from app.services.chat.chat_tools.common import tool_error
from app.services.chat.chat_tools.image_tools import (
    handle_image_tool,
)
from app.services.chat.chat_tools.order_tools import handle_order_tool
from app.services.chat.chat_tools.project_tools import handle_project_tool
from app.services.chat.chat_tools.sourcebook_tools import handle_sourcebook_tool
from app.services.chat.chat_tools.story_tools import handle_story_tool


async def _exec_chat_tool(
    name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict
) -> dict:
    """Helper to execute a single tool call."""
    try:
        handlers = [
            handle_project_tool,
            handle_story_tool,
            handle_sourcebook_tool,
            handle_image_tool,
            handle_chapter_tool,
            handle_order_tool,
        ]

        for handler in handlers:
            result = await handler(name, args_obj, call_id, payload, mutations)
            if result is not None:
                return result

        return tool_error(name, call_id, f"Unknown tool: {name}")
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
