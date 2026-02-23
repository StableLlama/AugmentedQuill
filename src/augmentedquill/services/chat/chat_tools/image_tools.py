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

from pydantic import BaseModel, Field

from augmentedquill.services.chat.chat_tool_decorator import chat_tool

# Pydantic models for tool parameters


class ListImagesParams(BaseModel):
    """Parameters for list_images (no parameters needed)."""

    pass


class GenerateImageDescriptionParams(BaseModel):
    """Parameters for generating image description."""

    filename: str = Field(..., description="The filename of the image")


class CreateImagePlaceholderParams(BaseModel):
    """Parameters for creating an image placeholder."""

    description: str = Field(..., description="Description of the desired image")
    title: str | None = Field(None, description="Optional title for the image")


class SetImageMetadataParams(BaseModel):
    """Parameters for setting image metadata."""

    filename: str = Field(..., description="The filename of the image")
    title: str | None = Field(None, description="New title for the image")
    description: str | None = Field(None, description="New description for the image")


# Helper function for generating image descriptions (not a tool itself)


async def _tool_generate_image_description(filename: str, payload: dict) -> str:
    from augmentedquill.services.llm import llm
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
            base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
                payload, model_type="EDITING"
            )
        except Exception:
            base_url = payload.get("base_url") or "http://localhost"
            api_key = payload.get("api_key")
            model_id = payload.get("model") or payload.get("model_name") or "dummy"
            timeout_s = int(payload.get("timeout_s") or 60)

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

        messages = [
            {
                "role": "system",
                "content": "You are a helpful assistant that describes images. Provide a detailed description of the image.",
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Describe this image."},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{base64_image}"},
                    },
                ],
            },
        ]

        data = await llm.unified_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )

        content = data.get("content")
        if content:
            update_image_metadata(filename, description=content)
            return content
        return "Error: Failed to generate description."

    except Exception as e:
        return f"Error generating description: {str(e)}"


# Tool implementations with co-located schemas


@chat_tool(
    description="List all images in the project with their filenames, descriptions, titles, and placeholder status."
)
async def list_images(params: ListImagesParams, payload: dict, mutations: dict):
    from augmentedquill.utils.image_helpers import get_project_images

    imgs = get_project_images()
    simple = [
        {
            "filename": i["filename"],
            "description": i["description"],
            "title": i.get("title", ""),
            "is_placeholder": i["is_placeholder"],
        }
        for i in imgs
    ]
    return simple


@chat_tool(
    description="Generate a detailed description for an existing image using the EDIT LLM's vision capabilities."
)
async def generate_image_description(
    params: GenerateImageDescriptionParams, payload: dict, mutations: dict
):
    desc = await _tool_generate_image_description(params.filename, payload)
    return {"description": desc}


@chat_tool(
    description="Create a new image placeholder with a description. Useful for noting images to be created later."
)
async def create_image_placeholder(
    params: CreateImagePlaceholderParams, payload: dict, mutations: dict
):
    from augmentedquill.utils.image_helpers import update_image_metadata

    filename = f"placeholder_{uuid.uuid4().hex[:8]}.png"
    update_image_metadata(filename, description=params.description, title=params.title)

    return {
        "filename": filename,
        "description": params.description,
        "title": params.title,
    }


@chat_tool(
    description="Update the title and/or description metadata for an existing image. Provide only the fields you want to change."
)
async def set_image_metadata(
    params: SetImageMetadataParams, payload: dict, mutations: dict
):
    from augmentedquill.utils.image_helpers import update_image_metadata

    update_image_metadata(
        params.filename, description=params.description, title=params.title
    )
    return {"ok": True}
