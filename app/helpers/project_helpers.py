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
    p_type = story.get("project_type", "medium")

    base_info = {
        "project_title": story.get("project_title") or (active.name if active else ""),
        "project_type": p_type,
    }

    if p_type == "small":
        fn = story.get("content_file", "content.md")

        # Use metadata from story.json if available
        chapters = story.get("chapters", [])
        title = "Story Content"
        summary = "Full content of the story"

        if chapters and len(chapters) > 0:
            c0 = chapters[0]
            if isinstance(c0, dict):
                t = c0.get("title")
                if t and str(t).strip():
                    title = str(t).strip()
                s = c0.get("summary")
                if s and str(s).strip():
                    summary = str(s).strip()

        return {
            **base_info,
            "content_file": fn,
            "chapters": [
                {
                    "id": 1,
                    "filename": fn,
                    "title": title,
                    "summary": summary,
                }
            ],
        }

    if p_type == "large":
        files = _scan_chapter_files()
        books = story.get("books", [])
        enriched_books = []
        for b in books:
            bid = b.get("id")
            b_chapters = []
            # Find chapters belonging to this book
            for vid, path in files:
                # Naive path check for book ID in path
                # Path should be .../books/<BID>/chapters/...
                if f"books/{bid}/" in str(path):
                    # Could also extract title/summary from b.get("chapters") if we synced it
                    # For now just list IDs and filenames
                    b_chapters.append({"id": vid, "filename": path.name})
            enriched_books.append({**b, "active_chapters": b_chapters})
        return {**base_info, "books": enriched_books}

    chapters_meta = [_normalize_chapter_entry(c) for c in (story.get("chapters") or [])]
    files = _scan_chapter_files()
    out: list[dict] = []
    for idx, path in files:
        pos = next((i for i, (cid, _) in enumerate(files) if cid == idx), None)
        title = None
        summary = ""
        if isinstance(pos, int) and pos < len(chapters_meta):
            title = chapters_meta[pos].get("title")
            summary = chapters_meta[pos].get("summary") or ""
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
    return {**base_info, "chapters": out}


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
