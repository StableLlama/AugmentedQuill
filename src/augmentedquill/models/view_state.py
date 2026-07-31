# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Pydantic models for per-project view state.

View state tracks transient UI state that should survive application reloads
but is not part of the story content itself — last open chapter, scroll
position, workspace mode, and scenes view type.
"""

from __future__ import annotations

from pydantic import BaseModel


class ViewStatePayload(BaseModel):
    """View state for a single project.

    All fields are optional so partial updates are safe; the service layer
    fills missing fields with defaults on load.
    """

    current_chapter_id: str | None = None
    scroll_position: int = 0
    workspace_mode: str = "page"
    scenes_view_type: str = "narrative"


class ViewStateResponse(BaseModel):
    """Response body for view state endpoints."""

    ok: bool = True
    view_state: ViewStatePayload | None = None
