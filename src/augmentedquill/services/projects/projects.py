# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the projects unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from augmentedquill.core.config import (
    DEFAULT_PROJECTS_REGISTRY_PATH,
    PROJECTS_ROOT,
)
from augmentedquill.services.projects.project_chapter_ops import (
    add_chapter_conflict_in_project,
    delete_chapter_in_project,
    remove_chapter_conflict_in_project,
    reorder_chapter_conflicts_in_project,
    update_chapter_conflict_in_project,
    update_chapter_metadata_in_project,
    write_chapter_content_in_project,
    write_chapter_title_in_project,
)
from augmentedquill.services.projects.project_lifecycle_ops import (
    create_project_under_root,
    delete_project_under_root,
    initialize_project_dir_data,
    list_projects_under_root,
    select_project_under_root,
    validate_project_dir_data,
)
from augmentedquill.services.projects.project_registry_ops import (
    get_active_project_dir_from_registry,
    load_registry_from_path,
    save_registry_to_path,
    set_active_project_in_registry,
)
from augmentedquill.services.projects.project_story_ops import (
    read_book_content_in_project,
    read_editing_scratchpad_in_project,
    read_scratchpad_in_project,
    read_story_content_in_project,
    update_book_metadata_in_project,
    update_story_metadata_in_project,
    write_book_content_in_project,
    write_editing_scratchpad_in_project,
    write_scratchpad_in_project,
    write_story_content_in_project,
)
from augmentedquill.services.projects.project_structure_ops import (
    change_project_type_in_project,
    create_new_book_in_project,
    create_new_chapter_in_project,
)

_ACTIVE_PROJECT_OVERRIDE: ContextVar[Path | None] = ContextVar(
    "active_project_override", default=None
)


def get_projects_root() -> Path:
    """Return the root directory where projects (stories) are stored.

    Defaults to <repo>/projects. Can be overridden by AUGQ_PROJECTS_ROOT env var.
    """
    return Path(os.getenv("AUGQ_PROJECTS_ROOT", str(PROJECTS_ROOT)))


@dataclass
class ProjectInfo:
    """Holds project discovery metadata used during project validation."""

    path: Path
    is_valid: bool
    reason: str = ""


def load_registry() -> dict:
    """Represents the ProjectInfo type."""
    """Represents the ProjectInfo type."""
    """Load registry."""
    """Represents the ProjectInfo type."""
    return load_registry_from_path(
        Path(os.getenv("AUGQ_PROJECTS_REGISTRY", str(DEFAULT_PROJECTS_REGISTRY_PATH)))
    )


def set_active_project(path: Path) -> None:
    """Set active project."""
    reg = load_registry()
    current, recent = set_active_project_in_registry(
        Path(os.getenv("AUGQ_PROJECTS_REGISTRY", str(DEFAULT_PROJECTS_REGISTRY_PATH))),
        path,
        reg,
    )
    save_registry_to_path(
        Path(os.getenv("AUGQ_PROJECTS_REGISTRY", str(DEFAULT_PROJECTS_REGISTRY_PATH))),
        current,
        recent,
    )


def get_active_project_dir() -> Path | None:
    """Return active project dir."""
    overridden = _ACTIVE_PROJECT_OVERRIDE.get()
    if overridden is not None:
        return overridden
    return get_active_project_dir_from_registry(load_registry())


@contextmanager
def use_project_context(path: Path | None) -> Iterator[None]:
    """Temporarily resolve active-project lookups to a request-scoped path."""
    token = _ACTIVE_PROJECT_OVERRIDE.set(path)
    try:
        yield
    finally:
        _ACTIVE_PROJECT_OVERRIDE.reset(token)


def _require_active_project() -> Path:
    """Helper for active project.."""
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")
    return active


def delete_project(name: str) -> tuple[bool, str]:
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
                os.getenv("AUGQ_PROJECTS_REGISTRY", str(DEFAULT_PROJECTS_REGISTRY_PATH))
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
    path: Path,
    project_title: str = "Untitled Project",
    project_type: str = "novel",
    language: str = "en",
) -> None:
    """Create minimal project structure at the given path."""
    initialize_project_dir_data(
        path=path,
        project_title=project_title,
        project_type=project_type,
        now_iso=datetime.now().isoformat(),
        language=language,
    )


def list_projects() -> list[dict[str, str | bool]]:
    """List projects under the projects root directory.

    Returns a list of dicts: {name, path, is_valid, title}
    """
    return list_projects_under_root(get_projects_root(), validate_project_dir)


def write_chapter_content(
    chap_id: int, content: str, active: Path | None = None
) -> None:
    """Write content to a chapter by its ID."""
    write_chapter_content_in_project(chap_id=chap_id, content=content, active=active)


def write_chapter_summary(
    chap_id: int, summary: str, active: Path | None = None
) -> None:
    """Write summary to a chapter by its ID across all project types."""
    update_chapter_metadata(chap_id, summary=summary, active=active)


def update_chapter_metadata(
    chap_id: int,
    title: str = None,
    summary: str = None,
    notes: str = None,
    private_notes: str = None,
    conflicts: list = None,
    active: Path | None = None,
) -> None:
    """Update metadata fields for a chapter by its ID across all project types."""
    active = active or _require_active_project()
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
    chap_id: int,
    description: str,
    resolution: str,
    index: int = None,
    active: Path | None = None,
) -> None:
    """Add a conflict to a chapter. If index is provided, inserts there; else appends."""
    active = active or _require_active_project()
    add_chapter_conflict_in_project(
        active=active,
        chap_id=chap_id,
        description=description,
        resolution=resolution,
        index=index,
    )


def update_chapter_conflict(
    chap_id: int,
    index: int,
    description: str = None,
    resolution: str = None,
    active: Path | None = None,
) -> None:
    """Update a specific conflict in a chapter by its index."""
    active = active or _require_active_project()
    update_chapter_conflict_in_project(
        active=active,
        chap_id=chap_id,
        index=index,
        description=description,
        resolution=resolution,
    )


def remove_chapter_conflict(
    chap_id: int, index: int, active: Path | None = None
) -> None:
    """Remove a conflict from a chapter by its index."""
    active = active or _require_active_project()
    remove_chapter_conflict_in_project(active=active, chap_id=chap_id, index=index)


def reorder_chapter_conflicts(
    chap_id: int, new_indices: list[int], active: Path | None = None
) -> None:
    """Reorder conflicts in a chapter providing the new sequence of indices."""
    active = active or _require_active_project()
    reorder_chapter_conflicts_in_project(
        active=active,
        chap_id=chap_id,
        new_indices=new_indices,
    )


def write_chapter_title(chap_id: int, title: str, active: Path | None = None) -> None:
    """Update the title of a chapter in the story.json across all project types."""
    active = active or _require_active_project()
    write_chapter_title_in_project(active=active, chap_id=chap_id, title=title)


def delete_chapter(chap_id: int, active: Path | None = None) -> None:
    """Delete a chapter file and remove its metadata from story.json."""
    active = active or _require_active_project()
    delete_chapter_in_project(active=active, chap_id=chap_id)


def create_project(
    name: str, project_type: str = "novel", language: str = "en"
) -> tuple[bool, str]:
    """Create a new project explicitly."""
    ok, msg, path = create_project_under_root(
        name=name,
        project_type=project_type,
        projects_root=get_projects_root(),
        initialize_project=initialize_project_dir,
        validate_project=validate_project_dir,
        language=language,
    )
    if ok and path is not None:
        set_active_project(path)
    return ok, msg


def select_project(name: str) -> tuple[bool, str]:
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


def create_new_chapter(
    title: str = "", book_id: str = None, active: Path | None = None
) -> int:
    """Create a new chapter file and update story.json.

    For Series projects with books:
      - Appends to the specified book_id.
      - If book_id is None, appends to the last book.
      - Returns global virtual index.

    For Novel projects:
      - Appends to chapters dir.
      - Returns filename index.
    """
    active = active or _require_active_project()
    return create_new_chapter_in_project(active=active, title=title, book_id=book_id)


def create_new_book(title: str, active: Path | None = None) -> str:
    """Create a new book in a Series project."""
    active = active or get_active_project_dir()
    return create_new_book_in_project(active=active, title=title)


def update_book_metadata(
    book_id: str,
    title: str = None,
    summary: str = None,
    notes: str = None,
    private_notes: str = None,
    active: Path | None = None,
) -> None:
    """Update title or metadata for a book in a series project."""
    active = active or _require_active_project()
    update_book_metadata_in_project(
        active=active,
        book_id=book_id,
        title=title,
        summary=summary,
        notes=notes,
        private_notes=private_notes,
    )


def read_book_content(book_id: str, active: Path | None = None) -> str:
    """Read the overall intro/content for a book from its book_content.md."""
    active = active or _require_active_project()
    return read_book_content_in_project(active=active, book_id=book_id)


def write_book_content(book_id: str, content: str, active: Path | None = None) -> None:
    """Write the overall intro/content for a book to its book_content.md."""
    active = active or _require_active_project()
    write_book_content_in_project(active=active, book_id=book_id, content=content)


def update_story_metadata(
    title: str = None,
    summary: str = None,
    tags: list[str] = None,
    notes: str = None,
    private_notes: str = None,
    conflicts: list | None = None,
    language: str = None,
    active: Path | None = None,
) -> None:
    """Update general story metadata."""
    active = active or _require_active_project()
    update_story_metadata_in_project(
        active=active,
        title=title,
        summary=summary,
        tags=tags,
        notes=notes,
        private_notes=private_notes,
        conflicts=conflicts,
        language=language,
    )


def read_story_content(active: Path | None = None) -> str:
    """Read the story-level content/introduction."""
    active = active or _require_active_project()
    return read_story_content_in_project(active=active)


def write_story_content(content: str, active: Path | None = None) -> None:
    """Write the story-level content/introduction."""
    active = active or _require_active_project()
    write_story_content_in_project(active=active, content=content)


def read_scratchpad(active: Path | None = None) -> str:
    """Read the project-level scratchpad/TODO list."""
    active = active or _require_active_project()
    return read_scratchpad_in_project(active=active)


def write_scratchpad(content: str, active: Path | None = None) -> None:
    """Write the project-level scratchpad/TODO list."""
    active = active or _require_active_project()
    write_scratchpad_in_project(active=active, content=content)


def read_editing_scratchpad(active: Path | None = None) -> str:
    """Read the EDITING-model scratchpad (separate from the CHAT scratchpad)."""
    active = active or _require_active_project()
    return read_editing_scratchpad_in_project(active=active)


def write_editing_scratchpad(content: str, active: Path | None = None) -> None:
    """Write the EDITING-model scratchpad (separate from the CHAT scratchpad)."""
    active = active or _require_active_project()
    write_editing_scratchpad_in_project(active=active, content=content)


def change_project_type(new_type: str, active: Path | None = None) -> tuple[bool, str]:
    """Convert the active project to a new type."""
    active = active or get_active_project_dir()
    if not active:
        return False, "No active project"
    return change_project_type_in_project(active=active, new_type=new_type)
