# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Validates all LLM-callable chat tools for successful execution and graceful handling of malformed and invalid tool-call inputs."""

import datetime
import json
import os
import tempfile
import uuid
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

import augmentedquill.main as main
from augmentedquill.services.chat.chat_tools_schema import get_story_tools
from augmentedquill.services.chat.chat_tool_decorator import get_registered_tool_schemas
from augmentedquill.services.projects.project_snapshots import capture_project_snapshot
from augmentedquill.services.projects.projects import (
    get_active_project_dir,
    select_project,
)
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    sourcebook_create_entry,
)


def _parse_tool_sse_result(text: str) -> dict:
    """Extract the 'result' event payload from a chat/tools SSE response."""
    for line in text.splitlines():
        if line.startswith("data: ") and line != "data: [DONE]":
            try:
                data = json.loads(line[6:])
                if data.get("type") == "result":
                    return data
            except json.JSONDecodeError:
                pass
    return {}


class ChatToolContractsTest(TestCase):
    _SPECIAL_CASE_MUTATION_TOOLS = {
        # Covered with nested-tool-call behavior assertions in test_chat_tools.py
        "call_editing_assistant",
        "undo_last_tool_changes",
    }

    _READ_ONLY_TOOLS = {
        "call_writing_llm",
        "get_book_metadata",
        "get_chapter_content",
        "get_chapter_metadata",
        "get_chapter_summaries",
        "get_current_chapter_id",
        "manage_images",
        "manage_project",
        "manage_scenes",
        "manage_scratchpad",
        "manage_sourcebook",
        "manage_story_core",
        "read_book_content",
        "read_editing_scratchpad",
        "recommend_metadata_updates",
        "search_and_replace",
    }

    _EDITING_ONLY_TOOLS = {
        "replace_text_in_chapter",
        "apply_chapter_replacements",
        "insert_text_at_marker",
        "insert_image_in_chapter",
        "read_editing_scratchpad",
        "write_editing_scratchpad",
        "recommend_metadata_updates",
        "write_chapter_content",
        "write_story_content",
        "write_book_content",
    }

    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)

        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"

        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        self.client = TestClient(main.app)
        self._bootstrap_project()

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def _bootstrap_project(self):
        ok, msg = select_project("tool_contracts")
        self.assertTrue(ok, msg)

        pdir = self.projects_root / "tool_contracts"
        self.book_id = str(uuid.uuid4())
        series_chapters_dir = pdir / "books" / self.book_id / "chapters"
        series_chapters_dir.mkdir(parents=True, exist_ok=True)
        (series_chapters_dir / "0001.txt").write_text(
            "Initial chapter one text.", encoding="utf-8"
        )
        (series_chapters_dir / "0002.txt").write_text(
            "Initial chapter two text.", encoding="utf-8"
        )

        (pdir / "books" / self.book_id / "content.md").write_text(
            "Initial book content.", encoding="utf-8"
        )

        (pdir / "images").mkdir(parents=True, exist_ok=True)
        (pdir / "images" / "sample.png").write_bytes(b"\x89PNG\r\n\x1a\n")

        story = {
            "metadata": {"version": 2},
            "project_title": "Tool Contracts",
            "format": "markdown",
            "project_type": "series",
            "chapters": [
                {"title": "Chapter One", "summary": "Summary 1"},
                {"title": "Chapter Two", "summary": "Summary 2"},
            ],
            "books": [
                {
                    "id": self.book_id,
                    "title": "Book One",
                    "summary": "Book summary",
                    "notes": "Book notes",
                    "chapters": [
                        {"id": 1, "title": "Chapter One", "summary": "Summary 1"}
                    ],
                }
            ],
            "llm_prefs": {"temperature": 0.7, "max_tokens": 256},
            "story_summary": "Initial story summary",
            "tags": ["seed"],
        }
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")
        (pdir / "story_content.md").write_text(
            "Initial story content.", encoding="utf-8"
        )

        sourcebook_create_entry(
            name="Hero Entry",
            description="A known sourcebook character",
            category="character",
            synonyms=["The Hero"],
        )

    def _set_project_type(self, project_type: str) -> None:
        pdir = self.projects_root / "tool_contracts"
        story_path = pdir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["project_type"] = project_type
        story_path.write_text(json.dumps(story), encoding="utf-8")

    def _tool_names(self):
        return [t["function"]["name"] for t in get_story_tools()]

    def _representative_tool_names(self):
        """Return a curated subset of tool names covering tool categories.

        Each tool's full contract is validated exhaustively in
        test_chat_tools.py.  This subset ensures the framework-level
        error-handling and validation patterns work across categories
        without iterating every registered tool.
        """
        return [
            "manage_story_core",  # mutation
            "manage_project",  # read-only / listing
            "manage_sourcebook",  # sourcebook CRUD
            "manage_scenes",  # scene CRUD
            "manage_scratchpad",  # scratchpad
            "manage_images",  # image management
            "search_and_replace",  # search
            "delete_chapter",  # deletion (has confirm)
            "replace_text_in_chapter",  # editing-only (EDITING role)
        ]

    def _call_tool(self, name: str, args, model_type: str = "CHAT"):
        if isinstance(args, str):
            arguments = args
        else:
            arguments = json.dumps(args)

        body = {
            "model_type": model_type,
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": f"call_{name}",
                            "type": "function",
                            "function": {"name": name, "arguments": arguments},
                        }
                    ],
                }
            ],
            "active_chapter_id": 1,
        }
        response = self.client.post(
            "/api/v1/projects/tool_contracts/chat/tools", json=body
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = _parse_tool_sse_result(response.text)
        appended = payload.get("appended_messages") or []
        self.assertEqual(len(appended), 1, payload)
        msg = appended[0]
        self.assertEqual(msg.get("name"), name)
        self.assertEqual(msg.get("role"), "tool")
        content = json.loads(msg.get("content") or "{}")
        self.assertIsInstance(content, (dict, list, str, int, float, bool, type(None)))
        return content

    def test_short_story_chat_tools_include_writing_delegation_tools(self):
        tools = get_registered_tool_schemas(
            model_type="CHAT", project_type="short-story"
        )
        names = [t["function"]["name"] for t in tools]
        self.assertIn("call_writing_llm", names)
        self.assertIn("call_editing_assistant", names)

    def test_manage_story_core_exists_for_all_project_types(self):
        for project_type in ("novel", "series"):
            tools = get_registered_tool_schemas(
                model_type="CHAT", project_type=project_type
            )
            metadata_tool = next(
                (t for t in tools if t["function"]["name"] == "manage_story_core"),
                None,
            )
            self.assertIsNotNone(metadata_tool, "manage_story_core schema should exist")
            properties = (
                metadata_tool.get("function", {})
                .get("parameters", {})
                .get("properties", {})
            )
            self.assertIsInstance(properties, dict)
            self.assertIn("action", properties)

    def test_manage_sourcebook_schema_exists_by_project_type(self):
        for project_type in ("short-story", "novel", "series"):
            tools = get_registered_tool_schemas(
                model_type="CHAT", project_type=project_type
            )
            tool = next(
                (t for t in tools if t["function"]["name"] == "manage_sourcebook"),
                None,
            )
            self.assertIsNotNone(tool, "manage_sourcebook schema should exist")
            properties = (
                tool.get("function", {}).get("parameters", {}).get("properties", {})
            )
            self.assertIn("action", properties)
            self.assertIn("relation_data", properties)
            if tool.get("function", {}).get("name") == "manage_sourcebook":
                self.assertIn(
                    "relations", properties.get("entry_data", {}).get("properties", {})
                )
                self.assertIn(
                    "relations", properties.get("update_data", {}).get("properties", {})
                )

    def test_manage_sourcebook_relation_fields_are_integer_type(self):
        tools = get_registered_tool_schemas(model_type="CHAT", project_type="series")
        tool = next(
            (t for t in tools if t["function"]["name"] == "manage_sourcebook"),
            None,
        )
        self.assertIsNotNone(tool, "manage_sourcebook schema should exist")
        relation_schema = (
            tool.get("function", {})
            .get("parameters", {})
            .get("properties", {})
            .get("relation_data", {})
            .get("properties", {})
        )
        self.assertEqual(relation_schema.get("start_scene", {}).get("type"), "integer")
        self.assertEqual(relation_schema.get("end_scene", {}).get("type"), "integer")

    def test_manage_scenes_update_schema_exposes_patch_fields(self):
        tools = get_registered_tool_schemas(model_type="CHAT", project_type="series")
        tool = next(
            (t for t in tools if t["function"]["name"] == "manage_scenes"),
            None,
        )
        self.assertIsNotNone(tool, "manage_scenes schema should exist")

        update_schema = (
            tool.get("function", {})
            .get("parameters", {})
            .get("properties", {})
            .get("update_data", {})
        )
        update_props = update_schema.get("properties", {})
        self.assertIn("summary_patch", update_props)
        self.assertIn("active_characters_patch", update_props)
        self.assertIn("passive_characters_patch", update_props)
        self.assertIn("sourcebook_entry_ids_patch", update_props)
        self.assertIn("causes_patch", update_props)

        causes_schema = update_props.get("causes", {})
        self.assertEqual(causes_schema.get("type"), "array")
        self.assertEqual(causes_schema.get("items", {}).get("type"), "integer")

        causes_patch_schema = update_props.get("causes_patch", {})
        self.assertEqual(
            causes_patch_schema.get("properties", {})
            .get("add", {})
            .get("items", {})
            .get("type"),
            "integer",
        )
        self.assertEqual(
            causes_patch_schema.get("properties", {})
            .get("remove", {})
            .get("items", {})
            .get("type"),
            "integer",
        )

        scene_time_schema = update_props.get("scene_time", {})
        scene_time_description = scene_time_schema.get("description", "")
        self.assertIn("ISO 8601 datetime string", scene_time_description)
        self.assertIn("gracefully normalized", scene_time_description)

    def test_manage_scenes_create_schema_uses_summary_not_title(self):
        tools = get_registered_tool_schemas(model_type="CHAT", project_type="series")
        tool = next(
            (t for t in tools if t["function"]["name"] == "manage_scenes"),
            None,
        )
        self.assertIsNotNone(tool, "manage_scenes schema should exist")

        create_schema = (
            tool.get("function", {})
            .get("parameters", {})
            .get("properties", {})
            .get("create_data", {})
        )
        create_props = create_schema.get("properties", {})
        self.assertNotIn("title", create_props)

        summary_schema = create_props.get("summary", {})
        summary_description = summary_schema.get("description", "")
        self.assertIn("separate title field", summary_description)
        self.assertIn("use this field instead", summary_description)

        beats_description = create_props.get("beats", {}).get("description", "")
        self.assertIn("micro-beat breakdown", beats_description)

        active_description = create_props.get("active_characters", {}).get(
            "description", ""
        )
        self.assertIn("sourcebook/character IDs", active_description)

        passive_description = create_props.get("passive_characters", {}).get(
            "description", ""
        )
        self.assertIn("sourcebook/character IDs", passive_description)

        sourcebook_entry_ids_description = create_props.get(
            "sourcebook_entry_ids", {}
        ).get("description", "")
        self.assertIn(
            "Always include relevant sourcebook entries",
            sourcebook_entry_ids_description,
        )

        scene_time_description = create_props.get("scene_time", {}).get(
            "description", ""
        )
        self.assertIn("Formal timeline position", scene_time_description)
        self.assertIn("relative chronology", scene_time_description)
        self.assertNotIn("prose_link", create_props)

    def test_manage_scenes_schema_exposes_update_placement_fields(self):
        tools = get_registered_tool_schemas(model_type="CHAT", project_type="series")
        tool = next(
            (t for t in tools if t["function"]["name"] == "manage_scenes"),
            None,
        )
        self.assertIsNotNone(tool, "manage_scenes schema should exist")

        props = tool.get("function", {}).get("parameters", {}).get("properties", {})
        self.assertIn("update_data", props)
        self.assertIn("scope_type", props)
        self.assertIn("scope", props)

        update_data_schema = props.get("update_data", {})
        update_data_props = update_data_schema.get("properties", {})
        self.assertIn("chapter_number", update_data_props)
        self.assertIn("chapter_position", update_data_props)
        self.assertIn("book_number", update_data_props)

        action_schema = props.get("action", {})
        self.assertNotIn("move", action_schema.get("enum") or [])

    def test_manage_scenes_list_hides_internal_prose_link_offsets(self):
        created = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Offset hidden",
                },
            },
            model_type="CHAT",
        )
        self.assertTrue(created.get("id"))

        scenes = self._call_tool(
            "manage_scenes",
            {
                "action": "list",
            },
            model_type="CHAT",
        )
        self.assertIsInstance(scenes, list)

        match = next(
            (scene for scene in scenes if scene.get("id") == created.get("id")), None
        )
        self.assertIsNotNone(match)
        prose_link = match.get("prose_link")
        self.assertIsInstance(prose_link, dict)
        self.assertIn("scope_type", prose_link)
        self.assertNotIn("start_offset", prose_link)
        self.assertNotIn("end_offset", prose_link)

    def test_manage_scenes_list_accepts_legacy_scope_arguments(self):
        created = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Unlinked only",
                },
            },
            model_type="CHAT",
        )
        self.assertTrue(created.get("id"))

        result_with_scope_type = self._call_tool(
            "manage_scenes",
            {
                "action": "list",
                "scope_type": "story",
            },
            model_type="CHAT",
        )
        self.assertIsInstance(result_with_scope_type, list)

        result_with_scope = self._call_tool(
            "manage_scenes",
            {
                "action": "list",
                "scope": "story",
            },
            model_type="CHAT",
        )
        self.assertIsInstance(result_with_scope, list)

    def test_manage_scenes_update_placement_returns_scoped_scene_list(self):
        first = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "First",
                },
            },
            model_type="CHAT",
        )
        second = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Second",
                },
            },
            model_type="CHAT",
        )
        third = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Third",
                },
            },
            model_type="CHAT",
        )

        for scene_id in (first.get("id"), second.get("id"), third.get("id")):
            self._call_tool(
                "manage_scenes",
                {
                    "action": "update",
                    "scene_id": scene_id,
                    "update_data": {
                        "chapter_number": 1,
                    },
                },
                model_type="CHAT",
            )

        result = self._call_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": third.get("id"),
                "update_data": {
                    "chapter_position": 0,
                },
            },
            model_type="CHAT",
        )

        self.assertIsInstance(result, list)
        self.assertGreaterEqual(len(result), 3)
        ids = [entry.get("scene_id") for entry in result]
        self.assertIn(first.get("id"), ids)
        self.assertIn(second.get("id"), ids)
        self.assertIn(third.get("id"), ids)
        self.assertLess(ids.index(third.get("id")), ids.index(first.get("id")))

        third_payload = next(
            (entry for entry in result if entry.get("scene_id") == third.get("id")),
            None,
        )
        self.assertIsNotNone(third_payload)
        self.assertEqual((third_payload or {}).get("chapter_position"), 0)

    def test_registered_tool_schemas_inline_refs_and_omit_defs(self):
        tools = get_registered_tool_schemas(model_type="CHAT", project_type="series")

        def _assert_no_ref_or_defs(value):
            if isinstance(value, dict):
                self.assertNotIn("$ref", value)
                self.assertNotIn("$defs", value)
                for nested in value.values():
                    _assert_no_ref_or_defs(nested)
            elif isinstance(value, list):
                for nested in value:
                    _assert_no_ref_or_defs(nested)

        _assert_no_ref_or_defs(tools)

    def test_manage_scenes_update_applies_partial_patches(self):
        created = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Opening",
                    "active_characters": ["hero"],
                },
            },
            model_type="CHAT",
        )
        scene_id = created.get("id")
        self.assertTrue(scene_id)

        updated = self._call_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": scene_id,
                "update_data": {
                    "summary_patch": {"operation": "append", "value": " continues"},
                    "active_characters_patch": {"add": ["guide"]},
                },
            },
            model_type="CHAT",
        )

        self.assertEqual(updated.get("summary"), "Opening continues")
        self.assertEqual(updated.get("active_characters"), ["hero", "guide"])

    def test_manage_scenes_update_null_lists_are_sanitized(self):
        created = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Opening",
                    "beats": [{"id": "beat-1", "text": "Beat"}],
                    "active_characters": ["hero"],
                    "passive_characters": ["guide"],
                    "sourcebook_entry_ids": ["Hero Entry"],
                    "causes": [202],
                    "status": "active",
                },
            },
            model_type="CHAT",
        )
        scene_id = created.get("id")
        self.assertTrue(scene_id)

        updated = self._call_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": scene_id,
                "update_data": {
                    "beats": None,
                    "active_characters": None,
                    "passive_characters": None,
                    "sourcebook_entry_ids": None,
                    "causes": None,
                    "status": None,
                },
            },
            model_type="CHAT",
        )

        self.assertEqual(updated.get("beats"), [])
        self.assertEqual(updated.get("active_characters"), [])
        self.assertEqual(updated.get("passive_characters"), [])
        self.assertEqual(updated.get("sourcebook_entry_ids"), [])
        self.assertEqual(updated.get("causes"), [])
        self.assertEqual(updated.get("causes"), [])
        self.assertEqual(updated.get("status"), "active")

        listed = self._call_tool(
            "manage_scenes",
            {"action": "list"},
            model_type="CHAT",
        )
        self.assertTrue(any(scene.get("id") == scene_id for scene in listed))

    def test_manage_scenes_update_causes_replaces_list(self):
        scene_a = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {"summary": "Scene A"},
            },
            model_type="CHAT",
        )
        scene_b = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {"summary": "Scene B"},
            },
            model_type="CHAT",
        )
        self.assertTrue(scene_a.get("id"))
        self.assertTrue(scene_b.get("id"))

        updated = self._call_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": scene_a.get("id"),
                "update_data": {"causes": [scene_b.get("id")]},
            },
            model_type="CHAT",
        )

        self.assertEqual(updated.get("causes"), [scene_b.get("id")])

        retrieved = self._call_tool(
            "manage_scenes",
            {"action": "get", "scene_id": scene_a.get("id")},
            model_type="CHAT",
        )
        self.assertEqual(retrieved.get("causes"), [scene_b.get("id")])

    def test_manage_scenes_update_causes_patch_adds_scene_id(self):
        scene_a = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {"summary": "Scene A"},
            },
            model_type="CHAT",
        )
        scene_b = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {"summary": "Scene B"},
            },
            model_type="CHAT",
        )
        self.assertTrue(scene_a.get("id"))
        self.assertTrue(scene_b.get("id"))

        updated = self._call_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": scene_a.get("id"),
                "update_data": {"causes_patch": {"add": [scene_b.get("id")]}},
            },
            model_type="CHAT",
        )

        self.assertEqual(updated.get("causes"), [scene_b.get("id")])

        retrieved = self._call_tool(
            "manage_scenes",
            {"action": "get", "scene_id": scene_a.get("id")},
            model_type="CHAT",
        )
        self.assertEqual(retrieved.get("causes"), [scene_b.get("id")])

    def test_manage_scenes_update_rejects_unknown_update_fields(self):
        created = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Opening",
                },
            },
            model_type="CHAT",
        )
        scene_id = created.get("id")
        self.assertTrue(scene_id)

        content = self._call_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": scene_id,
                "update_data": {
                    "notes": "Focus on this moment",
                    "summary": "The Social ...",
                },
            },
            model_type="CHAT",
        )

        self.assertEqual(content.get("error"), "Invalid parameters")
        details = content.get("details") or []
        self.assertTrue(
            any(d.get("type") == "extra_forbidden" for d in details),
            msg=f"Expected extra_forbidden detail, got {details}",
        )
        self.assertTrue(
            any(d.get("loc") == ["update_data", "notes"] for d in details),
            msg=f"Expected notes field location, got {details}",
        )

    def test_manage_scenes_create_rejects_invalid_prose_link_chapter_id(self):
        content = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "The Physical Education Class",
                    "location": "The Classroom",
                    "prose_link": {
                        "scope_type": "chapter",
                        "chapter_id": "}, ",
                    },
                },
            },
            model_type="CHAT",
        )

        self.assertEqual(content.get("error"), "Invalid parameters")
        details = content.get("details") or []
        self.assertTrue(
            any(d.get("type") == "value_error" for d in details),
            msg=f"Expected value_error detail, got {details}",
        )
        self.assertTrue(
            any(
                d.get("loc")
                in (
                    ["create_data", "prose_link"],
                    ["create_data", "prose_link", "chapter_id"],
                )
                for d in details
            ),
            msg=f"Expected prose_link chapter_id detail location, got {details}",
        )

    def test_manage_scenes_update_accepts_scene_time_shorthand_string(self):
        created = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Time shorthand update",
                },
            },
            model_type="CHAT",
        )
        scene_id = created.get("id")
        self.assertTrue(scene_id)

        updated = self._call_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": scene_id,
                "update_data": {
                    "scene_time": "1985-11-05T20:00",
                },
            },
            model_type="CHAT",
        )

        scene_time = updated.get("scene_time") or {}
        self.assertEqual(
            scene_time.get("temporal_zoned_datetime"), "1985-11-05T20:00:00Z"
        )

    def test_manage_scenes_update_accepts_scene_time_value_alias(self):
        created = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Time alias update",
                },
            },
            model_type="CHAT",
        )
        scene_id = created.get("id")
        self.assertTrue(scene_id)

        updated = self._call_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": scene_id,
                "update_data": {
                    "scene_time": {"value": "1985-11-05"},
                },
            },
            model_type="CHAT",
        )

        scene_time = updated.get("scene_time") or {}
        self.assertEqual(
            scene_time.get("temporal_zoned_datetime"), "1985-11-05T12:00:00Z"
        )

    def test_manage_scenes_create_rejects_self_referential_ordering(self):
        content = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Self-ref",
                    "causes": [1],
                },
            },
            model_type="CHAT",
        )

        self.assertEqual(content.get("error"), "Invalid scene ordering")
        self.assertIn("cannot reference itself", (content.get("message") or "").lower())

    def test_manage_scenes_update_rejects_self_referential_ordering(self):
        created = self._call_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {"summary": "Base"},
            },
            model_type="CHAT",
        )
        scene_id = created.get("id")
        self.assertTrue(scene_id)

        content = self._call_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": scene_id,
                "update_data": {
                    "causes": [scene_id],
                },
            },
            model_type="CHAT",
        )

        self.assertEqual(content.get("error"), "Invalid scene ordering")
        self.assertIn("cannot reference itself", (content.get("message") or "").lower())

    def test_manage_story_core_conflicts_patch_schema_guides_indexed_updates(self):
        tools = get_registered_tool_schemas(model_type="CHAT", project_type="series")
        tool = next(
            (t for t in tools if t["function"]["name"] == "manage_story_core"),
            None,
        )
        self.assertIsNotNone(tool, "manage_story_core schema should exist")

        update_data = (
            tool.get("function", {})
            .get("parameters", {})
            .get("properties", {})
            .get("update_data", {})
        )
        conflicts_patch = (update_data.get("properties", {}) or {}).get(
            "conflicts_patch", {}
        )
        description = conflicts_patch.get("description", "")
        self.assertIn("append new conflict", description)
        self.assertIn("index:<0-based>", description)

        conflicts_schema = (update_data.get("properties", {}) or {}).get(
            "conflicts", {}
        )
        conflicts_items = conflicts_schema.get("items", {}).get("properties", {})
        self.assertIn("description", conflicts_items)
        self.assertIn("resolution", conflicts_items)
        self.assertIn("resolved", conflicts_items)

    def test_update_chapter_metadata_conflicts_schema_is_structured(self):
        tools = get_registered_tool_schemas(model_type="CHAT", project_type="series")
        tool = next(
            (t for t in tools if t["function"]["name"] == "update_chapter_metadata"),
            None,
        )
        self.assertIsNotNone(tool, "update_chapter_metadata schema should exist")

        params_schema = (
            tool.get("function", {}).get("parameters", {}).get("properties", {})
        )
        conflicts_schema = params_schema.get("conflicts", {})
        conflicts_items = conflicts_schema.get("items", {}).get("properties", {})
        self.assertIn("description", conflicts_items)
        self.assertIn("resolution", conflicts_items)
        self.assertIn("resolved", conflicts_items)

    def test_manage_story_core_conflicts_patch_invalid_update_has_actionable_error(
        self,
    ):
        content = self._call_tool(
            "manage_story_core",
            {
                "action": "update_metadata",
                "update_data": {
                    "conflicts_patch": {
                        "operations": [
                            {
                                "op": "update",
                                "conflict": {
                                    "description": "d",
                                    "resolution": "r",
                                },
                            }
                        ]
                    }
                },
            },
            model_type="CHAT",
        )

        self.assertEqual(content.get("error"), "Invalid parameters")
        details = content.get("details") or []
        self.assertTrue(details)
        message = str(details[0].get("msg", ""))
        self.assertIn("To append a new conflict", message)
        self.assertIn("provide both index and updates", message)

    def test_manager_action_enums_are_role_filtered_for_editing(self):
        tools = {
            t["function"]["name"]: t
            for t in get_registered_tool_schemas(model_type="EDITING")
        }

        manage_project_actions = tools["manage_project"]["function"]["parameters"][
            "properties"
        ]["action"]["enum"]
        self.assertEqual(manage_project_actions, ["get_overview"])

        manage_sourcebook_actions = tools["manage_sourcebook"]["function"][
            "parameters"
        ]["properties"]["action"]["enum"]
        self.assertEqual(manage_sourcebook_actions, ["get", "list"])

        manage_images_actions = tools["manage_images"]["function"]["parameters"][
            "properties"
        ]["action"]["enum"]
        self.assertEqual(manage_images_actions, ["list", "create_placeholder"])

    def test_call_writing_llm_chap_id_description_matches_active_project_type(self):
        tools = get_registered_tool_schemas(
            model_type="CHAT", project_type="short-story"
        )
        tool = next(
            (t for t in tools if t["function"]["name"] == "call_writing_llm"),
            None,
        )
        self.assertIsNotNone(tool, "call_writing_llm schema should exist")
        chap_id_desc = (
            tool.get("function", {})
            .get("parameters", {})
            .get("properties", {})
            .get("chap_id", {})
            .get("description", "")
        )
        self.assertIn(
            "Use 1 or omit",
            chap_id_desc,
            "Short-story schema should indicate chap_id can be omitted",
        )

        tools = get_registered_tool_schemas(model_type="CHAT", project_type="novel")
        tool = next(
            (t for t in tools if t["function"]["name"] == "call_writing_llm"),
            None,
        )
        self.assertIsNotNone(tool, "call_writing_llm schema should exist")
        chap_id_desc = (
            tool.get("function", {})
            .get("parameters", {})
            .get("properties", {})
            .get("chap_id", {})
            .get("description", "")
        )
        self.assertIn(
            "Required when write_mode is set",
            chap_id_desc,
            "Novel schema should indicate chap_id is required when write_mode is set",
        )

    def _call_tool_with_payload(self, name: str, args, model_type: str = "CHAT"):
        if isinstance(args, str):
            arguments = args
        else:
            arguments = json.dumps(args)

        body = {
            "model_type": model_type,
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": f"call_{name}",
                            "type": "function",
                            "function": {"name": name, "arguments": arguments},
                        }
                    ],
                }
            ],
            "active_chapter_id": 1,
        }
        response = self.client.post(
            "/api/v1/projects/tool_contracts/chat/tools", json=body
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = _parse_tool_sse_result(response.text)
        return payload, json.loads(
            (payload.get("appended_messages") or [{}])[0].get("content") or "{}"
        )

    def _tool_role_for_execution(self, tool_name: str) -> str:
        if tool_name in {"write_chapter", "continue_chapter"}:
            return "WRITING"
        return "EDITING" if tool_name in self._EDITING_ONLY_TOOLS else "CHAT"

    def _base_valid_args(self, tool_name: str):
        args = {
            "chap_id": 1,
            "book_id": self.book_id,
            "chapter_ids": [1],
            "book_ids": [self.book_id],
            "scope_type": "story",
            "ordered_scene_ids": [],
            "filename": "sample.png",
            "name_or_id": "Hero Entry",
            "name": "tmp_project_for_delete",
            "description": "Tool test description",
            "content": "Tool test content",
            "summary": "Tool test summary",
            "heading": "Tool test heading",
            "title": "Tool test title",
            "query": "Hero",
            "tags": ["tool", "test"],
            "project_type": "novel",
            "new_type": "series",
            "confirm": False,
            "mode": "update",
            "category": "character",
            "synonyms": ["Alias"],
        }

        if tool_name == "create_project":
            args["name"] = "tmp_project_for_delete"
            args["project_type"] = "series"
        if tool_name == "delete_project":
            args["name"] = "tmp_project_for_delete"
            args["confirm"] = False
        if tool_name == "delete_book":
            args["book_id"] = self.book_id
            args["confirm"] = False
        if tool_name == "create_sourcebook_entry":
            args["name"] = "Hero Entry 2"
            args["description"] = "Secondary sourcebook entry"
            args["category"] = "character"
            args["synonyms"] = ["Hero Alias"]
        if tool_name == "update_sourcebook_entry":
            args["name_or_id"] = "Hero Entry"
            args["description"] = "Updated sourcebook entry"
        if tool_name == "delete_sourcebook_entry":
            args["name_or_id"] = "Hero Entry"
        if tool_name == "delete_chapter":
            args["chap_id"] = 1
            args["confirm"] = False

        if tool_name == "manage_project":
            args = {"action": "list"}
        if tool_name == "manage_story_core":
            args = {"action": "get_metadata"}
        if tool_name == "manage_sourcebook":
            args = {"action": "list"}
        if tool_name == "manage_images":
            args = {"action": "list"}
        if tool_name == "manage_scratchpad":
            args = {"action": "read"}
        if tool_name == "search_and_replace":
            args = {"action": "search", "query": "Hero"}
        if tool_name == "manage_scenes":
            args = {"action": "list"}

        return args

    def _build_args_for_schema(self, tool_schema: dict, invalid: bool):
        fn = tool_schema["function"]
        tool_name = fn["name"]
        params = (fn.get("parameters") or {}).get("properties") or {}
        required = set((fn.get("parameters") or {}).get("required") or [])

        base = self._base_valid_args(tool_name)
        built = {}

        for key, prop in params.items():
            if key not in required:
                continue

            if key in base:
                built[key] = base[key]
                continue

            typ = prop.get("type")
            if typ == "integer":
                built[key] = 1
            elif typ == "number":
                built[key] = 1.0
            elif typ == "boolean":
                built[key] = True
            elif typ == "array":
                built[key] = []
            else:
                built[key] = "value"

        # Include select optional arguments that influence semantic behavior.
        if tool_name == "create_project":
            built["project_type"] = base["project_type"]
        if tool_name in {"delete_project", "delete_book", "delete_chapter"}:
            built["confirm"] = base["confirm"]

        if tool_name == "undo_last_tool_changes":
            built["scope"] = "last_call"
            batch_id = "undo_last_tool_changes"
            project_dir = get_active_project_dir()
            if project_dir is not None:
                batch_dir = project_dir / ".aq_history" / "chat_tool_batches" / batch_id
                if not batch_dir.exists():
                    batch_dir.mkdir(parents=True, exist_ok=True)
                    snapshot = capture_project_snapshot(project_dir)
                    metadata = {
                        "batch_id": batch_id,
                        "created_at": datetime.datetime.now().isoformat(),
                        "tool_names": [tool_name],
                        "changed_chapter_ids": [],
                        "before": snapshot,
                        "after": snapshot,
                    }
                    (batch_dir / "batch.json").write_text(
                        json.dumps(metadata), encoding="utf-8"
                    )
            built["batch_ids"] = [batch_id]

        if invalid:
            invalid_overrides = {
                "chap_id": 999999,
                "book_id": "missing-book-id",
                "chapter_ids": [999999],
                "book_ids": ["missing-book-id"],
                "filename": "does-not-exist.png",
                "name_or_id": "does-not-exist",
                "project_type": "invalid-project-type",
                "new_type": "invalid-project-type",
                "confirm": True,
            }
            for key, value in invalid_overrides.items():
                if key in built:
                    built[key] = value

        return built

    def _assert_invalid_parameters(self, tool_name: str, content):
        self.assertIsInstance(content, dict, f"Expected dict response for {tool_name}")
        self.assertEqual(
            content.get("error"),
            "Invalid parameters",
            f"Expected Invalid parameters for {tool_name}: {content}",
        )
        self.assertIsInstance(
            content.get("details"),
            list,
            f"Expected validation details list for {tool_name}: {content}",
        )

    def test_all_tools_handle_malformed_arguments_gracefully(self):
        for name in self._representative_tool_names():
            content = self._call_tool(
                name,
                "{this is not valid json",
                model_type=self._tool_role_for_execution(name),
            )
            self.assertIsInstance(
                content, (dict, list, str, int, float, bool, type(None))
            )

    def test_all_tools_handle_invalid_content_gracefully(self):
        for name in self._representative_tool_names():
            tool_schema = next(
                t for t in get_story_tools() if t["function"]["name"] == name
            )
            args = self._build_args_for_schema(tool_schema, invalid=True)
            content = self._call_tool(
                name,
                args,
                model_type=self._tool_role_for_execution(name),
            )
            # Contract: invalid semantic input must never crash tool execution.
            self.assertIsInstance(
                content, (dict, list, str, int, float, bool, type(None))
            )

    def test_all_tools_reject_unknown_argument_keys(self):
        for name in self._representative_tool_names():
            tool_schema = next(
                t for t in get_story_tools() if t["function"]["name"] == name
            )
            tool_name = tool_schema["function"]["name"]
            args = self._build_args_for_schema(tool_schema, invalid=False)
            args["unexpected_key"] = "unexpected_value"
            content = self._call_tool(
                tool_name,
                args,
                model_type=self._tool_role_for_execution(tool_name),
            )
            self._assert_invalid_parameters(tool_name, content)

    def test_all_tools_reject_missing_required_keys(self):
        for name in self._representative_tool_names():
            tool_schema = next(
                t for t in get_story_tools() if t["function"]["name"] == name
            )
            fn = tool_schema["function"]
            tool_name = fn["name"]
            required = (fn.get("parameters") or {}).get("required") or []
            if not required:
                continue

            args = self._build_args_for_schema(tool_schema, invalid=False)
            missing_key = required[0]
            self.assertIn(
                missing_key,
                args,
                f"Test harness failed to build required key {missing_key} for {tool_name}",
            )
            args.pop(missing_key)

            content = self._call_tool(
                tool_name,
                args,
                model_type=self._tool_role_for_execution(tool_name),
            )
            self._assert_invalid_parameters(tool_name, content)

    def test_manage_project_get_overview_include_notes_contract(self):
        content = self._call_tool(
            "manage_project", {"action": "get_overview", "include_notes": True}
        )
        self.assertIsInstance(content, dict)
        self.assertNotIn("Execution error", json.dumps(content))

        invalid = self._call_tool(
            "manage_project",
            {
                "action": "get_overview",
                "include_notes": {"unexpected": True},
            },
        )
        self._assert_invalid_parameters("manage_project", invalid)

    def test_manage_project_hides_chapter_filenames(self):
        content = self._call_tool(
            "manage_project", {"action": "get_overview", "include_notes": True}
        )

        def _assert_no_storage_file_keys(value):
            if isinstance(value, dict):
                self.assertNotIn("filename", value)
                self.assertNotIn("content_file", value)
                for nested in value.values():
                    _assert_no_storage_file_keys(nested)
            elif isinstance(value, list):
                for nested in value:
                    _assert_no_storage_file_keys(nested)

        _assert_no_storage_file_keys(content)

    def test_get_chapter_metadata_hides_filename(self):
        content = self._call_tool("get_chapter_metadata", {"chap_id": 1})
        chapter = content.get("chapter") or {}
        self.assertNotIn("filename", chapter)

    def test_tool_registry_filters_by_model_role(self):
        writing_tools = {
            tool["function"]["name"]
            for tool in get_registered_tool_schemas(model_type="WRITING")
        }
        editing_tools = {
            tool["function"]["name"]
            for tool in get_registered_tool_schemas(model_type="EDITING")
        }
        chat_tools = {
            tool["function"]["name"]
            for tool in get_registered_tool_schemas(model_type="CHAT")
        }

        self.assertEqual(writing_tools, {"write_chapter", "continue_chapter"})
        self.assertIn("call_editing_assistant", chat_tools)
        self.assertIn("manage_story_core", chat_tools)
        self.assertNotIn("write_chapter", chat_tools)
        self.assertNotIn("continue_chapter", chat_tools)
        self.assertNotIn("replace_text_in_chapter", chat_tools)
        self.assertIn("replace_text_in_chapter", editing_tools)
        self.assertIn("recommend_metadata_updates", editing_tools)
        self.assertIn("manage_story_core", editing_tools)

    def test_project_tool_descriptions_cover_all_project_types(self):
        schemas = {
            tool["function"]["name"]: tool["function"]
            for tool in get_registered_tool_schemas(model_type="CHAT")
        }

        self.assertIn(
            "short story",
            schemas["manage_project"]["description"].lower(),
        )
        self.assertIn("change_type", schemas["manage_project"]["description"])

    def test_tools_reject_wrong_model_role(self):
        content = self._call_tool(
            "manage_project",
            {
                "action": "create",
                "create_data": {"name": "x", "project_type": "novel"},
            },
            model_type="EDITING",
        )
        self.assertEqual(content.get("error"), "Action unavailable for model role")

        content = self._call_tool(
            "manage_sourcebook",
            {
                "action": "create",
                "entry_data": {
                    "name": "RoleTest",
                    "description": "x",
                    "category": "character",
                },
            },
            model_type="EDITING",
        )
        self.assertEqual(content.get("error"), "Action unavailable for model role")

        content = self._call_tool(
            "manage_images",
            {"action": "set_metadata", "metadata_data": {"filename": "sample.png"}},
            model_type="EDITING",
        )
        self.assertEqual(content.get("error"), "Action unavailable for model role")

        content = self._call_tool(
            "manage_scratchpad",
            {
                "action": "write",
                "write_data": {"content": "test"},
            },
            model_type="EDITING",
        )
        self.assertEqual(content.get("error"), "Tool unavailable for model role")

        content = self._call_tool(
            "recommend_metadata_updates",
            {"story_summary": "Suggested only"},
            model_type="CHAT",
        )
        self.assertEqual(content.get("error"), "Tool unavailable for model role")

        content = self._call_tool(
            "write_chapter",
            {"chap_id": 1},
            model_type="CHAT",
        )
        self.assertEqual(content.get("error"), "Tool unavailable for model role")

        content = self._call_tool(
            "continue_chapter",
            {"chap_id": 1},
            model_type="CHAT",
        )
        self.assertEqual(content.get("error"), "Tool unavailable for model role")

    def test_create_new_chapter_rejected_in_short_story_project(self):
        self._set_project_type("short-story")

        content = self._call_tool(
            "create_new_chapter",
            {"title": "Should fail"},
            model_type="CHAT",
        )

        self.assertEqual(content.get("error"), "Tool unavailable for project type")
        self.assertIn(
            "Cannot create a chapter in a short-story project",
            content.get("message", ""),
        )

    def test_create_new_book_rejected_in_non_series_projects(self):
        for project_type in ("short-story", "novel"):
            self._set_project_type(project_type)
            content = self._call_tool(
                "create_new_book",
                {"title": "Should fail"},
                model_type="CHAT",
            )
            self.assertEqual(
                content.get("error"),
                "Tool unavailable for project type",
            )
            self.assertIn(
                "Book creation is only allowed for series projects",
                content.get("message", ""),
            )

    def test_series_only_tools_reject_wrong_project_context(self):
        self._set_project_type("novel")

        series_only_calls = [
            ("get_book_metadata", {"book_id": self.book_id}),
            ("update_book_metadata", {"book_id": self.book_id, "title": "X"}),
            ("read_book_content", {"book_id": self.book_id}),
            ("write_book_content", {"book_id": self.book_id, "content": "X"}),
            ("delete_book", {"book_id": self.book_id, "confirm": True}),
        ]

        for tool_name, args in series_only_calls:
            model_type = self._tool_role_for_execution(tool_name)
            content = self._call_tool(tool_name, args, model_type=model_type)
            self.assertEqual(
                content.get("error"),
                "Tool unavailable for project type",
                f"Expected project-type rejection for {tool_name}: {content}",
            )

    def test_all_tools_have_successful_execution_path(self):
        async def fake_generate_summary(**kwargs):
            return {"summary": "AI generated chapter summary", "ok": True}

        async def fake_write_chapter(**kwargs):
            return {"content": "AI generated chapter", "ok": True}

        async def fake_continue_chapter(**kwargs):
            return {"content": "AI chapter continuation", "ok": True}

        async def fake_story_summary(**kwargs):
            return {"story_summary": "AI story summary", "ok": True}

        async def fake_image_description(filename: str, payload: dict):
            return "Generated image description"

        async def fake_unified_chat_complete(**kwargs):
            return {"content": "Mocked WRITING response", "ok": True}

        with (
            patch(
                "augmentedquill.services.llm.llm.unified_chat_complete",
                side_effect=fake_unified_chat_complete,
            ),
            patch(
                "augmentedquill.services.chat.chat_tools.chapter_tools.generate_chapter_summary",
                side_effect=fake_generate_summary,
            ),
            patch(
                "augmentedquill.services.chat.chat_tools.chapter_tools.write_chapter_from_summary",
                side_effect=fake_write_chapter,
            ),
            patch(
                "augmentedquill.services.chat.chat_tools.chapter_tools.continue_chapter_from_summary",
                side_effect=fake_continue_chapter,
            ),
            patch(
                "augmentedquill.services.story.story_generation_ops.generate_story_summary",
                side_effect=fake_story_summary,
            ),
            patch(
                "augmentedquill.services.chat.chat_tools.image_tools._tool_generate_image_description",
                side_effect=fake_image_description,
            ),
        ):
            for name in self._representative_tool_names():
                ok, msg = select_project("tool_contracts")
                self.assertTrue(ok, msg)

                tool_schema = next(
                    t for t in get_story_tools() if t["function"]["name"] == name
                )

                if name in ("call_writing_llm", "call_editing_assistant"):
                    self._call_tool(
                        "manage_story_core",
                        {
                            "action": "update_metadata",
                            "update_data": {
                                "conflicts": [
                                    {
                                        "id": "c1",
                                        "description": "Auto conflict guard for test",
                                        "resolution": "Auto resolution",
                                    }
                                ]
                            },
                        },
                        model_type="CHAT",
                    )

                args = self._build_args_for_schema(tool_schema, invalid=False)
                content = self._call_tool(
                    name,
                    args,
                    model_type=self._tool_role_for_execution(name),
                )

                self.assertNotIn("Execution error", json.dumps(content))
                self.assertNotIn("Invalid parameters", json.dumps(content))

    def test_all_project_mutation_tools_emit_story_changed_and_batch(self):
        expected_mutation_tools = {
            "manage_project",
            "manage_story_core",
            "write_story_content",
            "update_book_metadata",
            "write_book_content",
            "update_chapter_metadata",
            "write_chapter_content",
            "replace_text_in_chapter",
            "apply_chapter_replacements",
            "insert_text_at_marker",
            "write_chapter_summary",
            "sync_summary",
            "write_chapter",
            "continue_chapter",
            "create_new_chapter",
            "write_chapter_heading",
            "delete_chapter",
            "delete_book",
            "create_new_book",
            "manage_sourcebook",
            "manage_images",
            "insert_image_in_chapter",
            "manage_scratchpad",
            "manage_scenes",
            "write_editing_scratchpad",
            "search_and_replace",
        }

        tool_names = set(self._tool_names())
        covered_tools = (
            expected_mutation_tools
            | self._READ_ONLY_TOOLS
            | self._SPECIAL_CASE_MUTATION_TOOLS
        )
        self.assertEqual(
            covered_tools,
            tool_names,
            f"Tool classification drift detected. Missing in tests: {sorted(tool_names - covered_tools)}; stale in tests: {sorted(covered_tools - tool_names)}",
        )
        self.assertTrue(
            expected_mutation_tools.issubset(tool_names),
            f"Missing tool coverage: {sorted(expected_mutation_tools - tool_names)}",
        )

        async def fake_generate_summary(**kwargs):
            return {"summary": "AI generated chapter summary", "ok": True}

        async def fake_write_chapter(**kwargs):
            return {"content": "AI generated chapter", "ok": True}

        async def fake_continue_chapter(**kwargs):
            return {"content": "AI chapter continuation", "ok": True}

        async def fake_story_summary(**kwargs):
            return {"story_summary": "AI story summary", "ok": True}

        async def fake_image_description(filename: str, payload: dict):
            return "Generated image description"

        mutation_calls = [
            (
                "manage_project",
                {
                    "action": "create",
                    "create_data": {
                        "name": "chat_tools_mutation_tmp",
                        "project_type": "novel",
                    },
                },
            ),
            (
                "manage_story_core",
                {
                    "action": "update_metadata",
                    "update_data": {"title": "Mutated Title"},
                },
            ),
            ("write_story_content", {"content": "Mutated story content"}),
            (
                "update_book_metadata",
                {"book_id": self.book_id, "title": "Mutated Book Title"},
            ),
            (
                "write_book_content",
                {"book_id": self.book_id, "content": "Mutated book content"},
            ),
            (
                "manage_story_core",
                {"action": "sync_summary", "sync_data": {"mode": "update"}},
            ),
            (
                "update_chapter_metadata",
                {"chap_id": 1, "title": "Mutated Chapter Title"},
            ),
            ("write_chapter_content", {"chap_id": 1, "content": "Mutated chapter"}),
            (
                "replace_text_in_chapter",
                {
                    "chap_id": 1,
                    "old_text": "Mutated chapter",
                    "new_text": "Mutated chapter replaced",
                },
            ),
            ("write_chapter_summary", {"chap_id": 1, "summary": "Mutated summary"}),
            ("sync_summary", {"chap_id": 1, "mode": "update"}),
            ("write_chapter", {"chap_id": 1}),
            ("continue_chapter", {"chap_id": 1}),
            ("create_new_chapter", {"title": "Extra", "book_id": self.book_id}),
            (
                "write_chapter_heading",
                {"chap_id": 1, "heading": "Mutated Heading"},
            ),
            ("delete_chapter", {"chap_id": 2, "confirm": True}),
            (
                "manage_sourcebook",
                {
                    "action": "create",
                    "entry_data": {
                        "name": "Mutation Entry",
                        "description": "created by mutation test",
                        "category": "character",
                    },
                },
            ),
            (
                "manage_sourcebook",
                {
                    "action": "update",
                    "name_or_id": "Mutation Entry",
                    "update_data": {"description": "updated by mutation test"},
                },
            ),
            (
                "manage_sourcebook",
                {"action": "delete", "name_or_id": "Mutation Entry"},
            ),
            (
                "manage_sourcebook",
                {
                    "action": "add_relation",
                    "relation_data": {
                        "source_id": "Hero Entry",
                        "relation_type": "ally",
                        "target_id": "Hero Entry",
                    },
                },
            ),
            (
                "manage_sourcebook",
                {
                    "action": "remove_relation",
                    "relation_data": {
                        "source_id": "Hero Entry",
                        "relation_type": "ally",
                        "target_id": "Hero Entry",
                    },
                },
            ),
            (
                "manage_images",
                {
                    "action": "create_placeholder",
                    "create_data": {
                        "description": "placeholder mutation",
                        "title": "ph",
                    },
                },
            ),
            (
                "manage_images",
                {
                    "action": "set_metadata",
                    "metadata_data": {
                        "filename": "sample.png",
                        "title": "mutated",
                        "description": "mutated",
                    },
                },
            ),
            (
                "manage_images",
                {"action": "generate_description", "filename": "sample.png"},
            ),
            (
                "manage_scratchpad",
                {
                    "action": "write",
                    "write_data": {"content": "scratch mutation"},
                },
            ),
            (
                "search_and_replace",
                {
                    "action": "replace",
                    "query": "Mutated chapter replaced",
                    "replacement": "Mutated chapter rewritten",
                    "scope": "all_chapters",
                },
            ),
            (
                "manage_scenes",
                {
                    "action": "create",
                    "create_data": {
                        "summary": "Mutation scene",
                        "beats": [],
                        "active_characters": [],
                        "passive_characters": [],
                        "sourcebook_entry_ids": [],
                        "location": None,
                        "time": None,
                        "scene_time": None,
                        "color_tag": None,
                        "prose_link": None,
                        "causes": [],
                        "pinboard_x": 100.0,
                        "pinboard_y": 100.0,
                        "status": "active",
                    },
                },
            ),
            (
                "insert_image_in_chapter",
                {"chap_id": 1, "filename": "sample.png", "position": "end"},
            ),
            (
                "manage_project",
                {
                    "action": "delete",
                    "delete_data": {
                        "name": "chat_tools_mutation_tmp",
                        "confirm": True,
                    },
                },
            ),
        ]

        with (
            patch(
                "augmentedquill.services.chat.chat_tools.chapter_tools.generate_chapter_summary",
                side_effect=fake_generate_summary,
            ),
            patch(
                "augmentedquill.services.chat.chat_tools.chapter_tools.write_chapter_from_summary",
                side_effect=fake_write_chapter,
            ),
            patch(
                "augmentedquill.services.chat.chat_tools.chapter_tools.continue_chapter_from_summary",
                side_effect=fake_continue_chapter,
            ),
            patch(
                "augmentedquill.services.story.story_generation_ops.generate_story_summary",
                side_effect=fake_story_summary,
            ),
            patch(
                "augmentedquill.services.chat.chat_tools.image_tools._tool_generate_image_description",
                side_effect=fake_image_description,
            ),
        ):
            for name, args in mutation_calls:
                ok, msg = select_project("tool_contracts")
                self.assertTrue(ok, msg)
                payload, _content = self._call_tool_with_payload(
                    name,
                    args,
                    model_type=self._tool_role_for_execution(name),
                )
                mutations = payload.get("mutations") or {}
                self.assertTrue(
                    mutations.get("story_changed"),
                    f"Expected story_changed for tool {name}: {payload}",
                )
                batch = mutations.get("tool_batch") or {}
                self.assertTrue(
                    batch.get("batch_id"),
                    f"Expected tool_batch batch_id for tool {name}: {payload}",
                )

            create_book_payload, create_book_content = self._call_tool_with_payload(
                "create_new_book", {"title": "Book Two"}, model_type="CHAT"
            )
            self.assertTrue(
                (create_book_payload.get("mutations") or {}).get("story_changed")
            )
            created_book_id = create_book_content.get("book_id")
            self.assertTrue(created_book_id)

            delete_payload, _ = self._call_tool_with_payload(
                "delete_book",
                {"book_id": created_book_id, "confirm": True},
                model_type="CHAT",
            )
            self.assertTrue(
                (delete_payload.get("mutations") or {}).get("story_changed")
            )

            change_payload, _ = self._call_tool_with_payload(
                "manage_project",
                {
                    "action": "change_type",
                    "type_data": {"new_type": "novel"},
                },
                model_type="CHAT",
            )
            self.assertTrue(
                (change_payload.get("mutations") or {}).get("story_changed")
            )

    def _get_tool_properties(
        self, tool_name: str, project_type: str = "short-story"
    ) -> set[str]:
        tools = get_registered_tool_schemas(
            model_type="CHAT", project_type=project_type
        )
        tool = next((t for t in tools if t["function"]["name"] == tool_name), None)
        self.assertIsNotNone(
            tool, f"{tool_name} schema should exist for {project_type}"
        )
        return set(
            (
                tool.get("function", {}).get("parameters", {}).get("properties") or {}
            ).keys()
        )

    def test_patch_parameters_present_in_manage_story_core_schema(self):
        for project_type in ("short-story", "novel", "series"):
            props = self._get_tool_properties("manage_story_core", project_type)
            self.assertIn("update_data", props)
            self.assertIn("action", props)

    def test_patch_parameters_present_in_update_chapter_metadata_schema(self):
        # update_chapter_metadata is only available for chapter-based project types
        for project_type in ("novel", "series"):
            props = self._get_tool_properties("update_chapter_metadata", project_type)
            for field in ("summary_patch", "notes_patch", "conflicts_patch"):
                self.assertIn(
                    field,
                    props,
                    f"update_chapter_metadata should expose {field} for {project_type}",
                )

    def test_patch_parameters_present_in_update_book_metadata_schema(self):
        # update_book_metadata is only available for series
        tools = get_registered_tool_schemas(model_type="CHAT", project_type="series")
        tool = next(
            (t for t in tools if t["function"]["name"] == "update_book_metadata"), None
        )
        self.assertIsNotNone(
            tool, "update_book_metadata schema should exist for series"
        )
        props = set(
            (
                tool.get("function", {}).get("parameters", {}).get("properties") or {}
            ).keys()
        )
        for field in ("summary_patch", "notes_patch"):
            self.assertIn(
                field,
                props,
                f"update_book_metadata should expose {field}",
            )

    def test_patch_parameters_present_in_manage_sourcebook_schema(self):
        for project_type in ("short-story", "novel", "series"):
            props = self._get_tool_properties("manage_sourcebook", project_type)
            self.assertIn("action", props)
            self.assertIn("update_data", props)

    def test_tool_parameter_refs_are_resolvable(self):
        def _collect_refs(node: object) -> list[str]:
            refs: list[str] = []
            if isinstance(node, dict):
                for k, v in node.items():
                    if k == "$ref" and isinstance(v, str):
                        refs.append(v)
                    refs.extend(_collect_refs(v))
            elif isinstance(node, list):
                for item in node:
                    refs.extend(_collect_refs(item))
            return refs

        for project_type in ("short-story", "novel", "series"):
            for tool in get_registered_tool_schemas(
                model_type="CHAT", project_type=project_type
            ):
                fn = tool.get("function", {})
                params = fn.get("parameters", {})
                refs = _collect_refs(params)
                if not refs:
                    continue

                defs = params.get("$defs", {}) if isinstance(params, dict) else {}
                for ref in refs:
                    if ref.startswith("#/$defs/"):
                        def_name = ref.split("/", 2)[-1]
                        self.assertIn(
                            def_name,
                            defs,
                            f"Unresolvable local ref {ref} in tool {fn.get('name')} for {project_type}",
                        )
