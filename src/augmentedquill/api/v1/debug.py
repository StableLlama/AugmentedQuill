# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the debug unit so this responsibility stays isolated, testable, and easy to evolve.

from fastapi import APIRouter
from augmentedquill.services.llm.llm import llm_logs

router = APIRouter(prefix="/debug", tags=["debug"])


@router.get("/llm_logs")
async def get_llm_logs():
    """Return the list of LLM communication logs."""
    return llm_logs


@router.delete("/llm_logs")
async def clear_llm_logs():
    """Clear the LLM communication logs."""
    llm_logs.clear()
    return {"status": "ok"}
