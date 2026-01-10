import re
from typing import List, Dict


class ChannelFilter:
    """Stateful filter to separate thinking/analysis from final content."""

    def __init__(self):
        self.current_channel = "final"
        self.buffer = ""
        # Combined pattern for all tags we care about
        self.tag_pattern = re.compile(
            r"(<\|channel\|>(.*?)<\|message\|>|"
            r"<\|start\|>assistant.*?<\|message\|>|"
            r"<\|end\|>|"
            r"<(thought|thinking)>|"
            r"</(thought|thinking)>)",
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
                first_bracket = self.buffer.find("<")
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

                # Now the buffer starts with '<' (or is empty).
                # If it's getting too long, it's probably not a tag we recognize.
                if len(self.buffer) > 150:
                    # Yield everything up to the next bracket or everything if no more brackets.
                    next_bracket = self.buffer.find("<", 1)
                    if next_bracket != -1:
                        results.append(
                            {
                                "channel": self.current_channel,
                                "content": self.buffer[:next_bracket],
                            }
                        )
                        self.buffer = self.buffer[next_bracket:]
                    else:
                        results.append(
                            {"channel": self.current_channel, "content": self.buffer}
                        )
                        self.buffer = ""
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

                # Update channel logic based on tag
                # Check for opening thought tags
                if re.match(r"<(thought|thinking)>", tag_text, re.IGNORECASE):
                    self.current_channel = "thought"
                # Check for closing thought tags
                elif re.match(r"</(thought|thinking)>", tag_text, re.IGNORECASE):
                    self.current_channel = "final"
                # Check for special channel tags
                elif tag_text.startswith("<|channel|>"):
                    # Extract channel name
                    # Group 2 captures the channel name inside <|channel|>...<|message|>
                    # But wait, the regex is ( ... )
                    # Group 1 is the whole match. Group 2 is (.*?) inside.
                    channel_name = match.group(2)
                    if channel_name:
                        # Normalize or use as is. Usually 'thought' or 'final'
                        self.current_channel = channel_name.strip()
                elif "<|message|>" in tag_text:
                    # This might be part of the channel tag, handled above or just switching context
                    # If we just switch to message, usually implies back to main/final logic unless specialized
                    pass
                elif "<|end|>" in tag_text:
                    # End of turn, reset?
                    self.current_channel = "final"

                # Advance buffer past the tag
                self.buffer = self.buffer[end:]

        return results
