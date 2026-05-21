# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the sourcebook tools unit so this responsibility stays isolated, testable, and easy to evolve."""

from typing import Any, List, Literal, Union

from pydantic import Field
from augmentedquill.services.chat.chat_tool_decorator import ToolModel

from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
    chat_tool,
    resolve_tool_role,
)
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    _get_entry_relations,
    sourcebook_add_relation,
    sourcebook_create_entry,
    sourcebook_delete_entry,
    sourcebook_get_entry,
    sourcebook_list_entries,
    sourcebook_refresh_entry_keywords,
    sourcebook_remove_relation,
    sourcebook_update_entry,
    _get_story_data,
)
from augmentedquill.services.chat.chat_tools.metadata_patching import (
    StringListPatch,
    TextPatch,
    apply_string_list_patch,
    apply_text_patch,
)


def _strip_internal_sourcebook_fields(entry: dict | None) -> dict | None:
    """Remove internal-only fields before returning data to tool callers."""
    if not isinstance(entry, dict):
        return entry
    sanitized = dict(entry)
    sanitized.pop("keywords", None)

    # Ensure relations are always present for tool consumers, even if the source
    # entry payload does not include them directly.
    story, _ = _get_story_data()
    if story:
        entry_id = sanitized.get("id", sanitized.get("name", ""))
        relations = _get_entry_relations(entry_id, story)
        sanitized["relations"] = relations

    if "relations" in sanitized:
        formatted_rels = []
        entry_id = sanitized.get("id", sanitized.get("name", ""))

        project_type = (story.get("project_type") or "novel") if story else "novel"

        for r in sanitized.get("relations", []):
            direction = r.get("direction", "forward")
            target = r.get("target_id", "")
            rel_type = r.get("relation", "")

            if direction == "reverse":
                rel_tuple = [target, rel_type, entry_id]
            else:
                rel_tuple = [entry_id, rel_type, target]

            f_rel = {"relation": rel_tuple}

            if project_type in ("novel", "series"):
                if r.get("start_chapter"):
                    f_rel["start_chapter"] = r.get("start_chapter")
                if r.get("end_chapter"):
                    f_rel["end_chapter"] = r.get("end_chapter")

            if project_type == "series":
                if r.get("start_book"):
                    f_rel["start_book"] = r.get("start_book")
                if r.get("end_book"):
                    f_rel["end_book"] = r.get("end_book")

            formatted_rels.append(f_rel)

        sanitized["relations"] = formatted_rels

    return sanitized


def _strip_internal_sourcebook_fields_list(entries: list[dict]) -> list[dict]:
    """Apply response sanitization to every sourcebook entry in a list."""
    return [
        item
        for item in (
            _strip_internal_sourcebook_fields(entry) for entry in (entries or [])
        )
        if isinstance(item, dict)
    ]


# Pydantic models for tool parameters


class ManageSourcebookEntryData(ToolModel):
    """Payload for creating sourcebook entries."""

    name: str = Field(..., description="The name of the sourcebook entry")
    description: str = Field(..., description="The description/content of the entry")
    category: str = Field(
        ...,
        description="Required category for the entry (for example: character, location, item, concept)",
    )
    synonyms: list[str] = Field(
        default_factory=list,
        description="Optional list of synonyms/aliases.",
    )
    images: list[str] = Field(
        default_factory=list,
        description="Optional list of image IDs to associate with this entry.",
    )
    relations: list[dict] | None = Field(
        None,
        description=(
            "Optional list of relation objects to attach to this entry at creation time. "
            "Each relation may include target_id, relation_type, direction ('forward' or 'reverse'), "
            "and optional chapter/book bounds. Use relations to keep new sourcebook entries logically linked to existing world knowledge."
        ),
    )
    origin_date: str | None = Field(
        None,
        description=(
            "Optional ISO 8601 birth or creation date for this entry. "
            "RECOMMENDED FORMAT: ISO 8601 date (e.g. '1985-11-05') or full datetime (e.g. '1985-11-05T12:00:00Z'). "
            "ALSO ACCEPTED: time-only ('14:30' or '14:30:45' → uses today's date), or date with time and timezone. "
            "Used to compute the entry's personal timeline age at each scene it appears in. "
            "All forms are normalized and stored as complete ISO 8601 format."
        ),
    )


class ManageSourcebookUpdateData(ToolModel):
    """Payload for updating sourcebook entries."""

    name: str | None = Field(None, description="New name for the entry")
    description: str | None = Field(None, description="New description for the entry")
    description_patch: TextPatch | None = Field(
        None,
        description="Optional patch operation for partially editing description.",
    )
    category: str | None = Field(None, description="New category for the entry")
    synonyms: list[str] | None = Field(
        None, description="New list of synonyms for the entry"
    )
    synonyms_patch: StringListPatch | None = Field(
        None,
        description="Optional patch operation for synonyms (add/remove/set/clear).",
    )
    images: list[str] | None = Field(
        None, description="New list of image IDs for the entry"
    )
    images_patch: StringListPatch | None = Field(
        None,
        description="Optional patch operation for images (add/remove/set/clear).",
    )
    origin_date: str | None = Field(
        None,
        description=(
            "Optional ISO 8601 birth or creation date. "
            "RECOMMENDED FORMAT: ISO 8601 date (e.g. '1985-11-05') or full datetime (e.g. '1985-11-05T12:00:00Z'). "
            "ALSO ACCEPTED: time-only ('14:30' or '14:30:45' → uses today's date), or date with time and timezone. "
            "Set to clear the existing value or provide a new one. "
            "All forms are normalized and stored as complete ISO 8601 format."
        ),
    )


class ManageSourcebookRelationData(ToolModel):
    """Payload for adding/removing a directed sourcebook relation."""

    source_id: str = Field(..., description="The name/ID of the source entry.")
    relation_type: str = Field(
        ...,
        description="Relation descriptor used to connect source and target entries.",
    )
    target_id: str = Field(..., description="The name/ID of the target entry.")
    start_chapter: str | None = Field(
        None, description="Optional chapter where the relation begins."
    )
    end_chapter: str | None = Field(
        None, description="Optional chapter where the relation ends."
    )
    start_book: str | None = Field(
        None, description="Optional book where the relation begins."
    )
    end_book: str | None = Field(
        None, description="Optional book where the relation ends."
    )


class ManageSourcebookParams(ToolModel):
    """Action router parameters for manage_sourcebook."""

    action: Literal[
        "get",
        "create",
        "update",
        "delete",
        "list",
        "add_relation",
        "remove_relation",
    ] = Field(
        ...,
        description=(
            "Sourcebook action: 'get', 'create', 'update', 'delete', 'list', "
            "'add_relation', or 'remove_relation'."
        ),
    )
    name_or_id: Union[str, List[str], None] = Field(
        None,
        description="Required for actions 'get', 'update', and 'delete'.",
    )
    category: str | None = Field(
        None,
        description="Optional category filter used when action='list'.",
    )
    entry_data: ManageSourcebookEntryData | None = Field(
        None,
        description="Required when action='create'.",
    )
    update_data: ManageSourcebookUpdateData | None = Field(
        None,
        description="Required when action='update'.",
    )
    relation_data: ManageSourcebookRelationData | None = Field(
        None,
        description="Required when action='add_relation' or 'remove_relation'.",
    )


# Tool implementations with co-located schemas


@chat_tool(
    description=(
        "Unified sourcebook manager. Use action='list' (optional category), "
        "action='get' (name_or_id), action='create' (entry_data), action='update' "
        "(name_or_id + update_data), action='delete' (name_or_id), "
        "action='add_relation' (relation_data), or action='remove_relation' "
        "(relation_data). For action='create', entry_data may include relations to attach the new sourcebook entry into the existing world model."
    ),
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="sourcebook-read",
)
async def manage_sourcebook(
    params: ManageSourcebookParams, payload: dict, mutations: dict
) -> Any:
    """Route sourcebook actions to existing atomic sourcebook helpers."""
    role = resolve_tool_role(payload)
    chat_only_actions = {
        "create",
        "update",
        "delete",
        "add_relation",
        "remove_relation",
    }
    if role != CHAT_ROLE and params.action in chat_only_actions:
        return {
            "error": "Action unavailable for model role",
            "details": {
                "tool": "manage_sourcebook",
                "action": params.action,
                "model_role": role,
                "allowed_roles": [CHAT_ROLE],
            },
        }

    if params.action == "list":
        entries = sourcebook_list_entries()
        if params.category:
            needle = params.category.strip().lower()
            entries = [
                e for e in entries if (e.get("category") or "").lower() == needle
            ]
        return _strip_internal_sourcebook_fields_list(entries)

    if params.action == "get":
        if params.name_or_id is None:
            return {"error": "name_or_id is required when action='get'."}
        if isinstance(params.name_or_id, str):
            entry = sourcebook_get_entry(params.name_or_id)
            if not entry:
                return {"error": "Not found"}
            return _strip_internal_sourcebook_fields(entry)
        results: list[dict] = []
        for value in params.name_or_id:
            entry = sourcebook_get_entry(value)
            if entry:
                sanitized = _strip_internal_sourcebook_fields(entry)
                if isinstance(sanitized, dict):
                    results.append(sanitized)
        return results

    if params.action == "create":
        if params.entry_data is None:
            return {"error": "entry_data is required when action='create'."}
        new_entry = sourcebook_create_entry(
            name=params.entry_data.name,
            description=params.entry_data.description,
            category=params.entry_data.category,
            synonyms=params.entry_data.synonyms,
            images=params.entry_data.images,
            relations=params.entry_data.relations,
            origin_date=params.entry_data.origin_date,
        )
        if "error" not in new_entry:
            mutations["story_changed"] = True
            refreshed = await sourcebook_refresh_entry_keywords(
                new_entry["id"], payload
            )
            if isinstance(refreshed, dict):
                new_entry = refreshed
        return _strip_internal_sourcebook_fields(new_entry)

    if params.action == "update":
        if params.name_or_id is None or not isinstance(params.name_or_id, str):
            return {"error": "name_or_id (string) is required when action='update'."}
        if params.update_data is None:
            return {"error": "update_data is required when action='update'."}

        if (
            params.update_data.name is None
            and params.update_data.description is None
            and params.update_data.description_patch is None
            and params.update_data.category is None
            and params.update_data.synonyms is None
            and params.update_data.synonyms_patch is None
            and params.update_data.images is None
            and params.update_data.images_patch is None
            and params.update_data.origin_date is None
        ):
            return {
                "error": "No update fields provided. Provide at least one update field in update_data."
            }

        current = sourcebook_get_entry(params.name_or_id)
        if not isinstance(current, dict):
            return {"error": "Entry not found."}

        description_value = params.update_data.description
        if params.update_data.description_patch is not None:
            description_value = apply_text_patch(
                str(current.get("description") or ""),
                params.update_data.description_patch,
            )

        synonyms_value = params.update_data.synonyms
        if params.update_data.synonyms_patch is not None:
            current_synonyms = current.get("synonyms")
            if not isinstance(current_synonyms, list):
                current_synonyms = []
            synonyms_value = apply_string_list_patch(
                current_synonyms, params.update_data.synonyms_patch
            )

        images_value = params.update_data.images
        if params.update_data.images_patch is not None:
            current_images = current.get("images")
            if not isinstance(current_images, list):
                current_images = []
            images_value = apply_string_list_patch(
                current_images, params.update_data.images_patch
            )

        result = sourcebook_update_entry(
            name_or_id=params.name_or_id,
            name=params.update_data.name,
            description=description_value,
            category=params.update_data.category,
            synonyms=synonyms_value,
            images=images_value,
            origin_date=params.update_data.origin_date,
        )
        if "error" not in result:
            mutations["story_changed"] = True
            refreshed = await sourcebook_refresh_entry_keywords(result["id"], payload)
            if isinstance(refreshed, dict):
                result = refreshed
        return _strip_internal_sourcebook_fields(result)

    if params.action == "delete":
        if params.name_or_id is None or not isinstance(params.name_or_id, str):
            return {"error": "name_or_id (string) is required when action='delete'."}
        deleted = sourcebook_delete_entry(params.name_or_id)
        if deleted:
            mutations["story_changed"] = True
            return {"ok": True}
        return {"error": "Not found"}

    if params.action == "add_relation":
        if params.relation_data is None:
            return {"error": "relation_data is required when action='add_relation'."}
        result = sourcebook_add_relation(
            source_id=params.relation_data.source_id,
            relation_type=params.relation_data.relation_type,
            target_id=params.relation_data.target_id,
            start_chapter=params.relation_data.start_chapter,
            end_chapter=params.relation_data.end_chapter,
            start_book=params.relation_data.start_book,
            end_book=params.relation_data.end_book,
        )
        if "error" not in result:
            mutations["story_changed"] = True
        return result

    if params.action == "remove_relation":
        if params.relation_data is None:
            return {"error": "relation_data is required when action='remove_relation'."}
        result = sourcebook_remove_relation(
            source_id=params.relation_data.source_id,
            relation_type=params.relation_data.relation_type,
            target_id=params.relation_data.target_id,
        )
        if "error" not in result:
            mutations["story_changed"] = True
        return result

    return {"error": f"Unsupported action: {params.action}"}
