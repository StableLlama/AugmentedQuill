# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the project tools unit so this responsibility stays isolated, testable, and easy to evolve.

import json as _json

from app.core.config import load_story_config
from app.services.chat.chat_tools.common import tool_message
from app.services.projects.project_helpers import _project_overview
from app.services.projects.projects import (
    create_project,
    delete_project,
    get_active_project_dir,
    list_projects,
)


async def handle_project_tool(
    name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict
):
    if name == "get_project_overview":
        data = _project_overview()
        return tool_message(name, call_id, data)

    if name == "create_project":
        p_name = args_obj.get("name")
        p_type = args_obj.get("project_type", "novel")
        if not p_name:
            return tool_message(name, call_id, {"error": "Project name is required"})
        ok, msg = create_project(p_name, p_type)
        return tool_message(name, call_id, {"ok": ok, "message": msg})

    if name == "list_projects":
        projs = list_projects()
        simple = [{"name": p["name"], "title": p["title"]} for p in projs]
        return tool_message(name, call_id, {"projects": simple})

    if name == "delete_project":
        p_name = args_obj.get("name")
        confirmed = args_obj.get("confirm", False)
        if not p_name:
            return tool_message(name, call_id, {"error": "Project name is required"})
        if not confirmed:
            return tool_message(
                name,
                call_id,
                {
                    "status": "confirmation_required",
                    "message": "This operation deletes the project. Call again with confirm=true to proceed.",
                },
            )
        ok, msg = delete_project(p_name)
        return tool_message(name, call_id, {"ok": ok, "message": msg})

    if name == "delete_book":
        book_id = args_obj.get("book_id")
        confirmed = args_obj.get("confirm", False)
        if not book_id:
            return tool_message(name, call_id, {"error": "book_id is required"})
        if not confirmed:
            return tool_message(
                name,
                call_id,
                {
                    "status": "confirmation_required",
                    "message": "This operation deletes the book. Call again with confirm=true to proceed.",
                },
            )

        active = get_active_project_dir()
        if not active:
            return tool_message(name, call_id, {"error": "No active project"})
        story_path = active / "story.json"
        story = load_story_config(story_path) or {}
        books = story.get("books", [])
        new_books = [b for b in books if str(b.get("id")) != str(book_id)]

        if len(new_books) == len(books):
            return tool_message(name, call_id, {"error": "Book not found"})

        story["books"] = new_books
        with open(story_path, "w", encoding="utf-8") as f:
            _json.dump(story, f, indent=2, ensure_ascii=False)
        mutations["story_changed"] = True
        return tool_message(name, call_id, {"ok": True, "message": "Book deleted"})

    if name == "create_new_book":
        title = args_obj.get("title")
        if not title:
            return tool_message(name, call_id, {"error": "Book title is required"})

        from app.services.projects.projects import create_new_book

        try:
            bid = create_new_book(title)
            mutations["story_changed"] = True
            return tool_message(
                name, call_id, {"book_id": bid, "message": "Book created"}
            )
        except Exception as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "change_project_type":
        new_type = args_obj.get("new_type")
        if not new_type:
            return tool_message(name, call_id, {"error": "new_type is required"})
        from app.services.projects.projects import change_project_type

        ok, msg = change_project_type(new_type)
        if ok:
            mutations["story_changed"] = True
        return tool_message(name, call_id, {"ok": ok, "message": msg})

    return None
