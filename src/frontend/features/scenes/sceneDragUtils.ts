// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Shared drag-and-drop utilities for scene reordering across panes.
 * Used by both NarrativeView and SceneTreeView so cross-pane DnD works reliably.
 */

import type { SceneId } from '../../types';

/** MIME types for scene drag-and-drop. Must be identical across all panes. */
export const DRAG_SCENE_MIME = 'application/x-augmentedquill-scene-id';
export const DRAG_SCENES_MIME = 'application/x-augmentedquill-scene-ids';

/**
 * Custom event types for cross-pane communication.
 * - `aq-scene-optimistic-reorder`: dispatched by either pane after applying
 *   an optimistic reorder, so the other pane can sync immediately.
 */
export const EVT_OPTIMISTIC_REORDER = 'aq-scene-optimistic-reorder';
export const EVT_REORDER_PROSE = 'aq-scene-reorder-prose';
export const EVT_DROP_CHAPTER = 'aq-scene-drop-chapter';

/**
 * Check whether a DataTransfer carries scene drag data.
 * Safe to call in both dragOver and drop — uses .types first,
 * then falls back to .getData for mocked environments where
 * types isn't synced with setData.
 */
export function hasSceneDragMimeTypes(dataTransfer: DataTransfer): boolean {
  const types: readonly string[] = dataTransfer.types;
  if (
    types.includes(DRAG_SCENE_MIME) ||
    types.includes(DRAG_SCENES_MIME) ||
    types.includes('text/plain')
  ) {
    return true;
  }
  // Fallback for mock DataTransfer objects that don't sync types with setData.
  try {
    return (
      dataTransfer.getData(DRAG_SCENE_MIME).length > 0 ||
      dataTransfer.getData(DRAG_SCENES_MIME).length > 0 ||
      dataTransfer.getData('text/plain').length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Resolve dragged scene IDs from a DataTransfer, falling back through
 * multiple strategies.  Caller-owned refs are tried first (reliable in
 * dragOver for intra-pane drags), then dataTransfer.getData (works in drop).
 */
export function resolveDraggedSceneIdsFromTransfer(
  dataTransfer: DataTransfer,
  sceneIdByToken: Map<string, SceneId>,
  dragIdRef: SceneId | null,
  dragIdsRef: SceneId[],
  dragIdState: SceneId | null
): SceneId[] {
  // 1. Refs (intra-pane, reliable in dragOver)
  if (dragIdsRef.length > 0) {
    return dedupeSceneIds(dragIdsRef);
  }

  // 2. Multi-ID MIME payload
  const rawIds = dataTransfer.getData(DRAG_SCENES_MIME);
  if (rawIds) {
    try {
      const parsed = JSON.parse(rawIds) as unknown;
      if (Array.isArray(parsed)) {
        return dedupeSceneIds(
          parsed
            .map((v: unknown): SceneId | null => coerceSceneId(v, sceneIdByToken))
            .filter((id: SceneId | null): id is SceneId => id !== null)
        );
      }
    } catch {
      // Ignore malformed payloads.
    }
  }

  // 3. Single-ID fallbacks
  const single =
    dragIdRef ??
    coerceSceneId(dataTransfer.getData(DRAG_SCENE_MIME), sceneIdByToken) ??
    coerceSceneId(dataTransfer.getData('text/plain'), sceneIdByToken) ??
    dragIdState;
  return single ? [single] : [];
}

export function coerceSceneId(
  value: unknown,
  sceneIdByToken: Map<string, SceneId>
): SceneId | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value as SceneId;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const mapped = sceneIdByToken.get(trimmed);
  if (mapped !== undefined) return mapped;
  const numeric = Number(trimmed);
  if (Number.isInteger(numeric)) return numeric as SceneId;
  return null;
}

export function dedupeSceneIds(ids: SceneId[]): SceneId[] {
  const seen = new Set<string>();
  const deduped: SceneId[] = [];
  ids.forEach((id: SceneId): void => {
    const key = String(id);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(id);
  });
  return deduped;
}

/**
 * Reorder an array of IDs by moving sourceId adjacent to targetId.
 */
export function reorderIdsByPlacement(
  ids: SceneId[],
  sourceId: SceneId,
  targetId: SceneId,
  placeBefore: boolean
): SceneId[] {
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return ids;

  const next = [...ids];
  next.splice(sourceIndex, 1);
  const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertIndex = placeBefore ? adjustedTarget : adjustedTarget + 1;
  next.splice(insertIndex, 0, sourceId);
  return next;
}

/**
 * Dispatch an optimistic reorder event so the other pane can sync immediately.
 */
export function dispatchOptimisticReorder(newOrderIds: SceneId[]): void {
  window.dispatchEvent(
    new CustomEvent<{ orderIds: SceneId[] }>(EVT_OPTIMISTIC_REORDER, {
      detail: { orderIds: newOrderIds },
    })
  );
}

/**
 * Dispatch a reorder-prose event for server-side persistence.
 */
export function dispatchReorderProse(
  sourceSceneId: SceneId,
  targetSceneId: SceneId,
  placeBefore: boolean
): void {
  window.dispatchEvent(
    new CustomEvent(EVT_REORDER_PROSE, {
      detail: { sourceSceneId, targetSceneId, placeBefore },
    })
  );
}

/**
 * Dispatch a drop-on-chapter event.
 */
export function dispatchDropChapter(
  sourceSceneIds: SceneId[],
  chapterId: string
): void {
  window.dispatchEvent(
    new CustomEvent(EVT_DROP_CHAPTER, {
      detail: { sourceSceneIds, chapterId },
    })
  );
}
