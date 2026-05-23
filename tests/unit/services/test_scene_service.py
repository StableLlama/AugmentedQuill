# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Marker-oriented unit tests for the scene service."""

import json
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
    reorder_scene_prose,
    unlink_prose,
    update_scene,
    update_prose_content,
)
from augmentedquill.services.scenes.scene_markers import parse_scene_spans


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


def test_list_scenes_orders_by_order_index(project_dir: Path) -> None:
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
            "order_index": 10,
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
            "order_index": 1,
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
    assert a_after["prose_link"] is None
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
    assert refreshed["prose_link"] is None
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
    assert second_link is None


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
