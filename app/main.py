from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request, HTTPException, Form
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import load_machine_config, load_story_config
from app.projects import (
    load_registry,
    select_project,
    get_active_project_dir,
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
    return {"status": "ok", "server_time": datetime.now().isoformat()}


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


@app.get("/health/fragment", response_class=HTMLResponse)
async def health_fragment() -> HTMLResponse:
    # Simple dynamic HTML snippet to demonstrate HTMX interaction
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return HTMLResponse(
        f'<div id="health">Status: <strong>ok</strong> • Server time: {now}</div>'
    )


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
    chapters_list = [line.strip() for line in chapters.splitlines() if line.strip()]

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
        "chapters": chapters_list,
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
        year = datetime.now().year
        # Preserve init fields as provided; backend validation error means nothing was saved
        return templates.TemplateResponse(
            "settings.html",
            {
                "request": request,
                "year": year,
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
    year = datetime.now().year
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
            "year": year,
            "machine": machine_cfg,
            "story": story_cfg,
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
        story_cfg = {
            "project_title": (story.get("project_title") or "Untitled Project"),
            "format": (story.get("format") or "markdown"),
            "chapters": [s for s in (story.get("chapters") or []) if isinstance(s, str) and s.strip()],
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
    # Validate that paths still exist; filter out missing
    cur = reg.get("current") or ""
    recent = [p for p in reg.get("recent", []) if p]
    return {"current": cur, "recent": recent[:5]}


@app.post("/api/projects/select")
async def api_projects_select(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    path = (payload or {}).get("path") or ""
    ok, msg = select_project(path)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})
    # On success, return current registry and the story that was loaded/created
    reg = _load_projects_registry()
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else (CONFIG_DIR / "story.json"))
    return JSONResponse(status_code=200, content={"ok": True, "message": msg, "registry": reg, "story": story})


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
