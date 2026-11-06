# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Property-style tests for the canonical prose-span library.

Every offset-sensitive marker helper is exercised against *generated* documents
(deterministic seeds) instead of a handful of hand-written fixtures: many
scenes, zero-width spans, adjacent boundaries, annotations, unicode text.

The invariants asserted here are the ones whose violation produced the real
off-by-N bugs (a scene whose prose/highlight ended before or after the text):

- ``content[span.start:span.end]`` is exactly the prose assigned to the scene;
- scene spans are ordered and never overlap or nest;
- stripping markers removes exactly the marker bytes and nothing else;
- the visible<->raw offset map round-trips character by character;
- marker transfer/reinjection preserves every scene and the visible prose.
"""

import itertools
import random

import pytest

from augmentedquill.services.scenes.scene_markers import (
    assert_scene_spans_consistent,
    find_scene_marker_span,
    inject_annotation_markers,
    inject_markers,
    parse_annotation_spans,
    parse_scene_spans,
    remap_offset_after_marker_removal,
    remove_annotation_markers,
    remove_markers,
    strip_internal_markers,
    transfer_scene_markers,
    visible_offset_map,
)

_UNICODE_WORDS = ("naïve", "café", "“quoted”", "—dash", "Zürich", "a", "bb")


def _random_prose(rng: random.Random, words: int) -> str:
    """Return deterministic random prose with unicode, punctuation and newlines."""
    parts: list[str] = []
    for index in range(words):
        parts.append(rng.choice(_UNICODE_WORDS))
        if index % 7 == 6:
            parts.append("\n\n")
        else:
            parts.append(" ")
    return "".join(parts).strip()


def _random_partition(rng: random.Random, text: str) -> list[tuple[int, int]]:
    """Split *text* into ordered, adjacent (possibly zero-width) ranges."""
    scene_count = rng.randint(1, 6)
    cuts = sorted(rng.randint(0, len(text)) for _ in range(scene_count - 1))
    bounds = [0, *cuts, len(text)]
    ranges: list[tuple[int, int]] = []
    for start, end in itertools.pairwise(bounds):
        ranges.append((start, end))
        # Occasionally emit an extra emptied (zero-width) scene at the cut.
        if rng.random() < 0.2:
            ranges.append((end, end))
    return ranges


def _build_document(
    rng: random.Random,
) -> tuple[str, str, list[tuple[int, int, int]]]:
    """Return ``(marker_content, plain_prose, assignments)`` for one random case."""
    prose = _random_prose(rng, rng.randint(1, 40))
    ranges = _random_partition(rng, prose)
    assignments = [
        (scene_id + 1, start, end) for scene_id, (start, end) in enumerate(ranges)
    ]
    content = inject_markers(prose, assignments)
    return content, prose, assignments


@pytest.mark.parametrize("seed", range(200))
def test_injected_scene_spans_cover_exactly_the_generated_prose(seed: int) -> None:
    rng = random.Random(seed)
    content, prose, assignments = _build_document(rng)

    assert_scene_spans_consistent(content)

    spans = {span.scene_id: span for span in parse_scene_spans(content)}
    assert sorted(spans) == [scene_id for scene_id, _, _ in assignments]
    for scene_id, start, end in assignments:
        span = spans[scene_id]
        assert content[span.start : span.end] == prose[start:end]
        assert find_scene_marker_span(content, scene_id) == span

    # Markers are the only thing stripping removes.
    visible = strip_internal_markers(content)
    assert visible == prose

    offsets = visible_offset_map(content)
    assert offsets[-1] == len(content)
    for index, char in enumerate(visible):
        assert content[offsets[index]] == char


@pytest.mark.parametrize("seed", range(200))
def test_annotations_never_shift_scene_spans(seed: int) -> None:
    rng = random.Random(seed)
    content, prose, assignments = _build_document(rng)
    visible_len = len(prose)
    if visible_len == 0:
        return
    offsets = visible_offset_map(content)

    annotation_assignments: list[tuple[str, int, int]] = []
    for annotation_index in range(rng.randint(1, 4)):
        start = rng.randint(0, visible_len - 1)
        end = rng.randint(start + 1, visible_len)
        annotation_assignments.append(
            (f"ann-{annotation_index}", offsets[start], offsets[end])
        )
    annotated = inject_annotation_markers(content, annotation_assignments)

    assert_scene_spans_consistent(annotated)
    assert strip_internal_markers(annotated) == prose

    spans = {span.scene_id: span for span in parse_scene_spans(annotated)}
    for scene_id, start, end in assignments:
        assert strip_internal_markers(
            annotated[spans[scene_id].start : spans[scene_id].end]
        ) == (prose[start:end])

    # Removing annotations restores the exact scene content.
    assert remove_annotation_markers(annotated) == content
    assert parse_annotation_spans(annotated)


@pytest.mark.parametrize("seed", range(200))
def test_reinjecting_remapped_spans_keeps_the_same_scene_text(seed: int) -> None:
    rng = random.Random(seed)
    content, prose, assignments = _build_document(rng)

    plain = remove_markers(content)
    assert plain == prose

    source_spans = {span.scene_id: span for span in parse_scene_spans(content)}
    remapped = [
        (
            scene_id,
            remap_offset_after_marker_removal(
                content, source_spans[scene_id].start, None
            ),
            remap_offset_after_marker_removal(
                content, source_spans[scene_id].end, None
            ),
        )
        for scene_id, _, _ in assignments
    ]
    rebuilt = inject_markers(plain, remapped)

    assert_scene_spans_consistent(rebuilt)
    assert strip_internal_markers(rebuilt) == prose
    rebuilt_spans = {span.scene_id: span for span in parse_scene_spans(rebuilt)}
    for scene_id, start, end in assignments:
        span = rebuilt_spans[scene_id]
        assert rebuilt[span.start : span.end] == prose[start:end]


@pytest.mark.parametrize("seed", range(100))
def test_transfer_scene_markers_keeps_every_scene(seed: int) -> None:
    rng = random.Random(seed)
    old_content, _old_prose, assignments = _build_document(rng)
    new_prose = _random_prose(rng, rng.randint(1, 40))

    transferred = transfer_scene_markers(old_content, new_prose)

    spans = parse_scene_spans(transferred)
    assert sorted(span.scene_id for span in spans) == sorted(
        scene_id for scene_id, _, _ in assignments
    )
    assert strip_internal_markers(transferred) == new_prose
    # Boundaries may be projected onto a new text, but they must stay ordered
    # and exclusive; otherwise scenes silently share prose.
    assert_scene_spans_consistent(transferred)


def test_assert_scene_spans_consistent_rejects_nested_markers() -> None:
    content = (
        "<!--scene:1:start-->outer "
        "<!--scene:2:start-->inner<!--scene:2:end-->"
        "<!--scene:1:end-->"
    )
    with pytest.raises(ValueError):
        assert_scene_spans_consistent(content)


def test_assert_scene_spans_consistent_rejects_orphaned_tokens() -> None:
    with pytest.raises(ValueError):
        assert_scene_spans_consistent("prose<!--scene:1:end-->prose")
