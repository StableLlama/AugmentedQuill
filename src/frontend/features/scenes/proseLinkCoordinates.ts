// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Canonical scene prose-link coordinate mapping for visible editor ranges.
 */

import type { Scene, SceneId, SceneProseLink } from '../../types';
import type { WritingUnit } from '../../types/domain';
import {
  getSceneMarkerSpanRange,
  hasInlineSceneMarkers,
  sceneMarkerTokenLength,
  INLINE_INTERNAL_MARKER_REGEX,
  INLINE_ANNOTATION_MARKER_REGEX,
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

  // Hybrid approach immune to stale scene marker positions in fullContent:
  // 1. Count annotation markers from fullContent (always correct positions)
  // 2. Subtract scene marker lengths using prose_link offsets (always current)
  // Falls back to fullContent walking when no scene data is available.

  // Check if we have scene data for the approximation
  const hasSceneData = scenes.some((s: Scene) => {
    const link = s.prose_link;
    return link != null && linkMatchesUnit(link, unit);
  });

  if (hasSceneData) {
    // Step 1: Count annotation markers from fullContent
    let annotationRemoved = 0;
    if (fullContent !== undefined && fullContent.length > 0) {
      const annRegex = new RegExp(INLINE_ANNOTATION_MARKER_REGEX.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = annRegex.exec(fullContent)) !== null) {
        if (match.index + match[0].length <= offset) {
          annotationRemoved += match[0].length;
        } else if (match.index < offset) {
          annotationRemoved += offset - match.index;
          break;
        } else {
          break;
        }
      }
    }

    // Step 2: Subtract scene marker lengths using prose_link offsets
    let sceneRemoved = 0;
    for (const scene of scenes) {
      const link = scene.prose_link;
      if (!link || !linkMatchesUnit(link, unit)) {
        continue;
      }
      if (link.start_offset <= offset) {
        sceneRemoved += sceneMarkerTokenLength(scene.id, 'start');
      }
      if (link.end_offset != null && link.end_offset < offset) {
        sceneRemoved += sceneMarkerTokenLength(scene.id, 'end');
      }
    }

    return Math.max(0, offset - annotationRemoved - sceneRemoved);
  }

  // Fallback: fullContent walking for ALL markers (scene + annotation).
  // Used when no scene prose_link data is available (e.g. in tests or
  // when the scenes array is empty).
  if (fullContent !== undefined && fullContent.length > 0) {
    let visibleCount = 0;
    let lastIndex = 0;
    const regex = new RegExp(INLINE_INTERNAL_MARKER_REGEX.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(fullContent)) !== null) {
      const gap = match.index - lastIndex;
      if (lastIndex + gap > offset) {
        return visibleCount + (offset - lastIndex);
      }
      visibleCount += gap;
      if (offset >= match.index && offset < match.index + match[0].length) {
        return visibleCount;
      }
      lastIndex = match.index + match[0].length;
    }
    return visibleCount + Math.max(0, offset - lastIndex);
  }

  return offset;
}

/**
 * Inverse of `toVisibleLinkedOffset`: given a visible (post-stripping) offset
 * and the original full content (with markers), return the corresponding
 * position in the original content.
 *
 * Walks through the full content character by character, skipping marker
 * tokens, and counts visible characters until `visibleOffset` is reached.
 */
export function toOriginalOffset(visibleOffset: number, fullContent: string): number {
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

  // DEBUG
  if (typeof window !== 'undefined' && window.__AQ_DEBUG_RANGES) {
    const fcPreview = hasFullContent
      ? fullContent!.slice(0, 80).replace(/\n/g, '\\n')
      : '(none)';
    console.group(`[AQ:toVisibleRange] scene=${scene.id} raw=[${rawFrom},${rawTo})`);
    console.log('identity:', identity);
    console.log('adjusted:', adjusted);
    console.log('mustAdjust:', mustAdjust, 'hasFullContent:', hasFullContent);
    console.log('unit.content length:', unit.content.length);
    console.log('fullContent preview:', fcPreview);
    console.log(
      'result:',
      mustAdjust
        ? adjustedValid
          ? adjusted
          : identity
        : identityValid
          ? identity
          : null
    );
    console.groupEnd();
  }

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

  const from = toVisibleLinkedOffset(rawFrom, unit, scenes, true);
  const end = toVisibleLinkedOffset(rawEnd, unit, scenes, true);
  let boundedFrom = Math.min(Math.max(from, 0), sourceText.length);
  let boundedEnd = Math.min(Math.max(end, boundedFrom), sourceText.length);
  let adjustedText = sourceText.slice(boundedFrom, boundedEnd);

  if (adjustedText.length === 0) {
    const looseFrom = toVisibleLinkedOffset(rawFrom, unit, scenes, true);
    const looseEnd = toVisibleLinkedOffset(rawEnd, unit, scenes, true);
    boundedFrom = Math.min(Math.max(looseFrom, 0), sourceText.length);
    boundedEnd = Math.min(Math.max(looseEnd, boundedFrom), sourceText.length);
    adjustedText = sourceText.slice(boundedFrom, boundedEnd);
  }

  return adjustedText;
}
