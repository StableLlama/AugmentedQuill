# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the debug unit so this responsibility stays isolated, testable, and easy to evolve."""

from typing import Any

from fastapi import APIRouter

from augmentedquill.models.debug import DebugLogEntry, DebugLogsResponse
from augmentedquill.services.llm import llm_logging

router = APIRouter(prefix="/debug", tags=["debug"])


@router.get("/llm_logs", response_model=DebugLogsResponse)
async def get_llm_logs() -> DebugLogsResponse:
    """Return the in-memory LLM communication logs."""
    entries = [DebugLogEntry(**entry) for entry in llm_logging.llm_logs]
    return DebugLogsResponse(logs=entries)


@router.delete("/llm_logs")
async def clear_llm_logs() -> Any:
    """Clear the LLM communication logs."""
    llm_logging.llm_logs.clear()
    return {"status": "ok"}
