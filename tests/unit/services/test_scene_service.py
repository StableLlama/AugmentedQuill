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
    SceneUpdateRequest,
    SceneUpdateProseContentRequest,
)
from augmentedquill.services.scenes.scene_service import (
    create_scene,
    get_scene,
    link_prose,
    list_scenes,
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
            "order_before": [],
            "order_after": [],
            "pinboard_x": 100,
            "pinboard_y": 100,
            "status": "active",
        }
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")

    scenes = list_scenes(project_dir)
    assert scenes[0]["timeline_id"] == "main"

    migrated = json.loads(story_path.read_text(encoding="utf-8"))
    assert migrated["metadata"]["version"] == 4
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
