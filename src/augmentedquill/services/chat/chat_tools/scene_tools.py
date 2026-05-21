# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the scene tools unit so this responsibility stays isolated, testable, and easy to evolve."""

from typing import Any, Literal

from pydantic import ConfigDict, Field
from augmentedquill.services.chat.chat_tool_decorator import ToolModel

from augmentedquill.models.scene import (
    SceneBeat,
    SceneChronologyTime,
    SceneCreateRequest,
    SceneId,
    SceneProseLink,
    SceneTagPersonalDatetime,
    SceneUpdateRequest,
)
from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
    chat_tool,
)
from augmentedquill.services.chat.chat_tools.metadata_patching import (
    StringListPatch,
    TextPatch,
    apply_string_list_patch,
    apply_text_patch,
)
from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.services.scenes.scene_service import (
    create_scene,
    delete_scene,
    get_scene,
    list_scenes,
    update_scene,
)


class ManageScenesUpdateData(ToolModel):
    """Payload for scene updates supporting full and partial patch operations."""

    model_config = ConfigDict(extra="forbid")

    summary: str | None = Field(None, description="Optional full replacement summary.")
    summary_patch: TextPatch | None = Field(
        None,
        description="Optional patch operation for partially editing summary.",
    )
    beats: list[SceneBeat] | None = Field(
        None,
        description="Optional full replacement beats list.",
    )
    active_characters: list[str] | None = Field(
        None,
        description="Optional full replacement active character IDs.",
    )
    active_characters_patch: StringListPatch | None = Field(
        None,
        description="Optional patch operation for active characters.",
    )
    passive_characters: list[str] | None = Field(
        None,
        description="Optional full replacement passive character IDs.",
    )
    passive_characters_patch: StringListPatch | None = Field(
        None,
        description="Optional patch operation for passive characters.",
    )
    sourcebook_entry_ids: list[str] | None = Field(
        None,
        description="Optional full replacement sourcebook entry IDs.",
    )
    sourcebook_entry_ids_patch: StringListPatch | None = Field(
        None,
        description="Optional patch operation for sourcebook entry IDs.",
    )
    location: str | None = Field(
        None, description="Optional full replacement location."
    )
    time: str | None = Field(None, description="Optional full replacement time.")
    scene_time: SceneChronologyTime | str | None = Field(
        None,
        description=(
            "Optional scene chronology time. "
            "RECOMMENDED FORMAT: ISO 8601 datetime string with timezone (e.g., '1985-11-05T20:00:00Z' or '1985-11-05T14:30:00+05:30'). "
            "ALSO ACCEPTED (gracefully normalized): "
            "date-only ('1985-11-05' → uses 12:00:00 UTC), "
            "date+time ('1985-11-05 14:30' → adds :00 seconds and UTC), "
            "time-only ('14:30' or '14:30:45' → uses today's date, :00 seconds if omitted, UTC if no timezone), "
            "time with timezone ('14:30+05:30' → uses today's date), "
            "or dict forms {'temporal_zoned_datetime': 'ISO_STRING'} or {'value': 'SHORTHAND_STRING'}. "
            "When date is omitted, the current date is used; missing seconds default to :00; missing timezone defaults to Z (UTC). "
            "All forms are stored internally as complete ISO 8601 format."
        ),
    )
    color_tag: str | None = Field(
        None,
        description="Optional full replacement color tag.",
    )
    prose_link: SceneProseLink | None = Field(
        None,
        description="Optional full replacement scene prose link.",
    )
    order_before: list[SceneId | str] | None = Field(
        None,
        description="Optional full replacement order_before list.",
    )
    order_before_patch: StringListPatch | None = Field(
        None,
        description="Optional patch operation for order_before IDs.",
    )
    order_after: list[SceneId | str] | None = Field(
        None,
        description="Optional full replacement order_after list.",
    )
    order_after_patch: StringListPatch | None = Field(
        None,
        description="Optional patch operation for order_after IDs.",
    )
    pinboard_x: float | None = Field(None, description="Optional pinboard x position.")
    pinboard_y: float | None = Field(None, description="Optional pinboard y position.")
    status: str | None = Field(None, description="Optional full replacement status.")
    tag_personal_datetimes: list[SceneTagPersonalDatetime] | None = Field(
        None,
        description=(
            "Optional list of per-tag personal age overrides. Each entry has: "
            "role ('active'|'passive'|'sourcebook'), ref (character name for active/passive "
            "or sourcebook entry ID for sourcebook), index (0-based position within the "
            "role list, default 0, use >0 for duplicate characters e.g. time travellers), "
            "and personal_age (age string like '17y', '17y 3m', '5m 12d', '30d'). "
            "Used by the Convergence Map to sort each entry's scenes by their experienced "
            "age. Omit to leave unchanged; pass [] to clear all overrides."
        ),
    )


class ManageScenesParams(ToolModel):
    """Action router parameters for manage_scenes."""

    action: Literal["list", "get", "create", "update", "delete"] = Field(
        ...,
        description="Scene action: 'list', 'get', 'create', 'update', or 'delete'.",
    )
    scene_id: SceneId | None = Field(
        None,
        description="Required for actions 'get', 'update', and 'delete'.",
    )
    create_data: SceneCreateRequest | None = Field(
        None,
        description="Required when action='create'. Uses the full GUI scene schema.",
    )
    update_data: ManageScenesUpdateData | None = Field(
        None,
        description=(
            "Required when action='update'. Supports partial patches for summary "
            "and list fields while preserving untouched data."
        ),
    )


@chat_tool(
    description=(
        "Unified scenes manager with full GUI schema parity. Scenes do not have "
        "a separate title field; use create_data.summary as the scene label. Use "
        "action='list' to list scenes, action='get' with scene_id to retrieve one "
        "scene, action='create' with create_data to create a scene, action='update' "
        "with scene_id and update_data to modify a scene, and action='delete' with "
        "scene_id to remove a scene. When creating scenes, include relevant "
        "sourcebook_entry_ids and a formal scene_time whenever the chronology can "
        "be inferred; otherwise express relative ordering with order_before/order_after. "
        "For update_data.scene_time, you can pass a Temporal object, {'value': ...}, "
        "or a plain ISO-like string such as '1985-11-05', '1985-11-05T20:00', or "
        "'1985-11-05T20:00:00Z'."
    ),
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="metadata-write",
)
async def manage_scenes(
    params: ManageScenesParams, payload: dict, mutations: dict
) -> Any:
    """Route scene actions to the existing scene service CRUD operations."""
    active = get_active_project_dir()
    if active is None:
        return {"error": "No active project"}

    if params.action == "list":
        return list_scenes(active)

    if params.action == "get":
        if params.scene_id is None:
            return {"error": "scene_id is required when action='get'."}
        scene = get_scene(active, params.scene_id)
        if scene is None:
            return {"error": f"Scene '{params.scene_id}' not found"}
        return scene

    if params.action == "create":
        if params.create_data is None:
            return {"error": "create_data is required when action='create'."}
        try:
            created = create_scene(active, params.create_data)
        except ValueError as exc:
            message = str(exc)
            if "cannot reference itself in order_before/order_after" in message:
                return {
                    "error": "Invalid scene ordering",
                    "message": (
                        "A scene cannot reference itself in order_before/order_after. "
                        "Remove that ID from ordering lists and reference only other existing scenes."
                    ),
                    "details": {"reason": message},
                }
            return {
                "error": "Invalid scene data",
                "message": message,
            }
        mutations["story_changed"] = True
        return created

    if params.action == "update":
        if params.scene_id is None:
            return {"error": "scene_id is required when action='update'."}
        if params.update_data is None:
            return {"error": "update_data is required when action='update'."}

        current = get_scene(active, params.scene_id)
        if current is None:
            return {"error": f"Scene '{params.scene_id}' not found"}

        fields_set = set(params.update_data.model_fields_set)
        update_kwargs: dict[str, Any] = {}

        summary_value = params.update_data.summary
        if params.update_data.summary_patch is not None:
            summary_value = apply_text_patch(
                str(current.get("summary") or ""),
                params.update_data.summary_patch,
            )
        if params.update_data.summary_patch is not None or "summary" in fields_set:
            if summary_value is not None:
                update_kwargs["summary"] = summary_value

        active_characters_value = params.update_data.active_characters
        if params.update_data.active_characters_patch is not None:
            current_active = current.get("active_characters")
            if not isinstance(current_active, list):
                current_active = []
            active_characters_value = apply_string_list_patch(
                current_active,
                params.update_data.active_characters_patch,
            )
        if (
            params.update_data.active_characters_patch is not None
            or "active_characters" in fields_set
        ):
            update_kwargs["active_characters"] = active_characters_value or []

        passive_characters_value = params.update_data.passive_characters
        if params.update_data.passive_characters_patch is not None:
            current_passive = current.get("passive_characters")
            if not isinstance(current_passive, list):
                current_passive = []
            passive_characters_value = apply_string_list_patch(
                current_passive,
                params.update_data.passive_characters_patch,
            )
        if (
            params.update_data.passive_characters_patch is not None
            or "passive_characters" in fields_set
        ):
            update_kwargs["passive_characters"] = passive_characters_value or []

        sourcebook_entry_ids_value = params.update_data.sourcebook_entry_ids
        if params.update_data.sourcebook_entry_ids_patch is not None:
            current_sourcebook_ids = current.get("sourcebook_entry_ids")
            if not isinstance(current_sourcebook_ids, list):
                current_sourcebook_ids = []
            sourcebook_entry_ids_value = apply_string_list_patch(
                current_sourcebook_ids,
                params.update_data.sourcebook_entry_ids_patch,
            )
        if (
            params.update_data.sourcebook_entry_ids_patch is not None
            or "sourcebook_entry_ids" in fields_set
        ):
            update_kwargs["sourcebook_entry_ids"] = sourcebook_entry_ids_value or []

        order_before_value = params.update_data.order_before
        if params.update_data.order_before_patch is not None:
            current_order_before = current.get("order_before")
            if not isinstance(current_order_before, list):
                current_order_before = []
            order_before_value = apply_string_list_patch(
                [str(scene_id) for scene_id in current_order_before],
                params.update_data.order_before_patch,
            )
        if (
            params.update_data.order_before_patch is not None
            or "order_before" in fields_set
        ):
            update_kwargs["order_before"] = order_before_value or []

        order_after_value = params.update_data.order_after
        if params.update_data.order_after_patch is not None:
            current_order_after = current.get("order_after")
            if not isinstance(current_order_after, list):
                current_order_after = []
            order_after_value = apply_string_list_patch(
                [str(scene_id) for scene_id in current_order_after],
                params.update_data.order_after_patch,
            )
        if (
            params.update_data.order_after_patch is not None
            or "order_after" in fields_set
        ):
            update_kwargs["order_after"] = order_after_value or []

        for field_name in (
            "beats",
            "location",
            "time",
            "scene_time",
            "color_tag",
            "prose_link",
            "pinboard_x",
            "pinboard_y",
            "status",
            "tag_personal_datetimes",
        ):
            if field_name in fields_set:
                value = getattr(params.update_data, field_name)
                if field_name == "beats":
                    update_kwargs[field_name] = value or []
                elif field_name in ("pinboard_x", "pinboard_y", "status"):
                    if value is not None:
                        update_kwargs[field_name] = value
                else:
                    update_kwargs[field_name] = value

        update_payload = SceneUpdateRequest(**update_kwargs)

        try:
            updated = update_scene(active, params.scene_id, update_payload)
        except ValueError as exc:
            message = str(exc)
            if "cannot reference itself in order_before/order_after" in message:
                return {
                    "error": "Invalid scene ordering",
                    "message": (
                        "A scene cannot reference itself in order_before/order_after. "
                        "Use IDs of other scenes only."
                    ),
                    "details": {"scene_id": params.scene_id, "reason": message},
                }
            return {
                "error": "Invalid scene update",
                "message": message,
            }
        if updated is None:
            return {"error": f"Scene '{params.scene_id}' not found"}
        mutations["story_changed"] = True
        return updated

    if params.action == "delete":
        if params.scene_id is None:
            return {"error": "scene_id is required when action='delete'."}
        deleted = delete_scene(active, params.scene_id)
        if not deleted:
            return {"error": f"Scene '{params.scene_id}' not found"}
        mutations["story_changed"] = True
        return {"ok": True}

    return {"error": f"Unsupported action: {params.action}"}
