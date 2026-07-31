# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Annotation service – CRUD for inline text annotations.

Annotations are stored as:
- Inline HTML comment markers in prose files:
    ``<!--annotation:ID:start-->annotated text<!--annotation:ID:end-->``
- Metadata (id, comment, scope) in ``story.json`` under the ``annotations`` key.

Offsets (``start_offset``, ``end_offset``) are computed at read time by
parsing the prose file – they are never persisted in ``story.json``.

Annotations are properties of text, not of scenes.  They can straddle scene
boundaries and survive scene reordering as long as both markers remain in the
same prose file.  When a scene-reorder moves markers to different positions,
the service is responsible for either validating the result or splitting an
annotation that becomes malformed (end before start).
"""

from __future__ import annotations

import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Any, Literal

from augmentedquill.core.config import load_story_config, save_story_config
from augmentedquill.services.scenes.scene_markers import (
    annotation_block_bounds,
    annotation_marker_token,
    inject_annotation_markers,
    parse_annotation_spans,
    remove_annotation_markers,
    validate_internal_marker_tokens,
)

# ─── Private helpers ─────────────────────────────────────────────────────────

_ANN_RE = re.compile(r"<!--annotation:([^:>]+):(start|end)-->")

_SCOPE_LITERAL = Literal["story", "chapter", "unlinked"]

ANNOTATION_COMMENT_MAX_LEN = 4096


def _write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    replaced = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, delete=False
        ) as tmp:
            tmp.write(text)
            temp_path = Path(tmp.name)
        os.replace(temp_path, path)
        replaced = True
    finally:
        if temp_path is not None and temp_path.exists() and not replaced:
            temp_path.unlink(missing_ok=True)


def _read_validated_content(path: Path) -> str:
    content = path.read_text(encoding="utf-8")
    validate_internal_marker_tokens(content)
    return content


def _scope_content_path(
    project_dir: Path,
    scope_type: str,
    chapter_id: str | None,
    book_id: str | None,
) -> Path | None:
    """Resolve the prose file path for an annotation scope (same logic as scene service)."""
    from augmentedquill.services.scenes.scene_service import _scene_content_path

    return _scene_content_path(
        project_dir,
        {
            "scope_type": scope_type,
            "chapter_id": chapter_id or None,
            "book_id": book_id or None,
        },
    )


def _load_annotations_from_story(story: dict[str, Any]) -> list[dict[str, Any]]:
    raw = story.get("annotations")
    if not isinstance(raw, list):
        return []
    result: list[dict[str, Any]] = []
    for item in raw:
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"]:
            result.append(item)
    return result


def _migrate_project(project_dir: Path) -> None:
    """Ensure project is migrated to current schema before annotation ops."""
    from augmentedquill.services.scenes.scene_service import _migrate_project_latest
    from augmentedquill.updates.migrate_story_v9 import migrate_project_v9

    _migrate_project_latest(project_dir)
    migrate_project_v9(project_dir)


def _derive_runtime_offsets(
    project_dir: Path,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Attach start_offset / end_offset from prose file markers (not persisted)."""
    scope_type = meta.get("scope_type", "story")
    chapter_id = meta.get("chapter_id") or None
    book_id = meta.get("book_id") or None
    ann_id = meta["id"]

    content_path = _scope_content_path(project_dir, scope_type, chapter_id, book_id)
    if content_path is None or not content_path.exists():
        return {**meta, "start_offset": None, "end_offset": None}

    try:
        content = content_path.read_text(encoding="utf-8")
    except OSError:
        return {**meta, "start_offset": None, "end_offset": None}

    for span in parse_annotation_spans(content):
        if span.annotation_id == ann_id:
            return {**meta, "start_offset": span.start, "end_offset": span.end}

    return {**meta, "start_offset": None, "end_offset": None}


# ─── Public CRUD API ─────────────────────────────────────────────────────────


def list_annotations(project_dir: Path) -> list[dict[str, Any]]:
    """Return all project annotations with runtime offsets attached."""
    _migrate_project(project_dir)
    story = load_story_config(project_dir / "story.json") or {}
    meta_list = _load_annotations_from_story(story)
    return [_derive_runtime_offsets(project_dir, m) for m in meta_list]


def list_annotations_for_scope(
    project_dir: Path,
    scope_type: str,
    chapter_id: str | None,
    book_id: str | None,
) -> list[dict[str, Any]]:
    """Return annotations for a single prose scope, with runtime offsets."""
    all_anns = list_annotations(project_dir)
    normalised_chapter = (chapter_id or "").strip() or None
    normalised_book = (book_id or "").strip() or None
    return [
        a
        for a in all_anns
        if a.get("scope_type") == scope_type
        and (a.get("chapter_id") or None) == normalised_chapter
        and (a.get("book_id") or None) == normalised_book
    ]


def create_annotation(
    project_dir: Path,
    *,
    scope_type: str,
    chapter_id: str | None,
    book_id: str | None,
    start_offset: int,
    end_offset: int,
    comment: str,
) -> dict[str, Any]:
    """Create an annotation: inject markers in prose + persist metadata.

    ``start_offset`` and ``end_offset`` are character positions in the *raw*
    content file (markers included).  They are snapped outside any existing
    internal marker tokens automatically.
    """
    if not isinstance(comment, str):
        raise ValueError("comment must be a string")
    comment = comment[:ANNOTATION_COMMENT_MAX_LEN]

    if start_offset >= end_offset:
        raise ValueError("start_offset must be less than end_offset")

    _migrate_project(project_dir)
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}

    content_path = _scope_content_path(project_dir, scope_type, chapter_id, book_id)
    if content_path is None:
        raise ValueError(f"Cannot resolve content path for scope {scope_type!r}")
    if not content_path.exists():
        content_path.parent.mkdir(parents=True, exist_ok=True)
        content_path.write_text("", encoding="utf-8")

    content = _read_validated_content(content_path)
    clen = len(content)
    safe_start = max(0, min(start_offset, clen))
    safe_end = max(safe_start, min(end_offset, clen))

    # Snap boundaries outside any internal marker tokens.
    from augmentedquill.services.scenes.scene_markers import _INTERNAL_MARKER_RE

    for m in _INTERNAL_MARKER_RE.finditer(content):
        if m.start() < safe_start < m.end():
            safe_start = m.end()
        if m.start() < safe_end < m.end():
            safe_end = m.end()
    if safe_start >= safe_end:
        raise ValueError("Annotation range is entirely within internal marker tokens.")

    annotation_id = f"annot-{uuid.uuid4().hex[:12]}"

    new_content = inject_annotation_markers(
        content, [(annotation_id, safe_start, safe_end)]
    )
    _write_atomic(content_path, new_content)

    # Reload to confirm the actual span.
    actual_start: int | None = None
    actual_end: int | None = None
    for span in parse_annotation_spans(new_content):
        if span.annotation_id == annotation_id:
            actual_start, actual_end = span.start, span.end
            break

    meta: dict[str, Any] = {
        "id": annotation_id,
        "comment": comment,
        "scope_type": scope_type,
        "chapter_id": (chapter_id or "").strip() or None,
        "book_id": (book_id or "").strip() or None,
    }

    annotations = _load_annotations_from_story(story)
    annotations.append(meta)
    story["annotations"] = annotations
    save_story_config(story_path, story)

    return {**meta, "start_offset": actual_start, "end_offset": actual_end}


def get_annotation(project_dir: Path, annotation_id: str) -> dict[str, Any] | None:
    """Return a single annotation with runtime offsets, or None if not found."""
    _migrate_project(project_dir)
    story = load_story_config(project_dir / "story.json") or {}
    meta_list = _load_annotations_from_story(story)
    meta = next((m for m in meta_list if m.get("id") == annotation_id), None)
    if meta is None:
        return None
    return _derive_runtime_offsets(project_dir, meta)


def update_annotation(
    project_dir: Path,
    annotation_id: str,
    *,
    comment: str,
) -> dict[str, Any] | None:
    """Update an annotation's comment text.  Returns None if not found."""
    if not isinstance(comment, str):
        raise ValueError("comment must be a string")

    _migrate_project(project_dir)
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}
    annotations = _load_annotations_from_story(story)

    idx = next(
        (i for i, m in enumerate(annotations) if m.get("id") == annotation_id), None
    )
    if idx is None:
        return None

    annotations[idx] = {
        **annotations[idx],
        "comment": comment[:ANNOTATION_COMMENT_MAX_LEN],
    }
    story["annotations"] = annotations
    save_story_config(story_path, story)

    return _derive_runtime_offsets(project_dir, annotations[idx])


def delete_annotation(project_dir: Path, annotation_id: str) -> bool:
    """Delete an annotation: remove markers from prose + remove metadata.

    Returns True when the annotation existed and was deleted.
    """
    _migrate_project(project_dir)
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}
    annotations = _load_annotations_from_story(story)

    meta = next((m for m in annotations if m.get("id") == annotation_id), None)
    if meta is None:
        return False

    scope_type = meta.get("scope_type", "story")
    chapter_id = meta.get("chapter_id") or None
    book_id = meta.get("book_id") or None

    content_path = _scope_content_path(project_dir, scope_type, chapter_id, book_id)
    if content_path is not None and content_path.exists():
        try:
            content = _read_validated_content(content_path)
            cleaned = remove_annotation_markers(content, {annotation_id})
            if cleaned != content:
                _write_atomic(content_path, cleaned)
        except OSError:
            pass

    story["annotations"] = [m for m in annotations if m.get("id") != annotation_id]
    save_story_config(story_path, story)
    return True


# ─── Annotation splitting for scene reorder ──────────────────────────────────


def split_straddling_annotations(
    content: str,
    block_start: int,
    block_end: int,
    annotation_meta: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """Split annotations that straddle the boundary of a scene block.

    Call this *before* moving a scene block so that after the move all
    annotation start/end pairs remain in document order.

    Returns ``(new_content, updated_annotation_meta)``.

    For each straddling annotation:
    - The portion inside the block gets a new id ``<orig>-in``.
    - The portion outside the block gets a new id ``<orig>-out``.
    - Both new annotations carry the full original comment.
    - The original annotation id is removed.
    """
    spans = parse_annotation_spans(content)
    straddlers = [
        s
        for s in spans
        if (block_start <= s.start < block_end) != (block_start < s.end <= block_end)
    ]
    if not straddlers:
        return content, annotation_meta

    new_content = content
    new_meta = list(annotation_meta)

    # Regex to find scene markers at boundary positions.
    _SCENE_MARKER_AT = re.compile(r"<!--scene:\d+:(start|end)-->")

    # Process straddlers right-to-left to preserve offsets.
    # For each straddler collect the char-level replacement ops and apply them
    # all in one pass, sorted by descending position.
    char_ops: list[tuple[int, int, str]] = []

    for span in straddlers:
        ann_id = span.annotation_id
        bounds = annotation_block_bounds(new_content, ann_id)
        if bounds is None:
            continue

        start_inside = block_start <= span.start < block_end

        start_tok = annotation_marker_token(ann_id, "start")
        end_tok = annotation_marker_token(ann_id, "end")

        orig_s = new_content.rfind(start_tok, 0, span.start + len(start_tok) + 1)
        orig_e = new_content.find(end_tok, span.end)
        if orig_s < 0 or orig_e < 0:
            continue

        part_in = f"{ann_id}-in"
        part_out = f"{ann_id}-out"

        # Determine scene marker lengths at the boundary so split markers
        # can be placed on the correct side of the marker (inside vs outside
        # the block).  This is critical: -in markers must stay INSIDE the
        # scene block so they move with the block during a reorder; -out
        # markers must stay OUTSIDE.
        scene_end_match = _SCENE_MARKER_AT.search(
            new_content, max(0, block_end - 60), block_end
        )
        scene_start_match = _SCENE_MARKER_AT.search(
            new_content, block_start, block_start + 60
        )
        end_marker_len = len(scene_end_match.group(0)) if scene_end_match else 0
        start_marker_len = len(scene_start_match.group(0)) if scene_start_match else 0

        if start_inside:
            # start inside block → end is outside.
            # Replace start token with -in:start (inside block).
            #   Insert -in:end   at block_end - len(end_marker)  (before scene end, inside block)
            #   Insert -out:start at block_end                    (after  scene end, outside block)
            # Replace end   token with -out:end   (outside block).
            new_start_tok = annotation_marker_token(part_in, "start")
            new_end_tok = annotation_marker_token(part_out, "end")
            inside_split_pos = block_end - end_marker_len  # before scene end marker
            char_ops.append((orig_e, orig_e + len(end_tok), new_end_tok))
            char_ops.append(
                (block_end, block_end, annotation_marker_token(part_out, "start"))
            )
            char_ops.append(
                (
                    inside_split_pos,
                    inside_split_pos,
                    annotation_marker_token(part_in, "end"),
                )
            )
            char_ops.append((orig_s, orig_s + len(start_tok), new_start_tok))
        else:
            # start outside block → end is inside.
            # Replace start token with -out:start (outside block).
            #   Insert -out:end   at block_start                     (before scene start, outside block)
            #   Insert -in:start  at block_start + len(start_marker) (after  scene start, inside  block)
            # Replace end   token with -in:end     (inside block).
            new_start_tok = annotation_marker_token(part_out, "start")
            new_end_tok = annotation_marker_token(part_in, "end")
            inside_split_pos = (
                block_start + start_marker_len
            )  # after scene start marker
            char_ops.append((orig_e, orig_e + len(end_tok), new_end_tok))
            char_ops.append(
                (
                    inside_split_pos,
                    inside_split_pos,
                    annotation_marker_token(part_in, "start"),
                )
            )
            char_ops.append(
                (block_start, block_start, annotation_marker_token(part_out, "end"))
            )
            char_ops.append((orig_s, orig_s + len(start_tok), new_start_tok))

        # Update metadata
        orig = next((m for m in new_meta if m.get("id") == ann_id), None)
        comment = orig.get("comment", "") if orig else ""
        scope_type = orig.get("scope_type", "story") if orig else "story"
        chapter_id = orig.get("chapter_id") if orig else None
        book_id = orig.get("book_id") if orig else None

        new_meta = [m for m in new_meta if m.get("id") != ann_id]
        new_meta.append(
            {
                "id": part_in,
                "comment": comment,
                "scope_type": scope_type,
                "chapter_id": chapter_id,
                "book_id": book_id,
            }
        )
        new_meta.append(
            {
                "id": part_out,
                "comment": comment,
                "scope_type": scope_type,
                "chapter_id": chapter_id,
                "book_id": book_id,
            }
        )

    # Apply char ops from right to left to preserve offsets.
    char_ops.sort(key=lambda op: op[0], reverse=True)
    result = new_content
    for op_start, op_end, replacement in char_ops:
        result = result[:op_start] + replacement + result[op_end:]

    return result, new_meta
