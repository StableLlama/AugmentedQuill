# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the undo tools unit so this responsibility stays isolated, testable, and easy to evolve.

LLM-callable tool that lets the CHAT LLM undo its own recent project modifications
without requiring user intervention via the frontend undo button.
"""

import json
import re
from pathlib import Path
from typing import Any

from pydantic import Field

from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
    ToolModel,
    chat_tool,
)
from augmentedquill.services.projects.project_snapshots import restore_project_snapshot
from augmentedquill.services.projects.projects import get_active_project_dir

# Must match _CHAT_TOOL_BATCH_DIR in augmentedquill.api.v1.chat
_BATCH_DIR = ".aq_history/chat_tool_batches"
_BATCH_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


def _load_batch(project_dir: Path, batch_id: str) -> dict[str, Any]:
    """Load a stored batch snapshot, raising BadRequestError on invalid input."""
    from augmentedquill.services.exceptions import BadRequestError

    if not _BATCH_ID_RE.fullmatch(batch_id):
        raise BadRequestError(f"Invalid batch id: {batch_id!r}")
    batch_file = project_dir / _BATCH_DIR / batch_id / "batch.json"
    if not batch_file.is_file():
        raise BadRequestError(f"No snapshot found for batch: {batch_id!r}")
    return json.loads(batch_file.read_text(encoding="utf-8"))


def _find_most_recent_batch(project_dir: Path) -> dict[str, Any] | None:
    """Return the most recently created batch snapshot for the project, or None."""
    batches_dir = project_dir / _BATCH_DIR
    if not batches_dir.is_dir():
        return None

    entries: list[dict[str, Any]] = []
    for batch_file in batches_dir.glob("*/batch.json"):
        try:
            data = json.loads(batch_file.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("batch_id"):
                entries.append(data)
        except (OSError, json.JSONDecodeError):
            pass

    if not entries:
        return None

    entries.sort(key=lambda e: str(e.get("created_at") or ""), reverse=True)
    return entries[0]


# ============================================================================
# undo_last_tool_changes
# ============================================================================


class UndoLastToolChangesParams(ToolModel):
    """Parameters for the undo_last_tool_changes tool."""

    scope: str = Field(
        ...,
        description=(
            "'last_call' undoes the project changes made by the single most recent LLM"
            " tool call (usually a smaller delta than one full undo-stack entry)."
            " 'all_this_turn' undoes ALL project changes made by LLM tools since the"
            " last user prompt, effectively reverting the project to the state it was in"
            " before the current LLM turn began."
            " Pass 'last_call' to fix the most recent mistake; pass 'all_this_turn'"
            " when you want to start the current turn's work over from scratch."
        ),
    )
    batch_ids: list[str] | None = Field(
        None,
        description=(
            "For scope='all_this_turn': provide ALL batch_id values received in tool"
            " results for this turn, oldest first, so every batch can be reversed in"
            " correct order. For scope='last_call': omit this (the system auto-detects"
            " the most recent batch) or pass just the single batch_id to undo."
        ),
    )


@chat_tool(
    description=(
        "Undo recent LLM tool call project changes without waiting for the user to"
        " press the undo button."
        " scope='last_call' reverses only the most recent tool call's project"
        " modifications (granular undo — usually much less than one full undo-stack"
        " entry)."
        " scope='all_this_turn' reverses ALL project modifications made by LLM tools"
        " since the last user prompt, returning the project to its pre-turn state"
        " (equivalent to popping the current undo-stack entry)."
        " After a successful undo the tool reports which batches were restored so you"
        " can confirm the rollback and decide how to proceed."
    ),
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="undo",
    project_types=("short-story", "novel", "series"),
)
async def undo_last_tool_changes(
    params: UndoLastToolChangesParams, payload: dict, mutations: dict
) -> Any:
    """Restore project content to the state before one or more recent tool call batches."""
    from augmentedquill.services.exceptions import BadRequestError

    if params.scope not in ("last_call", "all_this_turn"):
        raise BadRequestError(
            f"Invalid scope: {params.scope!r}. Use 'last_call' or 'all_this_turn'."
        )

    project_dir = get_active_project_dir()
    if project_dir is None:
        raise BadRequestError("No active project. Cannot undo.")

    batches_to_undo: list[dict[str, Any]] = []

    if params.scope == "last_call":
        if params.batch_ids:
            # Use the last provided batch_id as the single target.
            batch = _load_batch(project_dir, params.batch_ids[-1])
            batches_to_undo = [batch]
        else:
            batch = _find_most_recent_batch(project_dir)
            if batch is None:
                raise BadRequestError(
                    "No tool call batches found for the active project."
                )
            batches_to_undo = [batch]

    else:  # all_this_turn
        if not params.batch_ids:
            raise BadRequestError(
                "scope='all_this_turn' requires batch_ids: provide all batch_id values"
                " from tool results in this turn, oldest first."
            )
        for bid in params.batch_ids:
            batches_to_undo.append(_load_batch(project_dir, bid))

    # Restore batches in reverse order so we unwind the most recent change first.
    restored_ids: list[str] = []
    for batch in reversed(batches_to_undo):
        before_snapshot = batch.get("before")
        if not isinstance(before_snapshot, dict):
            raise BadRequestError(
                f"Batch {batch.get('batch_id')!r} has an invalid snapshot."
            )
        restore_project_snapshot(project_dir, before_snapshot)
        restored_ids.append(str(batch.get("batch_id") or ""))

    mutations["story_changed"] = True
    return {
        "undone": True,
        "scope": params.scope,
        "restored_batches": restored_ids,
        "status": (
            f"Reverted {len(restored_ids)} batch(es): {', '.join(restored_ids)}."
            " Project content has been restored to its prior state."
        ),
    }
