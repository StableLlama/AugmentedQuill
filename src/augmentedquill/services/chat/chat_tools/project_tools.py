# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the project tools unit so this responsibility stays isolated, testable, and easy to evolve."""

import json as _json
from typing import Any, Literal

from pydantic import AliasChoices, Field

from augmentedquill.core.config import load_story_config
from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
    ToolModel,
    chat_tool,
    resolve_tool_role,
)
from augmentedquill.services.projects.project_helpers import _project_overview
from augmentedquill.services.projects.projects import (
    create_project,
    delete_project,
    get_active_project_dir,
    list_projects,
)

# Pydantic models for tool parameters


class DeleteBookParams(ToolModel):
    """Parameters for deleting a book from a series."""

    book_id: str = Field(..., description="The UUID of the book to delete")
    confirm: bool = Field(
        False, description="Must be true to confirm deletion. Defaults to false."
    )


class CreateNewBookParams(ToolModel):
    """Parameters for creating a new book in a series."""

    title: str = Field(..., description="The title of the new book")


class ManageProjectCreateData(ToolModel):
    """Payload for project creation."""

    name: str = Field(..., description="The project directory name")
    project_type: str = Field(
        "novel",
        description="The project type: 'short-story', 'novel', or 'series'",
        validation_alias=AliasChoices("project_type", "type"),
    )


class ManageProjectDeleteData(ToolModel):
    """Payload for project deletion."""

    name: str = Field(..., description="The project directory name to delete")
    confirm: bool = Field(
        False,
        description="Must be true to confirm deletion. Defaults to false.",
    )


class ManageProjectTypeData(ToolModel):
    """Payload for project type changes."""

    new_type: str = Field(
        ...,
        description="The new project type: 'short-story', 'novel', or 'series'",
    )


class ManageProjectParams(ToolModel):
    """Action router parameters for manage_project."""

    action: Literal["get_overview", "create", "list", "delete", "change_type"] = Field(
        ...,
        description=(
            "Action to execute: 'get_overview', 'create', 'list', 'delete', or "
            "'change_type'."
        ),
    )
    include_notes: bool = Field(
        True,
        description="Used when action='get_overview'. Include per-chapter notes.",
    )
    create_data: ManageProjectCreateData | None = Field(
        None,
        description="Required when action='create'.",
    )
    delete_data: ManageProjectDeleteData | None = Field(
        None,
        description="Required when action='delete'.",
    )
    type_data: ManageProjectTypeData | None = Field(
        None,
        description="Required when action='change_type'.",
    )


# Tool implementations with co-located schemas


@chat_tool(
    description=(
        "Unified project manager tool for short story/short-story, novel, and "
        "series projects. Use action='get_overview' to inspect "
        "current structure and IDs, action='list' to list projects, action='create' "
        "to create a project (requires create_data), action='delete' to delete a "
        "project (requires delete_data with confirm=true), and action='change_type' "
        "to change project type (requires type_data)."
    ),
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="project-admin",
)
async def manage_project(
    params: ManageProjectParams, payload: dict, mutations: dict
) -> Any:
    """Route project-management actions to existing atomic project operations."""
    role = resolve_tool_role(payload)
    chat_only_actions = {"list", "create", "delete", "change_type"}
    if role != CHAT_ROLE and params.action in chat_only_actions:
        return {
            "error": "Action unavailable for model role",
            "details": {
                "tool": "manage_project",
                "action": params.action,
                "model_role": role,
                "allowed_roles": [CHAT_ROLE],
            },
        }

    if params.action == "get_overview":
        return _project_overview(include_notes=params.include_notes)

    if params.action == "list":
        projs = list_projects()
        return {"projects": [{"name": p["name"], "title": p["title"]} for p in projs]}

    if params.action == "create":
        if params.create_data is None:
            return {"error": "create_data is required when action='create'."}
        ok, msg = create_project(
            params.create_data.name, params.create_data.project_type
        )
        if ok:
            mutations["story_changed"] = True
            created_name = ""
            if isinstance(msg, str) and msg.startswith("Project created:"):
                created_name = msg.split(":", 1)[1].strip()
            if not created_name:
                active = get_active_project_dir()
                created_name = active.name if active else params.create_data.name
            # Return the created directory name so clients can reliably switch
            # even when the user provided title is sanitized for filesystem safety.
            return {
                "ok": True,
                "message": msg,
                "project_name": created_name,
            }
        return {"ok": ok, "message": msg}

    if params.action == "delete":
        if params.delete_data is None:
            return {"error": "delete_data is required when action='delete'."}
        if not params.delete_data.confirm:
            return {
                "status": "confirmation_required",
                "message": "This operation deletes the project. Call again with confirm=true to proceed.",
            }
        ok, msg = delete_project(params.delete_data.name)
        if ok:
            mutations["story_changed"] = True
        return {"ok": ok, "message": msg}

    if params.action == "change_type":
        if params.type_data is None:
            return {"error": "type_data is required when action='change_type'."}
        from augmentedquill.services.projects.projects import (
            change_project_type as _change_type,
        )

        ok, msg = _change_type(params.type_data.new_type)
        if ok:
            mutations["story_changed"] = True
        return {"ok": ok, "message": msg}

    return {"error": f"Unsupported action: {params.action}"}


@chat_tool(
    description="Delete a book from a series project. Requires confirmation with confirm=true.",
    allowed_roles=(CHAT_ROLE,),
    capability="metadata-write",
    project_types=("series",),
)
async def delete_book(params: DeleteBookParams, payload: dict, mutations: dict) -> Any:
    """Delete Book."""
    if not params.confirm:
        return {
            "status": "confirmation_required",
            "message": "This operation deletes the book. Call again with confirm=true to proceed.",
        }

    active = get_active_project_dir()
    if not active:
        return {"error": "No active project"}

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    books = story.get("books", [])
    new_books = [b for b in books if str(b.get("id")) != str(params.book_id)]

    if len(new_books) == len(books):
        return {"error": "Book not found"}

    story["books"] = new_books
    with open(story_path, "w", encoding="utf-8") as f:
        _json.dump(story, f, indent=2, ensure_ascii=False)

    mutations["story_changed"] = True
    return {"ok": True, "message": "Book deleted"}


@chat_tool(
    description="Create a new book in a series project.",
    allowed_roles=(CHAT_ROLE,),
    capability="metadata-write",
    project_types=("series",),
)
async def create_new_book(
    params: CreateNewBookParams, payload: dict, mutations: dict
) -> Any:
    """Create New Book."""
    from augmentedquill.services.projects.projects import (
        create_new_book as _create_book,
    )

    bid = _create_book(params.title)
    mutations["story_changed"] = True
    return {"book_id": bid, "message": "Book created"}
