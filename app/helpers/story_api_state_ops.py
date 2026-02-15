from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from app.config import load_story_config
from app.helpers.chapter_helpers import _chapter_by_id_or_404, _normalize_chapter_entry
from app.projects import get_active_project_dir


def get_active_story_or_http_error() -> tuple[Path, Path, dict]:
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    return active, story_path, story


def get_chapter_locator(chap_id: int) -> tuple[int, Path, int]:
    return _chapter_by_id_or_404(chap_id)


def read_text_or_http_500(path: Path, message: str = "Failed to read chapter") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{message}: {exc}")


def get_normalized_chapters(story: dict) -> list[dict]:
    return [_normalize_chapter_entry(chapter) for chapter in story.get("chapters", [])]


def ensure_chapter_slot(chapters_data: list[dict], pos: int) -> None:
    if pos >= len(chapters_data):
        chapters_data.extend(
            [{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1)
        )


def collect_chapter_summaries(chapters_data: list[dict]) -> list[str]:
    chapter_summaries: list[str] = []
    for index, chapter in enumerate(chapters_data):
        summary = chapter.get("summary", "").strip()
        title = chapter.get("title", "").strip() or f"Chapter {index + 1}"
        if summary:
            chapter_summaries.append(f"{title}:\n{summary}")
    return chapter_summaries
