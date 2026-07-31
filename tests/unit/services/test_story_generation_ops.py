# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test story generation ops unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
from unittest.mock import patch

import pytest

from augmentedquill.api.v1.story_routes.generation_streaming import (
    _create_gen_source,
)
from augmentedquill.core.config import load_story_config, save_story_config
from augmentedquill.services.projects.projects import (
    get_active_project_dir,
    select_project,
)
from augmentedquill.services.story.story_api_stream_ops import (
    stream_unified_chat_content,
)
from augmentedquill.services.story.story_generation_common import (
    prepare_ai_action_generation,
)
from augmentedquill.services.story.story_generation_ops import (
    generate_chapter_summary,
    generate_story_summary,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_stream_unified_chat_content_multi_round():
    # Setup mock for llm.unified_chat_stream
    # Round 1: Returns a tool call
    # Round 2: Returns final content

    mock_chunks_round_1 = [
        {
            "tool_calls": [
                {
                    "index": 0,
                    "id": "call_1",
                    "function": {
                        "name": "manage_story_core",
                        "arguments": '{"action":"update_metadata","update_data":{"title":"New Title"}}',
                    },
                }
            ]
        }
    ]
    mock_chunks_round_2 = [{"content": "Story updated."}]

    with (
        patch("augmentedquill.services.llm.llm.unified_chat_stream") as mock_stream,
        patch(
            "augmentedquill.services.story.story_api_stream_ops.execute_registered_tool"
        ) as mock_exec,
    ):
        # Configure mock stream to return chunks for two rounds
        async def side_effect(*args, **kwargs):
            messages = kwargs.get("messages", [])
            if len(messages) == 1:  # Initial call
                for chunk in mock_chunks_round_1:
                    yield chunk
            else:  # Second call after tool execution
                for chunk in mock_chunks_round_2:
                    yield chunk

        mock_stream.side_effect = side_effect
        mock_exec.return_value = {"ok": True}

        messages = [{"role": "user", "content": "Update title"}]
        results = []
        async for chunk in stream_unified_chat_content(
            messages=messages,
            base_url="http://fake",
            api_key="key",
            model_id="model",
            timeout_s=60,
        ):
            results.append(chunk)

        assert len(results) == 2
        assert results[0] == mock_chunks_round_1[0]
        assert results[1] == mock_chunks_round_2[0]

        # Verify tool was executed
        mock_exec.assert_called_once()
        args, kwargs = mock_exec.call_args
        assert args[0] == "manage_story_core"
        assert args[1] == {
            "action": "update_metadata",
            "update_data": {"title": "New Title"},
        }


@pytest.mark.anyio
async def test_prepare_ai_action_summary_rewrite_blanks_original_summary_for_tool_calls():
    ok, msg = select_project("rewrite_summary_action")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["project_type"] = "novel"
    story["chapters"] = [
        {"title": "Chapter 1", "summary": "Old chapter summary", "filename": "0001.txt"}
    ]
    story_path.write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter_file = chapters_dir / "0001.txt"
    chapter_file.write_text("A hero explores the unknown.", encoding="utf-8")

    async def fake_unified_chat_stream(*args, **kwargs):
        current = load_story_config(story_path)
        assert current.get("chapters", [])[0].get("summary", "") == ""
        yield {"content": "Rewritten chapter summary."}

    payload = {
        "target": "summary",
        "action": "rewrite",
        "chap_id": 1,
        "scope": "chapter",
        "current_text": "Notes about the chapter.",
        "source": "notes",
    }

    with patch(
        "augmentedquill.services.llm.llm.unified_chat_stream",
        side_effect=fake_unified_chat_stream,
    ):
        prepared = prepare_ai_action_generation(payload)
        assert prepared.get("_summary_rewrite_backup") is not None

        async for _ in _create_gen_source(prepared):
            pass

    final_story = load_story_config(story_path)
    assert final_story.get("chapters", [])[0].get("summary") == "Old chapter summary"


@pytest.mark.anyio
async def test_generate_story_summary_discard_clears_existing_summary_before_llm_call():
    ok, msg = select_project("discard_story_summary")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["project_type"] = "short-story"
    story["story_summary"] = "Outdated summary"
    save_story_config(story_path, story)

    content_path = project_dir / "content.md"
    content_path.write_text("Once upon a time.", encoding="utf-8")

    async def fake_unified_chat_complete(*args, **kwargs):
        current = load_story_config(story_path)
        assert current.get("story_summary", "") == ""
        return {"content": "New story summary"}

    with patch(
        "augmentedquill.services.llm.llm.unified_chat_complete",
        side_effect=fake_unified_chat_complete,
    ):
        result = await generate_story_summary(mode="discard")

    assert result["summary"] == "New story summary"
    final_story = load_story_config(story_path)
    assert final_story["story_summary"] == "New story summary"


@pytest.mark.anyio
async def test_generate_chapter_summary_discard_clears_existing_summary_before_llm_call():
    ok, msg = select_project("discard_chapter_summary")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    # Create a single chapter file with text so chapter summary can be generated.
    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter_file = chapters_dir / "0001.txt"
    chapter_file.write_text("A lonely hero walks through the woods.", encoding="utf-8")

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["chapters"] = [{"title": "Chapter 1", "summary": "Old chapter summary"}]
    save_story_config(story_path, story)

    async def fake_unified_chat_complete(*args, **kwargs):
        current = load_story_config(story_path)
        assert current.get("chapters", [])[0].get("summary", "") == ""
        return {"content": "New chapter summary"}

    with patch(
        "augmentedquill.services.llm.llm.unified_chat_complete",
        side_effect=fake_unified_chat_complete,
    ):
        result = await generate_chapter_summary(chap_id=1, mode="discard")

    assert result["summary"] == "New chapter summary"
    final_story = load_story_config(story_path)
    assert final_story.get("chapters", [])[0].get("summary") == "New chapter summary"


def test_prepare_ai_action_chapter_rewrite_reuses_extend_prompt_without_prefill():
    ok, msg = select_project("rewrite_heading_prefix")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["project_type"] = "novel"
    story["chapters"] = [
        {
            "title": "My chapter title",
            "summary": "Chapter summary",
            "filename": "0001.txt",
        }
    ]
    save_story_config(story_path, story)

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text(
        "Existing chapter content.", encoding="utf-8"
    )

    prepared = prepare_ai_action_generation(
        {
            "target": "chapter",
            "action": "rewrite",
            "chap_id": 1,
            "scope": "chapter",
            "current_text": "This text should be ignored for rewrite.",
        }
    )

    assert prepared["existing_content"] == "This text should be ignored for rewrite."
    assert prepared["response_prefill"] is None
    assert prepared["extra_body"] is None


def test_prepare_ai_action_chapter_extend_prefills_full_draft_with_heading():
    ok, msg = select_project("extend_full_prefill")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["project_type"] = "novel"
    story["chapters"] = [
        {
            "title": "My chapter title",
            "summary": "Chapter summary",
            "filename": "0001.txt",
        }
    ]
    save_story_config(story_path, story)

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text(
        "Existing chapter content.", encoding="utf-8"
    )

    prepared = prepare_ai_action_generation(
        {
            "target": "chapter",
            "action": "extend",
            "chap_id": 1,
            "scope": "chapter",
            "current_text": "Existing chapter content.",
        }
    )

    assert prepared["existing_content"] == "Existing chapter content."
    assert (
        prepared["response_prefill"]
        == "# My chapter title\n\nExisting chapter content."
    )
    assert prepared["extra_body"] == {
        "chat_template_kwargs": {
            "continue_final_message": True,
            "enable_thinking": False,
        }
    }


def test_prepare_ai_action_chapter_extend_includes_current_and_next_scene_context():
    ok, msg = select_project("extend_scene_context")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["project_type"] = "novel"
    story["sourcebook"] = {
        "Hero": {"description": "Hero of the valley.", "category": "Character"},
        "Town": {"description": "A cramped mountain town.", "category": "Location"},
        "Villain": {
            "description": "The hunter stalking the hero.",
            "category": "Character",
        },
    }
    story["chapters"] = [
        {
            "title": "Chapter 1",
            "summary": "The hero arrives and danger follows.",
            "filename": "0001.txt",
        }
    ]
    scene_one_text = "Alpha scene."
    scene_two_text = " Beta scene."
    story["scenes"] = {
        "1": {
            "summary": "Arrival in town",
            "active_characters": ["Hero"],
            "location": "Town",
            "sourcebook_entry_ids": [],
            "order_index": 1,
            "prose_link": {
                "scope_type": "chapter",
                "chapter_id": "1",
                "start_offset": 0,
                "end_offset": len(scene_one_text),
            },
        },
        "2": {
            "summary": "The hunter closes in",
            "active_characters": ["Villain"],
            "location": "Town",
            "sourcebook_entry_ids": [],
            "order_index": 2,
            "prose_link": {
                "scope_type": "chapter",
                "chapter_id": "1",
                "start_offset": len(scene_one_text),
                "end_offset": len(scene_one_text + scene_two_text),
            },
        },
    }
    save_story_config(story_path, story)

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text(
        scene_one_text + scene_two_text, encoding="utf-8"
    )

    prepared = prepare_ai_action_generation(
        {
            "target": "chapter",
            "action": "extend",
            "chap_id": 1,
            "scope": "chapter",
            "current_text": scene_one_text,
        }
    )

    prompt_text = "\n\n".join(
        str(message.get("content", "")) for message in prepared["messages"]
    )
    assert "Current scene" in prompt_text
    assert "Summary: Arrival in town" in prompt_text
    assert "Next scene" in prompt_text
    assert "Summary: The hunter closes in" in prompt_text
    assert "Active characters: Villain" in prompt_text
    assert "Location: Town" in prompt_text
    assert "---" in prompt_text
    assert "Hero of the valley." in prompt_text
    assert "The hunter stalking the hero." in prompt_text
    assert "A cramped mountain town." in prompt_text


def test_prepare_ai_action_chapter_rewrite_includes_all_scene_context_and_references():
    ok, msg = select_project("rewrite_scene_context")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["project_type"] = "novel"
    story["sourcebook"] = {
        "Hero": {"description": "Hero profile.", "category": "Character"},
        "Guide": {"description": "Guide profile.", "category": "Character"},
        "Relic": {"description": "Ancient relic lore.", "category": "Item"},
    }
    story["chapters"] = [
        {
            "title": "Chapter 1",
            "summary": "A three-step expedition.",
            "filename": "0001.txt",
        }
    ]
    chapter_text = "One. Two. Three."
    story["scenes"] = {
        "1": {
            "summary": "Preparation",
            "active_characters": ["Hero"],
            "location": None,
            "sourcebook_entry_ids": ["Relic"],
            "order_index": 1,
            "prose_link": {
                "scope_type": "chapter",
                "chapter_id": "1",
                "start_offset": 0,
                "end_offset": 4,
            },
        },
        "2": {
            "summary": "Journey",
            "active_characters": ["Guide"],
            "location": None,
            "sourcebook_entry_ids": [],
            "order_index": 2,
            "prose_link": {
                "scope_type": "chapter",
                "chapter_id": "1",
                "start_offset": 4,
                "end_offset": 9,
            },
        },
        "3": {
            "summary": "Discovery",
            "active_characters": ["Hero", "Guide"],
            "location": None,
            "sourcebook_entry_ids": ["Relic"],
            "order_index": 3,
            "prose_link": {
                "scope_type": "chapter",
                "chapter_id": "1",
                "start_offset": 9,
                "end_offset": len(chapter_text),
            },
        },
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text(chapter_text, encoding="utf-8")

    prepared = prepare_ai_action_generation(
        {
            "target": "chapter",
            "action": "rewrite",
            "chap_id": 1,
            "scope": "chapter",
            "current_text": chapter_text,
        }
    )

    prompt_text = "\n\n".join(
        str(message.get("content", "")) for message in prepared["messages"]
    )
    assert "Scene plan for this draft" in prompt_text
    assert "Scene 1" in prompt_text
    assert "Summary: Preparation" in prompt_text
    assert "Scene 2" in prompt_text
    assert "Summary: Journey" in prompt_text
    assert "Scene 3" in prompt_text
    assert "Summary: Discovery" in prompt_text
    assert "Hero profile." in prompt_text
    assert "Guide profile." in prompt_text
    assert "Ancient relic lore." in prompt_text
    assert "Existing draft text" not in prompt_text
    assert "Task: Continue or rewrite the current draft" in prompt_text


def test_prepare_ai_action_chapter_extend_uses_marker_aware_cursor_for_scene_context():
    ok, msg = select_project("extend_marker_aware_scene_cursor")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["project_type"] = "novel"
    story["sourcebook"] = {
        "Hero-A": {"description": "Alpha profile.", "category": "Character"},
        "Hero-B": {"description": "Beta profile.", "category": "Character"},
        "Hero-C": {"description": "Gamma profile.", "category": "Character"},
    }
    story["chapters"] = [
        {
            "title": "Chapter 1",
            "summary": "Three linked scenes.",
            "filename": "0001.txt",
        }
    ]

    marker_s1_start = "<!--scene:1:start-->"
    marker_s1_end = "<!--scene:1:end-->"
    marker_s2_start = "<!--scene:2:start-->"
    marker_s2_end = "<!--scene:2:end-->"
    marker_s3_start = "<!--scene:3:start-->"
    marker_s3_end = "<!--scene:3:end-->"
    s1_plain = "Alpha."
    s2_plain = "Beta."
    s3_plain = "Gamma."
    s1_segment = f"{marker_s1_start}{s1_plain}{marker_s1_end}"
    s2_segment = f"{marker_s2_start}{s2_plain}{marker_s2_end}"
    s3_segment = f"{marker_s3_start}{s3_plain}{marker_s3_end}"
    chapter_text = f"{s1_segment}{s2_segment}{s3_segment}"

    s1_start = 0
    s1_end = len(s1_segment)
    s2_start = s1_end
    s2_end = s1_end + len(s2_segment)
    s3_start = s2_end
    s3_end = s2_end + len(s3_segment)

    story["scenes"] = {
        "1": {
            "summary": "Alpha scene",
            "active_characters": ["Hero-A"],
            "order_index": 1,
            "prose_link": {
                "scope_type": "chapter",
                "chapter_id": "1",
                "start_offset": s1_start,
                "end_offset": s1_end,
            },
        },
        "2": {
            "summary": "Beta scene",
            "active_characters": ["Hero-B"],
            "order_index": 2,
            "prose_link": {
                "scope_type": "chapter",
                "chapter_id": "1",
                "start_offset": s2_start,
                "end_offset": s2_end,
            },
        },
        "3": {
            "summary": "Gamma scene",
            "active_characters": ["Hero-C"],
            "order_index": 3,
            "prose_link": {
                "scope_type": "chapter",
                "chapter_id": "1",
                "start_offset": s3_start,
                "end_offset": s3_end,
            },
        },
    }
    save_story_config(story_path, story)

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text(chapter_text, encoding="utf-8")

    prepared = prepare_ai_action_generation(
        {
            "target": "chapter",
            "action": "extend",
            "chap_id": 1,
            "scope": "chapter",
            "current_text": f"{s1_plain}{s2_plain}",
        }
    )

    prompt_text = "\n\n".join(
        str(message.get("content", "")) for message in prepared["messages"]
    )
    assert "Summary: Beta scene" in prompt_text
    assert "Summary: Gamma scene" in prompt_text
    assert "Summary: Alpha scene" not in prompt_text
    assert "Beta profile." in prompt_text
    assert "Gamma profile." in prompt_text


def test_prepare_ai_action_chapter_rewrite_series_filters_scene_context_by_book():
    ok, msg = select_project("rewrite_scene_context_series_book_scope")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["project_type"] = "series"
    story["sourcebook"] = {
        "Book1Hero": {"description": "Book 1 hero profile.", "category": "Character"},
        "Book2Hero": {"description": "Book 2 hero profile.", "category": "Character"},
    }
    story["books"] = [
        {
            "id": "book-1",
            "title": "Book One",
            "chapters": [
                {
                    "title": "Book 1 Chapter 1",
                    "summary": "Book 1 summary",
                    "filename": "0001.txt",
                }
            ],
        },
        {
            "id": "book-2",
            "title": "Book Two",
            "chapters": [
                {
                    "title": "Book 2 Chapter 1",
                    "summary": "Book 2 summary",
                    "filename": "0001.txt",
                }
            ],
        },
    ]
    story["scenes"] = {
        "1": {
            "summary": "Book 1 chapter scene",
            "active_characters": ["Book1Hero"],
            "order_index": 1,
            "prose_link": {
                "scope_type": "chapter",
                "book_id": "book-1",
                "chapter_id": "1",
                "start_offset": 0,
                "end_offset": 20,
            },
        },
        "2": {
            "summary": "Book 2 chapter scene",
            "active_characters": ["Book2Hero"],
            "order_index": 2,
            "prose_link": {
                "scope_type": "chapter",
                "book_id": "book-2",
                "chapter_id": "1",
                "start_offset": 0,
                "end_offset": 20,
            },
        },
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")

    (project_dir / "books" / "book-1" / "chapters").mkdir(parents=True, exist_ok=True)
    (project_dir / "books" / "book-2" / "chapters").mkdir(parents=True, exist_ok=True)
    (project_dir / "books" / "book-1" / "chapters" / "0001.txt").write_text(
        "Book one chapter prose.", encoding="utf-8"
    )
    (project_dir / "books" / "book-2" / "chapters" / "0001.txt").write_text(
        "Book two chapter prose.", encoding="utf-8"
    )

    prepared = prepare_ai_action_generation(
        {
            "target": "chapter",
            "action": "rewrite",
            "chap_id": 1,
            "scope": "chapter",
            "current_text": "Book one chapter prose.",
        }
    )

    prompt_text = "\n\n".join(
        str(message.get("content", "")) for message in prepared["messages"]
    )
    assert "Summary: Book 1 chapter scene" in prompt_text
    assert "Book 1 hero profile." in prompt_text
    assert "Summary: Book 2 chapter scene" not in prompt_text
    assert "Book 2 hero profile." not in prompt_text


def test_prepare_ai_action_chapter_extend_short_story_uses_story_scoped_scene_context():
    ok, msg = select_project("extend_scene_context_short_story_scope")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["project_type"] = "short-story"
    story["project_title"] = "Short Story"
    story["story_summary"] = "One-scope story."
    story["sourcebook"] = {
        "ShortHero": {
            "description": "Short-story protagonist.",
            "category": "Character",
        }
    }
    story["scenes"] = {
        "1": {
            "summary": "Opening short-story scene",
            "active_characters": ["ShortHero"],
            "order_index": 1,
            "prose_link": {
                "scope_type": "story",
                "start_offset": 0,
                "end_offset": 40,
            },
        }
    }
    save_story_config(story_path, story)

    content_path = project_dir / "content.md"
    content_path.write_text("Opening short story prose.", encoding="utf-8")

    prepared = prepare_ai_action_generation(
        {
            "target": "chapter",
            "action": "extend",
            "chap_id": 1,
            "current_text": "Opening short story prose.",
        }
    )

    prompt_text = "\n\n".join(
        str(message.get("content", "")) for message in prepared["messages"]
    )
    assert "Summary: Opening short-story scene" in prompt_text
    assert "Short-story protagonist." in prompt_text


def test_prepare_ai_action_chapter_extend_prompt_includes_write_scene_context_and_strips_markers():
    ok, msg = select_project("extend_prompt_quality_and_marker_strip")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["project_type"] = "novel"
    story["notes"] = "Story notes: Keep tension grounded."
    story["sourcebook"] = {
        "Hero": {
            "description": "Main protagonist profile.",
            "category": "Character",
            "origin_date": "2000-01-01T00:00:00Z",
        },
        "Town": {
            "description": "A brittle mountain town.",
            "category": "Location",
        },
    }
    story["chapters"] = [
        {
            "title": "Chapter 1",
            "summary": "A tense return.",
            "filename": "0001.txt",
            "notes": "Chapter notes: Keep it close POV.",
        }
    ]

    marker_start = "<!--scene:1:start-->"
    marker_end = "<!--scene:1:end-->"
    visible_scene_text = "Hero enters town."
    chapter_text = f"{marker_start}{visible_scene_text}{marker_end}"

    story["scenes"] = {
        "1": {
            "summary": "Arrival scene",
            "beats": [
                {"id": "b1", "text": "Hero sees the old bell tower."},
                {"id": "b2", "text": "The town square falls silent."},
            ],
            "active_characters": ["Hero"],
            "location": "Town",
            "scene_time": {"temporal_zoned_datetime": "2026-05-29T12:00:00Z"},
            "order_index": 1,
            "prose_link": {
                "scope_type": "chapter",
                "chapter_id": "1",
                "start_offset": len(marker_start),
                "end_offset": len(marker_start) + len(visible_scene_text),
            },
        }
    }
    save_story_config(story_path, story)

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text(chapter_text, encoding="utf-8")

    prepared = prepare_ai_action_generation(
        {
            "target": "chapter",
            "action": "extend",
            "chap_id": 1,
            "scope": "chapter",
            "current_text": chapter_text,
        }
    )

    prompt_text = "\n\n".join(
        str(message.get("content", "")) for message in prepared["messages"]
    )

    assert "<!--scene:" not in prompt_text
    assert "# Story" in prompt_text
    assert "# Current draft" in prompt_text
    assert "## Existing text (reference)" not in prompt_text
    assert "Story notes: Keep tension grounded." in prompt_text
    assert "## Background" in prompt_text
    assert "# Scene guidance" in prompt_text
    assert "## Current scene" in prompt_text
    assert "---" in prompt_text
    assert "## Draft notes" in prompt_text
    assert "## Active conflicts" not in prompt_text
    assert "Beats:" in prompt_text
    assert "1. Hero sees the old bell tower." in prompt_text
    assert "2. The town square falls silent." in prompt_text
    assert "Active characters: Hero [26y]" in prompt_text


def test_prepare_ai_action_chapter_extend_excludes_legacy_scenes_without_prose_link():
    ok, msg = select_project("extend_scene_context_excludes_unscoped_legacy_scenes")
    assert ok, msg

    project_dir = get_active_project_dir()
    assert project_dir is not None

    story_path = project_dir / "story.json"
    story = load_story_config(story_path)
    story["project_type"] = "novel"
    story["sourcebook"] = {
        "Hero3": {"description": "Chapter three hero.", "category": "Character"},
        "OldHero": {"description": "Legacy unscoped hero.", "category": "Character"},
    }
    story["chapters"] = [
        {"title": "Chapter 1", "summary": "Earlier chapter", "filename": "0001.txt"},
        {"title": "Chapter 2", "summary": "Middle chapter", "filename": "0002.txt"},
        {"title": "Chapter 3", "summary": "Current chapter", "filename": "0003.txt"},
    ]
    story["scenes"] = {
        "1": {
            "summary": "Legacy scene with no scope",
            "active_characters": ["OldHero"],
            "order_index": 1,
            # Intentionally no prose_link; this must not leak into chapter-3 Extend context.
        },
        "3": {
            "summary": "Chapter 3 current scene",
            "active_characters": ["Hero3"],
            "order_index": 2,
            "prose_link": {
                "scope_type": "chapter",
                "chapter_id": "3",
                "start_offset": 0,
                "end_offset": 20,
            },
        },
    }
    save_story_config(story_path, story)

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text("Earlier prose", encoding="utf-8")
    (chapters_dir / "0002.txt").write_text("Middle prose", encoding="utf-8")
    (chapters_dir / "0003.txt").write_text("Chapter three prose.", encoding="utf-8")

    prepared = prepare_ai_action_generation(
        {
            "target": "chapter",
            "action": "extend",
            "chap_id": 3,
            "scope": "chapter",
            "current_text": "Chapter three prose.",
        }
    )

    prompt_text = "\n\n".join(
        str(message.get("content", "")) for message in prepared["messages"]
    )
    assert "Summary: Chapter 3 current scene" in prompt_text
    assert "Chapter three hero." in prompt_text
    assert "Summary: Legacy scene with no scope" not in prompt_text
    assert "Legacy unscoped hero." not in prompt_text
