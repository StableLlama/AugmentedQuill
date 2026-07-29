# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Unit tests for the annotation service."""

import json
from pathlib import Path

import pytest

from augmentedquill.services.annotations.annotation_service import (
    create_annotation,
    delete_annotation,
    get_annotation,
    list_annotations,
    list_annotations_for_scope,
    split_straddling_annotations,
    update_annotation,
)


@pytest.fixture()
def project_dir(tmp_path: Path) -> Path:
    story = {
        "metadata": {"version": 8},
        "project_title": "Test",
        "project_type": "short-story",
        "format": "markdown",
        "scenes": {},
        "annotations": [],
    }
    (tmp_path / "story.json").write_text(json.dumps(story), encoding="utf-8")
    (tmp_path / "content.md").write_text("Hello World!", encoding="utf-8")
    return tmp_path


def test_create_annotation_injects_markers(project_dir: Path) -> None:
    ann = create_annotation(
        project_dir,
        scope_type="story",
        chapter_id=None,
        book_id=None,
        start_offset=0,
        end_offset=5,
        comment="Test comment",
    )
    assert ann["id"].startswith("annot-")
    assert ann["comment"] == "Test comment"
    assert isinstance(ann["start_offset"], int)
    assert isinstance(ann["end_offset"], int)
    assert ann["start_offset"] < ann["end_offset"]

    prose = (project_dir / "content.md").read_text(encoding="utf-8")
    assert f"<!--annotation:{ann['id']}:start-->" in prose
    assert f"<!--annotation:{ann['id']}:end-->" in prose
    assert "Hello" in prose


def test_list_annotations_returns_runtime_offsets(project_dir: Path) -> None:
    ann = create_annotation(
        project_dir,
        scope_type="story",
        chapter_id=None,
        book_id=None,
        start_offset=6,
        end_offset=11,
        comment="World",
    )
    all_anns = list_annotations(project_dir)
    assert any(a["id"] == ann["id"] for a in all_anns)
    found = next(a for a in all_anns if a["id"] == ann["id"])
    assert found["start_offset"] is not None


def test_get_annotation_returns_correct_entry(project_dir: Path) -> None:
    ann = create_annotation(
        project_dir,
        scope_type="story",
        chapter_id=None,
        book_id=None,
        start_offset=0,
        end_offset=5,
        comment="Get me",
    )
    fetched = get_annotation(project_dir, ann["id"])
    assert fetched is not None
    assert fetched["comment"] == "Get me"


def test_get_annotation_returns_none_for_missing(project_dir: Path) -> None:
    assert get_annotation(project_dir, "nonexistent") is None


def test_update_annotation_persists_new_comment(project_dir: Path) -> None:
    ann = create_annotation(
        project_dir,
        scope_type="story",
        chapter_id=None,
        book_id=None,
        start_offset=0,
        end_offset=5,
        comment="Original",
    )
    updated = update_annotation(project_dir, ann["id"], comment="Updated")
    assert updated is not None
    assert updated["comment"] == "Updated"

    fetched = get_annotation(project_dir, ann["id"])
    assert fetched is not None
    assert fetched["comment"] == "Updated"


def test_delete_annotation_removes_markers_and_metadata(project_dir: Path) -> None:
    ann = create_annotation(
        project_dir,
        scope_type="story",
        chapter_id=None,
        book_id=None,
        start_offset=0,
        end_offset=5,
        comment="Delete me",
    )
    ann_id = ann["id"]

    assert delete_annotation(project_dir, ann_id)

    prose = (project_dir / "content.md").read_text(encoding="utf-8")
    assert f"<!--annotation:{ann_id}:start-->" not in prose

    assert get_annotation(project_dir, ann_id) is None


def test_delete_annotation_returns_false_for_missing(project_dir: Path) -> None:
    assert not delete_annotation(project_dir, "missing")


def test_list_annotations_for_scope_filters_correctly(project_dir: Path) -> None:
    story_path = project_dir / "story.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["metadata"] = {"version": 9}
    story["chapters"] = [{"title": "Ch1", "filename": "0001.txt"}]
    story_path.write_text(json.dumps(story), encoding="utf-8")
    (project_dir / "chapters").mkdir(parents=True, exist_ok=True)
    (project_dir / "chapters" / "0001.txt").write_text("Chapter text", encoding="utf-8")

    story_ann = create_annotation(
        project_dir,
        scope_type="story",
        chapter_id=None,
        book_id=None,
        start_offset=0,
        end_offset=5,
        comment="Story annotation",
    )
    chap_ann = create_annotation(
        project_dir,
        scope_type="chapter",
        chapter_id="1",
        book_id=None,
        start_offset=0,
        end_offset=7,
        comment="Chapter annotation",
    )

    story_anns = list_annotations_for_scope(project_dir, "story", None, None)
    assert any(a["id"] == story_ann["id"] for a in story_anns)
    assert all(a["id"] != chap_ann["id"] for a in story_anns)


def test_multiple_overlapping_annotations(project_dir: Path) -> None:
    """Multiple annotations can overlap arbitrarily on the same text."""
    ann1 = create_annotation(
        project_dir,
        scope_type="story",
        chapter_id=None,
        book_id=None,
        start_offset=0,
        end_offset=11,
        comment="Whole phrase",
    )
    ann2 = create_annotation(
        project_dir,
        scope_type="story",
        chapter_id=None,
        book_id=None,
        start_offset=int(ann1["start_offset"]) + 6,
        end_offset=int(ann1["end_offset"]),
        comment="Second word",
    )
    all_anns = list_annotations(project_dir)
    ids = [a["id"] for a in all_anns]
    assert ann1["id"] in ids
    assert ann2["id"] in ids


def test_split_straddling_annotations_splits_at_boundary() -> None:
    """Annotations whose start is inside a block and end is outside are split."""
    content = (
        "<!--scene:1:start-->"
        "Hello <!--annotation:note1:start-->World"
        "<!--scene:1:end-->"
        "<!--scene:2:start-->again<!--annotation:note1:end-->"
        "<!--scene:2:end-->"
    )
    from augmentedquill.services.scenes.scene_markers import scene_block_bounds

    block = scene_block_bounds(content, 1)
    assert block is not None
    block_start, block_end = block

    meta = [
        {
            "id": "note1",
            "comment": "Test",
            "scope_type": "story",
            "chapter_id": None,
            "book_id": None,
        }
    ]
    new_content, new_meta = split_straddling_annotations(
        content, block_start, block_end, meta
    )

    assert "<!--annotation:note1:start-->" not in new_content
    assert "<!--annotation:note1:end-->" not in new_content
    assert "<!--annotation:note1-in:start-->" in new_content
    assert "<!--annotation:note1-out:end-->" in new_content

    ids = [m["id"] for m in new_meta]
    assert "note1" not in ids
    assert "note1-in" in ids
    assert "note1-out" in ids
    assert next(m["comment"] for m in new_meta if m["id"] == "note1-in") == "Test"


def test_split_straddling_annotations_no_op_when_no_straddlers() -> None:
    content = (
        "<!--scene:1:start--><!--annotation:note1:start-->Hello<!--annotation:note1:end--><!--scene:1:end-->"
        "<!--scene:2:start-->World<!--scene:2:end-->"
    )
    from augmentedquill.services.scenes.scene_markers import scene_block_bounds

    block = scene_block_bounds(content, 1)
    assert block is not None
    block_start, block_end = block

    meta = [
        {
            "id": "note1",
            "comment": "Test",
            "scope_type": "story",
            "chapter_id": None,
            "book_id": None,
        }
    ]
    new_content, new_meta = split_straddling_annotations(
        content, block_start, block_end, meta
    )
    assert new_content == content
    assert new_meta == meta


def test_split_straddling_annotations_start_inside_keeps_in_markers_inside_block() -> (
    None
):
    """When annotation starts inside the block, both -in markers must be
    between <!--scene:N:start--> and <!--scene:N:end--> so the entire -in
    annotation moves with the scene block during reorder."""
    content = (
        "<!--scene:1:start-->"
        "Hello <!--annotation:note1:start-->World"
        "<!--scene:1:end-->"
        "<!--scene:2:start-->again<!--annotation:note1:end-->"
        "<!--scene:2:end-->"
    )
    from augmentedquill.services.scenes.scene_markers import (
        scene_block_bounds,
    )

    block = scene_block_bounds(content, 1)
    assert block is not None
    block_start, block_end = block

    meta = [
        {
            "id": "note1",
            "comment": "Test",
            "scope_type": "story",
            "chapter_id": None,
            "book_id": None,
        }
    ]
    new_content, new_meta = split_straddling_annotations(
        content, block_start, block_end, meta
    )

    # ---- -in markers must be INSIDE scene 1's block ----
    re_block = scene_block_bounds(new_content, 1)
    assert re_block is not None
    re_start, re_end = re_block
    in_start_pos = new_content.find("<!--annotation:note1-in:start-->")
    in_end_pos = new_content.find("<!--annotation:note1-in:end-->")
    assert in_start_pos >= 0, "-in:start marker missing"
    assert in_end_pos >= 0, "-in:end marker missing"
    assert re_start <= in_start_pos < re_end, (
        f"-in:start ({in_start_pos}) must be inside scene 1 block "
        f"[{re_start}, {re_end})"
    )
    assert (
        re_start <= in_end_pos < re_end
    ), f"-in:end ({in_end_pos}) must be inside scene 1 block [{re_start}, {re_end})"
    # -in:start must come before -in:end
    assert in_start_pos < in_end_pos, "-in:start must precede -in:end"

    # ---- -out markers must be OUTSIDE scene 1's block ----
    out_start_pos = new_content.find("<!--annotation:note1-out:start-->")
    out_end_pos = new_content.find("<!--annotation:note1-out:end-->")
    assert out_start_pos >= 0, "-out:start marker missing"
    assert out_end_pos >= 0, "-out:end marker missing"
    assert out_start_pos >= re_end, (
        f"-out:start ({out_start_pos}) must be outside scene 1 block "
        f"at or after block end ({re_end})"
    )
    # -out:start must come before -out:end
    assert out_start_pos < out_end_pos, "-out:start must precede -out:end"


def test_split_straddling_annotations_start_outside_keeps_in_markers_inside_block() -> (
    None
):
    """When annotation starts outside the block and ends inside, both -in
    markers must still be INSIDE the block."""
    content = (
        "<!--scene:1:start-->"
        "Hello <!--annotation:note1:start-->World"
        "<!--scene:1:end-->"
        "<!--scene:2:start-->again"
        "<!--annotation:note1:end-->World<!--scene:2:end-->"
    )
    from augmentedquill.services.scenes.scene_markers import (
        scene_block_bounds,
    )

    # This time the straddler is on scene 2: annotation starts outside (inside
    # scene 1's area) and ends inside scene 2's block.
    block = scene_block_bounds(content, 2)
    assert block is not None
    block_start, block_end = block

    meta = [
        {
            "id": "note1",
            "comment": "Test",
            "scope_type": "story",
            "chapter_id": None,
            "book_id": None,
        }
    ]
    new_content, new_meta = split_straddling_annotations(
        content, block_start, block_end, meta
    )

    # ---- -in markers must be INSIDE scene 2's block ----
    re_block = scene_block_bounds(new_content, 2)
    assert re_block is not None
    re_start, re_end = re_block
    in_start_pos = new_content.find("<!--annotation:note1-in:start-->")
    in_end_pos = new_content.find("<!--annotation:note1-in:end-->")
    assert in_start_pos >= 0, "-in:start marker missing"
    assert in_end_pos >= 0, "-in:end marker missing"

    # For "start outside, end inside": the -in annotation is inside the block.
    assert re_start <= in_start_pos < re_end, (
        f"-in:start ({in_start_pos}) must be inside scene 2 block "
        f"[{re_start}, {re_end})"
    )
    assert (
        re_start <= in_end_pos < re_end
    ), f"-in:end ({in_end_pos}) must be inside scene 2 block [{re_start}, {re_end})"
    assert in_start_pos < in_end_pos, "-in:start must precede -in:end"

    # ---- -out markers must be OUTSIDE scene 2's block ----
    out_start_pos = new_content.find("<!--annotation:note1-out:start-->")
    out_end_pos = new_content.find("<!--annotation:note1-out:end-->")
    assert out_start_pos >= 0, "-out:start marker missing"
    assert out_end_pos >= 0, "-out:end marker missing"
    assert out_end_pos <= re_start, (
        f"-out:end ({out_end_pos}) must be outside scene 2 block "
        f"at or before block start ({re_start})"
    )
    assert out_start_pos < out_end_pos, "-out:start must precede -out:end"


def test_create_annotation_snaps_offset_outside_marker() -> None:
    """Offsets that land inside a scene marker token are snapped to the
    marker boundary so the annotation is never inserted mid-marker."""
    import tempfile
    import json

    tmp = Path(tempfile.mkdtemp())
    story: dict[str, object] = {
        "metadata": {"version": 8},
        "project_title": "SnapTest",
        "project_type": "short-story",
        "format": "markdown",
        "scenes": {},
        "annotations": [],
    }
    (tmp / "story.json").write_text(json.dumps(story), encoding="utf-8")
    (tmp / "content.md").write_text(
        "<!--scene:1:start-->Hello World<!--scene:1:end-->", encoding="utf-8"
    )

    # Offset 3 is inside the start marker; backend should snap it to 20.
    ann = create_annotation(
        tmp,
        scope_type="story",
        chapter_id=None,
        book_id=None,
        start_offset=3,
        end_offset=25,
        comment="Snapped annotation",
    )
    # Start is snapped past the scene start marker.
    assert ann["start_offset"] is not None and ann["start_offset"] >= 20
    # End is valid prose; returned offset is in the new content after marker
    # injection, so it will be larger than the original 25.
    assert ann["end_offset"] is not None and ann["end_offset"] >= 25
    # Verify the annotated prose is "Hello".
    content = (tmp / "content.md").read_text(encoding="utf-8")
    prose = content[ann["start_offset"] : ann["end_offset"]]
    assert prose == "Hello"


def test_create_annotation_raises_when_entirely_within_marker() -> None:
    """When both start and end fall inside the same marker token, the
    snap reduces the range to zero width => ValueError."""
    import tempfile
    import json

    tmp = Path(tempfile.mkdtemp())
    story: dict[str, object] = {
        "metadata": {"version": 8},
        "project_title": "FailTest",
        "project_type": "short-story",
        "format": "markdown",
        "scenes": {},
        "annotations": [],
    }
    (tmp / "story.json").write_text(json.dumps(story), encoding="utf-8")
    (tmp / "content.md").write_text(
        "<!--scene:1:start-->Hello<!--scene:1:end-->", encoding="utf-8"
    )

    # Offset 3-10 is entirely inside the start marker (positions 0-19).
    with pytest.raises(ValueError, match="entirely within internal marker"):
        create_annotation(
            tmp,
            scope_type="story",
            chapter_id=None,
            book_id=None,
            start_offset=3,
            end_offset=10,
            comment="Should fail",
        )
