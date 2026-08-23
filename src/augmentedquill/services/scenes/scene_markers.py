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

import itertools
import re
from collections.abc import Callable
from dataclasses import dataclass

# ─── Generalized marker-layer engine ────────────────────────────────────────
#
# Every kind of inline prose marker (scene, annotation, and any future kind)
# shares one grammar:
#
#     <!--<layer>:<id>:start--> ... prose ... <!--<layer>:<id>:end-->
#
# A layer additionally declares whether its spans are *exclusive*:
#   - ``scene``      is exclusive      -> any part of the prose belongs to at
#                                          most one scene.
#   - ``annotation``  is non-exclusive -> any part of the prose may belong to
#                                          any number of annotations.
#
# `validate_marker_integrity()` is the single fail-safe choke point that
# enforces these invariants for every registered layer at once, and
# `inject_markers()` / `inject_annotation_markers()` call it on every result
# before returning -- so no caller anywhere in the codebase can make marker
# mutations reach disk in a corrupted or ambiguous state.  Introducing a new
# marker kind in the future only requires adding one `MarkerLayer` entry to
# `MARKER_LAYERS` plus thin public wrappers; the safety guarantees below are
# inherited automatically.


@dataclass(frozen=True)
class MarkerLayer:
    """Describes one inline-marker namespace (e.g. ``scene`` or ``annotation``)."""

    name: str
    id_pattern: str
    exclusive: bool
    parse_id: Callable[[str], object]


SCENE_LAYER = MarkerLayer(name="scene", id_pattern=r"\d+", exclusive=True, parse_id=int)
ANNOTATION_LAYER = MarkerLayer(
    name="annotation", id_pattern=r"[^:>]+", exclusive=False, parse_id=str
)

# Every marker layer known to the system.  Order matters only for error
# reporting determinism.
MARKER_LAYERS: tuple[MarkerLayer, ...] = (SCENE_LAYER, ANNOTATION_LAYER)


@dataclass(frozen=True)
class MarkerSpan:
    """Generic prose extent for one marker instance of any layer."""

    layer: str
    marker_id: object
    start: int
    end: int


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


def _layer_marker_re(layer: MarkerLayer) -> re.Pattern[str]:
    return re.compile(rf"<!--{layer.name}:({layer.id_pattern}):(start|end)-->")


_MARKER_RE = _layer_marker_re(SCENE_LAYER)
_ANNOTATION_MARKER_RE = _layer_marker_re(ANNOTATION_LAYER)
_INTERNAL_MARKER_RE = re.compile(
    r"<!--(?:scene:(\d+)|annotation:([^:>]+)):(start|end)-->"
)


def _marker_token(layer: MarkerLayer, marker_id: object, edge: str) -> str:
    return f"<!--{layer.name}:{marker_id}:{edge}-->"


def _parse_layer_spans(content: str, layer: MarkerLayer) -> list[MarkerSpan]:
    """Return all spans for *layer* parsed from *content*, sorted by start.

    This permissive parse silently ignores unclosed start markers and
    orphaned end markers -- it is meant for read paths that must keep working
    against whatever spans *are* well-formed.  Callers that mutate content
    must instead go through :func:`inject_markers` /
    :func:`inject_annotation_markers`, which reject malformed results via
    :func:`validate_marker_integrity` before ever returning them.
    """
    open_starts: dict[str, int] = {}
    spans: list[MarkerSpan] = []
    for match in _layer_marker_re(layer).finditer(content):
        raw_id = match.group(1)
        kind = match.group(2)
        if kind == "start":
            open_starts[raw_id] = match.end()
        elif kind == "end" and raw_id in open_starts:
            spans.append(
                MarkerSpan(
                    layer=layer.name,
                    marker_id=layer.parse_id(raw_id),
                    start=open_starts.pop(raw_id),
                    end=match.start(),
                )
            )
    return sorted(spans, key=lambda s: s.start)


def _inject_non_exclusive_spans(
    content: str,
    layer: MarkerLayer,
    assignments: list[tuple[object, int, int]],
) -> str:
    """Inject markers for a non-exclusive layer where spans may overlap.

    Uses an event-based approach: all start/end edges are collected,
    sorted by position (end before start at the same position), and
    marker tokens are emitted at each edge boundary.  This naturally
    handles interleaved/nested overlapping spans.
    """
    if not assignments:
        return content

    events: list[tuple[int, object, str]] = []
    for marker_id, start, end in assignments:
        if start < end:
            events.append((start, marker_id, "start"))
            events.append((end, marker_id, "end"))

    if not events:
        return content

    # Sort by position; at same position, 'end' before 'start' so
    # adjacent spans don't inadvertently overlap at the boundary.
    events.sort(key=lambda e: (e[0], 0 if e[2] == "end" else 1))

    parts: list[str] = []
    cursor = 0
    i = 0
    while i < len(events):
        pos = events[i][0]
        if pos > cursor:
            parts.append(content[cursor:pos])
            cursor = pos
        # Emit all marker tokens at this position
        while i < len(events) and events[i][0] == pos:
            _, marker_id, kind = events[i]
            parts.append(_marker_token(layer, marker_id, kind))
            i += 1

    if cursor < len(content):
        parts.append(content[cursor:])
    return "".join(parts)


def _inject_layer_spans(
    content: str,
    layer: MarkerLayer,
    assignments: list[tuple[object, int, int]],
) -> str:
    """Insert *layer* markers into *content* for each ``(id, start, end)``.

    ``start``/``end`` are offsets in the original *content*.

    For *exclusive* layers (``scene``) assignments must not overlap each other;
    overlap raises ``ValueError`` immediately.

    For *non-exclusive* layers (``annotation``) overlapping assignments are
    handled via an event-based injection that interleaves start/end markers
    naturally.

    Overlap with markers already present in *content* (from a different,
    unrelated span) is caught by the caller via :func:`validate_marker_integrity`.
    """
    if not layer.exclusive:
        return _inject_non_exclusive_spans(content, layer, assignments)

    sorted_assignments = sorted(assignments, key=lambda a: a[1])
    parts: list[str] = []
    cursor = 0
    for marker_id, start, end in sorted_assignments:
        if start < cursor:
            raise ValueError(
                f"Overlapping {layer.name} assignments: {layer.name} {marker_id} "
                f"starts at {start} but cursor is already at {cursor}."
            )
        parts.append(content[cursor:start])
        parts.append(_marker_token(layer, marker_id, "start"))
        parts.append(content[start:end])
        parts.append(_marker_token(layer, marker_id, "end"))
        cursor = end
    parts.append(content[cursor:])
    return "".join(parts)


def _remove_layer_markers(
    content: str,
    layer: MarkerLayer,
    ids: set[object] | None = None,
) -> str:
    if ids is None:
        return _layer_marker_re(layer).sub("", content)
    if not ids:
        return content
    ids_pattern = "|".join(
        re.escape(str(marker_id)) for marker_id in sorted(map(str, ids))
    )
    pattern = re.compile(rf"<!--{layer.name}:(?:{ids_pattern}):(?:start|end)-->")
    return pattern.sub("", content)


def _layer_block_bounds(
    content: str, layer: MarkerLayer, marker_id: object
) -> tuple[int, int] | None:
    for span in _parse_layer_spans(content, layer):
        if span.marker_id != marker_id:
            continue
        start_token = _marker_token(layer, marker_id, "start")
        end_token = _marker_token(layer, marker_id, "end")
        start_index = content.rfind(start_token, 0, span.start)
        if start_index < 0:
            return None
        end_index = content.find(end_token, span.end)
        if end_index < 0:
            return None
        return start_index, end_index + len(end_token)
    return None


def validate_marker_integrity(content: str) -> None:
    """Fail-safe gate: raise ``ValueError`` if *content* violates any marker
    invariant.

    This is the single choke point that guarantees the two independent
    marker layers can never corrupt the prose or each other, and that any
    future layer added to :data:`MARKER_LAYERS` gets the same guarantees for
    free.  Enforced invariants:

    1. Token shape -- every marker-like ``<!--...-->`` fragment is a
       syntactically complete, canonical token (delegates to
       :func:`validate_internal_marker_tokens`).
    2. Balance -- every start marker has exactly one matching end marker; no
       unclosed starts, no orphaned ends, no duplicate opens for the same id.
    3. Exclusivity -- for layers with ``exclusive=True`` (``scene``), no two
       spans of that layer may overlap: any part of the prose belongs to at
       most one scene.  Non-exclusive layers (``annotation``) may overlap
       arbitrarily by design.

    :func:`inject_markers` and :func:`inject_annotation_markers` call this on
    every result before returning it, so callers only ever need to invoke
    those functions to get an integrity guarantee -- no call site elsewhere
    in the codebase needs to remember to validate anything itself.
    """
    validate_internal_marker_tokens(content)

    for layer in MARKER_LAYERS:
        pattern = _layer_marker_re(layer)
        open_starts: dict[str, int] = {}
        spans: list[tuple[int, int]] = []
        for match in pattern.finditer(content):
            raw_id = match.group(1)
            kind = match.group(2)
            if kind == "start":
                if raw_id in open_starts:
                    raise ValueError(
                        f"Malformed {layer.name} markers: {layer.name} "
                        f"{raw_id!r} has two unmatched start markers."
                    )
                open_starts[raw_id] = match.end()
            else:
                start = open_starts.pop(raw_id, None)
                if start is None:
                    raise ValueError(
                        f"Malformed {layer.name} markers: orphaned end marker "
                        f"for {layer.name} {raw_id!r}."
                    )
                spans.append((start, match.start()))

        if open_starts:
            unclosed = ", ".join(repr(k) for k in sorted(open_starts))
            raise ValueError(
                f"Malformed {layer.name} markers: unclosed start marker(s) for "
                f"{layer.name} {unclosed}."
            )

        if layer.exclusive:
            ordered = sorted(spans)
            for previous, current in itertools.pairwise(ordered):
                if current[0] < previous[1]:
                    raise ValueError(
                        f"Overlapping {layer.name} spans detected: any part of "
                        f"the prose may belong to at most one {layer.name} "
                        f"({previous} overlaps {current})."
                    )


def parse_scene_spans(content: str) -> list[SceneSpan]:
    """Return all scene spans parsed from *content*, sorted by start offset.

    Unclosed start markers (no matching end) and orphaned end markers are
    silently ignored.
    """
    return [
        SceneSpan(scene_id=span.marker_id, start=span.start, end=span.end)  # type: ignore[arg-type]
        for span in _parse_layer_spans(content, SCENE_LAYER)
    ]


def parse_annotation_spans(content: str) -> list[AnnotationSpan]:
    """Return all annotation spans parsed from *content*, sorted by start."""
    return [
        AnnotationSpan(annotation_id=span.marker_id, start=span.start, end=span.end)  # type: ignore[arg-type]
        for span in _parse_layer_spans(content, ANNOTATION_LAYER)
    ]


def scene_marker_token(scene_id: int, edge: str) -> str:
    """Return canonical scene marker token for *scene_id* and *edge*."""
    return _marker_token(SCENE_LAYER, scene_id, edge)


def annotation_marker_token(annotation_id: str, edge: str) -> str:
    """Return canonical annotation marker token for *annotation_id* and *edge*."""
    return _marker_token(ANNOTATION_LAYER, annotation_id, edge)


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
    return _layer_block_bounds(content, SCENE_LAYER, scene_id)


def annotation_block_bounds(content: str, annotation_id: str) -> tuple[int, int] | None:
    """Return marker-inclusive block bounds for *annotation_id*."""
    return _layer_block_bounds(content, ANNOTATION_LAYER, annotation_id)


def inject_annotation_markers(
    content: str,
    assignments: list[tuple[str, int, int]],
) -> str:
    """Insert annotation markers into *content*.

    The semantics mirror :func:`inject_markers`, but use string annotation IDs
    instead of integer scene IDs, and annotations are non-exclusive: they may
    overlap each other and may straddle scene boundaries.

    Raises ``ValueError`` (via :func:`validate_marker_integrity`) instead of
    ever returning corrupted marker content.
    """
    result = _inject_layer_spans(
        content,
        ANNOTATION_LAYER,
        list(assignments),  # type: ignore[arg-type]
    )
    validate_marker_integrity(result)
    return result


def remove_annotation_markers(
    content: str,
    annotation_ids: set[str] | None = None,
) -> str:
    """Strip annotation markers from *content*."""
    return _remove_layer_markers(content, ANNOTATION_LAYER, annotation_ids)  # type: ignore[arg-type]


def strip_internal_markers(content: str) -> str:
    """Strip all internal inline markers (scene + annotation) from *content*.

    This is the backend equivalent of the frontend's
    ``stripInlineInternalMarkers``.  Use it whenever prose is prepared for an
    LLM-facing surface (prompt tails, anchors, tool-read content) so internal
    marker tokens never leak into prompts or model output.
    """
    return remove_annotation_markers(remove_markers(content))


def inject_markers(
    content: str,
    assignments: list[tuple[int, int, int]],
) -> str:
    """Insert scene markers into *content*.

    *assignments* is a list of ``(scene_id, start, end)`` tuples where
    ``start`` and ``end`` are character offsets in the *original* content
    (without any markers being inserted).  Assignments must not overlap each
    other; passing overlapping ranges raises ``ValueError``.

    Inverted spans (``end < start``) are rejected with ``ValueError``.

    After injection, if the result contains *only* marker tokens with no
    prose content and more than one scene is being assigned, a
    ``ValueError`` is raised to prevent data corruption where an entire
    file is replaced by adjacent start/end markers.

    The result is additionally required to satisfy scene exclusivity against
    *any* scene markers already present in *content* (not just the new
    assignments) and to keep every marker (scene and annotation) balanced and
    well-formed -- see :func:`validate_marker_integrity`.  This makes the
    function fail-closed: it either returns content that is guaranteed safe
    to persist, or raises ``ValueError`` and returns nothing.
    """
    for scene_id, start, end in assignments:
        if end < start:
            raise ValueError(
                f"Scene {scene_id}: invalid span [{start}, {end}) — "
                f"end must be >= start"
            )
    result = _inject_layer_spans(content, SCENE_LAYER, list(assignments))  # type: ignore[arg-type]
    validate_marker_integrity(result)
    # Prevent data corruption: if the result has NO non-marker prose and
    # multiple scenes were assigned, the file would be pure markers.
    non_marker = _MARKER_RE.sub("", result).strip()
    if len(non_marker) == 0 and len(assignments) > 1:
        raise ValueError(
            "Refusing to produce a marker-only result with no prose content "
            f"for {len(assignments)} scenes.  Provide non-empty prose text "
            "to link scenes to."
        )
    return result


def remove_markers(
    content: str,
    scene_ids: set[int] | None = None,
) -> str:
    """Strip scene markers from *content*.

    If *scene_ids* is ``None``, all scene markers are removed; otherwise only
    markers for the specified scene IDs are removed.
    """
    return _remove_layer_markers(content, SCENE_LAYER, scene_ids)  # type: ignore[arg-type]


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
    safe_end = max(safe_end, safe_start)

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

        mapped_start = round((old_start / old_len) * new_len)
        mapped_end = round((old_end / old_len) * new_len)

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
