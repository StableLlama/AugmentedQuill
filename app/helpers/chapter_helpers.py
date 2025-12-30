import re
from pathlib import Path
from typing import List, Tuple, Dict, Any
from fastapi import HTTPException

from app.config import load_story_config


def _scan_chapter_files() -> List[Tuple[int, Path]]:
    """Return list of (index, path) for chapter files under active project.

    Supports files like '0001.txt'.
    Sorted by numeric index ascending.
    """
    from app.projects import get_active_project_dir

    active = get_active_project_dir()
    if not active:
        return []
    chapters_dir = active / "chapters"
    if not chapters_dir.exists() or not chapters_dir.is_dir():
        return []
    items: List[Tuple[int, Path]] = []
    for p in chapters_dir.glob("*.txt"):
        if not p.is_file():
            continue
        name = p.name
        m = re.match(r"^(\d{4})\.txt$", name)
        if m:
            idx = int(m.group(1))
            items.append((idx, p))
            continue
    items.sort(key=lambda t: t[0])
    return items


def _load_chapter_titles(count: int) -> List[str]:
    """Load chapter titles from story.json chapters array if present.
    Do not pad; callers decide fallbacks (e.g., filename).
    """
    from app.projects import get_active_project_dir

    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    titles = story.get("chapters") or []
    # Normalize to strings and keep as-provided; empty strings allowed (handled by caller)
    titles = [str(x) for x in titles if isinstance(x, (str, int, float))]
    return titles[:count]


def _normalize_chapter_entry(entry: Any) -> Dict[str, str]:
    """Ensures a chapter entry is a dict with 'title', 'summary', 'filename'.

    Additionally sanitizes the common bogus string "[object Object]" that can
    arrive from UI mishaps, treating it as empty so filename fallbacks apply.
    """

    def _sanitize_text(val: Any) -> str:
        s = str(val if val is not None else "").strip()
        # Treat JS's default object toString leak as empty
        if s.lower() == "[object object]":
            return ""
        return s

    if isinstance(entry, dict):
        return {
            "title": _sanitize_text(entry.get("title", "")),
            "summary": _sanitize_text(entry.get("summary", "")),
            "filename": _sanitize_text(entry.get("filename", "")),
        }
    elif isinstance(entry, (str, int, float)):
        return {"title": _sanitize_text(entry), "summary": "", "filename": ""}
    return {"title": "", "summary": "", "filename": ""}


def _chapter_by_id_or_404(chap_id: int) -> tuple[Path, int, int]:
    files = _scan_chapter_files()
    match = next(
        ((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id), None
    )
    if not match:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return match  # (idx, path, pos)
