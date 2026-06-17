# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Inline prose–scene marker utilities.

Scene-to-prose boundaries are stored directly in the content files as HTML
comment markers::

    <!--scene:N:start-->prose content<!--scene:N:end-->

This module provides the canonical parse / inject / remove helpers for those
markers.  It performs only string operations – no file I/O.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_MARKER_RE = re.compile(r"<!--scene:(\d+):(start|end)-->")
_ANNOTATION_MARKER_RE = re.compile(r"<!--annotation:([^:>]+):(start|end)-->")
_INTERNAL_MARKER_RE = re.compile(
    r"<!--(?:scene:(\d+)|annotation:([^:>]+)):(start|end)-->"
)


@dataclass(frozen=True)
class SceneSpan:
    """Prose extent for a single scene derived from the content file markers.

    ``start`` is the offset of the first character *after* the start marker.
    ``end``   is the offset of the first character *of* the end marker.

    Both are character offsets in the full raw file content (markers included).
    ``content[span.start : span.end]`` therefore yields the prose text for the
    scene with no markers included.
    """

    scene_id: int
    start: int
    end: int


@dataclass(frozen=True)
class AnnotationSpan:
    """Prose extent for a single inline annotation derived from markers."""

    annotation_id: str
    start: int
    end: int


def parse_scene_spans(content: str) -> list[SceneSpan]:
    """Return all scene spans parsed from *content*, sorted by start offset.

    Unclosed start markers (no matching end) and orphaned end markers are
    silently ignored.
    """
    open_starts: dict[int, int] = {}
    spans: list[SceneSpan] = []
    for match in _MARKER_RE.finditer(content):
        scene_id = int(match.group(1))
        kind = match.group(2)
        if kind == "start":
            open_starts[scene_id] = match.end()
        elif kind == "end" and scene_id in open_starts:
            spans.append(
                SceneSpan(
                    scene_id=scene_id,
                    start=open_starts.pop(scene_id),
                    end=match.start(),
                )
            )
    return sorted(spans, key=lambda s: s.start)


def parse_annotation_spans(content: str) -> list[AnnotationSpan]:
    """Return all annotation spans parsed from *content*, sorted by start."""
    open_starts: dict[str, int] = {}
    spans: list[AnnotationSpan] = []
    for match in _ANNOTATION_MARKER_RE.finditer(content):
        annotation_id = match.group(1)
        kind = match.group(2)
        if kind == "start":
            open_starts[annotation_id] = match.end()
        elif kind == "end" and annotation_id in open_starts:
            spans.append(
                AnnotationSpan(
                    annotation_id=annotation_id,
                    start=open_starts.pop(annotation_id),
                    end=match.start(),
                )
            )
    return sorted(spans, key=lambda s: s.start)


def scene_marker_token(scene_id: int, edge: str) -> str:
    """Return canonical scene marker token for *scene_id* and *edge*."""
    return f"<!--scene:{scene_id}:{edge}-->"


def annotation_marker_token(annotation_id: str, edge: str) -> str:
    """Return canonical annotation marker token for *annotation_id* and *edge*."""
    return f"<!--annotation:{annotation_id}:{edge}-->"


def find_scene_marker_span(content: str, scene_id: int) -> SceneSpan | None:
    """Return the parsed scene prose span for *scene_id* or ``None``."""
    for span in parse_scene_spans(content):
        if span.scene_id == scene_id:
            return span
    return None


def scene_block_bounds(content: str, scene_id: int) -> tuple[int, int] | None:
    """Return marker-inclusive block bounds for *scene_id*.

    The returned tuple is ``(block_start, block_end)`` where ``block_start``
    points at the first character of ``<!--scene:N:start-->`` and
    ``block_end`` points after the final character of ``<!--scene:N:end-->``.
    """
    span = find_scene_marker_span(content, scene_id)
    if span is None:
        return None

    start_token = scene_marker_token(scene_id, "start")
    end_token = scene_marker_token(scene_id, "end")

    start_index = content.rfind(start_token, 0, span.start)
    if start_index < 0:
        return None
    end_index = content.find(end_token, span.end)
    if end_index < 0:
        return None

    return start_index, end_index + len(end_token)


def annotation_block_bounds(content: str, annotation_id: str) -> tuple[int, int] | None:
    """Return marker-inclusive block bounds for *annotation_id*."""
    for span in parse_annotation_spans(content):
        if span.annotation_id != annotation_id:
            continue
        start_token = annotation_marker_token(annotation_id, "start")
        end_token = annotation_marker_token(annotation_id, "end")
        start_index = content.rfind(start_token, 0, span.start)
        if start_index < 0:
            return None
        end_index = content.find(end_token, span.end)
        if end_index < 0:
            return None
        return start_index, end_index + len(end_token)
    return None


def inject_annotation_markers(
    content: str,
    assignments: list[tuple[str, int, int]],
) -> str:
    """Insert annotation markers into *content*.

    The semantics mirror :func:`inject_markers`, but use string annotation IDs
    instead of integer scene IDs.
    """
    sorted_assignments = sorted(assignments, key=lambda a: a[1])
    parts: list[str] = []
    cursor = 0
    for annotation_id, start, end in sorted_assignments:
        if start < cursor:
            raise ValueError(
                f"Overlapping annotation assignments: annotation {annotation_id} "
                f"starts at {start} but cursor is already at {cursor}."
            )
        parts.append(content[cursor:start])
        parts.append(annotation_marker_token(annotation_id, "start"))
        parts.append(content[start:end])
        parts.append(annotation_marker_token(annotation_id, "end"))
        cursor = end
    parts.append(content[cursor:])
    return "".join(parts)


def remove_annotation_markers(
    content: str,
    annotation_ids: set[str] | None = None,
) -> str:
    """Strip annotation markers from *content*."""
    if annotation_ids is None:
        return _ANNOTATION_MARKER_RE.sub("", content)
    if not annotation_ids:
        return content
    ids_pattern = "|".join(
        re.escape(annotation_id) for annotation_id in sorted(annotation_ids)
    )
    pattern = re.compile(rf"<!--annotation:(?:{ids_pattern}):(?:start|end)-->")
    return pattern.sub("", content)


def inject_markers(
    content: str,
    assignments: list[tuple[int, int, int]],
) -> str:
    """Insert scene markers into *content*.

    *assignments* is a list of ``(scene_id, start, end)`` tuples where
    ``start`` and ``end`` are character offsets in the *original* content
    (without any markers being inserted).  Assignments must not overlap;
    passing overlapping ranges raises ``ValueError``.

    Returns the modified content string with all markers embedded.
    """
    sorted_assignments = sorted(assignments, key=lambda a: a[1])
    parts: list[str] = []
    cursor = 0
    for scene_id, start, end in sorted_assignments:
        if start < cursor:
            raise ValueError(
                f"Overlapping scene assignments: scene {scene_id} "
                f"starts at {start} but cursor is already at {cursor}."
            )
        parts.append(content[cursor:start])
        parts.append(f"<!--scene:{scene_id}:start-->")
        parts.append(content[start:end])
        parts.append(f"<!--scene:{scene_id}:end-->")
        cursor = end
    parts.append(content[cursor:])
    return "".join(parts)


def remove_markers(
    content: str,
    scene_ids: set[int] | None = None,
) -> str:
    """Strip scene markers from *content*.

    If *scene_ids* is ``None``, all scene markers are removed; otherwise only
    markers for the specified scene IDs are removed.
    """
    if scene_ids is None:
        return _MARKER_RE.sub("", content)
    if not scene_ids:
        return content
    ids_pattern = "|".join(re.escape(str(sid)) for sid in sorted(scene_ids))
    pattern = re.compile(rf"<!--scene:(?:{ids_pattern}):(?:start|end)-->")
    return pattern.sub("", content)


def remap_offset_after_marker_removal(
    content: str,
    offset: int,
    scene_ids: set[int] | None = None,
) -> int:
    """Map a raw-content offset to its position after marker removal.

    ``offset`` is interpreted against *content* before marker removal.
    Returned value is the corresponding offset after removing markers for
    ``scene_ids`` (or all markers when ``scene_ids`` is ``None``).
    """
    clamped = max(0, min(offset, len(content)))
    removed_before = 0
    for match in _MARKER_RE.finditer(content):
        scene_id = int(match.group(1))
        if scene_ids is not None and scene_id not in scene_ids:
            continue
        marker_start = match.start()
        marker_end = match.end()
        marker_len = marker_end - marker_start
        if marker_end <= clamped:
            removed_before += marker_len
            continue
        if marker_start < clamped:
            # Offset falls inside a removed marker; collapse to marker_start.
            removed_before += clamped - marker_start
        break
    return clamped - removed_before


def validate_scene_marker_tokens(content: str) -> None:
    """Validate that every ``<!--scene:...`` token is syntactically complete.

    Raises ``ValueError`` when marker-like text exists but does not match the
    canonical ``<!--scene:<id>:(start|end)-->`` token shape.
    """
    search_pos = 0
    while True:
        marker_pos = content.find("<!--scene:", search_pos)
        if marker_pos < 0:
            return
        match = _MARKER_RE.match(content, marker_pos)
        if match is None:
            snippet = content[marker_pos : marker_pos + 60].replace("\n", "\\n")
            raise ValueError(f"Malformed scene marker token near: {snippet}")
        search_pos = match.end()


def validate_internal_marker_tokens(content: str) -> None:
    """Validate all supported internal marker tokens.

    Supported tags:
      - ``<!--scene:<id>:(start|end)-->``
      - ``<!--annotation:<id>:(start|end)-->``
    """
    search_pos = 0
    while True:
        marker_pos = content.find("<!--", search_pos)
        if marker_pos < 0:
            return
        if not (
            content.startswith("<!--scene:", marker_pos)
            or content.startswith("<!--annotation:", marker_pos)
        ):
            search_pos = marker_pos + 4
            continue
        match = _INTERNAL_MARKER_RE.match(content, marker_pos)
        if match is None:
            snippet = content[marker_pos : marker_pos + 80].replace("\n", "\\n")
            raise ValueError(f"Malformed internal marker token near: {snippet}")
        search_pos = match.end()


def validate_internal_marker_only_edit(original: str, edited: str) -> None:
    """Assert that *edited* differs from *original* only by internal markers."""
    cleaned_original = _INTERNAL_MARKER_RE.sub("", original)
    cleaned_edited = _INTERNAL_MARKER_RE.sub("", edited)
    if cleaned_original != cleaned_edited:
        raise ValueError(
            "Edited content modified prose text beyond internal marker insertion."
        )


def snap_offset_outside_markers(content: str, offset: int) -> int:
    """Return *offset* clamped so it never points inside a marker token.

    If ``offset`` lands inside ``<!--scene:...-->`` the value is moved to the
    marker end boundary to avoid splitting marker text during insertion.
    """
    clamped = max(0, min(offset, len(content)))
    for match in _MARKER_RE.finditer(content):
        if match.start() < clamped < match.end():
            return match.end()
    return clamped


def snap_range_outside_markers(
    content: str,
    start: int,
    end: int,
    ignored_scene_ids: set[int] | None = None,
) -> tuple[int, int]:
    """Return a safe non-empty range that does not overlap marker token text.

    The returned half-open range ``[start, end)`` is clamped to content bounds
    and shifted right when it intersects any ``<!--scene:...-->`` token.
    """
    content_len = len(content)
    safe_start = max(0, min(start, content_len))
    safe_end = max(0, min(end, content_len))
    if safe_start > safe_end:
        safe_end = safe_start

    ignored_ids = ignored_scene_ids or set()
    markers = [(match, int(match.group(1))) for match in _MARKER_RE.finditer(content)]

    # Move boundaries out of marker interiors first.
    for match, scene_id in markers:
        if scene_id in ignored_ids:
            continue
        if match.start() < safe_start < match.end():
            safe_start = match.end()
        if match.start() < safe_end < match.end():
            safe_end = match.end()
    # If the selected range still overlaps token bytes (including boundaries),
    # push it right until it lands in prose text.
    max_iterations = len(markers) + 2
    for _ in range(max_iterations):
        overlap = next(
            (
                marker
                for marker, scene_id in markers
                if scene_id not in ignored_ids
                and safe_start < marker.end()
                and safe_end > marker.start()
            ),
            None,
        )
        if overlap is None:
            break
        safe_start = overlap.end()
        safe_end = max(safe_end, safe_start)
        safe_start = max(0, min(safe_start, content_len))
        safe_end = max(0, min(safe_end, content_len))

    # Prefer a minimal non-empty prose range when possible. For marker-only
    # scopes this remains zero-width at the safe insertion boundary.
    if safe_start == safe_end and safe_start < content_len:
        candidate_end = safe_start + 1
        overlaps_candidate = any(
            scene_id not in ignored_ids
            and safe_start < marker.end()
            and candidate_end > marker.start()
            for marker, scene_id in markers
        )
        if not overlaps_candidate:
            safe_end = candidate_end

    return safe_start, safe_end


def transfer_scene_markers(existing_content: str, rewritten_content: str) -> str:
    """Transfer scene markers from existing prose to rewritten prose.

    If the rewritten content already contains valid scene spans, it is returned
    unchanged. Otherwise existing scene boundaries are projected onto the new
    prose by relative position in marker-stripped text and markers are injected
    back into the rewritten content.
    """
    existing_spans = parse_scene_spans(existing_content)
    if not existing_spans:
        return rewritten_content

    if parse_scene_spans(rewritten_content):
        return rewritten_content

    rewritten_plain = remove_markers(rewritten_content)
    existing_plain = remove_markers(existing_content)
    old_len = len(existing_plain)
    new_len = len(rewritten_plain)
    if old_len <= 0 or new_len <= 0:
        return rewritten_plain

    assignments: list[tuple[int, int, int]] = []
    prev_end = 0
    for span in existing_spans:
        old_start = remap_offset_after_marker_removal(
            existing_content, span.start, None
        )
        old_end = remap_offset_after_marker_removal(existing_content, span.end, None)

        mapped_start = int(round((old_start / old_len) * new_len))
        mapped_end = int(round((old_end / old_len) * new_len))

        mapped_start = max(prev_end, min(mapped_start, new_len))
        mapped_end = max(mapped_start, min(mapped_end, new_len))
        assignments.append((span.scene_id, mapped_start, mapped_end))
        prev_end = mapped_end

    return inject_markers(rewritten_plain, assignments)


def validate_marker_only_edit(original: str, edited: str) -> None:
    """Assert that *edited* differs from *original* only by marker insertions.

    Strips all scene markers from both strings and compares the remaining
    prose.  Raises ``ValueError`` if the non-marker content differs, which
    indicates the editor modified prose text beyond mere marker insertion.
    """
    cleaned_original = _MARKER_RE.sub("", original)
    cleaned_edited = _MARKER_RE.sub("", edited)
    if cleaned_original != cleaned_edited:
        raise ValueError(
            "Edited content modified prose text beyond scene marker insertion."
        )
