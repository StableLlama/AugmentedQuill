# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the project lifecycle ops unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Callable, Dict, List, Tuple

from augmentedquill.core.config import load_story_config, save_story_config


def delete_project_under_root(
    name: str,
    projects_root: Path,
    current_registry: Dict,
) -> Tuple[bool, str, str, List[str]]:
    if not name:
        return False, "Project name is required", "", []
    if (
        any(ch in name for ch in ("/", "\\"))
        or name.strip() != name
        or name in (".", "..")
    ):
        return False, "Invalid project name", "", []

    project_path = projects_root / name
    if not project_path.exists() or not project_path.is_dir():
        return False, "Project does not exist", "", []

    try:
        project_path.resolve().relative_to(projects_root.resolve())
    except Exception:
        return False, "Invalid project path", "", []

    shutil.rmtree(project_path)

    current = current_registry.get("current") or ""
    recent = [item for item in current_registry.get("recent", []) if item]

    try:
        current_name = Path(str(current)).name if current else ""
    except Exception:
        current_name = ""

    if current_name and current_name == name:
        current = ""

    filtered_recent: List[str] = []
    for item in recent:
        try:
            if Path(str(item)).name == name:
                continue
        except Exception:
            continue
        filtered_recent.append(str(item))

    return True, "Project deleted", current, filtered_recent


def validate_project_dir_data(path: Path) -> Tuple[bool, str]:
    if not path.exists():
        return False, "does_not_exist"
    if not path.is_dir():
        return False, "not_a_directory"

    entries = list(path.iterdir())
    if not entries:
        return False, "empty"

    story_path = path / "story.json"
    if not (story_path.exists() and story_path.is_file()):
        return False, "missing_story_json"

    try:
        story = json.loads(story_path.read_text(encoding="utf-8"))
    except Exception:
        return False, "invalid_story_json"

    project_type = story.get("project_type", "novel")

    if project_type == "short-story":
        return True, "ok"

    if project_type == "series":
        books_dir = path / "books"
        if books_dir.exists() and books_dir.is_dir():
            return True, "ok"
        return True, "ok_empty_books"

    chapters_dir = path / "chapters"
    if chapters_dir.exists() and chapters_dir.is_dir():
        has_txt_md = any(
            (file_path.suffix.lower() in (".txt", ".md"))
            for file_path in chapters_dir.glob("**/*")
            if file_path.is_file()
        )
        return True, "ok" if has_txt_md else "ok_empty_chapters"

    return True, "ok_no_chapters_dir"


def initialize_project_dir_data(
    path: Path,
    project_title: str,
    project_type: str,
    now_iso: str,
) -> None:
    path.mkdir(parents=True, exist_ok=True)
    story_path = path / "story.json"

    (path / "images").mkdir(parents=True, exist_ok=True)

    if not story_path.exists():
        payload = {
            "metadata": {"version": 2},
            "project_title": project_title,
            "project_type": project_type,
            "chapters": [],
            "books": [],
            "content_file": "content.md",
            "format": "markdown",
            "llm_prefs": {"temperature": 0.7, "max_tokens": 2048},
            "created_at": now_iso,
            "tags": [],
        }
        save_story_config(story_path, payload)

    if project_type == "short-story":
        content_path = path / "content.md"
        if not content_path.exists():
            content_path.write_text("", encoding="utf-8")
    elif project_type == "series":
        (path / "books").mkdir(parents=True, exist_ok=True)
    else:
        (path / "chapters").mkdir(parents=True, exist_ok=True)


def list_projects_under_root(
    projects_root: Path,
    validate_project_dir: Callable[[Path], object],
) -> List[Dict[str, str | bool]]:
    if not projects_root.exists():
        return []

    items: List[Dict[str, str | bool]] = []
    for directory in sorted(
        [item for item in projects_root.iterdir() if item.is_dir()]
    ):
        info = validate_project_dir(directory)
        title = directory.name
        project_type = "novel"

        if getattr(info, "is_valid", False):
            try:
                story = load_story_config(directory / "story.json")
                title = story.get("project_title") or directory.name
                project_type = story.get("project_type", "novel")
            except Exception:
                pass

        items.append(
            {
                "id": directory.name,
                "name": directory.name,
                "path": str(directory),
                "is_valid": getattr(info, "is_valid", False),
                "title": title,
                "type": project_type,
            }
        )

    return items


def create_project_under_root(
    name: str,
    project_type: str,
    projects_root: Path,
    initialize_project: Callable[[Path, str, str], None],
    validate_project: Callable[[Path], object],
) -> Tuple[bool, str, Path | None]:
    if not name:
        return False, "Project name is required", None
    if name.strip() != name or name in (".", ".."):
        return False, "Invalid project name", None

    safe_name = "".join(
        char if char.isalnum() or char in (" ", "-", "_") else "_" for char in name
    ).strip()
    if not safe_name:
        safe_name = "Untitled_Project"

    project_path = projects_root / safe_name

    if project_path.exists():
        counter = 1
        while (projects_root / f"{safe_name}_{counter}").exists():
            counter += 1
        project_path = projects_root / f"{safe_name}_{counter}"

    projects_root.mkdir(parents=True, exist_ok=True)
    initialize_project(project_path, name, project_type)

    if not getattr(validate_project(project_path), "is_valid", False):
        return False, "Failed to initialize project", None

    return True, f"Project created: {project_path.name}", project_path


def select_project_under_root(
    name: str,
    projects_root: Path,
    initialize_project: Callable[[Path, str, str], None],
    validate_project: Callable[[Path], object],
) -> Tuple[bool, str, Path | None]:
    if not name:
        return False, "Project name is required", None

    if (
        any(ch in name for ch in ("/", "\\"))
        or name.strip() != name
        or name in (".", "..")
    ):
        return False, "Invalid project name", None

    project_path = projects_root / name
    if not project_path.exists():
        projects_root.mkdir(parents=True, exist_ok=True)
        initialize_project(project_path, name, "novel")
        return True, f"Project created: {project_path.name}", project_path

    if project_path.is_dir():
        info = validate_project(project_path)
        if getattr(info, "is_valid", False):
            return True, "Project loaded", project_path
        if getattr(info, "reason", "") == "empty":
            initialize_project(project_path, name, "novel")
            return True, "Project created", project_path
        return False, "Selected path is not a valid project directory", None

    return False, "Selected path is not a directory", None
