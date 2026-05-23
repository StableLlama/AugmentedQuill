// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Shared scene sorting utilities used by NarrativeView and
 * ConvergenceMapView. Extracted to avoid duplication.
 */

import type { Scene, SceneId } from '../../types';
import type { Chapter, Book } from '../../types/domain';
import { parseZonedDateTime } from '../../utils/temporal';

export type ProjectType = 'short-story' | 'novel' | 'series';

function sceneIdCompare(a: SceneId, b: SceneId): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

function normalizeId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Build a map from chapter id → display order index, using the correct
 *  sequence for the project type (flat list for novel; books-first for series). */
// eslint-disable-next-line complexity
export function buildChapterOrderMap(
  projectType: ProjectType,
  chapters: Chapter[],
  books: Book[]
): Map<string, number> {
  const map = new Map<string, number>();

  if (projectType === 'series' && books.length > 0) {
    const assignedChapterIds = new Set<string>();
    let idx = 0;

    const chaptersByBookId = new Map<string, Chapter[]>();
    for (const chapter of chapters) {
      const chapterBookId = normalizeId(chapter.book_id);
      if (!chapterBookId) continue;
      const current = chaptersByBookId.get(chapterBookId) ?? [];
      current.push(chapter);
      chaptersByBookId.set(chapterBookId, current);
    }

    for (const book of books) {
      const seenInBook = new Set<string>();
      for (const ch of book.chapters) {
        const chapterId = normalizeId(ch.id);
        if (
          !chapterId ||
          seenInBook.has(chapterId) ||
          assignedChapterIds.has(chapterId)
        ) {
          continue;
        }
        map.set(chapterId, idx++);
        seenInBook.add(chapterId);
        assignedChapterIds.add(chapterId);
      }

      const bookId = normalizeId(book.id);
      const chaptersForBook = bookId ? (chaptersByBookId.get(bookId) ?? []) : [];
      for (const chapter of chaptersForBook) {
        const chapterId = normalizeId(chapter.id);
        if (
          !chapterId ||
          seenInBook.has(chapterId) ||
          assignedChapterIds.has(chapterId)
        ) {
          continue;
        }
        map.set(chapterId, idx++);
        seenInBook.add(chapterId);
        assignedChapterIds.add(chapterId);
      }
    }

    for (const chapter of chapters) {
      const chapterId = normalizeId(chapter.id);
      if (!chapterId || assignedChapterIds.has(chapterId)) continue;
      map.set(chapterId, idx++);
      assignedChapterIds.add(chapterId);
    }
  } else {
    let idx = 0;
    for (const ch of chapters) {
      const chapterId = normalizeId(ch.id);
      if (!chapterId || map.has(chapterId)) continue;
      map.set(chapterId, idx++);
    }
  }

  return map;
}

export function normalizeChapterId(chapterId: unknown): string {
  if (typeof chapterId === 'string') return chapterId.trim();
  if (typeof chapterId === 'number' && Number.isFinite(chapterId))
    return String(chapterId);
  return '';
}

/** Returns an order_index for sorting all scenes in narrative order.
 *  Unlinked scenes use their fractional order_index (or Infinity if None);
 *  linked scenes use their assigned odd-integer order_index (1.0, 3.0, 5.0...).
 *  Chapter boundaries are handled separately via buildChapterOrderMap. */
function getProseLinkChapterIndex(
  link: Scene['prose_link'],
  chapterOrderMap: Map<string, number>
): number | null {
  if (!link || link.scope_type === 'story') return null;
  return chapterOrderMap.get(normalizeChapterId(link.chapter_id)) ?? Infinity;
}

function areProseLinksInSameScope(
  linkA: Scene['prose_link'],
  linkB: Scene['prose_link']
): boolean {
  if (!linkA || !linkB || linkA.scope_type !== linkB.scope_type) return false;
  return (
    linkA.scope_type === 'story' ||
    normalizeChapterId(linkA.chapter_id) === normalizeChapterId(linkB.chapter_id)
  );
}

function compareProseLinkStartOffsets(sceneA: Scene, sceneB: Scene): number | null {
  if (!areProseLinksInSameScope(sceneA.prose_link, sceneB.prose_link)) return null;

  const startA = sceneA.prose_link?.start_offset;
  const startB = sceneB.prose_link?.start_offset;
  if (!Number.isFinite(startA) || !Number.isFinite(startB) || startA === startB) {
    return null;
  }
  return Number(startA) - Number(startB);
}

export function sceneSortKey(
  scene: Scene,
  _chapterOrderMap: Map<string, number>
): number {
  // Sort by order_index; None (freshly created) sorts to end.
  return Number.isFinite(scene.order_index) ? (scene.order_index as number) : Infinity;
}

export function proseSort(
  sceneA: Scene,
  sceneB: Scene,
  chapterOrderMap: Map<string, number>
): number {
  // Linked chapter scenes are grouped by chapter display order first.
  // Inside a chapter (and for all other combinations), sort by order_index so
  // unlinked scenes can naturally interleave between linked scenes.
  const chIdxA = getProseLinkChapterIndex(sceneA.prose_link, chapterOrderMap);
  const chIdxB = getProseLinkChapterIndex(sceneB.prose_link, chapterOrderMap);

  if (chIdxA !== null && chIdxB !== null && chIdxA !== chIdxB) {
    return chIdxA < chIdxB ? -1 : 1;
  }

  const startOffsetComparison = compareProseLinkStartOffsets(sceneA, sceneB);
  if (startOffsetComparison !== null) {
    return startOffsetComparison;
  }

  // Same chapter/scope: sort by order_index
  const aKey = sceneSortKey(sceneA, chapterOrderMap);
  const bKey = sceneSortKey(sceneB, chapterOrderMap);
  if (aKey !== bKey) return aKey - bKey;

  // Fallback: by scene ID
  return sceneIdCompare(sceneA.id, sceneB.id);
}

export function getSceneEpochNanoseconds(scene: Scene): bigint | null {
  const temporalString = scene.scene_time?.temporal_zoned_datetime;
  const parsed = parseZonedDateTime(temporalString);
  return parsed?.epochNanoseconds ?? null;
}

export function chronologicalSort(
  sceneA: Scene,
  sceneB: Scene,
  chapterOrderMap: Map<string, number>,
  sceneEpochNanosecondsById: Map<SceneId, bigint>
): number {
  const epochA = sceneEpochNanosecondsById.get(sceneA.id);
  const epochB = sceneEpochNanosecondsById.get(sceneB.id);
  const hasTimeA = epochA !== undefined;
  const hasTimeB = epochB !== undefined;
  const hasLinkA = Boolean(sceneA.prose_link);
  const hasLinkB = Boolean(sceneB.prose_link);
  const isExtraA = !hasLinkA && !hasTimeA;
  const isExtraB = !hasLinkB && !hasTimeB;

  // "Not yet linked" extras (no prose link and no valid time) must always
  // stay at the very end in Chronological mode.
  if (isExtraA !== isExtraB) return isExtraA ? 1 : -1;

  if (hasTimeA && hasTimeB) {
    if (epochA < epochB) return -1;
    if (epochA > epochB) return 1;
    return proseSort(sceneA, sceneB, chapterOrderMap);
  }

  // When one or both scenes have no valid time, keep chronology stable by
  // falling back to prose order so untimed scenes can interleave naturally.
  return proseSort(sceneA, sceneB, chapterOrderMap);
}
