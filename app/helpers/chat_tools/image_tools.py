import base64
from pathlib import Path

from app.helpers.chat_tools.common import tool_message


async def _tool_generate_image_description(filename: str, payload: dict) -> str:
    from app import llm
    from app.helpers.image_helpers import get_images_dir, update_image_metadata

    images_dir = get_images_dir()
    if not images_dir:
        return "Error: No active project."

    filename = Path(filename).name
    img_path = images_dir / filename

    if not img_path.exists():
        return f"Error: Image {filename} does not exist on disk."

    try:
        base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
            payload, model_type="EDITING"
        )

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


async def handle_image_tool(
    name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict
):
    if name == "list_images":
        from app.helpers.image_helpers import get_project_images

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
        return tool_message(name, call_id, simple)

    if name == "generate_image_description":
        filename = args_obj.get("filename")
        desc = await _tool_generate_image_description(filename, payload)
        return tool_message(name, call_id, {"description": desc})

    if name == "create_image_placeholder":
        desc = args_obj.get("description")
        title = args_obj.get("title")
        from app.helpers.image_helpers import update_image_metadata
        import uuid

        filename = f"placeholder_{uuid.uuid4().hex[:8]}.png"
        update_image_metadata(filename, description=desc, title=title)

        return tool_message(
            name,
            call_id,
            {"filename": filename, "description": desc, "title": title},
        )

    if name == "set_image_metadata":
        filename = args_obj.get("filename")
        title = args_obj.get("title")
        desc = args_obj.get("description")
        from app.helpers.image_helpers import update_image_metadata

        update_image_metadata(filename, description=desc, title=title)
        return tool_message(name, call_id, {"ok": True})

    return None
