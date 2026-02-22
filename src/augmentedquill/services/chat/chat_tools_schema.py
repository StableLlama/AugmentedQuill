# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the chat tools schema unit so this responsibility stays isolated, testable, and easy to evolve.

"""
Chat tool schemas for LLM function calling.

This module collects tool schemas from two sources:
1. Decorator-based tools (auto-registered via @chat_tool) - NEW APPROACH
2. Legacy manually-defined tools (for backward compatibility during migration)

Once all tools are migrated to decorators, the legacy schemas can be removed.
"""

# Import decorator registry functions and ensure tools are registered
from augmentedquill.services.chat.chat_tool_decorator import get_tool_schemas

# Import tool modules to trigger decorator registration
from augmentedquill.services.chat import chat_tools  # noqa: F401


def get_story_tools() -> list[dict]:
    """
    Get all story tools (both decorator-based and legacy).

    Returns a combined list of tool schemas for passing to the LLM.
    """
    # Get decorator-based tools (these are auto-registered)
    decorator_tools = get_tool_schemas()

    # Combine with any legacy tools still defined below
    legacy_tools = _LEGACY_STORY_TOOLS

    return decorator_tools + legacy_tools


# LEGACY: Manually defined tool schemas (for backward compatibility)
# TODO: Remove these as tools are migrated to decorator-based approach
_LEGACY_STORY_TOOLS = [
    # Project tools moved to decorator-based approach in project_tools.py
    # get_project_overview, create_project, list_projects, delete_project,
    # delete_book, create_new_book, change_project_type
    {
        "type": "function",
        "function": {
            "name": "get_story_metadata",
            "description": "Get the overall story title and summary.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_story_metadata",
            "description": "Update the story title, summary, or notes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "The new story title."},
                    "summary": {
                        "type": "string",
                        "description": "The new story summary.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "General notes for the story, visible to the AI.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_story_content",
            "description": "Read the story-level introduction or content file.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_story_content",
            "description": "Update the story-level introduction or content file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The new content for the story.",
                    }
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_book_metadata",
            "description": "Get the title and summary of a specific book (only for series projects).",
            "parameters": {
                "type": "object",
                "properties": {
                    "book_id": {
                        "type": "string",
                        "description": "The UUID of the book.",
                    }
                },
                "required": ["book_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_book_metadata",
            "description": "Update the title, summary, or notes of a specific book.",
            "parameters": {
                "type": "object",
                "properties": {
                    "book_id": {
                        "type": "string",
                        "description": "The UUID of the book.",
                    },
                    "title": {"type": "string", "description": "The new book title."},
                    "summary": {
                        "type": "string",
                        "description": "The new book summary.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Notes for the book, visible to the AI.",
                    },
                },
                "required": ["book_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_book_content",
            "description": "Read the global introduction or content for a specific book.",
            "parameters": {
                "type": "object",
                "properties": {
                    "book_id": {
                        "type": "string",
                        "description": "The UUID of the book.",
                    }
                },
                "required": ["book_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_book_content",
            "description": "Update the global introduction or content for a specific book.",
            "parameters": {
                "type": "object",
                "properties": {
                    "book_id": {
                        "type": "string",
                        "description": "The UUID of the book.",
                    },
                    "content": {
                        "type": "string",
                        "description": "The new content for the book.",
                    },
                },
                "required": ["book_id", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_chapter_metadata",
            "description": "Get the title and summary of a specific chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The numeric ID of the chapter.",
                    }
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_chapter_metadata",
            "description": "Update the title, summary, notes, or conflicts of a specific chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The numeric ID of the chapter.",
                    },
                    "title": {
                        "type": "string",
                        "description": "The new chapter title.",
                    },
                    "summary": {
                        "type": "string",
                        "description": "The new chapter summary.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Notes for the chapter, visible to the AI.",
                    },
                    "conflicts": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "description": {"type": "string"},
                                "resolution": {"type": "string"},
                            },
                        },
                        "description": "List of conflicts in the chapter. Each has id (optional), description, and resolution (optional).",
                    },
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_story_tags",
            "description": "Get the story tags that define the style.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_story_tags",
            "description": "Set or update the story tags that define the style. This is a destructive action that overwrites existing tags.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "The new tags for the story, as an array of strings.",
                    },
                },
                "required": ["tags"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_chapter_summaries",
            "description": "Get summaries of all chapters.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_chapter_content",
            "description": "Get a slice of a chapter's content. ALWAYS use the numeric 'chap_id' from get_project_overview. Never guess.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The numeric ID of the chapter to read.",
                    },
                    "start": {
                        "type": "integer",
                        "description": "The starting character index. Default 0.",
                    },
                    "max_chars": {
                        "type": "integer",
                        "description": "Max characters to read. Default 8000, max 8000.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_chapter_content",
            "description": "Set the content of a chapter. You MUST use the numeric ID retrieved from get_project_overview.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "Chapter numeric id (global index from project overview).",
                    },
                    "content": {
                        "type": "string",
                        "description": "New content for the chapter.",
                    },
                },
                "required": ["chap_id", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sync_summary",
            "description": "Generate and save a new summary for a chapter, or update its existing summary based on the content of the chapter. This is a destructive action. You MUST use the numeric chapter ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The numeric ID of the chapter to summarize.",
                    },
                    "mode": {
                        "type": "string",
                        "description": "If 'discard', generate a new summary from scratch. If 'update' or empty, refine the existing one.",
                        "enum": ["discard", "update"],
                    },
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sync_story_summary",
            "description": "Generate and save a new overall story summary based on chapter summaries, or update the existing one. This is a destructive action.",
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "description": "If 'discard', generate a new summary from scratch. If 'update' or empty, refine the existing one.",
                        "enum": ["discard", "update"],
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_new_chapter",
            "description": "Create a new chapter with an optional title.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "The title for the new chapter.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_chapter",
            "description": "Write the entire content of a chapter from its summary. This overwrites any existing content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The ID of the chapter to write.",
                    }
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "continue_chapter",
            "description": "Append new content to a chapter, continuing from where it left off. This does not modify existing text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The ID of the chapter to continue.",
                    }
                },
                "required": ["chap_id"],
            },
        },
    },
    # Project tools removed - now defined with decorators in project_tools.py
    {
        "type": "function",
        "function": {
            "name": "delete_chapter",
            "description": "Delete a chapter by its ID. Requires confirmation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The ID of the chapter to delete.",
                    },
                    "confirm": {
                        "type": "boolean",
                        "description": "Set to true to confirm deletion.",
                    },
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_image_description",
            "description": "Generate a description for an existing image using the EDIT LLM.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "The filename of the image.",
                    },
                },
                "required": ["filename"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_images",
            "description": "List all images including placeholders, with their descriptions and titles.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_image_placeholder",
            "description": "Create a new placeholder image with a description and optional title.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "Description of the image content.",
                    },
                    "title": {
                        "type": "string",
                        "description": "Title for the image.",
                    },
                },
                "required": ["description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_image_metadata",
            "description": "Update the title or description of an image or placeholder.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "The filename of the image.",
                    },
                    "title": {
                        "type": "string",
                        "description": "The new title.",
                    },
                    "description": {
                        "type": "string",
                        "description": "The new description.",
                    },
                },
                "required": ["filename"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_sourcebook",
            "description": "Search the sourcebook (world info, characters, locations) for a query.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query."}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_sourcebook_entry",
            "description": "Get a specific sourcebook entry by name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name_or_id": {"type": "string", "description": "Entry name."}
                },
                "required": ["name_or_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_sourcebook_entry",
            "description": "Create a new sourcebook entry.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Entry name."},
                    "description": {
                        "type": "string",
                        "description": "Entry description.",
                    },
                    "category": {
                        "type": "string",
                        "description": "Optional category (Character, Location, etc.).",
                    },
                    "synonyms": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional synonyms.",
                    },
                },
                "required": ["name", "description", "category"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_sourcebook_entry",
            "description": "Update an existing sourcebook entry.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name_or_id": {
                        "type": "string",
                        "description": "Current entry name.",
                    },
                    "name": {"type": "string", "description": "New name (optional)."},
                    "description": {
                        "type": "string",
                        "description": "New description (optional).",
                    },
                    "category": {
                        "type": "string",
                        "description": "New category (optional).",
                    },
                    "synonyms": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "New synonyms (optional).",
                    },
                },
                "required": ["name_or_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_sourcebook_entry",
            "description": "Remove a sourcebook entry.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name_or_id": {
                        "type": "string",
                        "description": "Entry name to delete.",
                    }
                },
                "required": ["name_or_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reorder_chapters",
            "description": "Reorder chapters in a novel project or within a specific book in a series project. To move a chapter between books, provide the chapter ID in the list for the target book. ONLY use numeric chapter IDs and UUID book IDs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chapter_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "List of numeric chapter IDs in the desired order.",
                    },
                    "book_id": {
                        "type": "string",
                        "description": "The UUID of the book (required for series projects, omit for novel projects).",
                    },
                },
                "required": ["chapter_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reorder_books",
            "description": "Reorder books in a series project. Use the UUIDs for each book.",
            "parameters": {
                "type": "object",
                "properties": {
                    "book_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of book UUIDs in the desired order.",
                    },
                },
                "required": ["book_ids"],
            },
        },
    },
]

WEB_SEARCH_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for real-world information. NOTE: This returns snippets only. You MUST subsequently call 'visit_page' on the top 1-3 relevant URLs to get the actual content needed for your answer.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query."}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "visit_page",
            "description": "Visit a specific web page by URL and extract its main content as text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL of the page to visit.",
                    }
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "wikipedia_search",
            "description": "Search Wikipedia for factual information. You MUST subsequently call 'visit_page' on the result URLs to read the full article content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search term."}
                },
                "required": ["query"],
            },
        },
    },
]


# Backward compatibility: STORY_TOOLS for modules that haven't migrated to get_story_tools()
STORY_TOOLS = get_story_tools()
