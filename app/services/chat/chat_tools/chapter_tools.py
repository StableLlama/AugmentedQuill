# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import json as _json

from app.core.config import load_story_config
from app.services.chapters.chapter_helpers import _chapter_by_id_or_404
from app.services.chat.chat_tools.common import tool_message
from app.services.projects.project_helpers import (
    _chapter_content_slice,
    _project_overview,
)
from app.services.story.story_generation_ops import (
    continue_chapter_from_summary,
    generate_chapter_summary,
    write_chapter_from_summary,
)
from app.services.projects.projects import (
    get_active_project_dir,
    write_chapter_content,
    write_chapter_summary,
    write_chapter_title,
)


def _overview_chapters():
    ov = _project_overview()
    chapters = []
    if ov.get("project_type") == "series":
        for book in ov.get("books", []):
            chapters.extend(book.get("chapters", []))
    else:
        chapters = ov.get("chapters", [])
    return ov, chapters


async def handle_chapter_tool(
    name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict
):
    if name == "get_chapter_metadata":
        chap_id = args_obj.get("chap_id")
        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})
        from app.services.chapters.chapter_helpers import _get_chapter_metadata_entry

        active = get_active_project_dir()
        story = load_story_config((active / "story.json") if active else None) or {}
        _, path, _ = _chapter_by_id_or_404(chap_id)
        meta = _get_chapter_metadata_entry(story, chap_id, path) or {}
        return tool_message(
            name,
            call_id,
            {
                "title": meta.get("title", "") or path.name,
                "summary": meta.get("summary", ""),
                "notes": meta.get("notes", ""),
                "conflicts": meta.get("conflicts") or [],
            },
        )

    if name == "update_chapter_metadata":
        chap_id = args_obj.get("chap_id")
        title = args_obj.get("title")
        summary = args_obj.get("summary")
        notes = args_obj.get("notes")
        private_notes = args_obj.get("private_notes")
        conflicts = args_obj.get("conflicts")
        if isinstance(conflicts, str):
            try:
                conflicts = _json.loads(conflicts)
            except Exception:
                conflicts = None

        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})

        try:
            from app.services.projects.projects import update_chapter_metadata

            update_chapter_metadata(
                chap_id,
                title=title,
                summary=summary,
                notes=notes,
                private_notes=private_notes,
                conflicts=conflicts,
            )
            mutations["story_changed"] = True
            return tool_message(name, call_id, {"ok": True})
        except Exception as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "get_chapter_summaries":
        ov = _project_overview()
        p_type = ov.get("project_type", "novel")

        all_chapters = []
        if p_type == "series":
            for book in ov.get("books", []):
                all_chapters.extend(book.get("chapters", []))
        else:
            all_chapters = ov.get("chapters", [])

        summaries = []
        for chapter in all_chapters:
            if isinstance(chapter, dict):
                chap_id = chapter.get("id")
                title = chapter.get("title", "").strip() or f"Chapter {chap_id}"
                summary = chapter.get("summary", "").strip()
                if summary:
                    summaries.append(
                        {"chapter_id": chap_id, "title": title, "summary": summary}
                    )
        return tool_message(name, call_id, {"chapter_summaries": summaries})

    if name == "get_chapter_content":
        chap_id = args_obj.get("chap_id")
        if chap_id is None:
            ac = payload.get("active_chapter_id")
            if isinstance(ac, int):
                chap_id = ac
        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})
        start = int(args_obj.get("start", 0) or 0)
        max_chars = int(args_obj.get("max_chars", 8000) or 8000)
        max_chars = max(1, min(8000, max_chars))
        data = _chapter_content_slice(chap_id, start=start, max_chars=max_chars)
        return tool_message(name, call_id, data)

    if name == "write_chapter_content":
        chap_id = args_obj.get("chap_id")
        content = args_obj.get("content")
        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})
        if not isinstance(content, str):
            return tool_message(name, call_id, {"error": "content is required"})
        try:
            write_chapter_content(chap_id, content)
            mutations["story_changed"] = True
            return tool_message(
                name,
                call_id,
                {"message": f"Content written to chapter {chap_id} successfully"},
            )
        except ValueError as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "write_chapter_summary":
        chap_id = args_obj.get("chap_id")
        summary = args_obj.get("summary")
        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})
        if not isinstance(summary, str):
            return tool_message(name, call_id, {"error": "summary is required"})
        try:
            write_chapter_summary(chap_id, summary)
            mutations["story_changed"] = True
            return tool_message(
                name,
                call_id,
                {"message": f"Summary written to chapter {chap_id} successfully"},
            )
        except ValueError as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "sync_summary":
        chap_id = args_obj.get("chap_id")
        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})
        mode = str(args_obj.get("mode", "")).lower()
        data = await generate_chapter_summary(chap_id=chap_id, mode=mode)
        mutations["story_changed"] = True
        return tool_message(name, call_id, data)

    if name == "write_chapter":
        chap_id = args_obj.get("chap_id")
        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})
        data = await write_chapter_from_summary(chap_id=chap_id)
        mutations["story_changed"] = True
        return tool_message(name, call_id, data)

    if name == "continue_chapter":
        chap_id = args_obj.get("chap_id")
        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})
        data = await continue_chapter_from_summary(chap_id=chap_id)
        mutations["story_changed"] = True
        return tool_message(name, call_id, data)

    if name == "create_new_chapter":
        title = str(args_obj.get("title", "")).strip()
        book_id = args_obj.get("book_id")

        active = get_active_project_dir()
        if not active:
            return tool_message(name, call_id, {"error": "No active project"})
        from app.services.projects.projects import create_new_chapter

        try:
            chap_id = create_new_chapter(title, book_id=book_id)
            mutations["story_changed"] = True
            return tool_message(
                name,
                call_id,
                {
                    "chap_id": chap_id,
                    "title": title,
                    "message": f"New chapter {chap_id} created successfully",
                },
            )
        except Exception as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "get_chapter_heading":
        chap_id = args_obj.get("chap_id")
        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})
        _chapter_by_id_or_404(chap_id)
        _, chapters = _overview_chapters()
        chapter = next((c for c in chapters if c["id"] == chap_id), None)
        heading = chapter.get("title", "") if chapter else ""
        return tool_message(name, call_id, {"heading": heading})

    if name == "write_chapter_heading":
        chap_id = args_obj.get("chap_id")
        heading = str(args_obj.get("heading", "")).strip()
        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})
        write_chapter_title(chap_id, heading)
        mutations["story_changed"] = True
        return tool_message(
            name,
            call_id,
            {
                "heading": heading,
                "message": f"Heading for chapter {chap_id} updated successfully",
            },
        )

    if name == "get_chapter_summary":
        chap_id = args_obj.get("chap_id")
        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})
        _chapter_by_id_or_404(chap_id)
        _, chapters = _overview_chapters()
        chapter = next((c for c in chapters if c["id"] == chap_id), None)
        summary = chapter.get("summary", "") if chapter else ""
        return tool_message(name, call_id, {"summary": summary})

    if name == "delete_chapter":
        chap_id = args_obj.get("chap_id")
        confirmed = args_obj.get("confirm", False)
        if not isinstance(chap_id, int):
            return tool_message(name, call_id, {"error": "chap_id is required"})
        if not confirmed:
            return tool_message(
                name,
                call_id,
                {
                    "status": "confirmation_required",
                    "message": "This operation deletes the chapter. Call again with confirm=true to proceed.",
                },
            )

        active = get_active_project_dir()
        from app.services.chapters.chapter_helpers import _scan_chapter_files

        files = _scan_chapter_files()
        match = next(((idx, p) for (idx, p) in files if idx == chap_id), None)
        if not match:
            return tool_message(name, call_id, {"error": "Chapter not found"})

        _, path = match
        if path.exists():
            path.unlink()

        story_path = active / "story.json"
        story = load_story_config(story_path) or {}
        chapters = story.get("chapters", [])
        if chap_id < len(chapters):
            idx_to_remove = chap_id - 1
            if 0 <= idx_to_remove < len(chapters):
                chapters.pop(idx_to_remove)
                story["chapters"] = chapters
                with open(story_path, "w", encoding="utf-8") as f:
                    _json.dump(story, f, indent=2, ensure_ascii=False)

        mutations["story_changed"] = True
        return tool_message(name, call_id, {"ok": True, "message": "Chapter deleted"})

    return None
