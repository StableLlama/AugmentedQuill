# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import json as _json

from app.core.config import load_story_config
from app.services.chat.chat_tools.common import tool_message
from app.services.projects.projects import (
    get_active_project_dir,
    read_book_content,
    read_story_content,
    update_book_metadata,
    update_story_metadata,
    write_book_content,
    write_story_content,
)


async def handle_story_tool(
    name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict
):
    if name == "get_story_metadata":
        active = get_active_project_dir()
        story = load_story_config((active / "story.json") if active else None) or {}
        val = {
            "title": story.get("project_title", ""),
            "summary": story.get("story_summary", ""),
            "notes": story.get("notes", ""),
            "tags": story.get("tags", []),
            "project_type": story.get("project_type", "novel"),
        }
        return tool_message(name, call_id, val)

    if name == "update_story_metadata":
        title = args_obj.get("title")
        summary = args_obj.get("summary")
        notes = args_obj.get("notes")
        tags = args_obj.get("tags")

        try:
            update_story_metadata(title=title, summary=summary, notes=notes, tags=tags)
            mutations["story_changed"] = True
            return tool_message(name, call_id, {"ok": True})
        except Exception as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "read_story_content":
        try:
            content = read_story_content()
            return tool_message(name, call_id, {"content": content})
        except Exception as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "write_story_content":
        content = args_obj.get("content", "")

        try:
            write_story_content(content)
            mutations["story_changed"] = True
            return tool_message(name, call_id, {"ok": True})
        except Exception as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "get_book_metadata":
        book_id = args_obj.get("book_id")
        active = get_active_project_dir()
        story = load_story_config((active / "story.json") if active else None) or {}
        books = story.get("books", [])
        target = next((b for b in books if b.get("id") == book_id), None)
        if not target:
            return tool_message(
                name, call_id, {"error": f"Book ID {book_id} not found"}
            )
        return tool_message(
            name,
            call_id,
            {
                "title": target.get("title", ""),
                "summary": target.get("summary", ""),
                "notes": target.get("notes", ""),
            },
        )

    if name == "update_book_metadata":
        book_id = args_obj.get("book_id")
        title = args_obj.get("title")
        summary = args_obj.get("summary")
        notes = args_obj.get("notes")

        try:
            update_book_metadata(book_id, title=title, summary=summary, notes=notes)
            mutations["story_changed"] = True
            return tool_message(name, call_id, {"ok": True})
        except Exception as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "read_book_content":
        book_id = args_obj.get("book_id")

        try:
            content = read_book_content(book_id)
            return tool_message(name, call_id, {"content": content})
        except Exception as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "write_book_content":
        book_id = args_obj.get("book_id")
        content = args_obj.get("content", "")

        try:
            write_book_content(book_id, content)
            mutations["story_changed"] = True
            return tool_message(name, call_id, {"ok": True})
        except Exception as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "get_story_summary":
        active = get_active_project_dir()
        story = load_story_config((active / "story.json") if active else None) or {}
        summary = story.get("story_summary", "")
        return tool_message(name, call_id, {"story_summary": summary})

    if name == "get_story_tags":
        active = get_active_project_dir()
        story = load_story_config((active / "story.json") if active else None) or {}
        tags = story.get("tags", [])
        return tool_message(name, call_id, {"tags": tags})

    if name == "set_story_tags":
        tags = args_obj.get("tags")
        if not isinstance(tags, list):
            return tool_message(
                name, call_id, {"error": "tags must be an array of strings"}
            )

        active = get_active_project_dir()
        if not active:
            return tool_message(name, call_id, {"error": "No active project"})
        story_path = active / "story.json"
        story = load_story_config(story_path) or {}
        story["tags"] = tags
        with open(story_path, "w", encoding="utf-8") as f:
            _json.dump(story, f, indent=2, ensure_ascii=False)
        mutations["story_changed"] = True
        return tool_message(
            name,
            call_id,
            {"tags": tags, "message": "Story tags updated successfully"},
        )

    if name == "sync_story_summary":
        mode = str(args_obj.get("mode", "")).lower()
        from app.services.story.story_generation_ops import generate_story_summary

        data = await generate_story_summary(mode=mode)
        mutations["story_changed"] = True
        return tool_message(name, call_id, data)

    if name == "write_story_summary":
        summary = str(args_obj.get("summary", "")).strip()
        active = get_active_project_dir()
        if not active:
            return tool_message(name, call_id, {"error": "No active project"})
        story_path = active / "story.json"
        story = load_story_config(story_path) or {}
        story["story_summary"] = summary
        with open(story_path, "w", encoding="utf-8") as f:
            _json.dump(story, f, indent=2, ensure_ascii=False)
        mutations["story_changed"] = True
        return tool_message(
            name,
            call_id,
            {"summary": summary, "message": "Story summary updated successfully"},
        )

    return None
