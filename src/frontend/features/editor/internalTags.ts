// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Shared inline internal-tag grammar helpers used by editor and scene features.
 *
 * ─── Generalized marker-layer model ─────────────────────────────────────────
 *
 * Every kind of inline prose marker (scene, annotation, and any future kind)
 * shares one grammar: `<!--<layer>:<id>:start-->` ... prose ...
 * `<!--<layer>:<id>:end-->`.  A layer additionally declares whether its spans
 * are *exclusive*:
 *   - `scene`      is exclusive     -> any part of the prose belongs to at
 *                                       most one scene.
 *   - `annotation`  is non-exclusive -> any part of the prose may belong to
 *                                       any number of annotations.
 *
 * This file is the single, small, encapsulated home for that grammar plus the
 * only two primitives needed to translate between "full" content (markers
 * present) and "visible" content (markers stripped): `toVisibleOffset` and
 * `toOriginalOffset`.  All other modules (scene coordinate mapping, the
 * annotation CodeMirror plugin, drag utilities, ...) must go through these
 * functions rather than re-implementing marker-walking arithmetic themselves.
 * `validateMarkerIntegrity` is the fail-safe gate that rejects corrupted or
 * ambiguous marker content before it can be used to compute positions.
 */

import { diff_match_patch } from 'diff-match-patch';

export type SceneMarkerEdge = 'start' | 'end';
export type MarkerLayerName = 'scene' | 'annotation';

/** Whether at most one span of a layer may cover any given prose position. */
export const MARKER_LAYER_EXCLUSIVE: Readonly<Record<MarkerLayerName, boolean>> = {
  scene: true,
  annotation: false,
};

export const INLINE_SCENE_MARKER_REGEX = /<!--scene:[^:>]+:(?:start|end)-->/g;
export const INLINE_ANNOTATION_MARKER_REGEX = /<!--annotation:[^:>]+:(?:start|end)-->/g;
export const INLINE_INTERNAL_MARKER_REGEX =
  /<!--(?:scene|annotation):[^:>]+:(?:start|end)-->/g;

/** Matches one internal marker token, capturing its layer, id, and edge. */
const INTERNAL_MARKER_CAPTURE_REGEX = /<!--(scene|annotation):([^:>]+):(start|end)-->/g;

export function hasInlineSceneMarkers(text: string): boolean {
  return /<!--scene:[^:>]+:(?:start|end)-->/.test(text);
}

/** True when *text* contains any internal marker of any layer (scene or annotation). */
export function hasInlineInternalMarkers(text: string): boolean {
  return /<!--(?:scene|annotation):[^:>]+:(?:start|end)-->/.test(text);
}

export function sceneMarkerToken(
  sceneId: string | number,
  edge: SceneMarkerEdge
): string {
  return `<!--scene:${String(sceneId)}:${edge}-->`;
}

export function sceneMarkerTokenLength(
  sceneId: string | number,
  edge: SceneMarkerEdge
): number {
  return sceneMarkerToken(sceneId, edge).length;
}

/**
 * Generic marker-span lookup shared by every layer: finds the first
 * `<!--layer:id:start-->...<!--layer:id:end-->` pair in *sourceText* and
 * returns the prose range *between* the markers, or `null` when absent.
 */
function getMarkerSpanRange(
  sourceText: string,
  layer: MarkerLayerName,
  markerId: string | number
): { from: number; to: number } | null {
  const startToken = `<!--${layer}:${String(markerId)}:start-->`;
  const endToken = `<!--${layer}:${String(markerId)}:end-->`;
  const markerStart = sourceText.indexOf(startToken);
  if (markerStart < 0) {
    return null;
  }
  const contentStart = markerStart + startToken.length;
  const markerEnd = sourceText.indexOf(endToken, contentStart);
  if (markerEnd < contentStart) {
    return null;
  }
  return { from: contentStart, to: markerEnd };
}

export function getSceneMarkerSpanRange(
  sourceText: string,
  sceneId: string | number
): { from: number; to: number } | null {
  return getMarkerSpanRange(sourceText, 'scene', sceneId);
}

export function stripInlineInternalMarkers(text: string): string {
  return text.replaceAll(INLINE_INTERNAL_MARKER_REGEX, '');
}

// ─── Annotation marker helpers ──────────────────────────────────────────────

export function annotationMarkerToken(
  annotationId: string,
  edge: 'start' | 'end'
): string {
  return `<!--annotation:${annotationId}:${edge}-->`;
}

/**
 * Find annotation marker span in source text.  Returns absolute document
 * offsets `{from, to}` describing the prose *between* the markers, or null
 * when this annotation's markers are absent from the text.
 */
export function getAnnotationMarkerSpanRange(
  sourceText: string,
  annotationId: string
): { from: number; to: number } | null {
  return getMarkerSpanRange(sourceText, 'annotation', annotationId);
}

// ─── Marker transfer ───────────────────────────────────────────────────────

interface MarkerSpan {
  /** The full marker token including brackets, e.g. `<!--scene:1:start-->` */
  startToken: string;
  endToken: string;
  /** Raw (marker-inclusive) offset of the first prose char after the start token. */
  proseStart: number;
  /** Raw (marker-inclusive) offset just past the last prose char (the end token's position). */
  proseEnd: number;
  /** The prose text between the markers in the old content. */
  prose: string;
}

/**
 * Parse all internal marker spans (scene + annotation) from *content*.
 * Returns spans in order of appearance.
 */
function parseAllMarkerSpans(content: string): MarkerSpan[] {
  const spans: MarkerSpan[] = [];
  const regex = new RegExp(INLINE_INTERNAL_MARKER_REGEX.source, 'g');
  const openStarts: Array<{
    startToken: string;
    endToken: string;
    proseStart: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const fullToken = match[0];
    const isStart = fullToken.endsWith(':start-->');
    const endToken = fullToken.replace(':start-->', ':end-->');

    if (isStart) {
      openStarts.push({
        startToken: fullToken,
        endToken,
        proseStart: match.index + fullToken.length,
      });
    } else {
      // end marker — find matching start
      const startMarker = fullToken.replace(':end-->', ':start-->');
      for (let i = openStarts.length - 1; i >= 0; i--) {
        if (openStarts[i].startToken === startMarker) {
          const opened = openStarts[i];
          openStarts.splice(i, 1);
          spans.push({
            startToken: opened.startToken,
            endToken: fullToken,
            proseStart: opened.proseStart,
            proseEnd: match.index,
            prose: content.slice(opened.proseStart, match.index),
          });
          break;
        }
      }
    }
  }
  return spans;
}

/**
 * Build a function mapping every position of *oldText* to the corresponding
 * position of *newText* after the edit, using a diff-match-patch alignment.
 *
 * The returned mapper is exact for unchanged regions and shifts positions
 * correctly across insertions and deletions (insertions push the boundary
 * right, deletions pull it left).  Positions that fell inside deleted text
 * map to the deletion anchor.
 */
function buildVisibleEditMapping(
  oldText: string,
  newText: string
): (oldPos: number) => number {
  const dmp = new diff_match_patch();
  dmp.Diff_Timeout = 0.5;
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  const map = new Array<number>(oldText.length + 1);
  let oldCursor = 0;
  let newCursor = 0;
  for (const [op, text] of diffs) {
    if (op === 0) {
      for (let i = 0; i < text.length; i++) {
        map[oldCursor + i] = newCursor + i;
      }
      oldCursor += text.length;
      newCursor += text.length;
    } else if (op === -1) {
      for (let i = 0; i < text.length; i++) {
        map[oldCursor + i] = newCursor;
      }
      oldCursor += text.length;
    } else {
      newCursor += text.length;
    }
  }
  map[oldText.length] = newCursor;

  return (oldPos: number): number => {
    const clamped = Math.max(0, Math.min(oldPos, oldText.length));
    const mapped = map[clamped];
    return mapped === undefined
      ? newCursor
      : Math.max(0, Math.min(mapped, newText.length));
  };
}

/**
 * Transfer internal markers (scene + annotation) from *oldFullContent* to
 * *newStrippedContent*.
 *
 * Every marker boundary is moved through the user's edit by aligning the old
 * and new VISIBLE documents with a diff and mapping each boundary's old
 * position to its new position.  This keeps markers correctly attached when
 * the user inserts or deletes text INSIDE a span (the prose between the
 * markers changes, so exact-prose matching would silently drop the markers
 * and unlink the scene/annotation — data corruption).
 *
 * When a span's entire prose is deleted the markers are kept as an empty
 * adjacent pair so the scene/annotation stays linked instead of silently
 * disappearing.
 *
 * Returns the new content with markers re-injected.
 */
export function transferInternalMarkers(
  oldFullContent: string,
  newStrippedContent: string
): string {
  const spans = parseAllMarkerSpans(oldFullContent);
  if (spans.length === 0) {
    return newStrippedContent;
  }

  const oldStripped = stripInlineInternalMarkers(oldFullContent);
  const mapVisible = buildVisibleEditMapping(oldStripped, newStrippedContent);

  // Collect every marker boundary as an individual token insertion in the
  // coordinate space of the ORIGINAL stripped content.  Injecting tokens
  // (instead of wrapping a fixed-width slice) keeps nested/overlapping
  // markers from cutting through each other.
  interface MarkerToken {
    pos: number;
    token: string;
    /** 'end' of a non-empty span, empty-span start, empty-span end, non-empty start. */
    order: number;
    /** secondary sort key (span extent at this position). */
    extent: number;
  }

  const tokens: MarkerToken[] = [];
  for (const span of spans) {
    const oldVisibleStart = toVisibleOffset(oldFullContent, span.proseStart);
    const oldVisibleEnd = toVisibleOffset(oldFullContent, span.proseEnd);
    const newStart = mapVisible(oldVisibleStart);
    const newEnd = Math.max(newStart, mapVisible(oldVisibleEnd));
    if (newStart === newEnd) {
      // Fully-deleted span — keep an empty adjacent marker pair.
      tokens.push({ pos: newStart, token: span.startToken, order: 1, extent: 0 });
      tokens.push({ pos: newEnd, token: span.endToken, order: 2, extent: 0 });
    } else {
      tokens.push({
        pos: newStart,
        token: span.startToken,
        order: 3,
        extent: newEnd,
      });
      tokens.push({
        pos: newEnd,
        token: span.endToken,
        order: 0,
        extent: newStart,
      });
    }
  }

  // Group by insertion position.
  const byPos = new Map<number, MarkerToken[]>();
  for (const t of tokens) {
    const group = byPos.get(t.pos);
    if (group) {
      group.push(t);
    } else {
      byPos.set(t.pos, [t]);
    }
  }

  // Within a position group, the order encodes nesting:
  //   1. non-empty END tokens first, inner spans first (larger start first);
  //   2. empty-span START, then empty-span END;
  //   3. non-empty START tokens last, outer spans first (larger end first).
  // This yields `scene1:end scene2:start` for adjacent spans, `start end`
  // for empty spans, and `outerStart innerStart ... innerEnd outerEnd` for
  // nested spans.
  for (const group of byPos.values()) {
    group.sort(
      (a: MarkerToken, b: MarkerToken): number =>
        a.order - b.order || b.extent - a.extent
    );
  }

  // Build the result by walking the stripped content and emitting tokens at
  // their positions.
  const positions = [...byPos.keys()].sort((a: number, b: number): number => a - b);
  let result = '';
  let cursor = 0;
  for (const pos of positions) {
    result += newStrippedContent.slice(cursor, pos);
    for (const t of byPos.get(pos) as MarkerToken[]) {
      result += t.token;
    }
    cursor = pos;
  }
  result += newStrippedContent.slice(cursor);

  return result;
}

// ─── Visible ↔ original coordinate conversion (the single canonical pair) ───
//
// The editor's *visible* document is the full raw content with every
// internal marker token stripped out (see `stripInlineInternalMarkers`).
// These two functions are the ONLY place in the codebase that convert
// between visible-space offsets and original (full-content) offsets. They
// are exact — they walk the real marker tokens in *fullContent* — and must
// be used instead of any offset arithmetic derived from stored link/scope
// metadata (which can go stale relative to the live document; see
// `toVisibleLinkedOffset` in `proseLinkCoordinates.ts`, which delegates here).

/**
 * Convert an offset in the original (full, marker-inclusive) content to the
 * corresponding offset in the visible (marker-stripped) content.
 */
export function toVisibleOffset(fullContent: string, originalOffset: number): number {
  if (fullContent.length === 0) return Math.max(0, originalOffset);

  let visibleCount = 0;
  let lastIndex = 0;
  const regex = new RegExp(INLINE_INTERNAL_MARKER_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(fullContent)) !== null) {
    const gap = match.index - lastIndex;
    if (lastIndex + gap > originalOffset) {
      return visibleCount + (originalOffset - lastIndex);
    }
    visibleCount += gap;
    if (
      originalOffset >= match.index &&
      originalOffset < match.index + match[0].length
    ) {
      return visibleCount;
    }
    lastIndex = match.index + match[0].length;
  }
  return visibleCount + Math.max(0, originalOffset - lastIndex);
}

/**
 * Inverse of `toVisibleOffset`: given a visible (post-stripping) offset and
 * the original full content (with markers), return the corresponding
 * position in the original content.
 *
 * When `snapPastMarkers` is false (default, used by scene boundary drags),
 * a visible offset that lands at a marker boundary returns the marker
 * position itself.  When `snapPastMarkers` is true (used by annotation
 * creation), the offset is snapped past the marker to the first prose
 * position after it.
 *
 * Walks through the full content character by character, skipping marker
 * tokens, and counts visible characters until `visibleOffset` is reached.
 * When the visible offset lands exactly at a trailing marker with no more
 * visible text after it, the position right *before* that marker is
 * returned (not after) so boundary handles never jump past adjacent markers.
 */
export function toOriginalOffset(
  fullContent: string,
  visibleOffset: number,
  opts?: { snapPastMarkers?: boolean }
): number {
  const snapPastMarkers = opts?.snapPastMarkers === true;
  // A negative offset always clamps to 0.  A zero offset returns 0 unless we
  // are snapping past markers (annotation-creation start boundaries): then we
  // fall through to the walk so a document that STARTS with markers maps the
  // selection start to the first prose character AFTER those markers, instead
  // of into the leading marker tokens.
  if (visibleOffset < 0) return 0;
  if (visibleOffset === 0 && !snapPastMarkers) return 0;
  if (fullContent.length === 0) return 0;

  let visibleCount = 0;
  const markerRe = new RegExp(INLINE_INTERNAL_MARKER_REGEX.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = markerRe.exec(fullContent)) !== null) {
    const gap = match.index - lastIndex; // visible chars before this marker
    if (visibleCount + gap > visibleOffset) {
      // Target is inside this gap — return position within the gap
      return lastIndex + (visibleOffset - visibleCount);
    }
    if (visibleCount + gap === visibleOffset) {
      // Visible offset lands exactly at the start of this marker.
      // For scene boundary drags: return the marker position.
      // For annotation creation: snap past the marker to prose position.
      if (snapPastMarkers) {
        // Skip the marker entirely — visible offset maps to first
        // prose character after the marker.
        visibleCount += gap;
        lastIndex = match.index + match[0].length;
        continue;
      }
      return match.index;
    }
    visibleCount += gap;
    lastIndex = match.index + match[0].length;
  }

  // After all markers
  const remaining = visibleOffset - visibleCount;
  if (remaining >= 0) {
    return Math.min(lastIndex + remaining, fullContent.length);
  }
  return lastIndex;
}

// ─── Marker integrity (fail-safe gate) ──────────────────────────────────────

/** Thrown by `validateMarkerIntegrity` when *content* is unsafe to use. */
export class MarkerIntegrityError extends Error {}

/**
 * Fail-safe gate mirroring the backend's `validate_marker_integrity`: raises
 * `MarkerIntegrityError` if *content* violates any marker invariant.
 *
 * Enforced invariants (apply to every layer, so a future third layer gets
 * the same guarantees automatically):
 *   1. Balance — every start marker has exactly one matching end marker (no
 *      unclosed starts, no orphaned ends, no duplicate opens for one id).
 *   2. Exclusivity — layers with `MARKER_LAYER_EXCLUSIVE[layer] === true`
 *      (`scene`) may never have two overlapping spans: any part of the prose
 *      belongs to at most one scene. Non-exclusive layers (`annotation`) may
 *      overlap arbitrarily by design.
 *
 * This is a client-side pre-flight check: it lets the UI reject a
 * would-be-corrupting edit (e.g. a boundary drag) immediately, instead of
 * only discovering the problem after a round trip to the backend (which
 * enforces the same invariants server-side as the ultimate source of truth).
 */
export function validateMarkerIntegrity(content: string): void {
  const openStarts = new Map<string, { layer: MarkerLayerName; pos: number }>();
  const spansByLayer: Record<MarkerLayerName, Array<[number, number]>> = {
    scene: [],
    annotation: [],
  };

  const regex = new RegExp(INTERNAL_MARKER_CAPTURE_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const layer = match[1] as MarkerLayerName;
    const id = match[2];
    const edge = match[3];
    const key = `${layer}:${id}`;
    if (edge === 'start') {
      if (openStarts.has(key)) {
        throw new MarkerIntegrityError(
          `Malformed ${layer} markers: ${layer} ${id} has two unmatched start markers.`
        );
      }
      openStarts.set(key, { layer, pos: match.index + match[0].length });
    } else {
      const opened = openStarts.get(key);
      if (!opened) {
        throw new MarkerIntegrityError(
          `Malformed ${layer} markers: orphaned end marker for ${layer} ${id}.`
        );
      }
      openStarts.delete(key);
      spansByLayer[layer].push([opened.pos, match.index]);
    }
  }

  if (openStarts.size > 0) {
    const unclosed = [...openStarts.keys()].sort().join(', ');
    throw new MarkerIntegrityError(
      `Malformed internal markers: unclosed start marker(s) for ${unclosed}.`
    );
  }

  for (const layer of Object.keys(spansByLayer) as MarkerLayerName[]) {
    if (!MARKER_LAYER_EXCLUSIVE[layer]) continue;
    const ordered = [...spansByLayer[layer]].sort(
      (a: [number, number], b: [number, number]): number => a[0] - b[0] || a[1] - b[1]
    );
    for (let i = 1; i < ordered.length; i++) {
      const [, previousEnd] = ordered[i - 1];
      const [currentStart] = ordered[i];
      if (currentStart < previousEnd) {
        throw new MarkerIntegrityError(
          `Overlapping ${layer} spans detected: any part of the prose may ` +
            `belong to at most one ${layer} (${ordered[i - 1]} overlaps ${ordered[i]}).`
        );
      }
    }
  }
}
