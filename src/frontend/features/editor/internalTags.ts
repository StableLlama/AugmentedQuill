// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Shared inline internal-tag grammar helpers used by editor and scene features.
 */

export type SceneMarkerEdge = 'start' | 'end';

export const INLINE_SCENE_MARKER_REGEX = /<!--scene:[^:>]+:(?:start|end)-->/g;
export const INLINE_ANNOTATION_MARKER_REGEX = /<!--annotation:[^:>]+:(?:start|end)-->/g;
export const INLINE_INTERNAL_MARKER_REGEX =
  /<!--(?:scene|annotation):[^:>]+:(?:start|end)-->/g;

export function hasInlineSceneMarkers(text: string): boolean {
  return /<!--scene:[^:>]+:(?:start|end)-->/.test(text);
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

export function getSceneMarkerSpanRange(
  sourceText: string,
  sceneId: string | number
): { from: number; to: number } | null {
  const startToken = sceneMarkerToken(sceneId, 'start');
  const endToken = sceneMarkerToken(sceneId, 'end');
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
  const startToken = annotationMarkerToken(annotationId, 'start');
  const endToken = annotationMarkerToken(annotationId, 'end');
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

// ─── Stripped-to-full-content coordinate conversion ──────────────────────────

/**
 * Convert a stripped-space offset (editor document with markers removed) to
 * a full-content-space offset (raw file with markers present).
 *
 * The editor strips internal markers (``<!--scene:...-->``,
 * ``<!--annotation:...-->``) from the visible document.  Selection offsets
 * from ``getSelection()`` are therefore in stripped space.  When sending
 * offsets to the backend (which expects full-content coordinates), they must
 * be converted via this function.
 *
 * @param fullContent  The raw content string containing all internal markers.
 * @param strippedOffset  Offset in the stripped (marker-free) document.
 * @returns Equivalent offset in the full-content coordinate space, clamped to
 *   the length of *fullContent*.
 */
export function strippedToFullOffset(
  fullContent: string,
  strippedOffset: number
): number {
  let fullPos = 0;
  let strippedPos = 0;

  // Walk over each internal marker token and advance the cursor past it.
  const regex = new RegExp(INLINE_INTERNAL_MARKER_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(fullContent)) !== null) {
    const proseBeforeLen = match.index - fullPos;
    if (strippedPos + proseBeforeLen > strippedOffset) {
      // The target stripped offset falls inside the prose segment before
      // this marker.
      return fullPos + (strippedOffset - strippedPos);
    }
    strippedPos += proseBeforeLen;
    fullPos = match.index + match[0].length;
  }

  // After all markers: remaining prose (or clamp if strippedOffset exceeds
  // the stripped content length).
  return Math.min(
    fullPos + Math.max(0, strippedOffset - strippedPos),
    fullContent.length
  );
}
