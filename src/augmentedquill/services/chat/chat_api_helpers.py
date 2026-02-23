# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chat api helpers unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import base64
from typing import Any

from augmentedquill.services.projects.projects import get_active_project_dir


def normalize_chat_messages(val: Any) -> list[dict]:
    """Preserve OpenAI message fields including tool calls.

    Keeps: role, content (may be None), name, tool_call_id, tool_calls.
    """
    arr = val if isinstance(val, list) else []
    out: list[dict] = []
    for m in arr:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role", "")).strip().lower() or "user"
        msg: dict = {"role": role}
        # content can be None (e.g., assistant with tool_calls)
        if "content" in m:
            c = m.get("content")
            msg["content"] = None if c is None else str(c)
        # pass-through optional tool fields
        name = m.get("name")
        if isinstance(name, str) and name:
            msg["name"] = name
        tcid = m.get("tool_call_id")
        if isinstance(tcid, str) and tcid:
            msg["tool_call_id"] = tcid
        tcs = m.get("tool_calls")
        if isinstance(tcs, list) and tcs:
            msg["tool_calls"] = tcs
        out.append(msg)
    return out


async def inject_project_images(messages: list[dict]):
    """Inject Project Images."""
    if not messages:
        return

    last_msg = messages[-1]
    if last_msg.get("role") != "user":
        return

    content = last_msg.get("content")
    if not isinstance(content, str):
        return

    active = get_active_project_dir()
    if not active:
        return

    images_dir = active / "images"
    if not images_dir.exists():
        return

    found_images = []
    allowed = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

    for image_file in images_dir.iterdir():
        if image_file.is_file() and image_file.suffix.lower() in allowed:
            if image_file.name in content:
                found_images.append(image_file)

    if not found_images:
        return

    new_content = [{"type": "text", "text": content}]

    for path in found_images:
        try:
            mime = "image/png"
            if path.suffix.lower() in [".jpg", ".jpeg"]:
                mime = "image/jpeg"
            elif path.suffix.lower() == ".webp":
                mime = "image/webp"
            elif path.suffix.lower() == ".gif":
                mime = "image/gif"

            with open(path, "rb") as file_handle:
                b64 = base64.b64encode(file_handle.read()).decode("utf-8")

            new_content.append(
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
            )
        except Exception:
            pass

    last_msg["content"] = new_content
