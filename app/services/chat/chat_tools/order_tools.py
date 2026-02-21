# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the order tools unit so this responsibility stays isolated, testable, and easy to evolve.

from app.services.chat.chat_tools.common import tool_message


async def handle_order_tool(
    name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict
):
    if name == "reorder_chapters":
        chapter_ids = args_obj.get("chapter_ids", [])
        book_id = args_obj.get("book_id")

        if not isinstance(chapter_ids, list):
            return tool_message(name, call_id, {"error": "chapter_ids must be a list"})

        try:
            from app.api.chapters_routes.mutate import api_reorder_chapters

            payload = {"chapter_ids": chapter_ids}
            if book_id:
                payload["book_id"] = book_id

            class MockRequest:
                async def json(self):
                    return payload

            mock_request = MockRequest()
            result = await api_reorder_chapters(mock_request)

            if result.status_code == 200:
                mutations["story_changed"] = True
                return tool_message(
                    name,
                    call_id,
                    {"ok": True, "message": "Chapters reordered successfully"},
                )
            return tool_message(
                name,
                call_id,
                {
                    "error": (
                        result.body.decode()
                        if hasattr(result, "body")
                        else "Reorder failed"
                    )
                },
            )
        except Exception as e:
            return tool_message(name, call_id, {"error": str(e)})

    if name == "reorder_books":
        book_ids = args_obj.get("book_ids", [])

        if not isinstance(book_ids, list):
            return tool_message(name, call_id, {"error": "book_ids must be a list"})

        try:
            from app.api.chapters_routes.mutate import api_reorder_books

            class MockRequest:
                async def json(self):
                    return {"book_ids": book_ids}

            mock_request = MockRequest()
            result = await api_reorder_books(mock_request)

            if result.status_code == 200:
                mutations["story_changed"] = True
                return tool_message(
                    name,
                    call_id,
                    {"ok": True, "message": "Books reordered successfully"},
                )
            return tool_message(
                name,
                call_id,
                {
                    "error": (
                        result.body.decode()
                        if hasattr(result, "body")
                        else "Reorder failed"
                    )
                },
            )
        except Exception as e:
            return tool_message(name, call_id, {"error": str(e)})

    return None
