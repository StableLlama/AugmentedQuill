from __future__ import annotations

import argparse
import os
from dataclasses import asdict
from pathlib import Path
from typing import Optional, List, Tuple
import re

from fastapi import FastAPI, Request, HTTPException, Form, Path as FastAPIPath
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import load_machine_config, load_story_config
from app.projects import (
    load_registry,
    select_project,
    get_active_project_dir,
    list_projects,
    delete_project,
)

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
CONFIG_DIR = BASE_DIR / "config"

app = FastAPI(title="AugmentedQuill")

# Mount static files if folder exists (created in repo)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    # Serve static template; frontend fetches dynamic data via REST JSON APIs.
    return templates.TemplateResponse(
        "index.html",
        {"request": request},
    )


@app.get("/health")
def healthcheck() -> dict:
    return {"status": "ok"}


# JSON REST APIs to serve dynamic data to the frontend (no server-side injection in HTML)
@app.get("/api/health")
async def api_health() -> dict:
    return {"status": "ok"}


@app.get("/api/story")
async def api_story() -> dict:
    active = get_active_project_dir()
    if active:
        story = load_story_config(active / "story.json")
    else:
        story = load_story_config(CONFIG_DIR / "story.json")
    return story or {}


@app.get("/api/machine")
async def api_machine() -> dict:
    machine = load_machine_config(CONFIG_DIR / "machine.json")
    return machine or {}




@app.get("/settings", response_class=HTMLResponse)
async def settings_get(request: Request) -> HTMLResponse:
    """Serve settings UI shell; frontend will fetch JSON via REST to populate."""
    return templates.TemplateResponse(
        "settings.html",
        {"request": request},
    )


def _ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


@app.post("/settings", response_class=HTMLResponse)
async def settings_post(
    request: Request,
    project_title: str = Form(""),
    format: str = Form("markdown"),
    chapters: str = Form(""),
    llm_temperature: str = Form("0.7"),
    llm_max_tokens: str = Form("2048"),
    # New multi-model fields (JSON string with {models:[...], selected:"name"})
    openai_models_json: str = Form(""),
    openai_selected_name: str = Form(""),
    # Legacy single model fields for backward compatibility (may be absent in UI)
    openai_api_key: str = Form("") ,
    openai_base_url: str = Form("https://api.openai.com/v1"),
    openai_model: str = Form("gpt-4o-mini"),
    openai_timeout_s: str = Form("60"),
) -> HTMLResponse:
    """Persist settings from form submission and re-render the form with a notice."""
    # Parse chapters from textarea (one per line, ignore empties)
    # The form only provides titles, so summaries will be empty initially for new entries
    # or will retain existing if updating.
    new_chapter_titles = [line.strip() for line in chapters.splitlines() if line.strip()]

    # Load existing story config to merge summaries
    active = get_active_project_dir()
    existing_story = load_story_config((active / "story.json") if active else (CONFIG_DIR / "story.json")) or {}
    existing_chapters_data = [_normalize_chapter_entry(c) for c in existing_story.get("chapters", [])]

    # Create new chapters list, merging existing summaries where titles match
    merged_chapters_data: List[Dict[str, str]] = []
    for i, title in enumerate(new_chapter_titles):
        # Try to find a matching title in existing chapters
        # For simplicity, if titles are identical, use the existing summary.
        # Otherwise, create a new entry with an empty summary.
        found_match = False
        for old_chap in existing_chapters_data:
            if old_chap.get("title") == title:
                merged_chapters_data.append(old_chap)
                found_match = True
                break
        if not found_match:
            # If no match, or if it's a brand new title, add with empty summary
            merged_chapters_data.append({"title": title, "summary": ""})


    # Build story config
    try:
        max_tokens = int(llm_max_tokens)
    except ValueError:
        max_tokens = llm_max_tokens  # keep as string if invalid
    try:
        temperature = float(llm_temperature)
    except ValueError:
        temperature = llm_temperature

    story_cfg = {
        "project_title": project_title or "Untitled Project",
        "format": format or "markdown",
        "chapters": merged_chapters_data, # Use the merged data
        "llm_prefs": {
            "temperature": temperature,
            "max_tokens": max_tokens,
        },
    }

    # Build machine config: prefer multi-model payload if provided
    import json
    models_payload: dict | None = None
    try:
        models_payload = json.loads(openai_models_json) if openai_models_json else None
    except json.JSONDecodeError:
        models_payload = None

    # Start with defaults/legacy
    try:
        legacy_timeout_val = int(openai_timeout_s)
    except ValueError:
        legacy_timeout_val = openai_timeout_s

    # Validate unique, non-empty names if multi-model payload provided
    def _render_with_error(error_msg: str) -> HTMLResponse:
        # Preserve init fields as provided; backend validation error means nothing was saved
        return templates.TemplateResponse(
            "settings.html",
            {
                "request": request,
                "machine": {"openai": {}},
                "story": story_cfg,
                "saved": False,
                "error": error_msg,
                "openai_models_json": openai_models_json or "[]",
                "openai_selected_name": openai_selected_name or "",
                "legacy_openai_api_key": openai_api_key or "",
                "legacy_openai_base_url": openai_base_url or "https://api.openai.com/v1",
                "legacy_openai_timeout_s": legacy_timeout_val if isinstance(legacy_timeout_val, int) else 60,
                "legacy_openai_model": openai_model or "",
            },
        )

    openai_cfg: dict = {}
    if models_payload and isinstance(models_payload, dict) and isinstance(models_payload.get("models"), list):
        models_list = []
        name_counts: dict[str, int] = {}
        has_empty = False
        for m in models_payload.get("models", []):
            if not isinstance(m, dict):
                continue
            name = (m.get("name", "") or "").strip()
            if not name:
                has_empty = True
            else:
                name_counts[name] = name_counts.get(name, 0) + 1
            models_list.append({
                "name": name,
                "base_url": m.get("base_url", ""),
                "api_key": m.get("api_key", ""),
                "timeout_s": m.get("timeout_s", 60),
                "model": m.get("model", ""),
            })
        duplicates = [n for (n, c) in name_counts.items() if c > 1]
        if has_empty:
            return _render_with_error("Each model must have a unique, non-empty name.")
        if duplicates:
            return _render_with_error(f"Duplicate model name(s) not allowed: {', '.join(sorted(set(duplicates)))}")

        selected = models_payload.get("selected") or openai_selected_name or (models_list[0]["name"] if models_list else "")
        openai_cfg["models"] = models_list
        openai_cfg["selected"] = selected
        # Mirror selected into legacy fields for compatibility
        selected_model = next((m for m in models_list if m.get("name") == selected), None)
        if selected_model:
            openai_cfg["api_key"] = selected_model.get("api_key", "")
            openai_cfg["base_url"] = selected_model.get("base_url", "https://api.openai.com/v1")
            openai_cfg["model"] = selected_model.get("model", "")
            openai_cfg["timeout_s"] = selected_model.get("timeout_s", 60)
    else:
        # Fall back to legacy single-model fields
        openai_cfg.update({
            "api_key": openai_api_key,
            "base_url": openai_base_url,
            "model": openai_model,
            "timeout_s": legacy_timeout_val,
        })

    machine_cfg = {"openai": openai_cfg}

    # Persist to disk under config/
    active = get_active_project_dir()
    story_path = (active / "story.json") if active else (CONFIG_DIR / "story.json")
    machine_path = CONFIG_DIR / "machine.json"
    _ensure_parent_dir(story_path)
    _ensure_parent_dir(machine_path)

    story_path.write_text(json.dumps(story_cfg, indent=2), encoding="utf-8")
    machine_path.write_text(json.dumps(machine_cfg, indent=2), encoding="utf-8")

    # Re-render form with a success message and provide init fields so Alpine preserves state
    # Prepare init fields similar to GET so the client-side component initializes with saved values
    openai_cfg = machine_cfg.get("openai", {}) if isinstance(machine_cfg, dict) else {}
    import json
    models_json = json.dumps(openai_cfg.get("models", []))
    selected_name = openai_cfg.get("selected", "") or ""
    legacy_api_key = openai_cfg.get("api_key", "")
    legacy_base_url = openai_cfg.get("base_url", "https://api.openai.com/v1")
    legacy_timeout = openai_cfg.get("timeout_s", 60)
    legacy_model = openai_cfg.get("model", "")

    return templates.TemplateResponse(
        "settings.html",
        {
            "request": request,
            "machine": machine_cfg,
            "story": {
                **story_cfg,
                "chapters": [c.get("title", "") for c in story_cfg.get("chapters", []) if isinstance(c, dict)] # Convert back to list of titles for the form
            },
            "saved": True,
            # Init fields for Alpine models editor
            "openai_models_json": models_json,
            "openai_selected_name": selected_name,
            "legacy_openai_api_key": legacy_api_key,
            "legacy_openai_base_url": legacy_base_url,
            "legacy_openai_timeout_s": legacy_timeout,
            "legacy_openai_model": legacy_model,
        },
    )


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="augmentedquill",
        description="Run the AugmentedQuill FastAPI server",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind (default: 8000)")
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload (development only)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help="Number of worker processes (overrides reload)",
    )
    parser.add_argument(
        "--log-level",
        default="info",
        choices=["critical", "error", "warning", "info", "debug", "trace"],
        help="Log level for the server (default: info)",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> None:
    """CLI entrypoint to run the server via a normal Python invocation.

    Examples:
      python -m app.main --help
      python -m app.main --host 0.0.0.0 --port 8000 --reload
    """
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    # Import uvicorn lazily so that importing this module doesn't require it for tests/tools
    import uvicorn  # type: ignore

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=bool(args.reload) if args.workers in (None, 0) else False,
        workers=args.workers,
        log_level=args.log_level,
        # Set factory=False because we pass an import string to app
        factory=False,
    )


if __name__ == "__main__":
    main()


# --- Settings JSON API ---
from fastapi.responses import JSONResponse
import httpx  # HTTP client for server-side fetch fallback
import json as _json
from typing import Any, Dict
import asyncio


@app.post("/api/settings")
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


# --- Projects selection API ---
from app.projects import load_registry as _load_projects_registry


@app.get("/api/projects")
async def api_projects() -> dict:
    reg = _load_projects_registry()
    cur = reg.get("current") or ""
    recent = [p for p in reg.get("recent", []) if p]
    available = list_projects()
    return {"current": cur, "recent": recent[:5], "available": available}


@app.post("/api/projects/delete")
async def api_projects_delete(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    name = (payload or {}).get("name") or ""
    ok, msg = delete_project(name)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})
    # Return updated registry and available list
    reg = _load_projects_registry()
    available = list_projects()
    return JSONResponse(status_code=200, content={"ok": True, "message": msg, "registry": reg, "available": available})


@app.post("/api/projects/select")
async def api_projects_select(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    name = (payload or {}).get("name") or ""
    ok, msg = select_project(name)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})
    # On success, return current registry and the story that was loaded/created
    reg = _load_projects_registry()
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else (CONFIG_DIR / "story.json"))
    return JSONResponse(status_code=200, content={"ok": True, "message": msg, "registry": reg, "story": story})


# --- Chapters APIs ---
import io


def _scan_chapter_files() -> List[Tuple[int, Path]]:
    """Return list of (index, path) for chapter files under active project.

    Supports files like '0001.txt' (preferred) and legacy like 'chapter01.txt'.
    Sorted by numeric index ascending.
    """
    active = get_active_project_dir()
    if not active:
        return []
    chapters_dir = active / "chapters"
    if not chapters_dir.exists() or not chapters_dir.is_dir():
        return []
    items: List[Tuple[int, Path]] = []
    for p in chapters_dir.glob("*.txt"):
        if not p.is_file():
            continue
        name = p.name
        m = re.match(r"^(\d{4})\.txt$", name)
        if m:
            idx = int(m.group(1))
            items.append((idx, p))
            continue
        # legacy chapter01.txt -> index 1
        m2 = re.match(r"^chapter(\d+)\.txt$", name, re.IGNORECASE)
        if m2:
            try:
                idx = int(m2.group(1))
                items.append((idx, p))
            except ValueError:
                pass
    items.sort(key=lambda t: t[0])
    return items


def _load_chapter_titles(count: int) -> List[str]:
    """Load chapter titles from story.json chapters array if present.
    Do not pad; callers decide fallbacks (e.g., filename).
    """
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else (CONFIG_DIR / "story.json")) or {}
    titles = story.get("chapters") or []
    # Normalize to strings and keep as-provided; empty strings allowed (handled by caller)
    titles = [str(x) for x in titles if isinstance(x, (str, int, float))]
    return titles[:count]


@app.get("/api/chapters")
async def api_chapters() -> dict:
    files = _scan_chapter_files()
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else (CONFIG_DIR / "story.json")) or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]

    result = []
    for i, (idx, p) in enumerate(files):
        # Get chapter details from story_config, falling back to filename
        chap_entry = chapters_data[i] if i < len(chapters_data) else {"title": "", "summary": ""}
        title = (chap_entry.get("title") or "").strip() or p.name
        summary = (chap_entry.get("summary") or "").strip()

        result.append({"id": idx, "title": title, "filename": p.name, "summary": summary})
    return {"chapters": result}


@app.get("/api/chapters/{chap_id}")
async def api_chapter_content(chap_id: int = FastAPIPath(..., ge=0)) -> dict:
    files = _scan_chapter_files()
    # Find by numeric id
    match = next(((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Chapter not found")
    idx, path, pos = match

    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else (CONFIG_DIR / "story.json")) or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]

    chap_entry = chapters_data[pos] if pos < len(chapters_data) else {"title": "", "summary": ""}
    title = (chap_entry.get("title") or "").strip() or path.name
    summary = (chap_entry.get("summary") or "").strip()

    try:
        content = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")
    return {"id": idx, "title": title, "filename": path.name, "content": content, "summary": summary}


@app.put("/api/chapters/{chap_id}/title")
async def api_update_chapter_title(request: Request, chap_id: int = FastAPIPath(..., ge=0)) -> JSONResponse:
    """Update the title of a chapter in the active project's story.json.
    The title positions correspond to the sorted chapter files list.
    """
    active = get_active_project_dir()
    if not active:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No active project"})
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    new_title = (payload or {}).get("title")
    if new_title is None:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "title is required"})
    new_title_str = str(new_title).strip()
    # Sanitize bogus JS toString leakage
    if new_title_str.lower() == "[object object]":
        new_title_str = ""

    files = _scan_chapter_files()
    match = next(((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Chapter not found")
    _, path, pos = match

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = story.get("chapters") or []

    # Ensure chapters_data is a list of dicts, and pad if necessary
    count = len(files)
    chapters_data = [_normalize_chapter_entry(c) for c in chapters_data]
    if len(chapters_data) < count:
        chapters_data.extend([{"title": "", "summary": ""}] * (count - len(chapters_data)))

    # Update title at position
    if pos < len(chapters_data):
        chapters_data[pos]["title"] = new_title_str
    else:
        # This case should ideally not happen if padding is correct
        chapters_data.append({"title": new_title_str, "summary": ""})


    story["chapters"] = chapters_data
    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to write story.json: {e}"})

    # Respond with updated descriptor
    # Get the summary for response
    summary_for_response = chapters_data[pos].get("summary") or ""
    return JSONResponse(status_code=200, content={
        "ok": True,
        "chapter": {"id": files[pos][0], "title": new_title_str or path.name, "filename": path.name, "summary": summary_for_response}
    })


@app.post("/api/chapters")
async def api_create_chapter(request: Request) -> JSONResponse:
    """Create a new chapter file at the end and update titles list.
    Body: {"title": str | None, "content": str | None}
    """
    active = get_active_project_dir()
    if not active:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No active project"})
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    title = str(payload.get("title", "")).strip() if isinstance(payload, dict) else ""
    content = payload.get("content") if isinstance(payload, dict) else None
    if content is None:
        content = ""

    # Determine next index and path
    files = _scan_chapter_files()
    next_idx = (files[-1][0] + 1) if files else 1
    filename = f"{next_idx:04d}.txt"
    chapters_dir = active / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    path = chapters_dir / filename
    try:
        path.write_text(str(content), encoding="utf-8")
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to write chapter file: {e}"})

    # Update story.json chapters array (append as last)
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = story.get("chapters") or []

    chapters_data = [_normalize_chapter_entry(c) for c in chapters_data]

    # Ensure chapters_data length aligns with existing files count before new chapter
    count_before = len(files)
    if len(chapters_data) < count_before:
        chapters_data.extend([{"title": "", "summary": ""}] * (count_before - len(chapters_data)))

    # Append new chapter entry with title and empty summary
    chapters_data.append({"title": title, "summary": ""})
    story["chapters"] = chapters_data

    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to update story.json: {e}"})

    return JSONResponse(status_code=200, content={
        "ok": True,
        "chapter": {"id": next_idx, "title": title or filename, "filename": filename, "summary": ""}
    })


def _normalize_chapter_entry(entry: Any) -> Dict[str, str]:
    """Ensures a chapter entry is a dict with 'title' and 'summary'.

    Additionally sanitizes the common bogus string "[object Object]" that can
    arrive from UI mishaps, treating it as empty so filename fallbacks apply.
    """

    def _sanitize_text(val: Any) -> str:
        s = str(val if val is not None else "").strip()
        # Treat JS's default object toString leak as empty
        if s.lower() == "[object object]":
            return ""
        return s

    if isinstance(entry, dict):
        return {
            "title": _sanitize_text(entry.get("title", "")),
            "summary": _sanitize_text(entry.get("summary", "")),
        }
    elif isinstance(entry, (str, int, float)):
        return {"title": _sanitize_text(entry), "summary": ""}
    return {"title": "", "summary": ""}


@app.put("/api/chapters/{chap_id}/content")
async def api_update_chapter_content(request: Request, chap_id: int = FastAPIPath(..., ge=0)) -> JSONResponse:
    """Persist chapter content to its file.
    Body: {"content": str}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    if not isinstance(payload, dict) or "content" not in payload:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "content is required"})
    new_content = str(payload.get("content", ""))

    files = _scan_chapter_files()
    match = next(((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Chapter not found")
    _, path, _ = match

    try:
        path.write_text(new_content, encoding="utf-8")
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to write chapter: {e}"})

    return JSONResponse(status_code=200, content={"ok": True})


# New endpoint: update chapter summary (restored after refactor)
@app.put("/api/chapters/{chap_id}/summary")
async def api_update_chapter_summary(request: Request, chap_id: int = FastAPIPath(..., ge=0)) -> JSONResponse:
    """Update the summary of a chapter in the active project's story.json.

    Body: {"summary": str}
    """
    active = get_active_project_dir()
    if not active:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No active project"})

    # Parse body
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    if not isinstance(payload, dict) or "summary" not in payload:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "summary is required"})
    new_summary = str(payload.get("summary", "")).strip()

    # Locate chapter by id
    files = _scan_chapter_files()
    match = next(((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Chapter not found")
    _, path, pos = match

    # Load and normalize story.json
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = story.get("chapters") or []
    chapters_data = [_normalize_chapter_entry(c) for c in chapters_data]

    # Ensure alignment with number of files
    count = len(files)
    if len(chapters_data) < count:
        chapters_data.extend([{"title": "", "summary": ""}] * (count - len(chapters_data)))

    # Update summary at position
    if pos < len(chapters_data):
        chapters_data[pos]["summary"] = new_summary
    else:
        chapters_data.append({"title": "", "summary": new_summary})

    story["chapters"] = chapters_data
    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to write story.json: {e}"})

    title_for_response = chapters_data[pos].get("title") or path.name
    return JSONResponse(status_code=200, content={
        "ok": True,
        "chapter": {"id": files[pos][0], "title": title_for_response, "filename": path.name, "summary": new_summary},
    })


# ==============================
# Story LLM endpoints (summary, write, continue)
# ==============================

def _resolve_openai_credentials(payload: Dict[str, Any]) -> tuple[str, str | None, str, int]:
    """Resolve base_url, api_key, model_id, timeout_s from machine config or overrides.

    The payload may include:
      - model_name: select by configured name in machine.openai.models
      - base_url, api_key, model, timeout_s: direct overrides
    """
    import os
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}

    selected_name = payload.get("model_name") or openai_cfg.get("selected")
    base_url = payload.get("base_url")
    api_key = payload.get("api_key")
    model_id = payload.get("model")
    timeout_s = payload.get("timeout_s")

    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    if isinstance(models, list) and models:
        chosen = None
        if selected_name:
            for m in models:
                if isinstance(m, dict) and (m.get("name") == selected_name):
                    chosen = m
                    break
        if chosen is None:
            chosen = models[0]
        base_url = chosen.get("base_url") or base_url
        api_key = chosen.get("api_key") or api_key
        model_id = chosen.get("model") or model_id
        timeout_s = chosen.get("timeout_s", 60) or timeout_s
    else:
        # Fall back to legacy single-model fields from config
        base_url = base_url or openai_cfg.get("base_url")
        api_key = api_key or openai_cfg.get("api_key")
        model_id = model_id or openai_cfg.get("model")
        timeout_s = timeout_s or openai_cfg.get("timeout_s", 60)

    # Environment variable overrides always win
    env_base = os.getenv("OPENAI_BASE_URL")
    env_key = os.getenv("OPENAI_API_KEY")
    if env_base:
        base_url = env_base
    if env_key:
        api_key = env_key

    if not base_url or not model_id:
        raise HTTPException(status_code=400, detail="Missing base_url or model in configuration")

    try:
        ts = int(timeout_s or 60)
    except Exception:
        ts = 60
    return str(base_url), (str(api_key) if api_key else None), str(model_id), ts


async def _openai_chat_complete(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    extra_body: dict | None = None,
) -> dict:
    # Pull llm prefs
    story = load_story_config((get_active_project_dir() or CONFIG_DIR) / "story.json") or {}
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = prefs.get("temperature", 0.7)
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens")

    url = str(base_url).rstrip("/") + "/chat/completions"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body: Dict[str, Any] = {"model": model_id, "messages": messages, "temperature": temperature}
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    if extra_body:
        # Shallow merge of extra fields (e.g., tools, tool_choice)
        for k, v in extra_body.items():
            body[k] = v

    try:
        timeout_obj = httpx.Timeout(float(timeout_s or 60))
    except Exception:
        timeout_obj = httpx.Timeout(60.0)

    def _llm_debug_enabled() -> bool:
        env = os.getenv("AUGQ_DEBUG_LLM", "").strip()
        if env and env not in ("0", "false", "False"):
            return True
        try:
            machine_cfg = load_machine_config(CONFIG_DIR / "machine.json") or {}
            openai_cfg = (machine_cfg.get("openai") or {}) if isinstance(machine_cfg, dict) else {}
            return bool(openai_cfg.get("debug_llm"))
        except Exception:
            return False

    async with httpx.AsyncClient(timeout=timeout_obj) as client:
        if _llm_debug_enabled():
            try:
                print("AUGQ DEBUG LLM → POST", url)
                print("Headers:", headers)
                print("Body:", _json.dumps(body, indent=2))
            except Exception:
                pass
        resp = await client.post(url, headers=headers, json=body)
        try:
            data = resp.json()
        except Exception:
            data = {"raw": resp.text}
        if _llm_debug_enabled():
            try:
                print("AUGQ DEBUG LLM ← Status:", resp.status_code)
                print("Response Text:", resp.text)
            except Exception:
                pass
        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code, detail=data)
        return data


def _chapter_by_id_or_404(chap_id: int) -> tuple[Path, int, int]:
    files = _scan_chapter_files()
    match = next(((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return match  # (idx, path, pos)


# ============================
# Project knowledge helpers
# ============================
def _project_overview() -> dict:
    """Return project title and a list of chapters with id, filename, title, summary."""
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else (CONFIG_DIR / "story.json")) or {}
    chapters_meta = [_normalize_chapter_entry(c) for c in (story.get("chapters") or [])]
    files = _scan_chapter_files()
    out: list[dict] = []
    for idx, path in files:
        # Position in story.json may be different than numeric filename; map by ordering
        # We use enumeration order from _scan_chapter_files as position
        pos = next((i for i, (cid, _) in enumerate(files) if cid == idx), None)
        title = None
        summary = ""
        if isinstance(pos, int) and pos < len(chapters_meta):
            title = chapters_meta[pos].get("title")
            summary = chapters_meta[pos].get("summary") or ""
        # Fallback for bogus title values
        if not title or str(title).strip() in ("[object Object]", "object Object"):
            title = path.name
        out.append({
            "id": idx,
            "filename": path.name,
            "title": title,
            "summary": summary,
        })
    return {
        "project_title": story.get("project_title") or (active.name if active else ""),
        "chapters": out,
    }


def _chapter_content_slice(chap_id: int, start: int = 0, max_chars: int = 8000) -> dict:
    """Return a safe slice of chapter content with metadata."""
    if start < 0:
        start = 0
    if max_chars <= 0:
        max_chars = 1
    _, path, _pos = _chapter_by_id_or_404(chap_id)
    text = path.read_text(encoding="utf-8")
    total = len(text)
    end = min(total, start + max_chars)
    return {"id": chap_id, "start": start, "end": end, "total": total, "content": text[start:end]}


# ============================
# Story action helpers (reused by endpoints and chat tools)
# ============================
async def _story_generate_summary_helper(*, chap_id: int, mode: str = "") -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")

    _, path, pos = _chapter_by_id_or_404(chap_id)
    try:
        chapter_text = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        chapters_data.extend([{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1))
    current_summary = chapters_data[pos].get("summary", "")

    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials({})

    sys_msg = {
        "role": "system",
        "content": (
            "You are an expert story editor. Write a concise summary capturing plot, characters, tone, and open threads."
        ),
    }
    mode_l = (mode or "").lower()
    if mode_l == "discard" or not current_summary:
        user_prompt = f"Chapter text:\n\n{chapter_text}\n\nTask: Write a new summary (5-10 sentences)."
    else:
        user_prompt = (
            "Existing summary:\n\n" + current_summary +
            "\n\nChapter text:\n\n" + chapter_text +
            "\n\nTask: Update the summary to accurately reflect the chapter, keeping style and brevity."
        )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    data = await _openai_chat_complete(messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s)
    choices = (data or {}).get("choices") or []
    new_summary = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            new_summary = msg.get("content", "") or ""

    chapters_data[pos]["summary"] = new_summary
    story["chapters"] = chapters_data
    story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    title_for_response = chapters_data[pos].get("title") or path.name
    return {"ok": True, "summary": new_summary, "chapter": {"id": chap_id, "title": title_for_response, "filename": path.name, "summary": new_summary}}


async def _story_write_helper(*, chap_id: int) -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = _chapter_by_id_or_404(chap_id)
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        chapters_data.extend([{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1))
    summary = chapters_data[pos].get("summary", "")

    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials({})
    sys_msg = {"role": "system", "content": "You are a skilled novelist. Write compelling, coherent prose in the voice and style of the project."}
    user_prompt = ("Project title: " + (story.get("project_title") or "") +
                   "\n\nChapter summary:\n" + summary +
                   "\n\nTask: Write the full chapter as markdown. Keep consistency with previous chapters if implied.")
    data = await _openai_chat_complete(messages=[sys_msg, {"role": "user", "content": user_prompt}], base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s)
    choices = (data or {}).get("choices") or []
    content = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            content = msg.get("content", "") or ""
    path.write_text(content, encoding="utf-8")
    return {"ok": True, "content": content, "chapter": {"id": idx, "filename": path.name}}


async def _story_continue_helper(*, chap_id: int) -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = _chapter_by_id_or_404(chap_id)
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        chapters_data.extend([{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1))
    summary = chapters_data[pos].get("summary", "")
    current = path.read_text(encoding="utf-8") if path.exists() else ""

    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials({})
    sys_msg = {"role": "system", "content": "You are a helpful writing assistant. Continue the chapter, matching tone, characters, and style."}
    user_prompt = ("Chapter summary:\n" + summary +
                   "\n\nExisting chapter text (may be partial):\n" + current +
                   "\n\nTask: Continue the chapter. Avoid repeating text; ensure transitions are smooth.")
    data = await _openai_chat_complete(messages=[sys_msg, {"role": "user", "content": user_prompt}], base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s)
    choices = (data or {}).get("choices") or []
    add = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            add = msg.get("content", "") or ""
    new_content = (current + ("\n\n" if current and not current.endswith("\n\n") else "") + add).strip("\n") + "\n"
    path.write_text(new_content, encoding="utf-8")
    return {"ok": True, "appended": add, "chapter": {"id": idx, "filename": path.name}}


@app.post("/api/story/summary")
async def api_story_summary(request: Request) -> JSONResponse:
    """Generate or update a chapter summary using the story model.

    Body JSON:
      {"chap_id": int, "mode": "discard"|"update"|None, "model_name": str | None,
       // optional overrides: base_url, api_key, model, timeout_s}
    Returns: {ok: true, summary: str, chapter: {...}}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "chap_id is required"})
    mode = (payload.get("mode") or "").lower()
    if mode not in ("discard", "update", ""):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "mode must be discard|update"})

    _, path, pos = _chapter_by_id_or_404(chap_id)
    try:
        chapter_text = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No active project"})
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        chapters_data.extend([{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1))
    current_summary = chapters_data[pos].get("summary", "")

    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    # Build messages
    sys_msg = {
        "role": "system",
        "content": (
            "You are an expert story editor. Write a concise summary capturing plot, characters, tone, and open threads."
        ),
    }
    if mode == "discard" or not current_summary:
        user_prompt = f"Chapter text:\n\n{chapter_text}\n\nTask: Write a new summary (5-10 sentences)."
    else:
        user_prompt = (
            "Existing summary:\n\n" + current_summary +
            "\n\nChapter text:\n\n" + chapter_text +
            "\n\nTask: Update the summary to accurately reflect the chapter, keeping style and brevity."
        )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    try:
        data = await _openai_chat_complete(
            messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s
        )
    except HTTPException as e:
        return JSONResponse(status_code=e.status_code, content={"ok": False, "detail": e.detail})

    # Extract content OpenAI-style
    choices = (data or {}).get("choices") or []
    new_summary = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            new_summary = msg.get("content", "") or ""

    # Persist to story.json
    chapters_data[pos]["summary"] = new_summary
    story["chapters"] = chapters_data
    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to write story.json: {e}"})

    title_for_response = chapters_data[pos].get("title") or path.name
    return JSONResponse(status_code=200, content={
        "ok": True,
        "summary": new_summary,
        "chapter": {"id": chap_id, "title": title_for_response, "filename": path.name, "summary": new_summary},
    })


@app.post("/api/story/write")
async def api_story_write(request: Request) -> JSONResponse:
    """Write/overwrite the full chapter from its summary using the story model.

    Body JSON: {"chap_id": int, "model_name": str | None, overrides...}
    Returns: {ok: true, content: str}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "chap_id is required"})

    idx, path, pos = _chapter_by_id_or_404(chap_id)
    active = get_active_project_dir()
    if not active:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No active project"})
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No summary available for this chapter"})
    summary = chapters_data[pos].get("summary", "").strip()
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    sys_msg = {"role": "system", "content": "You are a skilled novelist writing compelling prose based on a summary."}
    user_prompt = (
        f"Project: {story.get('project_title', 'Story')}\nTitle: {title}\n\nSummary:\n\n{summary}\n\n" 
        "Task: Write the full chapter as continuous prose. Maintain voice and pacing."
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    try:
        data = await _openai_chat_complete(
            messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s
        )
    except HTTPException as e:
        return JSONResponse(status_code=e.status_code, content={"ok": False, "detail": e.detail})

    choices = (data or {}).get("choices") or []
    content = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            content = msg.get("content", "") or ""

    try:
        path.write_text(content, encoding="utf-8")
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to write chapter: {e}"})

    return JSONResponse(status_code=200, content={"ok": True, "content": content})


@app.post("/api/story/continue")
async def api_story_continue(request: Request) -> JSONResponse:
    """Continue the current chapter without modifying existing text, to align with the summary.

    Body JSON: {"chap_id": int, "model_name": str | None, overrides...}
    Returns: {ok: true, appended: str, content: str}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "chap_id is required"})

    idx, path, pos = _chapter_by_id_or_404(chap_id)
    try:
        existing = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No active project"})
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No summary available for this chapter"})
    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    sys_msg = {"role": "system", "content": "You are a skilled novelist continuing a chapter. Do not repeat or edit existing text; only continue."}
    user_prompt = (
        f"Title: {title}\n\nSummary:\n{summary}\n\nExisting chapter text (do not change):\n\n{existing}\n\n" 
        "Task: Continue the chapter from where it stops to advance the summary coherently."
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    try:
        data = await _openai_chat_complete(
            messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s
        )
    except HTTPException as e:
        return JSONResponse(status_code=e.status_code, content={"ok": False, "detail": e.detail})

    choices = (data or {}).get("choices") or []
    appended = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            appended = msg.get("content", "") or ""

    new_content = existing + ("\n" if existing and not existing.endswith("\n") else "") + appended
    try:
        path.write_text(new_content, encoding="utf-8")
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to write chapter: {e}"})

    return JSONResponse(status_code=200, content={"ok": True, "appended": appended, "content": new_content})




# --- Proxy endpoint for OpenAI model listing (fallback when CORS blocks browser) ---
@app.post("/api/openai/models")
async def proxy_list_models(request: Request) -> JSONResponse:
    """Fetch `${base_url}/models` using provided credentials.

    Body JSON:
      {"base_url": str, "api_key": str | None, "timeout_s": int | None}

    Returns the JSON payload from the upstream (expected to include a `data` array).
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    base_url = (payload or {}).get("base_url") or ""
    api_key = (payload or {}).get("api_key") or ""
    timeout_s = (payload or {}).get("timeout_s") or 60

    if not isinstance(base_url, str) or not base_url:
        raise HTTPException(status_code=400, detail="base_url is required")

    url = base_url.rstrip("/") + "/models"
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(float(timeout_s))) as client:
            resp = await client.get(url, headers=headers)
            # Relay status code if not 2xx
            content = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"raw": resp.text}
            if resp.status_code >= 400:
                return JSONResponse(status_code=resp.status_code, content={"error": "Upstream error", "status": resp.status_code, "data": content})
            return JSONResponse(status_code=200, content=content)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {e}")


# --- Chat API (OpenAI-compatible) ---
@app.get("/api/chat")
async def api_get_chat() -> dict:
    """Return initial state for chat view: models and current selection."""
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg = (machine.get("openai") or {}) if isinstance(machine, dict) else {}
    models_list = openai_cfg.get("models") if isinstance(openai_cfg, dict) else []

    model_names = []
    if isinstance(models_list, list):
        model_names = [
            m.get("name") for m in models_list if isinstance(m, dict) and m.get("name")
        ]

    # If no named models configured, but legacy single model fields exist,
    # surface a synthetic default entry so the UI has a selectable option.
    if not model_names:
        legacy_model = openai_cfg.get("model")
        legacy_base = openai_cfg.get("base_url")
        if legacy_model or legacy_base:
            model_names = ["default"]

    selected = openai_cfg.get("selected", "") if isinstance(openai_cfg, dict) else ""
    # Coerce to a valid selection
    if model_names:
        if not selected:
            selected = model_names[0]
        elif selected not in model_names:
            selected = model_names[0]

    return {
        "models": model_names,
        "current_model": selected,
        "messages": [],  # History is client-managed; this is a placeholder.
    }


@app.post("/api/chat")
async def api_chat(request: Request) -> JSONResponse:
    """Chat with the configured OpenAI-compatible model.

    Body JSON:
      {
        "model_name": "name-of-configured-entry" | null,
        "messages": [{"role": "system|user|assistant", "content": str}, ...],
        // optional overrides (otherwise pulled from config/machine.json)
        "base_url": str,
        "api_key": str,
        "model": str,
        "timeout_s": int
      }

    Returns: { ok: true, message: {role:"assistant", content: str}, usage?: {...} }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    def _normalize_chat_messages(val: Any) -> list[dict]:
        """Preserve OpenAI message fields including tool calls.

        Keeps: role, content (may be None), name, tool_call_id, tool_calls.
        """
        arr = val if isinstance(val, list) else []
        out: list[dict] = []
        for m in arr:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role", "")).strip().lower() or "user"
            msg: dict = {"role": role}
            # content can be None (e.g., assistant with tool_calls)
            if "content" in m:
                c = m.get("content")
                msg["content"] = (None if c is None else str(c))
            # pass-through optional tool fields
            name = m.get("name")
            if isinstance(name, str) and name:
                msg["name"] = name
            tcid = m.get("tool_call_id")
            if isinstance(tcid, str) and tcid:
                msg["tool_call_id"] = tcid
            tcs = m.get("tool_calls")
            if isinstance(tcs, list) and tcs:
                msg["tool_calls"] = tcs
            out.append(msg)
        return out

    req_messages = _normalize_chat_messages((payload or {}).get("messages"))
    if not req_messages:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "messages array is required"})

    # Load machine config and pick selected model
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}
    selected_name = (payload or {}).get("model_name") or openai_cfg.get("selected")

    base_url = (payload or {}).get("base_url")
    api_key = (payload or {}).get("api_key")
    model_id = (payload or {}).get("model")
    timeout_s = (payload or {}).get("timeout_s")

    # If models list exists and a name is provided or selected, use it
    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    if isinstance(models, list) and models:
        chosen = None
        if selected_name:
            for m in models:
                if isinstance(m, dict) and (m.get("name") == selected_name):
                    chosen = m
                    break
        if chosen is None:
            chosen = models[0]
        base_url = chosen.get("base_url") or base_url
        api_key = chosen.get("api_key") or api_key
        model_id = chosen.get("model") or model_id
        timeout_s = chosen.get("timeout_s", 60) or timeout_s

    if not base_url or not model_id:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "Missing base_url or model in configuration"})

    url = str(base_url).rstrip("/") + "/chat/completions"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Pull llm preferences for sensible defaults
    story = load_story_config((get_active_project_dir() or CONFIG_DIR) / "story.json") or {}
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = float(prefs.get("temperature", 0.7)) if isinstance(prefs.get("temperature", 0.7), (int, float, str)) else 0.7
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens", None)

    body: Dict[str, Any] = {
        "model": model_id,
        "messages": req_messages,
        "temperature": temperature,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    # Pass through OpenAI tool-calling fields if provided
    # Always include the available tools for the model to use.
    body["tools"] = STORY_TOOLS
    tool_choice = (payload or {}).get("tool_choice")
    if tool_choice:
        body["tool_choice"] = tool_choice
    else:
        body["tool_choice"] = "auto"

    # Backward-compat with legacy function calling (OpenAI functions API)
    # Some providers only recognize `functions` and `function_call`.
    # If tools of type function are provided, mirror them into `functions`.
    try:
        current_tools = body.get("tools")
        if isinstance(current_tools, list) and current_tools:
            functions: list[dict] = []
            for t in current_tools:
                if isinstance(t, dict) and t.get("type") == "function":
                    fn = t.get("function") or {}
                    name = fn.get("name")
                    if isinstance(name, str) and name:
                        # Keep only legacy-compatible fields
                        fdef = {
                            "name": name,
                        }
                        desc = fn.get("description")
                        if isinstance(desc, str) and desc:
                            fdef["description"] = desc
                        params = fn.get("parameters")
                        if isinstance(params, dict):
                            fdef["parameters"] = params
                        functions.append(fdef)
            if functions:
                body["functions"] = functions
                # Map tool_choice to function_call where meaningful
                fc = None
                current_tool_choice = body.get("tool_choice")
                if isinstance(current_tool_choice, str):
                    if current_tool_choice in ("auto", "none"):
                        fc = current_tool_choice
                elif isinstance(current_tool_choice, dict):
                    # {"type":"function","function":{"name":"..."}}
                    if current_tool_choice.get("type") == "function":
                        fn2 = (current_tool_choice.get("function") or {})
                        name2 = fn2.get("name")
                        if isinstance(name2, str) and name2:
                            fc = {"name": name2}
                if fc is None:
                    # default to auto if tools provided
                    fc = "auto"
                body["function_call"] = fc
    except Exception:
        # If anything goes wrong, we silently ignore and proceed with modern tools fields
        pass

    try:
        timeout_obj = httpx.Timeout(float(timeout_s or 60))
    except Exception:
        timeout_obj = httpx.Timeout(60.0)

    def _llm_debug_enabled() -> bool:
        env = os.getenv("AUGQ_DEBUG_LLM", "").strip()
        if env and env not in ("0", "false", "False"):
            return True
        try:
            machine_cfg = load_machine_config(CONFIG_DIR / "machine.json") or {}
            openai_cfg = (machine_cfg.get("openai") or {}) if isinstance(machine_cfg, dict) else {}
            return bool(openai_cfg.get("debug_llm"))
        except Exception:
            return False

    try:
        async with httpx.AsyncClient(timeout=timeout_obj) as client:
            mutations = {"story_changed": False}
            # Limit tool call loops to prevent infinite cycles
            for _ in range(5):
                if _llm_debug_enabled():
                    try:
                        print("AUGQ DEBUG LLM → POST", url)
                        print("Headers:", headers)
                        print("Body:", _json.dumps(body, indent=2))
                    except Exception:
                        pass
                resp = await client.post(url, headers=headers, json=body)
                # Try to parse JSON regardless of status
                data = None
                try:
                    data = resp.json()
                except Exception:
                    data = {"raw": resp.text}

                if _llm_debug_enabled():
                    try:
                        print("AUGQ DEBUG LLM ← Status:", resp.status_code)
                        print("Response Text:", resp.text)
                    except Exception:
                        pass
                if resp.status_code >= 400:
                    return JSONResponse(status_code=resp.status_code, content={"ok": False, "detail": data})

                choices = (data or {}).get("choices") or []
                if not choices:
                    return JSONResponse(status_code=500, content={"ok": False, "detail": "LLM returned no choices"})

                message = choices[0].get("message")
                if not isinstance(message, dict):
                    return JSONResponse(status_code=500, content={"ok": False, "detail": "Invalid message format from LLM"})

                # Append assistant's response to messages
                req_messages.append(message)
                body["messages"] = req_messages

                # Decide if we need to call tools
                tool_calls = message.get("tool_calls")
                # Also handle legacy function_call
                if not tool_calls and isinstance(message.get("function_call"), dict):
                    fn_call = message["function_call"]
                    if isinstance(fn_call.get("name"), str):
                        name = fn_call.get("name")
                        args = fn_call.get("arguments", "{}")
                        if not isinstance(args, str):
                            try:
                                args = _json.dumps(args or "{}")
                            except Exception:
                                args = "{}"
                        tool_calls = [{"id": f"call_{name}", "type": "function", "function": {"name": name, "arguments": args}}]

                if not tool_calls or not isinstance(tool_calls, list):
                    # No tool calls, we are done. Return the last message.
                    usage = (data or {}).get("usage")
                    # Clean up response message for client
                    final_msg = {"role": "assistant", "content": message.get("content", "") or ""}
                    return JSONResponse(status_code=200, content={"ok": True, "message": final_msg, "usage": usage, "mutations": mutations})

                # We have tool calls, execute them
                tool_messages = []
                for call in tool_calls:
                    if not (isinstance(call, dict) and call.get("type") == "function"): continue
                    call_id = str(call.get("id") or "")
                    func = call.get("function") or {}
                    name = (func.get("name") if isinstance(func, dict) else "") or ""
                    args_raw = (func.get("arguments") if isinstance(func, dict) else "") or "{}"
                    try:
                        args_obj = _json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
                    except Exception:
                        args_obj = {}
                    if not name or not call_id: continue

                    tool_result_msg = await _exec_chat_tool(name, args_obj, call_id, payload, mutations)
                    tool_messages.append(tool_result_msg)

                req_messages.extend(tool_messages)
                body["messages"] = req_messages

            # If loop finishes (e.g. too many tool calls), return an error
            return JSONResponse(status_code=500, content={"ok": False, "detail": "Exceeded maximum tool call attempts"})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Chat request failed: {e}")


# ==================================
# Chat with Tools (function-calling)
# ==================================

STORY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_project_overview",
            "description": "Get project title and a list of all chapters with their IDs, filenames, titles, and summaries.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_chapter_content",
            "description": "Get a slice of a chapter's content. If 'chap_id' is omitted, the application will attempt to use the currently active chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {"type": "integer", "description": "The ID of the chapter to read."},
                    "start": {"type": "integer", "description": "The starting character index. Default 0."},
                    "max_chars": {"type": "integer", "description": "Max characters to read. Default 8000, max 8000."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_summary",
            "description": "Generate and save a new summary for a chapter, or update its existing summary. This is a destructive action.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {"type": "integer", "description": "The ID of the chapter to summarize."},
                    "mode": {
                        "type": "string",
                        "description": "If 'discard', generate a new summary from scratch. If 'update' or empty, refine the existing one.",
                        "enum": ["discard", "update"],
                    },
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_chapter",
            "description": "Write the entire content of a chapter from its summary. This overwrites any existing content.",
            "parameters": {
                "type": "object",
                "properties": {"chap_id": {"type": "integer", "description": "The ID of the chapter to write."}},
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "continue_chapter",
            "description": "Append new content to a chapter, continuing from where it left off. This does not modify existing text.",
            "parameters": {
                "type": "object",
                "properties": {"chap_id": {"type": "integer", "description": "The ID of the chapter to continue."}},
                "required": ["chap_id"],
            },
        },
    },
]


async def _exec_chat_tool(name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict) -> dict:
    """Helper to execute a single tool call."""
    try:
        if name == "get_project_overview":
            data = _project_overview()
            return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps(data)}
        if name == "get_chapter_content":
            chap_id = args_obj.get("chap_id")
            if chap_id is None:
                ac = payload.get("active_chapter_id")
                if isinstance(ac, int):
                    chap_id = ac
            if not isinstance(chap_id, int):
                return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": "chap_id is required"})}
            start = int(args_obj.get("start", 0) or 0)
            max_chars = int(args_obj.get("max_chars", 8000) or 8000)
            max_chars = max(1, min(8000, max_chars))
            data = _chapter_content_slice(chap_id, start=start, max_chars=max_chars)
            return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps(data)}
        if name == "write_summary":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": "chap_id is required"})}
            mode = str(args_obj.get("mode", "")).lower()
            data = await _story_generate_summary_helper(chap_id=chap_id, mode=mode)
            mutations["story_changed"] = True
            return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps(data)}
        if name == "write_chapter":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": "chap_id is required"})}
            data = await _story_write_helper(chap_id=chap_id)
            mutations["story_changed"] = True
            return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps(data)}
        if name == "continue_chapter":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": "chap_id is required"})}
            data = await _story_continue_helper(chap_id=chap_id)
            mutations["story_changed"] = True
            return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps(data)}
        return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": f"Unknown tool: {name}"})}
    except HTTPException as e:
        return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": f"Tool failed: {e.detail}"})}
    except Exception as e:
        return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": f"Tool failed with unexpected error: {e}"})}


@app.post("/api/chat/tools")
async def api_chat_tools(request: Request) -> JSONResponse:
    """Execute OpenAI-style tool calls and return tool messages.

    The endpoint does not call the upstream LLM; it only executes provided tool_calls
    from the last assistant message and returns corresponding {role:"tool"} messages.

    Body JSON:
      {
        "model_name": str | null,
        "messages": [
          {"role":"user|assistant|system|tool", "content": str, "tool_calls"?: [{"id":str, "type":"function", "function": {"name": str, "arguments": str}}], "tool_call_id"?: str, "name"?: str}
        ],
        "active_chapter_id"?: int
      }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    messages = payload.get("messages") or []
    if not isinstance(messages, list):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "messages must be an array"})

    last = messages[-1] if messages else None
    tool_calls: list = []
    if isinstance(last, dict):
        t = last.get("tool_calls")
        if isinstance(t, list):
            tool_calls = t

    appended: list[dict] = []
    mutations = {"story_changed": False}

    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        call_id = str(call.get("id") or "")
        func = call.get("function") or {}
        name = (func.get("name") if isinstance(func, dict) else None) or ""
        args_raw = (func.get("arguments") if isinstance(func, dict) else None) or "{}"
        try:
            args_obj = _json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
        except Exception:
            args_obj = {}
        if not name or not call_id:
            continue
        msg = await _exec_chat_tool(name, args_obj, call_id, payload, mutations)
        appended.append(msg)

    return JSONResponse(status_code=200, content={"ok": True, "appended_messages": appended, "mutations": mutations})


# ==============================
# Streaming LLM support (OpenAI SSE)
# ==============================

async def _openai_chat_complete_stream(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
):
    """Async generator yielding content chunks from OpenAI-compatible SSE stream.

    Yields raw text deltas as they arrive. Stops on [DONE].
    """
    # Pull llm prefs
    story = load_story_config((get_active_project_dir() or CONFIG_DIR) / "story.json") or {}
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = prefs.get("temperature", 0.7)
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens")

    url = str(base_url).rstrip("/") + "/chat/completions"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body: Dict[str, Any] = {"model": model_id, "messages": messages, "temperature": temperature, "stream": True}
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens

    try:
        timeout_obj = httpx.Timeout(float(timeout_s or 60))
    except Exception:
        timeout_obj = httpx.Timeout(60.0)

    try:
        async with httpx.AsyncClient(timeout=timeout_obj) as client:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code >= 400:
                    # try parse body
                    data = None
                    try:
                        data = await resp.aread()
                    except Exception:
                        pass
                    raise HTTPException(status_code=resp.status_code, detail=data.decode() if isinstance(data, (bytes, bytearray)) else "Upstream error")
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    # Expect lines like: "data: {json}"
                    if line.startswith("data: "):
                        payload = line[6:].strip()
                    else:
                        payload = line.strip()
                    if payload == "[DONE]":
                        break
                    try:
                        obj = _json.loads(payload)
                    except Exception:
                        # yield raw text if not JSON
                        yield payload
                        continue
                    try:
                        # OpenAI delta format
                        choices = obj.get("choices") or []
                        if choices:
                            delta = choices[0].get("delta") or {}
                            txt = delta.get("content")
                            if txt:
                                yield txt
                    except Exception:
                        pass
    except asyncio.CancelledError:
        # Propagate cancellation for caller to handle
        raise
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Stream request failed: {e}")


def _as_streaming_response(gen_factory, media_type: str = "text/plain"):
    return StreamingResponse(gen_factory(), media_type=media_type)


@app.post("/api/story/summary/stream")
async def api_story_summary_stream(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    mode = (payload.get("mode") or "").lower()
    if mode not in ("discard", "update", ""):
        raise HTTPException(status_code=400, detail="mode must be discard|update")

    _, path, pos = _chapter_by_id_or_404(chap_id)
    try:
        chapter_text = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        chapters_data.extend([{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1))
    current_summary = chapters_data[pos].get("summary", "")

    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    sys_msg = {"role": "system", "content": "You are an expert story editor. Write a concise summary capturing plot, characters, tone, and open threads."}
    if mode == "discard" or not current_summary:
        user_prompt = f"Chapter text:\n\n{chapter_text}\n\nTask: Write a new summary (5-10 sentences)."
    else:
        user_prompt = (
            "Existing summary:\n\n" + current_summary +
            "\n\nChapter text:\n\n" + chapter_text +
            "\n\nTask: Update the summary to accurately reflect the chapter, keeping style and brevity."
        )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    # We'll aggregate to persist at the end if not cancelled
    async def _gen():
        buf = []
        try:
            async for chunk in _openai_chat_complete_stream(messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s):
                buf.append(chunk)
                yield chunk
        except asyncio.CancelledError:
            # Do not persist on cancel
            return
        # Persist on normal completion
        try:
            new_summary = "".join(buf)
            chapters_data[pos]["summary"] = new_summary
            story["chapters"] = chapters_data
            story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
        except Exception:
            pass

    return _as_streaming_response(_gen)


@app.post("/api/story/write/stream")
async def api_story_write_stream(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = _chapter_by_id_or_404(chap_id)

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        raise HTTPException(status_code=400, detail="No summary available for this chapter")
    summary = chapters_data[pos].get("summary", "").strip()
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    sys_msg = {"role": "system", "content": "You are a skilled novelist writing compelling prose based on a summary."}
    user_prompt = (
        f"Project: {story.get('project_title', 'Story')}\nTitle: {title}\n\nSummary:\n\n{summary}\n\n"
        "Task: Write the full chapter as continuous prose. Maintain voice and pacing."
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    async def _gen():
        buf = []
        try:
            async for chunk in _openai_chat_complete_stream(messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s):
                buf.append(chunk)
                yield chunk
        except asyncio.CancelledError:
            return
        # Persist full overwrite on completion
        try:
            content = "".join(buf)
            path.write_text(content, encoding="utf-8")
        except Exception:
            pass

    return _as_streaming_response(_gen)


@app.post("/api/story/continue/stream")
async def api_story_continue_stream(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = _chapter_by_id_or_404(chap_id)

    try:
        existing = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        raise HTTPException(status_code=400, detail="No summary available for this chapter")
    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    sys_msg = {"role": "system", "content": "You are a skilled novelist continuing a chapter. Do not repeat or edit existing text; only continue."}
    user_prompt = (
        f"Title: {title}\n\nSummary:\n{summary}\n\nExisting chapter text (do not change):\n\n{existing}\n\n"
        "Task: Continue the chapter from where it stops to advance the summary coherently."
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    async def _gen():
        buf = []
        try:
            async for chunk in _openai_chat_complete_stream(messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s):
                buf.append(chunk)
                yield chunk
        except asyncio.CancelledError:
            return
        # Persist appended content on completion
        try:
            appended = "".join(buf)
            new_content = existing + ("\n" if existing and not existing.endswith("\n") else "") + appended
            path.write_text(new_content, encoding="utf-8")
        except Exception:
            pass

    return _as_streaming_response(_gen)
