# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Story API router aggregator.

This module keeps the public import path stable (`app.api.story:router`) while
splitting story endpoints into focused route modules.
"""

from fastapi import APIRouter

from app.api.story_routes.generation import router as generation_router
from app.api.story_routes.metadata import router as metadata_router

router = APIRouter(tags=["Story"])
router.include_router(generation_router)
router.include_router(metadata_router)
