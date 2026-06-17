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
