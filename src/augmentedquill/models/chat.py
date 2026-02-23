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
