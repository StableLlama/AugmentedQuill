# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chat api helpers unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import base64
import binascii
from typing import Any

from augmentedquill.services.projects.projects import get_active_project_dir

SUPPORTED_IMAGE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
}


def _normalize_message_content(content: Any) -> list[dict[str, Any]]:
    """Normalize user content into OpenAI-compatible content parts."""
    if content is None:
        return []

    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []

    if isinstance(content, list):
        out: list[dict[str, Any]] = []
        for part in content:
            if not isinstance(part, dict):
                raise ValueError("User message content parts must be objects")
            ptype = str(part.get("type") or "").strip()
            if ptype == "text":
                text = part.get("text")
                if not isinstance(text, str):
                    raise ValueError("Text content part is missing a string text field")
                out.append({"type": "text", "text": text})
                continue
            if ptype == "image_url":
                image_url = part.get("image_url")
                if not isinstance(image_url, dict) or not isinstance(
                    image_url.get("url"), str
                ):
                    raise ValueError("Image content part is missing image_url.url")
                out.append({"type": "image_url", "image_url": image_url})
                continue
            raise ValueError(f"Unsupported message content part type: {ptype}")
        return out

    raise ValueError("User message content must be a string or array")


def _attachment_to_content_part(attachment: dict[str, Any]) -> dict[str, Any]:
    """Convert one attachment payload into an OpenAI content part."""
    name = attachment.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Attachment name is required")
    name = name.strip()

    content = attachment.get("content")
    if not isinstance(content, str) or not content:
        raise ValueError(f"Attachment '{name}' is missing content")

    attachment_type = str(attachment.get("type") or "application/octet-stream").lower()
    size = attachment.get("size")
    size_value = size if isinstance(size, int) and size >= 0 else 0
    encoding = str(attachment.get("encoding") or "utf-8").lower()

    if encoding not in {"utf-8", "base64"}:
        raise ValueError(f"Attachment '{name}' has unsupported encoding '{encoding}'")

    if encoding == "utf-8":
        header = [
            f"[Attached file: {name}]",
            f"Content-Type: {attachment_type}",
            f"Size: {size_value} bytes",
            "Encoding: utf-8",
        ]
        return {"type": "text", "text": f"{'\n'.join(header)}\n\n{content}"}

    if attachment_type not in SUPPORTED_IMAGE_MIME_TYPES:
        raise ValueError(
            f"Attachment '{name}' is binary but not a supported image type"
        )

    try:
        base64.b64decode(content, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"Attachment '{name}' has invalid base64 content") from exc

    return {
        "type": "image_url",
        "image_url": {"url": f"data:{attachment_type};base64,{content}"},
    }


def inject_chat_attachments(messages: list[dict], attachments: Any) -> None:
    """Inject validated attachments into the last user message as content parts."""
    if attachments is None:
        return
    if not isinstance(attachments, list):
        raise ValueError("attachments must be an array")
    if not attachments:
        return

    parts = []
    for raw in attachments:
        if not isinstance(raw, dict):
            raise ValueError("attachments entries must be objects")
        parts.append(_attachment_to_content_part(raw))

    if not parts:
        return

    for msg in reversed(messages):
        if msg.get("role") != "user":
            continue
        base_parts = _normalize_message_content(msg.get("content"))
        msg["content"] = base_parts + parts
        return

    messages.append({"role": "user", "content": parts})


def _extract_text_content(content: Any) -> str | None:
    """Extract aggregate text from string/list content for filename matching."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None

    text_parts: list[str] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "text":
            continue
        text = part.get("text")
        if isinstance(text, str) and text:
            text_parts.append(text)
    if not text_parts:
        return None
    return "\n".join(text_parts)


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
            if c is None:
                msg["content"] = None
            elif isinstance(c, (str, list)):
                msg["content"] = c
            else:
                msg["content"] = str(c)
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
            # OpenAI requires content=null for assistant messages that have tool_calls
            if role == "assistant":
                msg["content"] = None
        out.append(msg)
    return out


async def inject_project_images(messages: list[dict]) -> Any:
    """Inject Project Images."""
    if not messages:
        return

    last_msg = messages[-1]
    if last_msg.get("role") != "user":
        return

    content = last_msg.get("content")
    text_for_matching = _extract_text_content(content)
    if not isinstance(text_for_matching, str) or not text_for_matching.strip():
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
        if (
            image_file.is_file()
            and image_file.suffix.lower() in allowed
            and image_file.name in text_for_matching
        ):
            found_images.append(image_file)

    if not found_images:
        return

    if isinstance(content, list):
        new_content = list(content)
    else:
        new_content = [{"type": "text", "text": text_for_matching}]

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
