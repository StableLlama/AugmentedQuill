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
  loose: boolean = false
): number {
  if (!loose && !shouldAdjustOffsets(unit, scenes)) {
    return offset;
  }

  let removedBefore = 0;
  for (const scene of scenes) {
    const link = scene.prose_link;
    if (!link || !linkMatchesUnit(link, unit)) {
      continue;
    }

    if (link.start_offset <= offset) {
      removedBefore += sceneMarkerTokenLength(scene.id, 'start');
    }
    if (link.end_offset != null && link.end_offset < offset) {
      removedBefore += sceneMarkerTokenLength(scene.id, 'end');
    }
  }

  return Math.max(0, offset - removedBefore);
}

export function toVisibleRange(
  scene: Scene,
  unit: WritingUnit,
  scenes: readonly Scene[]
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

  const identity = { from: rawFrom, to: rawTo };
  const adjusted = {
    from: toVisibleLinkedOffset(rawFrom, unit, scenes),
    to: toVisibleLinkedOffset(rawTo, unit, scenes),
  };

  const identityValid = identity.from < identity.to;
  const adjustedValid = adjusted.from < adjusted.to;
  const mustAdjust =
    shouldAdjustOffsets(unit, scenes) ||
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

  const from = toVisibleLinkedOffset(rawFrom, unit, scenes);
  const end = toVisibleLinkedOffset(rawEnd, unit, scenes);
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
