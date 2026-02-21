# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the init unit so this responsibility stays isolated, testable, and easy to evolve.

from app.services.chat.chat_tools.chapter_tools import handle_chapter_tool
from app.services.chat.chat_tools.image_tools import (
    _tool_generate_image_description,
    handle_image_tool,
)
from app.services.chat.chat_tools.order_tools import handle_order_tool
from app.services.chat.chat_tools.project_tools import handle_project_tool
from app.services.chat.chat_tools.sourcebook_tools import handle_sourcebook_tool
from app.services.chat.chat_tools.story_tools import handle_story_tool

__all__ = [
    "_tool_generate_image_description",
    "handle_image_tool",
    "handle_story_tool",
    "handle_chapter_tool",
    "handle_project_tool",
    "handle_sourcebook_tool",
    "handle_order_tool",
]
"""
Chat tool implementations for specific domain areas.
"""
