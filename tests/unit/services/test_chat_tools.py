# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test chat tools unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import augmentedquill.main as main
from augmentedquill.services.projects.projects import select_project


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


def _fake_llm_stream(content: str):
    """Return an async generator function that yields a single content chunk."""

    async def _gen(**kwargs):
        yield {"content": content}

    return _gen


class _CapturingStreamMock:
    """Async-generator mock that records keyword arguments for post-call inspection."""

    def __init__(self, content: str):
        self._content = content
        self.last_kwargs: dict | None = None

    async def __call__(self, **kwargs):
        self.last_kwargs = kwargs
        yield {"content": self._content}

    @property
    def await_args(self):
        """Compatibility shim so tests can use .await_args.kwargs like AsyncMock."""
        if self.last_kwargs is None:
            return None

        class _KwargsHolder:
            def __init__(self, kw):
                self.kwargs = kw

        return _KwargsHolder(self.last_kwargs)


class ChatToolsTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)
        self.client = TestClient(main.app)

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def _bootstrap_project(self):
        ok, msg = select_project("demo")
        self.assertTrue(ok, msg)
        pdir = self.projects_root / "demo"
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("Alpha chapter content.", encoding="utf-8")
        (chdir / "0002.txt").write_text("Beta chapter content.", encoding="utf-8")
        (pdir / "story.json").write_text(
            '{"metadata": {"version": 2}, "project_title":"Demo","format":"markdown","chapters":[{"title":"Intro","summary":""},{"title":"Next","summary":""}],"llm_prefs":{"temperature":0.7,"max_tokens":256}}',
            encoding="utf-8",
        )

    def _set_project_type(self, project_type: str):
        story_path = self.projects_root / "demo" / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["project_type"] = project_type
        story_path.write_text(json.dumps(story), encoding="utf-8")

    def _post_single_tool(self, name: str, arguments: dict | str):
        return self._post_single_tool_for_role("CHAT", name, arguments)

    def _post_tool_calls(self, calls: list[tuple[str, dict | str]]):
        return self._post_tool_calls_for_role("CHAT", calls)

    @staticmethod
    def _normalize_manager_tool_call(name: str, arguments: dict) -> tuple[str, dict]:
        """Translate legacy per-action tool invocations to manager tool actions."""
        if name == "get_project_overview":
            return "manage_project", {"action": "get_overview", **arguments}
        if name == "create_project":
            return "manage_project", {"action": "create", "create_data": arguments}
        if name == "list_projects":
            return "manage_project", {"action": "list"}
        if name == "delete_project":
            return "manage_project", {"action": "delete", "delete_data": arguments}
        if name == "change_project_type":
            return (
                "manage_project",
                {
                    "action": "change_type",
                    "type_data": {"new_type": arguments.get("new_type")},
                },
            )

        if name == "get_story_metadata":
            return "manage_story_core", {"action": "get_metadata"}
        if name == "update_story_metadata":
            return "manage_story_core", {
                "action": "update_metadata",
                "update_data": arguments,
            }
        if name == "read_story_content":
            return "manage_story_core", {
                "action": "read_content",
                "read_data": arguments,
            }
        if name == "sync_story_summary":
            return "manage_story_core", {
                "action": "sync_summary",
                "sync_data": arguments,
            }

        if name == "read_scratchpad":
            req = {"action": "read"}
            if "chat_id" in arguments:
                req["chat_id"] = arguments["chat_id"]
            return "manage_scratchpad", req
        if name == "write_scratchpad":
            return "manage_scratchpad", {"action": "write", "write_data": arguments}

        if name == "get_sourcebook_entry":
            return "manage_sourcebook", {"action": "get", **arguments}
        if name == "create_sourcebook_entry":
            return "manage_sourcebook", {"action": "create", "entry_data": arguments}
        if name == "update_sourcebook_entry":
            payload = dict(arguments)
            name_or_id = payload.pop("name_or_id", None)
            return (
                "manage_sourcebook",
                {"action": "update", "name_or_id": name_or_id, "update_data": payload},
            )
        if name == "delete_sourcebook_entry":
            return "manage_sourcebook", {"action": "delete", **arguments}
        if name == "list_sourcebook_entries":
            return "manage_sourcebook", {"action": "list", **arguments}
        if name == "add_sourcebook_relation":
            return "manage_sourcebook", {
                "action": "add_relation",
                "relation_data": arguments,
            }
        if name == "remove_sourcebook_relation":
            return "manage_sourcebook", {
                "action": "remove_relation",
                "relation_data": arguments,
            }

        if name == "list_images":
            return "manage_images", {"action": "list"}
        if name == "generate_image_description":
            return "manage_images", {"action": "generate_description", **arguments}
        if name == "create_image_placeholder":
            return "manage_images", {
                "action": "create_placeholder",
                "create_data": arguments,
            }
        if name == "set_image_metadata":
            return "manage_images", {
                "action": "set_metadata",
                "metadata_data": arguments,
            }

        if name == "search_in_project":
            return "search_and_replace", {"action": "search", **arguments}
        if name == "replace_in_project":
            return "search_and_replace", {"action": "replace", **arguments}

        return name, arguments

    def _post_single_tool_for_role(
        self, model_type: str, name: str, arguments: dict | str
    ):
        if isinstance(arguments, str):
            args = arguments
            normalized_name = name
        else:
            normalized_name, normalized_args = self._normalize_manager_tool_call(
                name, arguments
            )
            args = json.dumps(normalized_args)

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
                            "function": {
                                "name": normalized_name,
                                "arguments": args,
                            },
                        }
                    ],
                }
            ],
        }
        response = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return _parse_tool_sse_result(response.text)

    def _post_tool_calls_for_role(
        self, model_type: str, calls: list[tuple[str, dict | str]]
    ) -> dict:
        tool_calls = []
        for index, (name, arguments) in enumerate(calls, start=1):
            if isinstance(arguments, str):
                args = arguments
                normalized_name = name
            else:
                normalized_name, normalized_args = self._normalize_manager_tool_call(
                    name, arguments
                )
                args = json.dumps(normalized_args)

            tool_calls.append(
                {
                    "id": f"call_{index}_{name}",
                    "type": "function",
                    "function": {
                        "name": normalized_name,
                        "arguments": args,
                    },
                }
            )

        body = {
            "model_type": model_type,
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": tool_calls,
                }
            ],
        }
        response = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return _parse_tool_sse_result(response.text)

    def test_update_metadata_and_aliases(self):
        self._bootstrap_project()

        # 1. Test update_chapter_metadata with new fields
        body = {
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "u1",
                            "type": "function",
                            "function": {
                                "name": "update_chapter_metadata",
                                "arguments": json.dumps(
                                    {
                                        "chap_id": 1,
                                        "notes": "New note",
                                        "conflicts": json.dumps(
                                            [{"id": "c1", "description": "Fight!"}]
                                        ),
                                    }
                                ),
                            },
                        }
                    ],
                }
            ]
        }
        r = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(r.status_code, 200)

        # Verify persistence
        pdir = self.projects_root / "demo"
        with open(pdir / "story.json", "r") as f:
            story = json.load(f)
        chap1 = story["chapters"][0]
        self.assertEqual(chap1.get("notes"), "New note")
        self.assertIsNone(chap1.get("private_notes"))
        self.assertEqual(len(chap1.get("conflicts", [])), 1)

        # 2. Test aliases for story summary
        body_alias = {
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "a1",
                            "type": "function",
                            "function": {
                                "name": "manage_story_core",
                                "arguments": '{"action":"get_metadata"}',
                            },
                        }
                    ],
                }
            ]
        }
        r = self.client.post("/api/v1/chat/tools", json=body_alias)
        self.assertEqual(r.status_code, 200)
        data = _parse_tool_sse_result(r.text)
        self.assertIn("Demo", data["appended_messages"][0]["content"])

    def test_tools_execute_write_functions(self):
        self._bootstrap_project()

        # Test write_chapter_content
        body_content = {
            "model_name": None,
            "model_type": "EDITING",
            "messages": [
                {"role": "user", "content": "Write new content to chapter 1"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_write_content",
                            "type": "function",
                            "function": {
                                "name": "write_chapter_content",
                                "arguments": '{"chap_id":1,"content":"Updated content"}',
                            },
                        },
                    ],
                },
            ],
            "active_chapter_id": 1,
        }

        r = self.client.post("/api/v1/chat/tools", json=body_content)
        self.assertEqual(r.status_code, 200, r.text)
        data = _parse_tool_sse_result(r.text)
        self.assertTrue(data.get("ok"))
        app = data.get("appended_messages") or []
        self.assertEqual(len(app), 1)
        t = app[0]
        self.assertEqual(t.get("role"), "tool")
        self.assertEqual(t.get("name"), "write_chapter_content")
        self.assertIn("successfully", t.get("content", ""))

        # Verify content was written
        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        self.assertEqual(chapter_file.read_text(encoding="utf-8"), "Updated content")

        # Test write_chapter_summary
        body_summary = {
            "model_name": None,
            "messages": [
                {"role": "user", "content": "Write new summary to chapter 1"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_write_summary",
                            "type": "function",
                            "function": {
                                "name": "write_chapter_summary",
                                "arguments": '{"chap_id":1,"summary":"Updated summary"}',
                            },
                        },
                    ],
                },
            ],
            "active_chapter_id": 1,
        }

        r2 = self.client.post("/api/v1/chat/tools", json=body_summary)
        self.assertEqual(r2.status_code, 200, r2.text)
        data2 = _parse_tool_sse_result(r2.text)
        self.assertTrue(data2.get("ok"))
        app2 = data2.get("appended_messages") or []
        self.assertEqual(len(app2), 1)
        t2 = app2[0]
        self.assertEqual(t2.get("role"), "tool")
        self.assertEqual(t2.get("name"), "write_chapter_summary")
        self.assertIn("successfully", t2.get("content", ""))

        # Verify summary was written
        story_file = self.projects_root / "demo" / "story.json"
        story = json.loads(story_file.read_text(encoding="utf-8"))
        self.assertEqual(story["chapters"][0]["summary"], "Updated summary")

    def test_get_current_chapter_tool(self):
        self._bootstrap_project()

        # Call as a tool execution request with active_chapter_id set.
        body = {
            "model_type": "CHAT",
            "active_chapter_id": 1,
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_get_current_chapter",
                            "type": "function",
                            "function": {
                                "name": "get_current_chapter_id",
                                "arguments": "{}",
                            },
                        }
                    ],
                }
            ],
        }
        response = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        result = _parse_tool_sse_result(response.text)

        self.assertIn("appended_messages", result)
        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        tool_msg = appended[0]
        self.assertEqual(tool_msg.get("role"), "tool")
        self.assertEqual(tool_msg.get("name"), "get_current_chapter_id")

        payload = json.loads(tool_msg.get("content", "{}"))
        self.assertIn("chapter_id", payload)
        self.assertIn("chapter_title", payload)
        self.assertEqual(payload["chapter_title"], "Intro")
        self.assertNotIn("project_type", payload)
        self.assertNotIn("current_book", payload)

    def test_get_chapter_metadata_by_concrete_or_current(self):
        self._bootstrap_project()

        # Explicit chapter query
        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_get_chapter_metadata",
                            "type": "function",
                            "function": {
                                "name": "get_chapter_metadata",
                                "arguments": '{"chap_id": 1}',
                            },
                        }
                    ],
                }
            ],
        }

        response = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(response.status_code, 200)
        payload = json.loads(
            _parse_tool_sse_result(response.text)["appended_messages"][0]["content"]
        )
        self.assertEqual(payload["chapter"]["title"], "Intro")

        # Current chapter query
        body_current = {
            "model_type": "CHAT",
            "active_chapter_id": 1,
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_get_chapter_metadata_current",
                            "type": "function",
                            "function": {
                                "name": "get_chapter_metadata",
                                "arguments": '{"current": true}',
                            },
                        }
                    ],
                }
            ],
        }

        response_current = self.client.post("/api/v1/chat/tools", json=body_current)
        self.assertEqual(response_current.status_code, 200)
        payload_current = json.loads(
            _parse_tool_sse_result(response_current.text)["appended_messages"][0][
                "content"
            ]
        )
        self.assertEqual(payload_current["chapter"]["title"], "Intro")

    def test_manage_project_create_returns_created_project_name_with_type_alias(self):
        self._bootstrap_project()

        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "create_alias",
                            "type": "function",
                            "function": {
                                "name": "manage_project",
                                "arguments": json.dumps(
                                    {
                                        "action": "create",
                                        "create_data": {
                                            "name": "Back to the Future: The Chronological Narrative",
                                            "type": "series",
                                        },
                                    }
                                ),
                            },
                        }
                    ],
                }
            ],
        }

        response = self.client.post("/api/v1/projects/demo/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        data = _parse_tool_sse_result(response.text)
        appended = data.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0].get("content") or "{}")

        self.assertTrue(payload.get("ok"))
        self.assertEqual(
            payload.get("project_name"),
            "Back to the Future_ The Chronological Narrative",
        )

    def test_tool_batch_follows_project_switch_after_manage_project_create(self):
        self._bootstrap_project()

        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "create_then_read_1",
                            "type": "function",
                            "function": {
                                "name": "manage_project",
                                "arguments": json.dumps(
                                    {
                                        "action": "create",
                                        "create_data": {
                                            "name": "SwitchTarget",
                                            "project_type": "novel",
                                        },
                                    }
                                ),
                            },
                        },
                        {
                            "id": "create_then_read_2",
                            "type": "function",
                            "function": {
                                "name": "manage_story_core",
                                "arguments": json.dumps({"action": "get_metadata"}),
                            },
                        },
                    ],
                }
            ],
        }

        response = self.client.post("/api/v1/projects/demo/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        data = _parse_tool_sse_result(response.text)
        appended = data.get("appended_messages") or []
        self.assertEqual(len(appended), 2)

        create_payload = json.loads(appended[0].get("content") or "{}")
        metadata_payload = json.loads(appended[1].get("content") or "{}")

        self.assertEqual(create_payload.get("project_name"), "SwitchTarget")
        self.assertEqual(metadata_payload.get("title"), "SwitchTarget")

    def test_chat_tool_batch_can_undo_and_redo(self):
        """Tool-call batches should expose batch_id and support undo/redo endpoints."""
        self._bootstrap_project()
        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        original = chapter_file.read_text(encoding="utf-8")

        body = {
            "model_name": None,
            "model_type": "EDITING",
            "messages": [
                {"role": "user", "content": "Update chapter"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_batch_1",
                            "type": "function",
                            "function": {
                                "name": "write_chapter_content",
                                "arguments": '{"chap_id":1,"content":"Batch updated content"}',
                            },
                        }
                    ],
                },
            ],
            "active_chapter_id": 1,
        }

        r = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        data = _parse_tool_sse_result(r.text)
        batch = (data.get("mutations") or {}).get("tool_batch") or {}
        batch_id = batch.get("batch_id")
        self.assertTrue(batch_id)
        self.assertEqual(
            chapter_file.read_text(encoding="utf-8"), "Batch updated content"
        )

        r_undo = self.client.post(f"/api/v1/chat/tools/undo/{batch_id}")
        self.assertEqual(r_undo.status_code, 200, r_undo.text)
        self.assertEqual(chapter_file.read_text(encoding="utf-8"), original)

        r_redo = self.client.post(f"/api/v1/chat/tools/redo/{batch_id}")
        self.assertEqual(r_redo.status_code, 200, r_redo.text)
        self.assertEqual(
            chapter_file.read_text(encoding="utf-8"), "Batch updated content"
        )

    def test_call_editing_assistant_propagates_prose_mutations_and_ui_refreshes(self):
        self._bootstrap_project()
        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        before_text = chapter_file.read_text(encoding="utf-8")

        first_llm = {
            "content": "",
            "tool_calls": [
                {
                    "id": "nested_1",
                    "type": "function",
                    "function": {
                        "name": "write_chapter_content",
                        "arguments": json.dumps(
                            {
                                "chap_id": 1,
                                "content": "Edited chapter content",
                            }
                        ),
                    },
                }
            ],
        }
        second_llm = {"content": "Done.", "tool_calls": []}

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_complete",
                new_callable=AsyncMock,
            ) as mock_chat,
        ):
            mock_chat.side_effect = [first_llm, second_llm]
            data = self._post_single_tool(
                "call_editing_assistant",
                {"task": "Update title and summary"},
            )

        self.assertTrue((data.get("mutations") or {}).get("story_changed"))
        batch = (data.get("mutations") or {}).get("tool_batch") or {}
        batch_id = batch.get("batch_id")
        self.assertTrue(batch_id)

        self.assertEqual(
            chapter_file.read_text(encoding="utf-8"), "Edited chapter content"
        )

        # Verify the data is visible via the same project-select endpoint the UI refresh path uses.
        selected = self.client.post("/api/v1/projects/select", json={"name": "demo"})
        self.assertEqual(selected.status_code, 200, selected.text)
        selected_story = (selected.json() or {}).get("story") or {}
        self.assertEqual(selected_story.get("chapters", [])[0].get("title"), "Intro")

        undo = self.client.post(f"/api/v1/chat/tools/undo/{batch_id}")
        self.assertEqual(undo.status_code, 200, undo.text)
        self.assertEqual(chapter_file.read_text(encoding="utf-8"), before_text)

        redo = self.client.post(f"/api/v1/chat/tools/redo/{batch_id}")
        self.assertEqual(redo.status_code, 200, redo.text)
        self.assertEqual(
            chapter_file.read_text(encoding="utf-8"), "Edited chapter content"
        )

    def test_call_editing_assistant_collects_metadata_recommendations(self):
        self._bootstrap_project()

        first_llm = {
            "content": "",
            "tool_calls": [
                {
                    "id": "nested_1",
                    "type": "function",
                    "function": {
                        "name": "recommend_metadata_updates",
                        "arguments": json.dumps(
                            {
                                "story_summary": "Sharper story summary",
                                "chapter_updates": [
                                    {
                                        "chap_id": 1,
                                        "summary": "Introduce the heirloom map earlier.",
                                    }
                                ],
                                "rationale": "The opening chapter needs clearer setup.",
                            }
                        ),
                    },
                }
            ],
        }
        second_llm = {"content": "Done.", "tool_calls": []}

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_complete",
                new_callable=AsyncMock,
            ) as mock_chat,
        ):
            mock_chat.side_effect = [first_llm, second_llm]
            data = self._post_single_tool(
                "call_editing_assistant",
                {"task": "Review chapter 1 for setup issues"},
            )

        payload = json.loads(
            (data.get("appended_messages") or [])[0].get("content") or "{}"
        )
        self.assertFalse((data.get("mutations") or {}).get("story_changed"))
        self.assertEqual(payload.get("response"), "Done.")
        self.assertEqual(len(payload.get("recommended_updates") or []), 1)
        self.assertEqual(
            payload["recommended_updates"][0].get("story_summary"),
            "Sharper story summary",
        )

    def test_image_mutation_tools_emit_story_changed_and_support_undo_redo(self):
        self._bootstrap_project()
        pdir = self.projects_root / "demo"
        images_dir = pdir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        (images_dir / "sample.png").write_bytes(b"\x89PNG\r\n\x1a\n")

        metadata_file = images_dir / "metadata.json"
        before_meta = (
            metadata_file.read_text(encoding="utf-8") if metadata_file.exists() else ""
        )

        placeholder_data = self._post_single_tool(
            "create_image_placeholder",
            {"description": "Castle on a cliff", "title": "Castle"},
        )
        self.assertTrue((placeholder_data.get("mutations") or {}).get("story_changed"))
        placeholder_batch = (placeholder_data.get("mutations") or {}).get(
            "tool_batch"
        ) or {}
        self.assertTrue(placeholder_batch.get("batch_id"))

        placeholder_msg = (placeholder_data.get("appended_messages") or [])[0]
        placeholder_payload = json.loads(placeholder_msg.get("content") or "{}")
        placeholder_name = placeholder_payload.get("filename")
        self.assertTrue(placeholder_name)

        set_meta_data = self._post_single_tool(
            "set_image_metadata",
            {
                "filename": placeholder_name,
                "title": "Castle at Dawn",
                "description": "Golden light over stone walls",
            },
        )
        self.assertTrue((set_meta_data.get("mutations") or {}).get("story_changed"))

        with patch(
            "augmentedquill.services.chat.chat_tools.image_tools._tool_generate_image_description",
            new_callable=AsyncMock,
        ) as mock_desc:
            mock_desc.return_value = "A dramatic rocky coast with a lone fortress."
            gen_data = self._post_single_tool(
                "generate_image_description", {"filename": "sample.png"}
            )

        self.assertTrue((gen_data.get("mutations") or {}).get("story_changed"))
        gen_batch = (gen_data.get("mutations") or {}).get("tool_batch") or {}
        gen_batch_id = gen_batch.get("batch_id")
        self.assertTrue(gen_batch_id)
        self.assertTrue(metadata_file.exists())

        after_meta = metadata_file.read_text(encoding="utf-8")
        self.assertNotEqual(after_meta, before_meta)

        undo = self.client.post(f"/api/v1/chat/tools/undo/{gen_batch_id}")
        self.assertEqual(undo.status_code, 200, undo.text)

        redo = self.client.post(f"/api/v1/chat/tools/redo/{gen_batch_id}")
        self.assertEqual(redo.status_code, 200, redo.text)

    def test_call_writing_llm_is_read_only_in_mutation_pipeline(self):
        self._bootstrap_project()
        # Ensure a conflict exists to satisfy conflict-first guard policy.
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {
                        "id": "c1",
                        "description": "Establish protagonist's personal stakes",
                        "resolution": "Confront antagonistic force",
                    }
                ]
            },
        )

        mock_chat = _CapturingStreamMock("Rewritten prose")
        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=mock_chat,
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {"instruction": "Rewrite", "context": "Original text"},
            )

        sent_messages = mock_chat.await_args.kwargs["messages"]
        self.assertIn("You are a skilled novelist.", sent_messages[0]["content"])
        self.assertIn("Task for this request:", sent_messages[1]["content"])
        self.assertIn("Context materials:", sent_messages[1]["content"])
        self.assertNotIn(
            "Assume no prior knowledge of this application",
            sent_messages[0]["content"],
        )
        self.assertNotIn(
            "All context you may rely on for this request is below",
            sent_messages[1]["content"],
        )

        mutations = data.get("mutations") or {}
        self.assertFalse(mutations.get("story_changed"))
        self.assertIsNone(mutations.get("tool_batch"))
        appended = data.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0].get("content") or "{}")
        self.assertEqual(payload.get("generated_text"), "Rewritten prose")
        # Without write_mode, the response must contain ONLY generated_text —
        # no "written", "write_mode", "chap_id", or any persistence fields.
        self.assertEqual(set(payload.keys()), {"generated_text"})

    def test_call_writing_llm_requires_conflict_metadata(self):
        self._bootstrap_project()
        with patch(
            "augmentedquill.services.llm.llm.resolve_openai_credentials",
            return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {"instruction": "Write an opening scene", "context": ""},
            )

        appended = data.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        result = json.loads(appended[0].get("content") or "{}")
        self.assertIn("error", result)
        self.assertIn("conflicts", result.get("error", ""))

    def test_call_writing_llm_includes_sourcebook_entries_in_prompt(self):
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {
                        "id": "c1",
                        "description": "Test conflict",
                        "resolution": "Test resolution",
                    }
                ]
            },
        )
        self._post_single_tool(
            "create_sourcebook_entry",
            {
                "name": "Hero Entry",
                "description": "A known sourcebook character",
                "category": "character",
                "synonyms": ["The Hero"],
            },
        )

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_CapturingStreamMock("Generated text."),
            ) as mock_chat,
        ):
            _ = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Include sourcebook context",
                    "context": "Context text",
                    "sourcebook_entries": ["Hero Entry", "The Hero"],
                },
            )

        sent_messages = mock_chat.await_args.kwargs["messages"]
        self.assertEqual(len(sent_messages), 2)
        self.assertIn("Relevant sourcebook entries:", sent_messages[1]["content"])
        self.assertIn(
            "- Hero Entry (Character): A known sourcebook character",
            sent_messages[1]["content"],
        )
        self.assertIn("Relations: None", sent_messages[1]["content"])

    def test_call_writing_llm_append_mode_with_chap_id(self):
        """Test write_mode='append' appends generated text to chapter."""
        self._bootstrap_project()
        # Add conflict requirement
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {
                        "id": "c1",
                        "description": "Test conflict",
                        "resolution": "Test resolution",
                    }
                ]
            },
        )

        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        original_content = chapter_file.read_text(encoding="utf-8")

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream("New generated content."),
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Continue the story",
                    "context": "Current text",
                    "write_mode": "append",
                    "chap_id": 1,
                },
            )

        # Verify content was appended with inline continuation semantics
        new_content = chapter_file.read_text(encoding="utf-8")
        self.assertEqual(new_content, original_content + " New generated content.")

        # Verify response structure
        appended = data.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        result = json.loads(appended[0].get("content") or "{}")
        self.assertEqual(result.get("generated_text"), "New generated content.")
        self.assertTrue(result.get("written"))
        self.assertEqual(result.get("write_mode"), "append")
        self.assertEqual(result.get("chap_id"), 1)

        # Verify mutations for undo/redo support
        mutations = data.get("mutations") or {}
        self.assertTrue(mutations.get("story_changed"))

    def test_call_writing_llm_two_append_calls_same_batch_preserve_both_writes(self):
        """Two append-mode call_writing_llm calls in one tool batch must append cumulatively."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {
                        "id": "c1",
                        "description": "Test conflict",
                        "resolution": "Test resolution",
                    }
                ]
            },
        )

        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        original_content = chapter_file.read_text(encoding="utf-8")

        generated_chunks = ["First continuation.", "Second continuation."]

        async def _sequenced_stream(**kwargs):
            yield {"content": generated_chunks.pop(0)}

        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "call_writing_llm",
                                "arguments": json.dumps(
                                    {
                                        "instruction": "Write prose for scene one",
                                        "context": "Scene one context",
                                        "write_mode": "append",
                                        "chap_id": 1,
                                    }
                                ),
                            },
                        },
                        {
                            "id": "call_2",
                            "type": "function",
                            "function": {
                                "name": "call_writing_llm",
                                "arguments": json.dumps(
                                    {
                                        "instruction": "Write prose for scene two",
                                        "context": "Scene two context",
                                        "preceding_content": "First continuation.",
                                        "write_mode": "append",
                                        "chap_id": 1,
                                    }
                                ),
                            },
                        },
                    ],
                }
            ],
        }

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_sequenced_stream,
            ),
        ):
            response = self.client.post("/api/v1/chat/tools", json=body)

        self.assertEqual(response.status_code, 200, response.text)
        data = _parse_tool_sse_result(response.text)

        prose_start_events = response.text.count('"type": "prose_start"')
        self.assertEqual(prose_start_events, 2)

        new_content = chapter_file.read_text(encoding="utf-8")
        self.assertEqual(
            new_content,
            original_content + " First continuation. Second continuation.",
        )

        appended = data.get("appended_messages") or []
        self.assertEqual(len(appended), 2)
        first_result = json.loads(appended[0].get("content") or "{}")
        second_result = json.loads(appended[1].get("content") or "{}")
        self.assertEqual(first_result.get("write_mode"), "append")
        self.assertEqual(second_result.get("write_mode"), "append")
        self.assertTrue(first_result.get("written"))
        self.assertTrue(second_result.get("written"))

        mutations = data.get("mutations") or {}
        self.assertTrue(mutations.get("story_changed"))

    def test_update_story_metadata_append_patch_is_cumulative_within_one_batch(self):
        self._bootstrap_project()

        self._post_single_tool(
            "update_story_metadata",
            {
                "notes": "Story base",
                "conflicts": [{"description": "Conflict", "resolution": "Open"}],
            },
        )

        data = self._post_tool_calls(
            [
                (
                    "update_story_metadata",
                    {
                        "notes_patch": {
                            "operation": "append",
                            "value": " one",
                        }
                    },
                ),
                (
                    "update_story_metadata",
                    {
                        "notes_patch": {
                            "operation": "append",
                            "value": " two",
                        }
                    },
                ),
            ]
        )

        story = json.loads(
            (self.projects_root / "demo" / "story.json").read_text(encoding="utf-8")
        )
        self.assertEqual(story.get("notes"), "Story base one two")
        self.assertTrue((data.get("mutations") or {}).get("story_changed"))

    def test_update_chapter_metadata_append_patch_is_cumulative_within_one_batch(self):
        self._bootstrap_project()

        self._post_single_tool(
            "update_chapter_metadata",
            {"chap_id": 1, "notes": "Chapter base"},
        )

        data = self._post_tool_calls(
            [
                (
                    "update_chapter_metadata",
                    {
                        "chap_id": 1,
                        "notes_patch": {
                            "operation": "append",
                            "value": " one",
                        },
                    },
                ),
                (
                    "update_chapter_metadata",
                    {
                        "chap_id": 1,
                        "notes_patch": {
                            "operation": "append",
                            "value": " two",
                        },
                    },
                ),
            ]
        )

        story = json.loads(
            (self.projects_root / "demo" / "story.json").read_text(encoding="utf-8")
        )
        chapter = (story.get("chapters") or [])[0]
        self.assertEqual(chapter.get("notes"), "Chapter base one two")
        self.assertTrue((data.get("mutations") or {}).get("story_changed"))

    def test_update_book_metadata_append_patch_is_cumulative_within_one_batch(self):
        self._bootstrap_project()

        story_path = self.projects_root / "demo" / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["project_type"] = "series"
        story["books"] = [
            {
                "id": "book-1",
                "folder": "book-1",
                "title": "Book One",
                "summary": "",
                "notes": "Book base",
                "chapters": [],
            }
        ]
        story_path.write_text(json.dumps(story), encoding="utf-8")

        data = self._post_tool_calls(
            [
                (
                    "update_book_metadata",
                    {
                        "book_id": "book-1",
                        "notes_patch": {
                            "operation": "append",
                            "value": " one",
                        },
                    },
                ),
                (
                    "update_book_metadata",
                    {
                        "book_id": "book-1",
                        "notes_patch": {
                            "operation": "append",
                            "value": " two",
                        },
                    },
                ),
            ]
        )

        story_after = json.loads(story_path.read_text(encoding="utf-8"))
        book = (story_after.get("books") or [])[0]
        self.assertEqual(book.get("notes"), "Book base one two")
        self.assertTrue((data.get("mutations") or {}).get("story_changed"))

    def test_update_sourcebook_entry_append_patch_is_cumulative_within_one_batch(self):
        self._bootstrap_project()

        self._post_single_tool(
            "create_sourcebook_entry",
            {
                "name": "Ava",
                "description": "Base description",
                "category": "Character",
            },
        )

        data = self._post_tool_calls(
            [
                (
                    "update_sourcebook_entry",
                    {
                        "name_or_id": "Ava",
                        "description_patch": {
                            "operation": "append",
                            "value": " one",
                        },
                    },
                ),
                (
                    "update_sourcebook_entry",
                    {
                        "name_or_id": "Ava",
                        "description_patch": {
                            "operation": "append",
                            "value": " two",
                        },
                    },
                ),
            ]
        )

        fetched = self._post_single_tool("get_sourcebook_entry", {"name_or_id": "Ava"})
        payload = fetched.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        entry = json.loads(payload[0]["content"])
        self.assertEqual(entry.get("description"), "Base description one two")
        self.assertTrue((data.get("mutations") or {}).get("story_changed"))

    def test_manage_scenes_append_patch_is_cumulative_within_one_batch(self):
        self._bootstrap_project()

        created = self._post_single_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {"summary": "Scene base"},
            },
        )
        created_payload = created.get("appended_messages") or []
        self.assertEqual(len(created_payload), 1)
        scene = json.loads(created_payload[0]["content"])
        scene_id = scene.get("id")
        self.assertIsInstance(scene_id, int)

        data = self._post_tool_calls(
            [
                (
                    "manage_scenes",
                    {
                        "action": "update",
                        "scene_id": scene_id,
                        "update_data": {
                            "summary_patch": {
                                "operation": "append",
                                "value": " one",
                            }
                        },
                    },
                ),
                (
                    "manage_scenes",
                    {
                        "action": "update",
                        "scene_id": scene_id,
                        "update_data": {
                            "summary_patch": {
                                "operation": "append",
                                "value": " two",
                            }
                        },
                    },
                ),
            ]
        )

        fetched = self._post_single_tool(
            "manage_scenes",
            {"action": "get", "scene_id": scene_id},
        )
        fetched_payload = fetched.get("appended_messages") or []
        self.assertEqual(len(fetched_payload), 1)
        updated_scene = json.loads(fetched_payload[0]["content"])
        self.assertEqual(updated_scene.get("summary"), "Scene base one two")
        self.assertTrue((data.get("mutations") or {}).get("story_changed"))

    def test_manage_scenes_update_batch_returns_single_aggregated_response(self):
        self._bootstrap_project()
        self._set_project_type("novel")

        first = self._post_single_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {"summary": "First"},
            },
        )
        second = self._post_single_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {"summary": "Second"},
            },
        )
        first_id = json.loads((first.get("appended_messages") or [])[0]["content"]).get(
            "id"
        )
        second_id = json.loads(
            (second.get("appended_messages") or [])[0]["content"]
        ).get("id")

        data = self._post_tool_calls(
            [
                (
                    "manage_scenes",
                    {
                        "action": "update",
                        "scene_id": first_id,
                        "update_data": {
                            "summary": "First updated",
                        },
                    },
                ),
                (
                    "manage_scenes",
                    {
                        "action": "update",
                        "scene_id": second_id,
                        "update_data": {
                            "chapter_number": 1,
                            "chapter_position": 0,
                        },
                    },
                ),
            ]
        )

        appended = data.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertIsInstance(payload, dict)
        self.assertIn("scenes", payload)
        self.assertIn("scene_list", payload)

        scenes = payload.get("scenes") or []
        scene_list = payload.get("scene_list") or []
        self.assertIsInstance(scenes, list)
        self.assertIsInstance(scene_list, list)
        self.assertGreaterEqual(len(scene_list), 1)

        updated_first = next(
            (entry for entry in scenes if entry.get("id") == first_id), None
        )
        self.assertIsNotNone(updated_first)
        self.assertEqual((updated_first or {}).get("summary"), "First updated")

        compact_second = next(
            (entry for entry in scene_list if entry.get("scene_id") == second_id), None
        )
        self.assertIsNotNone(compact_second)
        self.assertTrue(
            {"scene_id", "summary", "chapter_position", "chapter_number"}.issubset(
                set((compact_second or {}).keys())
            )
        )
        self.assertEqual((compact_second or {}).get("chapter_number"), 1)
        self.assertEqual((compact_second or {}).get("chapter_position"), 0)

    def test_manage_scenes_update_scene_list_includes_violation_flags(self):
        self._bootstrap_project()
        self._set_project_type("novel")

        self._post_single_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Earlier scene",
                    "scene_time": "2024-01-01T00:00:00Z",
                },
            },
        )
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Later scene",
                    "scene_time": "2025-01-01T00:00:00Z",
                },
            },
        )

        update_response = self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 2,
                "update_data": {
                    "chapter_number": 1,
                    "chapter_position": 0,
                    "causes_patch": {"add": [1]},
                },
            },
        )

        appended = update_response.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertIn("scene_list", payload)
        scene_list = payload.get("scene_list") or []
        self.assertGreaterEqual(len(scene_list), 1)

        compact_scene = next(
            (entry for entry in scene_list if entry.get("scene_id") == 2),
            None,
        )
        self.assertIsNotNone(compact_scene)
        self.assertTrue(
            compact_scene.get("causes_violate_chronological_order"),
            "Expected update-returned scene_list entries to include chronological violation flags",
        )

    def test_append_capable_tools_integration_single_turn_batch(self):
        """Integration: append-capable tool paths all preserve cumulative appends in one turn."""
        self._bootstrap_project()

        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {
                        "id": "c1",
                        "description": "Integration conflict",
                        "resolution": "Open",
                    }
                ]
            },
        )

        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        original_chapter = chapter_file.read_text(encoding="utf-8")

        generated_chunks = ["First prose.", "Second prose."]

        async def _sequenced_stream(**kwargs):
            text = generated_chunks.pop(0) if generated_chunks else ""
            yield {"content": text}

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_sequenced_stream,
            ),
        ):
            data = self._post_tool_calls(
                [
                    (
                        "call_writing_llm",
                        {
                            "instruction": "Write prose for scene one",
                            "context": "Context one",
                            "write_mode": "append",
                            "chap_id": 1,
                        },
                    ),
                    (
                        "call_writing_llm",
                        {
                            "instruction": "Write prose for scene two",
                            "context": "Context two",
                            "preceding_content": "First prose.",
                            "write_mode": "append",
                            "chap_id": 1,
                        },
                    ),
                    (
                        "update_story_metadata",
                        {
                            "notes_patch": {
                                "operation": "append",
                                "value": " story-one",
                            }
                        },
                    ),
                    (
                        "update_story_metadata",
                        {
                            "notes_patch": {
                                "operation": "append",
                                "value": " story-two",
                            }
                        },
                    ),
                    (
                        "update_chapter_metadata",
                        {
                            "chap_id": 1,
                            "notes_patch": {
                                "operation": "append",
                                "value": " chapter-one",
                            },
                        },
                    ),
                    (
                        "update_chapter_metadata",
                        {
                            "chap_id": 1,
                            "notes_patch": {
                                "operation": "append",
                                "value": " chapter-two",
                            },
                        },
                    ),
                    (
                        "create_sourcebook_entry",
                        {
                            "name": "Integration Entry",
                            "description": "Entry base",
                            "category": "Character",
                        },
                    ),
                    (
                        "update_sourcebook_entry",
                        {
                            "name_or_id": "Integration Entry",
                            "description_patch": {
                                "operation": "append",
                                "value": " one",
                            },
                        },
                    ),
                    (
                        "update_sourcebook_entry",
                        {
                            "name_or_id": "Integration Entry",
                            "description_patch": {
                                "operation": "append",
                                "value": " two",
                            },
                        },
                    ),
                    (
                        "manage_scenes",
                        {
                            "action": "create",
                            "create_data": {"summary": "Scene base"},
                        },
                    ),
                    (
                        "manage_scenes",
                        {
                            "action": "update",
                            "scene_id": 1,
                            "update_data": {
                                "summary_patch": {
                                    "operation": "append",
                                    "value": " one",
                                }
                            },
                        },
                    ),
                    (
                        "manage_scenes",
                        {
                            "action": "update",
                            "scene_id": 1,
                            "update_data": {
                                "summary_patch": {
                                    "operation": "append",
                                    "value": " two",
                                }
                            },
                        },
                    ),
                ]
            )

        self.assertTrue((data.get("mutations") or {}).get("story_changed"))

        new_chapter = chapter_file.read_text(encoding="utf-8")
        self.assertEqual(new_chapter, original_chapter + " First prose. Second prose.")

        story = json.loads(
            (self.projects_root / "demo" / "story.json").read_text(encoding="utf-8")
        )
        self.assertEqual(story.get("notes"), " story-one story-two")
        chapter = (story.get("chapters") or [])[0]
        self.assertEqual(chapter.get("notes"), " chapter-one chapter-two")

        sourcebook_data = self._post_single_tool(
            "get_sourcebook_entry", {"name_or_id": "Integration Entry"}
        )
        sourcebook_payload = sourcebook_data.get("appended_messages") or []
        self.assertEqual(len(sourcebook_payload), 1)
        sourcebook_entry = json.loads(sourcebook_payload[0]["content"])
        self.assertEqual(sourcebook_entry.get("description"), "Entry base one two")

        scene_data = self._post_single_tool(
            "manage_scenes",
            {"action": "get", "scene_id": 1},
        )
        scene_payload = scene_data.get("appended_messages") or []
        self.assertEqual(len(scene_payload), 1)
        scene_one = json.loads(scene_payload[0]["content"])
        self.assertEqual(scene_one.get("summary"), "Scene base one two")

    def test_manage_scenes_update_with_empty_payload_reports_no_fields(self):
        self._bootstrap_project()
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scene A"}},
        )

        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "user",
                    "content": "Please reorder scenes and move scene 1 before scene 2.",
                },
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_scene_update",
                            "type": "function",
                            "function": {
                                "name": "manage_scenes",
                                "arguments": json.dumps(
                                    {
                                        "action": "update",
                                        "scene_id": 1,
                                        "update_data": {},
                                    }
                                ),
                            },
                        }
                    ],
                },
            ],
        }

        response = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        result = _parse_tool_sse_result(response.text)
        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertEqual(payload.get("error"), "No scene fields to update")

    def test_manage_scenes_update_content_allowed_when_reorder_intent_is_in_recent_turns(
        self,
    ):
        self._bootstrap_project()
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scene A"}},
        )
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scene B"}},
        )
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scene C"}},
        )

        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "user",
                    "content": "Please reorder scenes and move scene 1 before scene 2.",
                },
                {"role": "assistant", "content": "Understood, I will continue."},
                {"role": "user", "content": "Please finish the remaining work."},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_scene_update_recent_intent",
                            "type": "function",
                            "function": {
                                "name": "manage_scenes",
                                "arguments": json.dumps(
                                    {
                                        "action": "update",
                                        "scene_id": 1,
                                        "update_data": {
                                            "causes_patch": {"add": [2, 3]},
                                            "summary": "Updated summary",
                                        },
                                    }
                                ),
                            },
                        }
                    ],
                },
            ],
        }

        response = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        result = _parse_tool_sse_result(response.text)
        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertIsNone(payload.get("error"))
        self.assertEqual(payload.get("summary"), "Updated summary")
        self.assertEqual(payload.get("causes"), [2, 3])

    def test_manage_scenes_update_noop_reports_unchanged(self):
        self._bootstrap_project()
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scene A"}},
        )

        result = self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {"summary": "Scene A"},
            },
        )

        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertTrue(payload.get("ok"))
        self.assertFalse(payload.get("changed", True))
        self.assertFalse((result.get("mutations") or {}).get("story_changed", False))

    def test_manage_scenes_update_can_link_unlinked_to_chapter_in_one_call(self):
        self._bootstrap_project()
        self._set_project_type("novel")
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scope move scene"}},
        )

        update_result = self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {
                    "chapter_number": 1,
                },
            },
        )
        appended = update_result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertIsInstance(payload, list)
        self.assertGreaterEqual(len(payload), 1)
        moved_scene = next(
            (entry for entry in payload if entry.get("scene_id") == 1), None
        )
        self.assertIsNotNone(moved_scene)
        self.assertTrue(
            {"scene_id", "summary", "chapter_position", "chapter_number"}.issubset(
                set((moved_scene or {}).keys())
            )
        )
        self.assertEqual((moved_scene or {}).get("chapter_number"), 1)
        self.assertEqual((moved_scene or {}).get("chapter_position"), 0)
        self.assertTrue((update_result.get("mutations") or {}).get("story_changed"))

    def test_manage_scenes_update_with_chapter_number_null_moves_to_unlinked(self):
        self._bootstrap_project()
        self._set_project_type("novel")
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Missing target scene"}},
        )
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {
                    "chapter_number": 1,
                },
            },
        )

        update_result = self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {
                    "chapter_number": None,
                },
            },
        )
        appended = update_result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertIsInstance(payload, list)
        moved_scene = next(
            (entry for entry in payload if entry.get("scene_id") == 1), None
        )
        self.assertIsNotNone(moved_scene)
        self.assertEqual((moved_scene or {}).get("chapter_number"), None)

    def test_manage_scenes_list_includes_chapter_number_per_entry(self):
        self._bootstrap_project()
        self._set_project_type("novel")
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scene in chapter 1"}},
        )
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scene in chapter 2"}},
        )

        self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {"chapter_number": 1},
            },
        )

        self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 2,
                "update_data": {"chapter_number": 2},
            },
        )

        result = self._post_single_tool("manage_scenes", {"action": "list"})
        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertIsInstance(payload, list)

        by_id = {int(item.get("id") or 0): item for item in payload}
        self.assertEqual(by_id[1].get("chapter_number"), 1)
        self.assertEqual(by_id[2].get("chapter_number"), 2)
        self.assertEqual(by_id[1].get("chapter_position"), 0)
        self.assertEqual(by_id[2].get("chapter_position"), 0)

    def test_manage_scenes_list_includes_chronological_order_violation_flags(self):
        self._bootstrap_project()
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Earlier scene",
                    "scene_time": "2024-01-01T00:00:00Z",
                },
            },
        )
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Later scene",
                    "scene_time": "2025-01-01T00:00:00Z",
                },
            },
        )
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 2,
                "update_data": {
                    "causes_patch": {"add": [1]},
                },
            },
        )

        result = self._post_single_tool("manage_scenes", {"action": "list"})
        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        by_id = {int(item.get("id") or 0): item for item in payload}
        self.assertTrue(by_id[1].get("causes_violate_chronological_order"))
        self.assertTrue(by_id[2].get("causes_violate_chronological_order"))

    def test_manage_scenes_list_includes_narrative_order_violation_flags(self):
        self._bootstrap_project()
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "First scene"}},
        )
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Second scene"}},
        )
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 2,
                "update_data": {
                    "causes_patch": {"add": [1]},
                },
            },
        )

        result = self._post_single_tool("manage_scenes", {"action": "list"})
        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        by_id = {int(item.get("id") or 0): item for item in payload}
        self.assertTrue(by_id[1].get("causes_might_violate_narrative_order"))
        self.assertTrue(by_id[2].get("causes_might_violate_narrative_order"))

    def test_manage_scenes_get_includes_violation_flags(self):
        self._bootstrap_project()
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "First scene",
                    "scene_time": "2024-01-01T00:00:00Z",
                },
            },
        )
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "create",
                "create_data": {
                    "summary": "Second scene",
                    "scene_time": "2025-01-01T00:00:00Z",
                },
            },
        )
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 2,
                "update_data": {
                    "causes_patch": {"add": [1]},
                },
            },
        )
        result = self._post_single_tool(
            "manage_scenes", {"action": "get", "scene_id": 1}
        )
        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertTrue(payload.get("causes_violate_chronological_order"))

    def test_manage_scenes_list_includes_book_and_chapter_number_for_series(self):
        self._bootstrap_project()

        story_path = self.projects_root / "demo" / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["project_type"] = "series"
        story["books"] = [
            {
                "id": "book-1",
                "folder": "book-1",
                "title": "Book One",
                "chapters": [
                    {"id": "1", "title": "B1-C1"},
                    {"id": "2", "title": "B1-C2"},
                ],
            }
        ]
        story_path.write_text(json.dumps(story), encoding="utf-8")

        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Series scene"}},
        )
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {
                    "book_number": 1,
                    "chapter_number": 2,
                },
            },
        )

        result = self._post_single_tool("manage_scenes", {"action": "list"})
        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertIsInstance(payload, list)
        self.assertGreaterEqual(len(payload), 1)
        scene = payload[0]
        self.assertEqual(scene.get("book_number"), 1)
        self.assertEqual(scene.get("chapter_number"), 2)
        self.assertEqual(scene.get("chapter_position"), 0)

    def test_manage_scenes_update_with_position_fields_is_rejected(self):
        self._bootstrap_project()
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Compat move"}},
        )

        result = self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {
                    "move_chapter_id": 1,
                },
            },
        )

        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertEqual(payload.get("error"), "Invalid parameters")

    def test_manage_scenes_update_accepts_integer_chapter_number(self):
        self._bootstrap_project()
        self._set_project_type("novel")
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Int chapter id move"}},
        )

        result = self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {
                    "chapter_number": 1,
                },
            },
        )

        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertIsInstance(payload, list)
        moved_scene = next(
            (entry for entry in payload if entry.get("scene_id") == 1), None
        )
        self.assertIsNotNone(moved_scene)
        self.assertEqual((moved_scene or {}).get("chapter_number"), 1)

    def test_manage_scenes_update_chapter_position_reorders_within_chapter(self):
        self._bootstrap_project()
        self._set_project_type("novel")
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scene one"}},
        )
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scene two"}},
        )
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {"chapter_number": 1},
            },
        )
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 2,
                "update_data": {"chapter_number": 1},
            },
        )

        result = self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 2,
                "update_data": {"chapter_position": 0},
            },
        )

        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertIsInstance(payload, list)
        current_scene_order = payload
        chapter_one_order = [
            int(entry.get("scene_id") or 0)
            for entry in current_scene_order
            if entry.get("chapter_number") == 1
        ]
        self.assertEqual(chapter_one_order[:2], [2, 1])

    def test_manage_scenes_update_content_and_placement_returns_scene_and_scoped_list(
        self,
    ):
        self._bootstrap_project()
        self._set_project_type("novel")
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "First"}},
        )
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Second"}},
        )
        self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {"chapter_number": 1},
            },
        )

        result = self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 2,
                "update_data": {
                    "chapter_number": 1,
                    "chapter_position": 0,
                    "summary": "Second updated",
                },
            },
        )

        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertIsInstance(payload, dict)
        self.assertIn("scene", payload)
        self.assertIn("scene_list", payload)
        self.assertEqual((payload.get("scene") or {}).get("summary"), "Second updated")
        scene_list = payload.get("scene_list") or []
        self.assertIsInstance(scene_list, list)
        chapter_one_order = [
            int(entry.get("scene_id") or 0)
            for entry in scene_list
            if entry.get("chapter_number") == 1
        ]
        self.assertEqual(chapter_one_order[:2], [2, 1])

    def test_manage_scenes_update_rejects_placement_fields_in_short_story(self):
        self._bootstrap_project()
        self._set_project_type("short-story")
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scene one"}},
        )

        result = self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {"chapter_number": 1},
            },
        )

        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertEqual(payload.get("error"), "Invalid scene update")
        self.assertIn("only supported for novel and series", payload.get("message", ""))

    def test_manage_scenes_update_rejects_chapter_position_in_short_story(self):
        self._bootstrap_project()
        self._set_project_type("short-story")
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Scene one"}},
        )

        result = self._post_single_tool(
            "manage_scenes",
            {
                "action": "update",
                "scene_id": 1,
                "update_data": {"chapter_position": 0},
            },
        )

        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertEqual(payload.get("error"), "Invalid scene update")
        self.assertIn("only supported for novel and series", payload.get("message", ""))

    def test_manage_scenes_list_omits_chapter_fields_in_short_story(self):
        self._bootstrap_project()
        self._set_project_type("short-story")
        self._post_single_tool(
            "manage_scenes",
            {"action": "create", "create_data": {"summary": "Short story scene"}},
        )

        result = self._post_single_tool("manage_scenes", {"action": "list"})
        appended = result.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        payload = json.loads(appended[0]["content"])
        self.assertIsInstance(payload, list)
        self.assertGreaterEqual(len(payload), 1)
        scene = payload[0]
        self.assertNotIn("chapter_number", scene)
        self.assertNotIn("chapter_position", scene)
        self.assertNotIn("book_number", scene)

    def test_call_writing_llm_append_mode_with_trailing_newline(self):
        """Test append mode consumes trailing newline when continuation is inline."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {
                        "id": "c1",
                        "description": "Test conflict",
                        "resolution": "Test resolution",
                    }
                ]
            },
        )

        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        chapter_file.write_text("Line one.\n", encoding="utf-8")

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream("Second sentence."),
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Continue the story",
                    "context": "Current text",
                    "write_mode": "append",
                    "chap_id": 1,
                },
            )

        new_content = chapter_file.read_text(encoding="utf-8")
        self.assertEqual(new_content, "Line one. Second sentence.")

        appended = data.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        result = json.loads(appended[0].get("content") or "{}")
        self.assertEqual(result.get("generated_text"), "Second sentence.")
        self.assertTrue(result.get("written"))
        self.assertEqual(result.get("write_mode"), "append")
        self.assertEqual(result.get("chap_id"), 1)

    def test_call_writing_llm_append_mode_with_paragraph_break(self):
        """Test append mode preserves paragraph boundary when model starts with double newline."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {
                        "id": "c1",
                        "description": "Test conflict",
                        "resolution": "Test resolution",
                    }
                ]
            },
        )

        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        chapter_file.write_text("Line one.\n", encoding="utf-8")

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream("\n\nSecond paragraph."),
            ),
        ):
            _ = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Continue the story",
                    "context": "Current text",
                    "write_mode": "append",
                    "chap_id": 1,
                },
            )

        new_content = chapter_file.read_text(encoding="utf-8")
        self.assertEqual(new_content, "Line one.\n\nSecond paragraph.")

    def test_call_writing_llm_append_mode_short_story_auto_detect(self):
        """Test write_mode='append' auto-detects chap_id=1 for short-story projects."""
        self._bootstrap_project()

        # Change to short-story project
        pdir = self.projects_root / "demo"
        story_path = pdir / "story.json"
        story_data = json.loads(story_path.read_text(encoding="utf-8"))
        story_data["project_type"] = "short-story"
        story_data["content_file"] = "content.md"
        story_data["conflicts"] = [
            {
                "id": "c1",
                "description": "Main conflict",
                "resolution": "Resolution path",
            }
        ]
        # Remove chapters for short-story
        story_data.pop("chapters", None)
        story_path.write_text(json.dumps(story_data), encoding="utf-8")

        # Create content file
        content_file = pdir / "content.md"
        content_file.write_text("Original short story content.", encoding="utf-8")

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream(" Continuation text."),
            ),
        ):
            # Omit chap_id - should auto-detect for short-story
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Continue",
                    "context": "Context",
                    "write_mode": "append",
                },
            )

        # Verify content was appended
        new_content = content_file.read_text(encoding="utf-8")
        self.assertEqual(
            new_content, "Original short story content. Continuation text."
        )

        # Verify response has chap_id=1 set automatically
        appended = data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertTrue(result.get("written"))
        self.assertEqual(result.get("chap_id"), 1)

    def test_call_writing_llm_replace_all_mode(self):
        """Test write_mode='replace_all' overwrites the entire chapter."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {"id": "c1", "description": "Conflict", "resolution": "Resolution"}
                ]
            },
        )

        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream("Completely new chapter content."),
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Rewrite entirely",
                    "context": "Old content",
                    "write_mode": "replace_all",
                    "chap_id": 1,
                },
            )

        # Verify content was replaced (not appended)
        new_content = chapter_file.read_text(encoding="utf-8")
        self.assertEqual(new_content, "Completely new chapter content.")
        self.assertNotIn("Alpha", new_content)

        # Verify response
        appended = data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertEqual(result.get("write_mode"), "replace_all")
        self.assertTrue(result.get("written"))
        self.assertTrue(result.get("replaced_complete_content"))
        self.assertIn(
            "Complete chapter content has been replaced", result.get("status", "")
        )

        # Verify mutations
        mutations = data.get("mutations") or {}
        self.assertTrue(mutations.get("story_changed"))

    def test_call_writing_llm_replace_mode_targeted(self):
        """Test write_mode='replace' replaces only the specified passage."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {"id": "c1", "description": "Conflict", "resolution": "Resolution"}
                ]
            },
        )

        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        chapter_file.write_text(
            "Opening line. Middle passage. Closing line.", encoding="utf-8"
        )

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream("Rewritten middle."),
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Rewrite the middle passage",
                    "context": "Middle passage.",
                    "write_mode": "replace",
                    "replace_target": "Middle passage.",
                    "chap_id": 1,
                },
            )

        # Only the target passage replaced; surrounding text untouched.
        new_content = chapter_file.read_text(encoding="utf-8")
        self.assertEqual(new_content, "Opening line. Rewritten middle. Closing line.")

        # Verify response
        appended = data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertEqual(result.get("write_mode"), "replace")
        self.assertTrue(result.get("written"))
        self.assertNotIn("replaced_complete_content", result)

        mutations = data.get("mutations") or {}
        self.assertTrue(mutations.get("story_changed"))

    def test_call_writing_llm_replace_mode_target_not_found_returns_error(self):
        """write_mode='replace' with a replace_target not in the chapter returns an error."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {"id": "c1", "description": "Conflict", "resolution": "Resolution"}
                ]
            },
        )

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream("New text."),
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Rewrite something",
                    "context": "context",
                    "write_mode": "replace",
                    "replace_target": "This text does not exist in the chapter.",
                    "chap_id": 1,
                },
            )

        appended = data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertIn("error", result)
        self.assertIn("replace_target not found", result.get("error", ""))

    def test_call_writing_llm_replace_mode_missing_target_returns_error(self):
        """write_mode='replace' without replace_target returns an error."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {"id": "c1", "description": "Conflict", "resolution": "Resolution"}
                ]
            },
        )

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream("New text."),
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Rewrite something",
                    "context": "context",
                    "write_mode": "replace",
                    "chap_id": 1,
                },
            )

        appended = data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertIn("error", result)
        self.assertIn("replace_target is required", result.get("error", ""))

    def test_call_writing_llm_insert_at_marker_mode(self):
        """Test write_mode='insert_at_marker' inserts at ~~~ marker."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {"id": "c1", "description": "Conflict", "resolution": "Resolution"}
                ]
            },
        )

        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        chapter_file.write_text(
            "Beginning of chapter.\n~~~\nEnd of chapter.", encoding="utf-8"
        )

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream("Inserted middle section."),
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Write middle section",
                    "context": "Context",
                    "write_mode": "insert_at_marker",
                    "chap_id": 1,
                },
            )

        # Verify content was inserted at marker (marker replaced)
        new_content = chapter_file.read_text(encoding="utf-8")
        self.assertEqual(
            new_content,
            "Beginning of chapter.\nInserted middle section.\nEnd of chapter.",
        )
        self.assertNotIn("~~~", new_content)

        # Verify response
        appended = data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertEqual(result.get("write_mode"), "insert_at_marker")
        self.assertTrue(result.get("written"))

    def test_call_writing_llm_insert_at_marker_missing_marker_error(self):
        """Test write_mode='insert_at_marker' fails gracefully when marker not found."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {"id": "c1", "description": "Conflict", "resolution": "Resolution"}
                ]
            },
        )

        # Chapter without marker
        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        chapter_file.write_text("No marker here.", encoding="utf-8")

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream("Text to insert"),
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Insert",
                    "context": "Context",
                    "write_mode": "insert_at_marker",
                    "chap_id": 1,
                },
            )

        # Verify error message
        appended = data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertIn("error", result)
        self.assertIn("~~~", result.get("error", ""))
        self.assertIn("not found", result.get("error", ""))

        # Verify content unchanged
        content = chapter_file.read_text(encoding="utf-8")
        self.assertEqual(content, "No marker here.")

    def test_call_writing_llm_invalid_write_mode_error(self):
        """Test invalid write_mode value returns clear error."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {"id": "c1", "description": "Conflict", "resolution": "Resolution"}
                ]
            },
        )

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream("Generated text"),
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Write",
                    "context": "Context",
                    "write_mode": "invalid_mode",
                    "chap_id": 1,
                },
            )

        # Verify error message
        appended = data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertIn("error", result)
        error_msg = result.get("error", "")
        self.assertIn("Invalid write_mode", error_msg)
        self.assertIn("invalid_mode", error_msg)
        self.assertIn("append", error_msg)
        self.assertIn("replace", error_msg)
        self.assertIn("insert_at_marker", error_msg)

    def test_call_writing_llm_missing_chap_id_for_novel_error(self):
        """Test write_mode set without chap_id for chapter-based project returns error."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {"id": "c1", "description": "Conflict", "resolution": "Resolution"}
                ]
            },
        )

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream("Generated text"),
            ),
        ):
            # Novel project, write_mode set, but no chap_id
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Write",
                    "context": "Context",
                    "write_mode": "append",
                    # No chap_id provided
                },
            )

        # Verify error message is clear
        appended = data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertIn("error", result)
        error_msg = result.get("error", "")
        self.assertIn("chap_id is required", error_msg)
        self.assertIn("chapter-based", error_msg)
        self.assertIn("get_project_overview", error_msg)

    def test_call_writing_llm_undo_redo_support(self):
        """Test write_mode operations support undo/redo via tool batch."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {"id": "c1", "description": "Conflict", "resolution": "Resolution"}
                ]
            },
        )

        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        original_content = chapter_file.read_text(encoding="utf-8")

        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=_fake_llm_stream(" Appended text."),
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Continue",
                    "context": "Context",
                    "write_mode": "append",
                    "chap_id": 1,
                },
            )

        # Verify content was written
        modified_content = chapter_file.read_text(encoding="utf-8")
        self.assertNotEqual(modified_content, original_content)

        # Get batch_id for undo/redo
        mutations = data.get("mutations") or {}
        batch = mutations.get("tool_batch") or {}
        batch_id = batch.get("batch_id")
        self.assertTrue(batch_id, "Expected batch_id for undo/redo support")

        # Test undo
        undo = self.client.post(f"/api/v1/chat/tools/undo/{batch_id}")
        self.assertEqual(undo.status_code, 200, undo.text)
        undone_content = chapter_file.read_text(encoding="utf-8")
        self.assertEqual(undone_content, original_content)

        # Test redo
        redo = self.client.post(f"/api/v1/chat/tools/redo/{batch_id}")
        self.assertEqual(redo.status_code, 200, redo.text)
        redone_content = chapter_file.read_text(encoding="utf-8")
        self.assertEqual(redone_content, modified_content)

    def test_call_writing_llm_append_mode_auto_adds_preceding_content(self):
        """Test append mode injects existing tail prose when preceding_content is omitted."""
        self._bootstrap_project()
        self._post_single_tool(
            "update_story_metadata",
            {
                "conflicts": [
                    {
                        "id": "c1",
                        "description": "Test conflict",
                        "resolution": "Test resolution",
                    }
                ]
            },
        )

        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        chapter_file.write_text(
            "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
            encoding="utf-8",
        )

        mock_chat = _CapturingStreamMock(" Continuation.")
        with (
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=("http://localhost:11434/v1", None, "dummy", 30, "dummy"),
            ),
            patch(
                "augmentedquill.services.llm.llm.unified_chat_stream",
                new=mock_chat,
            ),
        ):
            data = self._post_single_tool(
                "call_writing_llm",
                {
                    "instruction": "Continue the story",
                    "context": "A high-level summary without exact tail text.",
                    "write_mode": "append",
                    "chap_id": 1,
                },
            )

        sent_messages = mock_chat.await_args.kwargs["messages"]
        self.assertIn("Immediate preceding prose", sent_messages[1]["content"])
        self.assertIn("Second paragraph.", sent_messages[1]["content"])
        self.assertIn("Third paragraph.", sent_messages[1]["content"])

        appended = data.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        result = json.loads(appended[0].get("content") or "{}")
        self.assertEqual(result.get("write_mode"), "append")
        self.assertTrue(result.get("written"))

    def test_chat_sourcebook_create_is_visible_in_project_select_payload(self):
        self._bootstrap_project()
        data = self._post_single_tool(
            "create_sourcebook_entry",
            {
                "name": "Ava",
                "description": "A strategist in the court",
                "category": "character",
                "synonyms": ["Lady Ava"],
            },
        )

        mutations = data.get("mutations") or {}
        self.assertTrue(mutations.get("story_changed"))

        selected = self.client.post("/api/v1/projects/select", json={"name": "demo"})
        self.assertEqual(selected.status_code, 200, selected.text)
        story = (selected.json() or {}).get("story") or {}
        sourcebook = story.get("sourcebook") or []
        self.assertTrue(
            any(entry.get("name") == "Ava" for entry in sourcebook),
            f"Expected 'Ava' entry in sourcebook payload, got: {sourcebook}",
        )

    def test_reorder_chapters_not_an_llm_tool(self):
        """reorder_chapters was removed from the LLM tool registry; only invocable via the REST API."""
        from augmentedquill.services.chat.chat_tool_decorator import (
            ensure_tool_registry_loaded,
            get_registered_tool_schemas,
        )

        ensure_tool_registry_loaded()
        names = {s["function"]["name"] for s in get_registered_tool_schemas()}
        self.assertNotIn("reorder_chapters", names)
        self.assertNotIn("reorder_books", names)

    def test_reorder_chapters_invalid_ids_returns_error(self):
        """Calling unknown tool through the /chat/tools endpoint returns an error, not a crash."""
        self._bootstrap_project()
        # reorder_chapters is no longer an LLM tool; the endpoint returns a structured error.
        data = self._post_single_tool(
            "reorder_chapters",
            {"chapter_ids": [99, 100]},
        )
        appended = data.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        content = json.loads(appended[0]["content"])
        self.assertIn("error", content)

    def test_list_images_returns_empty_without_images(self):
        """list_images tool works even when the project images dir is empty."""
        self._bootstrap_project()
        data = self._post_single_tool("list_images", {})
        appended = data.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        content = json.loads(appended[0]["content"])
        # list_images returns a bare list of image entries
        self.assertIsInstance(content, list)

    def test_update_story_metadata_supports_non_destructive_patches(self):
        self._bootstrap_project()

        self._post_single_tool(
            "update_story_metadata",
            {
                "notes": "Seed notes with unresolved ending.",
                "conflicts": [{"description": "Old conflict", "resolution": ""}],
            },
        )

        self._post_single_tool(
            "update_story_metadata",
            {
                "notes_patch": {
                    "operation": "replace_text",
                    "old_text": "unresolved",
                    "new_text": "active",
                    "occurrence": "unique",
                },
                "conflicts_patch": {
                    "operations": [
                        {
                            "op": "add",
                            "conflict": {
                                "description": "New conflict",
                                "resolution": "",
                            },
                        }
                    ]
                },
            },
        )

        story = json.loads(
            (self.projects_root / "demo" / "story.json").read_text(encoding="utf-8")
        )
        self.assertEqual(story.get("notes"), "Seed notes with active ending.")
        self.assertEqual(len(story.get("conflicts") or []), 2)
        self.assertEqual(
            (story.get("conflicts") or [])[0].get("description"), "Old conflict"
        )

    def test_update_chapter_metadata_supports_non_destructive_patches(self):
        self._bootstrap_project()

        self._post_single_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "notes": "Chapter note base",
                "conflicts": [{"description": "Conflict", "resolution": "open"}],
            },
        )

        self._post_single_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "notes_patch": {
                    "operation": "append",
                    "value": " and added detail",
                },
                "conflicts_patch": {
                    "operations": [
                        {
                            "op": "update",
                            "index": 0,
                            "updates": {"resolution": "resolved"},
                        }
                    ]
                },
            },
        )

        story = json.loads(
            (self.projects_root / "demo" / "story.json").read_text(encoding="utf-8")
        )
        chapter = (story.get("chapters") or [])[0]
        self.assertEqual(chapter.get("notes"), "Chapter note base and added detail")
        self.assertEqual(
            (chapter.get("conflicts") or [])[0].get("resolution"), "resolved"
        )

    def test_update_chapter_metadata_conflicts_patch_does_not_touch_story_conflicts(
        self,
    ):
        self._bootstrap_project()
        story_path = self.projects_root / "demo" / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["conflicts"] = [
            {"description": "Story-level conflict", "resolution": "story"}
        ]
        story_path.write_text(json.dumps(story), encoding="utf-8")

        self._post_single_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "conflicts": [
                    {
                        "description": "Chapter conflict",
                        "resolution": "chapter",
                    }
                ],
            },
        )

        self._post_single_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "conflicts_patch": {
                    "operations": [
                        {
                            "op": "update",
                            "index": 0,
                            "updates": {"description": "Chapter conflict updated"},
                        }
                    ]
                },
            },
        )

        story_after = json.loads(story_path.read_text(encoding="utf-8"))
        chapter = (story_after.get("chapters") or [])[0]
        self.assertEqual(
            (chapter.get("conflicts") or [])[0].get("description"),
            "Chapter conflict updated",
        )
        self.assertEqual(
            (story_after.get("conflicts") or [])[0].get("description"),
            "Story-level conflict",
        )

    def test_update_book_metadata_supports_non_destructive_patches(self):
        self._bootstrap_project()
        pdir = self.projects_root / "demo"
        story_path = pdir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["project_type"] = "series"
        story["books"] = [
            {
                "id": "book-1",
                "folder": "book-1",
                "title": "Book One",
                "summary": "Summary seed",
                "notes": "Book note base",
                "chapters": [],
            }
        ]
        story_path.write_text(json.dumps(story), encoding="utf-8")

        self._post_single_tool(
            "update_book_metadata",
            {
                "book_id": "book-1",
                "notes_patch": {
                    "operation": "append",
                    "value": " plus patch",
                },
            },
        )

        story_after = json.loads(story_path.read_text(encoding="utf-8"))
        book = (story_after.get("books") or [])[0]
        self.assertEqual(book.get("notes"), "Book note base plus patch")
        self.assertEqual(book.get("summary"), "Summary seed")

    def test_update_sourcebook_entry_supports_non_destructive_patches(self):
        self._bootstrap_project()

        self._post_single_tool(
            "create_sourcebook_entry",
            {
                "name": "Ava",
                "description": "A careful strategist",
                "category": "Character",
                "synonyms": ["Lady Ava"],
                "images": ["img-1"],
            },
        )

        self._post_single_tool(
            "update_sourcebook_entry",
            {
                "name_or_id": "Ava",
                "description_patch": {
                    "operation": "replace_text",
                    "old_text": "careful",
                    "new_text": "battle-hardened",
                    "occurrence": "unique",
                },
                "synonyms_patch": {
                    "add": ["Commander Ava"],
                },
                "images_patch": {
                    "add": ["img-2"],
                },
            },
        )

        data = self._post_single_tool("get_sourcebook_entry", {"name_or_id": "Ava"})
        payload = data.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        entry = json.loads(payload[0]["content"])
        self.assertEqual(entry.get("description"), "A battle-hardened strategist")
        self.assertIn("Lady Ava", entry.get("synonyms") or [])
        self.assertIn("Commander Ava", entry.get("synonyms") or [])
        self.assertIn("img-1", entry.get("images") or [])
        self.assertIn("img-2", entry.get("images") or [])

    def test_update_story_metadata_patch_failure_returns_error(self):
        self._bootstrap_project()
        result = self._post_single_tool(
            "update_story_metadata",
            {
                "notes_patch": {
                    "operation": "replace_text",
                    "old_text": "missing",
                    "new_text": "value",
                }
            },
        )
        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertIn("error", content)
        self.assertIn("replace_text failed", content.get("error", ""))

    def test_update_chapter_metadata_patch_out_of_bounds_returns_error(self):
        self._bootstrap_project()
        result = self._post_single_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "conflicts_patch": {
                    "operations": [
                        {
                            "op": "update",
                            "index": 2,
                            "updates": {"resolution": "done"},
                        }
                    ]
                },
            },
        )
        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertIn("error", content)
        self.assertIn("out of bounds", content.get("error", ""))

    def test_update_chapter_metadata_noop_reports_no_change(self):
        self._bootstrap_project()

        result = self._post_single_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "summary": "",
                "notes": None,
            },
        )

        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertTrue(content.get("ok"))
        self.assertFalse(content.get("changed"))
        self.assertEqual(content.get("changed_fields"), [])

        mutations = result.get("mutations") or {}
        self.assertFalse(mutations.get("story_changed", False))

    def test_update_chapter_metadata_patch_with_path_returns_invalid_parameters(self):
        self._bootstrap_project()
        result = self._post_single_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "conflicts_patch": {
                    "operations": [
                        {
                            "op": "update",
                            "index": 0,
                            "path": "$.conflicts[0]",
                            "updates": {"resolution": "done"},
                        }
                    ]
                },
            },
        )
        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertIn("error", content)
        self.assertEqual(content.get("error"), "Invalid parameters")
        self.assertTrue(
            any(d.get("type") == "extra_forbidden" for d in content.get("details", []))
        )

    def test_invalid_parameters_details_do_not_echo_input_payload(self):
        self._bootstrap_project()
        result = self._post_single_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "summary_patch": {
                    "operation": "replace",
                },
            },
        )
        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertEqual(content.get("error"), "Invalid parameters")
        details = content.get("details", [])
        self.assertTrue(details)
        self.assertTrue(all("input" not in d for d in details if isinstance(d, dict)))
        self.assertTrue(
            any(
                "missing required key(s): value" in str(d.get("msg") or "")
                for d in details
                if isinstance(d, dict)
            )
        )

    def test_invalid_parameters_replace_text_patch_reports_missing_keys(self):
        self._bootstrap_project()
        result = self._post_single_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "summary_patch": {
                    "operation": "replace_text",
                },
            },
        )
        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertEqual(content.get("error"), "Invalid parameters")
        details = content.get("details", [])
        self.assertTrue(
            any(
                "missing required key(s): old_text, new_text" in str(d.get("msg") or "")
                for d in details
                if isinstance(d, dict)
            )
        )

    def test_update_chapter_metadata_conflicts_patch_op_inferred_from_updates(self):
        self._bootstrap_project()
        # Seed a conflict first
        self._post_single_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "conflicts": [
                    {"description": "Hiding in library", "resolution": "Open"}
                ],
            },
        )
        # LLM-style call: op omitted, updates present → inferred as "update"
        result = self._post_single_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "conflicts_patch": {
                    "operations": [
                        {
                            "index": 0,
                            "updates": {
                                "description": "Must hide within the city",
                                "resolution": "She evades Silas but cannot flee.",
                            },
                        }
                    ]
                },
            },
        )
        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertTrue(content.get("ok"))
        self.assertTrue(content.get("changed"))
        self.assertIn("conflicts", content.get("changed_fields", []))

    def test_update_book_metadata_missing_book_returns_error(self):
        self._bootstrap_project()
        story_path = self.projects_root / "demo" / "story.json"
        story_data = json.loads(story_path.read_text(encoding="utf-8"))
        story_data["project_type"] = "series"
        story_path.write_text(json.dumps(story_data), encoding="utf-8")
        result = self._post_single_tool(
            "update_book_metadata",
            {
                "book_id": "missing-book",
                "notes_patch": {"operation": "append", "value": "x"},
            },
        )
        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertIn("error", content)
        self.assertIn("not found", content.get("error", ""))

    def test_update_sourcebook_entry_requires_update_fields(self):
        self._bootstrap_project()
        self._post_single_tool(
            "create_sourcebook_entry",
            {
                "name": "Ava",
                "description": "A strategist",
                "category": "Character",
            },
        )
        result = self._post_single_tool(
            "update_sourcebook_entry",
            {
                "name_or_id": "Ava",
            },
        )
        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertIn("error", content)
        self.assertIn("No update fields provided", content.get("error", ""))

    def test_update_sourcebook_entry_supports_relations_in_update_data(self):
        self._bootstrap_project()
        self._post_single_tool(
            "create_sourcebook_entry",
            {
                "name": "Sofia",
                "description": "A researcher",
                "category": "Character",
            },
        )
        self._post_single_tool(
            "create_sourcebook_entry",
            {
                "name": "Igor",
                "description": "A peer",
                "category": "Character",
            },
        )
        result = self._post_single_tool(
            "update_sourcebook_entry",
            {
                "name_or_id": "Sofia",
                "relations": [
                    {
                        "target_id": "Igor",
                        "relation": "is a peer of",
                    }
                ],
            },
        )
        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertNotIn("error", content)
        self.assertEqual(content.get("name"), "Sofia")
        relations = content.get("relations") or []
        self.assertEqual(len(relations), 1)
        self.assertEqual(
            relations[0].get("relation"), ["Sofia", "is a peer of", "Igor"]
        )

    def test_update_sourcebook_entry_supports_tuple_style_relations_in_update_data(
        self,
    ):
        self._bootstrap_project()
        self._post_single_tool(
            "create_sourcebook_entry",
            {
                "name": "Dimitri (The Senior)",
                "description": "Senior student",
                "category": "Character",
            },
        )
        self._post_single_tool(
            "create_sourcebook_entry",
            {
                "name": "Igor",
                "description": "Peer student",
                "category": "Character",
            },
        )
        self._post_single_tool(
            "create_sourcebook_entry",
            {
                "name": "The Boarding School",
                "description": "School setting",
                "category": "Location",
            },
        )
        result = self._post_single_tool(
            "update_sourcebook_entry",
            {
                "name_or_id": "Dimitri (The Senior)",
                "relations": [
                    {
                        "relation": [
                            "Dimitri (The Senior)",
                            "is a senior student at",
                            "The Boarding School",
                        ]
                    },
                    {
                        "relation": [
                            "Dimitri (The Senior)",
                            "oversees/mentors",
                            "Igor",
                        ]
                    },
                ],
            },
        )
        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertNotIn("error", content)
        self.assertEqual(content.get("name"), "Dimitri (The Senior)")
        relations = content.get("relations") or []
        self.assertEqual(len(relations), 2)
        self.assertEqual(
            relations[0].get("relation"),
            ["Dimitri (The Senior)", "is a senior student at", "The Boarding School"],
        )
        self.assertEqual(
            relations[1].get("relation"),
            ["Dimitri (The Senior)", "oversees/mentors", "Igor"],
        )

    def test_update_story_metadata_invalid_patch_shape_fails_validation(self):
        self._bootstrap_project()
        result = self._post_single_tool(
            "update_story_metadata",
            {
                "notes_patch": {
                    "operation": "append",
                }
            },
        )
        payload = result.get("appended_messages") or []
        self.assertEqual(len(payload), 1)
        content = json.loads(payload[0]["content"])
        self.assertEqual(content.get("error"), "Invalid parameters")
        self.assertTrue(content.get("details"))

    def test_undo_last_tool_changes_last_call_scope(self):
        """undo_last_tool_changes with scope='last_call' restores the most recent batch."""
        self._bootstrap_project()
        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        original_content = chapter_file.read_text(encoding="utf-8")

        # Write something via a tool call so a batch snapshot is created.
        body = {
            "model_type": "EDITING",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_write_1",
                            "type": "function",
                            "function": {
                                "name": "write_chapter_content",
                                "arguments": json.dumps(
                                    {"chap_id": 1, "content": "Modified by tool."}
                                ),
                            },
                        }
                    ],
                }
            ],
        }
        r = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(chapter_file.read_text(encoding="utf-8"), "Modified by tool.")

        # Now call undo_last_tool_changes via the LLM tool interface.
        undo_data = self._post_single_tool(
            "undo_last_tool_changes",
            {"scope": "last_call"},
        )

        appended = undo_data.get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        result = json.loads(appended[0].get("content") or "{}")
        self.assertTrue(result.get("undone"))
        self.assertEqual(result.get("scope"), "last_call")
        self.assertIsInstance(result.get("restored_batches"), list)
        self.assertEqual(len(result["restored_batches"]), 1)

        # Verify the chapter was restored.
        self.assertEqual(chapter_file.read_text(encoding="utf-8"), original_content)

        # Verify story_changed is set so frontend refreshes.
        mutations = undo_data.get("mutations") or {}
        self.assertTrue(mutations.get("story_changed"))

    def test_undo_last_tool_changes_all_this_turn_scope(self):
        """undo_last_tool_changes with scope='all_this_turn' reverses all provided batches."""
        self._bootstrap_project()
        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        original_content = chapter_file.read_text(encoding="utf-8")

        def _write_tool_call(content: str) -> str:
            """Write chapter content via tool and return the batch_id."""
            r = self.client.post(
                "/api/v1/chat/tools",
                json={
                    "model_type": "EDITING",
                    "messages": [
                        {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_w",
                                    "type": "function",
                                    "function": {
                                        "name": "write_chapter_content",
                                        "arguments": json.dumps(
                                            {"chap_id": 1, "content": content}
                                        ),
                                    },
                                }
                            ],
                        }
                    ],
                },
            )
            self.assertEqual(r.status_code, 200, r.text)
            data = _parse_tool_sse_result(r.text)
            return (data.get("mutations") or {}).get("tool_batch", {}).get("batch_id")

        batch_id_1 = _write_tool_call("First modification.")
        batch_id_2 = _write_tool_call("Second modification.")
        self.assertTrue(batch_id_1)
        self.assertTrue(batch_id_2)
        self.assertEqual(
            chapter_file.read_text(encoding="utf-8"), "Second modification."
        )

        # Undo both batches in one call.
        undo_data = self._post_single_tool(
            "undo_last_tool_changes",
            {
                "scope": "all_this_turn",
                "batch_ids": [batch_id_1, batch_id_2],
            },
        )

        appended = undo_data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertTrue(result.get("undone"))
        self.assertEqual(result.get("scope"), "all_this_turn")
        self.assertEqual(len(result.get("restored_batches") or []), 2)

        # Both batches reversed → back to original.
        self.assertEqual(chapter_file.read_text(encoding="utf-8"), original_content)

    def test_chat_batch_chapter_before_uses_snapshot_mapping(self):
        self._bootstrap_project()
        project_dir = self.projects_root / "demo"
        batch_id = "batch-test-mapping"
        batch_dir = project_dir / ".aq_history" / "chat_tool_batches" / batch_id
        batch_dir.mkdir(parents=True, exist_ok=True)

        metadata = {
            "batch_id": batch_id,
            "created_at": "2026-01-01T00:00:00Z",
            "tool_names": ["write_chapter_content"],
            "changed_chapter_ids": [1],
            "chapter_id_paths": {"1": "chapters/0001.txt"},
            "before": {"chapters/0001.txt": "QWxwaGEgY2hhcHRlciBjb250ZW50Lg=="},
            "after": {"chapters/0001.txt": "QWxwaGEgY2hhcHRlciBjb250ZW50Lg=="},
        }
        (batch_dir / "batch.json").write_text(json.dumps(metadata), encoding="utf-8")

        # Restructure the project so current chapter 1 no longer corresponds to the original file path.
        (project_dir / "chapters" / "0001.txt").rename(
            project_dir / "chapters" / "0003.txt"
        )
        (project_dir / "chapters" / "0001.txt").write_text(
            "New chapter content.", encoding="utf-8"
        )

        response = self.client.get(
            f"/api/v1/projects/demo/chat/tools/batches/{batch_id}/chapter-before/1"
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"content": "Alpha chapter content."})

    def test_chat_batch_chapter_before_returns_empty_for_new_chapter(self):
        self._bootstrap_project()
        project_dir = self.projects_root / "demo"
        batch_id = "batch-test-new-chapter"
        batch_dir = project_dir / ".aq_history" / "chat_tool_batches" / batch_id
        batch_dir.mkdir(parents=True, exist_ok=True)

        metadata = {
            "batch_id": batch_id,
            "created_at": "2026-01-01T00:00:00Z",
            "tool_names": ["create_new_chapter"],
            "changed_chapter_ids": [2],
            "chapter_id_paths": {},
            "before": {},
            "after": {"chapters/0002.txt": "QmV0YSBjaGFwdGVyIGNvbnRlbnQu"},
        }
        (batch_dir / "batch.json").write_text(json.dumps(metadata), encoding="utf-8")

        response = self.client.get(
            f"/api/v1/projects/demo/chat/tools/batches/{batch_id}/chapter-before/2"
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"content": ""})

    def test_undo_last_tool_changes_no_batches_returns_error(self):
        """undo_last_tool_changes with no existing batches returns a BadRequestError."""
        self._bootstrap_project()

        undo_data = self._post_single_tool(
            "undo_last_tool_changes",
            {"scope": "last_call"},
        )

        appended = undo_data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertIn("error", result)

    def test_undo_last_tool_changes_invalid_scope_returns_error(self):
        """undo_last_tool_changes with an unrecognised scope returns an error."""
        self._bootstrap_project()

        undo_data = self._post_single_tool(
            "undo_last_tool_changes",
            {"scope": "bogus_scope"},
        )

        appended = undo_data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertIn("error", result)

    def test_undo_last_tool_changes_all_this_turn_without_batch_ids_returns_error(self):
        """scope='all_this_turn' without batch_ids must return an error."""
        self._bootstrap_project()

        undo_data = self._post_single_tool(
            "undo_last_tool_changes",
            {"scope": "all_this_turn"},
        )

        appended = undo_data.get("appended_messages") or []
        result = json.loads(appended[0].get("content") or "{}")
        self.assertIn("error", result)

    # =========================================================================
    # SYSTEMATIC TEST SUITE: Scoped Multi-Tool Execution Scenarios
    # =========================================================================
    # These tests close the gap for `/api/v1/projects/{project_name}/chat/tools`
    # with multiple tool calls and project operations (create, type changes, etc).

    def test_scoped_multi_tool_baseline_no_project_switch(self):
        """Base case: multiple tools in same batch without project switches.

        Validates that the scoped endpoint correctly handles multiple
        independent tools that don't change project context.
        """
        self._bootstrap_project()

        # Execute two tools in same batch on same project.
        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "tool_1",
                            "type": "function",
                            "function": {
                                "name": "manage_story_core",
                                "arguments": json.dumps({"action": "get_metadata"}),
                            },
                        },
                        {
                            "id": "tool_2",
                            "type": "function",
                            "function": {
                                "name": "manage_sourcebook",
                                "arguments": json.dumps({"action": "list"}),
                            },
                        },
                    ],
                }
            ],
        }

        response = self.client.post("/api/v1/projects/demo/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        data = _parse_tool_sse_result(response.text)
        appended = data.get("appended_messages") or []

        # Both tools should execute successfully.
        self.assertEqual(len(appended), 2)
        self.assertEqual(appended[0].get("name"), "manage_story_core")
        self.assertEqual(appended[1].get("name"), "manage_sourcebook")

        # Verify story metadata is from 'demo' project.
        story_payload = json.loads(appended[0].get("content") or "{}")
        self.assertEqual(story_payload.get("title"), "Demo")

    def test_scoped_multi_tool_create_then_read_canonical_name(self):
        """Verify project creation returns canonical name, subsequent tools use new project.

        This tests the fix for: project_name derivation must use created
        artifact path, not contextual lookup. Ensures manage_project.create
        returns the actual directory name, and subsequent tools read from
        the newly created project.
        """
        self._bootstrap_project()

        # Create new project with name "SciFiAdventure", then read metadata.
        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "create_project_call",
                            "type": "function",
                            "function": {
                                "name": "manage_project",
                                "arguments": json.dumps(
                                    {
                                        "action": "create",
                                        "create_data": {
                                            "name": "SciFiAdventure",
                                            "project_type": "novel",
                                        },
                                    }
                                ),
                            },
                        },
                        {
                            "id": "read_new_project_call",
                            "type": "function",
                            "function": {
                                "name": "manage_story_core",
                                "arguments": json.dumps({"action": "get_metadata"}),
                            },
                        },
                    ],
                }
            ],
        }

        response = self.client.post("/api/v1/projects/demo/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        data = _parse_tool_sse_result(response.text)
        appended = data.get("appended_messages") or []

        self.assertEqual(len(appended), 2)

        # First message: project creation result.
        create_payload = json.loads(appended[0].get("content") or "{}")
        project_name = create_payload.get("project_name")
        self.assertTrue(
            project_name, "create result must include canonical project_name"
        )
        self.assertNotIn(
            " ", project_name, "project_name must be canonical (no spaces)"
        )

        # Second message: metadata from NEW project (not 'demo').
        metadata_payload = json.loads(appended[1].get("content") or "{}")
        new_title = metadata_payload.get("title")
        self.assertIsNotNone(
            new_title, "subsequent tool must read from newly created project"
        )

        # Verify new project directory exists.
        new_project_dir = self.projects_root / project_name
        self.assertTrue(
            new_project_dir.exists(),
            f"new project directory must exist at {new_project_dir}",
        )

    def test_scoped_multi_tool_update_then_verify_persisted(self):
        """Tool changes are persisted and visible to subsequent tools in batch.

        Validates that changes made by one tool are immediately visible
        to subsequent tools in the same batch.
        """
        self._bootstrap_project()

        # Update story metadata, then verify it's visible in get_metadata.
        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "update_call",
                            "type": "function",
                            "function": {
                                "name": "manage_story_core",
                                "arguments": json.dumps(
                                    {
                                        "action": "update_metadata",
                                        "update_data": {
                                            "summary": "Updated story summary",
                                            "tags": ["updated"],
                                        },
                                    }
                                ),
                            },
                        },
                        {
                            "id": "verify_call",
                            "type": "function",
                            "function": {
                                "name": "manage_story_core",
                                "arguments": json.dumps({"action": "get_metadata"}),
                            },
                        },
                    ],
                }
            ],
        }

        response = self.client.post("/api/v1/projects/demo/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        data = _parse_tool_sse_result(response.text)
        appended = data.get("appended_messages") or []

        self.assertEqual(len(appended), 2)

        # Second message should reflect the update from first message.
        verify_payload = json.loads(appended[1].get("content") or "{}")
        self.assertEqual(verify_payload.get("summary"), "Updated story summary")
        self.assertIn("updated", verify_payload.get("tags") or [])

    def test_scoped_multi_tool_with_sourcebook_operations(self):
        """Multiple scoped tools targeting different subsystems (story + sourcebook).

        Validates that tools from different domains (story management,
        sourcebook management) can coexist and operate correctly in same batch.
        """
        self._bootstrap_project()

        # Create a sourcebook entry, then read all entries.
        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "create_entry_call",
                            "type": "function",
                            "function": {
                                "name": "manage_sourcebook",
                                "arguments": json.dumps(
                                    {
                                        "action": "create",
                                        "entry_data": {
                                            "name": "TestCharacter",
                                            "category": "character",
                                            "description": "A brave hero.",
                                        },
                                    }
                                ),
                            },
                        },
                        {
                            "id": "list_entries_call",
                            "type": "function",
                            "function": {
                                "name": "manage_sourcebook",
                                "arguments": json.dumps(
                                    {
                                        "action": "list",
                                        "category": "character",
                                    }
                                ),
                            },
                        },
                    ],
                }
            ],
        }

        response = self.client.post("/api/v1/projects/demo/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        data = _parse_tool_sse_result(response.text)
        appended = data.get("appended_messages") or []

        self.assertEqual(len(appended), 2)

        # First message: created entry confirmation - should have entry details.
        create_payload = json.loads(appended[0].get("content") or "{}")
        # Create returns the entry data which includes id, name, category, etc.
        self.assertTrue(create_payload, "create should return entry data")

        # Second message: list should show the newly created entry.
        list_payload = json.loads(appended[1].get("content") or "{}")
        entries = (
            list_payload
            if isinstance(list_payload, list)
            else list_payload.get("entries") or []
        )
        entry_names = [e.get("name") for e in entries if isinstance(e, dict)]
        self.assertIn(
            "TestCharacter", entry_names, "list should include newly created entry"
        )

    def test_scoped_multi_tool_project_type_change_mid_batch(self):
        """Changing project type mid-batch executes and returns context updates.

        Tests that when manage_project.change_type is called mid-batch,
        it executes successfully and subsequent tools continue operating.
        Note: full context switching for project type changes is a separate concern.
        """
        self._bootstrap_project()

        # Change project type, then verify subsequent tool executes successfully.
        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "change_type_call",
                            "type": "function",
                            "function": {
                                "name": "manage_project",
                                "arguments": json.dumps(
                                    {
                                        "action": "change_type",
                                        "type_data": {
                                            "new_type": "short_story_collection"
                                        },
                                    }
                                ),
                            },
                        },
                        {
                            "id": "verify_batch_call",
                            "type": "function",
                            "function": {
                                "name": "manage_story_core",
                                "arguments": json.dumps({"action": "get_metadata"}),
                            },
                        },
                    ],
                }
            ],
        }

        response = self.client.post("/api/v1/projects/demo/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        data = _parse_tool_sse_result(response.text)
        appended = data.get("appended_messages") or []

        # Both tools should execute without error.
        self.assertEqual(len(appended), 2)

        # First message: change_type result
        change_result = json.loads(appended[0].get("content") or "{}")
        self.assertTrue(change_result.get("ok") or "message" in change_result)

        # Second message: subsequent tool executes (metadata accessible)
        metadata = json.loads(appended[1].get("content") or "{}")
        self.assertIn(
            "project_type", metadata, "subsequent tool should execute successfully"
        )

    def test_scoped_multi_tool_three_tool_context_chain(self):
        """Three-tool chain verifies context updates persist across tools.

        Tests that registry.current updates after each tool execution,
        allowing a chain of operations where each tool depends on previous
        context changes (e.g., create → update → read).
        """
        self._bootstrap_project()

        # 1. Create a sourcebook entry
        # 2. Update it with new description
        # 3. Read it back to verify chain
        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "step1",
                            "type": "function",
                            "function": {
                                "name": "manage_sourcebook",
                                "arguments": json.dumps(
                                    {
                                        "action": "create",
                                        "entry_data": {
                                            "name": "Hero",
                                            "category": "character",
                                            "description": "The protagonist.",
                                        },
                                    }
                                ),
                            },
                        },
                        {
                            "id": "step2",
                            "type": "function",
                            "function": {
                                "name": "manage_sourcebook",
                                "arguments": json.dumps(
                                    {
                                        "action": "update",
                                        "name_or_id": "Hero",
                                        "update_data": {
                                            "description": "The brave protagonist who seeks the artifact."
                                        },
                                    }
                                ),
                            },
                        },
                        {
                            "id": "step3",
                            "type": "function",
                            "function": {
                                "name": "manage_sourcebook",
                                "arguments": json.dumps(
                                    {
                                        "action": "get",
                                        "name_or_id": "Hero",
                                    }
                                ),
                            },
                        },
                    ],
                }
            ],
        }

        response = self.client.post("/api/v1/projects/demo/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        data = _parse_tool_sse_result(response.text)
        appended = data.get("appended_messages") or []

        self.assertEqual(len(appended), 3)

        # Final read should show the updated description (or content field if used).
        final_payload = json.loads(appended[2].get("content") or "{}")
        final_desc = final_payload.get("description", "")
        self.assertIn(
            "brave protagonist",
            final_desc,
            f"final read should show updated description, got: {final_desc}",
        )

    def test_scoped_multi_tool_concurrent_mutation_tracking(self):
        """Batch mutations from multiple tools are aggregated correctly.

        Validates that when multiple tools mutate state, the batch response
        correctly aggregates mutations (e.g., story_changed flags, tool_batch ids).
        """
        self._bootstrap_project()

        # Two tools that modify state: update_metadata + create sourcebook entry.
        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "mutate1",
                            "type": "function",
                            "function": {
                                "name": "manage_story_core",
                                "arguments": json.dumps(
                                    {
                                        "action": "update_metadata",
                                        "update_data": {"summary": "Updated."},
                                    }
                                ),
                            },
                        },
                        {
                            "id": "mutate2",
                            "type": "function",
                            "function": {
                                "name": "manage_sourcebook",
                                "arguments": json.dumps(
                                    {
                                        "action": "create",
                                        "entry_data": {
                                            "name": "NewEntry",
                                            "category": "location",
                                            "content": "A place.",
                                        },
                                    }
                                ),
                            },
                        },
                    ],
                }
            ],
        }

        response = self.client.post("/api/v1/projects/demo/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        data = _parse_tool_sse_result(response.text)

        # Verify mutations are tracked.
        mutations = data.get("mutations") or {}
        self.assertTrue(mutations.get("story_changed"))
        tool_batch = mutations.get("tool_batch") or {}
        self.assertTrue(tool_batch.get("batch_id"))
