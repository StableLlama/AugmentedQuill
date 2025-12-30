from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple
import shutil
import os

from app.config import load_story_config
from app.helpers.chapter_helpers import _scan_chapter_files, _normalize_chapter_entry

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
    - a subdirectory ("chapters") that contains at least one .txt or .md file (optional: allow empty)

    If directory is empty, it's considered initializable (not valid yet).
    """
    if not path.exists():
        return ProjectInfo(path, is_valid=False, reason="does_not_exist")
    if not path.is_dir():
        return ProjectInfo(path, is_valid=False, reason="not_a_directory")

    entries = list(path.iterdir())
    if not entries:
        return ProjectInfo(path, is_valid=False, reason="empty")

    story_path = path / "story.json"
    chapters_dir = path / "chapters"
    if (
        story_path.exists()
        and story_path.is_file()
        and chapters_dir.exists()
        and chapters_dir.is_dir()
    ):
        # Chapters may be empty; .txt/.md are valid
        has_txt_md = any(
            (f.suffix.lower() in (".txt", ".md"))
            for f in chapters_dir.glob("**/*")
            if f.is_file()
        )
        # Consider valid even if empty; the UI can add chapters later
        return ProjectInfo(
            path, is_valid=True, reason="ok" if has_txt_md else "ok_empty_chapters"
        )
    return ProjectInfo(path, is_valid=False, reason="missing_files")


def initialize_project_dir(path: Path, project_title: str = "Untitled Project") -> None:
    """Create minimal project structure at the given path.

    Creates:
    - story.json
    - chapters/ (empty)
    """
    _ensure_dir(path)
    chapters_dir = path / "chapters"
    _ensure_dir(chapters_dir)
    story_path = path / "story.json"
    if not story_path.exists():
        payload = {
            "project_title": project_title,
            "chapters": [],
            "format": "markdown",
            "llm_prefs": {"temperature": 0.7, "max_tokens": 2048},
            "created_at": _now_iso(),
        }
        story_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def list_projects() -> List[Dict[str, str | bool]]:
    """List projects under the projects root directory.

    Returns a list of dicts: {name, path, is_valid}
    """
    root = get_projects_root()
    if not root.exists():
        return []
    items: List[Dict[str, str | bool]] = []
    for d in sorted([p for p in root.iterdir() if p.is_dir()]):
        info = validate_project_dir(d)
        items.append({"name": d.name, "path": str(d), "is_valid": info.is_valid})
    return items


def write_chapter_content(chap_id: int, content: str) -> None:
    """Write content to a chapter by its ID."""
    files = _scan_chapter_files()
    match = next(
        ((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None
    )
    if not match:
        raise ValueError(f"Chapter {chap_id} not found")
    _, path, _ = match
    path.write_text(content, encoding="utf-8")


def write_chapter_summary(chap_id: int, summary: str) -> None:
    """Write summary to a chapter by its ID."""
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

    new_summary = summary.strip()

    # Locate chapter by id
    files = _scan_chapter_files()
    match = next(
        ((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None
    )
    if not match:
        raise ValueError(f"Chapter {chap_id} not found")
    _, path, pos = match

    # Load and normalize story.json
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = story.get("chapters") or []
    chapters_data = [_normalize_chapter_entry(c) for c in chapters_data]

    # Ensure alignment with number of files
    count = len(files)
    if len(chapters_data) < count:
        chapters_data.extend(
            [{"title": "", "summary": ""}] * (count - len(chapters_data))
        )

    # Update summary at position
    if pos < len(chapters_data):
        chapters_data[pos]["summary"] = new_summary
    else:
        chapters_data.append({"title": "", "summary": new_summary})

    story["chapters"] = chapters_data
    story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")


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
        initialize_project_dir(p)
        set_active_project(p)
        return True, "Project created"
    if p.is_dir():
        info = validate_project_dir(p)
        if info.is_valid:
            set_active_project(p)
            return True, "Project loaded"
        if info.reason == "empty":
            initialize_project_dir(p)
            set_active_project(p)
            return True, "Project created"
        return False, "Selected path is not a valid project directory"
    return False, "Selected path is not a directory"


def create_new_chapter(title: str = "") -> int:
    """Create a new chapter file and update story.json.

    Returns the chapter ID of the newly created chapter.
    """
    active = get_active_project_dir()
    if not active:
        raise ValueError("No active project")

    from app.helpers.chapter_helpers import (
        _scan_chapter_files,
        _normalize_chapter_entry,
    )

    # Determine next index and path
    files = _scan_chapter_files()
    next_idx = (files[-1][0] + 1) if files else 1
    filename = f"{next_idx:04d}.txt"
    chapters_dir = active / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    path = chapters_dir / filename
    path.write_text("", encoding="utf-8")  # Create empty file

    # Update story.json chapters array (append as last)
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = story.get("chapters") or []
    chapters_data = [_normalize_chapter_entry(c) for c in chapters_data]

    # Ensure chapters_data length aligns with existing files count before new chapter
    count_before = len(files)
    if len(chapters_data) < count_before:
        chapters_data.extend(
            [{"title": "", "summary": ""}] * (count_before - len(chapters_data))
        )

    # Append new chapter entry with title and empty summary
    chapters_data.append({"title": title, "summary": ""})
    story["chapters"] = chapters_data

    story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

    return next_idx
