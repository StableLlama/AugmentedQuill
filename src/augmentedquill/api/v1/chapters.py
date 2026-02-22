# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the chapters unit so this responsibility stays isolated, testable, and easy to evolve.

from fastapi import APIRouter

from augmentedquill.api.v1.chapters_routes.read import router as chapters_read_router
from augmentedquill.api.v1.chapters_routes.mutate import (
    router as chapters_mutate_router,
)

router = APIRouter(tags=["Chapters"])
router.include_router(chapters_read_router)
router.include_router(chapters_mutate_router)
