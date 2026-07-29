# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the projects api manage ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import re
import shutil
import json
import base64
from uuid import uuid4
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError

from augmentedquill.services.exceptions import BadRequestError

from augmentedquill.core.config import load_story_config, save_story_config
from augmentedquill.services.projects.project_helpers import (
    normalize_story_for_frontend,
)
from augmentedquill.services.projects.projects import (
    change_project_type,
    create_new_book,
    create_project,
    delete_project,
    get_active_project_dir,
    list_projects,
    load_registry,
    select_project,
)
from augmentedquill.models.story import (
    BookMutationResponse,
    ProjectMutationResponse,
    ProjectSelectResponse,
    StoryPayload,
)

_BOOK_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_RESTORE_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def _safe_child_path(base_dir: Path, *parts: str) -> Path:
    """Return a safe child path.."""
    base_resolved = base_dir.resolve()
    candidate = base_resolved.joinpath(*parts).resolve()
    if not candidate.is_relative_to(base_resolved):
        raise BadRequestError("Invalid path component")
    return candidate


def _validate_book_id(book_id: str) -> str:
    """Validate book id."""
    if not _BOOK_ID_PATTERN.fullmatch(book_id or ""):
        raise BadRequestError("Invalid book_id")
    return book_id


def _validate_restore_id(restore_id: str) -> str:
    """Validate restore id."""
    if not _RESTORE_ID_PATTERN.fullmatch(restore_id or ""):
        raise BadRequestError("Invalid restore_id")
    return restore_id


def normalize_registry(reg: dict) -> dict:
    """Normalize registry."""
    cur = reg.get("current") or ""
    if cur:
        cur = Path(cur).name
    recent = [Path(p).name for p in reg.get("recent", []) if p]
    return {"current": cur, "recent": recent}


def projects_listing_payload() -> dict:
    """Projects Listing Payload."""
    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    available = list_projects()
    return {
        "current": normalized_reg["current"],
        "recent": normalized_reg["recent"][:5],
        "available": available,
    }


def delete_project_response(name: str) -> ProjectMutationResponse:
    """Delete Project Response."""
    ok, msg = delete_project(name)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)

    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    available = list_projects()
    return ProjectMutationResponse(
        ok=True,
        message=msg,
        registry={
            "current": normalized_reg["current"],
            "recent": normalized_reg["recent"],
            "available": available,
        },  # type: ignore[arg-type]
    )


def select_project_response(name: str) -> ProjectSelectResponse:
    """Select Project Response."""
    ok, msg = select_project(name)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)

    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    active = get_active_project_dir()
    try:
        story = load_story_config((active / "story.json") if active else None)
    except ValueError as e:
        error_msg = str(e)
        if "Invalid story config" in error_msg or "unknown version" in error_msg:
            return ProjectSelectResponse(
                ok=True,
                message=msg,
                registry={
                    "current": normalized_reg["current"],
                    "recent": normalized_reg["recent"],
                },  # type: ignore[arg-type]
                story=None,
                error="invalid_config",
                error_message=error_msg,
            )
        raise

    try:
        story_payload = StoryPayload(**normalize_story_for_frontend(story))
    except ValidationError as e:
        return ProjectSelectResponse(
            ok=True,
            message=msg,
            registry={
                "current": normalized_reg["current"],
                "recent": normalized_reg["recent"],
            },  # type: ignore[arg-type]
            story=None,
            error="invalid_config",
            error_message=(
                f"Story config does not match schema requirements: {e.errors()}"
            ),
        )

    return ProjectSelectResponse(
        ok=True,
        message=msg,
        registry={
            "current": normalized_reg["current"],
            "recent": normalized_reg["recent"],
        },  # type: ignore[arg-type]
        story=story_payload,
    )


def create_project_response(
    name: str, project_type: str, language: str = "en"
) -> ProjectMutationResponse:
    """Create Project Response."""
    ok, msg = create_project(name, project_type=project_type, language=language)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)

    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None)
    return ProjectMutationResponse(
        ok=True,
        message=msg,
        registry={
            "current": normalized_reg["current"],
            "recent": normalized_reg["recent"],
        },  # type: ignore[arg-type]
        story=StoryPayload(**normalize_story_for_frontend(story)),
    )


def convert_project_response(new_type: str) -> ProjectMutationResponse:
    """Convert Project Response."""
    if not new_type:
        raise BadRequestError("new_type is required")

    ok, msg = change_project_type(new_type)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)

    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None)
    return ProjectMutationResponse(
        ok=True,
        message=msg,
        story=StoryPayload(**normalize_story_for_frontend(story)),
    )


def create_book_response(title: str) -> BookMutationResponse:
    """Create Book Response."""
    if not title:
        raise BadRequestError("Book title is required")

    try:
        bid = create_new_book(title)
        active = get_active_project_dir()
        story = load_story_config((active / "story.json") if active else None)
        return BookMutationResponse(
            ok=True,
            message="Book created",
            book_id=bid,
            story=StoryPayload(**normalize_story_for_frontend(story)),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _deleted_books_dir(active: Path) -> Path:
    """Helper for books dir.."""
    path = active / ".aq_history" / "deleted_books"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _snapshot_book_for_restore(active: Path, story: dict, book_id: str) -> str:
    """Create a snapshot book for restore.."""
    safe_book_id = _validate_book_id(str(book_id))
    books = story.get("books", [])
    target_idx = next(
        (idx for idx, book in enumerate(books) if str(book.get("id")) == safe_book_id),
        -1,
    )
    if target_idx < 0:
        return ""

    target_book = books[target_idx]
    book_dir = _safe_child_path(active, "books", safe_book_id)
    files: dict[str, str] = {}
    if book_dir.exists():
        for file_path in book_dir.rglob("*"):
            if file_path.is_file():
                rel = str(file_path.relative_to(book_dir))
                files[rel] = base64.b64encode(file_path.read_bytes()).decode("ascii")

    restore_id = uuid4().hex
    snapshot = {
        "restore_id": restore_id,
        "book_id": safe_book_id,
        "book": target_book,
        "index": target_idx,
        "files": files,
    }
    _safe_child_path(_deleted_books_dir(active), f"{restore_id}.json").write_text(
        json.dumps(snapshot), encoding="utf-8"
    )
    return restore_id


def delete_book_response(book_id: str) -> BookMutationResponse:
    """Delete Book Response."""
    if not book_id:
        raise BadRequestError("book_id is required")
    book_id = _validate_book_id(book_id)

    active = get_active_project_dir()
    if not active:
        raise BadRequestError("No active project")

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    books = story.get("books", [])

    exists = any(str(b.get("id")) == book_id for b in books)
    if not exists:
        raise HTTPException(status_code=404, detail="Book not found")

    restore_id = _snapshot_book_for_restore(active, story, book_id)

    story["books"] = [b for b in books if str(b.get("id")) != str(book_id)]
    save_story_config(story_path, story)

    book_dir = _safe_child_path(active, "books", book_id)
    if book_dir.exists():
        shutil.rmtree(book_dir)

    return BookMutationResponse(
        ok=True,
        message="Book deleted",
        restore_id=restore_id,
        story=StoryPayload(**normalize_story_for_frontend(story)),
    )


def restore_book_response(restore_id: str) -> BookMutationResponse:
    """Restore a previously deleted book from a snapshot."""
    if not restore_id:
        raise BadRequestError("restore_id is required")
    restore_id = _validate_restore_id(restore_id)

    active = get_active_project_dir()
    if not active:
        raise BadRequestError("No active project")

    snapshot_path = _safe_child_path(_deleted_books_dir(active), f"{restore_id}.json")
    if not snapshot_path.exists():
        raise HTTPException(status_code=404, detail="Restore snapshot not found")

    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    book_id = str(snapshot.get("book_id") or "")
    book_data = snapshot.get("book") or {}
    insert_index = int(snapshot.get("index", 0))
    files: dict[str, str] = snapshot.get("files") or {}

    if not book_id or not isinstance(book_data, dict):
        raise HTTPException(status_code=400, detail="Invalid restore snapshot payload")

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    books = story.get("books") or []

    if any(str(book.get("id")) == book_id for book in books):
        raise HTTPException(status_code=409, detail="Book already exists")

    safe_index = max(0, min(insert_index, len(books)))
    books.insert(safe_index, book_data)
    story["books"] = books
    save_story_config(story_path, story)

    book_dir = _safe_child_path(active, "books", book_id)
    book_dir.mkdir(parents=True, exist_ok=True)
    for rel, encoded in files.items():
        target = (book_dir / rel).resolve()
        if not target.is_relative_to(book_dir.resolve()):
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(encoded.encode("ascii")))

    snapshot_path.unlink(missing_ok=True)

    return BookMutationResponse(
        ok=True,
        message="Book restored",
        book_id=book_id,
        story=StoryPayload(**normalize_story_for_frontend(story)),
    )
