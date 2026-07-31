# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Shared metadata patch models and helpers for safe partial updates."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import ConfigDict, Field, model_validator

from augmentedquill.services.chat.chat_tool_decorator import ToolModel


class ConflictEntry(ToolModel):
    """Structured conflict entry used by chapter and story metadata tools."""

    id: str | None = Field(
        None,
        description="Optional stable conflict identifier. If omitted, a new one may be assigned.",
    )
    description: str = Field(
        ..., description="Short description of the unresolved story conflict."
    )
    resolution: str | None = Field(
        None,
        description="Optional proposed or current resolution for the conflict.",
    )
    resolved: bool = Field(
        False,
        description="Set to true when the conflict has been resolved and should no longer be treated as active.",
    )


class TextPatch(ToolModel):
    """Patch operation for text fields."""

    operation: Literal["replace", "append", "prepend", "replace_text"] = Field(
        ...,
        description=(
            "replace = set full value, append/prepend = add text while keeping"
            " existing content, replace_text = replace old_text with new_text."
        ),
    )
    value: str | None = Field(
        None,
        description="Text value used by replace/append/prepend operations.",
    )
    old_text: str | None = Field(
        None,
        description="Exact text to find when operation=replace_text.",
    )
    new_text: str | None = Field(
        None,
        description="Replacement text used when operation=replace_text.",
    )
    occurrence: Literal["first", "last", "all", "unique"] = Field(
        "first",
        description=(
            "Which match to replace when operation=replace_text. "
            "unique fails unless exactly one match exists."
        ),
    )

    @model_validator(mode="after")
    def _validate_shape(self) -> TextPatch:
        if self.operation in ("replace", "append", "prepend"):
            if self.value is None:
                raise ValueError(
                    f"missing required key(s): value for operation '{self.operation}'"
                )
        if self.operation == "replace_text":
            missing_keys: list[str] = []
            if self.old_text is None:
                missing_keys.append("old_text")
            if self.new_text is None:
                missing_keys.append("new_text")
            if missing_keys:
                raise ValueError(
                    "missing required key(s): "
                    + ", ".join(missing_keys)
                    + " for operation 'replace_text'"
                )
        return self


class StringListPatch(ToolModel):
    """Patch operation for string list fields (tags, synonyms, images)."""

    set: list[str] | None = Field(
        None,
        description="Optional full replacement list before add/remove operations.",
    )
    add: list[str] | None = Field(
        None,
        description="Values to add while preserving untouched existing values.",
    )
    remove: list[str] | None = Field(
        None,
        description="Values to remove from the current list.",
    )
    clear: bool = Field(False, description="Clear the existing list before add/set.")
    unique: bool = Field(
        True,
        description="If true, deduplicate while preserving first-seen order.",
    )


class IntListPatch(ToolModel):
    """Patch operation for integer list fields (scene IDs, chapter IDs)."""

    set: list[int] | None = Field(
        None,
        description=(
            "Optional full replacement integer list before add/remove operations. "
            "Example: [1, 2, 3]."
        ),
        json_schema_extra={"examples": [[1, 2, 3]]},
    )
    add: list[int] | None = Field(
        None,
        description=(
            "Integer scene IDs to add while preserving untouched existing values. "
            "Example: [1, 2, 3]."
        ),
        json_schema_extra={"examples": [[1, 2, 3]]},
    )
    remove: list[int] | None = Field(
        None,
        description=(
            "Integer scene IDs to remove from the current list. Example: [1, 2]."
        ),
        json_schema_extra={"examples": [[1, 2]]},
    )
    clear: bool = Field(False, description="Clear the existing list before add/set.")
    unique: bool = Field(
        True,
        description="If true, deduplicate while preserving first-seen order.",
    )


class ConflictPatchOperation(ToolModel):
    """One atomic conflict-list change."""

    model_config = ConfigDict(extra="forbid")

    op: Literal["add", "insert", "replace", "update", "remove", "clear"] | None = Field(
        None,
        description=(
            "Operation type. Inferred automatically when omitted: "
            "updates present → 'update'; conflict present with index → 'replace'; "
            "conflict present without index → 'add'; only index present → 'remove'. "
            "Must be set explicitly for 'insert' and 'clear'. "
            "IMPORTANT: 'update' requires both index and updates (not conflict)."
        ),
    )
    index: int | None = Field(
        None,
        description=(
            "0-based conflict list index. Required for insert/replace/update/remove. "
            "For append/add, omit index."
        ),
    )
    conflict: ConflictEntry | dict[str, Any] | None = Field(
        None,
        description=(
            "Conflict payload for add/insert/replace operations. "
            "Use this to append a new conflict object (usually without index)."
        ),
    )
    updates: dict[str, Any] | None = Field(
        None,
        description=(
            "Fields to merge into an existing conflict for update operations. "
            "Requires index to identify which conflict to update."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _infer_op(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        if data.get("op") is None:
            updates = data.get("updates")
            conflict = data.get("conflict")
            index = data.get("index")
            if updates is not None:
                data = {**data, "op": "update"}
            elif conflict is not None and index is not None:
                data = {**data, "op": "replace"}
            elif conflict is not None:
                data = {**data, "op": "add"}
            elif index is not None:
                data = {**data, "op": "remove"}
        return data

    @model_validator(mode="after")
    def _validate_shape(self) -> ConflictPatchOperation:
        if self.op is None:
            raise ValueError(
                "op is required and could not be inferred; "
                "provide op explicitly (add/insert/replace/update/remove/clear)"
            )
        if self.op in ("insert", "replace", "update", "remove") and self.index is None:
            raise ValueError(
                "index is required for insert/replace/update/remove. "
                "To append a new conflict, omit index and use conflict with op='add' "
                "(or omit op to infer add). For update, provide both index and updates."
            )
        if self.op in ("add", "insert", "replace") and self.conflict is None:
            raise ValueError("conflict is required for add/insert/replace")
        if self.op == "update" and self.updates is None:
            raise ValueError("updates is required for update")
        return self


class ConflictListPatch(ToolModel):
    """Patch operation for conflict list fields."""

    operations: list[ConflictPatchOperation] = Field(
        ...,
        description=(
            "Ordered index-based operations to apply to the conflicts list. "
            "Use numeric index for update/insert/replace/remove operations. "
            "Examples: append -> {conflict:{...}}; update existing -> {index:0, updates:{resolution:'...'}}."
        ),
    )


def apply_text_patch(current: str, patch: TextPatch) -> str:
    """Apply a text patch and return updated value."""
    text = current or ""
    if patch.operation == "replace":
        return patch.value or ""
    if patch.operation == "append":
        return text + (patch.value or "")
    if patch.operation == "prepend":
        return (patch.value or "") + text

    old_text = patch.old_text or ""
    new_text = patch.new_text or ""
    count = text.count(old_text)
    if count == 0:
        raise ValueError("replace_text failed: old_text was not found")

    if patch.occurrence == "unique":
        if count != 1:
            raise ValueError(f"replace_text failed: expected one match, found {count}")
        return text.replace(old_text, new_text, 1)

    if patch.occurrence == "all":
        return text.replace(old_text, new_text)

    if patch.occurrence == "last":
        idx = text.rfind(old_text)
        return text[:idx] + new_text + text[idx + len(old_text) :]

    return text.replace(old_text, new_text, 1)


def apply_string_list_patch(current: list[str], patch: StringListPatch) -> list[str]:
    """Apply string list patch while preserving existing items by default."""
    result: list[str]
    if patch.set is not None:
        result = list(patch.set)
    elif patch.clear:
        result = []
    else:
        result = list(current or [])

    if patch.add:
        result.extend(patch.add)

    if patch.remove:
        remove_set = set(patch.remove)
        result = [item for item in result if item not in remove_set]

    if patch.unique:
        deduped: list[str] = []
        seen: set[str] = set()
        for item in result:
            if item in seen:
                continue
            seen.add(item)
            deduped.append(item)
        result = deduped

    return result


def apply_int_list_patch(current: list[int], patch: IntListPatch) -> list[int]:
    """Apply integer list patch while preserving existing items by default."""
    result: list[int]
    if patch.set is not None:
        result = list(patch.set)
    elif patch.clear:
        result = []
    else:
        result = list(current or [])

    if patch.add:
        result.extend(patch.add)

    if patch.remove:
        remove_set = set(patch.remove)
        result = [item for item in result if item not in remove_set]

    if patch.unique:
        deduped: list[int] = []
        seen: set[int] = set()
        for item in result:
            if item in seen:
                continue
            seen.add(item)
            deduped.append(item)
        result = deduped

    return result


def apply_conflict_list_patch(
    current: list[dict[str, Any]], patch: ConflictListPatch
) -> list[dict[str, Any]]:
    """Apply ordered conflict-list operations."""
    result = [dict(item) for item in (current or []) if isinstance(item, dict)]

    def _as_dict(value: Any) -> dict[str, Any]:
        if hasattr(value, "model_dump"):
            dumped = value.model_dump()
            return dumped if isinstance(dumped, dict) else {}
        if isinstance(value, dict):
            return dict(value)
        return {}

    for op in patch.operations:
        if op.op == "clear":
            result = []
            continue

        if op.op == "add":
            result.append(_as_dict(op.conflict))
            continue

        if op.index is None:
            raise ValueError("Conflict operation is missing index")
        if op.index < 0 or op.index > len(result):
            raise ValueError(
                f"Conflict operation index {op.index} is out of bounds for size {len(result)}"
            )

        if op.op == "insert":
            result.insert(op.index, _as_dict(op.conflict))
        elif op.op == "replace":
            if op.index >= len(result):
                raise ValueError(
                    f"replace index {op.index} is out of bounds for size {len(result)}"
                )
            result[op.index] = _as_dict(op.conflict)
        elif op.op == "update":
            if op.index >= len(result):
                raise ValueError(
                    f"update index {op.index} is out of bounds for size {len(result)}"
                )
            merged = dict(result[op.index])
            merged.update(op.updates or {})
            result[op.index] = merged
        elif op.op == "remove":
            if op.index >= len(result):
                raise ValueError(
                    f"remove index {op.index} is out of bounds for size {len(result)}"
                )
            result.pop(op.index)

    return result
