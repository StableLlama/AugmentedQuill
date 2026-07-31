# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the settings unit so this responsibility stays isolated, testable, and easy to evolve.

API endpoints for application and machine settings management.
"""

import json as _json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.api.v1.request_body import parse_json_object_body
from augmentedquill.core.config import (
    DEFAULT_MACHINE_CONFIG_PATH,
    DEFAULT_MODEL_PRESETS_PATH,
    DEFAULT_STORY_CONFIG_PATH,
    load_machine_config,
    load_model_presets_config,
    save_story_config,
)
from augmentedquill.core.prompts import (
    DEFAULT_PROMPTS,
    ensure_string,
    get_available_languages,
    get_system_message,
    load_model_prompt_overrides,
)
from augmentedquill.models.machine import (
    MachinePresetsResponse,
    MachineTestModelResponse,
    MachineTestResponse,
    ModelCapabilities,
    OkResponse,
    OkSelectedResponse,
    PromptsResponse,
    StorySummaryResponse,
    StoryTagsResponse,
)
from augmentedquill.services.settings.settings_api_ops import (
    build_story_cfg_from_payload,
    clean_machine_openai_cfg_for_put,
    update_story_field,
    validate_and_fill_openai_cfg_for_settings,
)
from augmentedquill.services.settings.settings_machine_ops import (
    list_remote_models,
    parse_connection_payload,
    remote_model_exists,
)
from augmentedquill.utils.llm_utils import verify_model_capabilities

router = APIRouter(tags=["Settings"])


def _resolve_story_path(project_dir: Path | None = None) -> Path:
    """Return project story config path or fallback default path."""
    return (project_dir / "story.json") if project_dir else DEFAULT_STORY_CONFIG_PATH


async def _api_settings_post_impl(
    request: Request, project_dir: Path | None
) -> OkResponse:
    """Accept JSON body with {story: {...}, machine: {...}} and persist to config/."""
    payload = await parse_json_object_body(request)

    story = (payload or {}).get("story") or {}
    machine = (payload or {}).get("machine") or {}

    try:
        story_cfg = build_story_cfg_from_payload(story)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid story.llm_prefs values")

    openai_cfg = (machine or {}).get("openai") or {}
    openai_cfg, error_detail = validate_and_fill_openai_cfg_for_settings(openai_cfg)
    if error_detail:
        raise HTTPException(status_code=400, detail=error_detail)

    machine_cfg = dict(machine or {})
    machine_cfg["openai"] = openai_cfg

    try:
        story_path = _resolve_story_path(project_dir)
        machine_path = DEFAULT_MACHINE_CONFIG_PATH
        story_path.parent.mkdir(parents=True, exist_ok=True)
        machine_path.parent.mkdir(parents=True, exist_ok=True)
        save_story_config(story_path, story_cfg)
        machine_path.write_text(_json.dumps(machine_cfg, indent=2), encoding="utf-8")
    except (OSError, TypeError, ValueError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to write configs: {e}")

    return OkResponse(ok=True)


@router.post("/settings", response_model=OkResponse)
async def api_settings_post_legacy(request: Request) -> OkResponse:
    """Legacy settings endpoint that persists to default story config when no project path is provided."""
    return await _api_settings_post_impl(request, project_dir=None)


@router.post("/projects/{project_name}/settings", response_model=OkResponse)
async def api_settings_post(request: Request, project_dir: ProjectDep) -> OkResponse:
    """Project-scoped settings endpoint."""
    return await _api_settings_post_impl(request, project_dir=project_dir)


async def _api_prompts_get_impl(
    project_dir: Path | None, model_name: str | None = None
) -> PromptsResponse:
    """Get all resolved prompts (defaults + global overrides + model overrides)."""
    machine_config = load_machine_config() or {}
    if not model_name:
        model_name = machine_config.get("openai", {}).get("selected")

    # figure out project language if there's an active project
    from augmentedquill.core.config import load_story_config

    project_language = "en"
    if project_dir:
        story = load_story_config(project_dir / "story.json") or {}
        project_language = str(story.get("language", "en") or "en")

    model_overrides = load_model_prompt_overrides(machine_config, model_name)

    # Resolve all system messages
    system_messages = {}
    user_prompts = {}
    for key in DEFAULT_PROMPTS.keys():
        system_messages[key] = get_system_message(
            key, model_overrides, language=project_language
        )

        entry = DEFAULT_PROMPTS.get(key, {})
        if isinstance(entry, dict):
            template = entry.get(project_language) or entry.get("en") or ""
        else:
            template = ensure_string(entry)
        if key in model_overrides:
            template = ensure_string(model_overrides[key])
        user_prompts[key] = template

    return PromptsResponse(
        ok=True,
        system_messages=system_messages,
        user_prompts=user_prompts,
        languages=get_available_languages(),
        project_language=project_language,
    )


@router.get("/prompts", response_model=PromptsResponse)
async def api_prompts_get_legacy(model_name: str | None = None) -> PromptsResponse:
    """Legacy prompts endpoint resolved without explicit project path."""
    return await _api_prompts_get_impl(project_dir=None, model_name=model_name)


@router.get("/projects/{project_name}/prompts", response_model=PromptsResponse)
async def api_prompts_get(
    project_dir: ProjectDep, model_name: str | None = None
) -> PromptsResponse:
    """Project-scoped prompts endpoint."""
    return await _api_prompts_get_impl(project_dir=project_dir, model_name=model_name)


@router.post("/machine/test", response_model=MachineTestResponse)
async def api_machine_test(request: Request) -> MachineTestResponse:
    """Test base_url + api_key and return available remote model ids.

    Body: { base_url: str, api_key?: str, timeout_s?: int }
    Returns: { ok: bool, models: str[], detail?: str }
    """
    payload = await parse_json_object_body(request)

    base_url, api_key, timeout_s = parse_connection_payload(payload)

    if not str(base_url).strip():
        return MachineTestResponse(ok=False, models=[], detail="Missing base_url")

    ok, models, detail = await list_remote_models(
        base_url=base_url,
        api_key=api_key,
        timeout_s=timeout_s,
    )
    return MachineTestResponse(ok=ok, models=models, detail=detail)


@router.get("/machine/presets", response_model=MachinePresetsResponse)
async def api_machine_presets_get() -> MachinePresetsResponse:
    """Return model preset database used by Machine Settings UI."""
    data = load_model_presets_config(DEFAULT_MODEL_PRESETS_PATH) or {}
    presets = data.get("presets") if isinstance(data, dict) else []
    if not isinstance(presets, list):
        presets = []
    return MachinePresetsResponse(presets=presets)


@router.post("/machine/test_model", response_model=MachineTestModelResponse)
async def api_machine_test_model(request: Request) -> MachineTestModelResponse:
    """Test whether a model is available for base_url + api_key.

    Body: { base_url: str, api_key?: str, timeout_s?: int, model_id: str }
    Returns: { ok: bool, model_ok: bool, models: str[], detail?: str }
    """
    payload = await parse_json_object_body(request)

    base_url, api_key, timeout_s = parse_connection_payload(payload)
    model_id = (payload or {}).get("model_id") or ""

    if not str(base_url).strip():
        return MachineTestModelResponse(
            ok=False, model_ok=False, models=[], detail="Missing base_url"
        )

    model_id_str = str(model_id or "").strip()

    if not model_id_str:
        return MachineTestModelResponse(
            ok=False, model_ok=False, models=[], detail="Missing model_id"
        )

    model_ok, model_detail = await remote_model_exists(
        base_url=base_url,
        api_key=api_key,
        model_id=model_id_str,
        timeout_s=timeout_s,
    )

    caps = await verify_model_capabilities(
        base_url=base_url,
        api_key=api_key,
        model_id=model_id_str,
        timeout_s=timeout_s,
    )

    return MachineTestModelResponse(
        ok=model_ok,
        model_ok=model_ok,
        models=[model_id_str] if model_ok else [],
        detail=model_detail if model_detail and not model_ok else None,
        capabilities=ModelCapabilities(**caps) if caps else None,
    )


@router.put("/machine", response_model=OkSelectedResponse)
async def api_machine_put(request: Request) -> OkSelectedResponse:
    """Persist machine config to runtime user config path.

    Body: { openai: { models: [{name, base_url, api_key?, timeout_s?, model}], selected? } }
    Returns: { ok: bool, detail?: str }
    """
    payload = await parse_json_object_body(request)

    machine_cfg = dict(payload or {})
    openai_cfg = (
        (machine_cfg.get("openai") or {}) if isinstance(machine_cfg, dict) else {}
    )
    cleaned_openai_cfg, selected, error_detail = clean_machine_openai_cfg_for_put(
        openai_cfg
    )
    if error_detail:
        raise HTTPException(status_code=400, detail=error_detail)

    machine_cfg["openai"] = cleaned_openai_cfg["openai"]

    if "gui_language" in machine_cfg:
        gui_lang = machine_cfg.get("gui_language")
        if isinstance(gui_lang, str) and len(gui_lang.strip()) > 0:
            machine_cfg["gui_language"] = gui_lang.strip()

    try:
        machine_path = DEFAULT_MACHINE_CONFIG_PATH
        machine_path.parent.mkdir(parents=True, exist_ok=True)
        machine_path.write_text(_json.dumps(machine_cfg, indent=2), encoding="utf-8")
    except (OSError, TypeError, ValueError) as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to write machine config: {e}"
        )

    return OkSelectedResponse(ok=True, selected=selected)


@router.put(
    "/projects/{project_name}/story/summary", response_model=StorySummaryResponse
)
async def api_story_summary_put(
    request: Request, project_dir: ProjectDep
) -> StorySummaryResponse:
    """Update story summary in story.json."""
    payload = await parse_json_object_body(request)

    summary = payload.get("summary", "")
    try:
        story_path = _resolve_story_path(project_dir)
        update_story_field(story_path, "story_summary", summary)
    except (OSError, TypeError, ValueError) as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update story summary: {e}"
        )

    return StorySummaryResponse(ok=True, story_summary=summary)


@router.put("/projects/{project_name}/story/tags", response_model=StoryTagsResponse)
async def api_story_tags_put(
    request: Request, project_dir: ProjectDep
) -> StoryTagsResponse:
    """Update story tags in story.json."""
    payload = await parse_json_object_body(request)

    tags = payload.get("tags")
    if not isinstance(tags, list):
        raise HTTPException(status_code=400, detail="tags must be an array")

    try:
        story_path = _resolve_story_path(project_dir)
        update_story_field(story_path, "tags", tags)
    except (OSError, TypeError, ValueError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to update story tags: {e}")

    return StoryTagsResponse(ok=True, tags=tags)
