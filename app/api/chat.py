import httpx
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import load_machine_config, load_story_config
from app.projects import (
    get_active_project_dir,
    write_chapter_content,
    write_chapter_summary,
)
from app.helpers.project_helpers import _project_overview, _chapter_content_slice
from app.helpers.story_helpers import (
    _story_generate_summary_helper,
    _story_write_helper,
    _story_continue_helper,
)
from app.prompts import get_system_message, load_model_prompt_overrides
import json as _json
from typing import Any, Dict

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = BASE_DIR / "config"

router = APIRouter()

# Prefer using `app.main.load_machine_config` when available so tests can monkeypatch it.
try:
    import app.main as _app_main  # type: ignore
except Exception:
    _app_main = None


def _load_machine_config(path):
    if _app_main and hasattr(_app_main, "load_machine_config"):
        return _app_main.load_machine_config(path)
    return load_machine_config(path)


def _parse_tool_calls_from_content(content: str) -> list[dict] | None:
    """Parse tool calls from assistant content if not provided in structured format.

    Handles various formats like:
    - <tool_call>get_project_overview</tool_call>
    - [TOOL_CALL]get_project_overview[/TOOL_CALL]
    - Tool: get_project_overview
    """
    import re

    calls = []

    # Look for <tool_call> tags
    pattern1 = r"<tool_call>(.*?)</tool_call>"
    matches1 = re.findall(pattern1, content, re.IGNORECASE | re.DOTALL)

    for content_inner in matches1:
        func_match = re.match(r"(\w+)(?:\((.*)\))?", content_inner.strip())
        if func_match:
            name = func_match.group(1)
            args_str = func_match.group(2) or "{}"
            try:
                args_obj = _json.loads(args_str)
            except Exception:
                args_obj = {}

            call = {
                "id": f"call_{name}_{len(calls)}",
                "type": "function",
                "function": {"name": name, "arguments": _json.dumps(args_obj)},
                "original_text": f"<tool_call>{content_inner}</tool_call>",
            }
            calls.append(call)

    # Look for [TOOL_CALL] tags
    pattern2 = r"\[TOOL_CALL\](.*?)\[/TOOL_CALL\]"
    matches2 = re.findall(pattern2, content, re.IGNORECASE | re.DOTALL)

    for content_inner in matches2:
        func_match = re.match(r"(\w+)(?:\((.*)\))?", content_inner.strip())
        if func_match:
            name = func_match.group(1)
            args_str = func_match.group(2) or "{}"
            try:
                args_obj = _json.loads(args_str)
            except Exception:
                args_obj = {}

            call = {
                "id": f"call_{name}_{len(calls)}",
                "type": "function",
                "function": {"name": name, "arguments": _json.dumps(args_obj)},
                "original_text": f"[TOOL_CALL]{content_inner}[/TOOL_CALL]",
            }
            calls.append(call)

    # Look for "Tool:" prefix (must be at start of word)
    pattern3 = r"(^|(?<=\s))(Tool):\s+(\w+)(?:\(([^)]*)\))?"
    matches3 = re.findall(pattern3, content, re.IGNORECASE)

    for match in matches3:
        _, prefix, name, args_str = match
        args_str = args_str.strip() if args_str else "{}"
        try:
            args_obj = _json.loads(args_str) if args_str != "{}" else {}
        except Exception:
            args_obj = {}

        # Find the original text to remove
        original_text = f"{prefix}: {name}"
        if args_str and args_str != "{}":
            original_text += f"({args_str})"

        call = {
            "id": f"call_{name}_{len(calls)}",
            "type": "function",
            "function": {"name": name, "arguments": _json.dumps(args_obj)},
            "original_text": original_text,
        }
        calls.append(call)

    return calls if calls else None


STORY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_project_overview",
            "description": "Get project title and a list of all chapters with their IDs, filenames, titles, and summaries.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_story_summary",
            "description": "Get the overall story summary.",
            "parameters": {"type": "object", "properties": {}, "required": []},
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
                        "type": "string",
                        "description": "The new tags for the story, as a comma-separated string.",
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
            "description": "Get a slice of a chapter's content. If 'chap_id' is omitted, the application will attempt to use the currently active chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The ID of the chapter to read.",
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
            "description": "Set the content of a chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "Chapter numeric id.",
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
            "name": "write_chapter_summary",
            "description": "Set the summary of a chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "Chapter numeric id.",
                    },
                    "summary": {
                        "type": "string",
                        "description": "New summary for the chapter.",
                    },
                },
                "required": ["chap_id", "summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sync_summary",
            "description": "Generate and save a new summary for a chapter, or update its existing summary based on the content of the chapter. This is a destructive action.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The ID of the chapter to summarize.",
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
            "name": "write_story_summary",
            "description": "Set the overall story summary.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "The new story summary.",
                    }
                },
                "required": ["summary"],
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
            "name": "get_chapter_heading",
            "description": "Get the heading (title) of a specific chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The ID of the chapter.",
                    }
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_chapter_heading",
            "description": "Set the heading (title) of a specific chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The ID of the chapter.",
                    },
                    "heading": {
                        "type": "string",
                        "description": "The new heading for the chapter.",
                    },
                },
                "required": ["chap_id", "heading"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_chapter_summary",
            "description": "Get the summary of a specific chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The ID of the chapter.",
                    }
                },
                "required": ["chap_id"],
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
    {
        "type": "function",
        "function": {
            "name": "delete_chapter",
            "description": "Delete a chapter by its ID. This removes the chapter file and updates the story metadata.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {
                        "type": "integer",
                        "description": "The ID of the chapter to delete.",
                    }
                },
                "required": ["chap_id"],
            },
        },
    },
]


async def _exec_chat_tool(
    name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict
) -> dict:
    """Helper to execute a single tool call."""
    try:
        if name == "get_project_overview":
            data = _project_overview()
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }
        if name == "get_story_summary":
            active = get_active_project_dir()
            story = load_story_config((active / "story.json") if active else None) or {}
            summary = story.get("story_summary", "")
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"story_summary": summary}),
            }
        if name == "get_story_tags":
            active = get_active_project_dir()
            story = load_story_config((active / "story.json") if active else None) or {}
            tags = story.get("tags", "")
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"tags": tags}),
            }
        if name == "set_story_tags":
            tags = str(args_obj.get("tags", "")).strip()
            active = get_active_project_dir()
            if not active:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "No active project"}),
                }
            story_path = active / "story.json"
            story = load_story_config(story_path) or {}
            story["tags"] = tags
            with open(story_path, "w", encoding="utf-8") as f:
                _json.dump(story, f, indent=2, ensure_ascii=False)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(
                    {"tags": tags, "message": "Story tags updated successfully"}
                ),
            }
        if name == "get_chapter_summaries":
            active = get_active_project_dir()
            story = load_story_config((active / "story.json") if active else None) or {}
            chapters = story.get("chapters", [])
            summaries = []
            for i, chapter in enumerate(chapters):
                if isinstance(chapter, dict):
                    title = chapter.get("title", "").strip() or f"Chapter {i + 1}"
                    summary = chapter.get("summary", "").strip()
                    if summary:
                        summaries.append(
                            {"chapter_id": i, "title": title, "summary": summary}
                        )
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"chapter_summaries": summaries}),
            }
        if name == "get_chapter_content":
            chap_id = args_obj.get("chap_id")
            if chap_id is None:
                ac = payload.get("active_chapter_id")
                if isinstance(ac, int):
                    chap_id = ac
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            start = int(args_obj.get("start", 0) or 0)
            max_chars = int(args_obj.get("max_chars", 8000) or 8000)
            max_chars = max(1, min(8000, max_chars))
            data = _chapter_content_slice(chap_id, start=start, max_chars=max_chars)
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }
        if name == "write_chapter_content":
            chap_id = args_obj.get("chap_id")
            content = args_obj.get("content")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            if not isinstance(content, str):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "content is required"}),
                }
            try:
                write_chapter_content(chap_id, content)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {
                            "message": f"Content written to chapter {chap_id} successfully"
                        }
                    ),
                }
            except ValueError as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }
        if name == "write_chapter_summary":
            chap_id = args_obj.get("chap_id")
            summary = args_obj.get("summary")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            if not isinstance(summary, str):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "summary is required"}),
                }
            try:
                write_chapter_summary(chap_id, summary)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {
                            "message": f"Summary written to chapter {chap_id} successfully"
                        }
                    ),
                }
            except ValueError as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }
        if name == "sync_summary":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            mode = str(args_obj.get("mode", "")).lower()
            data = await _story_generate_summary_helper(chap_id=chap_id, mode=mode)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }
        if name == "write_chapter":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            data = await _story_write_helper(chap_id=chap_id)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }
        if name == "continue_chapter":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            data = await _story_continue_helper(chap_id=chap_id)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }
        if name == "sync_story_summary":
            mode = str(args_obj.get("mode", "")).lower()
            # Import the helper function
            from app.helpers.story_helpers import _story_generate_story_summary_helper

            data = await _story_generate_story_summary_helper(mode=mode)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(data),
            }
        if name == "write_story_summary":
            summary = str(args_obj.get("summary", "")).strip()
            active = get_active_project_dir()
            if not active:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "No active project"}),
                }
            story_path = active / "story.json"
            story = load_story_config(story_path) or {}
            story["story_summary"] = summary
            with open(story_path, "w", encoding="utf-8") as f:
                _json.dump(story, f, indent=2, ensure_ascii=False)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(
                    {
                        "summary": summary,
                        "message": "Story summary updated successfully",
                    }
                ),
            }
        if name == "create_new_chapter":
            title = str(args_obj.get("title", "")).strip()
            active = get_active_project_dir()
            if not active:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "No active project"}),
                }
            from app.projects import create_new_chapter

            try:
                chap_id = create_new_chapter(title)
                mutations["story_changed"] = True
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {
                            "chap_id": chap_id,
                            "title": title,
                            "message": f"New chapter {chap_id} created successfully",
                        }
                    ),
                }
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": str(e)}),
                }
        if name == "get_chapter_heading":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            active = get_active_project_dir()
            story = load_story_config((active / "story.json") if active else None) or {}
            chapters = story.get("chapters", [])
            if chap_id < len(chapters) and isinstance(chapters[chap_id], dict):
                heading = chapters[chap_id].get("title", "")
            else:
                heading = ""
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"heading": heading}),
            }
        if name == "write_chapter_heading":
            chap_id = args_obj.get("chap_id")
            heading = str(args_obj.get("heading", "")).strip()
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            active = get_active_project_dir()
            if not active:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "No active project"}),
                }
            story_path = active / "story.json"
            story = load_story_config(story_path) or {}
            chapters = story.get("chapters", [])
            if chap_id >= len(chapters):
                chapters.extend([{}] * (chap_id - len(chapters) + 1))
            if not isinstance(chapters[chap_id], dict):
                chapters[chap_id] = {}
            chapters[chap_id]["title"] = heading
            story["chapters"] = chapters
            with open(story_path, "w", encoding="utf-8") as f:
                _json.dump(story, f, indent=2, ensure_ascii=False)
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(
                    {
                        "heading": heading,
                        "message": f"Heading for chapter {chap_id} updated successfully",
                    }
                ),
            }
        if name == "get_chapter_summary":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            active = get_active_project_dir()
            story = load_story_config((active / "story.json") if active else None) or {}
            chapters = story.get("chapters", [])
            if chap_id < len(chapters) and isinstance(chapters[chap_id], dict):
                summary = chapters[chap_id].get("summary", "")
            else:
                summary = ""
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps({"summary": summary}),
            }
        if name == "delete_chapter":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "chap_id is required"}),
                }
            active = get_active_project_dir()
            if not active:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "No active project"}),
                }
            from app.helpers.chapter_helpers import (
                _scan_chapter_files,
                _normalize_chapter_entry,
            )

            files = _scan_chapter_files()
            match = next(
                ((idx, p, i) for i, (idx, p) in enumerate(files) if idx == chap_id),
                None,
            )
            if not match:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps({"error": "Chapter not found"}),
                }
            _, path, pos = match
            # Delete the file
            try:
                path.unlink()
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {"error": f"Failed to delete chapter file: {e}"}
                    ),
                }
            # Update story.json
            story_path = active / "story.json"
            story = load_story_config(story_path) or {}
            chapters_data = story.get("chapters") or []
            chapters_data = [_normalize_chapter_entry(c) for c in chapters_data]
            count = len(files)
            if len(chapters_data) < count:
                chapters_data.extend(
                    [{"title": "", "summary": ""}] * (count - len(chapters_data))
                )
            if pos < len(chapters_data):
                chapters_data.pop(pos)
            story["chapters"] = chapters_data
            try:
                with open(story_path, "w", encoding="utf-8") as f:
                    _json.dump(story, f, indent=2, ensure_ascii=False)
            except Exception as e:
                return {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": _json.dumps(
                        {"error": f"Failed to update story.json: {e}"}
                    ),
                }
            mutations["story_changed"] = True
            return {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _json.dumps(
                    {"message": f"Chapter {chap_id} deleted successfully"}
                ),
            }
        return {
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": _json.dumps({"error": f"Unknown tool: {name}"}),
        }
    except HTTPException as e:
        return {
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": _json.dumps({"error": f"Tool failed: {e.detail}"}),
        }
    except Exception as e:
        return {
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": _json.dumps(
                {"error": f"Tool failed with unexpected error: {e}"}
            ),
        }


@router.get("/api/chat")
async def api_get_chat() -> dict:
    """Return initial state for chat view: models and current selection."""
    machine = _load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg = (machine.get("openai") or {}) if isinstance(machine, dict) else {}
    models_list = openai_cfg.get("models") if isinstance(openai_cfg, dict) else []

    model_names = []
    if isinstance(models_list, list):
        model_names = [
            m.get("name") for m in models_list if isinstance(m, dict) and m.get("name")
        ]

    selected = openai_cfg.get("selected", "") if isinstance(openai_cfg, dict) else ""
    # Coerce to a valid selection
    if model_names:
        if not selected:
            selected = model_names[0]
        elif selected not in model_names:
            selected = model_names[0]

    return {
        "models": model_names,
        "current_model": selected,
        "messages": [],  # History is client-managed; this is a placeholder.
    }


@router.post("/api/chat/tools")
async def api_chat_tools(request: Request) -> JSONResponse:
    """Execute OpenAI-style tool calls and return tool messages.

    The endpoint does not call the upstream LLM; it only executes provided tool_calls
    from the last assistant message and returns corresponding {role:"tool"} messages.

    Body JSON:
      {
        "model_name": str | null,
        "messages": [
          {"role":"user|assistant|system|tool", "content": str, "tool_calls"?: [{"id":str, "type":"function", "function": {"name": str, "arguments": str}}], "tool_call_id"?: str, "name"?: str}
        ],
        "active_chapter_id"?: int
      }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    messages = payload.get("messages") or []
    if not isinstance(messages, list):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "messages must be an array"},
        )

    last = messages[-1] if messages else None
    tool_calls: list = []
    if isinstance(last, dict):
        t = last.get("tool_calls")
        if isinstance(t, list):
            tool_calls = t

    appended: list[dict] = []
    mutations = {"story_changed": False}

    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        call_id = str(call.get("id") or "")
        func = call.get("function") or {}
        name = (func.get("name") if isinstance(func, dict) else None) or ""
        args_raw = (func.get("arguments") if isinstance(func, dict) else None) or "{}"
        try:
            args_obj = (
                _json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
            )
        except Exception:
            args_obj = {}
        if not name or not call_id:
            continue
        msg = await _exec_chat_tool(name, args_obj, call_id, payload, mutations)
        appended.append(msg)

    return JSONResponse(
        status_code=200,
        content={"ok": True, "appended_messages": appended, "mutations": mutations},
    )


@router.post("/api/chat/stream")
async def api_chat_stream(request: Request) -> StreamingResponse:
    """Stream chat with the configured OpenAI-compatible model.

    Body JSON:
      {
        "model_name": "name-of-configured-entry" | null,
        "messages": [{"role": "system|user|assistant", "content": str}, ...],
        // optional overrides (otherwise pulled from config/machine.json)
        "base_url": str,
        "api_key": str,
        "model": str,
        "timeout_s": int
      }

    Returns: Streaming text response with the assistant's message.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    def _normalize_chat_messages(val: Any) -> list[dict]:
        """Preserve OpenAI message fields including tool calls.

        Keeps: role, content (may be None), name, tool_call_id, tool_calls.
        """
        arr = val if isinstance(val, list) else []
        out: list[dict] = []
        for m in arr:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role", "")).strip().lower() or "user"
            msg: dict = {"role": role}
            # content can be None (e.g., assistant with tool_calls)
            if "content" in m:
                c = m.get("content")
                msg["content"] = None if c is None else str(c)
            # pass-through optional tool fields
            name = m.get("name")
            if isinstance(name, str) and name:
                msg["name"] = name
            tcid = m.get("tool_call_id")
            if isinstance(tcid, str) and tcid:
                msg["tool_call_id"] = tcid
            tcs = m.get("tool_calls")
            if isinstance(tcs, list) and tcs:
                msg["tool_calls"] = tcs
            out.append(msg)
        return out

    req_messages = _normalize_chat_messages((payload or {}).get("messages"))
    if not req_messages:
        raise HTTPException(status_code=400, detail="messages array is required")

    # Prepend system message if not present
    has_system = any(msg.get("role") == "system" for msg in req_messages)
    if not has_system:
        # Load model-specific prompt overrides
        machine_config = _load_machine_config(CONFIG_DIR / "machine.json") or {}
        openai_cfg = machine_config.get("openai", {})
        selected_model_name = (payload or {}).get("model_name") or openai_cfg.get(
            "selected"
        )
        model_overrides = load_model_prompt_overrides(
            machine_config, selected_model_name
        )

        system_content = get_system_message("chat_llm", model_overrides)
        req_messages.insert(0, {"role": "system", "content": system_content})

    # Load machine config and pick selected model
    machine = _load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}
    selected_name = (payload or {}).get("model_name") or openai_cfg.get("selected")

    base_url = (payload or {}).get("base_url")
    api_key = (payload or {}).get("api_key")
    model_id = (payload or {}).get("model")
    timeout_s = (payload or {}).get("timeout_s")

    # If models list exists and a name is provided or selected, use it
    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    if isinstance(models, list) and models:
        chosen = None
        if selected_name:
            for m in models:
                if isinstance(m, dict) and (m.get("name") == selected_name):
                    chosen = m
                    break
        if chosen is None:
            chosen = models[0]
        base_url = chosen.get("base_url") or base_url
        api_key = chosen.get("api_key") or api_key
        model_id = chosen.get("model") or model_id
        timeout_s = chosen.get("timeout_s", 60) or timeout_s

    if not base_url or not model_id:
        raise HTTPException(
            status_code=400, detail="Missing base_url or model in configuration"
        )

    url = str(base_url).rstrip("/") + "/chat/completions"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Pull llm preferences for sensible defaults
    story = (
        load_story_config((get_active_project_dir() or CONFIG_DIR) / "story.json") or {}
    )
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = (
        float(prefs.get("temperature", 0.7))
        if isinstance(prefs.get("temperature", 0.7), (int, float, str))
        else 0.7
    )
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens", None)

    body: Dict[str, Any] = {
        "model": model_id,
        "messages": req_messages,
        "temperature": temperature,
        "stream": True,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    # Pass through OpenAI tool-calling fields if provided
    # Always include the available tools for the model to use.
    body["tools"] = STORY_TOOLS
    tool_choice = (payload or {}).get("tool_choice")
    if tool_choice:
        body["tool_choice"] = tool_choice
    else:
        body["tool_choice"] = "auto"

    async def _gen():
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(float(timeout_s or 60))
            ) as client:
                async with client.stream(
                    "POST", url, headers=headers, json=body
                ) as resp:
                    if resp.status_code >= 400:
                        error_content = await resp.aread()
                        try:
                            error_data = _json.loads(error_content)
                            yield f'data: {{"error": "Upstream error", "status": {resp.status_code}, "data": {_json.dumps(error_data)}}}\n\n'
                        except Exception:
                            yield f'data: {{"error": "Upstream error", "status": {resp.status_code}, "data": "{_json.dumps(error_content.decode("utf-8", errors="ignore"))}"}}\n\n'
                        return

                    # Check if response is SSE or regular JSON
                    content_type = resp.headers.get("content-type", "")
                    if "text/event-stream" not in content_type:
                        # Not SSE, treat as regular JSON response
                        try:
                            response_data = await resp.json()
                            if "choices" in response_data and response_data["choices"]:
                                choice = response_data["choices"][0]
                                if (
                                    "message" in choice
                                    and "content" in choice["message"]
                                ):
                                    content = choice["message"]["content"]
                                    if content:
                                        # Check if content contains tool call syntax and parse tool calls
                                        import re

                                        content_lower = content.lower()
                                        has_tool_syntax = (
                                            "<tool_call" in content_lower
                                            or "[tool_call" in content_lower
                                            or content_lower.startswith("tool:")
                                        )
                                        if has_tool_syntax:
                                            # Parse tool calls from content
                                            parsed_tool_calls = (
                                                _parse_tool_calls_from_content(content)
                                            )
                                            if parsed_tool_calls:
                                                # Send parsed tool calls
                                                yield f'data: {{"tool_calls": {_json.dumps(parsed_tool_calls)}}}\n\n'

                                        # Clean content of tool call syntax only if it contains tool call patterns
                                        if has_tool_syntax:
                                            clean_content = re.sub(
                                                r"<tool_call>([^<]*)</tool_call>",
                                                lambda m: f"Calling tool: {m.group(1).replace('_', ' ')}",
                                                content,
                                                flags=re.IGNORECASE,
                                            )
                                            clean_content = re.sub(
                                                r"<tool_call[^>]*>",
                                                "",
                                                clean_content,
                                                flags=re.IGNORECASE,
                                            )
                                            clean_content = re.sub(
                                                r"</tool_call>",
                                                "",
                                                clean_content,
                                                flags=re.IGNORECASE,
                                            )
                                            clean_content = re.sub(
                                                r"\[TOOL_CALL\]([^\[]*)\[/TOOL_CALL\]",
                                                lambda m: f"Calling tool: {m.group(1).replace('_', ' ')}",
                                                clean_content,
                                                flags=re.IGNORECASE,
                                            )
                                            clean_content = re.sub(
                                                r"^Tool:\s*(\w+)(?:\(([^)]*)\))?",
                                                lambda m: f"Calling tool: {m.group(1).replace('_', ' ')}",
                                                clean_content,
                                                flags=re.IGNORECASE | re.MULTILINE,
                                            )
                                            clean_content = re.sub(
                                                r"<tool_call[^>]*$",
                                                "",
                                                clean_content,
                                                flags=re.IGNORECASE,
                                            )
                                            clean_content = re.sub(
                                                r"\[TOOL_CALL\][^\[]*$",
                                                "",
                                                clean_content,
                                                flags=re.IGNORECASE,
                                            )
                                            clean_content = clean_content.strip()
                                        else:
                                            clean_content = content

                                        if clean_content:
                                            yield f'data: {{"content": {_json.dumps(clean_content)}}}\n\n'

                                # Handle tool_calls in the final message
                                message = choice.get("message", {})
                                if "tool_calls" in message and message["tool_calls"]:
                                    yield f'data: {{"tool_calls": {_json.dumps(message["tool_calls"])}}}\n\n'
                            yield 'data: {"done": true}\n\n'
                        except Exception as e:
                            yield f'data: {{"error": "Failed to parse response", "message": "{_json.dumps(str(e))}"}}\n\n'
                        return

                    buffer = ""
                    async for line in resp.aiter_lines():
                        if line.strip():
                            if line.startswith("data: "):
                                data_str = line[6:]  # Remove "data: " prefix
                                if data_str.strip() == "[DONE]":
                                    yield 'data: {"done": true}\n\n'
                                    break
                                try:
                                    chunk = _json.loads(data_str)
                                    # Extract content from the chunk
                                    if "choices" in chunk and chunk["choices"]:
                                        choice = chunk["choices"][0]
                                        if "delta" in choice:
                                            delta = choice["delta"]
                                            # Handle content
                                            if "content" in delta:
                                                content = delta["content"]
                                                if content:
                                                    # Check if content contains tool call syntax and parse tool calls
                                                    import re

                                                    content_lower = content.lower()
                                                    has_tool_syntax = (
                                                        "<tool_call" in content_lower
                                                        or "[tool_call" in content_lower
                                                        or content_lower.startswith(
                                                            "tool:"
                                                        )
                                                    )
                                                    if has_tool_syntax:
                                                        # Parse tool calls from content
                                                        parsed_tool_calls = _parse_tool_calls_from_content(
                                                            content
                                                        )
                                                        if parsed_tool_calls:
                                                            # Send parsed tool calls
                                                            yield f'data: {{"tool_calls": {_json.dumps(parsed_tool_calls)}}}\n\n'

                                                    # Clean content of tool call syntax only if it contains tool call patterns
                                                    if has_tool_syntax:
                                                        clean_content = re.sub(
                                                            r"<tool_call>([^<]*)</tool_call>",
                                                            lambda m: f"Calling tool: {m.group(1).replace('_', ' ')}",
                                                            content,
                                                            flags=re.IGNORECASE,
                                                        )
                                                        clean_content = re.sub(
                                                            r"<tool_call[^>]*>",
                                                            "",
                                                            clean_content,
                                                            flags=re.IGNORECASE,
                                                        )
                                                        clean_content = re.sub(
                                                            r"</tool_call>",
                                                            "",
                                                            clean_content,
                                                            flags=re.IGNORECASE,
                                                        )
                                                        clean_content = re.sub(
                                                            r"\[TOOL_CALL\]([^\[]*)\[/TOOL_CALL\]",
                                                            lambda m: f"Calling tool: {m.group(1).replace('_', ' ')}",
                                                            clean_content,
                                                            flags=re.IGNORECASE,
                                                        )
                                                        clean_content = re.sub(
                                                            r"^Tool:\s*(\w+)(?:\(([^)]*)\))?",
                                                            lambda m: f"Calling tool: {m.group(1).replace('_', ' ')}",
                                                            clean_content,
                                                            flags=re.IGNORECASE
                                                            | re.MULTILINE,
                                                        )
                                                        clean_content = re.sub(
                                                            r"<tool_call[^>]*$",
                                                            "",
                                                            clean_content,
                                                            flags=re.IGNORECASE,
                                                        )
                                                        clean_content = re.sub(
                                                            r"\[TOOL_CALL\][^\[]*$",
                                                            "",
                                                            clean_content,
                                                            flags=re.IGNORECASE,
                                                        )
                                                        clean_content = (
                                                            clean_content.strip()
                                                        )
                                                    else:
                                                        clean_content = content

                                                    if clean_content:
                                                        buffer += clean_content
                                                        # Send incremental cleaned content chunk
                                                        yield f'data: {{"content": {_json.dumps(clean_content)}}}\n\n'
                                            # Handle tool calls
                                            if (
                                                "tool_calls" in delta
                                                and delta["tool_calls"]
                                            ):
                                                # Send tool calls chunk
                                                yield f'data: {{"tool_calls": {_json.dumps(delta["tool_calls"])}}}\n\n'
                                        # Check for finish_reason to end streaming
                                        if (
                                            "finish_reason" in choice
                                            and choice["finish_reason"]
                                        ):
                                            yield 'data: {"done": true}\n\n'
                                            break
                                except _json.JSONDecodeError:
                                    continue
        except Exception as e:
            yield f'data: {{"error": "Request failed", "message": "{_json.dumps(str(e))}"}}\n\n'

    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.post("/api/openai/models")
async def proxy_list_models(request: Request) -> JSONResponse:
    """Fetch `${base_url}/models` using provided credentials.

    Body JSON:
      {"base_url": str, "api_key": str | None, "timeout_s": int | None}

    Returns the JSON payload from the upstream (expected to include a `data` array).
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    base_url = (payload or {}).get("base_url") or ""
    api_key = (payload or {}).get("api_key") or ""
    timeout_s = (payload or {}).get("timeout_s") or 60

    if not isinstance(base_url, str) or not base_url:
        raise HTTPException(status_code=400, detail="base_url is required")

    url = base_url.rstrip("/") + "/models"
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(float(timeout_s))) as client:
            resp = await client.get(url, headers=headers)
            # Relay status code if not 2xx
            content = (
                resp.json()
                if resp.headers.get("content-type", "").startswith("application/json")
                else {"raw": resp.text}
            )
            if resp.status_code >= 400:
                return JSONResponse(
                    status_code=resp.status_code,
                    content={
                        "error": "Upstream error",
                        "status": resp.status_code,
                        "data": content,
                    },
                )
            return JSONResponse(status_code=200, content=content)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {e}")
