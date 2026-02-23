# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chat tool dispatcher unit so this responsibility stays isolated, testable, and easy to evolve.

Central dispatcher for delegating LLM tool calls to their respective domain handlers.

All tools are registered via the @chat_tool decorator and dispatched through
the decorator-based tool registry.
"""

from __future__ import annotations

import json as _json

from fastapi import HTTPException

from augmentedquill.services.chat.chat_tool_decorator import get_tool_function
from augmentedquill.services.chat.chat_tools.common import tool_error


async def exec_chat_tool(
    name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict
) -> dict:
    """
    Dispatch a single tool call to its handler.

    All tools are registered via the @chat_tool decorator.
    """
    decorator_tool = get_tool_function(name)
    if decorator_tool is None:
        return tool_error(name, call_id, f"Unknown tool: {name}")

    try:
        return await decorator_tool(args_obj, call_id, payload, mutations)
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
