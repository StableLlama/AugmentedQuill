# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the projects unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple
import os

from augmentedquill.services.projects.project_story_ops import (
    update_book_metadata_in_project,
    read_book_content_in_project,
    write_book_content_in_project,
    update_story_metadata_in_project,
    read_story_content_in_project,
    write_story_content_in_project,
)
from augmentedquill.services.projects.project_structure_ops import (
    create_new_chapter_in_project,
    create_new_book_in_project,
    change_project_type_in_project,
)
from augmentedquill.services.projects.project_chapter_ops import (
    write_chapter_content_in_project,
    update_chapter_metadata_in_project,
    add_chapter_conflict_in_project,
    update_chapter_conflict_in_project,
    remove_chapter_conflict_in_project,
    reorder_chapter_conflicts_in_project,
    write_chapter_title_in_project,
    delete_chapter_in_project,
)
from augmentedquill.services.projects.project_registry_ops import (
    load_registry_from_path,
    save_registry_to_path,
    set_active_project_in_registry,
    get_active_project_dir_from_registry,
)
from augmentedquill.services.projects.project_lifecycle_ops import (
    delete_project_under_root,
    validate_project_dir_data,
    initialize_project_dir_data,
    list_projects_under_root,
    create_project_under_root,
    select_project_under_root,
)
from augmentedquill.core.config import (
    CONFIG_DIR,
    PROJECTS_ROOT,
)


def get_projects_root() -> Path:
    """Return the root directory where projects (stories) are stored.

    Defaults to <repo>/projects. Can be overridden by AUGQ_PROJECTS_ROOT env var.
    """
    return Path(os.getenv("AUGQ_PROJECTS_ROOT", str(PROJECTS_ROOT)))


@dataclass
class ProjectInfo:
    path: Path
    is_valid: bool
    reason: str = ""


def load_registry() -> Dict:
    return load_registry_from_path(
        Path(os.getenv("AUGQ_PROJECTS_REGISTRY", str(CONFIG_DIR / "projects.json")))
    )


def set_active_project(path: Path) -> None:
    reg = load_registry()
    current, recent = set_active_project_in_registry(
        Path(os.getenv("AUGQ_PROJECTS_REGISTRY", str(CONFIG_DIR / "projects.json"))),
        path,
        reg,
    )
    save_registry_to_path(
        Path(os.getenv("AUGQ_PROJECTS_REGISTRY", str(CONFIG_DIR / "projects.json"))),
        current,
        recent,
    )


def get_active_project_dir() -> Path | None:
    return get_active_project_dir_from_registry(load_registry())


def _require_active_project() -> Path:
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")
    return active


def delete_project(name: str) -> Tuple[bool, str]:
    """Delete a project directory under the projects root by name.

    If the deleted project is the current one, clear current in the registry.
    """
    ok, msg, current, recent = delete_project_under_root(
        name=name,
        projects_root=get_projects_root(),
        current_registry=load_registry(),
    )
    if ok:
        save_registry_to_path(
            Path(
                os.getenv("AUGQ_PROJECTS_REGISTRY", str(CONFIG_DIR / "projects.json"))
            ),
            current,
            recent,
        )
    return ok, msg


def validate_project_dir(path: Path) -> ProjectInfo:
    """Validate that path is a project directory.

    A valid project directory contains:
    - story.json file in its root

    Depending on the type in story.json (defaulting to 'novel'/'chapters' if missing):
    - short-story: expects content.md
    - novel: expects chapters/ folder
    - series: expects books/ folder
    """
    is_valid, reason = validate_project_dir_data(path)
    return ProjectInfo(path, is_valid=is_valid, reason=reason)


def initialize_project_dir(
    path: Path, project_title: str = "Untitled Project", project_type: str = "novel"
) -> None:
    """Create minimal project structure at the given path."""
    initialize_project_dir_data(
        path=path,
        project_title=project_title,
        project_type=project_type,
        now_iso=datetime.now().isoformat(),
    )


def list_projects() -> List[Dict[str, str | bool]]:
    """List projects under the projects root directory.

    Returns a list of dicts: {name, path, is_valid, title}
    """
    return list_projects_under_root(get_projects_root(), validate_project_dir)


def write_chapter_content(chap_id: int, content: str) -> None:
    """Write content to a chapter by its ID."""
    write_chapter_content_in_project(chap_id=chap_id, content=content)


def write_chapter_summary(chap_id: int, summary: str) -> None:
    """Write summary to a chapter by its ID across all project types."""
    update_chapter_metadata(chap_id, summary=summary)


def update_chapter_metadata(
    chap_id: int,
    title: str = None,
    summary: str = None,
    notes: str = None,
    private_notes: str = None,
    conflicts: list = None,
) -> None:
    """Update metadata fields for a chapter by its ID across all project types."""
    active = _require_active_project()
    update_chapter_metadata_in_project(
        active=active,
        chap_id=chap_id,
        title=title,
        summary=summary,
        notes=notes,
        private_notes=private_notes,
        conflicts=conflicts,
    )


def add_chapter_conflict(
    chap_id: int, description: str, resolution: str, index: int = None
) -> None:
    """Add a conflict to a chapter. If index is provided, inserts there; else appends."""
    active = _require_active_project()
    add_chapter_conflict_in_project(
        active=active,
        chap_id=chap_id,
        description=description,
        resolution=resolution,
        index=index,
    )


def update_chapter_conflict(
    chap_id: int, index: int, description: str = None, resolution: str = None
) -> None:
    """Update a specific conflict in a chapter by its index."""
    active = _require_active_project()
    update_chapter_conflict_in_project(
        active=active,
        chap_id=chap_id,
        index=index,
        description=description,
        resolution=resolution,
    )


def remove_chapter_conflict(chap_id: int, index: int) -> None:
    """Remove a conflict from a chapter by its index."""
    active = _require_active_project()
    remove_chapter_conflict_in_project(active=active, chap_id=chap_id, index=index)


def reorder_chapter_conflicts(chap_id: int, new_indices: List[int]) -> None:
    """Reorder conflicts in a chapter providing the new sequence of indices."""
    active = _require_active_project()
    reorder_chapter_conflicts_in_project(
        active=active,
        chap_id=chap_id,
        new_indices=new_indices,
    )


def write_chapter_title(chap_id: int, title: str) -> None:
    """Update the title of a chapter in the story.json across all project types."""
    active = _require_active_project()
    write_chapter_title_in_project(active=active, chap_id=chap_id, title=title)


def delete_chapter(chap_id: int) -> None:
    """Delete a chapter file and remove its metadata from story.json."""
    active = _require_active_project()
    delete_chapter_in_project(active=active, chap_id=chap_id)


def create_project(name: str, project_type: str = "novel") -> Tuple[bool, str]:
    """Create a new project explicitly."""
    ok, msg, path = create_project_under_root(
        name=name,
        project_type=project_type,
        projects_root=get_projects_root(),
        initialize_project=initialize_project_dir,
        validate_project=validate_project_dir,
    )
    if ok and path is not None:
        set_active_project(path)
    return ok, msg


def select_project(name: str) -> Tuple[bool, str]:
    """
    Select or create a project by name under the projects root.

    Rules:
    - `name` must be a simple directory name (no path separators, not absolute).
    - The project lives at `<projects_root>/<name>`.
    - If it does not exist or is empty → create/initialize and select.
    - If it is a valid project directory → select.
    - Otherwise → error.
    Returns (ok, message). On success updates registry current+recent.
    """
    ok, msg, path = select_project_under_root(
        name=name,
        projects_root=get_projects_root(),
        initialize_project=initialize_project_dir,
        validate_project=validate_project_dir,
    )
    if ok and path is not None:
        set_active_project(path)
    return ok, msg


def create_new_chapter(title: str = "", book_id: str = None) -> int:
    """Create a new chapter file and update story.json.

    For Series projects with books:
      - Appends to the specified book_id.
      - If book_id is None, appends to the last book.
      - Returns global virtual index.

    For Novel projects:
      - Appends to chapters dir.
      - Returns filename index.
    """
    active = _require_active_project()
    return create_new_chapter_in_project(active=active, title=title, book_id=book_id)


def create_new_book(title: str) -> str:
    """Create a new book in a Series project."""
    active = get_active_project_dir()
    return create_new_book_in_project(active=active, title=title)


def update_book_metadata(
    book_id: str,
    title: str = None,
    summary: str = None,
    notes: str = None,
    private_notes: str = None,
) -> None:
    """Update title or metadata for a book in a series project."""
    active = _require_active_project()
    update_book_metadata_in_project(
        active=active,
        book_id=book_id,
        title=title,
        summary=summary,
        notes=notes,
        private_notes=private_notes,
    )


def read_book_content(book_id: str) -> str:
    """Read the overall intro/content for a book from its book_content.md."""
    active = _require_active_project()
    return read_book_content_in_project(active=active, book_id=book_id)


def write_book_content(book_id: str, content: str) -> None:
    """Write the overall intro/content for a book to its book_content.md."""
    active = _require_active_project()
    write_book_content_in_project(active=active, book_id=book_id, content=content)


def update_story_metadata(
    title: str = None,
    summary: str = None,
    tags: List[str] = None,
    notes: str = None,
    private_notes: str = None,
) -> None:
    """Update general story metadata."""
    active = _require_active_project()
    update_story_metadata_in_project(
        active=active,
        title=title,
        summary=summary,
        tags=tags,
        notes=notes,
        private_notes=private_notes,
    )


def read_story_content() -> str:
    """Read the story-level content/introduction."""
    active = _require_active_project()
    return read_story_content_in_project(active=active)


def write_story_content(content: str) -> None:
    """Write the story-level content/introduction."""
    active = _require_active_project()
    write_story_content_in_project(active=active, content=content)


def change_project_type(new_type: str) -> Tuple[bool, str]:
    """Convert the active project to a new type."""
    active = get_active_project_dir()
    if not active:
        return False, "No active project"
    return change_project_type_in_project(active=active, new_type=new_type)
