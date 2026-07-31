# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the init unit so this responsibility stays isolated, testable, and easy to evolve.

Chat tool implementations for specific domain areas.

This module imports all tool modules to ensure decorator registration happens.
Tools are auto-registered via the @chat_tool decorator.
"""

# Import all tool modules to trigger decorator registration
from augmentedquill.services.chat.chat_tools import (
    chapter_prose_tools,
    chapter_tools,
    image_tools,
    order_tools,
    project_tools,
    scene_tools,
    search_tools,
    sourcebook_tools,
    story_tools,
    undo_tools,
    web_search_tools,
)

__all__ = [
    "chapter_prose_tools",
    "chapter_tools",
    "image_tools",
    "order_tools",
    "project_tools",
    "scene_tools",
    "search_tools",
    "sourcebook_tools",
    "story_tools",
    "undo_tools",
    "web_search_tools",
]
