# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the project tools unit so this responsibility stays isolated, testable, and easy to evolve."""

import json as _json

from pydantic import BaseModel, Field

from augmentedquill.core.config import load_story_config
from augmentedquill.services.chat.chat_tool_decorator import chat_tool
from augmentedquill.services.projects.project_helpers import _project_overview
from augmentedquill.services.projects.projects import (
    create_project,
    delete_project,
    get_active_project_dir,
    list_projects,
)

# Pydantic models for tool parameters


class GetProjectOverviewParams(BaseModel):
    """Parameters for get_project_overview (no parameters needed)."""

    pass


class CreateProjectParams(BaseModel):
    """Parameters for creating a new project."""

    name: str = Field(..., description="The project directory name")
    project_type: str = Field(
        "novel", description="The project type: 'novel' or 'series'"
    )


class ListProjectsParams(BaseModel):
    """Parameters for list_projects (no parameters needed)."""

    pass


class DeleteProjectParams(BaseModel):
    """Parameters for deleting a project."""

    name: str = Field(..., description="The project directory name to delete")
    confirm: bool = Field(
        False, description="Must be true to confirm deletion. Defaults to false."
    )


class DeleteBookParams(BaseModel):
    """Parameters for deleting a book from a series."""

    book_id: str = Field(..., description="The UUID of the book to delete")
    confirm: bool = Field(
        False, description="Must be true to confirm deletion. Defaults to false."
    )


class CreateNewBookParams(BaseModel):
    """Parameters for creating a new book in a series."""

    title: str = Field(..., description="The title of the new book")


class ChangeProjectTypeParams(BaseModel):
    """Parameters for changing project type."""

    new_type: str = Field(..., description="The new project type: 'novel' or 'series'")


# Tool implementations with co-located schemas


@chat_tool(
    description="Get project title, type, and a structured list of all books (for series) or chapters (for novels). Use this to find the correct NUMERIC chapter IDs and UUID book IDs. Never assume an ID based on a title."
)
async def get_project_overview(
    params: GetProjectOverviewParams, payload: dict, mutations: dict
):
    data = _project_overview()
    # Return data directly - decorator handles wrapping in tool message format
    return data


@chat_tool(
    name="create_project",
    description="Create a new project with the specified name and type (novel or series).",
)
async def create_project_tool(
    params: CreateProjectParams, payload: dict, mutations: dict
):
    ok, msg = create_project(params.name, params.project_type)
    return {"ok": ok, "message": msg}


@chat_tool(
    name="list_projects",
    description="List all available projects with their names and titles.",
)
async def list_projects_tool(
    params: ListProjectsParams, payload: dict, mutations: dict
):
    projs = list_projects()
    simple = [{"name": p["name"], "title": p["title"]} for p in projs]
    return {"projects": simple}


@chat_tool(
    name="delete_project",
    description="Delete a project permanently. Requires confirmation with confirm=true.",
)
async def delete_project_tool(
    params: DeleteProjectParams, payload: dict, mutations: dict
):
    """Delete Project Tool."""
    if not params.confirm:
        return {
            "status": "confirmation_required",
            "message": "This operation deletes the project. Call again with confirm=true to proceed.",
        }
    ok, msg = delete_project(params.name)
    return {"ok": ok, "message": msg}


@chat_tool(
    description="Delete a book from a series project. Requires confirmation with confirm=true."
)
async def delete_book(params: DeleteBookParams, payload: dict, mutations: dict):
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


@chat_tool(description="Create a new book in a series project.")
async def create_new_book(params: CreateNewBookParams, payload: dict, mutations: dict):
    """Create New Book."""
    from augmentedquill.services.projects.projects import (
        create_new_book as _create_book,
    )

    bid = _create_book(params.title)
    mutations["story_changed"] = True
    return {"book_id": bid, "message": "Book created"}


@chat_tool(
    description="Change the project type between 'novel' and 'series'. This restructures the project organization."
)
async def change_project_type(
    params: ChangeProjectTypeParams, payload: dict, mutations: dict
):
    """Change Project Type."""
    from augmentedquill.services.projects.projects import (
        change_project_type as _change_type,
    )

    ok, msg = _change_type(params.new_type)
    if ok:
        mutations["story_changed"] = True
    return {"ok": ok, "message": msg}
