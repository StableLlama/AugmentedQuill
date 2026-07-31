# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chat api session ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from augmentedquill.services.chat.chat_session_helpers import (
    delete_all_chats,
    delete_chat,
    list_chats,
    load_chat,
    save_chat,
)
from augmentedquill.services.exceptions import NotFoundError


def list_active_chats(project_dir: Path) -> Any:
    """List active chats."""
    return list_chats(project_dir)


def load_active_chat(project_dir: Path, chat_id: str) -> Any:
    """Load Active Chat."""
    data = load_chat(project_dir, chat_id)
    if not data:
        raise NotFoundError("Chat not found")
    return data


def save_active_chat(project_dir: Path, chat_id: str, data: dict) -> Any:
    """Save Active Chat."""
    payload = dict(data)
    payload["id"] = chat_id
    save_chat(project_dir, chat_id, payload)


def delete_active_chat(project_dir: Path, chat_id: str) -> Any:
    """Delete Active Chat."""
    if delete_chat(project_dir, chat_id):
        return
    raise NotFoundError("Chat not found")


def delete_all_active_chats(project_dir: Path) -> Any:
    """Delete all active chats."""
    delete_all_chats(project_dir)
