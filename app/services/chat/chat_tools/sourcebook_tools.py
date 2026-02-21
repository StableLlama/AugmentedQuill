# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the sourcebook tools unit so this responsibility stays isolated, testable, and easy to evolve.

from app.services.chat.chat_tools.common import tool_message
from app.services.sourcebook.sourcebook_helpers import (
    sb_create,
    sb_delete,
    sb_get,
    sb_search,
    sb_update,
)


async def handle_sourcebook_tool(
    name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict
):
    if name == "search_sourcebook":
        query = args_obj.get("query", "")
        return tool_message(name, call_id, sb_search(query))

    if name == "get_sourcebook_entry":
        name_or_id = args_obj.get("name_or_id", "")
        entry = sb_get(name_or_id)
        if not entry:
            return tool_message(name, call_id, {"error": "Not found"})
        return tool_message(name, call_id, entry)

    if name == "create_sourcebook_entry":
        new_entry = sb_create(
            name=args_obj.get("name"),
            description=args_obj.get("description"),
            category=args_obj.get("category"),
            synonyms=args_obj.get("synonyms", []),
        )
        if "error" not in new_entry:
            mutations["story_changed"] = True
        return tool_message(name, call_id, new_entry)

    if name == "update_sourcebook_entry":
        result = sb_update(
            name_or_id=args_obj.get("name_or_id"),
            name=args_obj.get("name"),
            description=args_obj.get("description"),
            category=args_obj.get("category"),
            synonyms=args_obj.get("synonyms"),
        )
        if "error" not in result:
            mutations["story_changed"] = True
        return tool_message(name, call_id, result)

    if name == "delete_sourcebook_entry":
        name_or_id = args_obj.get("name_or_id")
        deleted = sb_delete(name_or_id)
        if deleted:
            mutations["story_changed"] = True
            return tool_message(name, call_id, {"ok": True})
        return tool_message(name, call_id, {"error": "Not found"})

    return None
