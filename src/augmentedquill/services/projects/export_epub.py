# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the EPUB export functionality."""

import io
import re
from pathlib import Path
from typing import Any

import markdown
from ebooklib import epub
from fastapi import Response

from augmentedquill.core.config import load_story_config
from augmentedquill.services.exceptions import BadRequestError
from augmentedquill.services.projects.projects import (
    get_active_project_dir,
    get_projects_root,
)


def scan_project_chapters(active: Path) -> list[tuple[int, Path, str, str]]:
    """Scan the project for content and return a list of (global_id, path, book_id, chapter_title)."""
    story = load_story_config(active / "story.json") or {}
    p_type = story.get("project_type", "novel")

    if p_type == "short-story":
        p = active / "content.md"
        title = story.get("project_title") or active.name
        return [(1, p, "", title)]

    if p_type == "series":
        books = story.get("books", [])
        items = []
        global_idx = 1
        for book in books:
            bid = book.get("id")
            btitle = book.get("title") or bid
            if not bid:
                continue

            b_dir = active / "books" / bid
            chapters_dir = b_dir / "chapters"
            if not chapters_dir.exists():
                continue

            book_items = []
            for p in chapters_dir.glob("*.txt"):
                if not p.is_file():
                    continue
                name = p.name
                m = re.match(r"^(\d{4})\.txt$", name)
                if m:
                    idx = int(m.group(1))
                    book_items.append((idx, p))

            book_items.sort(key=lambda t: t[0])
            for _, path_inner in book_items:
                # Find chapter title
                c_title = path_inner.stem
                if c_title.isdigit():
                    c_title = f"Chapter {int(c_title)}"
                for chapter_entry in book.get("chapters", []):
                    if chapter_entry.get("filename") == path_inner.name:
                        c_title = chapter_entry.get("title") or c_title
                        break

                items.append((global_idx, path_inner, btitle, c_title))
                global_idx += 1
        return items

    # Novel
    chapters_dir = active / "chapters"
    if not chapters_dir.exists() or not chapters_dir.is_dir():
        return []
    items_novel = []
    for p in chapters_dir.glob("*.txt"):
        if not p.is_file():
            continue
        name = p.name
        m = re.match(r"^(\d{4})\.txt$", name)
        if m:
            idx = int(m.group(1))
            items_novel.append((idx, p))
            continue
    items_novel.sort(key=lambda t: t[0])

    result = []
    for i, (_, p) in enumerate(items_novel):
        c_title = p.stem
        if c_title.isdigit():
            c_title = f"Chapter {int(c_title)}"
        for chapter_entry in story.get("chapters", []):
            if chapter_entry.get("filename") == p.name:
                c_title = chapter_entry.get("title") or c_title
                break
        result.append((i + 1, p, "", c_title))

    return result


def export_project_epub_response(name: str | None = None) -> Response:
    """Export the project as an EPUB file."""
    projects_root = get_projects_root().resolve()

    if name:
        # Basic disallow of obvious traversal characters
        if ".." in name or "/" in name or "\\" in name:
            raise BadRequestError("Invalid project name")

        # Normalize and ensure the project directory is directly under the projects root
        candidate_path = (projects_root / name).resolve()
        if (
            not candidate_path.is_relative_to(projects_root)
            or candidate_path.parent != projects_root
        ):
            raise BadRequestError("Project not found")
        path = candidate_path
    else:
        # Use the active project, but still normalize and ensure it is under the projects root
        active_path = get_active_project_dir()
        if not active_path:
            raise BadRequestError("Project not found")
        active_path = active_path.resolve()
        if not active_path.is_relative_to(projects_root):
            raise BadRequestError("Project not found")
        path = active_path

    if not path.exists():
        raise BadRequestError("Project not found")

    story = load_story_config(path / "story.json") or {}
    project_title = story.get("project_title") or path.name

    book = epub.EpubBook()
    book.set_title(project_title)
    lang = story.get("language", "en") if isinstance(story, dict) else "en"
    book.set_language(lang)

    added_images = set()

    def process_html_images(html_text: str) -> str:
        """Helper for html images.."""

        def replacer(match: Any) -> Any:
            """Helper for the requested value.."""
            img_filename = match.group(1)
            # Prevent path traversal
            if ".." in img_filename or "/" in img_filename or "\\" in img_filename:
                return match.group(0)

            img_path = path / "images" / img_filename
            if img_path.exists() and img_path.resolve().is_relative_to(
                path.resolve() / "images"
            ):
                if img_filename not in added_images:
                    with open(img_path, "rb") as bf:
                        img_data = bf.read()
                    epub_img = epub.EpubItem(
                        uid=f"img_{img_filename}",
                        file_name=f"images/{img_filename}",
                        content=img_data,
                    )
                    ext = img_path.suffix.lower()
                    if ext == ".png":
                        epub_img.media_type = "image/png"
                    elif ext in [".jpg", ".jpeg"]:
                        epub_img.media_type = "image/jpeg"
                    elif ext == ".gif":
                        epub_img.media_type = "image/gif"
                    elif ext == ".webp":
                        epub_img.media_type = "image/webp"
                    elif ext == ".svg":
                        epub_img.media_type = "image/svg+xml"

                    book.add_item(epub_img)
                    added_images.add(img_filename)

                return f'src="images/{img_filename}"'
            return match.group(0)

        # Match src="/api/v1/projects/images/filename"
        return re.sub(
            r'src=["\']/api/v1/projects/images/([^"\'\?]+)[^"\']*["\']',
            replacer,
            html_text,
        )

    chapters_scanned = scan_project_chapters(path)

    epub_chapters = []
    toc = []

    current_book = None
    current_book_chapter_list = []

    for idx, chap_path, book_title, chapter_title in chapters_scanned:
        # Read content
        content = chap_path.read_text(encoding="utf-8") if chap_path.exists() else ""
        html_content = markdown.markdown(content)
        html_content = process_html_images(html_content)

        c = epub.EpubHtml(title=chapter_title, file_name=f"chap_{idx}.xhtml", lang="en")
        c.content = f"<h1>{chapter_title}</h1>\n{html_content}"
        book.add_item(c)
        epub_chapters.append(c)

        if book_title:
            if book_title != current_book:
                if current_book is not None:
                    toc.append((epub.Section(current_book), current_book_chapter_list))
                current_book = book_title
                current_book_chapter_list = [c]
            else:
                current_book_chapter_list.append(c)
        else:
            toc.append(c)

    if current_book is not None:
        toc.append((epub.Section(current_book), current_book_chapter_list))

    book.toc = tuple(toc) if toc else tuple(epub_chapters)

    # Add navigation files
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())

    # Create spine
    book.spine = ["nav"] + epub_chapters

    # Write to memory object
    mem = io.BytesIO()
    # Ensure ebooklib remains a dependency and isn't pruned by automated tools
    _ = epub.EpubBook
    epub.write_epub(mem, book, {})
    mem.seek(0)

    return Response(
        content=mem.getvalue(),
        media_type="application/epub+zip",
        headers={"Content-Disposition": f'attachment; filename="{project_title}.epub"'},
    )
