# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Purpose: ensure generic project prose writes preserve scene links via markers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from augmentedquill.services.projects.project_chapter_ops import (
    delete_chapter_in_project,
    write_chapter_content_in_project,
)
from augmentedquill.services.projects.project_story_ops import (
    write_story_content_in_project,
)
from augmentedquill.services.scenes.scene_markers import parse_scene_spans


def test_write_chapter_content_preserves_scene_markers_on_rewrite(
    tmp_path: Path,
) -> None:
    story = {
        "metadata": {"version": 3},
        "project_type": "novel",
        "language": "en",
        "chapters": [
            {
                "title": "Chapter 1",
                "summary": "",
                "filename": "0001.txt",
            }
        ],
    }
    (tmp_path / "story.json").write_text(json.dumps(story), encoding="utf-8")
    chapters_dir = tmp_path / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text(
        "<!--scene:1:start-->Alpha<!--scene:1:end--> "
        "<!--scene:2:start-->Beta<!--scene:2:end-->",
        encoding="utf-8",
    )

    write_chapter_content_in_project(
        1, "Rewritten prose for the whole chapter.", active=tmp_path
    )

    rewritten = (chapters_dir / "0001.txt").read_text(encoding="utf-8")
    spans = parse_scene_spans(rewritten)
    assert len(spans) == 2
    assert "<!--scene:1:start-->" in rewritten
    assert "<!--scene:1:end-->" in rewritten
    assert "<!--scene:2:start-->" in rewritten
    assert "<!--scene:2:end-->" in rewritten


def test_write_story_content_preserves_scene_markers_in_short_story(
    tmp_path: Path,
) -> None:
    story = {
        "metadata": {"version": 3},
        "project_type": "short-story",
        "content_file": "content.md",
        "language": "en",
    }
    (tmp_path / "story.json").write_text(json.dumps(story), encoding="utf-8")
    content_path = tmp_path / "content.md"
    content_path.write_text(
        "<!--scene:3:start-->Opening prose<!--scene:3:end-->",
        encoding="utf-8",
    )

    write_story_content_in_project(tmp_path, "Completely rewritten short story prose.")

    rewritten = content_path.read_text(encoding="utf-8")
    spans = parse_scene_spans(rewritten)
    assert len(spans) == 1
    assert "<!--scene:3:start-->" in rewritten
    assert "<!--scene:3:end-->" in rewritten


def test_write_chapter_content_rejects_malformed_marker_tokens(
    tmp_path: Path,
) -> None:
    story = {
        "metadata": {"version": 3},
        "project_type": "novel",
        "language": "en",
        "chapters": [
            {
                "title": "Chapter 1",
                "summary": "",
                "filename": "0001.txt",
            }
        ],
    }
    (tmp_path / "story.json").write_text(json.dumps(story), encoding="utf-8")
    chapters_dir = tmp_path / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text(
        "<!--scene:15:start--> <!--scene:15:end--<!--scene:6:start-->><!--scene:6:end-->",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Malformed scene marker token"):
        write_chapter_content_in_project(
            1, "Rewritten prose for malformed chapter.", active=tmp_path
        )


def test_delete_chapter_rejects_malformed_marker_tokens_during_migration(
    tmp_path: Path,
) -> None:
    story = {
        "metadata": {"version": 3},
        "project_type": "novel",
        "language": "en",
        "chapters": [
            {
                "title": "Chapter 1",
                "summary": "",
                "filename": "0001.txt",
            },
            {
                "title": "Chapter 2",
                "summary": "",
                "filename": "0002.txt",
            },
        ],
    }
    (tmp_path / "story.json").write_text(json.dumps(story), encoding="utf-8")
    chapters_dir = tmp_path / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "0001.txt").write_text(
        "<!--scene:15:start--> <!--scene:15:end--<!--scene:6:start-->><!--scene:6:end-->",
        encoding="utf-8",
    )
    (chapters_dir / "0002.txt").write_text("Some destination prose.", encoding="utf-8")

    with pytest.raises(ValueError, match="Malformed scene marker token"):
        delete_chapter_in_project(tmp_path, 1)
