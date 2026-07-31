# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Unit tests for the JSON repair utility."""

import json

from augmentedquill.utils.json_repair import (
    apply_typographic_quotes,
    repair_json_quotes,
    try_parse_json_robust,
)


def test_apply_typographic_quotes_basic():
    assert apply_typographic_quotes('She said "Hello".') == "She said “Hello”."


def test_repair_json_no_change_valid():
    """Ensure valid JSON is untouched."""
    valid = '{"text": "This is a valid string."}'
    assert repair_json_quotes(valid) == valid


def test_repair_json_unescaped_quotes_into_typographic():
    """Ensure unescaped quotes inside a value are converted to typographic ones."""
    # Input with unescaped nested quotes
    case = '{"text": "He said "Hello" to me"}'
    repaired = repair_json_quotes(case)

    # Check if it parses now
    parsed = json.loads(repaired)
    assert parsed["text"] == "He said “Hello” to me"


def test_repair_json_multiple_unescaped_quotes():
    """Ensure multiple unescaped quotes are handled correctly."""
    case = '{"notes": "Quote 1: "First", Quote 2: "Second""}'
    repaired = repair_json_quotes(case)

    parsed = json.loads(repaired)
    assert parsed["notes"] == "Quote 1: “First”, Quote 2: “Second”"


def test_try_parse_json_robust_success():
    """Ensure robust parsing works for broken JSON."""
    case = '{"summary": "A "tricky" summary with trailing text", "id": 1}'
    parsed = try_parse_json_robust(case)

    assert parsed["summary"] == "A “tricky” summary with trailing text"
    assert parsed["id"] == 1


def test_repair_json_uses_language_specific_quotes():
    """Quotes should adapt to the given language from instructions.json."""
    case = '{"text": "He said "Hello" to me"}'
    repaired = repair_json_quotes(case, language="de")

    parsed = json.loads(repaired)
    assert parsed["text"] == "He said „Hello“ to me"


def test_try_parse_json_robust_existing_escaped():
    """Ensure already escaped quotes are preserved and not double-processed in a way that breaks them."""
    # The regex (?<!\\)" handles this.
    case = '{"text": "An \\"escaped\\" quote and an "unescaped" one"}'
    repaired = repair_json_quotes(case)

    # The escaped one should stay, the unescaped should become typographic
    parsed = json.loads(repaired)
    # Note: json.loads removes the backslash used for escaping in the string literal
    assert parsed["text"] == 'An "escaped" quote and an “unescaped” one'


def test_repair_json_multiline():
    """Ensure it works across multiple lines."""
    case = '{\n  "prose": "Line one "quoted"\nLine two"\n}'
    repaired = repair_json_quotes(case)

    parsed = json.loads(repaired)
    assert "Line one “quoted”" in parsed["prose"]
