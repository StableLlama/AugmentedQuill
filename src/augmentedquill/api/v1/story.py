# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the story unit so this responsibility stays isolated, testable, and easy to evolve.

"""Story API router aggregator.

This module keeps the public import path stable (`augmentedquill.api.v1.story:router`) while
splitting story endpoints into focused route modules.
"""

from fastapi import APIRouter

from augmentedquill.api.v1.story_routes.generation_mutations import (
    router as generation_mutations_router,
)
from augmentedquill.api.v1.story_routes.generation_streaming import (
    router as generation_streaming_router,
)
from augmentedquill.api.v1.story_routes.metadata import router as metadata_router

router = APIRouter(tags=["Story"])
router.include_router(generation_mutations_router)
router.include_router(generation_streaming_router)
router.include_router(metadata_router)
