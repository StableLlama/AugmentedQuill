# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Tests for the prompt building helpers used by story generation."""

from unittest import TestCase

from augmentedquill.core.prompts import get_system_message
from augmentedquill.services.story.story_api_prompt_ops import (
    _get_read_only_tool_schemas,
    build_ai_action_messages,
    build_story_summary_messages,
)
from augmentedquill.services.story.story_generation_common import (
    gather_writing_context,
    normalize_included_markdown_headings,
    sanitize_prompt,
)


class StoryApiPromptOpsTest(TestCase):
    def test_build_ai_action_messages_system_prompt_has_no_placeholders(self):
        messages = build_ai_action_messages(
            target="summary",
            action="rewrite",
            project_type_label="Novel",
            story_title="My Story",
            story_summary="Some story summary",
            story_tags="tag1, tag2",
            chapter_title="Chapter 1",
            chapter_summary="Some chapter summary",
            chapter_conflicts="",
            existing_content="Some chapter content",
            model_overrides={},
            language="en",
        )

        system_msg = next((m for m in messages if m["role"] == "system"), None)
        self.assertIsNotNone(system_msg)
        self.assertNotIn("{content_label}", system_msg["content"])
        self.assertNotIn("{tools_list}", system_msg["content"])
        self.assertNotIn("{tool_instructions}", system_msg["content"])

        # Regression guard: ensure at least one tool is listed in the system prompt.
        self.assertIn("manage_story_core", system_msg["content"])

        user_msg = next((m for m in messages if m["role"] == "user"), None)
        self.assertIsNotNone(user_msg)

        expected_label = get_system_message("chapter_text_label", {}, language="en")
        self.assertIn(expected_label, user_msg["content"])

    def test_short_story_ai_action_messages_use_current_draft_wording(self):
        messages = build_ai_action_messages(
            target="chapter",
            action="rewrite",
            project_type_label="Short Story",
            story_title="My Story",
            story_summary="Some story summary",
            story_tags="tag1, tag2",
            chapter_title="My Story",
            chapter_summary="Some summary",
            chapter_conflicts="- Storm approaches",
            existing_content="Existing text",
            model_overrides={},
            language="en",
            project_type="short-story",
        )

        user_msg = next((m for m in messages if m["role"] == "user"), None)
        self.assertIsNotNone(user_msg)
        self.assertIn("current draft", user_msg["content"].lower())

    def test_chapter_rewrite_uses_prefill_prompt_shape(self):
        messages = build_ai_action_messages(
            target="chapter",
            action="rewrite",
            project_type_label="Novel",
            story_title="My Story",
            story_summary="Some story summary",
            story_tags="tag1, tag2",
            chapter_title="Chapter 1",
            chapter_summary="Some summary",
            chapter_conflicts="",
            existing_content="# Chapter 1\n\n",
            model_overrides={},
            language="en",
            project_type="novel",
        )

        user_msg = next((m for m in messages if m["role"] == "user"), None)
        self.assertIsNotNone(user_msg)
        self.assertIn(
            "Task: Write the full current draft as continuous prose.",
            user_msg["content"],
        )
        self.assertNotIn("Existing draft text (do not change)", user_msg["content"])
        self.assertNotIn("# Chapter 1", user_msg["content"])

    def test_read_only_tool_schema_filter_excludes_editing_functions(self):
        tools = _get_read_only_tool_schemas(project_type="series")
        names = {t["function"]["name"] for t in tools}
        self.assertIn("manage_story_core", names)
        self.assertNotIn("sync_story_summary", names)
        self.assertNotIn("write_story_content", names)
        self.assertNotIn("replace_text_in_chapter", names)

    def test_story_summary_messages_use_book_heading_for_series(self):
        messages = build_story_summary_messages(
            mode="update",
            current_story_summary="Current project summary",
            source_summaries=["Book One:\nSeries setup", "Book Two:\nSeries payoff"],
            summary_heading="Book summaries",
            model_overrides={},
            language="en",
            project_type="series",
        )

        user_msg = next((m for m in messages if m["role"] == "user"), None)
        self.assertIsNotNone(user_msg)
        self.assertIn("Book summaries:", user_msg["content"])
        self.assertIn("Book One:\nSeries setup", user_msg["content"])
        self.assertNotIn("Chapter summaries:", user_msg["content"])

    def test_gather_writing_context_short_story_drops_story_summary(self):
        story = {
            "project_type": "short-story",
            "project_title": "My Short Story",
            "story_summary": "My Short Story Summary",
            "tags": ["fantasy"],
        }

        context = gather_writing_context(
            story=story,
            chapters_data=[],
            pos=None,
            title="My Short Story",
            summary="My Short Story Summary",
            payload={},
        )

        self.assertEqual(context["project_type_label"], "Short Story")
        self.assertEqual(context["story_summary"], "")

    def test_sanitize_prompt_removes_empty_story_description_label(self):
        prompt = """
Story title: My Short Story

Story description:

Story tags: cozy
"""
        cleaned = sanitize_prompt(prompt)
        self.assertNotIn("Story description:", cleaned)
        self.assertIn("Story title: My Short Story", cleaned)
        self.assertIn("Story tags: cozy", cleaned)

    def test_normalize_included_markdown_headings_aligns_to_level_three(self):
        text = "# Heading 1\n## Subheading\n### Subsubheading\n"
        normalized = normalize_included_markdown_headings(text)
        self.assertIn("### Heading 1", normalized)
        self.assertIn("#### Subheading", normalized)
        self.assertIn("##### Subsubheading", normalized)

        text2 = "## Section\n### Detail\n"
        normalized2 = normalize_included_markdown_headings(text2)
        self.assertIn("### Section", normalized2)
        self.assertIn("#### Detail", normalized2)

        text3 = "#### Deep section\n##### Detail\n"
        normalized3 = normalize_included_markdown_headings(text3)
        self.assertIn("### Deep section", normalized3)
        self.assertIn("#### Detail", normalized3)

    # -----------------------------------------------------------------------
    # story_summary target – template selection and placeholder filling
    # -----------------------------------------------------------------------

    def _build_story_summary_msgs(
        self,
        action: str,
        project_type: str,
        existing_summary: str = "",
        chapter_summaries: str = "Ch1 summary\n\nCh2 summary",
    ):
        return build_ai_action_messages(
            target="story_summary",
            action=action,
            project_type_label="Novel",
            story_title="My Story",
            story_summary=existing_summary,
            story_tags="tag1",
            chapter_title="My Story",
            chapter_summary=existing_summary,
            chapter_conflicts="",
            existing_content="Story draft text here.",
            chapter_summaries=chapter_summaries,
            model_overrides={},
            language="en",
            project_type=project_type,
        )

    def test_story_summary_write_novel_uses_new_template(self):
        """action='write' must use story_summary_new (no existing_summary block)."""
        msgs = self._build_story_summary_msgs("write", "novel")
        user_msg = next(m for m in msgs if m["role"] == "user")
        self.assertNotIn("{", user_msg["content"], "Unfilled placeholder found")
        self.assertNotIn("Existing story summary", user_msg["content"])
        self.assertIn("Chapter summaries", user_msg["content"])

    def test_story_summary_rewrite_novel_uses_new_template(self):
        """action='rewrite' must also use story_summary_new."""
        msgs = self._build_story_summary_msgs(
            "rewrite", "novel", existing_summary="Old summary"
        )
        user_msg = next(m for m in msgs if m["role"] == "user")
        self.assertNotIn("{", user_msg["content"], "Unfilled placeholder found")
        self.assertNotIn("Existing story summary", user_msg["content"])
        self.assertIn("Chapter summaries", user_msg["content"])

    def test_story_summary_update_novel_uses_update_template(self):
        """action='update' must use story_summary_update (shows existing_summary block)."""
        msgs = self._build_story_summary_msgs(
            "update", "novel", existing_summary="Old summary"
        )
        user_msg = next(m for m in msgs if m["role"] == "user")
        self.assertNotIn("{", user_msg["content"], "Unfilled placeholder found")
        self.assertIn("Existing story summary", user_msg["content"])
        self.assertIn("Old summary", user_msg["content"])
        self.assertIn("Chapter summaries", user_msg["content"])
        self.assertIn("Ch1 summary", user_msg["content"])

    def test_story_summary_source_summaries_placeholder_is_filled(self):
        """The {source_summaries} placeholder must be filled – never sent raw to the LLM."""
        chapter_summaries = "Chapter One summary\n\nChapter Two summary"
        msgs = self._build_story_summary_msgs(
            "write", "novel", chapter_summaries=chapter_summaries
        )
        user_msg = next(m for m in msgs if m["role"] == "user")
        self.assertNotIn("{source_summaries}", user_msg["content"])
        self.assertIn("Chapter One summary", user_msg["content"])

    def test_story_summary_update_existing_summary_placeholder_is_filled(self):
        """The {existing_summary} placeholder in the update template must be filled."""
        msgs = self._build_story_summary_msgs(
            "update", "novel", existing_summary="My existing summary"
        )
        user_msg = next(m for m in msgs if m["role"] == "user")
        self.assertNotIn("{existing_summary}", user_msg["content"])
        self.assertIn("My existing summary", user_msg["content"])

    def test_story_summary_series_uses_book_summaries_heading(self):
        """For series, the summary_heading should be 'Book summaries'."""
        msgs = self._build_story_summary_msgs(
            "write", "series", chapter_summaries="Book One summary"
        )
        user_msg = next(m for m in msgs if m["role"] == "user")
        self.assertNotIn("{", user_msg["content"], "Unfilled placeholder found")
        self.assertIn("Book summaries", user_msg["content"])

    # -----------------------------------------------------------------------
    # story_summary target – short-story project type
    # -----------------------------------------------------------------------

    def _build_short_story_summary_msgs(self, action: str, existing_summary: str = ""):
        return build_ai_action_messages(
            target="story_summary",
            action=action,
            project_type_label="Short Story",
            story_title="My Short Story",
            story_summary=existing_summary,
            story_tags="cozy",
            chapter_title="My Short Story",
            chapter_summary=existing_summary,
            chapter_conflicts="",
            existing_content="Once upon a time the hero set out.",
            chapter_summaries="",
            model_overrides={},
            language="en",
            project_type="short-story",
        )

    def test_short_story_summary_write_uses_chapter_text_template(self):
        """Short-story write should use chapter_summary_new (story draft as source)."""
        msgs = self._build_short_story_summary_msgs("write")
        user_msg = next(m for m in msgs if m["role"] == "user")
        self.assertNotIn("{", user_msg["content"], "Unfilled placeholder found")
        # chapter_summary_new embeds the chapter/story text directly
        self.assertIn("Once upon a time the hero set out.", user_msg["content"])
        # Must NOT try to use chapter/book summaries (there are none)
        self.assertNotIn("{source_summaries}", user_msg["content"])

    def test_short_story_summary_rewrite_uses_chapter_text_template(self):
        """Short-story rewrite should also use chapter_summary_new."""
        msgs = self._build_short_story_summary_msgs(
            "rewrite", existing_summary="Old summary"
        )
        user_msg = next(m for m in msgs if m["role"] == "user")
        self.assertNotIn("{", user_msg["content"], "Unfilled placeholder found")
        self.assertIn("Once upon a time the hero set out.", user_msg["content"])

    def test_short_story_summary_update_uses_chapter_text_update_template(self):
        """Short-story update should use chapter_summary_update (shows existing summary)."""
        msgs = self._build_short_story_summary_msgs(
            "update", existing_summary="Old summary"
        )
        user_msg = next(m for m in msgs if m["role"] == "user")
        self.assertNotIn("{", user_msg["content"], "Unfilled placeholder found")
        self.assertIn("Old summary", user_msg["content"])
        self.assertIn("Once upon a time the hero set out.", user_msg["content"])

    def test_short_story_summary_empty_content_has_no_placeholders(self):
        """When existing_content is '' (as the frontend sends before disk-read), the
        template must not leave raw {…} placeholders in the output.  The server-side
        guard in prepare_ai_action_generation must inject the story draft before
        calling build_ai_action_messages; this test confirms the template itself
        stays clean even in the degenerate empty case."""
        msgs = build_ai_action_messages(
            target="story_summary",
            action="write",
            project_type_label="Short Story",
            story_title="My Story",
            story_summary="",
            story_tags="",
            chapter_title="My Story",
            chapter_summary="",
            chapter_conflicts="",
            existing_content="",  # empty – simulates what happens without the disk read
            chapter_summaries="",
            model_overrides={},
            language="en",
            project_type="short-story",
        )
        user_msg = next(m for m in msgs if m["role"] == "user")
        self.assertNotIn("{", user_msg["content"])

    # -----------------------------------------------------------------------
    # book_summary target
    # -----------------------------------------------------------------------

    def test_book_summary_write_uses_new_template(self):
        """book_summary + write must use story_summary_new, not story_summary_update."""
        msgs = build_ai_action_messages(
            target="book_summary",
            action="write",
            project_type_label="Series",
            story_title="My Series",
            story_summary="",
            story_tags="",
            chapter_title="Book One",
            chapter_summary="",
            chapter_conflicts="",
            existing_content="",
            chapter_summaries="Ch1 summary\n\nCh2 summary",
            model_overrides={},
            language="en",
            project_type="series",
        )
        user_msg = next(m for m in msgs if m["role"] == "user")
        self.assertNotIn("{", user_msg["content"], "Unfilled placeholder found")
        self.assertNotIn("Existing story summary", user_msg["content"])
        self.assertIn("Chapter summaries", user_msg["content"])
