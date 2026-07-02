# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Unit tests for inline scene marker helpers."""

from augmentedquill.services.scenes.scene_markers import (
    annotation_block_bounds,
    annotation_marker_token,
    inject_annotation_markers,
    remove_annotation_markers,
    parse_annotation_spans,
    find_scene_marker_span,
    inject_markers,
    parse_scene_spans,
    remap_offset_after_marker_removal,
    remove_markers,
    scene_block_bounds,
    snap_range_outside_markers,
    snap_offset_outside_markers,
    transfer_scene_markers,
    validate_internal_marker_tokens,
    validate_internal_marker_only_edit,
    validate_marker_integrity,
    validate_scene_marker_tokens,
    validate_marker_only_edit,
)
from augmentedquill.updates.migrate_story_v9 import migrate_project_v9


def test_parse_scene_spans_extracts_start_end() -> None:
    text = "A <!--scene:1:start-->hello<!--scene:1:end--> Z"
    spans = parse_scene_spans(text)
    assert len(spans) == 1
    span = spans[0]
    assert span.scene_id == 1
    assert text[span.start : span.end] == "hello"


def test_find_scene_marker_span_returns_matching_scene_only() -> None:
    text = (
        "<!--scene:2:start-->two<!--scene:2:end--> "
        "<!--scene:7:start-->seven<!--scene:7:end-->"
    )
    span = find_scene_marker_span(text, 7)
    assert span is not None
    assert span.scene_id == 7
    assert text[span.start : span.end] == "seven"


def test_scene_block_bounds_returns_marker_inclusive_range() -> None:
    text = "pre <!--scene:12:start-->alpha<!--scene:12:end--> post"
    bounds = scene_block_bounds(text, 12)
    assert bounds is not None
    start, end = bounds
    assert text[start:end] == "<!--scene:12:start-->alpha<!--scene:12:end-->"


def test_parse_annotation_spans_extracts_start_end() -> None:
    text = "X <!--annotation:note-7:start-->comment<!--annotation:note-7:end--> Y"
    spans = parse_annotation_spans(text)
    assert len(spans) == 1
    span = spans[0]
    assert span.annotation_id == "note-7"
    assert text[span.start : span.end] == "comment"


def test_annotation_block_bounds_returns_marker_inclusive_range() -> None:
    text = "pre <!--annotation:note-12:start-->alpha<!--annotation:note-12:end--> post"
    bounds = annotation_block_bounds(text, "note-12")
    assert bounds is not None
    start, end = bounds
    assert text[start:end] == (
        "<!--annotation:note-12:start-->alpha<!--annotation:note-12:end-->"
    )


def test_annotation_marker_token_constructs_canonical_tokens() -> None:
    assert (
        annotation_marker_token("note-1", "start") == "<!--annotation:note-1:start-->"
    )


def test_inject_annotation_markers_wraps_ranges_in_order() -> None:
    text = "alpha beta gamma"
    output = inject_annotation_markers(text, [("a1", 0, 5), ("a2", 6, 10)])
    assert "<!--annotation:a1:start-->" in output
    assert "<!--annotation:a1:end-->" in output
    assert "<!--annotation:a2:start-->" in output
    assert "<!--annotation:a2:end-->" in output


def test_remove_annotation_markers_strips_selected_annotation_only() -> None:
    text = (
        "<!--annotation:a1:start-->A<!--annotation:a1:end-->"
        "<!--annotation:a2:start-->B<!--annotation:a2:end-->"
    )
    cleaned = remove_annotation_markers(text, {"a1"})
    assert cleaned == "A<!--annotation:a2:start-->B<!--annotation:a2:end-->"


def test_validate_internal_marker_only_edit_accepts_annotation_changes() -> None:
    original = "hello world"
    edited = "<!--annotation:note-1:start-->hello world<!--annotation:note-1:end-->"
    validate_internal_marker_only_edit(original, edited)


def test_validate_internal_marker_only_edit_rejects_prose_changes() -> None:
    original = "hello world"
    edited = (
        "<!--annotation:note-1:start-->hello brave world<!--annotation:note-1:end-->"
    )
    try:
        validate_internal_marker_only_edit(original, edited)
    except ValueError:
        return
    raise AssertionError(
        "Expected validate_internal_marker_only_edit to raise ValueError"
    )


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


def test_validate_internal_marker_tokens_accepts_annotation_tokens() -> None:
    valid = "<!--annotation:note-1:start-->A<!--annotation:note-1:end-->"
    validate_internal_marker_tokens(valid)


def test_validate_internal_marker_tokens_rejects_malformed_annotation() -> None:
    malformed = "<!--annotation:note-1:middle-->"
    try:
        validate_internal_marker_tokens(malformed)
    except ValueError:
        return
    raise AssertionError(
        "Expected malformed annotation marker token to raise ValueError"
    )


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


def test_migrate_project_v9_initializes_annotations_collection(tmp_path) -> None:
    story_path = tmp_path / "story.json"
    story_path.write_text(
        "{"
        '"metadata": {"version": 8},'
        '"project_title": "Test",'
        '"format": "markdown"'
        "}",
        encoding="utf-8",
    )

    migrate_project_v9(tmp_path)

    migrated = story_path.read_text(encoding="utf-8")
    assert '"version": 9' in migrated
    assert '"annotations": []' in migrated


def test_parse_annotation_spans_with_scene_markers_inside_annotation() -> None:
    """Annotation spanning across scene markers includes them in the span."""
    text = (
        "pre <!--annotation:ann-1:start-->"
        "annotated text "
        "<!--scene:3:end--><!--scene:5:start-->"
        "more annotated text"
        "<!--annotation:ann-1:end--> post"
    )
    spans = parse_annotation_spans(text)
    assert len(spans) == 1
    span = spans[0]
    assert span.annotation_id == "ann-1"
    assert text[span.start : span.end] == (
        "annotated text " "<!--scene:3:end--><!--scene:5:start-->" "more annotated text"
    )
    assert text[span.start] == "a"
    assert text[span.end : span.end + 15] == "<!--annotation:"


def test_parse_annotation_spans_with_scene_markers_inside_annotation_offsets_are_correct() -> (
    None
):
    """Verify numerical offsets for a cross-scene annotation."""
    text = (
        "pre <!--annotation:ann-1:start-->"
        "annotated text "
        "<!--scene:3:end--><!--scene:5:start-->"
        "more annotated text"
        "<!--annotation:ann-1:end--> post"
    )
    spans = parse_annotation_spans(text)
    assert len(spans) == 1
    span = spans[0]

    start_marker = "<!--annotation:ann-1:start-->"
    end_marker = "<!--annotation:ann-1:end-->"
    sm_pos = text.find(start_marker)
    em_pos = text.find(end_marker)

    # start_offset should be exactly after the start marker
    assert span.start == sm_pos + len(start_marker)
    # end_offset should be exactly at the end marker
    assert span.end == em_pos


# ─── validate_marker_integrity: the generalized fail-safe gate ─────────────


def test_validate_marker_integrity_accepts_well_formed_scene_and_annotation() -> None:
    text = (
        "<!--scene:1:start-->Hello <!--annotation:a1:start-->World"
        "<!--annotation:a1:end--><!--scene:1:end-->"
    )
    validate_marker_integrity(text)  # must not raise


def test_validate_marker_integrity_accepts_overlapping_annotations() -> None:
    """Annotations are non-exclusive: any number may overlap."""
    text = (
        "<!--annotation:a1:start-->Hello "
        "<!--annotation:a2:start-->World<!--annotation:a1:end-->"
        "<!--annotation:a2:end-->"
    )
    validate_marker_integrity(text)  # must not raise


def test_validate_marker_integrity_accepts_annotation_straddling_scene_boundary() -> (
    None
):
    text = (
        "<!--scene:1:start-->"
        "<!--annotation:a1:start-->Hello <!--scene:1:end-->"
        "<!--scene:2:start-->World<!--annotation:a1:end-->"
        "<!--scene:2:end-->"
    )
    validate_marker_integrity(text)  # must not raise


def test_validate_marker_integrity_rejects_overlapping_scenes() -> None:
    """Scenes are exclusive: any part of the prose belongs to at most one."""
    text = (
        "<!--scene:1:start-->Alpha<!--scene:2:start-->Bravo"
        "<!--scene:1:end-->Charlie<!--scene:2:end-->"
    )
    try:
        validate_marker_integrity(text)
    except ValueError:
        return
    raise AssertionError("Expected overlapping scene spans to raise ValueError")


def test_validate_marker_integrity_rejects_unclosed_start_marker() -> None:
    try:
        validate_marker_integrity("<!--scene:1:start-->Hello")
    except ValueError:
        return
    raise AssertionError("Expected unclosed scene start marker to raise ValueError")


def test_validate_marker_integrity_rejects_orphaned_end_marker() -> None:
    try:
        validate_marker_integrity("Hello<!--scene:1:end-->")
    except ValueError:
        return
    raise AssertionError("Expected orphaned scene end marker to raise ValueError")


def test_validate_marker_integrity_allows_scenes_touching_at_shared_boundary() -> None:
    """Adjacent, non-overlapping scenes (end of one = start of next) are fine."""
    text = (
        "<!--scene:1:start-->Alpha<!--scene:1:end-->"
        "<!--scene:2:start-->Bravo<!--scene:2:end-->"
    )
    validate_marker_integrity(text)  # must not raise


def test_inject_markers_rejects_result_overlapping_a_pre_existing_scene() -> None:
    """inject_markers is fail-closed against existing markers, not just the
    new assignment list: an assignment that overlaps a scene marker already
    present in *content* must be rejected, even though the assignment list
    itself has only one entry."""
    content = "<!--scene:1:start-->Alpha<!--scene:1:end-->Bravo"
    try:
        # New scene 2 overlaps scene 1's existing span (starts inside it).
        inject_markers(content, [(2, 5, 10)])
    except ValueError:
        return
    raise AssertionError("Expected overlap with pre-existing scene to raise ValueError")


def test_inject_annotation_markers_rejects_malformed_result() -> None:
    """inject_annotation_markers must reject content that already contains a
    malformed (unclosed) marker elsewhere, rather than silently returning it."""
    content = "<!--scene:1:start-->Hello World"  # unclosed scene start marker
    try:
        # Annotate "World" — unrelated to the pre-existing malformed marker.
        inject_annotation_markers(content, [("a1", 27, 32)])
    except ValueError:
        return
    raise AssertionError("Expected malformed pre-existing markers to raise ValueError")
