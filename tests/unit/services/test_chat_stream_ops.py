# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Unit tests for chat stream injection logic."""

from unittest import TestCase

from augmentedquill.services.chat.chat_api_stream_ops import inject_chat_user_context


class TestChatStreamOps(TestCase):
    def test_inject_chat_user_context_full(self):
        req_messages = [{"role": "user", "content": "Hello AI"}]
        payload = {
            "current_chapter": {"id": 1, "title": "Introduction", "is_empty": False}
        }
        inject_chat_user_context(req_messages, payload)

        self.assertEqual(req_messages[0]["role"], "assistant")
        self.assertIsNone(req_messages[0].get("content"))
        self.assertEqual(
            req_messages[0]["tool_calls"][0]["function"]["name"],
            "get_current_chapter_id",
        )

        tool_message = req_messages[1]
        self.assertEqual(tool_message["role"], "tool")
        self.assertEqual(tool_message["name"], "get_current_chapter_id")
        self.assertIn('"chapter_id": 1', tool_message["content"])
        self.assertIn('"chapter_title": "Introduction"', tool_message["content"])

        self.assertEqual(req_messages[2]["role"], "user")
        self.assertEqual(req_messages[2]["content"], "Hello AI")

    def test_inject_chat_user_context_empty_title(self):
        req_messages = [{"role": "user", "content": "Hello AI"}]
        payload = {"current_chapter": {"id": 2, "title": "", "is_empty": False}}
        inject_chat_user_context(req_messages, payload)

        self.assertEqual(req_messages[0]["role"], "assistant")
        self.assertIsNone(req_messages[0].get("content"))
        self.assertEqual(
            req_messages[0]["tool_calls"][0]["function"]["name"],
            "get_current_chapter_id",
        )

        tool_message = req_messages[1]
        self.assertEqual(tool_message["role"], "tool")
        self.assertEqual(tool_message["name"], "get_current_chapter_id")
        self.assertIn('"chapter_id": 2', tool_message["content"])
        self.assertIn('"chapter_title": ""', tool_message["content"])

        self.assertEqual(req_messages[2]["content"], "Hello AI")

    def test_inject_chat_user_context_is_empty(self):
        req_messages = [{"role": "user", "content": "Hello AI"}]
        payload = {
            "current_chapter": {"id": 3, "title": "Empty Chapter", "is_empty": True}
        }
        inject_chat_user_context(req_messages, payload)

        self.assertEqual(req_messages[0]["role"], "assistant")
        self.assertIsNone(req_messages[0].get("content"))
        self.assertEqual(
            req_messages[0]["tool_calls"][0]["function"]["name"],
            "get_current_chapter_id",
        )

        tool_message = req_messages[1]
        self.assertEqual(tool_message["role"], "tool")
        self.assertEqual(tool_message["name"], "get_current_chapter_id")
        self.assertIn('"chapter_id": 3', tool_message["content"])
        self.assertIn('"chapter_title": "Empty Chapter"', tool_message["content"])
        self.assertNotIn('"is_empty"', tool_message["content"])

        self.assertEqual(req_messages[2]["content"], "Hello AI")

    def test_inject_chat_user_context_no_chapter(self):
        req_messages = [{"role": "user", "content": "Hello AI"}]
        payload = {}
        inject_chat_user_context(req_messages, payload)

        self.assertEqual(req_messages[0]["content"], "Hello AI")

    def test_inject_chat_user_context_multiple_calls_preserved(self):
        req_messages = [{"role": "user", "content": "Hello AI"}]
        payload = {"current_chapter": {"id": 4, "title": "Scene", "is_empty": False}}

        inject_chat_user_context(req_messages, payload)
        inject_chat_user_context(req_messages, payload)

        self.assertEqual(req_messages[2]["content"], "Hello AI")
        self.assertEqual(req_messages[0]["role"], "assistant")
        self.assertEqual(req_messages[1]["role"], "tool")
        self.assertNotEqual(req_messages[1]["content"], None)
        self.assertIn('"chapter_id": 4', req_messages[1]["content"])
        self.assertIn('"chapter_title": "Scene"', req_messages[1]["content"])

    def test_inject_chat_user_context_only_when_chapter_changes(self):
        req_messages = [{"role": "user", "content": "Hello AI"}]
        payload1 = {"current_chapter": {"id": 4, "title": "Scene", "is_empty": False}}
        payload2 = {
            "current_chapter": {"id": 7, "title": "Victoria: The Forbidden Love"}
        }

        inject_chat_user_context(req_messages, payload1)
        # no change when same chapter again
        inject_chat_user_context(req_messages, payload1)

        self.assertEqual(
            len(
                [
                    m
                    for m in req_messages
                    if m.get("role") == "tool"
                    and m.get("name") == "get_current_chapter_id"
                ]
            ),
            1,
        )

        # chapter changed -> insert second tool context before existing user
        inject_chat_user_context(req_messages, payload2)

        tool_messages = [
            m
            for m in req_messages
            if m.get("role") == "tool" and m.get("name") == "get_current_chapter_id"
        ]
        self.assertEqual(len(tool_messages), 2)
        self.assertIn('"chapter_id": 7', tool_messages[-1]["content"])

    def test_inject_chat_user_context_multi_user_history(self):
        req_messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "How many words in chapter?"},
            {"role": "assistant", "content": "Let me check."},
            {"role": "user", "content": "Now count the words again."},
        ]
        payload = {
            "current_chapter": {"id": 7, "title": "Victoria: The Forbidden Love"}
        }

        inject_chat_user_context(req_messages, payload)

        # Injection goes only before the LAST user turn (the new/current request).
        # Historical user messages are left untouched.
        self.assertEqual(req_messages[1]["role"], "user")
        self.assertEqual(req_messages[2]["role"], "assistant")
        self.assertEqual(req_messages[3]["role"], "assistant")
        self.assertEqual(req_messages[4]["role"], "tool")
        self.assertEqual(req_messages[5]["role"], "user")

        self.assertEqual(
            req_messages[3]["tool_calls"][0]["function"]["name"],
            "get_current_chapter_id",
        )
        self.assertIn('"chapter_id": 7', req_messages[4]["content"])
        self.assertIn(
            '"chapter_title": "Victoria: The Forbidden Love"',
            req_messages[4]["content"],
        )

    def test_inject_chat_user_context_chapter_changed_between_messages(self):
        req_messages = [
            {"role": "user", "content": "count the words in this chapter"},
            {"role": "assistant", "content": "There are 100 words."},
            {"role": "user", "content": "count the words in this chapter"},
        ]
        # First call with chapter 1
        payload1 = {"current_chapter": {"id": 1, "title": "Chapter 1"}}
        inject_chat_user_context(req_messages, payload1)

        # Expected: [USER(1), ASST, ASST(context), TOOL(context), USER(2)]
        # Injection is placed only before the LAST user message.
        self.assertEqual(len(req_messages), 5)
        self.assertEqual(req_messages[2]["role"], "assistant")
        self.assertEqual(req_messages[3]["role"], "tool")
        self.assertEqual(req_messages[3]["name"], "get_current_chapter_id")
        self.assertIn('"chapter_id": 1', req_messages[3]["content"])

        # Second call with chapter 2
        payload2 = {"current_chapter": {"id": 2, "title": "Chapter 2"}}
        inject_chat_user_context(req_messages, payload2)

        # Expected: [USER(1), ASST, ASST(context1), TOOL(context1), ASST(context2), TOOL(context2), USER(2)]
        self.assertEqual(len(req_messages), 7)
        self.assertEqual(req_messages[5]["role"], "tool")
        self.assertEqual(req_messages[5]["name"], "get_current_chapter_id")
        self.assertIn('"chapter_id": 2', req_messages[5]["content"])
        self.assertEqual(req_messages[6]["role"], "user")
        self.assertEqual(req_messages[6]["content"], "count the words in this chapter")

    def test_inject_chat_user_context_complex_sequence(self):
        """
        - start fresh, ask something => it must be preceeded by the chapter number
        - continue this test chat and ask something more => only the first user message must be preceeded by the chapter number as the chapter didn't change
        - do a chapter change
        - continue this test chat and ask something more => the first user message must be preceeded by the chapter number, the second user message must not be preceeded as the chapter didn't change and the last one must be preceeded again
        """
        req_messages = [{"role": "user", "content": "Question 1"}]

        # 1. start fresh, ask something => it must be preceeded by the chapter number
        payload1 = {"current_chapter": {"id": 1, "title": "Chapter 1"}}
        inject_chat_user_context(req_messages, payload1)

        self.assertEqual(len(req_messages), 3)
        self.assertEqual(req_messages[0]["role"], "assistant")
        self.assertEqual(req_messages[1]["role"], "tool")
        self.assertIn('"chapter_id": 1', req_messages[1]["content"])
        self.assertEqual(req_messages[2]["role"], "user")

        # 2. continue this test chat and ask something more => only the first user message must be preceeded by the chapter number as the chapter didn't change
        req_messages.append({"role": "assistant", "content": "Answer 1"})
        req_messages.append({"role": "user", "content": "Question 2"})

        inject_chat_user_context(req_messages, payload1)  # Still chapter 1

        # Sequence should be: [ASST(context1), TOOL(context1), USER(1), ASST(1), USER(2)]
        self.assertEqual(len(req_messages), 5)
        self.assertEqual(req_messages[0]["role"], "assistant")
        self.assertEqual(req_messages[1]["role"], "tool")
        self.assertEqual(req_messages[2]["role"], "user")
        self.assertEqual(req_messages[3]["role"], "assistant")
        self.assertEqual(req_messages[4]["role"], "user")
        # Ensure no duplicate context for USER(2)
        self.assertNotEqual(req_messages[4]["role"], "tool")

        # 3. do a chapter change
        # 4. continue this test chat and ask something more => the last one must be preceeded again
        req_messages.append({"role": "assistant", "content": "Answer 2"})
        req_messages.append({"role": "user", "content": "Question 3"})

        payload2 = {"current_chapter": {"id": 2, "title": "Chapter 2"}}
        inject_chat_user_context(req_messages, payload2)

        # Expected total sequence:
        # 0: ASST(context1)
        # 1: TOOL(context1)
        # 2: USER(1)
        # 3: ASST(1)
        # 4: USER(2)
        # 5: ASST(2)
        # 6: ASST(context2)
        # 7: TOOL(context2)
        # 8: USER(3)

        self.assertEqual(len(req_messages), 9)
        self.assertEqual(req_messages[0]["role"], "assistant")
        self.assertEqual(req_messages[1]["role"], "tool")
        self.assertIn('"chapter_id": 1', req_messages[1]["content"])
        self.assertEqual(req_messages[7]["role"], "tool")
        self.assertIn('"chapter_id": 2', req_messages[7]["content"])
        self.assertEqual(req_messages[8]["role"], "user")
        self.assertEqual(req_messages[8]["content"], "Question 3")

    def test_inject_chat_user_context_exact_log_failure_simulation(self):
        """
        Simulate the exact failure from llm_raw.log:
        1. User asks a question in Chapter 4.
        2. Assistant calls tools for Chapter 3.
        3. User asks another question (still in Chapter 4 context).
        Verify that history is NOT mutated and each request has its own distinct context.
        """
        import copy

        # Step 1: Initial state (Application thinks we are in Chapter 4)
        payload_step1 = {"current_chapter": {"id": 4, "title": "Chap 4"}}
        history = [{"role": "user", "content": "How many words in chapter 3?"}]

        # Call 1
        inject_chat_user_context(history, payload_step1)

        # Snapshot history after Call 1 (this is what the logging system would see)
        history_after_call1 = copy.deepcopy(history)

        self.assertEqual(history_after_call1[0]["role"], "assistant")
        self.assertEqual(history_after_call1[1]["role"], "tool")
        self.assertIn('"chapter_id": 4', history_after_call1[1]["content"])
        self.assertEqual(history_after_call1[2]["role"], "user")

        # Step 2: Assistant responds and calls tools for Chapter 3
        history.append(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call1",
                        "type": "function",
                        "function": {
                            "name": "get_chapter_content",
                            "arguments": '{"chap_id":3}',
                        },
                    }
                ],
            }
        )
        history.append(
            {
                "role": "tool",
                "name": "get_chapter_content",
                "tool_call_id": "call1",
                "content": '{"total": 100}',
            }
        )
        history.append({"role": "assistant", "content": "Chapter 3 has 100 words."})

        # Step 3: User asks another question. Application is STILL in Chapter 4.
        history.append({"role": "user", "content": "How many letters in this chapter?"})

        # Call 2
        inject_chat_user_context(history, payload_step1)

        # CRITICAL CHECK 1: Did Call 2 mutate the snapshot of Call 1?
        self.assertIn(
            '"chapter_id": 4',
            history_after_call1[1]["content"],
            "Call 2 mutated history_after_call1!",
        )

        # CRITICAL CHECK 2: Is the second call's history correct?
        # [ASST(4), TOOL(4), USER(1), ASST, TOOL, ASST, USER(2)]
        # There should be NO new TOOL(4) because context hasn't changed.
        self.assertEqual(len(history), 7)
        self.assertEqual(history[0]["role"], "assistant")
        self.assertEqual(history[1]["role"], "tool")
        self.assertEqual(history[2]["role"], "user")
        self.assertEqual(history[6]["role"], "user")
        self.assertNotEqual(
            history[5]["role"], "tool", "Injected redundant tool message!"
        )

        # Step 4: Now CHANGE chapter to 5 and ask again
        payload_step2 = {"current_chapter": {"id": 5, "title": "Chap 5"}}
        history.append({"role": "assistant", "content": "Checking chapter 4 now..."})
        history.append({"role": "user", "content": "Now check chapter 5."})

        # Call 3
        inject_chat_user_context(history, payload_step2)

        # Expected: [ASST(4), TOOL(4), USER, ASST, TOOL, ASST, USER, ASST, ASST(5), TOOL(5), USER]
        self.assertEqual(len(history), 11)
        self.assertEqual(history[9]["role"], "tool")
        self.assertIn('"chapter_id": 5', history[9]["content"])
        self.assertEqual(history[10]["role"], "user")

    def test_inject_chat_user_context_updates_stale_start_tool(self):
        """
        Verify that if the frontend already sent a get_current_chapter_id at the start
        but the application state has since changed, we update the existing tool content
        instead of leaving it stale or prepending a new one (which would be redundant).
        """
        import json

        # State: In Chapter 5
        payload = {"current_chapter": {"id": 5, "title": "Chap 5"}}
        # Note: the real tool uses chapter_id and chapter_title
        target_content = json.dumps(
            {"chapter_id": 5, "chapter_title": "Chap 5"}, ensure_ascii=False
        )

        # History: Frontend sent a STALE tool message (e.g. from Chap 4) at the start
        history = [
            {"role": "system", "content": "system"},
            {
                "role": "tool",
                "name": "get_current_chapter_id",
                "content": '{"chapter_id":4}',
            },
            {"role": "user", "content": "Request"},
        ]

        inject_chat_user_context(history, payload)

        # Expected: The existing tool message is updated to Chap 5 and wrapped by a tool_call
        self.assertEqual(len(history), 4)
        self.assertEqual(history[0]["role"], "system")
        self.assertEqual(history[1]["role"], "assistant")
        self.assertEqual(history[2]["role"], "tool")
        self.assertEqual(history[2]["content"], target_content)
        self.assertEqual(history[3]["role"], "user")
