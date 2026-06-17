# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the main unit so this responsibility stays isolated, testable, and easy to evolve.

Main application entry point for the AugmentedQuill API server.
Includes global configuration setup, error handling, and router registration.
"""

from __future__ import annotations

import argparse
from typing import Optional
import os

from fastapi import FastAPI, APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from augmentedquill.core.config import (
    load_machine_config,
    STATIC_DIR,
    ensure_runtime_user_config_files,
)
from augmentedquill.services.exceptions import ServiceError
from augmentedquill.services.chat.chat_tool_decorator import write_tools_json_tempfile
from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.models.machine import MachineConfigResponse

# Import API routers
from augmentedquill.api.v1.settings import router as settings_router  # noqa: E402
from augmentedquill.api.v1.projects import router as projects_router  # noqa: E402
from augmentedquill.api.v1.chapters import router as chapters_router  # noqa: E402
from augmentedquill.api.v1.story import router as story_router
from augmentedquill.api.v1.checkpoints import router as checkpoints_router  # noqa: E402
from augmentedquill.api.v1.chat import router as chat_router  # noqa: E402
from augmentedquill.api.v1.debug import router as debug_router  # noqa: E402
from augmentedquill.api.v1.sourcebook import router as sourcebook_router  # noqa: E402
from augmentedquill.api.v1.search import router as search_router  # noqa: E402
from augmentedquill.api.v1.scenes import router as scenes_router  # noqa: E402
from augmentedquill.api.v1.annotations import router as annotations_router  # noqa: E402


def create_app() -> FastAPI:
    """Create the FastAPI app.

    Uvicorn's reload mode requires an import string; using an app factory keeps
    route registration consistent across reload subprocesses.
    """

    app = FastAPI(title="AugmentedQuill")
    ensure_runtime_user_config_files()

    # Generate a temporary tools.json for any tooling that wants it.
    # This file is intentionally not checked in; it is regenerated on each run.
    app.state.tools_json_path = write_tools_json_tempfile()

    # Dynamic CORS origin handler to support variable ports
    async def get_origins(request: Request) -> list[str]:
        """Return origins."""
        origin = request.headers.get("origin")
        if not origin:
            return []

        # Allow localhost/127.0.0.1 on any port in development context
        # In a real production setup, one might restrict this further.
        if origin.startswith(("http://localhost:", "http://127.0.0.1:")) or origin in (
            "http://localhost",
            "http://127.0.0.1",
        ):
            return [origin]
        return []

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount static files if folder exists (created in repo)
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.middleware("http")
    async def _legacy_project_route_rewrite(request: Request, call_next):
        """Rewrite legacy unscoped project routes to project-scoped paths.

        This keeps backward compatibility while clients/tests migrate to
        `/api/v1/projects/{project_name}/...`.
        """

        path = request.scope.get("path", "")
        if not path.startswith("/api/v1/") or path.startswith("/api/v1/projects/"):
            return await call_next(request)

        suffix = path[len("/api/v1/") :]

        # Endpoints that remain globally scoped and must never be rewritten.
        global_prefixes = (
            "machine",
            "projects",
            "debug",
            "health",
        )
        if (
            suffix == "chat"
            or suffix == "openai/models"
            or suffix.startswith(global_prefixes)
        ):
            return await call_next(request)

        books_project_scoped = suffix.startswith("books/") and not suffix.startswith(
            ("books/create", "books/delete", "books/restore")
        )

        project_scoped_prefixes = (
            "chapters",
            "story",
            "sourcebook",
            "checkpoints",
            "search",
            "chat/",
            "chats",
        )
        if not (books_project_scoped or suffix.startswith(project_scoped_prefixes)):
            return await call_next(request)

        active = get_active_project_dir()
        if not active:
            return JSONResponse(
                status_code=400,
                content={"ok": False, "detail": "No active project selected"},
            )

        rewritten = f"/api/v1/projects/{active.name}/{suffix}"
        request.scope["path"] = rewritten
        request.scope["raw_path"] = rewritten.encode("utf-8")
        return await call_next(request)

    # Include API routers
    api_v1_router = APIRouter(prefix="/api/v1")
    api_v1_router.include_router(settings_router)
    api_v1_router.include_router(projects_router)
    api_v1_router.include_router(chapters_router)
    api_v1_router.include_router(story_router)
    api_v1_router.include_router(checkpoints_router)
    api_v1_router.include_router(chat_router)
    api_v1_router.include_router(debug_router)
    api_v1_router.include_router(sourcebook_router)
    api_v1_router.include_router(search_router)
    api_v1_router.include_router(scenes_router)
    api_v1_router.include_router(annotations_router)

    # JSON REST APIs to serve dynamic data to the frontend (no server-side injection in HTML)
    api_v1_router.add_api_route(
        "/health", endpoint=lambda: {"status": "ok"}, methods=["GET"]
    )

    @api_v1_router.get("/machine", response_model=MachineConfigResponse)
    async def _get_machine() -> MachineConfigResponse:
        """Return the current machine configuration."""
        cfg = load_machine_config() or {}
        return MachineConfigResponse(**cfg)

    app.include_router(api_v1_router)

    # Redirect root to the SPA entrypoint so `http://localhost:8000/` works.
    @app.get("/")
    async def _root_redirect() -> RedirectResponse:
        """Helper for redirect.."""
        return RedirectResponse(url="/static/dist/index.html")

    # --------------- global exception handler ---------------
    @app.exception_handler(ServiceError)
    async def _service_error_handler(
        _request: Request, exc: ServiceError
    ) -> JSONResponse:
        """Handle ServiceError exceptions and return a structured JSON response."""
        return JSONResponse(
            status_code=exc.status_code,
            content={"ok": False, "detail": exc.detail},
        )

    return app


app = create_app()


def build_arg_parser() -> argparse.ArgumentParser:
    """Build Arg Parser."""
    parser = argparse.ArgumentParser(
        prog="augmentedquill",
        description="Run the AugmentedQuill FastAPI server",
    )
    parser.add_argument(
        "--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)"
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="Port to bind (default: 8000)"
    )
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
    parser.add_argument(
        "--llm-dump",
        action="store_true",
        help="Dump raw LLM request/response data to a file",
    )
    parser.add_argument(
        "--llm-dump-path",
        default=None,
        help="Path for raw LLM dump file (overrides default)",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> None:
    """CLI entrypoint to run the server via a normal Python invocation.

    Examples:
      python -m augmentedquill.main --help
      python -m augmentedquill.main --host 0.0.0.0 --port 8000 --reload
    """
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.llm_dump:
        os.environ["AUGQ_LLM_DUMP"] = "1"
    if args.llm_dump_path:
        os.environ["AUGQ_LLM_DUMP_PATH"] = args.llm_dump_path

    # Import uvicorn lazily so that importing this module doesn't require it for tests/tools
    import uvicorn  # type: ignore

    # Prefer passing the in-process app instance to avoid re-import differences.
    # Uvicorn's reload/multi-worker modes require an import string.
    use_import_string = bool(args.reload) or (
        isinstance(args.workers, int) and args.workers > 1
    )
    if use_import_string:
        app_target = "augmentedquill.main:create_app"
        factory = True
    else:
        app_target = app
        factory = False

    uvicorn.run(
        app_target,
        host=args.host,
        port=args.port,
        reload=bool(args.reload) if args.workers in (None, 0) else False,
        workers=args.workers,
        log_level=args.log_level,
        factory=factory,
    )


if __name__ == "__main__":
    main()
