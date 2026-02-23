# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the stream helpers unit so this responsibility stays isolated, testable, and easy to evolve.

Utility functions for handling server-sent events (SSE) and data streaming.
Includes stateful filtering for multi-channel LLM output.
"""

import re
from typing import List, Dict


class ChannelFilter:
    """Stateful filter to separate thinking/analysis from final content."""

    def __init__(self):
        """Init  ."""
        self.current_channel = "final"
        self.buffer = ""
        # Combined pattern for all tags we care about
        self.tag_pattern = re.compile(
            r"(<\|channel\|>(.*?)<\|message\|>|"
            r"<\|start\|>assistant.*?<\|message\|>|"
            r"<\|end\|>|"
            r"<(thought|thinking)>|"
            r"</(thought|thinking)>|"
            r"\[TOOL_CALL\]\s*|"
            r"\s*\[/TOOL_CALL\]|"
            r"<tool_call>|"
            r"</tool_call>)",
            re.IGNORECASE | re.DOTALL,
        )

    def feed(self, chunk: str) -> List[Dict[str, str]]:
        """Process a chunk and return a list of (channel, content) pairs."""
        self.buffer += chunk
        results = []

        while True:
            match = self.tag_pattern.search(self.buffer)
            if not match:
                # No complete tag found.
                # We should yield everything that is definitely not part of a tag.
                # Tags start with '<'.
                check_chars = ["<", "["]
                first_bracket = -1
                for char in check_chars:
                    idx = self.buffer.find(char)
                    if idx != -1:
                        if first_bracket == -1 or idx < first_bracket:
                            first_bracket = idx

                if first_bracket == -1:
                    # No bracket at all, safe to yield everything
                    if self.buffer:
                        results.append(
                            {"channel": self.current_channel, "content": self.buffer}
                        )
                        self.buffer = ""
                elif first_bracket > 0:
                    # Yield everything before the first bracket
                    results.append(
                        {
                            "channel": self.current_channel,
                            "content": self.buffer[:first_bracket],
                        }
                    )
                    self.buffer = self.buffer[first_bracket:]

                # Now the buffer starts with '<' or '[' (or is empty).
                # Guard against pathological buffers by degrading to character
                # passthrough when no recognizable tag is forming.
                if len(self.buffer) > 150:
                    # Emit a single character to keep progress monotonic and
                    # prevent unbounded buffering.
                    results.append(
                        {"channel": self.current_channel, "content": self.buffer[0]}
                    )
                    self.buffer = self.buffer[1:]
                break
            else:
                # Yield content before the tag
                start, end = match.span()
                if start > 0:
                    content = self.buffer[:start]
                    results.append(
                        {"channel": self.current_channel, "content": content}
                    )

                # Process the tag
                tag_text = match.group(0)

                # Update output channel according to control tags.
                if re.match(r"<(thought|thinking)>", tag_text, re.IGNORECASE):
                    self.current_channel = "thought"
                elif re.match(r"</(thought|thinking)>", tag_text, re.IGNORECASE):
                    self.current_channel = "final"
                elif re.match(r"\[TOOL_CALL\]\s*|<tool_call>", tag_text, re.IGNORECASE):
                    self.current_channel = "tool_def"
                elif re.match(r"\[/TOOL_CALL\]|</tool_call>", tag_text, re.IGNORECASE):
                    self.current_channel = "final"
                elif tag_text.startswith("<|channel|>"):
                    channel_name = match.group(2)
                    if channel_name:
                        if "<|constrain|>" in channel_name:
                            channel_name = channel_name.split("<|constrain|>", 1)[0]
                        self.current_channel = channel_name.strip()
                elif (
                    tag_text.startswith("<|start|>assistant")
                    and "<|channel|>" in tag_text
                ):
                    channel_name = tag_text.split("<|channel|>", 1)[1]
                    channel_name = channel_name.split("<|message|>", 1)[0]
                    if "<|constrain|>" in channel_name:
                        channel_name = channel_name.split("<|constrain|>", 1)[0]
                    self.current_channel = channel_name.strip()
                elif "<|message|>" in tag_text:
                    # Message boundaries without explicit channel changes do not
                    # require state transitions.
                    pass
                elif "<|end|>" in tag_text:
                    # End markers reset to final output as a safe default.
                    self.current_channel = "final"

                # Advance buffer past the tag
                self.buffer = self.buffer[end:]

        return results

    def flush(self) -> List[Dict[str, str]]:
        """Flush the buffer and return any remaining content."""
        results = []
        if self.buffer:
            results.append({"channel": self.current_channel, "content": self.buffer})
            self.buffer = ""
        return results
