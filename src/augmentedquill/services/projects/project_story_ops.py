# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the project story ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import os
from pathlib import Path
from typing import List

from augmentedquill.core.config import load_story_config, save_story_config


def update_book_metadata_in_project(
    active: Path,
    book_id: str,
    title: str = None,
    summary: str = None,
    notes: str = None,
    private_notes: str = None,
) -> None:
    """Update Book Metadata In Project."""
    # Security: Prevent path traversal
    if not book_id:
        raise ValueError("book_id is required")
    book_id = os.path.basename(book_id)

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}

    books = story.get("books", [])
    target = next(
        (b for b in books if (b.get("id") == book_id or b.get("folder") == book_id)),
        None,
    )
    if not target:
        raise ValueError(f"Book with ID {book_id} not found")

    if title is not None:
        target["title"] = title
    if summary is not None:
        target["summary"] = summary
    if notes is not None:
        target["notes"] = notes
    if private_notes is not None:
        target["private_notes"] = private_notes

    save_story_config(story_path, story)


def read_book_content_in_project(active: Path, book_id: str) -> str:
    # Security: Prevent path traversal by ensuring book_id is a simple name
    if not book_id:
        return ""
    book_id = os.path.basename(book_id)

    content_path = (active / "books" / book_id / "book_content.md").resolve()
    # Ensure the resolved path is actually inside the books directory
    if not content_path.is_relative_to((active / "books").resolve()):
        return ""

    if not content_path.exists():
        return ""
    return content_path.read_text(encoding="utf-8")


def write_book_content_in_project(active: Path, book_id: str, content: str) -> None:
    # Security: Prevent path traversal by ensuring book_id is a simple name
    if not book_id:
        raise ValueError("book_id is required")
    book_id = os.path.basename(book_id)

    book_dir = (active / "books" / book_id).resolve()
    # Ensure the directory is inside the books scope
    if not book_dir.is_relative_to((active / "books").resolve()):
        raise ValueError(f"Access denied to book directory: {book_id}")

    book_dir.mkdir(parents=True, exist_ok=True)
    content_path = book_dir / "book_content.md"
    content_path.write_text(content, encoding="utf-8")


def update_story_metadata_in_project(
    active: Path,
    title: str = None,
    summary: str = None,
    tags: List[str] = None,
    notes: str = None,
    private_notes: str = None,
) -> None:
    """Update Story Metadata In Project."""
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}

    if title is not None:
        story["project_title"] = title
    if summary is not None:
        story["story_summary"] = summary
    if tags is not None:
        story["tags"] = tags
    if notes is not None:
        story["notes"] = notes
    if private_notes is not None:
        story["private_notes"] = private_notes

    save_story_config(story_path, story)


def read_story_content_in_project(active: Path) -> str:
    """Read Story Content In Project."""
    story = load_story_config(active / "story.json") or {}
    project_type = story.get("project_type", "novel")

    if project_type == "short-story":
        filename = story.get("content_file", "content.md")
        content_path = active / filename
    else:
        content_path = active / "story_content.md"

    if not content_path.exists():
        return ""
    return content_path.read_text(encoding="utf-8")


def write_story_content_in_project(active: Path, content: str) -> None:
    """Write Story Content In Project."""
    story = load_story_config(active / "story.json") or {}
    project_type = story.get("project_type", "novel")

    if project_type == "short-story":
        filename = story.get("content_file", "content.md")
        content_path = active / filename
    else:
        content_path = active / "story_content.md"

    content_path.write_text(content, encoding="utf-8")
