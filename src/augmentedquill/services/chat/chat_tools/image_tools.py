# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the image tools unit so this responsibility stays isolated, testable, and easy to evolve."""

import base64
import uuid
from pathlib import Path
from typing import Any, Literal

from pydantic import Field

from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
    ToolModel,
    chat_tool,
    resolve_tool_role,
)

# Pydantic models for tool parameters


class ManageImagesCreateData(ToolModel):
    """Payload for creating image placeholders."""

    description: str = Field(..., description="Description of the desired image")
    title: str | None = Field(None, description="Optional title for the image")


class ManageImagesMetadataData(ToolModel):
    """Payload for setting image metadata."""

    filename: str = Field(..., description="The filename of the image")
    title: str | None = Field(None, description="New title for the image")
    description: str | None = Field(None, description="New description for the image")


class ManageImagesParams(ToolModel):
    """Action router parameters for manage_images."""

    action: Literal[
        "list",
        "generate_description",
        "create_placeholder",
        "set_metadata",
    ] = Field(
        ...,
        description=(
            "Image action: 'list', 'generate_description', 'create_placeholder', "
            "or 'set_metadata'."
        ),
    )
    filename: str | None = Field(
        None,
        description="Required for action='generate_description'.",
    )
    create_data: ManageImagesCreateData | None = Field(
        None,
        description="Required for action='create_placeholder'.",
    )
    metadata_data: ManageImagesMetadataData | None = Field(
        None,
        description="Required for action='set_metadata'.",
    )


# Helper function for generating image descriptions (not a tool itself)


async def _tool_generate_image_description(filename: str, payload: dict) -> str:
    """Tool Generate Image Description."""
    from augmentedquill.core.config import load_story_config
    from augmentedquill.core.prompts import (
        get_system_message,
        get_user_prompt,
        load_model_prompt_overrides,
    )
    from augmentedquill.services.llm import llm
    from augmentedquill.services.projects.projects import get_active_project_dir
    from augmentedquill.utils.image_helpers import get_images_dir, update_image_metadata

    images_dir = get_images_dir()
    if not images_dir:
        return "Error: No active project."

    filename = Path(filename).name
    img_path = images_dir / filename

    if not img_path.exists():
        return f"Error: Image {filename} does not exist on disk."

    try:
        try:
            base_url, api_key, model_id, timeout_s, model_name = (
                llm.resolve_openai_credentials(payload, model_type="EDITING")
            )
        except Exception:
            base_url = payload.get("base_url") or "http://localhost"
            api_key = payload.get("api_key")
            model_id = payload.get("model") or payload.get("model_name") or "dummy"
            timeout_s = int(payload.get("timeout_s") or 60)
            model_name = payload.get("model_name")

        # Security: Prevent SSRF by validating the base_url
        from augmentedquill.services.llm import llm_completion_ops

        llm_completion_ops._validate_base_url(base_url)

        mime_type = "image/png"
        s = img_path.suffix.lower()
        if s in [".jpg", ".jpeg"]:
            mime_type = "image/jpeg"
        elif s == ".webp":
            mime_type = "image/webp"
        elif s == ".gif":
            mime_type = "image/gif"

        with open(img_path, "rb") as f:
            base64_image = base64.b64encode(f.read()).decode("utf-8")

        active = get_active_project_dir()
        story = load_story_config((active / "story.json") if active else None) or {}
        project_lang = str(story.get("language", "en") or "en")

        from augmentedquill.core.config import BASE_DIR, load_machine_config

        machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
        model_overrides = load_model_prompt_overrides(machine_config, model_name)
        system_prompt = get_system_message(
            "image_describer",
            model_overrides,
            language=project_lang,
        )
        user_prompt = get_user_prompt("image_describer_request", language=project_lang)

        messages = [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{base64_image}"},
                    },
                ],
            },
        ]

        data = await llm.unified_chat_complete(
            caller_id="chat_tool.image.generate_description",
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
            model_name=model_name,
        )

        content = data.get("content")
        if content:
            update_image_metadata(filename, description=content)
            return content
        return "Error: Failed to generate description."

    except Exception as e:
        return f"Error generating description: {e!s}"


# Tool implementations with co-located schemas


@chat_tool(
    description=(
        "Unified image manager. Use action='list' to list project images, "
        "action='generate_description' (filename required) to describe an image, "
        "action='create_placeholder' (create_data required) to add a placeholder, "
        "and action='set_metadata' (metadata_data required) to update image metadata."
    ),
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="image-admin",
)
async def manage_images(
    params: ManageImagesParams, payload: dict, mutations: dict
) -> Any:
    """Route image actions to existing image helper functions."""
    role = resolve_tool_role(payload)
    chat_only_actions = {"generate_description", "set_metadata"}
    if role != CHAT_ROLE and params.action in chat_only_actions:
        return {
            "error": "Action unavailable for model role",
            "details": {
                "tool": "manage_images",
                "action": params.action,
                "model_role": role,
                "allowed_roles": [CHAT_ROLE],
            },
        }

    if params.action == "list":
        from augmentedquill.utils.image_helpers import get_project_images

        imgs = get_project_images()
        return [
            {
                "filename": i["filename"],
                "description": i["description"],
                "title": i.get("title", ""),
                "is_placeholder": i["is_placeholder"],
            }
            for i in imgs
        ]

    if params.action == "generate_description":
        if not params.filename:
            return {"error": "filename is required when action='generate_description'."}
        desc = await _tool_generate_image_description(params.filename, payload)
        if not str(desc).startswith("Error:"):
            mutations["story_changed"] = True
        return {"description": desc}

    if params.action == "create_placeholder":
        if params.create_data is None:
            return {
                "error": "create_data is required when action='create_placeholder'."
            }
        from augmentedquill.utils.image_helpers import update_image_metadata

        filename = f"placeholder_{uuid.uuid4().hex[:8]}.png"
        update_image_metadata(
            filename,
            description=params.create_data.description,
            title=params.create_data.title,
        )
        mutations["story_changed"] = True
        return {
            "filename": filename,
            "description": params.create_data.description,
            "title": params.create_data.title,
        }

    if params.action == "set_metadata":
        if params.metadata_data is None:
            return {"error": "metadata_data is required when action='set_metadata'."}
        from augmentedquill.utils.image_helpers import update_image_metadata

        update_image_metadata(
            params.metadata_data.filename,
            description=params.metadata_data.description,
            title=params.metadata_data.title,
        )
        mutations["story_changed"] = True
        return {"ok": True}

    return {"error": f"Unsupported action: {params.action}"}


# ---------------------------------------------------------------------------
# EDITING: insert an image reference into chapter text
# ---------------------------------------------------------------------------


class InsertImageInChapterParams(ToolModel):
    """Parameters for inserting an image reference into a chapter."""

    chap_id: int = Field(..., description="The numeric ID of the chapter.")
    filename: str = Field(
        ...,
        description="The image filename (from list_images or create_image_placeholder).",
    )
    position: str = Field(
        "end",
        description=(
            "Where to insert the image reference: 'end' appends at the very end, "
            "'marker' replaces the ~~~ marker if present, "
            "or 'after_paragraph:N' inserts after the Nth paragraph (1-based)."
        ),
    )
    caption: str | None = Field(
        None, description="Optional caption text for the image reference."
    )


@chat_tool(
    description=(
        "Insert an image reference (Markdown image tag) at a chosen location inside a chapter. "
        "Use list_images or create_image_placeholder to obtain a valid filename first."
    ),
    allowed_roles=(EDITING_ROLE,),
    capability="prose-write",
)
async def insert_image_in_chapter(
    params: InsertImageInChapterParams, payload: dict, mutations: dict
) -> Any:
    """Insert Image In Chapter."""
    from augmentedquill.services.chapters.chapter_helpers import _chapter_by_id_or_404
    from augmentedquill.services.projects.projects import write_chapter_content

    # Security: sanitize filename (no path traversal)
    filename = Path(params.filename).name

    _chap_id, path, _pos = _chapter_by_id_or_404(params.chap_id)
    text = path.read_text(encoding="utf-8")

    caption_text = params.caption or filename
    image_md = f"\n\n![{caption_text}]({filename})\n"

    position = (params.position or "end").strip().lower()

    if position == "end":
        new_text = text.rstrip() + image_md
    elif position == "marker":
        MARKER = "~~~"
        idx = text.find(MARKER)
        if idx < 0:
            return {
                "error": f"Marker '{MARKER}' not found in chapter. Use position='end' instead."
            }
        new_text = text[:idx] + image_md.strip() + text[idx + len(MARKER) :]
    elif position.startswith("after_paragraph:"):
        try:
            para_n = int(position.split(":", 1)[1])
        except (IndexError, ValueError):
            return {
                "error": f"Invalid position '{params.position}'. Expected 'after_paragraph:N'."
            }
        paragraphs = text.split("\n\n")
        if para_n < 1 or para_n > len(paragraphs):
            return {
                "error": f"Paragraph index {para_n} out of range (1–{len(paragraphs)})."
            }
        paragraphs.insert(para_n, image_md.strip())
        new_text = "\n\n".join(paragraphs)
    else:
        return {
            "error": f"Unknown position '{params.position}'. Use 'end', 'marker', or 'after_paragraph:N'."
        }

    write_chapter_content(params.chap_id, new_text)
    mutations["story_changed"] = True
    return {"ok": True, "filename": filename, "chap_id": params.chap_id}
