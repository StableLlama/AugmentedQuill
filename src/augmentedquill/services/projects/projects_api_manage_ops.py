# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the projects api manage ops unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

import re
import shutil
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import JSONResponse

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


def normalize_registry(reg: dict) -> dict:
    cur = reg.get("current") or ""
    if cur:
        cur = Path(cur).name
    recent = [Path(p).name for p in reg.get("recent", []) if p]
    return {"current": cur, "recent": recent}


def projects_listing_payload() -> dict:
    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    available = list_projects()
    return {
        "current": normalized_reg["current"],
        "recent": normalized_reg["recent"][:5],
        "available": available,
    }


def delete_project_response(name: str) -> JSONResponse:
    ok, msg = delete_project(name)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})

    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    available = list_projects()
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": msg,
            "registry": normalized_reg,
            "available": available,
        },
    )


def select_project_response(name: str) -> JSONResponse:
    ok, msg = select_project(name)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})

    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    active = get_active_project_dir()
    try:
        story = load_story_config((active / "story.json") if active else None)
    except ValueError as e:
        error_msg = str(e)
        if "outdated version" in error_msg:
            match = re.search(r"version (\d+).*Current version is (\d+)", error_msg)
            if match:
                current_version = int(match.group(1))
                required_version = int(match.group(2))
                return JSONResponse(
                    status_code=200,
                    content={
                        "ok": True,
                        "message": msg,
                        "registry": normalized_reg,
                        "story": None,
                        "error": "version_outdated",
                        "current_version": current_version,
                        "required_version": required_version,
                    },
                )
        elif "Invalid story config" in error_msg or "unknown version" in error_msg:
            return JSONResponse(
                status_code=200,
                content={
                    "ok": True,
                    "message": msg,
                    "registry": normalized_reg,
                    "story": None,
                    "error": "invalid_config",
                    "error_message": error_msg,
                },
            )
        raise

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": msg,
            "registry": normalized_reg,
            "story": normalize_story_for_frontend(story),
        },
    )


def create_project_response(name: str, project_type: str) -> JSONResponse:
    ok, msg = create_project(name, project_type=project_type)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})

    reg = load_registry()
    normalized_reg = normalize_registry(reg)
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None)
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": msg,
            "registry": normalized_reg,
            "story": normalize_story_for_frontend(story),
        },
    )


def convert_project_response(new_type: str) -> JSONResponse:
    if not new_type:
        raise HTTPException(status_code=400, detail="new_type is required")

    ok, msg = change_project_type(new_type)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})

    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None)
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": msg,
            "story": normalize_story_for_frontend(story),
        },
    )


def create_book_response(title: str) -> JSONResponse:
    if not title:
        raise HTTPException(status_code=400, detail="Book title is required")

    try:
        bid = create_new_book(title)
        active = get_active_project_dir()
        story = load_story_config((active / "story.json") if active else None)
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "message": "Book created",
                "book_id": bid,
                "story": normalize_story_for_frontend(story),
            },
        )
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "detail": str(e)})


def delete_book_response(book_id: str) -> JSONResponse:
    if not book_id:
        raise HTTPException(status_code=400, detail="book_id is required")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    books = story.get("books", [])

    exists = any(str(b.get("id")) == str(book_id) for b in books)
    if not exists:
        return JSONResponse(
            status_code=404, content={"ok": False, "detail": "Book not found"}
        )

    story["books"] = [b for b in books if str(b.get("id")) != str(book_id)]
    save_story_config(story_path, story)

    book_dir = active / "books" / book_id
    if book_dir.exists():
        shutil.rmtree(book_dir)

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": "Book deleted",
            "story": normalize_story_for_frontend(story),
        },
    )
