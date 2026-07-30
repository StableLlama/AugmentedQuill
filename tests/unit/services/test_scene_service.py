# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Marker-oriented unit tests for the scene service."""

import json
import re
from pathlib import Path

import pytest

from augmentedquill.models.scene import (
    SceneBeat,
    SceneCreateRequest,
    SceneLinkProseRequest,
    SceneProseLink,
    SceneReorderProseRequest,
    SceneUpdateRequest,
    SceneUpdateProseContentRequest,
)
from augmentedquill.services.scenes.scene_service import (
    create_scene,
    get_scene,
    link_prose,
    list_scenes,
    relink_scope_prose,
    reorder_scope_scenes,
    reorder_scene_prose,
    unlink_prose,
    update_scene,
    update_prose_content,
)
from augmentedquill.services.scenes.scene_markers import (
    parse_scene_spans,
    validate_scene_marker_tokens,
)


@pytest.fixture()
def project_dir(tmp_path: Path) -> Path:
    story = {
        "metadata": {"version": 2},
        "project_title": "Test",
        "project_type": "short-story",
        "format": "markdown",
        "scenes": {},
    }
    (tmp_path / "story.json").write_text(json.dumps(story), encoding="utf-8")
    (tmp_path / "content.md").write_text("Alpha Bravo Charlie Delta", encoding="utf-8")
    return tmp_path


def test_create_scene_and_list(project_dir: Path) -> None:
    create_scene(project_dir, SceneCreateRequest(summary="A"))
    create_scene(project_dir, SceneCreateRequest(summary="B"))

    scenes = list_scenes(project_dir)
    assert len(scenes) == 2
    assert scenes[0]["id"] == 1
    assert scenes[1]["id"] == 2
    assert scenes[0]["timeline_id"] == "main"
    assert scenes[1]["timeline_id"] == "main"


def test_list_scenes_orders_by_marker_scope_and_offsets(project_dir: Path) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["scenes"] = {
        "1": {
            "summary": "First",
            "beats": [],
            "active_characters": [],
            "passive_characters": [],
            "sourcebook_entry_ids": [],
            "causes": [],
            "pinboard_x": 200,
            "pinboard_y": 200,
            "status": "active",
        },
        "2": {
            "summary": "Second",
            "beats": [],
            "active_characters": [],
            "passive_characters": [],
            "sourcebook_entry_ids": [],
            "causes": [],
            "pinboard_x": 100,
            "pinboard_y": 100,
            "status": "active",
        },
        "3": {
            "summary": "Third",
            "beats": [],
            "active_characters": [],
            "passive_characters": [],
            "sourcebook_entry_ids": [],
            "causes": [],
            "pinboard_x": 50,
            "pinboard_y": 50,
            "status": "active",
        },
    }
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    (project_dir / "content.md").write_text(
        "<!--scene:2:start-->Second<!--scene:2:end-->"
        "<!--scene:1:start-->First<!--scene:1:end-->",
        encoding="utf-8",
    )
    (project_dir / "unlinked.txt").write_text(
        "<!--scene:3:start-->Third<!--scene:3:end-->",
        encoding="utf-8",
    )

    scenes = list_scenes(project_dir)
    assert [scene["id"] for scene in scenes] == [2, 1, 3]


def test_link_prose_injects_markers_and_computes_offsets(project_dir: Path) -> None:
    scene = create_scene(project_dir, SceneCreateRequest(summary="Linked"))

    updated = link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(
            scope_type="story",
            start_offset=0,
            end_offset=5,
        ),
    )

    assert any(s["id"] == scene["id"] for s in updated)
    linked_scene = get_scene(project_dir, scene["id"])
    assert linked_scene is not None
    assert linked_scene["prose_link"] is not None
    assert linked_scene["prose_link"]["start_offset"] is not None
    assert linked_scene["prose_link"]["end_offset"] is not None

    text = (project_dir / "content.md").read_text(encoding="utf-8")
    assert "<!--scene:1:start-->" in text
    assert "<!--scene:1:end-->" in text


def test_scene_prose_links_are_runtime_only_and_not_persisted(
    project_dir: Path,
) -> None:
    scene = create_scene(
        project_dir,
        SceneCreateRequest(
            summary="Runtime only",
            prose_link=SceneProseLink(
                scope_type="story",
                start_offset=0,
                end_offset=5,
            ),
            beats=[
                SceneBeat(
                    text="Beat",
                    prose_link=SceneProseLink(
                        scope_type="story",
                        start_offset=1,
                        end_offset=2,
                    ),
                )
            ],
        ),
    )

    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(scope_type="story", start_offset=0, end_offset=5),
    )

    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    persisted = story["scenes"][str(scene["id"])]

    assert "prose_link" not in persisted
    assert persisted["beats"][0].get("prose_link") is None


def test_update_scene_persists_timeline_id(project_dir: Path) -> None:
    created = create_scene(project_dir, SceneCreateRequest(summary="Timeline"))

    updated = update_scene(
        project_dir,
        created["id"],
        SceneUpdateRequest(timeline_id="branch:alpha"),
    )

    assert updated is not None
    assert updated["timeline_id"] == "branch:alpha"

    refreshed = get_scene(project_dir, created["id"])
    assert refreshed is not None
    assert refreshed["timeline_id"] == "branch:alpha"


def test_list_scenes_migrates_story_to_v4_timeline_fields(project_dir: Path) -> None:
    story_path = project_dir / "story.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["metadata"] = {"version": 3}
    story["sourcebook"] = {
        "tt-jump": {
            "description": "jump",
            "category": "Time Travel",
            "creates_new_timeline": True,
        }
    }
    story["scenes"] = {
        "1": {
            "summary": "A",
            "beats": [],
            "active_characters": [],
            "passive_characters": [],
            "sourcebook_entry_ids": [],
            "causes": [],
            "pinboard_x": 100,
            "pinboard_y": 100,
            "status": "active",
        }
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")

    scenes = list_scenes(project_dir)
    assert scenes[0]["timeline_id"] == "main"

    migrated = json.loads(story_path.read_text(encoding="utf-8"))
    assert migrated["metadata"]["version"] >= 4
    assert migrated["scenes"]["1"]["timeline_id"] == "main"
    assert migrated["sourcebook"]["tt-jump"]["timeline_id"] == "branch:tt-jump"


def test_list_scenes_migrates_v7_and_creates_unlinked_marker_scope(
    project_dir: Path,
) -> None:
    story_path = project_dir / "story.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["metadata"] = {"version": 6}
    story["scenes"] = {
        "1": {
            "summary": "A",
            "beats": [],
            "active_characters": [],
            "passive_characters": [],
            "sourcebook_entry_ids": [],
            "causes": [],
            "pinboard_x": 100,
            "pinboard_y": 100,
            "order_index": 2,
            "status": "active",
        },
        "2": {
            "summary": "B",
            "beats": [],
            "active_characters": [],
            "passive_characters": [],
            "sourcebook_entry_ids": [],
            "causes": [],
            "pinboard_x": 100,
            "pinboard_y": 100,
            "order_index": 1,
            "status": "active",
        },
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")

    scenes = list_scenes(project_dir)
    assert [scene["id"] for scene in scenes] == [2, 1]

    migrated = json.loads(story_path.read_text(encoding="utf-8"))
    assert migrated["metadata"]["version"] == 9
    assert "order_index" not in migrated["scenes"]["1"]
    assert "order_index" not in migrated["scenes"]["2"]

    unlinked_text = (project_dir / "unlinked.txt").read_text(encoding="utf-8")
    assert "<!--scene:2:start-->" in unlinked_text
    assert "<!--scene:1:start-->" in unlinked_text


def test_migrate_v7_reconciles_unlinked_markers_even_when_version_already_7(
    project_dir: Path,
) -> None:
    story_path = project_dir / "story.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["metadata"] = {"version": 7}
    story["scenes"] = {
        "1": {
            "summary": "A",
            "beats": [],
            "active_characters": [],
            "passive_characters": [],
            "sourcebook_entry_ids": [],
            "causes": [],
            "pinboard_x": 100,
            "pinboard_y": 100,
            "status": "active",
        },
        "2": {
            "summary": "B",
            "beats": [],
            "active_characters": [],
            "passive_characters": [],
            "sourcebook_entry_ids": [],
            "causes": [],
            "pinboard_x": 100,
            "pinboard_y": 100,
            "status": "active",
        },
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")

    (project_dir / "unlinked.txt").write_text(
        "<!--scene:1:start--><!--scene:1:end-->\n",
        encoding="utf-8",
    )

    list_scenes(project_dir)

    reconciled = (project_dir / "unlinked.txt").read_text(encoding="utf-8")
    assert "<!--scene:1:start-->" in reconciled
    assert "<!--scene:2:start-->" in reconciled


def test_migrate_v7_appends_scenes_missing_from_chapters_to_unlinked_for_novel(
    project_dir: Path,
) -> None:
    story_path = project_dir / "story.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["metadata"] = {"version": 7}
    story["project_type"] = "novel"
    story["chapters"] = [
        {
            "id": "1",
            "filename": "0001.txt",
            "title": "Chapter 1",
            "summary": "",
            "content": "",
        }
    ]
    story["scenes"] = {
        "1": {
            "summary": "In chapter",
            "beats": [],
            "active_characters": [],
            "passive_characters": [],
            "sourcebook_entry_ids": [],
            "causes": [],
            "pinboard_x": 100,
            "pinboard_y": 100,
            "status": "active",
        },
        "2": {
            "summary": "Not in chapter",
            "beats": [],
            "active_characters": [],
            "passive_characters": [],
            "sourcebook_entry_ids": [],
            "causes": [],
            "pinboard_x": 100,
            "pinboard_y": 100,
            "status": "active",
        },
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text(
        "<!--scene:1:start-->A<!--scene:1:end-->",
        encoding="utf-8",
    )

    list_scenes(project_dir)

    unlinked_text = (project_dir / "unlinked.txt").read_text(encoding="utf-8")
    assert "<!--scene:2:start-->" in unlinked_text
    assert "<!--scene:1:start-->" not in unlinked_text


def test_marker_location_cache_invalidates_when_scope_file_changes(
    project_dir: Path,
) -> None:
    create_scene(project_dir, SceneCreateRequest(summary="A"))
    create_scene(project_dir, SceneCreateRequest(summary="B"))

    first = list_scenes(project_dir)
    assert [scene["id"] for scene in first] == [1, 2]

    (project_dir / "unlinked.txt").write_text(
        "<!--scene:2:start--><!--scene:2:end-->\n"
        "<!--scene:1:start--><!--scene:1:end-->\n",
        encoding="utf-8",
    )

    second = list_scenes(project_dir)
    assert [scene["id"] for scene in second] == [2, 1]


def test_reorder_scope_scenes_applies_full_permutation_atomically(
    project_dir: Path,
) -> None:
    first = create_scene(project_dir, SceneCreateRequest(summary="First"))
    second = create_scene(project_dir, SceneCreateRequest(summary="Second"))
    third = create_scene(project_dir, SceneCreateRequest(summary="Third"))

    # Unlinked scope initially follows creation order [1,2,3].
    positions = reorder_scope_scenes(
        project_dir,
        scope_type="unlinked",
        chapter_id=None,
        book_id=None,
        ordered_scene_ids=[third["id"], first["id"], second["id"]],
    )

    assert [entry["scene_id"] for entry in positions] == [3, 1, 2]
    assert [entry["position"] for entry in positions] == [0, 1, 2]

    scenes = list_scenes(project_dir)
    assert [scene["id"] for scene in scenes] == [3, 1, 2]


def test_reorder_scope_scenes_rejects_incomplete_id_set(project_dir: Path) -> None:
    first = create_scene(project_dir, SceneCreateRequest(summary="First"))
    create_scene(project_dir, SceneCreateRequest(summary="Second"))

    with pytest.raises(ValueError, match="exactly the current scope scene IDs"):
        reorder_scope_scenes(
            project_dir,
            scope_type="unlinked",
            chapter_id=None,
            book_id=None,
            ordered_scene_ids=[first["id"]],
        )


def test_reorder_scene_prose_same_scope_moves_to_target_boundary_not_noop(
    project_dir: Path,
) -> None:
    first = create_scene(project_dir, SceneCreateRequest(summary="First"))
    middle = create_scene(project_dir, SceneCreateRequest(summary="Middle"))
    target = create_scene(project_dir, SceneCreateRequest(summary="Target"))

    # Force unlinked order to [first, middle, target].
    (project_dir / "unlinked.txt").write_text(
        f"<!--scene:{first['id']}:start--><!--scene:{first['id']}:end-->\n"
        f"<!--scene:{middle['id']}:start--><!--scene:{middle['id']}:end-->\n"
        f"<!--scene:{target['id']}:start--><!--scene:{target['id']}:end-->\n",
        encoding="utf-8",
    )

    reorder_scene_prose(
        project_dir,
        SceneReorderProseRequest(
            source_scene_id=first["id"],
            target_scene_id=target["id"],
            place_before=True,
        ),
    )

    # Expect [middle, first, target] because source should be reinserted
    # directly before target, not treated as unchanged.
    content = (project_dir / "unlinked.txt").read_text(encoding="utf-8")
    spans = parse_scene_spans(content)
    assert [span.scene_id for span in spans] == [
        middle["id"],
        first["id"],
        target["id"],
    ]


def test_link_prose_unlinks_overlapping_scene(project_dir: Path) -> None:
    a = create_scene(project_dir, SceneCreateRequest(summary="A"))
    b = create_scene(project_dir, SceneCreateRequest(summary="B"))

    link_prose(
        project_dir,
        a["id"],
        SceneLinkProseRequest(scope_type="story", start_offset=0, end_offset=10),
    )
    link_prose(
        project_dir,
        b["id"],
        SceneLinkProseRequest(scope_type="story", start_offset=5, end_offset=15),
    )

    a_after = get_scene(project_dir, a["id"])
    b_after = get_scene(project_dir, b["id"])
    assert a_after is not None and b_after is not None
    assert a_after["prose_link"] is not None
    assert a_after["prose_link"].get("scope_type") == "unlinked"
    assert b_after["prose_link"] is not None


def test_unlink_prose_removes_markers(project_dir: Path) -> None:
    scene = create_scene(project_dir, SceneCreateRequest(summary="Unlink me"))
    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(scope_type="story", start_offset=0, end_offset=5),
    )

    unlink_prose(project_dir, scene["id"])

    refreshed = get_scene(project_dir, scene["id"])
    assert refreshed is not None
    assert refreshed["prose_link"] is not None
    assert refreshed["prose_link"].get("scope_type") == "unlinked"
    text = (project_dir / "content.md").read_text(encoding="utf-8")
    assert "<!--scene:1:start-->" not in text
    assert "<!--scene:1:end-->" not in text


def test_update_prose_content_replaces_marked_span(project_dir: Path) -> None:
    scene = create_scene(project_dir, SceneCreateRequest(summary="Edit me"))
    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(scope_type="story", start_offset=0, end_offset=5),
    )

    updated = update_prose_content(
        project_dir,
        scene["id"],
        SceneUpdateProseContentRequest(text="Omega"),
    )
    assert updated is not None

    text = (project_dir / "content.md").read_text(encoding="utf-8")
    assert "<!--scene:1:start-->Omega<!--scene:1:end-->" in text


def test_link_prose_relinks_scene_with_raw_offsets_after_marker_removal(
    project_dir: Path,
) -> None:
    first = create_scene(project_dir, SceneCreateRequest(summary="First"))
    second = create_scene(project_dir, SceneCreateRequest(summary="Second"))

    link_prose(
        project_dir,
        first["id"],
        SceneLinkProseRequest(scope_type="story", start_offset=0, end_offset=5),
    )

    current = (project_dir / "content.md").read_text(encoding="utf-8")
    bravo_start = current.index("Bravo")
    bravo_end = bravo_start + len("Bravo")
    link_prose(
        project_dir,
        second["id"],
        SceneLinkProseRequest(
            scope_type="story",
            start_offset=bravo_start,
            end_offset=bravo_end,
        ),
    )

    second_scene = get_scene(project_dir, second["id"])
    assert second_scene is not None
    assert second_scene["prose_link"] is not None
    second_start = int(second_scene["prose_link"]["start_offset"])
    second_end = int(second_scene["prose_link"]["end_offset"])
    linked_once = (project_dir / "content.md").read_text(encoding="utf-8")
    end_marker = f"<!--scene:{second['id']}:end-->"
    marker_start = linked_once.index(end_marker, second_end)
    # Raw editor positions skip over hidden markers; moving the end handle one
    # visible character right lands after the hidden end marker plus one char.
    moved_end_raw = marker_start + len(end_marker) + 1

    link_prose(
        project_dir,
        second["id"],
        SceneLinkProseRequest(
            scope_type="story",
            start_offset=second_start,
            end_offset=moved_end_raw,
        ),
    )

    final_text = (project_dir / "content.md").read_text(encoding="utf-8")
    spans = {span.scene_id: span for span in parse_scene_spans(final_text)}
    second_span = spans[second["id"]]
    assert final_text[second_span.start : second_span.end] == "Bravo "


def test_list_scenes_ignores_empty_markers_in_invalid_chapter_files(
    project_dir: Path,
) -> None:
    first = create_scene(project_dir, SceneCreateRequest(summary="First"))
    second = create_scene(project_dir, SceneCreateRequest(summary="Second"))

    link_prose(
        project_dir,
        first["id"],
        SceneLinkProseRequest(scope_type="story", start_offset=0, end_offset=5),
    )

    rogue_dir = project_dir / "chapters"
    rogue_dir.mkdir(parents=True, exist_ok=True)
    (rogue_dir / "story").write_text(
        (
            f"<!--scene:{first['id']}:start--><!--scene:{first['id']}:end-->"
            f"<!--scene:{second['id']}:start--><!--scene:{second['id']}:end-->"
        ),
        encoding="utf-8",
    )

    scenes = list_scenes(project_dir)
    by_id = {scene["id"]: scene for scene in scenes}
    first_link = by_id[first["id"]].get("prose_link")
    second_link = by_id[second["id"]].get("prose_link")

    assert first_link is not None
    assert first_link.get("scope_type") == "story"
    assert second_link is not None
    assert second_link.get("scope_type") == "unlinked"


def test_link_prose_snaps_offsets_that_land_inside_existing_markers(
    project_dir: Path,
) -> None:
    first = create_scene(project_dir, SceneCreateRequest(summary="First"))
    second = create_scene(project_dir, SceneCreateRequest(summary="Second"))

    link_prose(
        project_dir,
        first["id"],
        SceneLinkProseRequest(scope_type="story", start_offset=0, end_offset=5),
    )

    content = (project_dir / "content.md").read_text(encoding="utf-8")
    start_marker_pos = content.index(f"<!--scene:{first['id']}:start-->")

    link_prose(
        project_dir,
        second["id"],
        SceneLinkProseRequest(
            scope_type="story",
            start_offset=start_marker_pos + 3,
            end_offset=start_marker_pos + 8,
        ),
    )

    updated = (project_dir / "content.md").read_text(encoding="utf-8")
    assert "<!--scene:1:st<!--scene:" not in updated
    spans = parse_scene_spans(updated)
    assert len(spans) >= 1
    assert any(span.scene_id == second["id"] for span in spans)


def test_link_prose_rejects_malformed_marker_tokens_in_content(
    project_dir: Path,
) -> None:
    scene = create_scene(project_dir, SceneCreateRequest(summary="Broken markers"))
    (project_dir / "content.md").write_text(
        "<!--scene:11:end-<!--scene:11:start-->-<!--scene:11:end-->",
        encoding="utf-8",
    )

    try:
        link_prose(
            project_dir,
            scene["id"],
            SceneLinkProseRequest(scope_type="story", start_offset=0, end_offset=1),
        )
    except ValueError as exc:
        assert "Malformed scene marker token" in str(exc)
        return
    raise AssertionError("Expected malformed marker content to raise ValueError")


def test_link_prose_chapter_range_does_not_wrap_existing_marker_token_bytes(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "id": "1",
            "filename": "0001.txt",
            "title": "Chapter 1",
            "summary": "",
            "content": "",
        }
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text(
        "<!--scene:3:start-->Alpha<!--scene:3:end-->",
        encoding="utf-8",
    )

    scene = create_scene(project_dir, SceneCreateRequest(summary="Target"))
    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=0,
            end_offset=1,
        ),
    )

    updated = (chapters_dir / "0001.txt").read_text(encoding="utf-8")
    assert "<!--scene:3:st<!--scene:" not in updated
    assert "<<!--scene:" not in updated
    spans = parse_scene_spans(updated)
    assert any(span.scene_id == scene["id"] for span in spans)


@pytest.mark.parametrize("new_scene_count", [1, 2])
def test_link_prose_chapter_boundary_insert_never_corrupts_marker_tokens(
    project_dir: Path,
    new_scene_count: int,
) -> None:
    """Regression: marker-only chapter boundary inserts must never corrupt tokens.

    Reproduces the user-reported corruption pattern where linking a scene into a
    chapter containing only empty-marker scenes produced malformed tokens like
    ``<!--scene:N:end--<!--scene:M:start-->``.
    """
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "id": "3",
            "filename": "0003.txt",
            "title": "Chapter 3",
            "summary": "",
            "content": "",
        }
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter3_path = chapters_dir / "0003.txt"
    chapter3_path.write_text("", encoding="utf-8")

    anchor_scene = create_scene(project_dir, SceneCreateRequest(summary="Anchor"))
    link_prose(
        project_dir,
        anchor_scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="3",
            start_offset=0,
            end_offset=1,
        ),
    )

    anchor_end_marker = f"<!--scene:{anchor_scene['id']}:end-->"
    anchor_start_marker = f"<!--scene:{anchor_scene['id']}:start-->"

    for index in range(new_scene_count):
        scene = create_scene(
            project_dir,
            SceneCreateRequest(summary=f"Boundary insert scene {index + 1}"),
        )
        current = chapter3_path.read_text(encoding="utf-8")
        boundary_start = current.index(anchor_end_marker) + index

        link_prose(
            project_dir,
            scene["id"],
            SceneLinkProseRequest(
                scope_type="chapter",
                chapter_id="3",
                start_offset=boundary_start,
                end_offset=boundary_start + 1,
            ),
        )

    updated = chapter3_path.read_text(encoding="utf-8")
    validate_scene_marker_tokens(updated)

    # Broken tokens always contain '--<!--scene:' (missing '>' from '-->').
    assert "--<!--scene:" not in updated
    assert "<!--scene:" in updated
    assert anchor_start_marker in updated
    assert anchor_end_marker in updated

    spans = parse_scene_spans(updated)
    assert len(spans) == 1 + new_scene_count


def test_link_prose_relink_to_new_chapter_removes_old_chapter_markers(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "id": "2",
            "filename": "0002.txt",
            "title": "Chapter 2",
            "summary": "",
            "content": "",
        },
        {
            "id": "3",
            "filename": "0003.txt",
            "title": "Chapter 3",
            "summary": "",
            "content": "",
        },
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter2_path = chapters_dir / "0002.txt"
    chapter3_path = chapters_dir / "0003.txt"
    chapter2_path.write_text("", encoding="utf-8")
    chapter3_path.write_text("Gamma", encoding="utf-8")

    scene = create_scene(project_dir, SceneCreateRequest(summary="Scene to move"))

    # Initial link in chapter 3.
    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="3",
            start_offset=0,
            end_offset=1,
        ),
    )

    # Relink to chapter 2 with edge offsets that previously created duplicates.
    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="2",
            start_offset=0,
            end_offset=1,
        ),
    )

    chapter2_text = chapter2_path.read_text(encoding="utf-8")
    chapter3_text = chapter3_path.read_text(encoding="utf-8")
    scene_start_marker = f"<!--scene:{scene['id']}:start-->"
    scene_end_marker = f"<!--scene:{scene['id']}:end-->"

    assert scene_start_marker in chapter2_text
    assert scene_end_marker in chapter2_text
    assert scene_start_marker not in chapter3_text
    assert scene_end_marker not in chapter3_text


def test_link_prose_resolves_numeric_chapter_id_by_filename_when_ids_missing(
    project_dir: Path,
) -> None:
    # Migrations can drop chapter IDs, so chapter_id-based linking must still
    # target the chapter file whose numeric filename stem matches the id.
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "filename": "0002.txt",
            "title": "Chapter 2",
            "summary": "",
            "content": "",
        },
        {
            "filename": "0003.txt",
            "title": "Chapter 3",
            "summary": "",
            "content": "",
        },
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter2_path = chapters_dir / "0002.txt"
    chapter3_path = chapters_dir / "0003.txt"
    chapter2_path.write_text("Alpha", encoding="utf-8")
    chapter3_path.write_text("Beta", encoding="utf-8")

    scene = create_scene(project_dir, SceneCreateRequest(summary="Target chapter 2"))
    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="2",
            start_offset=0,
            end_offset=1,
        ),
    )

    chapter2_text = chapter2_path.read_text(encoding="utf-8")
    chapter3_text = chapter3_path.read_text(encoding="utf-8")
    scene_start_marker = f"<!--scene:{scene['id']}:start-->"
    scene_end_marker = f"<!--scene:{scene['id']}:end-->"

    assert scene_start_marker in chapter2_text
    assert scene_end_marker in chapter2_text
    assert scene_start_marker not in chapter3_text
    assert scene_end_marker not in chapter3_text


def test_link_prose_repeated_chapter_moves_keep_single_scope_marker_invariant(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "filename": "0001.txt",
            "title": "Chapter 1",
            "summary": "",
            "content": "",
        },
        {
            "filename": "0002.txt",
            "title": "Chapter 2",
            "summary": "",
            "content": "",
        },
        {
            "filename": "0003.txt",
            "title": "Chapter 3",
            "summary": "",
            "content": "",
        },
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter_paths = {
        "1": chapters_dir / "0001.txt",
        "2": chapters_dir / "0002.txt",
        "3": chapters_dir / "0003.txt",
    }
    for chapter_path in chapter_paths.values():
        chapter_path.write_text("Seed text", encoding="utf-8")

    scene = create_scene(project_dir, SceneCreateRequest(summary="Invariant"))
    marker_start = f"<!--scene:{scene['id']}:start-->"
    marker_end = f"<!--scene:{scene['id']}:end-->"

    for target_chapter_id in ["1", "2", "3", "2", "1"]:
        link_prose(
            project_dir,
            scene["id"],
            SceneLinkProseRequest(
                scope_type="chapter",
                chapter_id=target_chapter_id,
                start_offset=0,
                end_offset=1,
            ),
        )

        files_with_scene = []
        for chapter_id, chapter_path in chapter_paths.items():
            chapter_text = chapter_path.read_text(encoding="utf-8")
            has_scene = marker_start in chapter_text and marker_end in chapter_text
            if has_scene:
                files_with_scene.append(chapter_id)

        assert files_with_scene == [target_chapter_id]


def test_link_prose_empty_chapter_persists_true_empty_marker_pair(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "filename": "0002.txt",
            "title": "Chapter 2",
            "summary": "",
            "content": "",
        }
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter2_path = chapters_dir / "0002.txt"
    chapter2_path.write_text("", encoding="utf-8")

    scene = create_scene(project_dir, SceneCreateRequest(summary="No empty markers"))
    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="2",
            start_offset=0,
            end_offset=1,
        ),
    )

    chapter_text = chapter2_path.read_text(encoding="utf-8")
    assert (
        f"<!--scene:{scene['id']}:start--><!--scene:{scene['id']}:end-->"
        in chapter_text
    )
    spans = parse_scene_spans(chapter_text)
    target_span = next((span for span in spans if span.scene_id == scene["id"]), None)
    assert target_span is not None
    assert target_span.end == target_span.start


def test_link_prose_relink_to_empty_chapter_carries_existing_scene_prose(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {"filename": "0003.txt", "title": "Chapter 3", "summary": "", "content": ""},
        {"filename": "0004.txt", "title": "Chapter 4", "summary": "", "content": ""},
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter3_path = chapters_dir / "0003.txt"
    chapter4_path = chapters_dir / "0004.txt"
    chapter3_path.write_text("", encoding="utf-8")
    chapter4_path.write_text("X", encoding="utf-8")

    scene = create_scene(project_dir, SceneCreateRequest(summary="Move me"))

    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="4",
            start_offset=0,
            end_offset=1,
        ),
    )

    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="3",
            start_offset=0,
            end_offset=1,
        ),
    )

    chapter3_text = chapter3_path.read_text(encoding="utf-8")
    chapter4_text = chapter4_path.read_text(encoding="utf-8")
    scene_start_marker = f"<!--scene:{scene['id']}:start-->"
    scene_end_marker = f"<!--scene:{scene['id']}:end-->"

    assert f"{scene_start_marker}X{scene_end_marker}" in chapter3_text
    assert f"{scene_start_marker}\n{scene_end_marker}" not in chapter3_text
    assert scene_start_marker not in chapter4_text
    assert scene_end_marker not in chapter4_text


def test_link_prose_relink_cleans_stale_duplicate_scene_markers_in_other_chapters(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {"filename": "0003.txt", "title": "Chapter 3", "summary": "", "content": ""},
        {"filename": "0004.txt", "title": "Chapter 4", "summary": "", "content": ""},
        {"filename": "0005.txt", "title": "Chapter 5", "summary": "", "content": ""},
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter3_path = chapters_dir / "0003.txt"
    chapter4_path = chapters_dir / "0004.txt"
    chapter5_path = chapters_dir / "0005.txt"
    chapter3_path.write_text("", encoding="utf-8")
    chapter4_path.write_text("A", encoding="utf-8")
    chapter5_path.write_text("B", encoding="utf-8")

    scene = create_scene(project_dir, SceneCreateRequest(summary="Deduplicate"))

    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="4",
            start_offset=0,
            end_offset=1,
        ),
    )

    start_token = f"<!--scene:{scene['id']}:start-->"
    end_token = f"<!--scene:{scene['id']}:end-->"
    chapter5_path.write_text(
        f"{start_token}B{end_token}",
        encoding="utf-8",
    )

    link_prose(
        project_dir,
        scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="3",
            start_offset=0,
            end_offset=1,
        ),
    )

    chapter3_text = chapter3_path.read_text(encoding="utf-8")
    chapter4_text = chapter4_path.read_text(encoding="utf-8")
    chapter5_text = chapter5_path.read_text(encoding="utf-8")
    assert start_token in chapter3_text
    assert end_token in chapter3_text
    assert start_token not in chapter4_text
    assert end_token not in chapter4_text
    assert start_token not in chapter5_text
    assert end_token not in chapter5_text


def test_link_prose_rejects_user_reported_malformed_chapter_marker_pattern(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "filename": "0003.txt",
            "title": "Chapter 3",
            "summary": "",
            "content": "",
        }
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter3_path = chapters_dir / "0003.txt"
    chapter3_path.write_text(
        "<!--scene:10:start--><!--scene:10:end--<!--scene:18:start-->><!--scene:11:start-->><!--scene:11:end--><!--scene:18:end-->",
        encoding="utf-8",
    )

    scene = create_scene(project_dir, SceneCreateRequest(summary="Broken chapter"))

    with pytest.raises(ValueError, match="Malformed scene marker token"):
        link_prose(
            project_dir,
            scene["id"],
            SceneLinkProseRequest(
                scope_type="chapter",
                chapter_id="3",
                start_offset=0,
                end_offset=1,
            ),
        )


def test_link_prose_rejects_user_exact_malformed_marker_sequence(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "filename": "0002.txt",
            "title": "Chapter 2",
            "summary": "",
            "content": "",
        }
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter2_path = chapters_dir / "0002.txt"
    chapter2_path.write_text(
        "<!--scene:15:start--> <!--scene:15:end--<!--scene:6:start-->><!--scene:6:end-->",
        encoding="utf-8",
    )

    scene = create_scene(project_dir, SceneCreateRequest(summary="Broken chapter"))

    with pytest.raises(ValueError, match="Malformed scene marker token"):
        link_prose(
            project_dir,
            scene["id"],
            SceneLinkProseRequest(
                scope_type="chapter",
                chapter_id="2",
                start_offset=0,
                end_offset=1,
            ),
        )


def test_reorder_scene_prose_rejects_malformed_target_chapter_markers(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "filename": "0002.txt",
            "title": "Chapter 2",
            "summary": "",
            "content": "",
        },
        {
            "filename": "0003.txt",
            "title": "Chapter 3",
            "summary": "",
            "content": "",
        },
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter2_path = chapters_dir / "0002.txt"
    chapter3_path = chapters_dir / "0003.txt"
    chapter2_path.write_text("Alpha", encoding="utf-8")
    chapter3_path.write_text("Bravo", encoding="utf-8")

    source_scene = create_scene(project_dir, SceneCreateRequest(summary="Source"))
    target_scene = create_scene(project_dir, SceneCreateRequest(summary="Target"))

    link_prose(
        project_dir,
        source_scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="2",
            start_offset=0,
            end_offset=1,
        ),
    )
    link_prose(
        project_dir,
        target_scene["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="3",
            start_offset=0,
            end_offset=1,
        ),
    )

    chapter3_path.write_text(
        "<!--scene:10:start-->\n<!--scene:10:end--\n", encoding="utf-8"
    )

    with pytest.raises(ValueError, match="Malformed scene marker token"):
        reorder_scene_prose(
            project_dir,
            SceneReorderProseRequest(
                source_scene_id=source_scene["id"],
                target_scene_id=target_scene["id"],
                place_before=True,
            ),
        )


def test_reorder_scene_prose_within_same_chapter_moves_marker_block(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "id": "1",
            "filename": "0001.txt",
            "title": "Chapter 1",
            "summary": "",
            "content": "",
        }
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter_path = chapters_dir / "0001.txt"
    chapter_path.write_text("Alpha Beta Gamma", encoding="utf-8")

    first = create_scene(project_dir, SceneCreateRequest(summary="First"))
    second = create_scene(project_dir, SceneCreateRequest(summary="Second"))

    link_prose(
        project_dir,
        first["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=0,
            end_offset=5,
        ),
    )
    current = chapter_path.read_text(encoding="utf-8")
    beta_start = current.index("Beta")
    beta_end = beta_start + len("Beta")
    link_prose(
        project_dir,
        second["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=beta_start,
            end_offset=beta_end,
        ),
    )

    reorder_scene_prose(
        project_dir,
        SceneReorderProseRequest(
            source_scene_id=second["id"],
            target_scene_id=first["id"],
            place_before=True,
        ),
    )

    reordered = chapter_path.read_text(encoding="utf-8")
    spans = parse_scene_spans(reordered)
    assert [span.scene_id for span in spans] == [second["id"], first["id"]]

    first_start = reordered.index(f"<!--scene:{first['id']}:start-->")
    second_start = reordered.index(f"<!--scene:{second['id']}:start-->")
    assert second_start < first_start


def test_reorder_scene_prose_preserves_linked_prose_content_same_chapter(
    project_dir: Path,
) -> None:
    """Reordering two scenes with linked prose in the same chapter must preserve
    each scene's prose content exactly — no bytes added, removed, or altered."""
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "id": "1",
            "filename": "0001.txt",
            "title": "Chapter 1",
            "summary": "",
            "content": "",
        }
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter_path = chapters_dir / "0001.txt"
    chapter_path.write_text("Alpha Bravo Charlie Delta Echo", encoding="utf-8")

    first = create_scene(project_dir, SceneCreateRequest(summary="First"))
    second = create_scene(project_dir, SceneCreateRequest(summary="Second"))

    # Link first scene to "Alpha Bravo" (chars 0-10)
    link_prose(
        project_dir,
        first["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=0,
            end_offset=10,
        ),
    )
    # The marker-injected content now has markers around "Alpha Bravo"
    current = chapter_path.read_text(encoding="utf-8")
    # Find "Charlie" and link second scene
    charlie_start = current.index("Charlie")
    charlie_end = charlie_start + len("Charlie Delta Echo")
    link_prose(
        project_dir,
        second["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=charlie_start,
            end_offset=charlie_end,
        ),
    )

    # Capture prose text before reorder
    before = chapter_path.read_text(encoding="utf-8")
    before_spans = {s.scene_id: s for s in parse_scene_spans(before)}
    first_prose_before = before[
        before_spans[first["id"]].start : before_spans[first["id"]].end
    ]
    second_prose_before = before[
        before_spans[second["id"]].start : before_spans[second["id"]].end
    ]

    # Reorder: move second before first
    reorder_scene_prose(
        project_dir,
        SceneReorderProseRequest(
            source_scene_id=second["id"],
            target_scene_id=first["id"],
            place_before=True,
        ),
    )

    after = chapter_path.read_text(encoding="utf-8")
    after_spans = {s.scene_id: s for s in parse_scene_spans(after)}
    assert [span.scene_id for span in parse_scene_spans(after)] == [
        second["id"],
        first["id"],
    ]

    first_prose_after = after[
        after_spans[first["id"]].start : after_spans[first["id"]].end
    ]
    second_prose_after = after[
        after_spans[second["id"]].start : after_spans[second["id"]].end
    ]

    # Each scene's linked prose must be byte-for-byte identical after reorder
    assert first_prose_after == first_prose_before, (
        f"First scene prose changed during reorder.\n"
        f"Before ({len(first_prose_before)} chars): {first_prose_before!r}\n"
        f"After  ({len(first_prose_after)} chars): {first_prose_after!r}"
    )
    assert second_prose_after == second_prose_before, (
        f"Second scene prose changed during reorder.\n"
        f"Before ({len(second_prose_before)} chars): {second_prose_before!r}\n"
        f"After  ({len(second_prose_after)} chars): {second_prose_after!r}"
    )

    # Also verify prose content is non-empty (not just markers moving without prose)
    assert len(first_prose_after.strip()) > 0, "First scene prose should be non-empty"
    assert len(second_prose_after.strip()) > 0, "Second scene prose should be non-empty"


def test_reorder_scene_prose_preserves_content_when_adjacent(
    project_dir: Path,
) -> None:
    """Reordering two adjacent scenes with linked prose must preserve each
    scene's prose content exactly, even when their marker blocks are adjacent
    (no gap between end marker of one and start marker of next)."""
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["chapters"] = [
        {
            "id": "1",
            "filename": "0001.txt",
            "title": "Chapter 1",
            "summary": "",
            "content": "",
        }
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter_path = chapters_dir / "0001.txt"
    chapter_path.write_text("Hello World", encoding="utf-8")

    first = create_scene(project_dir, SceneCreateRequest(summary="First"))
    second = create_scene(project_dir, SceneCreateRequest(summary="Second"))

    link_prose(
        project_dir,
        first["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=0,
            end_offset=5,
        ),
    )
    current = chapter_path.read_text(encoding="utf-8")
    world_start = current.index("World")
    world_end = world_start + len("World")
    link_prose(
        project_dir,
        second["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=world_start,
            end_offset=world_end,
        ),
    )

    before = chapter_path.read_text(encoding="utf-8")
    before_spans = {s.scene_id: s for s in parse_scene_spans(before)}
    first_prose_before = before[
        before_spans[first["id"]].start : before_spans[first["id"]].end
    ]
    second_prose_before = before[
        before_spans[second["id"]].start : before_spans[second["id"]].end
    ]

    reorder_scene_prose(
        project_dir,
        SceneReorderProseRequest(
            source_scene_id=second["id"],
            target_scene_id=first["id"],
            place_before=True,
        ),
    )

    after = chapter_path.read_text(encoding="utf-8")
    after_spans = {s.scene_id: s for s in parse_scene_spans(after)}
    first_prose_after = after[
        after_spans[first["id"]].start : after_spans[first["id"]].end
    ]
    second_prose_after = after[
        after_spans[second["id"]].start : after_spans[second["id"]].end
    ]

    assert first_prose_after == first_prose_before
    assert second_prose_after == second_prose_before


def test_reorder_scene_prose_moves_between_chapters_and_transfers_markers(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["project_type"] = "novel"
    story["chapters"] = [
        {
            "id": "1",
            "filename": "0001.txt",
            "title": "Chapter 1",
            "summary": "",
            "content": "",
        },
        {
            "id": "2",
            "filename": "0002.txt",
            "title": "Chapter 2",
            "summary": "",
            "content": "",
        },
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter1 = chapters_dir / "0001.txt"
    chapter2 = chapters_dir / "0002.txt"
    chapter1.write_text("One", encoding="utf-8")
    chapter2.write_text("Two", encoding="utf-8")

    source = create_scene(project_dir, SceneCreateRequest(summary="Source"))
    target = create_scene(project_dir, SceneCreateRequest(summary="Target"))

    link_prose(
        project_dir,
        source["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=0,
            end_offset=3,
        ),
    )
    link_prose(
        project_dir,
        target["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="2",
            start_offset=0,
            end_offset=3,
        ),
    )

    reorder_scene_prose(
        project_dir,
        SceneReorderProseRequest(
            source_scene_id=source["id"],
            target_scene_id=target["id"],
            place_before=True,
        ),
    )

    chapter1_text = chapter1.read_text(encoding="utf-8")
    chapter2_text = chapter2.read_text(encoding="utf-8")

    assert f"<!--scene:{source['id']}:start-->" not in chapter1_text
    assert f"<!--scene:{source['id']}:end-->" not in chapter1_text

    source_start_in_target = chapter2_text.index(f"<!--scene:{source['id']}:start-->")
    target_start_in_target = chapter2_text.index(f"<!--scene:{target['id']}:start-->")
    assert source_start_in_target < target_start_in_target

    source_after = get_scene(project_dir, source["id"])
    assert source_after is not None
    assert source_after["prose_link"] is not None
    assert source_after["prose_link"].get("scope_type") == "chapter"
    assert source_after["prose_link"].get("chapter_id") == "2"


def test_reorder_scene_prose_moves_scene_from_chapter_to_unlinked(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["project_type"] = "novel"
    story["chapters"] = [
        {
            "id": "1",
            "filename": "0001.txt",
            "title": "Chapter 1",
            "summary": "",
            "content": "",
        }
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter1 = chapters_dir / "0001.txt"
    chapter1.write_text("Alpha", encoding="utf-8")

    source = create_scene(project_dir, SceneCreateRequest(summary="Chapter scene"))
    target_unlinked = create_scene(project_dir, SceneCreateRequest(summary="Anchor"))

    link_prose(
        project_dir,
        source["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=0,
            end_offset=5,
        ),
    )
    update_prose_content(
        project_dir,
        target_unlinked["id"],
        SceneUpdateProseContentRequest(text="UnlinkedAnchor"),
    )

    reorder_scene_prose(
        project_dir,
        SceneReorderProseRequest(
            source_scene_id=source["id"],
            target_scene_id=target_unlinked["id"],
            place_before=True,
        ),
    )

    chapter1_text = chapter1.read_text(encoding="utf-8")
    unlinked_text = (project_dir / "unlinked.txt").read_text(encoding="utf-8")

    assert f"<!--scene:{source['id']}:start-->" not in chapter1_text
    assert f"<!--scene:{source['id']}:end-->" not in chapter1_text

    source_start = unlinked_text.index(f"<!--scene:{source['id']}:start-->")
    target_start = unlinked_text.index(f"<!--scene:{target_unlinked['id']}:start-->")
    assert source_start < target_start

    moved = get_scene(project_dir, source["id"])
    assert moved is not None
    assert moved["prose_link"] is not None
    assert moved["prose_link"].get("scope_type") == "unlinked"


def test_reorder_scene_prose_moves_scene_from_unlinked_to_chapter(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["project_type"] = "novel"
    story["chapters"] = [
        {
            "id": "1",
            "filename": "0001.txt",
            "title": "Chapter 1",
            "summary": "",
            "content": "",
        }
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter1 = chapters_dir / "0001.txt"
    chapter1.write_text("ChapterBody", encoding="utf-8")

    source_unlinked = create_scene(project_dir, SceneCreateRequest(summary="Source"))
    target_chapter = create_scene(project_dir, SceneCreateRequest(summary="Target"))

    update_prose_content(
        project_dir,
        source_unlinked["id"],
        SceneUpdateProseContentRequest(text="FromUnlinked"),
    )
    link_prose(
        project_dir,
        target_chapter["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=0,
            end_offset=7,
        ),
    )

    reorder_scene_prose(
        project_dir,
        SceneReorderProseRequest(
            source_scene_id=source_unlinked["id"],
            target_scene_id=target_chapter["id"],
            place_before=False,
        ),
    )

    unlinked_text = (project_dir / "unlinked.txt").read_text(encoding="utf-8")
    chapter1_text = chapter1.read_text(encoding="utf-8")

    assert f"<!--scene:{source_unlinked['id']}:start-->" not in unlinked_text
    assert f"<!--scene:{source_unlinked['id']}:end-->" not in unlinked_text

    target_start = chapter1_text.index(f"<!--scene:{target_chapter['id']}:start-->")
    source_start = chapter1_text.index(f"<!--scene:{source_unlinked['id']}:start-->")
    assert target_start < source_start
    assert "FromUnlinked" in chapter1_text

    moved = get_scene(project_dir, source_unlinked["id"])
    assert moved is not None
    assert moved["prose_link"] is not None
    assert moved["prose_link"].get("scope_type") == "chapter"
    assert moved["prose_link"].get("chapter_id") == "1"


def test_reorder_scene_prose_handles_empty_scene_blocks_without_content_loss(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["project_type"] = "novel"
    story["chapters"] = [
        {
            "id": "1",
            "filename": "0001.txt",
            "title": "Chapter 1",
            "summary": "",
            "content": "",
        }
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter1 = chapters_dir / "0001.txt"
    chapter1.write_text("Body", encoding="utf-8")

    empty_scene = create_scene(project_dir, SceneCreateRequest(summary="Empty source"))
    chapter_anchor = create_scene(project_dir, SceneCreateRequest(summary="Target"))

    # Keep source scene empty in unlinked scope, then move after chapter scene.
    update_prose_content(
        project_dir,
        empty_scene["id"],
        SceneUpdateProseContentRequest(text=""),
    )
    link_prose(
        project_dir,
        chapter_anchor["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=0,
            end_offset=4,
        ),
    )

    reorder_scene_prose(
        project_dir,
        SceneReorderProseRequest(
            source_scene_id=empty_scene["id"],
            target_scene_id=chapter_anchor["id"],
            place_before=False,
        ),
    )

    chapter_text = chapter1.read_text(encoding="utf-8")
    unlinked_text = (project_dir / "unlinked.txt").read_text(encoding="utf-8")
    empty_block = (
        f"<!--scene:{empty_scene['id']}:start--><!--scene:{empty_scene['id']}:end-->"
    )

    assert empty_block in chapter_text
    assert empty_block not in unlinked_text

    spans = {span.scene_id: span for span in parse_scene_spans(chapter_text)}
    moved_span = spans[empty_scene["id"]]
    assert moved_span.start == moved_span.end


def test_reorder_scene_prose_preserves_existing_scene_prose_text(
    project_dir: Path,
) -> None:
    story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    story["project_type"] = "novel"
    story["chapters"] = [
        {
            "id": "1",
            "filename": "0001.txt",
            "title": "Chapter 1",
            "summary": "",
            "content": "",
        },
        {
            "id": "2",
            "filename": "0002.txt",
            "title": "Chapter 2",
            "summary": "",
            "content": "",
        },
    ]
    (project_dir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    chapters_dir = project_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    chapter1 = chapters_dir / "0001.txt"
    chapter2 = chapters_dir / "0002.txt"
    chapter1.write_text("Origin text", encoding="utf-8")
    chapter2.write_text("Target text", encoding="utf-8")

    source = create_scene(project_dir, SceneCreateRequest(summary="Source"))
    target = create_scene(project_dir, SceneCreateRequest(summary="Target"))

    link_prose(
        project_dir,
        source["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="1",
            start_offset=0,
            end_offset=6,
        ),
    )
    update_prose_content(
        project_dir,
        source["id"],
        SceneUpdateProseContentRequest(text="PreserveThisSceneText"),
    )
    link_prose(
        project_dir,
        target["id"],
        SceneLinkProseRequest(
            scope_type="chapter",
            chapter_id="2",
            start_offset=0,
            end_offset=6,
        ),
    )

    reorder_scene_prose(
        project_dir,
        SceneReorderProseRequest(
            source_scene_id=source["id"],
            target_scene_id=target["id"],
            place_before=True,
        ),
    )

    chapter1_text = chapter1.read_text(encoding="utf-8")
    chapter2_text = chapter2.read_text(encoding="utf-8")
    assert "PreserveThisSceneText" not in chapter1_text
    assert "PreserveThisSceneText" in chapter2_text

    spans = {span.scene_id: span for span in parse_scene_spans(chapter2_text)}
    source_span = spans[source["id"]]
    assert chapter2_text[source_span.start : source_span.end] == "PreserveThisSceneText"


# ---------------------------------------------------------------------------
# relink_scope_prose – atomic batch boundary drag roundtrip tests
# ---------------------------------------------------------------------------


def _link_two_adjacent_scenes(project_dir: Path) -> tuple[dict, dict]:
    """Create and link two adjacent story-scope scenes: A covers 'Alpha',
    B covers 'Bravo'.  Returns (scene_a, scene_b)."""
    a = create_scene(project_dir, SceneCreateRequest(summary="A"))
    b = create_scene(project_dir, SceneCreateRequest(summary="B"))

    # Link A to cover "Alpha" (first 5 chars of default content)
    link_prose(
        project_dir,
        a["id"],
        SceneLinkProseRequest(scope_type="story", start_offset=0, end_offset=5),
    )
    current = (project_dir / "content.md").read_text(encoding="utf-8")
    bravo_start = current.index("Bravo")
    bravo_end = bravo_start + len("Bravo")
    link_prose(
        project_dir,
        b["id"],
        SceneLinkProseRequest(
            scope_type="story",
            start_offset=bravo_start,
            end_offset=bravo_end,
        ),
    )
    return a, b


_MARKER_PATTERN = re.compile(r"<!--scene:\d+:(?:start|end)-->")


def _visible_offsets_from_original(
    full_content: str, orig_start: int, orig_end: int
) -> tuple[int, int]:
    """Convert original (marker-inclusive) offsets to visible (stripped) offsets
    using the same algorithm as the frontend ``toVisibleLinkedOffset``."""
    vis_start = _remap_single_offset(full_content, orig_start)
    vis_end = _remap_single_offset(full_content, orig_end)
    return vis_start, vis_end


def _remap_single_offset(content: str, offset: int) -> int:
    """Map an original offset to a visible offset by skipping marker tokens."""
    visible_count = 0
    last_index = 0
    for match in _MARKER_PATTERN.finditer(content):
        gap = match.start() - last_index
        if last_index + gap > offset:
            return visible_count + (offset - last_index)
        visible_count += gap
        if match.start() <= offset < match.end():
            return visible_count
        last_index = match.end()
    return visible_count + max(0, offset - last_index)


def _original_offsets_from_visible(
    full_content: str, vis_start: int, vis_end: int
) -> tuple[int, int]:
    """Convert visible offsets back to original offsets (inverse of _remap_single_offset)."""
    orig_start = _remap_visible_to_original(full_content, vis_start)
    orig_end = _remap_visible_to_original(full_content, vis_end)
    return orig_start, orig_end


def _remap_visible_to_original(content: str, visible_offset: int) -> int:
    """Map a visible offset back to an original offset."""
    if visible_offset <= 0:
        return 0
    visible_count = 0
    last_index = 0
    for match in _MARKER_PATTERN.finditer(content):
        gap = match.start() - last_index
        if visible_count + gap > visible_offset:
            return last_index + (visible_offset - visible_count)
        if visible_count + gap == visible_offset:
            after = content[match.end() :]
            if _MARKER_PATTERN.sub("", after):
                pass  # has visible text after, so skip marker
            else:
                return match.start()
        visible_count += gap
        last_index = match.end()
    remaining = visible_offset - visible_count
    if remaining >= 0:
        return min(last_index + remaining, len(content))
    return last_index


class TestRelinkScopeProse:
    """Tests for atomic batch prose relinking (boundary drag roundtrip)."""

    def test_relink_preserves_unchanged_scene_offsets(self, project_dir: Path) -> None:
        """When only one scene's boundary is adjusted, the other scene's
        prose offsets must remain unchanged after roundtrip."""
        a, b = _link_two_adjacent_scenes(project_dir)

        # Capture pre-relink state
        a_before = get_scene(project_dir, a["id"])
        b_before = get_scene(project_dir, b["id"])
        assert a_before is not None and b_before is not None
        a_link = a_before["prose_link"]
        b_link = b_before["prose_link"]
        assert a_link is not None and b_link is not None

        content_before = (project_dir / "content.md").read_text(encoding="utf-8")

        # Convert A's original offsets to visible (stripped) for relink_scope_prose
        vis_a_start, vis_a_end = _visible_offsets_from_original(
            content_before, int(a_link["start_offset"]), int(a_link["end_offset"])
        )
        vis_b_start, vis_b_end = _visible_offsets_from_original(
            content_before, int(b_link["start_offset"]), int(b_link["end_offset"])
        )

        # Simulate dragging A's start marker forward by 2 visible chars
        new_vis_a_start = vis_a_start + 2
        if new_vis_a_start >= vis_a_end:
            pytest.skip("Drag would zero-size the scene – not this test's scenario")

        # Call relink_scope_prose with A's adjusted start and B unchanged
        relink_scope_prose(
            project_dir,
            scope_type="story",
            chapter_id=None,
            book_id=None,
            assignments=[
                (a["id"], new_vis_a_start, vis_a_end),
                (b["id"], vis_b_start, vis_b_end),
            ],
        )

        # Read back
        a_after = get_scene(project_dir, a["id"])
        b_after = get_scene(project_dir, b["id"])
        assert a_after is not None and b_after is not None

        # B's prose text must be unchanged
        content_after = (project_dir / "content.md").read_text(encoding="utf-8")
        b_span = parse_scene_spans(content_after)
        b_span_dict = {s.scene_id: s for s in b_span}
        assert b["id"] in b_span_dict
        b_text = content_after[b_span_dict[b["id"]].start : b_span_dict[b["id"]].end]
        assert b_text == "Bravo", f"B's text changed: {b_text!r}"

        # A's remaining text should be what was after the new start position
        a_span = b_span_dict[a["id"]]
        a_text = content_after[a_span.start : a_span.end]
        # A originally covered "Alpha" (5 chars), start moved forward by 2
        expected_a_visible = "Alpha"[2:]  # "pha"
        assert (
            a_text == expected_a_visible
        ), f"A's text: {a_text!r}, expected: {expected_a_visible!r}"

    def test_relink_drag_start_into_adjacent_scene_three_way(
        self, project_dir: Path
    ) -> None:
        """Simulate dragging scene 2's start marker left into scene 1's area.
        Scene 1 should shrink, scene 2 should expand, scene 3 unchanged."""
        a, b = _link_two_adjacent_scenes(project_dir)
        c = create_scene(project_dir, SceneCreateRequest(summary="C"))

        current = (project_dir / "content.md").read_text(encoding="utf-8")
        charlie_start = current.index("Charlie")
        charlie_end = charlie_start + len("Charlie")
        link_prose(
            project_dir,
            c["id"],
            SceneLinkProseRequest(
                scope_type="story",
                start_offset=charlie_start,
                end_offset=charlie_end,
            ),
        )

        # Get pre-relink state
        content_before = (project_dir / "content.md").read_text(encoding="utf-8")
        spans_before = {s.scene_id: s for s in parse_scene_spans(content_before)}

        # Convert to visible offsets
        vis_a = _visible_offsets_from_original(
            content_before, spans_before[a["id"]].start, spans_before[a["id"]].end
        )
        vis_b = _visible_offsets_from_original(
            content_before, spans_before[b["id"]].start, spans_before[b["id"]].end
        )
        vis_c = _visible_offsets_from_original(
            content_before, spans_before[c["id"]].start, spans_before[c["id"]].end
        )

        # Drag B's start left by 2 visible chars (into A's area)
        new_vis_b_start = max(0, vis_b[0] - 2)
        # A's end becomes B's new start
        new_vis_a_end = new_vis_b_start

        if new_vis_a_end <= vis_a[0]:
            pytest.skip("Drag would zero-size scene A")

        relink_scope_prose(
            project_dir,
            scope_type="story",
            chapter_id=None,
            book_id=None,
            assignments=[
                (a["id"], vis_a[0], new_vis_a_end),
                (b["id"], new_vis_b_start, vis_b[1]),
                (c["id"], vis_c[0], vis_c[1]),
            ],
        )

        content_after = (project_dir / "content.md").read_text(encoding="utf-8")
        spans_after = {s.scene_id: s for s in parse_scene_spans(content_after)}

        # Verify each scene's text
        a_text = content_after[spans_after[a["id"]].start : spans_after[a["id"]].end]
        b_text = content_after[spans_after[b["id"]].start : spans_after[b["id"]].end]
        c_text = content_after[spans_after[c["id"]].start : spans_after[c["id"]].end]

        # A should have shrunk
        expected_a = "Alpha"[: new_vis_a_end - vis_a[0]]
        assert a_text == expected_a, f"A: {a_text!r} != {expected_a!r}"

        # B should have expanded to include what A lost, plus any text between
        a_lost = "Alpha"[new_vis_a_end - vis_a[0] :]
        # The visible text between A's old end and B's start is included
        stripped = _MARKER_PATTERN.sub("", content_before)
        between = stripped[vis_a[1] : vis_b[0]]
        expected_b = a_lost + between + "Bravo"
        assert b_text == expected_b, f"B: {b_text!r} != {expected_b!r}"

        # C should be unchanged
        assert c_text == "Charlie", f"C: {c_text!r} != 'Charlie'"

    def test_relink_roundtrip_offsets_are_consistent(self, project_dir: Path) -> None:
        """After relink_scope_prose, reading back the scenes and converting
        prose_link offsets to visible should match the original input."""
        a, b = _link_two_adjacent_scenes(project_dir)

        content_before = (project_dir / "content.md").read_text(encoding="utf-8")
        spans_before = {s.scene_id: s for s in parse_scene_spans(content_before)}

        vis_a = _visible_offsets_from_original(
            content_before, spans_before[a["id"]].start, spans_before[a["id"]].end
        )
        vis_b = _visible_offsets_from_original(
            content_before, spans_before[b["id"]].start, spans_before[b["id"]].end
        )

        # Pass all scenes through relink_scope_prose with their current visible offsets
        relink_scope_prose(
            project_dir,
            scope_type="story",
            chapter_id=None,
            book_id=None,
            assignments=[
                (a["id"], vis_a[0], vis_a[1]),
                (b["id"], vis_b[0], vis_b[1]),
            ],
        )

        # Read back: the prose_link offsets (original) should convert back
        # to the same visible offsets we sent
        content_after = (project_dir / "content.md").read_text(encoding="utf-8")
        a_after = get_scene(project_dir, a["id"])
        b_after = get_scene(project_dir, b["id"])
        assert a_after is not None and b_after is not None

        a_link = a_after["prose_link"]
        b_link = b_after["prose_link"]
        assert a_link is not None and b_link is not None

        roundtrip_vis_a = _visible_offsets_from_original(
            content_after, int(a_link["start_offset"]), int(a_link["end_offset"])
        )
        roundtrip_vis_b = _visible_offsets_from_original(
            content_after, int(b_link["start_offset"]), int(b_link["end_offset"])
        )

        assert roundtrip_vis_a == vis_a, f"A roundtrip: {roundtrip_vis_a} != {vis_a}"
        assert roundtrip_vis_b == vis_b, f"B roundtrip: {roundtrip_vis_b} != {vis_b}"

    def test_relink_start_boundary_into_other_scene_unlinks_engulfed(
        self, project_dir: Path
    ) -> None:
        """When scene 1's start marker is dragged past its end (into scene 2's
        area), the scene should be omitted from assignments.  Scene 2's range
        should be preserved."""
        a, b = _link_two_adjacent_scenes(project_dir)

        # Unlink A first (as the frontend would when start crosses end)
        unlink_prose(project_dir, a["id"])

        # Now relink only B – A is no longer in scope
        content_after_unlink = (project_dir / "content.md").read_text(encoding="utf-8")
        spans_after = {s.scene_id: s for s in parse_scene_spans(content_after_unlink)}

        if b["id"] not in spans_after:
            # B may also have been unlinked – re-link it
            link_prose(
                project_dir,
                b["id"],
                SceneLinkProseRequest(scope_type="story", start_offset=0, end_offset=5),
            )
            content_after_unlink = (project_dir / "content.md").read_text(
                encoding="utf-8"
            )
            spans_after = {
                s.scene_id: s for s in parse_scene_spans(content_after_unlink)
            }

        vis_b_after = _visible_offsets_from_original(
            content_after_unlink,
            spans_after[b["id"]].start,
            spans_after[b["id"]].end,
        )

        relink_scope_prose(
            project_dir,
            scope_type="story",
            chapter_id=None,
            book_id=None,
            assignments=[(b["id"], vis_b_after[0], vis_b_after[1])],
        )

        content_final = (project_dir / "content.md").read_text(encoding="utf-8")
        spans_final = {s.scene_id: s for s in parse_scene_spans(content_final)}

        # B should still have its text
        assert b["id"] in spans_final
        b_text = content_final[spans_final[b["id"]].start : spans_final[b["id"]].end]
        assert b_text == "Bravo", f"B text: {b_text!r}"

    def test_remap_matches_frontend_to_visible_linked_offset(
        self, project_dir: Path
    ) -> None:
        """Verify that the backend remap_offset_after_marker_removal produces
        the same results as the frontend's toVisibleLinkedOffset for every
        original offset in the content."""
        from augmentedquill.services.scenes.scene_markers import (
            remap_offset_after_marker_removal,
        )

        a, b = _link_two_adjacent_scenes(project_dir)
        content = (project_dir / "content.md").read_text(encoding="utf-8")

        for offset in range(len(content) + 1):
            backend_result = remap_offset_after_marker_removal(content, offset, None)
            frontend_result = _remap_single_offset(content, offset)
            assert (
                backend_result == frontend_result
            ), f"Offset {offset}: backend={backend_result}, frontend={frontend_result}"

    def test_visible_original_roundtrip_is_identity(self, project_dir: Path) -> None:
        """toVisibleLinkedOffset ∘ toOriginalOffset must be identity for
        every visible position.  This is the composition used in
        handleProseBoundaryChange."""
        a, b = _link_two_adjacent_scenes(project_dir)
        content = (project_dir / "content.md").read_text(encoding="utf-8")
        stripped = _MARKER_PATTERN.sub("", content)

        for vis in range(len(stripped) + 1):
            # visible → original
            orig = _remap_visible_to_original(content, vis)
            # original → visible
            back = _remap_single_offset(content, orig)
            assert (
                back == vis
            ), f"Visible {vis}: original={orig}, roundtrip back to visible={back}"

    def test_two_scenes_start_boundary_drag_via_relink(self, project_dir: Path) -> None:
        """Full simulation of dragging scene 2's start marker left by 2 chars
        (enough to cross the space between scenes and shrink scene 1).
        Uses stripped (visible) offsets as the frontend does."""
        a, b = _link_two_adjacent_scenes(project_dir)

        content_before = (project_dir / "content.md").read_text(encoding="utf-8")
        spans_before = {s.scene_id: s for s in parse_scene_spans(content_before)}

        vis_a = _visible_offsets_from_original(
            content_before, spans_before[a["id"]].start, spans_before[a["id"]].end
        )
        vis_b = _visible_offsets_from_original(
            content_before, spans_before[b["id"]].start, spans_before[b["id"]].end
        )

        # Drag B's start left by 2 visible chars (crosses into A's text)
        new_vis_b_start = vis_b[0] - 2
        new_vis_a_end = new_vis_b_start

        relink_scope_prose(
            project_dir,
            scope_type="story",
            chapter_id=None,
            book_id=None,
            assignments=[
                (a["id"], vis_a[0], new_vis_a_end),
                (b["id"], new_vis_b_start, vis_b[1]),
            ],
        )

        content_after = (project_dir / "content.md").read_text(encoding="utf-8")
        spans_after = {s.scene_id: s for s in parse_scene_spans(content_after)}

        a_text = content_after[spans_after[a["id"]].start : spans_after[a["id"]].end]
        b_text = content_after[spans_after[b["id"]].start : spans_after[b["id"]].end]

        # Verify content is continuous (no gaps or overlaps)
        visible_content = _MARKER_PATTERN.sub("", content_after)
        assert (
            visible_content == "Alpha Bravo Charlie Delta"
        ), f"Content changed: {visible_content!r}"

        # A shrunk by 1 (lost 'a'), B grew by 2 (gained 'a' and the space)
        assert a_text == "Alph", f"A: {a_text!r}"
        assert b_text == "a Bravo", f"B: {b_text!r}"

    def test_marker_positions_read_back_match_assigned_visible_offsets(
        self, project_dir: Path
    ) -> None:
        """After relink_scope_prose, converting the returned prose_link
        offsets to visible MUST match the visible offsets we assigned."""
        a, b = _link_two_adjacent_scenes(project_dir)

        content_before = (project_dir / "content.md").read_text(encoding="utf-8")
        spans_before = {s.scene_id: s for s in parse_scene_spans(content_before)}
        vis_a = _visible_offsets_from_original(
            content_before, spans_before[a["id"]].start, spans_before[a["id"]].end
        )
        vis_b = _visible_offsets_from_original(
            content_before, spans_before[b["id"]].start, spans_before[b["id"]].end
        )

        # Swap: B moves before A in visible space
        relink_scope_prose(
            project_dir,
            scope_type="story",
            chapter_id=None,
            book_id=None,
            assignments=[
                (b["id"], vis_a[0], vis_a[0] + (vis_b[1] - vis_b[0])),
                (
                    a["id"],
                    vis_a[0] + (vis_b[1] - vis_b[0]),
                    vis_a[0] + (vis_b[1] - vis_b[0]) + (vis_a[1] - vis_a[0]),
                ),
            ],
        )

        content_after = (project_dir / "content.md").read_text(encoding="utf-8")
        spans_after = {s.scene_id: s for s in parse_scene_spans(content_after)}

        # Convert returned original offsets back to visible
        for sid, expected_start, expected_end in [
            (b["id"], vis_a[0], vis_a[0] + (vis_b[1] - vis_b[0])),
            (
                a["id"],
                vis_a[0] + (vis_b[1] - vis_b[0]),
                vis_a[0] + (vis_b[1] - vis_b[0]) + (vis_a[1] - vis_a[0]),
            ),
        ]:
            span = spans_after[sid]
            actual_vis = _visible_offsets_from_original(
                content_after, span.start, span.end
            )
            assert actual_vis == (
                expected_start,
                expected_end,
            ), f"Scene {sid}: visible {actual_vis} != expected {(expected_start, expected_end)}"

    def test_relink_with_annotation_markers_preserves_integrity(
        self, project_dir: Path
    ) -> None:
        """Relinking a scene boundary when annotation markers are present
        must not corrupt the content.  The frontend sends offsets in the
        fully-stripped coordinate space (all internal markers removed),
        so the backend must also compute in the fully-stripped space."""
        from augmentedquill.services.scenes.scene_markers import (
            annotation_marker_token,
            validate_internal_marker_tokens,
        )

        a, b = _link_two_adjacent_scenes(project_dir)
        content_path = project_dir / "content.md"
        content_before = content_path.read_text(encoding="utf-8")

        spans_before = {s.scene_id: s for s in parse_scene_spans(content_before)}
        a_span = spans_before[a["id"]]

        # Add an annotation marker INSIDE scene A's prose ("Alpha" → put
        # annotation on "lph" = chars 1-3 of the 5-char word)
        a_start_token = annotation_marker_token("test-anno-1", "start")
        a_end_token = annotation_marker_token("test-anno-1", "end")
        a_text_start = a_span.start

        # Annotate characters 1-3 of scene A's prose ("lph")
        ann_start = a_text_start + 1
        ann_end = a_text_start + 4

        annotated = (
            content_before[:ann_start]
            + a_start_token
            + content_before[ann_start:ann_end]
            + a_end_token
            + content_before[ann_end:]
        )
        content_path.write_text(annotated, encoding="utf-8")

        # Add annotation metadata to story.json
        story_path = project_dir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story.setdefault("annotations", []).append(
            {
                "id": "test-anno-1",
                "comment": "Test annotation inside scene A",
                "scope_type": "story",
                "chapter_id": None,
                "book_id": None,
            }
        )
        story_path.write_text(json.dumps(story), encoding="utf-8")

        # Verify the annotated content is valid
        content_with_anno = content_path.read_text(encoding="utf-8")
        validate_internal_marker_tokens(content_with_anno)

        # Now simulate dragging scene B's start left by 2 visible chars.
        # This requires computing visible offsets from the content that
        # has BOTH scene and annotation markers.
        spans_after_anno = {s.scene_id: s for s in parse_scene_spans(content_with_anno)}
        a_span2 = spans_after_anno[a["id"]]
        b_span2 = spans_after_anno[b["id"]]

        # Use _ALL_MARKER_PATTERN (scene + annotation) for frontend-equivalent
        # visible offset calculation
        _ALL_MARKER_PATTERN = re.compile(
            r"<!--(?:scene:\d+|annotation:[^:>]+):(?:start|end)-->"
        )

        def vis_offset_all(content: str, offset: int) -> int:
            """Strip ALL internal markers (scene + annotation) — matches
            the frontend's toVisibleOffset behavior."""
            visible_count = 0
            last_index = 0
            for match in _ALL_MARKER_PATTERN.finditer(content):
                if match.start() >= offset:
                    break
                gap = match.start() - last_index
                visible_count += gap
                last_index = match.end()
            if last_index < offset:
                visible_count += offset - last_index
            return visible_count

        vis_a_start = vis_offset_all(content_with_anno, a_span2.start)
        vis_b_start = vis_offset_all(content_with_anno, b_span2.start)
        vis_b_end = vis_offset_all(content_with_anno, b_span2.end)

        # Drag scene B's start left by 1 visible char (inside A's text)
        new_vis_b_start = vis_b_start - 1
        new_vis_a_end = new_vis_b_start

        # Call relink_scope_prose — this should succeed WITHOUT
        # corrupting the annotation markers
        relink_scope_prose(
            project_dir,
            scope_type="story",
            chapter_id=None,
            book_id=None,
            assignments=[
                (a["id"], vis_a_start, new_vis_a_end),
                (b["id"], new_vis_b_start, vis_b_end),
            ],
        )

        content_after = content_path.read_text(encoding="utf-8")

        # Must be valid
        validate_internal_marker_tokens(content_after)

        # Annotation marker must still be present and well-formed
        assert a_start_token in content_after, "Annotation start marker lost"
        assert a_end_token in content_after, "Annotation end marker lost"

        # The annotation span must still be intact
        ann_start_after = content_after.index(a_start_token) + len(a_start_token)
        ann_end_after = content_after.index(a_end_token)
        ann_text = content_after[ann_start_after:ann_end_after]
        assert ann_text == "lph", f"Annotation text changed: {ann_text!r}"

        # Scene A and B prose must contain the expected text.
        # Annotation markers that fall inside a scene's span are part of
        # that scene's content — they appear as inline markers.
        spans_after = {s.scene_id: s for s in parse_scene_spans(content_after)}
        a_full = content_after[spans_after[a["id"]].start : spans_after[a["id"]].end]
        b_full = content_after[spans_after[b["id"]].start : spans_after[b["id"]].end]

        # Scene A should start with "A" (the first char of "Alpha")
        assert a_full.startswith("A"), f"Scene A text: {a_full!r}"

        # Scene B should contain "Bravo"
        assert "Bravo" in b_full, f"Scene B missing 'Bravo': {b_full!r}"

        # The annotation markers should appear in exactly one of the scenes
        anno_in_a = a_start_token in a_full
        anno_in_b = a_start_token in b_full
        assert anno_in_a or anno_in_b, "Annotation markers lost from both scenes"
        assert not (anno_in_a and anno_in_b), "Annotation markers duplicated"

    def test_relink_with_overlapping_annotations_preserves_integrity(
        self, project_dir: Path
    ) -> None:
        """Relinking a scene boundary when multiple annotations overlap must
        not fail with 'Overlapping annotation assignments'.

        This reproduces the bug where dragging a scene boundary fails
        with HTTP 422 because _inject_layer_spans rejected overlapping
        (but valid) annotation spans during re-injection."""
        from augmentedquill.services.scenes.scene_markers import (
            annotation_marker_token,
            remove_markers,
            validate_internal_marker_tokens,
        )

        a, b = _link_two_adjacent_scenes(project_dir)
        content_path = project_dir / "content.md"
        content_before = content_path.read_text(encoding="utf-8")

        spans_before = {s.scene_id: s for s in parse_scene_spans(content_before)}
        a_span = spans_before[a["id"]]
        b_span = spans_before[b["id"]]

        a_start_token = annotation_marker_token("anno-a", "start")
        a_end_token = annotation_marker_token("anno-a", "end")
        b_anno_start = annotation_marker_token("anno-b", "start")
        b_anno_end = annotation_marker_token("anno-b", "end")

        # Annotate characters 1-4 of scene A's prose ("lph" in "Alpha")
        ann_a_start = a_span.start + 1
        ann_a_end = a_span.start + 5

        # Annotate characters 0-3 of scene B's prose ("Bra" in "Bravo")
        ann_b_start = b_span.start
        ann_b_end = b_span.start + 3

        # Insert annotations into content
        annotated = (
            content_before[:ann_a_start]
            + a_start_token
            + content_before[ann_a_start:ann_a_end]
            + a_end_token
            + content_before[ann_a_end:ann_b_start]
            + b_anno_start
            + content_before[ann_b_start:ann_b_end]
            + b_anno_end
            + content_before[ann_b_end:]
        )
        content_path.write_text(annotated, encoding="utf-8")

        # Add annotation metadata to story.json
        story_path = project_dir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story.setdefault("annotations", []).extend(
            [
                {
                    "id": "anno-a",
                    "comment": "Annotation inside scene A",
                    "scope_type": "story",
                    "chapter_id": None,
                    "book_id": None,
                },
                {
                    "id": "anno-b",
                    "comment": "Annotation inside scene B",
                    "scope_type": "story",
                    "chapter_id": None,
                    "book_id": None,
                },
            ]
        )
        story_path.write_text(json.dumps(story), encoding="utf-8")

        content_with_anno = content_path.read_text(encoding="utf-8")
        validate_internal_marker_tokens(content_with_anno)

        # Calculate visible offsets (stripping ALL internal markers)
        _ALL_MARKER_PATTERN = re.compile(
            r"<!--(?:scene:\d+|annotation:[^:>]+):(?:start|end)-->"
        )

        def vis_offset_all(content: str, offset: int) -> int:
            visible_count = 0
            last_index = 0
            for match in _ALL_MARKER_PATTERN.finditer(content):
                if match.start() >= offset:
                    break
                gap = match.start() - last_index
                visible_count += gap
                last_index = match.end()
            if last_index < offset:
                visible_count += offset - last_index
            return visible_count

        spans_after_anno = {s.scene_id: s for s in parse_scene_spans(content_with_anno)}
        a_span2 = spans_after_anno[a["id"]]
        b_span2 = spans_after_anno[b["id"]]

        vis_a_start = vis_offset_all(content_with_anno, a_span2.start)
        vis_a_end = vis_offset_all(content_with_anno, a_span2.end)  # noqa: F841
        vis_b_start = vis_offset_all(content_with_anno, b_span2.start)
        vis_b_end = vis_offset_all(content_with_anno, b_span2.end)

        # Drag scene B's start left by 1 visible char (into A's text)
        new_vis_b_start = vis_b_start - 1
        new_vis_a_end = new_vis_b_start

        # This must NOT raise "Overlapping annotation assignments"
        relink_scope_prose(
            project_dir,
            scope_type="story",
            chapter_id=None,
            book_id=None,
            assignments=[
                (a["id"], vis_a_start, new_vis_a_end),
                (b["id"], new_vis_b_start, vis_b_end),
            ],
        )

        content_after = content_path.read_text(encoding="utf-8")
        validate_internal_marker_tokens(content_after)

        # Both annotations must survive
        assert a_start_token in content_after, "Annotation A start marker lost"
        assert a_end_token in content_after, "Annotation A end marker lost"
        assert b_anno_start in content_after, "Annotation B start marker lost"
        assert b_anno_end in content_after, "Annotation B end marker lost"

        # Annotation text must be preserved (after removing scene markers
        # that may now appear inside the annotation span due to the
        # shifted scene boundary)
        ann_a_text = content_after[
            content_after.index(a_start_token)
            + len(a_start_token) : content_after.index(a_end_token)
        ]
        ann_b_text = content_after[
            content_after.index(b_anno_start)
            + len(b_anno_start) : content_after.index(b_anno_end)
        ]
        # Strip scene markers that may appear inside annotation spans
        ann_a_clean = remove_markers(ann_a_text)
        ann_b_clean = remove_markers(ann_b_text)
        assert ann_a_clean == "lpha", f"Annotation A text changed: {ann_a_clean!r}"
        assert ann_b_clean == "Bra", f"Annotation B text changed: {ann_b_clean!r}"
