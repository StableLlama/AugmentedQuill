# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test story endpoints unit so this responsibility stays isolated, testable, and easy to evolve."""

import asyncio
from pathlib import Path

from augmentedquill.api.v1.story_routes import generation_streaming
from augmentedquill.services.llm import llm
from augmentedquill.services.projects.projects import select_project
from tests.unit.api.v1.api_test_case import ApiTestCase


class StoryEndpointsTest(ApiTestCase):
    def _make_project(
        self,
        name: str = "novel",
        story_summary: str | None = "Overall story summary.",
        tags: list | None = None,
        sourcebook: dict | None = None,
    ) -> Path:
        if tags is None:
            tags = ["fantasy", "adventure"]
        ok, msg = select_project(name)
        self.assertTrue(ok, msg)
        pdir = self.projects_root / name
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("Chapter one text", encoding="utf-8")
        (chdir / "0002.txt").write_text("Chapter two text", encoding="utf-8")
        # start with a baseline story config; allow overriding optional fields
        story_cfg = {
            "project_title": "P",
            "format": "markdown",
            "chapters": [
                {"title": "T1", "summary": "S1"},
                {"title": "T2", "summary": "S2"},
            ],
            "llm_prefs": {"temperature": 0.7, "max_tokens": 2048},
            "metadata": {"version": 2},
        }
        if story_summary is not None:
            story_cfg["story_summary"] = story_summary
        if tags is not None:
            story_cfg["tags"] = tags
        if sourcebook is not None:
            story_cfg["sourcebook"] = sourcebook
        else:
            # default entry for previous tests
            story_cfg.setdefault(
                "sourcebook",
                {
                    "EntryOne": {
                        "description": "A background character.",
                        "category": "person",
                        "synonyms": [],
                    }
                },
            )

        import json

        (pdir / "story.json").write_text(json.dumps(story_cfg), encoding="utf-8")
        return pdir

    def _make_series_project(self, name: str = "series") -> Path:
        ok, msg = select_project(name)
        self.assertTrue(ok, msg)
        pdir = self.projects_root / name

        import json

        story_cfg = {
            "project_title": "Series P",
            "project_type": "series",
            "format": "markdown",
            "story_summary": "Existing series summary.",
            "books": [
                {
                    "id": "book-1",
                    "folder": "book-1",
                    "title": "Book One",
                    "summary": "Book-level summary one.",
                    "chapters": [{"title": "Chapter 1", "summary": "CHAPTER ONLY ONE"}],
                },
                {
                    "id": "book-2",
                    "folder": "book-2",
                    "title": "Book Two",
                    "summary": "Book-level summary two.",
                    "chapters": [{"title": "Chapter 2", "summary": "CHAPTER ONLY TWO"}],
                },
            ],
            "llm_prefs": {"temperature": 0.7, "max_tokens": 2048},
            "metadata": {"version": 2},
            "tags": ["fantasy"],
        }
        (pdir / "story.json").write_text(json.dumps(story_cfg), encoding="utf-8")
        return pdir

    # ---- PUT /api/v1/chapters/{id}/summary ----
    def test_put_summary_updates_story(self):
        pdir = self._make_project()
        r = self.client.put(
            "/api/v1/chapters/1/summary", json={"summary": "New summary"}
        )
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data.get("ok"))
        self.assertEqual(data["chapter"]["summary"], "New summary")
        # Verify persisted
        import json

        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story["chapters"][0]["summary"], "New summary")

    def test_put_summary_404_invalid_id(self):
        self._make_project()
        r = self.client.put("/api/v1/chapters/999/summary", json={"summary": "X"})
        self.assertEqual(r.status_code, 404)

    def test_project_select_story_payload_keeps_time_travel_fields(self):
        sourcebook = {
            "1985 -> 1955": {
                "description": "Temporal jump",
                "category": "Time Travel",
                "synonyms": [],
                "origin_date": "1985-11-05T20:00:00+00:00[UTC][u-ca=gregory]",
                "destination_datetime": "1955-11-05T20:00:00+00:00[UTC][u-ca=gregory]",
                "destination_relative": "30 years earlier",
                "creates_new_timeline": True,
                "timeline_id": "branch:16->10",
            }
        }
        self._make_project(name="tt_payload", sourcebook=sourcebook)

        r = self.client.post("/api/v1/projects/select", json={"name": "tt_payload"})
        self.assertEqual(r.status_code, 200, r.text)

        story = (r.json() or {}).get("story") or {}
        entries = story.get("sourcebook") or []
        tt_entry = next((e for e in entries if e.get("id") == "1985 -> 1955"), None)

        self.assertIsNotNone(
            tt_entry, f"Missing time travel entry in payload: {entries}"
        )
        self.assertEqual(
            tt_entry.get("origin_date"),
            "1985-11-05T20:00:00+00:00[UTC][u-ca=gregory]",
        )
        self.assertEqual(
            tt_entry.get("destination_datetime"),
            "1955-11-05T20:00:00+00:00[UTC][u-ca=gregory]",
        )
        self.assertEqual(tt_entry.get("destination_relative"), "30 years earlier")
        self.assertTrue(tt_entry.get("creates_new_timeline"))
        self.assertEqual(tt_entry.get("timeline_id"), "branch:16->10")

    # ---- Story LLM endpoints with fakes ----
    def _patch_llm(self):
        # Patch credentials and completion in augmentedquill.services.llm.llm
        self._orig_resolve = llm.resolve_openai_credentials
        self._orig_unified = llm.unified_chat_complete

        async def fake_complete(**kwargs):  # type: ignore
            # Return a minimal response
            content = kwargs.get("messages", [{}])[-1].get("content", "")
            # If asked to write chapter, return a known text
            if "Task: Write the full current draft" in content:
                txt = "AI chapter body"
            elif "Task: Continue the current draft" in content:
                txt = "AI continuation"
            else:
                txt = "AI summary"
            return {"content": txt, "tool_calls": [], "thinking": ""}

        llm.resolve_openai_credentials = lambda payload, **kwargs: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
            "fake-model",
        )  # type: ignore
        llm.unified_chat_complete = fake_complete  # type: ignore

        def _undo():
            llm.resolve_openai_credentials = self._orig_resolve  # type: ignore
            llm.unified_chat_complete = self._orig_unified  # type: ignore

        self.addCleanup(_undo)

    def test_story_summary_updates_and_persists(self):
        pdir = self._make_project()
        self._patch_llm()
        r = self.client.post(
            "/api/v1/story/summary",
            json={"chap_id": 1, "mode": "update", "model_name": "fake"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data.get("ok"))
        self.assertEqual(data["summary"], "AI summary")
        import json

        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story["chapters"][0]["summary"], "AI summary")

    def test_story_story_summary_for_series_uses_book_summaries(self):
        pdir = self._make_series_project()
        self._orig_resolve = llm.resolve_openai_credentials
        self._orig_unified = llm.unified_chat_complete

        async def fake_complete(**kwargs):  # type: ignore
            content = kwargs.get("messages", [{}])[-1].get("content", "")
            self.assertIn("Book summaries:", content)
            self.assertIn("Book One:\nBook-level summary one.", content)
            self.assertIn("Book Two:\nBook-level summary two.", content)
            self.assertNotIn("CHAPTER ONLY ONE", content)
            self.assertNotIn("CHAPTER ONLY TWO", content)
            return {"content": "Series AI summary", "tool_calls": [], "thinking": ""}

        llm.resolve_openai_credentials = lambda payload, **kwargs: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
            "fake-model",
        )  # type: ignore
        llm.unified_chat_complete = fake_complete  # type: ignore

        def _undo():
            llm.resolve_openai_credentials = self._orig_resolve  # type: ignore
            llm.unified_chat_complete = self._orig_unified  # type: ignore

        self.addCleanup(_undo)

        r = self.client.post(
            "/api/v1/story/story-summary",
            json={"mode": "update", "model_name": "fake"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data.get("ok"))
        self.assertEqual(data["summary"], "Series AI summary")

        import json

        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story["story_summary"], "Series AI summary")

    def test_story_write_overwrites_file(self):
        pdir = self._make_project()
        self._patch_llm()
        # Ensure summary exists
        r = self.client.post(
            "/api/v1/story/write", json={"chap_id": 1, "model_name": "fake"}
        )
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(data.get("content"), "AI chapter body")
        text = (pdir / "chapters" / "0001.txt").read_text(encoding="utf-8")
        self.assertEqual(text, "AI chapter body")

    def test_story_continue_appends(self):
        pdir = self._make_project()
        self._patch_llm()
        # continue
        r = self.client.post(
            "/api/v1/story/continue", json={"chap_id": 1, "model_name": "fake"}
        )
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertIn("AI continuation", data.get("content", ""))
        text = (pdir / "chapters" / "0001.txt").read_text(encoding="utf-8")
        self.assertIn("AI continuation", text)

    def test_story_endpoints_404_for_invalid_id(self):
        self._make_project()
        self._patch_llm()
        for path in (
            "/api/v1/story/summary",
            "/api/v1/story/write",
            "/api/v1/story/continue",
        ):
            r = self.client.post(path, json={"chap_id": 999, "model_name": "fake"})
            self.assertEqual(r.status_code, 404, path)

    def test_suggest_endpoint_streams_paragraph(self):
        """Ensure `/api/v1/story/suggest` is registered and returns streaming text."""
        pdir = self._make_project()

        # Patch the completions stream used by the suggest endpoint
        # Patch the completions stream used by the suggest endpoint
        orig_stream = llm.openai_completions_stream
        orig_edit = llm.unified_chat_complete

        async def fake_stream(prompt: str, **kwargs):
            # ensure our enhanced context made it into the prompt text
            # it will be passed as the single argument to the llm call
            self.assertIn("Story title: P", prompt)
            self.assertIn("Story description: Overall story summary.", prompt)
            self.assertIn("Story tags: fantasy, adventure", prompt)
            # background entry should appear by name or description
            self.assertIn("EntryOne", prompt)
            # chapter fields stay present
            self.assertIn("Current draft title: T1", prompt)
            self.assertIn("Current draft summary: S1", prompt)
            self.assertIn("Author's notes about the current draft:", prompt)
            self.assertIn("Use quote from sage", prompt)
            # ensure extra_body was not provided (configured model should win)
            self.assertTrue(
                "extra_body" not in kwargs or kwargs.get("extra_body") is None
            )

            # Yield a few chunks as the real stream would
            yield "First chunk of suggestion"
            yield " and the rest of the paragraph.\n"

        async def fake_edit(**kwargs):
            # confirm the selector prompt contained recent text and entry list
            msgs = kwargs.get("messages", [])
            self.assertTrue(
                any("Recent paragraphs" in m.get("content", "") for m in msgs)
            )
            self.assertTrue(any("Entries:" in m.get("content", "") for m in msgs))
            content = msgs[-1].get("content", "")
            self.assertIn("EntryOne", content)
            return {"content": "EntryOne"}

        llm.openai_completions_stream = fake_stream  # type: ignore
        llm.unified_chat_complete = fake_edit  # type: ignore
        # Also ensure credential resolution succeeds for this test
        orig_resolve = llm.resolve_openai_credentials
        llm.resolve_openai_credentials = lambda payload, **kwargs: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
            "fake-model",
        )  # type: ignore

        def _undo():
            llm.openai_completions_stream = orig_stream  # type: ignore
            llm.unified_chat_complete = orig_edit  # type: ignore
            llm.resolve_openai_credentials = orig_resolve  # type: ignore

        self.addCleanup(_undo)

        # make sure chapter notes are included in prompt
        import json

        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        story["chapters"][0]["notes"] = "Use quote from sage"
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")

        # Call the suggest endpoint
        r = self.client.post(
            "/api/v1/story/suggest",
            json={
                "chap_id": 1,
                "current_text": "Hello",
                "checked_sourcebook": ["EntryOne"],
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        # Response should be plain text and return non-empty content
        self.assertTrue(r.headers.get("content-type", "").startswith("text/plain"))
        text = r.text or ""
        self.assertGreater(len(text.strip()), 0, f"empty response body: {text!r}")
        self.assertEqual(
            text,
            "First chunk of suggestion and the rest of the paragraph.\n",
            f"Unexpected response body: {text!r}",
        )

    def test_suggest_filters_empty_sections(self):
        """Prompt should omit lines for empty story metadata or background."""
        # create project with blanks
        self._make_project(
            name="novel2",
            story_summary="",
            tags=[],
            sourcebook={},
        )
        self._patch_llm()

        orig_stream = llm.openai_completions_stream
        orig_edit = llm.unified_chat_complete

        async def fake_stream2(prompt: str, **kwargs):
            self.assertIn("Story title: P", prompt)
            self.assertNotIn("Story description:", prompt)
            self.assertNotIn("Story tags:", prompt)
            self.assertNotIn("Background information:", prompt)
            # still includes chapter info
            self.assertIn("Chapter title: T1", prompt)
            yield "whatever"

        llm.openai_completions_stream = fake_stream2  # type: ignore

        async def fake_edit2(**kwargs):
            # editing selector should be invoked even with no entries
            msgs = kwargs.get("messages", [])
            self.assertTrue(any("Entries:" in m.get("content", "") for m in msgs))
            return {"content": ""}

        llm.unified_chat_complete = fake_edit2  # type: ignore
        # patch resolve
        orig_resolve = llm.resolve_openai_credentials
        llm.resolve_openai_credentials = lambda payload, **kwargs: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
            "fake-model",
        )  # type: ignore

        def _undo2():
            llm.openai_completions_stream = orig_stream  # type: ignore
            llm.unified_chat_complete = orig_edit  # type: ignore
            llm.resolve_openai_credentials = orig_resolve  # type: ignore

        self.addCleanup(_undo2)

        r = self.client.post(
            "/api/v1/story/suggest", json={"chap_id": 1, "current_text": "Hi"}
        )
        self.assertEqual(r.status_code, 200)

        self.assertTrue(r.headers.get("content-type", "").startswith("text/plain"))
        text = r.text or ""
        self.assertGreater(len(text.strip()), 0, f"empty response body: {text!r}")

    def test_suggest_mode_pure_uses_only_current_text(self):
        """Pure suggest mode should pass only current chapter text to the model."""
        self._make_project(name="novel_pure_mode")

        orig_stream = llm.openai_completions_stream
        orig_edit = llm.unified_chat_complete
        orig_resolve = llm.resolve_openai_credentials

        seen_prompt = {"value": ""}

        async def fake_stream(prompt: str, **kwargs):
            seen_prompt["value"] = prompt
            yield "pure mode output"

        async def fake_edit(**kwargs):
            return {"content": ""}

        llm.openai_completions_stream = fake_stream  # type: ignore
        llm.unified_chat_complete = fake_edit  # type: ignore
        llm.resolve_openai_credentials = lambda payload, **kwargs: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
            "fake-model",
        )  # type: ignore

        def _undo():
            llm.openai_completions_stream = orig_stream  # type: ignore
            llm.unified_chat_complete = orig_edit  # type: ignore
            llm.resolve_openai_credentials = orig_resolve  # type: ignore

        self.addCleanup(_undo)

        r = self.client.post(
            "/api/v1/story/suggest",
            json={
                "chap_id": 1,
                "current_text": "Pure mode source text",
                "mode": "pure",
            },
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(seen_prompt["value"], "Pure mode source text")

    def test_suggest_mode_instructed_uses_context_rich_prompt(self):
        """Instructed suggest mode should use role-based chat messages."""
        self._make_project(name="novel_original_mode")

        orig_stream = llm.openai_chat_complete_stream
        orig_edit = llm.unified_chat_complete
        orig_resolve = llm.resolve_openai_credentials

        seen_messages = {"value": []}

        async def fake_stream(messages: list[dict[str, str]], **kwargs):
            seen_messages["value"] = messages
            yield "instructed mode output"

        async def fake_edit(**kwargs):
            return {"content": ""}

        llm.openai_chat_complete_stream = fake_stream  # type: ignore
        llm.unified_chat_complete = fake_edit  # type: ignore
        llm.resolve_openai_credentials = lambda payload, **kwargs: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
            "fake-model",
        )  # type: ignore

        def _undo():
            llm.openai_chat_complete_stream = orig_stream  # type: ignore
            llm.unified_chat_complete = orig_edit  # type: ignore
            llm.resolve_openai_credentials = orig_resolve  # type: ignore

        self.addCleanup(_undo)

        r = self.client.post(
            "/api/v1/story/suggest",
            json={
                "chap_id": 1,
                "current_text": "Instructed mode source text",
                "mode": "instructed",
            },
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(seen_messages["value"][0]["role"], "system")
        self.assertEqual(seen_messages["value"][1]["role"], "user")
        self.assertIn(
            "Task: Write the immediate next paragraph to continue the story.",
            seen_messages["value"][1]["content"],
        )
        self.assertIn("Story title: P", seen_messages["value"][1]["content"])
        self.assertIn("# T1", seen_messages["value"][1]["content"])
        self.assertIn("Current draft summary: S1", seen_messages["value"][1]["content"])
        self.assertIn(
            "Instructed mode source text", seen_messages["value"][1]["content"]
        )

    def test_sourcebook_relevance_uses_scene_lookup_without_llm(self):
        pdir = self._make_project(
            name="scene_relevance",
            sourcebook={
                "Hero": {
                    "description": "Hero profile.",
                    "category": "Character",
                    "synonyms": [],
                },
                "Town": {
                    "description": "Town profile.",
                    "category": "Location",
                    "synonyms": [],
                },
                "Villain": {
                    "description": "Villain profile.",
                    "category": "Character",
                    "synonyms": [],
                },
            },
        )

        import json

        story_path = pdir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["scenes"] = {
            "1": {
                "summary": "Arrival",
                "active_characters": ["Hero"],
                "passive_characters": [],
                "sourcebook_entry_ids": [],
                "location": "Town",
                "order_index": 1,
                "prose_link": {
                    "scope_type": "chapter",
                    "chapter_id": "1",
                    "start_offset": 0,
                    "end_offset": 12,
                },
            },
            "2": {
                "summary": "Threat",
                "active_characters": ["Villain"],
                "passive_characters": [],
                "sourcebook_entry_ids": [],
                "location": "Town",
                "order_index": 2,
                "prose_link": {
                    "scope_type": "chapter",
                    "chapter_id": "1",
                    "start_offset": 12,
                    "end_offset": 24,
                },
            },
        }
        story_path.write_text(json.dumps(story), encoding="utf-8")

        orig_complete = llm.unified_chat_complete

        async def fail_if_called(**kwargs):  # type: ignore
            raise AssertionError("sourcebook relevance should not call the LLM")

        llm.unified_chat_complete = fail_if_called  # type: ignore

        def _undo():
            llm.unified_chat_complete = orig_complete  # type: ignore

        self.addCleanup(_undo)

        r = self.client.post(
            "/api/v1/story/sourcebook/relevance",
            json={"chap_id": 1, "current_text": "Arrival text"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"relevant": ["Hero", "Town", "Villain"]})

    def test_suggest_loop_detection_truncates_repetitive_output(self):
        """Loop detection truncates repetitive text to the last clean prefix without retrying."""
        self._make_project(name="novel_loop_guard")

        orig_stream = llm.openai_completions_stream
        orig_edit = llm.unified_chat_complete
        orig_resolve = llm.resolve_openai_credentials

        call_index = {"value": 0}

        async def fake_stream_loop(prompt: str, **kwargs):
            call_index["value"] += 1
            if call_index["value"] == 1:
                yield "the way the way the way the way\n"
            else:
                yield "He moved through the alley and kept his breath steady.\n"

        async def fake_edit(**kwargs):
            return {"content": ""}

        llm.openai_completions_stream = fake_stream_loop  # type: ignore
        llm.unified_chat_complete = fake_edit  # type: ignore
        llm.resolve_openai_credentials = lambda payload, **kwargs: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
            "fake-model",
        )  # type: ignore

        def _undo():
            llm.openai_completions_stream = orig_stream  # type: ignore
            llm.unified_chat_complete = orig_edit  # type: ignore
            llm.resolve_openai_credentials = orig_resolve  # type: ignore

        self.addCleanup(_undo)

        r = self.client.post(
            "/api/v1/story/suggest",
            json={"chap_id": 1, "current_text": "Hi"},
        )
        self.assertEqual(r.status_code, 200)
        # The repetitive tail is truncated; the second attempt is never made.
        self.assertNotIn("the way the way the way the way", r.text)
        self.assertEqual(call_index["value"], 1)

    def test_suggest_loop_detection_always_truncates_loops(self):
        """Loop detection is always-on; repetitive output is truncated to the last clean sentence."""
        self._make_project(name="novel_loop_guard_disabled")

        orig_stream = llm.openai_completions_stream
        orig_edit = llm.unified_chat_complete
        orig_resolve = llm.resolve_openai_credentials

        call_index = {"value": 0}

        async def fake_stream_loop(prompt: str, **kwargs):
            call_index["value"] += 1
            yield "the way the way the way the way\n"

        async def fake_edit(**kwargs):
            return {"content": ""}

        llm.openai_completions_stream = fake_stream_loop  # type: ignore
        llm.unified_chat_complete = fake_edit  # type: ignore
        llm.resolve_openai_credentials = lambda payload, **kwargs: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
            "fake-model",
        )  # type: ignore

        def _undo():
            llm.openai_completions_stream = orig_stream  # type: ignore
            llm.unified_chat_complete = orig_edit  # type: ignore
            llm.resolve_openai_credentials = orig_resolve  # type: ignore

        self.addCleanup(_undo)

        r = self.client.post(
            "/api/v1/story/suggest",
            json={"chap_id": 1, "current_text": "Hi"},
        )
        self.assertEqual(r.status_code, 200)
        # Loop is detected and the output is truncated to the clean prefix.
        self.assertNotIn("the way the way the way the way", r.text)
        self.assertEqual(call_index["value"], 1)

    def test_suggest_stream_leading_newlines_passed_through(self):
        """Leading newlines from the model are forwarded to the client as semantic signals.

        The frontend uses them to decide how to join the suggestion to the existing
        prose (inline / hard line break / paragraph break).  The suggestion display
        strips them for visual rendering, but they must be present in the raw stream.
        """
        self._make_project(name="novel_stream_newline_prefix")

        orig_stream = llm.openai_completions_stream
        orig_edit = llm.unified_chat_complete
        orig_resolve = llm.resolve_openai_credentials

        async def fake_stream_chunks(prompt: str, **kwargs):
            # Simulate a model that starts with paragraph separation then prose.
            yield "\n\n"
            yield "She"
            yield " walked into the room and paused."

        async def fake_edit(**kwargs):
            return {"content": ""}

        llm.openai_completions_stream = fake_stream_chunks  # type: ignore
        llm.unified_chat_complete = fake_edit  # type: ignore
        llm.resolve_openai_credentials = lambda payload, **kwargs: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
            "fake-model",
        )  # type: ignore

        def _undo():
            llm.openai_completions_stream = orig_stream  # type: ignore
            llm.unified_chat_complete = orig_edit  # type: ignore
            llm.resolve_openai_credentials = orig_resolve  # type: ignore

        self.addCleanup(_undo)

        r = self.client.post(
            "/api/v1/story/suggest",
            json={"chap_id": 1, "current_text": "Hi"},
        )
        self.assertEqual(r.status_code, 200)
        # The leading newlines must be forwarded (they are semantic, not noise).
        self.assertTrue(r.text.startswith("\n\n"), repr(r.text))
        # The full word "She" must not be clipped.
        self.assertIn("She walked", r.text)

    def test_suggest_prompt_normalizes_trailing_newlines_in_current_text(self):
        """Trailing newlines in current_text must be normalised before reaching the LLM.

        * Single trailing \\n  -> stripped (noise from editor auto-newline).
        * Two or more trailing \\n -> kept as exactly \\n\\n (intentional paragraph break).
        """
        from augmentedquill.api.v1.story_routes.generation_streaming import (
            _normalize_current_text_for_llm,
        )

        # No trailing newline: unchanged.
        self.assertEqual(_normalize_current_text_for_llm("Hello"), "Hello")
        # Single trailing newline: stripped.
        self.assertEqual(_normalize_current_text_for_llm("Hello\n"), "Hello")
        # Exactly two: kept as-is.
        self.assertEqual(_normalize_current_text_for_llm("Hello\n\n"), "Hello\n\n")
        # Three or more: normalised to two.
        self.assertEqual(_normalize_current_text_for_llm("Hello\n\n\n"), "Hello\n\n")
        self.assertEqual(_normalize_current_text_for_llm("Hello\n\n\n\n"), "Hello\n\n")
        # Empty string: unchanged.
        self.assertEqual(_normalize_current_text_for_llm(""), "")

    def test_suggest_stream_idle_timeout_returns_partial_candidate(self):
        """Stalled provider stream should not block suggestion forever."""
        self._make_project(name="novel_stream_idle")

        orig_stream = llm.openai_completions_stream
        orig_edit = llm.unified_chat_complete
        orig_resolve = llm.resolve_openai_credentials
        orig_idle_timeout = generation_streaming.SUGGEST_STREAM_IDLE_TIMEOUT_S

        async def fake_stream_idle(prompt: str, **kwargs):
            yield "He stepped into the rain and pulled his coat tighter."
            await asyncio.sleep(0.05)
            yield " This trailing chunk should not be required."

        async def fake_edit(**kwargs):
            return {"content": ""}

        llm.openai_completions_stream = fake_stream_idle  # type: ignore
        llm.unified_chat_complete = fake_edit  # type: ignore
        llm.resolve_openai_credentials = lambda payload, **kwargs: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
            "fake-model",
        )  # type: ignore
        generation_streaming.SUGGEST_STREAM_IDLE_TIMEOUT_S = 0.01

        def _undo():
            llm.openai_completions_stream = orig_stream  # type: ignore
            llm.unified_chat_complete = orig_edit  # type: ignore
            llm.resolve_openai_credentials = orig_resolve  # type: ignore
            generation_streaming.SUGGEST_STREAM_IDLE_TIMEOUT_S = orig_idle_timeout

        self.addCleanup(_undo)

        r = self.client.post(
            "/api/v1/story/suggest",
            json={"chap_id": 1, "current_text": "Hi"},
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            r.text,
            "He stepped into the rain and pulled his coat tighter.\n",
        )

    def test_post_story_title_updates_and_persists(self):
        pdir = self._make_project()
        new_title = "My New Story Title"
        r = self.client.post("/api/v1/story/title", json={"title": new_title})
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data.get("ok"))

        # Verify persisted in story.json
        import json

        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story["project_title"], new_title)

    def test_put_story_summary_updates_and_persists(self):
        pdir = self._make_project()
        new_summary = "This is a new story summary."
        r = self.client.put("/api/v1/story/summary", json={"summary": new_summary})
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data.get("ok"))

        # Verify persisted in story.json
        import json

        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story["story_summary"], new_summary)

    def test_put_story_tags_updates_and_persists(self):
        pdir = self._make_project()
        new_tags = ["fantasy", "adventure"]
        r = self.client.put("/api/v1/story/tags", json={"tags": new_tags})
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data.get("ok"))

        # Verify persisted in story.json
        import json

        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story["tags"], new_tags)
