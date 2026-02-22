# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the settings unit so this responsibility stays isolated, testable, and easy to evolve.

"""
API endpoints for application and machine settings management.
"""

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import json as _json

from augmentedquill.core.config import (
    load_machine_config,
    CURRENT_SCHEMA_VERSION,
    BASE_DIR,
    CONFIG_DIR,
)
from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.core.prompts import (
    get_system_message,
    load_model_prompt_overrides,
    DEFAULT_SYSTEM_MESSAGES,
    DEFAULT_USER_PROMPTS,
    ensure_string,
)
from augmentedquill.services.settings.settings_api_ops import (
    ensure_parent_dir,
    build_story_cfg_from_payload,
    validate_and_fill_openai_cfg_for_settings,
    clean_machine_openai_cfg_for_put,
    update_story_field,
)
from augmentedquill.services.settings.settings_machine_ops import (
    parse_connection_payload,
    list_remote_models,
    remote_model_exists,
)
from augmentedquill.services.settings.settings_update_ops import run_story_config_update
from augmentedquill.api.v1.http_responses import error_json, ok_json
from pathlib import Path

router = APIRouter(tags=["Settings"])


def _ensure_parent_dir(path: Path) -> None:
    ensure_parent_dir(path)


@router.post("/settings")
async def api_settings_post(request: Request) -> JSONResponse:
    """Accept JSON body with {story: {...}, machine: {...}} and persist to config/.

    Returns {ok: true} on success or {ok:false, detail: str} on error.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    story = (payload or {}).get("story") or {}
    machine = (payload or {}).get("machine") or {}

    try:
        story_cfg = build_story_cfg_from_payload(story)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid story.llm_prefs values")

    openai_cfg = (machine or {}).get("openai") or {}
    openai_cfg, error_detail = validate_and_fill_openai_cfg_for_settings(openai_cfg)
    if error_detail:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": error_detail},
        )

    machine_cfg = {"openai": openai_cfg}

    try:
        active = get_active_project_dir()
        story_path = (active / "story.json") if active else (CONFIG_DIR / "story.json")
        machine_path = CONFIG_DIR / "machine.json"
        _ensure_parent_dir(story_path)
        _ensure_parent_dir(machine_path)
        from augmentedquill.core.config import save_story_config

        save_story_config(story_path, story_cfg)
        machine_path.write_text(_json.dumps(machine_cfg, indent=2), encoding="utf-8")
    except Exception as e:
        return error_json(f"Failed to write configs: {e}", status_code=500)

    return ok_json({"ok": True})


@router.get("/prompts")
async def api_prompts_get(model_name: str | None = None) -> JSONResponse:
    """Get all resolved prompts (defaults + global overrides + model overrides)."""
    machine_config = load_machine_config(CONFIG_DIR / "machine.json") or {}
    if not model_name:
        model_name = machine_config.get("openai", {}).get("selected")

    model_overrides = load_model_prompt_overrides(machine_config, model_name)

    # Resolve all system messages
    system_messages = {}
    for key in DEFAULT_SYSTEM_MESSAGES.keys():
        system_messages[key] = get_system_message(key, model_overrides)

    # Resolve all user prompts (templates)
    user_prompts = {}
    for key in DEFAULT_USER_PROMPTS.keys():
        user_prompts[key] = ensure_string(
            model_overrides.get(key) or DEFAULT_USER_PROMPTS.get(key, "")
        )

    from augmentedquill.core.prompts import PROMPT_TYPES

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "system_messages": system_messages,
            "user_prompts": user_prompts,
            "prompt_types": PROMPT_TYPES,
        },
    )


@router.post("/machine/test")
async def api_machine_test(request: Request) -> JSONResponse:
    """Test base_url + api_key and return available remote model ids.

    Body: { base_url: str, api_key?: str, timeout_s?: int }
    Returns: { ok: bool, models: str[], detail?: str }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    base_url, api_key, timeout_s = parse_connection_payload(payload)

    if not str(base_url).strip():
        return JSONResponse(
            status_code=200,
            content={"ok": False, "models": [], "detail": "Missing base_url"},
        )

    ok, models, detail = await list_remote_models(
        base_url=base_url,
        api_key=api_key,
        timeout_s=timeout_s,
    )
    return JSONResponse(
        status_code=200,
        content={"ok": ok, "models": models, **({"detail": detail} if detail else {})},
    )


@router.post("/machine/test_model")
async def api_machine_test_model(request: Request) -> JSONResponse:
    """Test whether a model is available for base_url + api_key.

    Body: { base_url: str, api_key?: str, timeout_s?: int, model_id: str }
    Returns: { ok: bool, model_ok: bool, models: str[], detail?: str }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    base_url, api_key, timeout_s = parse_connection_payload(payload)
    model_id = (payload or {}).get("model_id") or ""

    if not str(base_url).strip():
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "model_ok": False,
                "models": [],
                "detail": "Missing base_url",
            },
        )

    ok, models, detail = await list_remote_models(
        base_url=base_url,
        api_key=api_key,
        timeout_s=timeout_s,
    )
    if not ok:
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "model_ok": False,
                "models": [],
                **({"detail": detail} if detail else {}),
            },
        )

    model_id_str = str(model_id or "").strip()
    # Perform dynamic capability verification
    from augmentedquill.utils.llm_utils import verify_model_capabilities

    caps = await verify_model_capabilities(
        base_url=base_url,
        api_key=api_key,
        model_id=model_id_str,
        timeout_s=timeout_s,
    )

    if model_id_str and model_id_str in set(models):
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "model_ok": True,
                "models": models,
                "capabilities": caps,
            },
        )

    model_ok, model_detail = await remote_model_exists(
        base_url=base_url,
        api_key=api_key,
        model_id=model_id_str,
        timeout_s=timeout_s,
    )
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "model_ok": bool(model_ok),
            "models": models,
            "detail": model_detail,
            "capabilities": caps if model_ok else {},
        },
    )


@router.put("/machine")
async def api_machine_put(request: Request) -> JSONResponse:
    """Persist machine config to config/machine.json.

    Body: { openai: { models: [{name, base_url, api_key?, timeout_s?, model}], selected? } }
    Returns: { ok: bool, detail?: str }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    machine = payload or {}
    openai_cfg = (machine.get("openai") or {}) if isinstance(machine, dict) else {}
    machine_cfg, selected, error_detail = clean_machine_openai_cfg_for_put(openai_cfg)
    if error_detail:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": error_detail}
        )

    try:
        machine_path = CONFIG_DIR / "machine.json"
        _ensure_parent_dir(machine_path)
        machine_path.write_text(_json.dumps(machine_cfg, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to write machine config: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True, "selected": selected})


@router.put("/story/summary")
async def api_story_summary_put(request: Request) -> JSONResponse:
    """Update story summary in story.json."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    summary = payload.get("summary", "")
    try:
        active = get_active_project_dir()
        story_path = (active / "story.json") if active else (CONFIG_DIR / "story.json")
        update_story_field(story_path, "story_summary", summary)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update story summary: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True, "story_summary": summary})


@router.put("/story/tags")
async def api_story_tags_put(request: Request) -> JSONResponse:
    """Update story tags in story.json."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    tags = payload.get("tags")
    if not isinstance(tags, list):
        return error_json("tags must be an array", status_code=400)

    try:
        active = get_active_project_dir()
        story_path = (active / "story.json") if active else (CONFIG_DIR / "story.json")
        update_story_field(story_path, "tags", tags)
    except Exception as e:
        return error_json(f"Failed to update story tags: {e}", status_code=500)

    return ok_json({"ok": True, "tags": tags})


@router.post("/settings/update_story_config")
async def update_story_config(request: Request):
    """Update the story config to the latest version."""
    try:
        active = get_active_project_dir()
        story_path = (active / "story.json") if active else (CONFIG_DIR / "story.json")
        ok, message = run_story_config_update(
            base_dir=BASE_DIR,
            config_dir=CONFIG_DIR,
            story_path=story_path,
            current_schema_version=CURRENT_SCHEMA_VERSION,
        )
        if ok:
            return JSONResponse(
                status_code=200, content={"ok": True, "message": message}
            )
        return JSONResponse(status_code=500, content={"ok": False, "detail": message})
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update story config: {e}"},
        )
