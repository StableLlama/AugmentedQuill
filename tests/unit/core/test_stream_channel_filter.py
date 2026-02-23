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


if __name__ == "__main__":
    unittest.main()
