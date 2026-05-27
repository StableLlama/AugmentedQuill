# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Unit tests for inline scene marker helpers."""

from augmentedquill.services.scenes.scene_markers import (
    inject_markers,
    parse_scene_spans,
    remap_offset_after_marker_removal,
    remove_markers,
    snap_range_outside_markers,
    snap_offset_outside_markers,
    transfer_scene_markers,
    validate_scene_marker_tokens,
    validate_marker_only_edit,
)


def test_parse_scene_spans_extracts_start_end() -> None:
    text = "A <!--scene:1:start-->hello<!--scene:1:end--> Z"
    spans = parse_scene_spans(text)
    assert len(spans) == 1
    span = spans[0]
    assert span.scene_id == 1
    assert text[span.start : span.end] == "hello"


def test_inject_markers_wraps_ranges_in_order() -> None:
    text = "alpha beta gamma"
    output = inject_markers(text, [(1, 0, 5), (2, 6, 10)])
    assert "<!--scene:1:start-->" in output
    assert "<!--scene:1:end-->" in output
    assert "<!--scene:2:start-->" in output
    assert "<!--scene:2:end-->" in output


def test_remove_markers_strips_selected_scene_only() -> None:
    text = (
        "<!--scene:1:start-->A<!--scene:1:end-->"
        "<!--scene:2:start-->B<!--scene:2:end-->"
    )
    cleaned = remove_markers(text, {1})
    assert cleaned == "A<!--scene:2:start-->B<!--scene:2:end-->"


def test_validate_marker_only_edit_accepts_marker_changes() -> None:
    original = "hello world"
    edited = "<!--scene:1:start-->hello world<!--scene:1:end-->"
    validate_marker_only_edit(original, edited)


def test_validate_marker_only_edit_rejects_prose_changes() -> None:
    original = "hello world"
    edited = "<!--scene:1:start-->hello brave world<!--scene:1:end-->"
    try:
        validate_marker_only_edit(original, edited)
    except ValueError:
        return
    raise AssertionError("Expected validate_marker_only_edit to raise ValueError")


def test_remap_offset_after_marker_removal_subtracts_removed_marker_lengths() -> None:
    text = (
        "<!--scene:1:start-->A<!--scene:1:end-->"
        "<!--scene:2:start-->B<!--scene:2:end-->"
        " tail"
    )
    raw_offset = text.index(" tail")
    remapped = remap_offset_after_marker_removal(text, raw_offset, {2})
    assert remapped == raw_offset - len("<!--scene:2:start--><!--scene:2:end-->")


def test_transfer_scene_markers_projects_existing_spans_to_rewritten_text() -> None:
    existing = (
        "<!--scene:1:start-->Alpha<!--scene:1:end--> "
        "<!--scene:2:start-->Beta<!--scene:2:end-->"
    )
    rewritten = "One two three four five six"
    transferred = transfer_scene_markers(existing, rewritten)
    spans = parse_scene_spans(transferred)
    assert len(spans) == 2
    assert "<!--scene:1:start-->" in transferred
    assert "<!--scene:2:start-->" in transferred


def test_transfer_scene_markers_keeps_rewritten_markers_when_already_present() -> None:
    existing = "<!--scene:1:start-->Alpha<!--scene:1:end-->"
    rewritten = "<!--scene:1:start-->Omega<!--scene:1:end-->"
    assert transfer_scene_markers(existing, rewritten) == rewritten


def test_inject_markers_keeps_adjacent_boundaries_as_separate_comments() -> None:
    text = "First paragraph.\n\nSecond paragraph."
    output = inject_markers(
        text,
        [
            (1, 0, 17),
            (2, 17, len(text)),
        ],
    )
    assert "<!--scene:1:end--><!--scene:2:start-->" in output
    assert "<!--scene:2:start-<!--scene:1:end-->->" not in output


def test_validate_scene_marker_tokens_rejects_malformed_marker_fragments() -> None:
    malformed = "<!--scene:11:end-<!--scene:11:start-->-<!--scene:11:end-->"
    try:
        validate_scene_marker_tokens(malformed)
    except ValueError:
        return
    raise AssertionError("Expected malformed scene marker token to raise ValueError")


def test_snap_offset_outside_markers_moves_inside_offset_to_marker_end() -> None:
    text = "<!--scene:1:start-->Alpha<!--scene:1:end-->"
    marker_start = text.index("<!--scene:1:start-->")
    marker_inside = marker_start + 5
    marker_end = marker_start + len("<!--scene:1:start-->")
    assert snap_offset_outside_markers(text, marker_inside) == marker_end


def test_snap_range_outside_markers_moves_marker_overlapping_range() -> None:
    text = "<!--scene:1:start-->Alpha<!--scene:1:end-->"
    start, end = snap_range_outside_markers(text, 0, 1)
    marker_end = text.index("<!--scene:1:start-->") + len("<!--scene:1:start-->")
    assert start >= marker_end
    assert end > start


def test_snap_range_outside_markers_in_marker_only_content_returns_empty_boundary() -> (
    None
):
    text = "<!--scene:1:start--><!--scene:1:end-->"
    marker_end_start = text.index("<!--scene:1:end-->")
    start, end = snap_range_outside_markers(
        text,
        marker_end_start,
        marker_end_start + 1,
    )
    assert (start, end) == (len(text), len(text))
