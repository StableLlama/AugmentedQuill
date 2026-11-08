# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Property-style tests for scene prose reordering.

Reordering moves whole marker blocks between positions.  The invariants
asserted here are the ones whose violation silently unlinks or loses prose:

- every scene keeps exactly its own prose payload;
- the visible text is unchanged (no bytes added, removed or reordered);
- scene spans stay ordered and non-overlapping (no nesting/overlap);
- the resulting marker order equals the requested move.

The cases are generated deterministically from seeds so failures are
reproducible, mirroring ``test_prose_span_properties.py``.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from augmentedquill.models.scene import (
    SceneCreateRequest,
    SceneLinkProseRequest,
    SceneReorderProseRequest,
)
from augmentedquill.services.scenes.scene_markers import (
    assert_scene_spans_consistent,
    parse_scene_spans,
    strip_internal_markers,
)
from augmentedquill.services.scenes.scene_service import (
    create_scene,
    link_prose,
    reorder_scene_prose,
)

_WORDS = (
    "alpha",
    "bravo",
    "charlie",
    "delta",
    "echo",
    "foxtrot",
    "golf",
    "hotel",
    "india",
    "juliet",
)


def _write_project(project_dir: Path) -> None:
    story = {
        "metadata": {"version": 2},
        "project_title": "Reorder property test",
        "project_type": "short-story",
        "format": "markdown",
        "scenes": {},
    }
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")


def _build_linked_project(
    project_dir: Path, rng: random.Random
) -> tuple[list[int], dict[int, str]]:
    """Create random scenes, each linked to its own unique prose block."""
    _write_project(project_dir)

    scene_count = rng.randint(2, 6)
    blocks: list[str] = []
    for index in range(scene_count):
        words = " ".join(rng.choice(_WORDS) for _ in range(rng.randint(1, 10)))
        blocks.append(f"{words} block{index}")

    content = "\n\n".join(blocks)
    (project_dir / "content.md").write_text(content, encoding="utf-8")

    scenes = [
        create_scene(project_dir, SceneCreateRequest(summary=f"Scene {index}"))
        for index in range(scene_count)
    ]

    ranges: list[tuple[int, int]] = []
    cursor = 0
    for block in blocks:
        start = content.index(block, cursor)
        end = start + len(block)
        ranges.append((start, end))
        cursor = end

    # Link back-to-front so earlier offsets stay valid while markers are added.
    for scene, (start, end) in reversed(list(zip(scenes, ranges))):
        link_prose(
            project_dir,
            scene["id"],
            SceneLinkProseRequest(
                scope_type="story",
                chapter_id=None,
                book_id=None,
                start_offset=start,
                end_offset=end,
            ),
        )

    return [int(scene["id"]) for scene in scenes], {
        int(scene["id"]): block for scene, block in zip(scenes, blocks)
    }


def _expected_order(
    initial_order: list[int], source_id: int, target_id: int, place_before: bool
) -> list[int]:
    expected = [scene_id for scene_id in initial_order if scene_id != source_id]
    target_index = expected.index(target_id)
    expected.insert(target_index if place_before else target_index + 1, source_id)
    return expected


def test_reorder_preserves_payloads_and_marker_order(tmp_path: Path) -> None:
    for seed in range(12):
        rng = random.Random(seed)
        project_dir = tmp_path / f"seed-{seed}"
        project_dir.mkdir()
        scene_ids, payloads = _build_linked_project(project_dir, rng)

        content_path = project_dir / "content.md"
        before = content_path.read_text(encoding="utf-8")
        assert_scene_spans_consistent(before)
        assert [span.scene_id for span in parse_scene_spans(before)] == scene_ids

        source_id, target_id = rng.sample(scene_ids, 2)
        place_before = rng.choice([True, False])

        reorder_scene_prose(
            project_dir,
            SceneReorderProseRequest(
                source_scene_id=source_id,
                target_scene_id=target_id,
                place_before=place_before,
            ),
        )

        after = content_path.read_text(encoding="utf-8")
        assert_scene_spans_consistent(after)

        expected_scene_order = _expected_order(
            scene_ids, source_id, target_id, place_before
        )
        spans_after = parse_scene_spans(after)
        assert [span.scene_id for span in spans_after] == expected_scene_order

        # Every scene still owns exactly its own prose payload, and the visible
        # text is the same blocks in the new order — no prose lost, added,
        # altered or concatenated (paragraph separators intact).
        expected_visible = "\n\n".join(
            payloads[scene_id] for scene_id in expected_scene_order
        )
        assert strip_internal_markers(after) == expected_visible
        for span in spans_after:
            assert after[span.start : span.end] == payloads[span.scene_id]


def test_reorder_is_reversible(tmp_path: Path) -> None:
    """Moving a scene away and back to its neighbour restores the exact content."""
    for seed in range(6):
        rng = random.Random(100 + seed)
        project_dir = tmp_path / f"reverse-{seed}"
        project_dir.mkdir()
        scene_ids, _payloads = _build_linked_project(project_dir, rng)

        content_path = project_dir / "content.md"
        original = content_path.read_text(encoding="utf-8")

        source_id = rng.choice(scene_ids)
        candidates = [scene_id for scene_id in scene_ids if scene_id != source_id]
        target_id = rng.choice(candidates)
        reorder_scene_prose(
            project_dir,
            SceneReorderProseRequest(
                source_scene_id=source_id,
                target_scene_id=target_id,
                place_before=True,
            ),
        )

        # Restore the original slot relative to the unchanged neighbours.
        original_index = scene_ids.index(source_id)
        if original_index == 0:
            restore_target_id = scene_ids[1]
            restore_before = True
        else:
            restore_target_id = scene_ids[original_index - 1]
            restore_before = False
        reorder_scene_prose(
            project_dir,
            SceneReorderProseRequest(
                source_scene_id=source_id,
                target_scene_id=restore_target_id,
                place_before=restore_before,
            ),
        )

        assert content_path.read_text(encoding="utf-8") == original
