# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the common unit so this responsibility stays isolated, testable, and easy to evolve."""

import json as _json


def tool_message(name: str, call_id: str, content) -> dict:
    """Tool Message."""
    return {
        "role": "tool",
        "tool_call_id": call_id,
        "name": name,
        "content": _json.dumps(content),
    }


def tool_error(name: str, call_id: str, message: str) -> dict:
    return tool_message(name, call_id, {"error": message})
