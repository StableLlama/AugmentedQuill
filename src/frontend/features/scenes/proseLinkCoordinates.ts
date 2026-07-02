// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Canonical scene prose-link coordinate mapping for visible editor ranges.
 *
 * All original-content ↔ visible-content offset conversion here delegates to
 * the exact, marker-walking primitives in `../editor/internalTags`
 * (`toVisibleOffset` / `toOriginalOffset`). There is intentionally no
 * separate approximate/heuristic offset math in this file: whenever the raw
 * content with markers is available, the exact walk is used; stale
 * `prose_link` offsets can never cause a different (wrong) answer than the
 * live document.
 */

import type { Scene, SceneId, SceneProseLink } from '../../types';
import type { WritingUnit } from '../../types/domain';
import {
  getSceneMarkerSpanRange,
  hasInlineInternalMarkers,
  hasInlineSceneMarkers,
  sceneMarkerTokenLength,
  toOriginalOffset as toOriginalOffsetCore,
  toVisibleOffset,
} from '../editor/internalTags';
import { normalizeChapterId } from './sceneSortUtils';

function linkMatchesUnit(link: SceneProseLink, unit: WritingUnit): boolean {
  return link.scope_type === 'story'
    ? unit.scope === 'story'
    : link.scope_type === 'chapter' &&
        normalizeChapterId(link.chapter_id) === normalizeChapterId(unit.id);
}

function shouldAdjustOffsets(unit: WritingUnit, scenes: readonly Scene[]): boolean {
  const scoped = scenes
    .map((scene: Scene) => ({ sceneId: scene.id, link: scene.prose_link }))
    .filter(
      (item: {
        sceneId: SceneId;
        link: SceneProseLink | null | undefined;
      }): item is { sceneId: SceneId; link: SceneProseLink } =>
        item.link != null && linkMatchesUnit(item.link, unit)
    );

  if (scoped.length === 0) {
    return false;
  }

  if (hasInlineSceneMarkers(unit.content)) {
    return false;
  }

  if (
    scoped.some(
      ({ link }: { sceneId: SceneId; link: SceneProseLink }) => link.start_offset === 0
    )
  ) {
    return false;
  }

  return scoped.every(
    ({ sceneId, link }: { sceneId: SceneId; link: SceneProseLink }) =>
      link.start_offset >= sceneMarkerTokenLength(sceneId, 'start')
  );
}

/**
 * Convert an original-content offset to the visible-content offset.
 *
 * `unit`/`scenes` are only used (via `shouldAdjustOffsets`) to decide whether
 * an adjustment is needed at all when `loose` is false. The conversion
 * itself picks exactly one of two unambiguous methods, based on what
 * *actually* describes the offset's coordinate space — never a blended
 * "approximation":
 *
 *   1. `fullContent` contains real internal markers -> it is the live,
 *      authoritative source of truth, so the offset is converted with the
 *      exact marker walk (`toVisibleOffset`). This is what prevents drift
 *      when a scene's stored `prose_link` offsets go stale relative to the
 *      live document (e.g. after the user edits text between markers).
 *   2. `fullContent` has no markers (already-stripped representation, or
 *      unavailable) -> the only remaining information is each scene's own
 *      marker-inclusive `prose_link` boundaries, so the (fixed, known)
 *      marker token lengths are subtracted for every scene whose boundary
 *      lies at-or-before `offset`. This is exact for that representation,
 *      not an approximation — there is nothing else to walk.
 */
export function toVisibleLinkedOffset(
  offset: number,
  unit: WritingUnit,
  scenes: readonly Scene[],
  loose: boolean = false,
  fullContent?: string
): number {
  if (!loose && !shouldAdjustOffsets(unit, scenes)) {
    return offset;
  }

  if (fullContent !== undefined && hasInlineInternalMarkers(fullContent)) {
    return toVisibleOffset(fullContent, offset);
  }

  let removed = 0;
  for (const scene of scenes) {
    const link = scene.prose_link;
    if (!link || !linkMatchesUnit(link, unit)) {
      continue;
    }
    if (link.start_offset <= offset) {
      removed += sceneMarkerTokenLength(scene.id, 'start');
    }
    if (link.end_offset != null && link.end_offset < offset) {
      removed += sceneMarkerTokenLength(scene.id, 'end');
    }
  }
  return Math.max(0, offset - removed);
}

/**
 * Inverse of `toVisibleLinkedOffset`: given a visible (post-stripping) offset
 * and the original full content (with markers), return the corresponding
 * position in the original content.  Thin re-export (with the historical
 * argument order used across this codebase) of the canonical exact
 * implementation in `internalTags.ts`.
 */
export function toOriginalOffset(visibleOffset: number, fullContent: string): number {
  return toOriginalOffsetCore(fullContent, visibleOffset);
}

export function toVisibleRange(
  scene: Scene,
  unit: WritingUnit,
  scenes: readonly Scene[],
  fullContent?: string
): { from: number; to: number } | null {
  const link = scene.prose_link;
  if (!link || link.end_offset == null) {
    return null;
  }
  if (!linkMatchesUnit(link, unit)) {
    return null;
  }

  if (hasInlineSceneMarkers(unit.content)) {
    const markerRange = getSceneMarkerSpanRange(unit.content, scene.id);
    if (markerRange) {
      return markerRange.from < markerRange.to ? markerRange : null;
    }
  }

  const rawFrom = Math.max(Number(link.start_offset ?? 0), 0);
  const rawTo = Math.max(Number(link.end_offset ?? rawFrom), rawFrom);

  const hasFullContent = fullContent !== undefined && fullContent.length > 0;

  const identity = { from: rawFrom, to: rawTo };
  const adjusted = {
    from: toVisibleLinkedOffset(rawFrom, unit, scenes, true, fullContent),
    to: toVisibleLinkedOffset(rawTo, unit, scenes, true, fullContent),
  };

  const identityValid = identity.from < identity.to;
  const adjustedValid = adjusted.from < adjusted.to;
  const mustAdjust =
    shouldAdjustOffsets(unit, scenes) ||
    hasFullContent ||
    (link.scope_type === 'chapter' &&
      (rawFrom > unit.content.length || rawTo > unit.content.length));

  if (mustAdjust) {
    if (adjustedValid) {
      return adjusted;
    }
    if (identityValid) {
      return identity;
    }
    return null;
  }

  if (identityValid) {
    return identity;
  }
  if (adjustedValid) {
    return adjusted;
  }
  return null;
}

export function getLinkedProseFromTextSource(
  sourceText: string,
  link: SceneProseLink,
  unit: WritingUnit,
  scenes: readonly Scene[]
): string {
  const rawFrom = Math.max(Number(link.start_offset ?? 0), 0);
  const rawEnd = Math.max(Number(link.end_offset ?? rawFrom), rawFrom);
  const rawText = sourceText.slice(
    Math.min(rawFrom, sourceText.length),
    Math.min(rawEnd, sourceText.length)
  );

  if (rawText.length > 0 || hasInlineSceneMarkers(unit.content)) {
    return rawText;
  }

  // sourceText is the best available raw-content signal here (editor
  // document / stored chapter or story content) — pass it through as
  // fullContent so the conversion is the exact marker walk rather than any
  // approximation.
  const from = toVisibleLinkedOffset(rawFrom, unit, scenes, true, sourceText);
  const end = toVisibleLinkedOffset(rawEnd, unit, scenes, true, sourceText);
  const boundedFrom = Math.min(Math.max(from, 0), sourceText.length);
  const boundedEnd = Math.min(Math.max(end, boundedFrom), sourceText.length);
  return sourceText.slice(boundedFrom, boundedEnd);
}
