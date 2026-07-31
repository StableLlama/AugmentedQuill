# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Tests for prompt loading and language support."""

import json
from unittest import TestCase

from augmentedquill.core.prompts import (
    get_available_languages,
    get_system_message,
    get_user_prompt,
)


class PromptsTest(TestCase):
    def test_available_languages_include_en(self):
        langs = get_available_languages()
        self.assertIn("en", langs)
        # language list should be nonempty
        self.assertTrue(len(langs) >= 1)

    def test_flattened_instructions_structure(self):
        # if the JSON file omits the "system_messages" wrapper, the loader
        # should still pick up the entries correctly.
        import tempfile
        from pathlib import Path

        sample = {"foo": {"en": "bar"}, "user_prompts": {}}
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as tmp:
            json.dump(sample, tmp)
            tmp_path = Path(tmp.name)

        # patch the defaults path and reload
        from augmentedquill.core import prompts

        old_path = prompts.DEFAULTS_JSON_PATH
        prompts.DEFAULTS_JSON_PATH = tmp_path
        try:
            p = prompts._load_prompts()
            self.assertIn("foo", p)
            self.assertEqual(p["foo"]["en"], "bar")
        finally:
            prompts.DEFAULTS_JSON_PATH = old_path

    def test_load_spanish_fallback(self):
        # if we ask for a non-existent language, we should get english
        msg = get_system_message("story_writer", model_overrides={}, language="es")
        # ensure english default appears in message
        self.assertIn("You are a skilled novelist", msg)

    def test_user_prompt_language_selection(self):
        prompt = get_user_prompt(
            "chapter_summary_new",
            chapter_text="foo",
            language="es",
            user_prompt_overrides={},
        )
        # spanish translation doesn't exist so we fall back to english
        self.assertIn("Task: Write a new summary", prompt)

    def test_chat_and_editing_prompts_are_project_structure_safe(self):
        chat_msg = get_system_message("chat_llm", model_overrides={}, language="en")
        editing_msg = get_system_message(
            "editing_llm", model_overrides={}, language="en"
        )

        self.assertIn(
            "Only use tools that are actually available in this session", chat_msg
        )
        self.assertIn(
            "The active project structure is determined by the tools available in this session",
            chat_msg,
        )
        self.assertIn("write_story_content", editing_msg)

    def test_scene_boundary_detection_prompt_interpolates_variables(self):
        prompt = get_user_prompt(
            "scene_boundary_detection",
            language="en",
            scene_ids="1, 2",
            scene_descriptions="1: Forest ambush\n2: Castle council",
            prose_text="Forest scene.\n\nCastle scene.",
        )

        self.assertIn("Scene IDs (allowed): 1, 2", prompt)
        self.assertIn("Scene descriptions:\n1: Forest ambush", prompt)
        self.assertIn("Prose segment:\nForest scene.", prompt)
        self.assertNotIn("{scene_ids}", prompt)
        self.assertNotIn("{scene_descriptions}", prompt)
        self.assertNotIn("{prose_text}", prompt)
        self.assertIn(
            '{"boundaries": [{"scene_id": 1, "start_offset": 0, "end_offset": 10}]}',
            prompt,
        )
