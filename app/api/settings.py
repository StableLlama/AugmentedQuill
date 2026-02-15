# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import json as _json
import httpx
import datetime

from app.config import load_story_config, load_machine_config, CURRENT_SCHEMA_VERSION
from app.projects import get_active_project_dir
from app.llm import add_llm_log, create_log_entry
from app.prompts import (
    get_system_message,
    load_model_prompt_overrides,
    DEFAULT_SYSTEM_MESSAGES,
    DEFAULT_USER_PROMPTS,
    ensure_string,
)
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = BASE_DIR / "config"

router = APIRouter()


def _normalize_base_url(base_url: str) -> str:
    return str(base_url or "").strip().rstrip("/")


def _auth_headers(api_key: str | None) -> dict[str, str]:
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


async def _list_remote_models(
    *, base_url: str, api_key: str | None, timeout_s: int
) -> tuple[bool, list[str], str | None]:
    """List models from an OpenAI-compatible endpoint.

    Returns (ok, models, detail).
    """
    url = _normalize_base_url(base_url) + "/models"
    headers = _auth_headers(api_key)
    log_entry = create_log_entry(url, "GET", headers, None)
    add_llm_log(log_entry)

    try:
        timeout_obj = httpx.Timeout(float(timeout_s))
    except Exception:
        timeout_obj = httpx.Timeout(10.0)

    try:
        async with httpx.AsyncClient(timeout=timeout_obj) as client:
            r = await client.get(url, headers=headers)
            log_entry["response"]["status_code"] = r.status_code
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            if not r.is_success:
                log_entry["response"]["error"] = f"HTTP {r.status_code}"
                return False, [], f"HTTP {r.status_code}"
            data = r.json()
            log_entry["response"]["body"] = data
    except Exception as e:
        log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
        log_entry["response"]["error"] = str(e)
        return False, [], str(e)

    models: list[str] = []
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        for item in data.get("data") or []:
            if isinstance(item, dict):
                mid = item.get("id")
                if isinstance(mid, str) and mid.strip():
                    models.append(mid.strip())
    elif isinstance(data, dict) and isinstance(data.get("models"), list):
        for item in data.get("models") or []:
            if isinstance(item, str) and item.strip():
                models.append(item.strip())
            elif isinstance(item, dict):
                mid = item.get("id")
                if isinstance(mid, str) and mid.strip():
                    models.append(mid.strip())

    # De-dupe while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for m in models:
        if m not in seen:
            seen.add(m)
            deduped.append(m)
    return True, deduped, None


async def _remote_model_exists(
    *, base_url: str, api_key: str | None, model_id: str, timeout_s: int
) -> tuple[bool, str | None]:
    """Test whether a model is available at the endpoint.

    Tries GET /models/{id} first (cheap). If that isn't supported, falls back
    to a tiny chat.completions call.
    """
    base = _normalize_base_url(base_url)
    model_id = str(model_id or "").strip()
    if not model_id:
        return False, "Missing model_id"

    try:
        timeout_obj = httpx.Timeout(float(timeout_s))
    except Exception:
        timeout_obj = httpx.Timeout(10.0)

    headers = {"Content-Type": "application/json", **_auth_headers(api_key)}

    try:
        async with httpx.AsyncClient(timeout=timeout_obj) as client:
            url1 = f"{base}/models/{model_id}"
            log_entry1 = create_log_entry(url1, "GET", _auth_headers(api_key), None)
            add_llm_log(log_entry1)

            r = await client.get(url1, headers=_auth_headers(api_key))
            log_entry1["response"]["status_code"] = r.status_code
            log_entry1["timestamp_end"] = datetime.datetime.now().isoformat()

            if r.is_success:
                log_entry1["response"]["body"] = r.json()
                return True, None

            # Fallback: minimal chat call (some providers don't expose /models/{id})
            url2 = f"{base}/chat/completions"
            payload = {
                "model": model_id,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1,
                "temperature": 0,
            }
            log_entry2 = create_log_entry(url2, "POST", headers, payload)
            add_llm_log(log_entry2)

            r2 = await client.post(url2, headers=headers, json=payload)
            log_entry2["response"]["status_code"] = r2.status_code
            log_entry2["timestamp_end"] = datetime.datetime.now().isoformat()

            if r2.is_success:
                log_entry2["response"]["body"] = r2.json()
                return True, None

            log_entry2["response"]["error"] = f"HTTP {r2.status_code}"
            return False, f"HTTP {r2.status_code}"
    except Exception as e:
        return False, str(e)


def _ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


@router.post("/api/settings")
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

    # Basic validation and normalization similar to HTML form handler
    try:
        # Normalize incoming chapters data to the {"title": "...", "summary": "..."} format
        from app.helpers.chapter_helpers import _normalize_chapter_entry

        normalized_chapters = [
            _normalize_chapter_entry(c) for c in (story.get("chapters") or [])
        ]

        story_cfg = {
            "project_title": (story.get("project_title") or "Untitled Project"),
            "format": (story.get("format") or "markdown"),
            "story_summary": (story.get("story_summary") or ""),
            "tags": (story.get("tags") or ""),
            "chapters": normalized_chapters,
            "llm_prefs": {
                "temperature": float(
                    story.get("llm_prefs", {}).get("temperature", 0.7)
                ),
                "max_tokens": int(story.get("llm_prefs", {}).get("max_tokens", 2048)),
            },
        }
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid story.llm_prefs values")

    openai_cfg = (machine or {}).get("openai") or {}
    models = openai_cfg.get("models")
    selected = openai_cfg.get("selected") or ""
    selected_chat = openai_cfg.get("selected_chat") or ""
    selected_writing = openai_cfg.get("selected_writing") or ""
    selected_editing = openai_cfg.get("selected_editing") or ""

    # If models present, ensure names are unique and non-empty
    if isinstance(models, list) and models:
        name_counts: dict[str, int] = {}
        for m in models:
            if not isinstance(m, dict):
                continue
            name = (m.get("name", "") or "").strip()
            if not name:
                return JSONResponse(
                    status_code=400,
                    content={
                        "ok": False,
                        "detail": "Each model must have a unique, non-empty name.",
                    },
                )
            name_counts[name] = name_counts.get(name, 0) + 1
        dups = [n for n, c in name_counts.items() if c > 1]
        if dups:
            return JSONResponse(
                status_code=400,
                content={
                    "ok": False,
                    "detail": f"Duplicate model name(s) not allowed: {', '.join(sorted(set(dups)))}",
                },
            )
        # default selected
        if not selected:
            selected = models[0].get("name", "") if models else ""
        if not selected_chat:
            selected_chat = selected
        if not selected_writing:
            selected_writing = selected
        if not selected_editing:
            selected_editing = selected

        openai_cfg["selected"] = selected
        openai_cfg["selected_chat"] = selected_chat
        openai_cfg["selected_writing"] = selected_writing
        openai_cfg["selected_editing"] = selected_editing
    else:
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "detail": "At least one model must be configured in openai.models[].",
            },
        )

    machine_cfg = {"openai": openai_cfg}

    try:
        active = get_active_project_dir()
        story_path = (active / "story.json") if active else (CONFIG_DIR / "story.json")
        machine_path = CONFIG_DIR / "machine.json"
        _ensure_parent_dir(story_path)
        _ensure_parent_dir(machine_path)
        from app.config import save_story_config

        save_story_config(story_path, story_cfg)
        machine_path.write_text(_json.dumps(machine_cfg, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to write configs: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True})


@router.get("/api/prompts")
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

    from app.prompts import PROMPT_TYPES

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "system_messages": system_messages,
            "user_prompts": user_prompts,
            "prompt_types": PROMPT_TYPES,
        },
    )


@router.post("/api/machine/test")
async def api_machine_test(request: Request) -> JSONResponse:
    """Test base_url + api_key and return available remote model ids.

    Body: { base_url: str, api_key?: str, timeout_s?: int }
    Returns: { ok: bool, models: str[], detail?: str }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    base_url = (payload or {}).get("base_url") or ""
    api_key = (payload or {}).get("api_key") or None
    timeout_s = (payload or {}).get("timeout_s")
    try:
        timeout_s = int(timeout_s) if timeout_s is not None else 10
    except Exception:
        timeout_s = 10

    if not str(base_url).strip():
        return JSONResponse(
            status_code=200,
            content={"ok": False, "models": [], "detail": "Missing base_url"},
        )

    ok, models, detail = await _list_remote_models(
        base_url=str(base_url),
        api_key=(str(api_key) if api_key else None),
        timeout_s=timeout_s,
    )
    return JSONResponse(
        status_code=200,
        content={"ok": ok, "models": models, **({"detail": detail} if detail else {})},
    )


@router.post("/api/machine/test_model")
async def api_machine_test_model(request: Request) -> JSONResponse:
    """Test whether a model is available for base_url + api_key.

    Body: { base_url: str, api_key?: str, timeout_s?: int, model_id: str }
    Returns: { ok: bool, model_ok: bool, models: str[], detail?: str }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    base_url = (payload or {}).get("base_url") or ""
    api_key = (payload or {}).get("api_key") or None
    model_id = (payload or {}).get("model_id") or ""
    timeout_s = (payload or {}).get("timeout_s")
    try:
        timeout_s = int(timeout_s) if timeout_s is not None else 10
    except Exception:
        timeout_s = 10

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

    ok, models, detail = await _list_remote_models(
        base_url=str(base_url),
        api_key=(str(api_key) if api_key else None),
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
    from app.helpers.llm_utils import verify_model_capabilities

    caps = await verify_model_capabilities(
        base_url=str(base_url),
        api_key=str(api_key) if api_key else None,
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

    model_ok, model_detail = await _remote_model_exists(
        base_url=str(base_url),
        api_key=(str(api_key) if api_key else None),
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


@router.put("/api/machine")
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
    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    selected = (
        (openai_cfg.get("selected") or "") if isinstance(openai_cfg, dict) else ""
    )

    if not (isinstance(models, list) and models):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "detail": "At least one model must be configured in openai.models[].",
            },
        )

    # Validate unique, non-empty names and required fields.
    name_counts: dict[str, int] = {}
    cleaned_models: list[dict] = []
    for m in models:
        if not isinstance(m, dict):
            continue
        name = (m.get("name") or "").strip()
        base_url = (m.get("base_url") or "").strip()
        model = (m.get("model") or "").strip()
        api_key = m.get("api_key")
        timeout_s = m.get("timeout_s", 60)
        prompt_overrides = m.get("prompt_overrides", {})

        if not name:
            return JSONResponse(
                status_code=400,
                content={
                    "ok": False,
                    "detail": "Each model must have a unique, non-empty name.",
                },
            )
        if not base_url:
            return JSONResponse(
                status_code=400,
                content={"ok": False, "detail": f"Model '{name}' is missing base_url."},
            )
        if not model:
            return JSONResponse(
                status_code=400,
                content={"ok": False, "detail": f"Model '{name}' is missing model."},
            )

        name_counts[name] = name_counts.get(name, 0) + 1

        try:
            timeout_s_int = int(timeout_s)
        except Exception:
            timeout_s_int = 60

        cleaned_models.append(
            {
                "name": name,
                "base_url": base_url,
                "api_key": api_key,
                "timeout_s": timeout_s_int,
                "model": model,
                "is_multimodal": m.get("is_multimodal"),
                "supports_function_calling": m.get("supports_function_calling"),
                "prompt_overrides": prompt_overrides,
            }
        )

    dups = [n for n, c in name_counts.items() if c > 1]
    if dups:
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "detail": f"Duplicate model name(s) not allowed: {', '.join(sorted(set(dups)))}",
            },
        )

    if not selected:
        selected = cleaned_models[0].get("name", "")
    elif selected not in [m.get("name") for m in cleaned_models]:
        selected = cleaned_models[0].get("name", "")

    machine_cfg = {"openai": {"models": cleaned_models, "selected": selected}}

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


@router.put("/api/story/summary")
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
        story = load_story_config(story_path) or {}
        story["story_summary"] = summary
        _ensure_parent_dir(story_path)
        from app.config import save_story_config

        save_story_config(story_path, story)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update story summary: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True, "story_summary": summary})


@router.put("/api/story/tags")
async def api_story_tags_put(request: Request) -> JSONResponse:
    """Update story tags in story.json."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    tags = payload.get("tags")
    if not isinstance(tags, list):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "tags must be an array"},
        )

    try:
        active = get_active_project_dir()
        story_path = (active / "story.json") if active else (CONFIG_DIR / "story.json")
        story = load_story_config(story_path) or {}
        story["tags"] = tags
        _ensure_parent_dir(story_path)
        from app.config import save_story_config

        save_story_config(story_path, story)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update story tags: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True, "tags": tags})


@router.post("/api/settings/update_story_config")
async def update_story_config(request: Request):
    """Update the story config to the latest version."""
    try:
        active = get_active_project_dir()
        story_path = (active / "story.json") if active else (CONFIG_DIR / "story.json")

        # Load without validation to get current config
        from app.config import load_json_file, _interpolate_env, _deep_merge

        defaults = {}
        json_config = load_json_file(story_path)
        json_config = _interpolate_env(json_config)
        merged = _deep_merge(defaults, json_config)

        version = merged.get("metadata", {}).get("version", 0)
        if version >= CURRENT_SCHEMA_VERSION:
            return JSONResponse(
                status_code=200, content={"ok": True, "message": "Already up to date"}
            )

        # Find the update script
        update_script = (
            BASE_DIR
            / "app"
            / "updates"
            / f"update_v{version}_to_v{CURRENT_SCHEMA_VERSION}.py"
        )
        if not update_script.exists():
            return JSONResponse(
                status_code=500,
                content={
                    "ok": False,
                    "detail": f"No update script found for version {version} to {CURRENT_SCHEMA_VERSION}",
                },
            )

        # Run the update script
        import subprocess

        python_exe = BASE_DIR / "venv" / "bin" / "python"
        result = subprocess.run(
            [str(python_exe), str(update_script), str(story_path)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            return JSONResponse(
                status_code=500,
                content={"ok": False, "detail": f"Update failed: {result.stderr}"},
            )

        return JSONResponse(
            status_code=200, content={"ok": True, "message": result.stdout.strip()}
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update story config: {e}"},
        )
