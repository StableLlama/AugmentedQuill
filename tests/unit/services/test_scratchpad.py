# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test scratchpad unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from augmentedquill.main import app
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


class ScratchpadTest(TestCase):
    def setUp(self):
        # Setup temporary environment for tests
        self.test_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.test_dir.cleanup)

        self.projects_root = Path(self.test_dir.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.test_dir.name) / "projects.json"

        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        self.client = TestClient(app)

        # Initialize a project
        ok, msg = select_project("test_project")
        self.assertTrue(ok, msg)
        self.project_dir = self.projects_root / "test_project"

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def test_scratchpad_cycle(self):
        """Test writing to and reading from the scratchpad via API."""

        # 1. Initially scratchpad should be empty for the specific chat
        response = self.client.post(
            "/api/v1/chat/tools",
            json={
                "model_type": "CHAT",
                "chat_id": "chat-1",
                "messages": [
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "manage_scratchpad",
                                    "arguments": '{"action": "read", "chat_id": "chat-1"}',
                                },
                            }
                        ],
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        data = _parse_tool_sse_result(response.text)
        self.assertEqual(
            data["appended_messages"][0]["content"], json.dumps({"content": ""})
        )

        # 2. Write to scratchpad for chat-1
        test_content = "This is a test plan.\n- Step 1\n- Step 2"
        response = self.client.post(
            "/api/v1/chat/tools",
            json={
                "model_type": "CHAT",
                "chat_id": "chat-1",
                "messages": [
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_2",
                                "type": "function",
                                "function": {
                                    "name": "manage_scratchpad",
                                    "arguments": json.dumps(
                                        {
                                            "action": "write",
                                            "write_data": {
                                                "content": test_content,
                                                "chat_id": "chat-1",
                                            },
                                        }
                                    ),
                                },
                            }
                        ],
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200)

        # 3. Verify per-chat file exists on disk and project-wide scratchpad is untouched
        chat_json_file = self.project_dir / "chats" / "chat-1.json"
        self.assertTrue(chat_json_file.exists())
        self.assertIn(
            "scratchpad", json.loads(chat_json_file.read_text(encoding="utf-8"))
        )
        self.assertEqual(
            json.loads(chat_json_file.read_text(encoding="utf-8"))["scratchpad"],
            test_content,
        )

        # 4. Read back via API for the same chat
        response = self.client.post(
            "/api/v1/chat/tools",
            json={
                "model_type": "CHAT",
                "chat_id": "chat-1",
                "messages": [
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_3",
                                "type": "function",
                                "function": {
                                    "name": "manage_scratchpad",
                                    "arguments": '{"action": "read", "chat_id": "chat-1"}',
                                },
                            }
                        ],
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        data = _parse_tool_sse_result(response.text)
        self.assertEqual(
            data["appended_messages"][0]["content"],
            json.dumps({"content": test_content}),
        )

    def test_scratchpad_isolation_per_chat(self):
        """Each chat must have its own scratchpad state."""
        for chat_id, content in [("chat-a", "A"), ("chat-b", "B")]:
            response = self.client.post(
                "/api/v1/chat/tools",
                json={
                    "model_type": "CHAT",
                    "chat_id": chat_id,
                    "messages": [
                        {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "write",
                                    "type": "function",
                                    "function": {
                                        "name": "manage_scratchpad",
                                        "arguments": json.dumps(
                                            {
                                                "action": "write",
                                                "write_data": {
                                                    "content": content,
                                                    "chat_id": chat_id,
                                                },
                                            }
                                        ),
                                    },
                                }
                            ],
                        }
                    ],
                },
            )
            self.assertEqual(response.status_code, 200)

        for chat_id, expected in [("chat-a", "A"), ("chat-b", "B")]:
            response = self.client.post(
                "/api/v1/chat/tools",
                json={
                    "model_type": "CHAT",
                    "chat_id": chat_id,
                    "messages": [
                        {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "read",
                                    "type": "function",
                                    "function": {
                                        "name": "manage_scratchpad",
                                        "arguments": json.dumps(
                                            {"action": "read", "chat_id": chat_id}
                                        ),
                                    },
                                }
                            ],
                        }
                    ],
                },
            )
            self.assertEqual(response.status_code, 200)
            data = _parse_tool_sse_result(response.text)
            self.assertEqual(
                data["appended_messages"][0]["content"],
                json.dumps({"content": expected}),
            )

    def test_scratchpad_overwrite(self):
        """Test that writing to scratchpad overwrites previous content."""
        scratchpad_file = self.project_dir / "scratchpad.txt"
        scratchpad_file.write_text("Old content", encoding="utf-8")

        new_content = "New content"
        self.client.post(
            "/api/v1/chat/tools",
            json={
                "model_type": "CHAT",
                "messages": [
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_4",
                                "type": "function",
                                "function": {
                                    "name": "manage_scratchpad",
                                    "arguments": json.dumps(
                                        {
                                            "action": "write",
                                            "write_data": {"content": new_content},
                                        }
                                    ),
                                },
                            }
                        ],
                    }
                ],
            },
        )

        self.assertEqual(scratchpad_file.read_text(encoding="utf-8"), new_content)
