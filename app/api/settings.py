from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import json as _json
from typing import Any, Dict

from app.config import load_machine_config, load_story_config
from app.projects import get_active_project_dir
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = BASE_DIR / "config"

router = APIRouter()


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
        normalized_chapters = [_normalize_chapter_entry(c) for c in (story.get("chapters") or [])]

        story_cfg = {
            "project_title": (story.get("project_title") or "Untitled Project"),
            "format": (story.get("format") or "markdown"),
            "chapters": normalized_chapters,
            "llm_prefs": {
                "temperature": float(story.get("llm_prefs", {}).get("temperature", 0.7)),
                "max_tokens": int(story.get("llm_prefs", {}).get("max_tokens", 2048)),
            },
        }
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid story.llm_prefs values")

    openai_cfg = (machine or {}).get("openai") or {}
    models = openai_cfg.get("models")
    selected = openai_cfg.get("selected") or ""

    # If models present, ensure names are unique and non-empty
    if isinstance(models, list) and models:
        name_counts: dict[str, int] = {}
        for m in models:
            if not isinstance(m, dict):
                continue
            name = (m.get("name", "") or "").strip()
            if not name:
                return JSONResponse(status_code=400, content={"ok": False, "detail": "Each model must have a unique, non-empty name."})
            name_counts[name] = name_counts.get(name, 0) + 1
        dups = [n for n, c in name_counts.items() if c > 1]
        if dups:
            return JSONResponse(status_code=400, content={"ok": False, "detail": f"Duplicate model name(s) not allowed: {', '.join(sorted(set(dups)))}"})
        # default selected
        if not selected:
            selected = models[0].get("name", "") if models else ""
        openai_cfg["selected"] = selected
    else:
        # tolerate legacy single model structure
        pass

    machine_cfg = {"openai": openai_cfg}

    try:
        active = get_active_project_dir()
        story_path = (active / "story.json") if active else (CONFIG_DIR / "story.json")
        machine_path = CONFIG_DIR / "machine.json"
        _ensure_parent_dir(story_path)
        _ensure_parent_dir(machine_path)
        story_path.write_text(_json.dumps(story_cfg, indent=2), encoding="utf-8")
        machine_path.write_text(_json.dumps(machine_cfg, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to write configs: {e}"})

    return JSONResponse(status_code=200, content={"ok": True})