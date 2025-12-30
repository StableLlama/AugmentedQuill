from app.projects import get_active_project_dir
from app.config import load_story_config
from .chapter_helpers import (
    _scan_chapter_files,
    _normalize_chapter_entry,
    _chapter_by_id_or_404,
)


def _project_overview() -> dict:
    """Return project title and a list of chapters with id, filename, title, summary."""
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    chapters_meta = [_normalize_chapter_entry(c) for c in (story.get("chapters") or [])]
    files = _scan_chapter_files()
    out: list[dict] = []
    for idx, path in files:
        # Position in story.json may be different than numeric filename; map by ordering
        # We use enumeration order from _scan_chapter_files as position
        pos = next((i for i, (cid, _) in enumerate(files) if cid == idx), None)
        title = None
        summary = ""
        if isinstance(pos, int) and pos < len(chapters_meta):
            title = chapters_meta[pos].get("title")
            summary = chapters_meta[pos].get("summary") or ""
        # Fallback for bogus title values
        if not title or str(title).strip() in ("[object Object]", "object Object"):
            title = path.name
        out.append(
            {
                "id": idx,
                "filename": path.name,
                "title": title,
                "summary": summary,
            }
        )
    return {
        "project_title": story.get("project_title") or (active.name if active else ""),
        "chapters": out,
    }


def _chapter_content_slice(chap_id: int, start: int = 0, max_chars: int = 8000) -> dict:
    """Return a safe slice of chapter content with metadata."""
    if start < 0:
        start = 0
    if max_chars <= 0:
        max_chars = 1
    _, path, _pos = _chapter_by_id_or_404(chap_id)
    text = path.read_text(encoding="utf-8")
    total = len(text)
    end = min(total, start + max_chars)
    return {
        "id": chap_id,
        "start": start,
        "end": end,
        "total": total,
        "content": text[start:end],
    }
