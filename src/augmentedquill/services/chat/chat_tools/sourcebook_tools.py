# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the sourcebook tools unit so this responsibility stays isolated, testable, and easy to evolve."""

from typing import Any, Literal

from pydantic import Field, field_validator

from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
    ToolModel,
    chat_tool,
    resolve_tool_role,
)
from augmentedquill.services.chat.chat_tools.metadata_patching import (
    StringListPatch,
    TextPatch,
    apply_string_list_patch,
    apply_text_patch,
)
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    KNOWN_SOURCEBOOK_CATEGORIES,
    _get_entry_relations,
    _get_story_data,
    sourcebook_add_relation,
    sourcebook_create_entry,
    sourcebook_delete_entry,
    sourcebook_get_entry,
    sourcebook_list_entries,
    sourcebook_refresh_entry_keywords,
    sourcebook_remove_relation,
    sourcebook_update_entry,
)

_CATEGORY_CHOICES: list[str] = list(KNOWN_SOURCEBOOK_CATEGORIES)

# Fields that must not be combined with their patch counterpart, because the
# two carry contradictory intent (full replacement vs. partial edit).
_UPDATE_EXCLUSIVE_PAIRS: tuple[tuple[str, str], ...] = (
    ("description", "description_patch"),
    ("synonyms", "synonyms_patch"),
    ("images", "images_patch"),
)

# Fields where an explicit null means "clear the stored value" rather than
# "leave it unchanged".
_CLEARABLE_UPDATE_FIELDS: tuple[str, ...] = ("origin_date",)

_UPDATE_BLANK_FIELD_HINTS: dict[str, str] = {
    "name": "Omit 'name' to keep the current name.",
    "category": "Omit 'category' to keep the current category.",
    "description": (
        "Omit 'description' to keep the current text, or use "
        "description_patch(operation='replace', value='') to clear it."
    ),
}


def _has_effective_update(update: "ManageSourcebookUpdateData") -> bool:
    """Return whether the payload contains at least one effective change."""
    for field_name in update.model_fields_set:
        if field_name in _CLEARABLE_UPDATE_FIELDS:
            return True
        if getattr(update, field_name) is not None:
            return True
    return False


def _validate_update_payload(
    update: "ManageSourcebookUpdateData",
) -> dict[str, str] | None:
    """Reject ambiguous or accidental field combinations in an update payload."""
    for value_field, patch_field in _UPDATE_EXCLUSIVE_PAIRS:
        if (
            getattr(update, value_field) is not None
            and getattr(update, patch_field) is not None
        ):
            return {
                "error": (
                    f"Provide either '{value_field}' or '{patch_field}', not both."
                )
            }

    for field_name, hint in _UPDATE_BLANK_FIELD_HINTS.items():
        if field_name not in update.model_fields_set:
            continue
        value = getattr(update, field_name)
        if isinstance(value, str) and not value.strip():
            return {
                "error": (
                    f"'{field_name}' must not be blank when action='update'. {hint}"
                )
            }
    return None


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
                if r.get("start_scene") is not None:
                    f_rel["start_scene"] = r.get("start_scene")
                if r.get("end_scene") is not None:
                    f_rel["end_scene"] = r.get("end_scene")

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
        description=(
            "Required category for the entry. Must be one of the supported "
            "categories listed in enum."
        ),
        json_schema_extra={"enum": _CATEGORY_CHOICES},
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
    """Payload for partially updating sourcebook entries.

    Every field is optional. Fields that are omitted keep their currently
    stored value; there is no need to resend unchanged fields such as the
    entry name or category.
    """

    name: str | None = Field(
        None,
        description=(
            "New name for the entry (renames it). Omit to keep the current "
            "name; only send this when the entry should actually be renamed."
        ),
    )
    description: str | None = Field(
        None,
        description=(
            "Full replacement description. Omit to keep the current text. "
            "Prefer description_patch for small edits."
        ),
    )
    description_patch: TextPatch | None = Field(
        None,
        description=(
            "Partial edit of the description (append/prepend/replace_text). "
            "Cannot be combined with 'description'."
        ),
    )
    category: str | None = Field(
        None,
        description=("New category for the entry. Omit to keep the current category."),
        json_schema_extra={"enum": _CATEGORY_CHOICES},
    )
    synonyms: list[str] | None = Field(
        None,
        description=(
            "Full replacement list of synonyms. Omit to keep the current "
            "synonyms; prefer synonyms_patch for additive changes."
        ),
    )
    synonyms_patch: StringListPatch | None = Field(
        None,
        description=(
            "Partial edit of synonyms (add/remove/set/clear). Cannot be "
            "combined with 'synonyms'."
        ),
    )
    images: list[str] | None = Field(
        None,
        description=(
            "Full replacement list of image IDs. Omit to keep the current "
            "images; prefer images_patch for additive changes."
        ),
    )
    images_patch: StringListPatch | None = Field(
        None,
        description=(
            "Partial edit of images (add/remove/set/clear). Cannot be "
            "combined with 'images'."
        ),
    )
    relations: list[dict] | None = Field(
        None,
        description=(
            "Optional list of relation objects that REPLACES all existing "
            "relations of this entry. Omit to keep existing relations, and "
            "prefer action='add_relation'/'remove_relation' when changing a "
            "single relation. Each relation may include target_id, "
            "relation_type, direction ('forward' or 'reverse'), and optional "
            "chapter/book bounds. Tuple-style relations of the form "
            "['Source', 'relation', 'Target'] are also accepted."
        ),
    )
    origin_date: str | None = Field(
        None,
        description=(
            "Optional ISO 8601 birth or creation date. Omit to keep the "
            "current value; send an explicit null to clear it. "
            "RECOMMENDED FORMAT: ISO 8601 date (e.g. '1985-11-05') or full datetime (e.g. '1985-11-05T12:00:00Z'). "
            "ALSO ACCEPTED: time-only ('14:30' or '14:30:45' → uses today's date), or date with time and timezone. "
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
    start_scene: int | None = Field(
        None, description="Optional scene where the relation begins."
    )
    end_scene: int | None = Field(
        None, description="Optional scene where the relation ends."
    )
    start_book: str | None = Field(
        None, description="Optional book where the relation begins."
    )
    end_book: str | None = Field(
        None, description="Optional book where the relation ends."
    )

    @field_validator("start_scene", "end_scene", mode="before")
    @classmethod
    def _validate_scene_id(cls, value: object) -> int | None:
        if value is None:
            return None
        if type(value) is int:
            return value
        raise ValueError("Scene IDs must be integers.")


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
    name_or_id: str | list[str] | None = Field(
        None,
        description=(
            "Entry name or ID. Required for actions 'get', 'update', and "
            "'delete'; 'get' also accepts a list of names/IDs."
        ),
    )
    category: str | None = Field(
        None,
        description="Optional category filter used when action='list'.",
    )
    entry_data: ManageSourcebookEntryData | None = Field(
        None,
        description=(
            "Required when action='create'. Full new entry payload. Do not "
            "use this for action='update'."
        ),
    )
    update_data: ManageSourcebookUpdateData | None = Field(
        None,
        description=(
            "Required when action='update'. Partial update payload: include "
            "only the fields that should change. Omitted fields keep their "
            "current values, so there is no need to resend name or category."
        ),
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
        "(relation_data). For action='create', entry_data may include relations to attach the new sourcebook entry into the existing world model. "
        "action='update' is a PARTIAL update: send only the fields that change "
        "inside update_data and omit everything else (including name and "
        "category) so stored values are preserved. Use description_patch / "
        "synonyms_patch / images_patch for additive edits instead of resending "
        "full replacement values, and prefer add_relation/remove_relation over "
        "replacing the whole relations list."
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
            return {
                "error": (
                    "name_or_id (a single string) is required when "
                    "action='update'. Use action='get' or action='list' first "
                    "to resolve the entry."
                )
            }
        update = params.update_data
        if update is None:
            return {
                "error": (
                    "update_data is required when action='update'. Use "
                    "update_data (not entry_data) and include only the fields "
                    "that should change."
                )
            }

        if not _has_effective_update(update):
            return {
                "error": (
                    "No update fields provided. Do not resend unchanged "
                    "fields; provide at least one field in update_data."
                )
            }

        invalid_update = _validate_update_payload(update)
        if invalid_update is not None:
            return invalid_update

        current = sourcebook_get_entry(params.name_or_id)
        if not isinstance(current, dict):
            return {"error": "Entry not found."}

        description_value = update.description
        if update.description_patch is not None:
            description_value = apply_text_patch(
                str(current.get("description") or ""),
                update.description_patch,
            )

        synonyms_value = update.synonyms
        if update.synonyms_patch is not None:
            current_synonyms = current.get("synonyms")
            if not isinstance(current_synonyms, list):
                current_synonyms = []
            synonyms_value = apply_string_list_patch(
                current_synonyms, update.synonyms_patch
            )

        images_value = update.images
        if update.images_patch is not None:
            current_images = current.get("images")
            if not isinstance(current_images, list):
                current_images = []
            images_value = apply_string_list_patch(current_images, update.images_patch)

        # Only forward origin_date when the caller actually supplied it, so a
        # partial update cannot silently clear a stored birth/creation date.
        optional_kwargs: dict[str, Any] = {}
        if "origin_date" in update.model_fields_set:
            optional_kwargs["origin_date"] = update.origin_date

        result = sourcebook_update_entry(
            name_or_id=params.name_or_id,
            name=update.name,
            description=description_value,
            category=update.category,
            synonyms=synonyms_value,
            images=images_value,
            relations=update.relations,
            **optional_kwargs,
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
            start_scene=params.relation_data.start_scene,
            end_scene=params.relation_data.end_scene,
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
