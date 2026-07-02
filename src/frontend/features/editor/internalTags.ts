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
 * Transfer internal markers (scene + annotation) from *oldFullContent* to
 * *newStrippedContent*.  For each marker span found in the old content, the
 * prose text between the markers is located in the new content and the
 * markers are re-inserted around it.
 *
 * When a span's prose cannot be found in the new content the markers are
 * silently dropped (the edit removed that text entirely).
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

  // Sort spans by the position of their prose in the new content so we can
  // inject markers from right to left without invalidating offsets.
  const injections: Array<{
    pos: number;
    startToken: string;
    endToken: string;
    proseLen: number;
  }> = [];

  for (const span of spans) {
    const idx = newStrippedContent.indexOf(span.prose);
    if (idx < 0) continue; // prose not found — drop this marker span
    injections.push({
      pos: idx,
      startToken: span.startToken,
      endToken: span.endToken,
      proseLen: span.prose.length,
    });
  }

  if (injections.length === 0) {
    return newStrippedContent;
  }

  // Sort by position (ascending) so we can inject right-to-left
  injections.sort(
    (
      a: { pos: number; startToken: string; endToken: string; proseLen: number },
      b: { pos: number; startToken: string; endToken: string; proseLen: number }
    ): number => a.pos - b.pos
  );

  // Build result by injecting markers from right to left
  let result = newStrippedContent;
  for (let i = injections.length - 1; i >= 0; i--) {
    const { pos, startToken, endToken, proseLen } = injections[i];
    const before = result.slice(0, pos);
    const prose = result.slice(pos, pos + proseLen);
    const after = result.slice(pos + proseLen);
    result = before + startToken + prose + endToken + after;
  }

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
 * Walks through the full content character by character, skipping marker
 * tokens, and counts visible characters until `visibleOffset` is reached.
 * When the visible offset lands exactly at a trailing marker with no more
 * visible text after it, the position right *before* that marker is
 * returned (not after) so boundary handles never jump past adjacent markers.
 */
export function toOriginalOffset(fullContent: string, visibleOffset: number): number {
  if (visibleOffset <= 0) return 0;
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
      // Visible offset lands exactly at the start of this marker.  Check
      // whether any non-marker text follows — if not, the offset points to
      // the end of visible text right before this (trailing) marker.
      const afterSlice = fullContent.slice(match.index + match[0].length);
      const hasVisibleAfter =
        afterSlice.replace(INLINE_INTERNAL_MARKER_REGEX, '').length > 0;
      if (!hasVisibleAfter) {
        // No visible text follows → the offset is right before this marker.
        return match.index;
      }
      // Visible text follows → skip the marker and keep counting.
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
