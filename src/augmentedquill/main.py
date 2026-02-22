# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the main unit so this responsibility stays isolated, testable, and easy to evolve.

"""
Main application entry point for the AugmentedQuill API server.
Includes global configuration setup, error handling, and router registration.
"""

from __future__ import annotations

import argparse
from typing import Optional
import os

from fastapi import FastAPI, APIRouter
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from augmentedquill.core.config import load_machine_config, STATIC_DIR, CONFIG_DIR

# Import API routers
from augmentedquill.api.v1.settings import router as settings_router  # noqa: E402
from augmentedquill.api.v1.projects import router as projects_router  # noqa: E402
from augmentedquill.api.v1.chapters import router as chapters_router  # noqa: E402
from augmentedquill.api.v1.story import router as story_router  # noqa: E402
from augmentedquill.api.v1.chat import router as chat_router  # noqa: E402
from augmentedquill.api.v1.debug import router as debug_router  # noqa: E402
from augmentedquill.api.v1.sourcebook import router as sourcebook_router  # noqa: E402


def create_app() -> FastAPI:
    """Create the FastAPI app.

    Uvicorn's reload mode requires an import string; using an app factory keeps
    route registration consistent across reload subprocesses.
    """

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

    # Include API routers
    api_v1_router = APIRouter(prefix="/api/v1")
    api_v1_router.include_router(settings_router)
    api_v1_router.include_router(projects_router)
    api_v1_router.include_router(chapters_router)
    api_v1_router.include_router(story_router)
    api_v1_router.include_router(chat_router)
    api_v1_router.include_router(debug_router)
    api_v1_router.include_router(sourcebook_router)

    # JSON REST APIs to serve dynamic data to the frontend (no server-side injection in HTML)
    @api_v1_router.get("/health")
    async def api_health() -> dict:
        return {"status": "ok"}

    @api_v1_router.get("/machine")
    async def api_machine() -> dict:
        machine = load_machine_config(CONFIG_DIR / "machine.json")
        return machine or {}

    app.include_router(api_v1_router)

    return app


app = create_app()


def build_arg_parser() -> argparse.ArgumentParser:
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
