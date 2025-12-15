from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware

from app.config import load_machine_config, load_story_config
from app.projects import get_active_project_dir

# Import API routers
from app.api.settings import router as settings_router
from app.api.projects import router as projects_router
from app.api.chapters import router as chapters_router
from app.api.story import router as story_router
from app.api.chat import router as chat_router

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
CONFIG_DIR = BASE_DIR / "config"

app = FastAPI(title="AugmentedQuill")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files if folder exists (created in repo)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# Include API routers
app.include_router(settings_router)
app.include_router(projects_router)
app.include_router(chapters_router)
app.include_router(story_router)
app.include_router(chat_router)


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
