# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test stream channel filter unit so this responsibility stays isolated, testable, and easy to evolve."""

import unittest

from augmentedquill.utils.stream_helpers import ChannelFilter


class TestChannelFilter(unittest.TestCase):
    def test_tool_call_xml_tags_json_content(self):
        """Test that <tool_call> tags switch the channel correctly, prevention leakage."""
        cf = ChannelFilter()

        # Simulate a stream of chunks
        # Chunk 1: Normal text
        res1 = cf.feed("Sure, I will do that.\n")
        self.assertEqual(len(res1), 1)
        self.assertEqual(res1[0]["channel"], "final")
        self.assertEqual(res1[0]["content"], "Sure, I will do that.\n")

        # Chunk 2: Opening tag
        cf.feed("<tool_call>")
        # The tag itself is consumed and triggers channel switch.
        # It shouldn't produce content if it matched perfectly.
        self.assertEqual(cf.current_channel, "tool_def")

        # Chunk 3: JSON Content
        json_content = '\n{"name": "create_image_placeholder", "arguments": {"description": "A scene."}}\n'
        res3 = cf.feed(json_content)
        self.assertEqual(len(res3), 1)
        self.assertEqual(res3[0]["channel"], "tool_def")  # MUST be tool_def, not final
        self.assertEqual(res3[0]["content"], json_content)

        # Chunk 4: Closing tag
        cf.feed("</tool_call>")
        self.assertEqual(cf.current_channel, "final")

        # Chunk 5: Content after
        res5 = cf.feed("\nDone.")
        self.assertEqual(len(res5), 1)
        self.assertEqual(res5[0]["channel"], "final")

    def test_tool_call_gemini_wrapper_tags(self):
        """Test Gemini-style <|tool_call> wrappers change the channel correctly."""
        cf = ChannelFilter()

        res1 = cf.feed("Something before.\n")
        self.assertEqual(res1[0]["channel"], "final")

        cf.feed("<|tool_call>")
        self.assertEqual(cf.current_channel, "tool_def")

        res3 = cf.feed('call:search_sourcebook{"query":"Clara"}')
        self.assertEqual(len(res3), 1)
        self.assertEqual(res3[0]["channel"], "tool_def")
        self.assertEqual(res3[0]["content"], 'call:search_sourcebook{"query":"Clara"}')

        cf.feed("<|tool_call|>")
        self.assertEqual(cf.current_channel, "final")

        res4 = cf.feed("\nFinished.")
        self.assertEqual(res4[0]["channel"], "final")

    def test_tool_call_xml_tags_partial_feed(self):
        """Test split chunks handling for xml tags."""
        cf = ChannelFilter()

        # Feed partial tag
        res = cf.feed("<tool_")
        self.assertEqual(len(res), 0)  # Should buffer

        # Finish tag
        res = cf.feed("call>")
        self.assertEqual(cf.current_channel, "tool_def")

        # Feed content
        res = cf.feed('{"a":1}')
        self.assertEqual(res[0]["channel"], "tool_def")

        # Close tag split
        cf.feed("</tool")
        cf.feed("_call>")
        self.assertEqual(cf.current_channel, "final")

    def test_flush_returns_buffered_content(self):
        cf = ChannelFilter()
        cf.feed("<tool")
        flushed = cf.flush()
        self.assertEqual(flushed, [{"channel": "final", "content": "<tool"}])
        self.assertEqual(cf.flush(), [])

    def test_pathological_buffer_degrades_to_progress(self):
        cf = ChannelFilter()
        # Starts with an unmatched tag-like prefix that should trigger fallback
        # progress logic once the internal buffer grows beyond the guard threshold.
        chunk = "<" + ("x" * 180)
        out = cf.feed(chunk)
        self.assertGreaterEqual(len(out), 1)
        self.assertEqual(out[0]["channel"], "final")
        self.assertEqual(out[0]["content"], "<")

    def test_malformed_channel_headers_are_consumed_without_switching_to_reasoning(
        self,
    ):
        cf = ChannelFilter()

        # Reasoning marker in malformed paired-header format should be consumed
        # without yielding marker text and without switching away from final.
        out1 = cf.feed("<|channel>thought\n<channel|>")
        self.assertEqual(out1, [])
        self.assertEqual(cf.current_channel, "final")

        # Final marker in same malformed format remains harmless.
        out2 = cf.feed("<|channel>final\n<channel|>")
        self.assertEqual(out2, [])
        self.assertEqual(cf.current_channel, "final")

        out3 = cf.feed("Visible now")
        self.assertEqual(out3, [{"channel": "final", "content": "Visible now"}])

    def test_split_malformed_channel_header_does_not_block_final_streaming(self):
        cf = ChannelFilter()

        # Split malformed tag across chunks, then ensure final prose streams
        # immediately (without waiting for flush/end).
        self.assertEqual(cf.feed("<|channel>fin"), [])
        self.assertEqual(cf.feed("al\n<channel|>"), [])
        out = cf.feed("Hello")
        self.assertEqual(out, [{"channel": "final", "content": "Hello"}])


if __name__ == "__main__":
    unittest.main()
