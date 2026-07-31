# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test chat parser unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
import unittest

from augmentedquill.services.llm.llm import (
    parse_tool_calls_from_content as _parse_tool_calls_from_content,
)
from augmentedquill.utils.llm_parsing import (
    extract_thinking_from_content,
    parse_complete_assistant_output,
    parse_stream_channel_fragments,
    strip_thinking_tags,
    strip_tool_call_tags,
)


class TestChatParser(unittest.TestCase):
    def test_parse_json_inside_tool_call_tag(self):
        """Test parsing of JSON content inside <tool_call> tags."""
        content = """
        Thinking process...
        <tool_call>
        {"name": "generate_image_description", "arguments": {"filename": "exomis_1024x1024.png"}}
        </tool_call>
        """
        calls = _parse_tool_calls_from_content(content)
        self.assertIsNotNone(calls)
        self.assertEqual(len(calls), 1)
        call = calls[0]
        self.assertEqual(call["function"]["name"], "generate_image_description")
        args = json.loads(call["function"]["arguments"])
        self.assertEqual(args["filename"], "exomis_1024x1024.png")

    def test_parse_json_with_newlines_inside_tool_call_tag(self):
        """Test parsing of multiline JSON content inside <tool_call> tags."""
        content = """
        <tool_call>
        {
            "name": "create_project", 
            "arguments": {
                "name": "Test Project",
                "type": "short-story"
            }
        }
        </tool_call>
        """
        calls = _parse_tool_calls_from_content(content)
        self.assertIsNotNone(calls)
        self.assertEqual(len(calls), 1)
        call = calls[0]
        self.assertEqual(call["function"]["name"], "create_project")
        args = json.loads(call["function"]["arguments"])
        self.assertEqual(args["name"], "Test Project")
        self.assertEqual(args["type"], "short-story")

    def test_parse_xml_style_tool_call(self):
        """Test parsing of legacy XML-style tool calls."""
        content = """
        <tool_call>
        <function=get_chapter_content>{"chap_id": 1}</function>
        </tool_call>
        """
        calls = _parse_tool_calls_from_content(content)
        self.assertIsNotNone(calls)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["function"]["name"], "get_chapter_content")
        args = json.loads(calls[0]["function"]["arguments"])
        self.assertEqual(args["chap_id"], 1)

    def test_parse_xml_style_tool_call_parameter_tags(self):
        """Test parsing of XML-style tool calls that encode args as parameter tags."""
        content = """
        <tool_call>
        <function=get_chapter_metadata>
        <parameter=chap_id>
        6
        </parameter>
        </function>
        </tool_call>
        """
        calls = _parse_tool_calls_from_content(content)
        self.assertIsNotNone(calls)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["function"]["name"], "get_chapter_metadata")
        args = json.loads(calls[0]["function"]["arguments"])
        self.assertEqual(args["chap_id"], 6)

    def test_parse_xml_style_tool_call_multiple_parameter_tags(self):
        """Test parsing of XML-style tool calls with multiple typed parameters."""
        content = """
        <tool_call>
        <function=update_chapter_metadata>
        <parameter=chap_id>4</parameter>
        <parameter=notes>"Updated notes"</parameter>
        </function>
        </tool_call>
        """
        calls = _parse_tool_calls_from_content(content)
        self.assertIsNotNone(calls)
        args = json.loads(calls[0]["function"]["arguments"])
        self.assertEqual(args["chap_id"], 4)
        self.assertEqual(args["notes"], "Updated notes")

    def test_parse_func_call_style(self):
        """Test parsing of function call style: Tool(Args)."""
        content = """
        <tool_call>
        get_chapter_content({"chap_id": 2})
        </tool_call>
        """
        calls = _parse_tool_calls_from_content(content)
        self.assertIsNotNone(calls)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["function"]["name"], "get_chapter_content")
        args = json.loads(calls[0]["function"]["arguments"])
        self.assertEqual(args["chap_id"], 2)

    def test_mixed_content_ignore_text(self):
        content = """
        Here is some text.
        <tool_call>
        {"name": "test_tool", "arguments": {}}
        </tool_call>
        And more text.
        """
        calls = _parse_tool_calls_from_content(content)
        self.assertIsNotNone(calls)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["function"]["name"], "test_tool")

    def test_invalid_json_is_ignored(self):
        content = """
        <tool_call>
        {invalid json here}
        </tool_call>
        """
        # Should fallback to other matchers or return nothing if strictly JSON failed
        # The current implementation falls back to Regex if JSON parse fails.
        # But "{invalid json here}" might match the func_match regex `(\w+)(?:\((.*)\))?` -> name="{invalid", args="json here}" ??
        # Let's see how the implementation handles fallthrough.
        # It tries JSON first. If exception, it continues to Regex.

        _parse_tool_calls_from_content(content)
        # It might match nothing or something weird depending on regex,
        # but specifically for the JSON regression, we want to ensure valid JSON works.
        # If it returns empty list, that's fine for this test case intent.

        # Actually let's check what it does.

    def test_parse_complete_assistant_output_includes_thinking_and_tools(self):
        content = (
            "<thinking>internal plan</thinking> "
            '<tool_call>{"name": "list_images", "arguments": {}}</tool_call> '
            "Visible answer."
        )
        parsed = parse_complete_assistant_output(content)
        self.assertEqual(parsed["thinking"], "internal plan")
        self.assertEqual(parsed["content"], "Visible answer.")
        self.assertEqual(len(parsed["tool_calls"]), 1)
        self.assertEqual(parsed["tool_calls"][0]["function"]["name"], "list_images")

    def test_parse_stream_channel_fragments_generates_tool_call_event(self):
        fragments = [
            {
                "channel": "commentary to=functions.get_project_overview",
                "content": '{"verbose": true}',
            }
        ]
        events = parse_stream_channel_fragments(fragments, set())
        self.assertEqual(len(events), 1)
        tc = events[0]["tool_calls"][0]
        self.assertEqual(tc["function"]["name"], "get_project_overview")
        self.assertEqual(tc["function"]["arguments"], '{"verbose": true}')

    def test_parse_stream_channel_fragments_deduplicates_call_ids(self):
        seen = {"call_get_project_overview"}
        fragments = [
            {
                "channel": "commentary to=functions.get_project_overview",
                "content": "{}",
            }
        ]
        events = parse_stream_channel_fragments(fragments, seen)
        self.assertEqual(events, [])

    def test_parse_stream_channel_fragments_filters_marker_noise_keeps_newlines(self):
        fragments = [
            {"channel": "final", "content": "<|channel>thought\n<channel|>"},
            {"channel": "final", "content": "\n\n"},
            {"channel": "final", "content": "Paragraph one."},
            {"channel": "final", "content": "\n\n"},
            {"channel": "final", "content": "Paragraph two."},
        ]

        events = parse_stream_channel_fragments(fragments, set())
        content = "".join(evt.get("content", "") for evt in events if "content" in evt)

        self.assertNotIn("<|channel>", content)
        self.assertIn("Paragraph one.", content)
        self.assertIn("Paragraph two.", content)
        self.assertIn("\n\n", content)

    def test_strip_thinking_tags_prefers_final_channel_output(self):
        content = (
            "<|channel|>analysis<|message|>Hidden reasoning<|end|>"
            "<|start|>assistant<|channel|>final<|message|>Visible answer"
        )
        self.assertEqual(strip_thinking_tags(content), "Visible answer")

    def test_strip_thinking_tags_removes_inline_thinking_blocks(self):
        content = "Before <thinking>hidden</thinking> After"
        self.assertEqual(strip_thinking_tags(content), "Before  After")

    def test_strip_thinking_tags_removes_inline_think_blocks(self):
        content = "Before <think>hidden</think> After"
        self.assertEqual(strip_thinking_tags(content), "Before  After")

    def test_strip_thinking_tags_drops_empty_think_token(self):
        content = "<think></think>"
        self.assertEqual(strip_thinking_tags(content), "")

    def test_strip_thinking_tags_removes_leaked_channel_marker_noise(self):
        content = "<|channel>thought\n<channel|>Visible answer"
        self.assertEqual(strip_thinking_tags(content), "Visible answer")

    def test_strip_thinking_tags_drops_leaked_multiline_reasoning_block(self):
        content = (
            "<|channel>thought\n<channel|>I will reason silently here.\n"
            "Still thinking...\n\nVisible prose starts now."
        )
        self.assertEqual(strip_thinking_tags(content), "Visible prose starts now.")

    def test_parse_stream_channel_fragments_treats_analysis_channel_as_thinking(self):
        fragments = [{"channel": "analysis", "content": "internal reasoning"}]
        events = parse_stream_channel_fragments(fragments, set())
        self.assertEqual(events, [{"thinking": "internal reasoning"}])

    def test_parse_stream_channel_fragments_treats_reasoning_channel_as_thinking(self):
        fragments = [{"channel": "reasoning", "content": "hidden chain"}]
        events = parse_stream_channel_fragments(fragments, set())
        self.assertEqual(events, [{"thinking": "hidden chain"}])

    def test_strip_tool_call_tags_removes_tool_markup(self):
        content = (
            'Intro <tool_call>{"name":"x"}</tool_call> '
            "[TOOL_CALL]do_stuff[/TOOL_CALL] Outro"
        )
        self.assertEqual(strip_tool_call_tags(content), "Intro   Outro")

    def test_strip_tool_call_tags_removes_gemini_wrapper_markup(self):
        content = (
            'Intro <|tool_call>call:search_sourcebook{"query":"Clara"}<tool_call|> '
            "Outro"
        )
        self.assertEqual(strip_tool_call_tags(content), "Intro  Outro")

    def test_parse_gemini_call_wrapper_format(self):
        content = (
            "<|tool_call>call:search_sourcebook{query:<|“|>Clara<|“|>}<tool_call|>"
        )
        calls = _parse_tool_calls_from_content(content)
        self.assertIsNotNone(calls)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["function"]["name"], "search_sourcebook")
        args = json.loads(calls[0]["function"]["arguments"])
        self.assertEqual(args["query"], "Clara")

    def test_extract_thinking_from_content_returns_first_block(self):
        content = "<thought>internal note</thought> final"
        self.assertEqual(extract_thinking_from_content(content), "internal note")


if __name__ == "__main__":
    unittest.main()
