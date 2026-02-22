# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the project structure ops unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path
from typing import Tuple

from augmentedquill.core.config import load_story_config, save_story_config
from augmentedquill.services.chapters.chapter_helpers import (
    _normalize_chapter_entry,
    _scan_chapter_files,
)


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def create_new_chapter_in_project(
    active: Path, title: str = "", book_id: str = None
) -> int:
    """Create a new chapter file and update story.json within active project path."""
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    project_type = story.get("project_type", "novel")

    final_title = title

    if project_type == "short-story":
        raise ValueError("Cannot add chapters to a Short Story project (single file)")

    if project_type == "series":
        books = story.get("books", [])
        if not books:
            raise ValueError("No books in this project")

        target_book = None
        if book_id:
            target_book = next(
                (
                    book
                    for book in books
                    if (book.get("id") == book_id or book.get("folder") == book_id)
                ),
                None,
            )
            if not target_book:
                raise ValueError(f"Book {book_id} not found")
        else:
            target_book = books[-1]
            book_id = target_book.get("id") or target_book.get("folder")

        if not final_title:
            current_count = len(target_book.get("chapters", []))
            final_title = f"Chapter {current_count + 1}"

        book_dir = active / "books" / book_id
        chapters_dir = book_dir / "chapters"
        _ensure_dir(chapters_dir)

        existing = [path for path in chapters_dir.glob("*.txt") if path.is_file()]
        max_index = 0
        for existing_path in existing:
            import re

            match = re.match(r"^(\d{4})\.txt$", existing_path.name)
            if match:
                max_index = max(max_index, int(match.group(1)))

        next_local_idx = max_index + 1
        filename = f"{next_local_idx:04d}.txt"
        path = chapters_dir / filename
        path.write_text("", encoding="utf-8")

        if "chapters" not in target_book:
            target_book["chapters"] = []
        target_book["chapters"].append(
            {"title": final_title, "summary": "", "filename": filename}
        )

        save_story_config(story_path, story)

        all_files = _scan_chapter_files()
        for virtual_id, chapter_path in all_files:
            if chapter_path.absolute() == path.absolute():
                return virtual_id

        return 0

    files = _scan_chapter_files()
    next_idx = files[-1][0] + 1 if files else 1

    if not final_title:
        final_title = f"Chapter {next_idx}"

    filename = f"{next_idx:04d}.txt"
    chapters_dir = active / "chapters"
    _ensure_dir(chapters_dir)
    path = chapters_dir / filename
    path.write_text("", encoding="utf-8")

    chapters_data = story.get("chapters") or []
    chapters_data = [_normalize_chapter_entry(chapter) for chapter in chapters_data]
    chapters_data.append({"title": final_title, "summary": "", "filename": filename})
    story["chapters"] = chapters_data

    save_story_config(story_path, story)
    return next_idx


def create_new_book_in_project(active: Path, title: str) -> str:
    """Create a new book in a series project under active project path."""
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    if story.get("project_type") != "series":
        raise ValueError("Can only create books in Series projects")

    books = story.get("books", [])

    if not title:
        next_num = len(books) + 1
        title = f"Book {next_num}"

    book_id = str(uuid.uuid4())
    books.append({"folder": book_id, "title": title, "chapters": []})
    story["books"] = books
    save_story_config(story_path, story)

    book_dir = active / "books" / book_id
    _ensure_dir(book_dir / "chapters")
    _ensure_dir(book_dir / "images")
    (book_dir / "book_content.md").write_text("", encoding="utf-8")

    return book_id


def change_project_type_in_project(active: Path, new_type: str) -> Tuple[bool, str]:
    """Convert active project to a new type in-place."""
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    old_type = story.get("project_type", "novel")

    if old_type == new_type:
        return True, "Already this type"

    def _convert(current_old_type: str, target_type: str) -> Tuple[bool, str]:
        local_story = load_story_config(story_path) or {}
        local_old_type = local_story.get("project_type", "novel")

        if local_old_type == target_type:
            return True, "Already this type"

        if local_old_type == "short-story" and target_type == "series":
            ok, msg = _convert("short-story", "novel")
            if not ok:
                return ok, msg
            return _convert("novel", "series")

        if local_old_type == "series" and target_type == "short-story":
            ok, msg = _convert("series", "novel")
            if not ok:
                return ok, msg
            return _convert("novel", "short-story")

        if local_old_type == "short-story" and target_type == "novel":
            content_path = active / "content.md"
            content = ""
            if content_path.exists():
                content = content_path.read_text(encoding="utf-8")
                os.remove(content_path)

            _ensure_dir(active / "chapters")
            (active / "chapters" / "0001.txt").write_text(content, encoding="utf-8")

            local_story["project_type"] = "novel"
            local_story["chapters"] = [{"title": "Chapter 1", "summary": ""}]
            if "content_file" in local_story:
                del local_story["content_file"]

        elif local_old_type == "novel" and target_type == "short-story":
            chapters_dir = active / "chapters"
            files = list(chapters_dir.glob("*.txt")) if chapters_dir.exists() else []
            if len(files) > 1:
                return (
                    False,
                    "Cannot convert to Short Story: Project has multiple chapters.",
                )

            content = ""
            if files:
                content = files[0].read_text(encoding="utf-8")
                shutil.rmtree(chapters_dir)

            (active / "content.md").write_text(content, encoding="utf-8")
            local_story["project_type"] = "short-story"
            if "chapters" in local_story:
                del local_story["chapters"]
            local_story["content_file"] = "content.md"

        elif local_old_type == "novel" and target_type == "series":
            book_id = str(uuid.uuid4())
            book_title = "Book 1"

            books_dir = active / "books"
            _ensure_dir(books_dir)
            book_dir = books_dir / book_id
            _ensure_dir(book_dir / "chapters")
            _ensure_dir(book_dir / "images")

            chapters_dir = active / "chapters"
            if chapters_dir.exists():
                for file_path in chapters_dir.glob("*"):
                    shutil.move(
                        str(file_path), str(book_dir / "chapters" / file_path.name)
                    )
                shutil.rmtree(chapters_dir)

            images_dir = active / "images"
            if images_dir.exists():
                for file_path in images_dir.glob("*"):
                    shutil.move(
                        str(file_path), str(book_dir / "images" / file_path.name)
                    )

            local_story["project_type"] = "series"
            local_story["books"] = [
                {
                    "folder": book_id,
                    "title": book_title,
                    "chapters": local_story.get("chapters", []),
                }
            ]
            if "chapters" in local_story:
                del local_story["chapters"]

        elif local_old_type == "series" and target_type == "novel":
            books = local_story.get("books", [])
            if len(books) > 1:
                return False, "Cannot convert to Novel: Project has multiple books."

            if books:
                book = books[0]
                book_id = book.get("id") or book.get("folder")
                book_dir = active / "books" / book_id

                _ensure_dir(active / "chapters")
                _ensure_dir(active / "images")

                if (book_dir / "chapters").exists():
                    for file_path in (book_dir / "chapters").glob("*"):
                        shutil.move(
                            str(file_path), str(active / "chapters" / file_path.name)
                        )

                if (book_dir / "images").exists():
                    for file_path in (book_dir / "images").glob("*"):
                        shutil.move(
                            str(file_path), str(active / "images" / file_path.name)
                        )

                local_story["chapters"] = book.get("chapters", [])
                shutil.rmtree(active / "books")

            local_story["project_type"] = "novel"
            if "books" in local_story:
                del local_story["books"]

        else:
            return (
                False,
                f"Conversion from {local_old_type} to {target_type} not implemented.",
            )

        save_story_config(story_path, local_story)
        return True, f"Converted to {target_type}"

    return _convert(old_type, new_type)
