# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the sourcebook tools unit so this responsibility stays isolated, testable, and easy to evolve."""

from pydantic import BaseModel, Field

from augmentedquill.services.chat.chat_tool_decorator import chat_tool
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    sourcebook_create_entry,
    sourcebook_delete_entry,
    sourcebook_get_entry,
    sourcebook_search_entries,
    sourcebook_update_entry,
)

# Pydantic models for tool parameters


class SearchSourcebookParams(BaseModel):
    """Parameters for searching the sourcebook."""

    query: str = Field(..., description="The search query string")


class GetSourcebookEntryParams(BaseModel):
    """Parameters for retrieving a sourcebook entry."""

    name_or_id: str = Field(
        ..., description="The name or ID of the sourcebook entry to retrieve"
    )


class CreateSourcebookEntryParams(BaseModel):
    """Parameters for creating a sourcebook entry."""

    name: str = Field(..., description="The name of the sourcebook entry")
    description: str = Field(..., description="The description/content of the entry")
    category: str | None = Field(None, description="Optional category for the entry")
    synonyms: list[str] = Field(
        default_factory=list, description="Optional list of synonyms"
    )


class UpdateSourcebookEntryParams(BaseModel):
    """Parameters for updating a sourcebook entry."""

    name_or_id: str = Field(..., description="The name or ID of the entry to update")
    name: str | None = Field(None, description="New name for the entry")
    description: str | None = Field(None, description="New description for the entry")
    category: str | None = Field(None, description="New category for the entry")
    synonyms: list[str] | None = Field(
        None, description="New list of synonyms for the entry"
    )


class DeleteSourcebookEntryParams(BaseModel):
    """Parameters for deleting a sourcebook entry."""

    name_or_id: str = Field(..., description="The name or ID of the entry to delete")


# Tool implementations with co-located schemas


@chat_tool(description="Search the sourcebook for entries matching a query string.")
async def search_sourcebook(
    params: SearchSourcebookParams, payload: dict, mutations: dict
):
    return sourcebook_search_entries(params.query)


@chat_tool(description="Get a specific sourcebook entry by name or ID.")
async def get_sourcebook_entry(
    params: GetSourcebookEntryParams, payload: dict, mutations: dict
):
    """Get Sourcebook Entry."""
    entry = sourcebook_get_entry(params.name_or_id)
    if not entry:
        return {"error": "Not found"}
    return entry


@chat_tool(description="Create a new sourcebook entry with name and description.")
async def create_sourcebook_entry(
    params: CreateSourcebookEntryParams, payload: dict, mutations: dict
):
    """Create Sourcebook Entry."""
    new_entry = sourcebook_create_entry(
        name=params.name,
        description=params.description,
        category=params.category,
        synonyms=params.synonyms,
    )
    if "error" not in new_entry:
        mutations["story_changed"] = True
    return new_entry


@chat_tool(
    description="Update an existing sourcebook entry. Provide only the fields you want to change."
)
async def update_sourcebook_entry(
    params: UpdateSourcebookEntryParams, payload: dict, mutations: dict
):
    """Update Sourcebook Entry."""
    result = sourcebook_update_entry(
        name_or_id=params.name_or_id,
        name=params.name,
        description=params.description,
        category=params.category,
        synonyms=params.synonyms,
    )
    if "error" not in result:
        mutations["story_changed"] = True
    return result


@chat_tool(description="Delete a sourcebook entry by name or ID.")
async def delete_sourcebook_entry(
    params: DeleteSourcebookEntryParams, payload: dict, mutations: dict
):
    """Delete Sourcebook Entry."""
    deleted = sourcebook_delete_entry(params.name_or_id)
    if deleted:
        mutations["story_changed"] = True
        return {"ok": True}
    return {"error": "Not found"}
