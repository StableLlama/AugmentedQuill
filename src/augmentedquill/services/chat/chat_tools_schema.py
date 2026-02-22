# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the chat tools schema unit so this responsibility stays isolated, testable, and easy to evolve.

"""
Chat tool schemas for LLM function calling.

All tools are now decorator-based and auto-registered via @chat_tool.
"""

from augmentedquill.services.chat.chat_tool_decorator import get_tool_schemas
from augmentedquill.services.chat import chat_tools  # noqa: F401


def get_story_tools() -> list[dict]:
    """Return the complete tool schema list for chat/tool calling."""
    return get_tool_schemas()
