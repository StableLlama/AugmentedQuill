# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""REST endpoints for scene management.

All routes are scoped under ``/projects/{project_name}/scenes`` and require a
valid, existing project directory resolved via the ``ProjectDep`` dependency.
"""

from fastapi import APIRouter, HTTPException

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.models.scene import (
    Scene,
    SceneBatchLinkProseRequest,
    SceneCreateRequest,
    SceneDetectBoundariesRequest,
    SceneDetectBoundariesResponse,
    SceneId,
    SceneLinkProseRequest,
    SceneReorderProseRequest,
    SceneReorderProseResponse,
    SceneUpdateProseContentRequest,
    SceneUpdateRequest,
    SceneWriteRequest,
    SceneWriteResponse,
)
from augmentedquill.services.scenes.scene_generation_service import (
    auto_link_scope_text,
    detect_scene_boundaries_and_link,
    write_scene_and_link,
)
from augmentedquill.services.scenes.scene_service import (
    create_scene,
    delete_scene,
    get_scene,
    link_prose,
    list_scenes,
    relink_scope_prose,
    reorder_scene_prose,
    unlink_prose,
    update_prose_content,
    update_scene,
)

router = APIRouter(prefix="/projects/{project_name}", tags=["Scenes"])


@router.get("/scenes", response_model=list[Scene])
async def get_scenes(project_dir: ProjectDep) -> list[Scene]:
    """List all scenes for the project, with staleness flags on prose links."""
    return [Scene(**s) for s in list_scenes(project_dir)]


@router.post("/scenes", response_model=Scene, status_code=201)
async def create_new_scene(
    project_dir: ProjectDep,
    payload: SceneCreateRequest,
) -> Scene:
    """Create a new scene."""
    return Scene(**create_scene(project_dir, payload))


@router.get("/scenes/{scene_id}", response_model=Scene)
async def get_single_scene(project_dir: ProjectDep, scene_id: SceneId) -> Scene:
    """Fetch a single scene by ID."""
    scene = get_scene(project_dir, scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail=f"Scene '{scene_id}' not found")
    return Scene(**scene)


@router.put("/scenes/{scene_id}", response_model=Scene)
async def update_existing_scene(
    project_dir: ProjectDep,
    scene_id: SceneId,
    payload: SceneUpdateRequest,
) -> Scene:
    """Update an existing scene (partial – only provided fields are changed)."""
    scene = update_scene(project_dir, scene_id, payload)
    if scene is None:
        raise HTTPException(status_code=404, detail=f"Scene '{scene_id}' not found")
    return Scene(**scene)


@router.delete("/scenes/{scene_id}", status_code=204)
async def delete_existing_scene(project_dir: ProjectDep, scene_id: SceneId) -> None:
    """Delete a scene and remove it from all order constraints."""
    if not delete_scene(project_dir, scene_id):
        raise HTTPException(status_code=404, detail=f"Scene '{scene_id}' not found")


class AutoLinkScopeRequest(SceneDetectBoundariesRequest):
    """Body for auto-linking a saved prose scope to its scenes."""

    current_text: str


class AutoLinkScopeResponse(SceneDetectBoundariesResponse):
    """Response for auto-linking a saved prose scope to its scenes."""


@router.post("/scenes/{scene_id}/link-prose", response_model=list[Scene])
async def link_scene_prose(
    project_dir: ProjectDep,
    scene_id: SceneId,
    payload: SceneLinkProseRequest,
) -> list[Scene]:
    """Assign a prose-text range to a scene using inline file markers."""
    if payload.start_offset >= payload.end_offset:
        raise HTTPException(
            status_code=422, detail="start_offset must be less than end_offset"
        )
    scene = get_scene(project_dir, scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail=f"Scene '{scene_id}' not found")
    try:
        updated = link_prose(project_dir, scene_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return [Scene(**s) for s in updated]


@router.post("/scenes/batch-link-prose", response_model=list[Scene])
async def batch_link_scene_prose(
    project_dir: ProjectDep,
    payload: SceneBatchLinkProseRequest,
) -> list[Scene]:
    """Atomically unlink and relink multiple scenes in one scope.

    All assignments are processed in a single pass so touching boundaries
    do not get replayed through repeated single-scene edits that can split
    freshly inserted markers.
    """
    # Unlink requested scenes first
    for sid in payload.unlink_ids:
        unlink_prose(project_dir, sid)

    # Relink all assigned scenes atomically
    assignments = [
        (a.scene_id, a.start_offset, a.end_offset) for a in payload.assignments
    ]
    try:
        updated = relink_scope_prose(
            project_dir,
            payload.scope_type,
            payload.chapter_id,
            payload.book_id,
            assignments,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return [Scene(**s) for s in updated]


@router.post("/scenes/{scene_id}/unlink-prose", response_model=list[Scene])
async def unlink_scene_prose(
    project_dir: ProjectDep,
    scene_id: SceneId,
) -> list[Scene]:
    """Remove the prose link from a scene, preserving its narrative position.

    Returns all scenes affected in the same prose scope.
    """
    scene = get_scene(project_dir, scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail=f"Scene '{scene_id}' not found")
    updated = unlink_prose(project_dir, scene_id)
    return [Scene(**s) for s in updated]


@router.post("/scenes/reorder-prose", response_model=SceneReorderProseResponse)
async def reorder_scene_prose_route(
    project_dir: ProjectDep,
    payload: SceneReorderProseRequest,
) -> SceneReorderProseResponse:
    """Reorder linked prose blocks and persist marker-aware offsets."""
    try:
        updated = reorder_scene_prose(project_dir, payload)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return updated


@router.patch("/scenes/{scene_id}/prose-content", response_model=Scene)
async def update_scene_prose_content(
    project_dir: ProjectDep,
    scene_id: SceneId,
    payload: SceneUpdateProseContentRequest,
) -> Scene:
    """Replace the text between a scene's inline start/end markers."""
    result = update_prose_content(project_dir, scene_id, payload)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Scene '{scene_id}' not found")
    return Scene(**result)


@router.post("/scenes/detect-boundaries", response_model=SceneDetectBoundariesResponse)
async def detect_boundaries_for_scenes(
    project_dir: ProjectDep,
    payload: SceneDetectBoundariesRequest,
) -> SceneDetectBoundariesResponse:
    """Detect scene boundaries in a prose segment and relink affected scenes."""
    try:
        result = await detect_scene_boundaries_and_link(
            project_dir=project_dir,
            request=payload,
            payload={},
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return SceneDetectBoundariesResponse(
        assignments=result["assignments"],
        scenes=[Scene(**scene) for scene in result["scenes"]],
    )


@router.post("/scenes/{scene_id}/write", response_model=SceneWriteResponse)
async def write_scene_prose(
    project_dir: ProjectDep,
    scene_id: SceneId,
    payload: SceneWriteRequest,
) -> SceneWriteResponse:
    """Generate prose for one scene and automatically link generated boundaries."""
    try:
        result = await write_scene_and_link(
            project_dir=project_dir,
            scene_id=scene_id,
            request=payload,
            payload={},
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return SceneWriteResponse(
        scene=Scene(**result["scene"]),
        generated_text=result["generated_text"],
        assignments=result["assignments"],
        scenes=[Scene(**scene) for scene in result["scenes"]],
    )


@router.post("/scenes/auto-link-scope", response_model=AutoLinkScopeResponse)
async def auto_link_saved_scope(
    project_dir: ProjectDep,
    payload: AutoLinkScopeRequest,
) -> AutoLinkScopeResponse:
    """Auto-link a saved prose scope to the scenes that belong to it."""
    try:
        result = await auto_link_scope_text(
            project_dir=project_dir,
            scope_type=payload.scope_type,
            chapter_id=payload.chapter_id,
            book_id=payload.book_id,
            current_text=payload.current_text,
            payload={
                "scene_ids": payload.scene_ids,
                "start_offset": payload.start_offset,
                "end_offset": payload.end_offset,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return AutoLinkScopeResponse(
        assignments=result["assignments"],
        scenes=[Scene(**scene) for scene in result["scenes"]],
    )
