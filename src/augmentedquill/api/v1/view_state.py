# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""REST endpoints for per-project view state.

All routes are scoped under ``/projects/{project_name}/view-state`` and
require a valid, existing project directory resolved via the ``ProjectDep``
dependency.
"""

from fastapi import APIRouter

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.models.view_state import ViewStatePayload, ViewStateResponse
from augmentedquill.services.projects.view_state_ops import (
    load_view_state,
    save_view_state,
)

router = APIRouter(prefix="/projects/{project_name}", tags=["View State"])


@router.get("/view-state", response_model=ViewStateResponse)
async def get_view_state(project_dir: ProjectDep) -> ViewStateResponse:
    """Return the saved view state for the project, with defaults for missing fields."""
    raw = load_view_state(project_dir)
    return ViewStateResponse(
        ok=True,
        view_state=ViewStatePayload(**raw),
    )


@router.put("/view-state", response_model=ViewStateResponse)
async def put_view_state(
    project_dir: ProjectDep,
    payload: ViewStatePayload,
) -> ViewStateResponse:
    """Persist view state for the project."""
    save_view_state(project_dir, payload.model_dump())
    return ViewStateResponse(ok=True, view_state=payload)
