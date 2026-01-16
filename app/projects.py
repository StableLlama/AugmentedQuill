# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple
import shutil
import os

from app.config import load_story_config
from app.helpers.chapter_helpers import (
    _scan_chapter_files,
    _normalize_chapter_entry,
    _chapter_by_id_or_404,
    _get_chapter_metadata_entry,
)

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = BASE_DIR / "config"
PROJECTS_ROOT = BASE_DIR / "projects"
REGISTRY_PATH = Path(
    os.getenv("AUGQ_PROJECTS_REGISTRY", str(CONFIG_DIR / "projects.json"))
)


def get_registry_path() -> Path:
    # Re-evaluate environment at call time to make tests able to redirect location
    return Path(os.getenv("AUGQ_PROJECTS_REGISTRY", str(CONFIG_DIR / "projects.json")))


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


def _now_iso() -> str:
    return datetime.now().isoformat()


def _ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def load_registry() -> Dict:
    rp = get_registry_path()
    if not rp.exists():
        return {"current": "", "recent": []}
    try:
        data = json.loads(rp.read_text(encoding="utf-8"))
    except Exception:
        return {"current": "", "recent": []}
    cur = data.get("current") or ""
    recent = data.get("recent") or []
    if not isinstance(recent, list):
        recent = []
    # normalize to strings
    recent = [str(x) for x in recent if isinstance(x, (str, Path))]
    return {
        "current": str(cur) if isinstance(cur, (str, Path)) else "",
        "recent": recent,
    }


def save_registry(current: str, recent: List[str]) -> None:
    rp = get_registry_path()
    _ensure_dir(rp.parent)
    # De-dup while preserving order
    seen = set()
    deduped: List[str] = []
    for p in [current] + recent:
        sp = str(p)
        if sp and sp not in seen:
            seen.add(sp)
            deduped.append(sp)
    # Cap to 5 (current should be first already)
    final_list = deduped[:5]
    payload = {"current": current, "recent": final_list}
    rp.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def set_active_project(path: Path) -> None:
    reg = load_registry()
    current = str(path)
    # Remove any existing entries matching this project.
    recent: List[str] = []
    for x in reg.get("recent", []) or []:
        if not x:
            continue
        try:
            if str(x) == current:
                continue
        except Exception:
            pass
        recent.append(str(x))
    save_registry(current, [current] + recent)


def get_active_project_dir() -> Path | None:
    reg = load_registry()
    cur = reg.get("current") or ""
    if cur:
        try:
            p = Path(cur)
            if p.is_absolute():
                return p
        except Exception:
            pass
    return None


def delete_project(name: str) -> Tuple[bool, str]:
    """Delete a project directory under the projects root by name.

    If the deleted project is the current one, clear current in the registry.
    """
    if not name:
        return False, "Project name is required"
    if (
        any(ch in name for ch in ("/", "\\"))
        or name.strip() != name
        or name in (".", "..")
    ):
        return False, "Invalid project name"
    root = get_projects_root()
    p = root / name
    if not p.exists() or not p.is_dir():
        return False, "Project does not exist"
    # Safety: ensure path is inside root
    try:
        p.resolve().relative_to(root.resolve())
    except Exception:
        return False, "Invalid project path"
    # Remove directory recursively
    shutil.rmtree(p)
    # Update registry
    reg = load_registry()
    current = reg.get("current") or ""
    recent = [x for x in reg.get("recent", []) if x]
    # Registry entries are path-based.
    try:
        current_name = Path(str(current)).name if current else ""
    except Exception:
        current_name = ""
    if current_name and current_name == name:
        current = ""
    filtered_recent: List[str] = []
    for x in recent:
        try:
            if Path(str(x)).name == name:
                continue
        except Exception:
            continue
        filtered_recent.append(str(x))
    recent = filtered_recent
    save_registry(current, recent)
    return True, "Project deleted"


def validate_project_dir(path: Path) -> ProjectInfo:
    """Validate that path is a project directory.

    A valid project directory contains:
    - story.json file in its root

    Depending on the type in story.json (defaulting to 'novel'/'chapters' if missing):
    - short-story: expects content.md
    - novel: expects chapters/ folder
    - series: expects books/ folder
    """
    if not path.exists():
        return ProjectInfo(path, is_valid=False, reason="does_not_exist")
    if not path.is_dir():
        return ProjectInfo(path, is_valid=False, reason="not_a_directory")

    entries = list(path.iterdir())
    if not entries:
        return ProjectInfo(path, is_valid=False, reason="empty")

    story_path = path / "story.json"
    if not (story_path.exists() and story_path.is_file()):
        return ProjectInfo(path, is_valid=False, reason="missing_story_json")

    try:
        story = json.loads(story_path.read_text(encoding="utf-8"))
    except Exception:
        return ProjectInfo(path, is_valid=False, reason="invalid_story_json")

    p_type = story.get("project_type", "novel")

    if p_type == "short-story":
        # It's valid even if empty, but file should ideally exist or be creatable.
        # Strict validation: require content.md existence?
        # Let's say valid if story.json is there.
        return ProjectInfo(path, is_valid=True, reason="ok")

    elif p_type == "series":
        books_dir = path / "books"
        # Should exist.
        if books_dir.exists() and books_dir.is_dir():
            return ProjectInfo(path, is_valid=True, reason="ok")
        # If missing, maybe just created.
        return ProjectInfo(path, is_valid=True, reason="ok_empty_books")

    else:  # novel or unknown
        chapters_dir = path / "chapters"
        if chapters_dir.exists() and chapters_dir.is_dir():
            has_txt_md = any(
                (f.suffix.lower() in (".txt", ".md"))
                for f in chapters_dir.glob("**/*")
                if f.is_file()
            )
            return ProjectInfo(
                path, is_valid=True, reason="ok" if has_txt_md else "ok_empty_chapters"
            )
        # Even if chapters dir missing, if story.json exists, we might recover.
        return ProjectInfo(path, is_valid=True, reason="ok_no_chapters_dir")


def initialize_project_dir(
    path: Path, project_title: str = "Untitled Project", project_type: str = "novel"
) -> None:
    """Create minimal project structure at the given path."""
    _ensure_dir(path)
    story_path = path / "story.json"

    # Create images directory for all types
    _ensure_dir(path / "images")

    if not story_path.exists():
        payload = {
            "project_title": project_title,
            "project_type": project_type,
            "chapters": [],  # Used for novel
            "books": [],  # Used for series
            "content_file": "content.md",  # Used for short-story
            "format": "markdown",
            "version": 1,
            "llm_prefs": {"temperature": 0.7, "max_tokens": 2048},
            "created_at": _now_iso(),
            "tags": [],
        }
        story_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    if project_type == "short-story":
        content_path = path / "content.md"
        if not content_path.exists():
            content_path.write_text("", encoding="utf-8")

    elif project_type == "series":
        books_dir = path / "books"
        _ensure_dir(books_dir)

    else:  # novel
        chapters_dir = path / "chapters"
        _ensure_dir(chapters_dir)


def list_projects() -> List[Dict[str, str | bool]]:
    """List projects under the projects root directory.

    Returns a list of dicts: {name, path, is_valid, title}
    """
    root = get_projects_root()
    if not root.exists():
        return []
    items: List[Dict[str, str | bool]] = []
    for d in sorted([p for p in root.iterdir() if p.is_dir()]):
        info = validate_project_dir(d)
        title = d.name
        p_type = "novel"
        if info.is_valid:
            try:
                from app.config import load_story_config

                story = load_story_config(d / "story.json")
                title = story.get("project_title") or d.name
                p_type = story.get("project_type", "novel")
            except Exception:
                pass
        items.append(
            {
                "id": d.name,  # Use dir name as stable ID
                "name": d.name,
                "path": str(d),
                "is_valid": info.is_valid,
                "title": title,
                "type": p_type,
            }
        )
    return items


def write_chapter_content(chap_id: int, content: str) -> None:
    """Write content to a chapter by its ID."""
    _, path, _ = _chapter_by_id_or_404(chap_id)
    path.write_text(content, encoding="utf-8")


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
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

    _, path, _ = _chapter_by_id_or_404(chap_id)
    files = _scan_chapter_files()

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}

    target_entry = _get_chapter_metadata_entry(story, chap_id, path, files)

    if target_entry is not None:
        if title is not None:
            new_title_str = str(title).strip()
            if new_title_str.lower() != "[object object]":
                target_entry["title"] = new_title_str

        if summary is not None:
            target_entry["summary"] = summary.strip()
        if notes is not None:
            target_entry["notes"] = notes
        if private_notes is not None:
            target_entry["private_notes"] = private_notes
        if conflicts is not None:
            target_entry["conflicts"] = conflicts

        import json

        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")
    else:
        # If no entry was found in story.json, we might want to add one but for now just raise error
        raise ValueError(f"Could not find metadata entry for chapter {chap_id}")


def write_chapter_title(chap_id: int, title: str) -> None:
    """Update the title of a chapter in the story.json across all project types."""
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

    _, path, _ = _chapter_by_id_or_404(chap_id)
    files = _scan_chapter_files()

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}

    new_title_str = str(title).strip()
    if new_title_str.lower() == "[object object]":
        new_title_str = ""

    target_entry = _get_chapter_metadata_entry(story, chap_id, path, files)

    if target_entry is not None:
        target_entry["title"] = new_title_str
        import json

        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")
    else:
        # If no entry was found in story.json, we might want to add one but for now just raise error
        raise ValueError(f"Could not find metadata entry for chapter {chap_id}")


def delete_chapter(chap_id: int) -> None:
    """Delete a chapter file and remove its metadata from story.json."""
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

    _, path, _ = _chapter_by_id_or_404(chap_id)
    files = _scan_chapter_files()

    # Delete the file
    path.unlink()

    # Update story.json
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    p_type = story.get("project_type", "novel")

    if p_type == "series":
        book_id = path.parent.parent.name
        books = story.get("books", [])
        book = next((b for b in books if b.get("id") == book_id), None)
        if book:
            book_chapters = book.get("chapters", [])
            book_files = [f for f in files if f[1].parent.parent.name == book_id]

            target_id = None
            used_ids = set()
            for i, (f_idx, f_p) in enumerate(book_files):
                fname = f_p.name
                curr_match = next(
                    (
                        c
                        for c in book_chapters
                        if isinstance(c, dict)
                        and c.get("filename") == fname
                        and id(c) not in used_ids
                    ),
                    None,
                )
                if not curr_match and i < len(book_chapters):
                    candidate = book_chapters[i]
                    if id(candidate) not in used_ids:
                        if (
                            not isinstance(candidate, dict)
                            or not candidate.get("filename")
                            or candidate.get("filename") == fname
                        ):
                            curr_match = candidate

                if curr_match:
                    used_ids.add(id(curr_match))
                    if f_idx == chap_id:
                        target_id = id(curr_match)
                        break

            if target_id:
                book["chapters"] = [c for c in book_chapters if id(c) != target_id]
    else:
        chapters_data = story.get("chapters") or []
        used_ids = set()
        target_id = None
        for i, (f_idx, f_p) in enumerate(files):
            fname = f_p.name
            curr_match = next(
                (
                    c
                    for c in chapters_data
                    if isinstance(c, dict)
                    and c.get("filename") == fname
                    and id(c) not in used_ids
                ),
                None,
            )
            if not curr_match and i < len(chapters_data):
                candidate = chapters_data[i]
                if id(candidate) not in used_ids:
                    if (
                        not isinstance(candidate, dict)
                        or not candidate.get("filename")
                        or candidate.get("filename") == fname
                    ):
                        curr_match = candidate

            if curr_match:
                used_ids.add(id(curr_match))
                if f_idx == chap_id:
                    target_id = id(curr_match)
                    break

        if target_id:
            story["chapters"] = [c for c in chapters_data if id(c) != target_id]

    import json

    story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")


def create_project(name: str, project_type: str = "novel") -> Tuple[bool, str]:
    """Create a new project explicitly."""
    if not name:
        return False, "Project name is required"
    if name.strip() != name or name in (".", ".."):
        return False, "Invalid project name"

    # Generate cleaner name for filesystem
    root = get_projects_root()

    # Sanitize name for directory, preserving the Display Title in project_title later
    safe_name = "".join(
        c if c.isalnum() or c in (" ", "-", "_") else "_" for c in name
    ).strip()
    if not safe_name:
        safe_name = "Untitled_Project"

    p = root / safe_name

    # Handle collision
    if p.exists():
        # If conflicting with existing, try appending number
        counter = 1
        while (root / f"{safe_name}_{counter}").exists():
            counter += 1
        p = root / f"{safe_name}_{counter}"

    _ensure_dir(root)
    # Initialize with original Display Name
    initialize_project_dir(p, project_title=name, project_type=project_type)

    # Sanity check: Ensure it is now valid before selecting
    if not validate_project_dir(p).is_valid:
        return False, "Failed to initialize project"

    set_active_project(p)
    return True, "Project created"


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
    if not name:
        return False, "Project name is required"
    # Reject any separators or traversal
    if (
        any(ch in name for ch in ("/", "\\"))
        or name.strip() != name
        or name in (".", "..")
    ):
        return False, "Invalid project name"
    root = get_projects_root()
    p = root / name
    if not p.exists():
        _ensure_dir(root)
        initialize_project_dir(p, project_title=name, project_type="novel")
        set_active_project(p)
        return True, "Project created"
    if p.is_dir():
        info = validate_project_dir(p)
        if info.is_valid:
            set_active_project(p)
            return True, "Project loaded"
        if info.reason == "empty":
            initialize_project_dir(p, project_title=name, project_type="novel")
            set_active_project(p)
            return True, "Project created"
        return False, "Selected path is not a valid project directory"
    return False, "Selected path is not a directory"


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
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    p_type = story.get("project_type", "novel")

    # We defer detailed number calculation until we know the target context
    final_title = title

    if p_type == "short-story":
        # Cannot add chapters to short-story project
        raise ValueError("Cannot add chapters to a Short Story project (single file)")

    if p_type == "series":
        books = story.get("books", [])
        if not books:
            raise ValueError("No books in this project")

        target_book = None
        if book_id:
            target_book = next((b for b in books if b["id"] == book_id), None)
            if not target_book:
                raise ValueError(f"Book {book_id} not found")
        else:
            target_book = books[-1]
            book_id = target_book["id"]

        # Determine title if needed
        if not final_title:
            # Count chapters in this book
            current_count = len(target_book.get("chapters", []))
            final_title = f"Chapter {current_count + 1}"

        book_dir = active / "books" / book_id
        chapters_dir = book_dir / "chapters"
        _ensure_dir(chapters_dir)

        # Calculate next filename index for THIS book
        existing = [p for p in chapters_dir.glob("*.txt") if p.is_file()]
        max_idx = 0
        for p in existing:
            import re

            m = re.match(r"^(\d{4})\.txt$", p.name)
            if m:
                max_idx = max(max_idx, int(m.group(1)))

        next_local_idx = max_idx + 1
        filename = f"{next_local_idx:04d}.txt"
        path = chapters_dir / filename
        path.write_text("", encoding="utf-8")

        if "chapters" not in target_book:
            target_book["chapters"] = []
        target_book["chapters"].append(
            {"title": final_title, "summary": "", "filename": filename}
        )
        # Save story
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        # Return global ID by rescanning
        all_files = _scan_chapter_files()  # This scans filesystem
        for vid, p in all_files:
            if p.absolute() == path.absolute():
                return vid

        return 0  # Should not happen

    # Novel logic (mostly unchanged but robust)
    files = _scan_chapter_files()
    if files:
        # Novel returns (filename_int, path)
        next_idx = files[-1][0] + 1
    else:
        next_idx = 1

    if not final_title:
        final_title = f"Chapter {next_idx}"

    filename = f"{next_idx:04d}.txt"
    chapters_dir = active / "chapters"
    _ensure_dir(chapters_dir)
    path = chapters_dir / filename
    path.write_text("", encoding="utf-8")

    # Update story.json chapters array
    chapters_data = story.get("chapters") or []
    chapters_data = [_normalize_chapter_entry(c) for c in chapters_data]

    # Ensure alignment
    # If file scan shows more files than metadata, pad metadata?
    # Actually, let's just append.
    chapters_data.append({"title": final_title, "summary": "", "filename": filename})
    story["chapters"] = chapters_data

    story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

    return next_idx


def create_new_book(title: str) -> str:
    """Create a new book in a Series project."""
    active = get_active_project_dir()
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    if story.get("project_type") != "series":
        raise ValueError("Can only create books in Series projects")

    books = story.get("books", [])

    import uuid

    if not title:
        next_num = len(books) + 1
        title = f"Book {next_num}"

    bid = str(uuid.uuid4())

    books.append({"id": bid, "title": title, "chapters": []})
    story["books"] = books
    story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

    # Create dir
    b_dir = active / "books" / bid
    _ensure_dir(b_dir / "chapters")
    _ensure_dir(b_dir / "images")

    # Initialize book content file
    (b_dir / "book_content.md").write_text("", encoding="utf-8")

    return bid


def update_book_metadata(
    book_id: str,
    title: str = None,
    summary: str = None,
    notes: str = None,
    private_notes: str = None,
) -> None:
    """Update title or metadata for a book in a series project."""
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}

    books = story.get("books", [])
    target = next((b for b in books if b.get("id") == book_id), None)
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

    story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")


def read_book_content(book_id: str) -> str:
    """Read the overall intro/content for a book from its book_content.md."""
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

    b_dir = active / "books" / book_id
    c_path = b_dir / "book_content.md"
    if not c_path.exists():
        return ""
    return c_path.read_text(encoding="utf-8")


def write_book_content(book_id: str, content: str) -> None:
    """Write the overall intro/content for a book to its book_content.md."""
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

    b_dir = active / "books" / book_id
    _ensure_dir(b_dir)
    c_path = b_dir / "book_content.md"
    c_path.write_text(content, encoding="utf-8")


def update_story_metadata(
    title: str = None,
    summary: str = None,
    tags: List[str] = None,
    notes: str = None,
    private_notes: str = None,
) -> None:
    """Update general story metadata."""
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

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

    story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")


def read_story_content() -> str:
    """Read the story-level content/introduction."""
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

    story = load_story_config(active / "story.json") or {}
    p_type = story.get("project_type", "novel")

    if p_type == "short-story":
        fn = story.get("content_file", "content.md")
        c_path = active / fn
    else:
        c_path = active / "story_content.md"

    if not c_path.exists():
        return ""
    return c_path.read_text(encoding="utf-8")


def write_story_content(content: str) -> None:
    """Write the story-level content/introduction."""
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

    story = load_story_config(active / "story.json") or {}
    p_type = story.get("project_type", "novel")

    if p_type == "short-story":
        fn = story.get("content_file", "content.md")
        c_path = active / fn
    else:
        c_path = active / "story_content.md"

    c_path.write_text(content, encoding="utf-8")


def change_project_type(new_type: str) -> Tuple[bool, str]:
    """Convert the active project to a new type."""
    active = get_active_project_dir()
    if not active:
        return False, "No active project"

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    old_type = story.get("project_type", "novel")

    if old_type == new_type:
        return True, "Already this type"

    # Handle multi-step conversions
    # Short Story -> Series: Short Story -> Novel -> Series
    if old_type == "short-story" and new_type == "series":
        # First convert to novel
        ok, msg = change_project_type("novel")
        if not ok:
            return ok, msg
        # Then convert to series
        return change_project_type("series")

    # Series -> Short Story: Series -> Novel -> Short Story
    if old_type == "series" and new_type == "short-story":
        # First convert to novel
        ok, msg = change_project_type("novel")
        if not ok:
            return ok, msg
        # Then convert to short-story
        return change_project_type("short-story")

    # Short Story -> Novel
    if old_type == "short-story" and new_type == "novel":
        content_path = active / "content.md"
        content = ""
        if content_path.exists():
            content = content_path.read_text(encoding="utf-8")
            # content.md might be deleted or kept? Let's move it.
            os.remove(content_path)

        _ensure_dir(active / "chapters")
        (active / "chapters" / "0001.txt").write_text(content, encoding="utf-8")

        story["project_type"] = "novel"
        story["chapters"] = [{"title": "Chapter 1", "summary": ""}]
        if "content_file" in story:
            del story["content_file"]

    # Novel -> Short Story
    elif old_type == "novel" and new_type == "short-story":
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
        story["project_type"] = "short-story"
        if "chapters" in story:
            del story["chapters"]
        story["content_file"] = "content.md"

    # Novel -> Series
    elif old_type == "novel" and new_type == "series":
        # Create Book 1
        import uuid

        bid = str(uuid.uuid4())
        book_title = "Book 1"

        books_dir = active / "books"
        _ensure_dir(books_dir)
        book_dir = books_dir / bid
        _ensure_dir(book_dir / "chapters")
        _ensure_dir(book_dir / "images")

        # Move chapters
        chapters_dir = active / "chapters"
        if chapters_dir.exists():
            for f in chapters_dir.glob("*"):
                shutil.move(str(f), str(book_dir / "chapters" / f.name))
            shutil.rmtree(chapters_dir)

        # Move images? Existing images in `projects/X/images`?
        # Series projects have images per book? Or global images?
        # User said: "each book should have its own directory where the chapter files and images are stored in"
        # So we should move images too.
        images_dir = active / "images"
        if images_dir.exists():
            for f in images_dir.glob("*"):
                shutil.move(str(f), str(book_dir / "images" / f.name))
            # keep root images dir? logic creates it in initialize.

        story["project_type"] = "series"
        story["books"] = [
            {"id": bid, "title": book_title, "chapters": story.get("chapters", [])}
        ]
        if "chapters" in story:
            del story["chapters"]

    # Series -> Novel
    elif old_type == "series" and new_type == "novel":
        books = story.get("books", [])
        if len(books) > 1:
            return False, "Cannot convert to Novel: Project has multiple books."

        if books:
            book = books[0]
            bid = book["id"]
            book_dir = active / "books" / bid

            _ensure_dir(active / "chapters")
            _ensure_dir(active / "images")  # Root images

            # Move chapters
            if (book_dir / "chapters").exists():
                for f in (book_dir / "chapters").glob("*"):
                    shutil.move(str(f), str(active / "chapters" / f.name))

            # Move images
            if (book_dir / "images").exists():
                for f in (book_dir / "images").glob("*"):
                    shutil.move(str(f), str(active / "images" / f.name))

            story["chapters"] = book.get("chapters", [])
            shutil.rmtree(active / "books")

        story["project_type"] = "novel"
        if "books" in story:
            del story["books"]

    else:
        return False, f"Conversion from {old_type} to {new_type} not implemented."

    story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")
    return True, f"Converted to {new_type}"
