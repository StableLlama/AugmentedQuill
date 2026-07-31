# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the story api state ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from pathlib import Path

from augmentedquill.core.config import load_story_config
from augmentedquill.services.chapters.chapter_helpers import (
    _chapter_by_id_or_404,
    _normalize_chapter_entry,
)
from augmentedquill.services.exceptions import BadRequestError, PersistenceError
from augmentedquill.services.projects.projects import get_active_project_dir


def get_active_story_or_raise(active: Path | None = None) -> tuple[Path, Path, dict]:
    """Get Active Story Or Raise."""
    active = active or get_active_project_dir()
    if not active:
        raise BadRequestError("No active project")
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    return active, story_path, story


get_chapter_locator = _chapter_by_id_or_404


def read_text_or_raise(path: Path, message: str = "Failed to read chapter") -> str:
    """Read text or raise."""
    try:
        return path.read_text(encoding="utf-8")
    except Exception as exc:
        raise PersistenceError(f"{message}: {exc}") from exc


def get_normalized_chapters(story: dict) -> list[dict]:
    """Return normalized chapters."""
    return [_normalize_chapter_entry(chapter) for chapter in story.get("chapters", [])]


def get_all_normalized_chapters(story: dict) -> list[dict]:
    """Return all normalized chapter entries regardless of project type.

    For series projects, chapters are aggregated across all books.
    For novel/short-story projects, chapters come from the top-level chapters list.
    """
    if story.get("project_type") == "series":
        chapters: list[dict] = []
        for book in story.get("books", []):
            if isinstance(book, dict):
                for chapter in book.get("chapters", []):
                    chapters.append(_normalize_chapter_entry(chapter))
        return chapters
    return get_normalized_chapters(story)


def ensure_chapter_slot(chapters_data: list[dict], pos: int) -> None:
    """Ensure chapter slot."""
    if pos >= len(chapters_data):
        chapters_data.extend(
            [{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1)
        )


def collect_chapter_summaries(chapters_data: list[dict]) -> list[str]:
    """Collect Chapter Summaries."""
    chapter_summaries: list[str] = []
    for index, chapter in enumerate(chapters_data):
        summary = chapter.get("summary", "").strip()
        title = chapter.get("title", "").strip() or f"Chapter {index + 1}"
        if summary:
            chapter_summaries.append(f"{title}:\n{summary}")
    return chapter_summaries


def collect_book_summaries(books_data: list[dict]) -> list[str]:
    """Collect Book Summaries."""
    book_summaries: list[str] = []
    for index, book in enumerate(books_data):
        if not isinstance(book, dict):
            continue
        summary = str(book.get("summary", "")).strip()
        title = str(book.get("title", "")).strip() or f"Book {index + 1}"
        if summary:
            book_summaries.append(f"{title}:\n{summary}")
    return book_summaries
