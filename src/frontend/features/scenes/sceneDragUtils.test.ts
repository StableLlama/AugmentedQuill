// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for sceneDragUtils — shared cross-pane DnD utilities.
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import {
  DRAG_SCENE_MIME,
  DRAG_SCENES_MIME,
  hasSceneDragMimeTypes,
  resolveDraggedSceneIdsFromTransfer,
  reorderIdsByPlacement,
  dedupeSceneIds,
} from './sceneDragUtils';
import type { SceneId } from '../../types';

/** Mock DataTransfer matching NarrativeView test conventions. */
function makeDT(): DataTransfer {
  const bag = new Map<string, string>();
  return {
    effectAllowed: 'all',
    dropEffect: 'move',
    files: {} as FileList,
    items: {} as DataTransferItemList,
    types: [] as readonly string[],
    clearData: (format?: string) => {
      if (format) bag.delete(format);
      else bag.clear();
    },
    getData: (format: string) => bag.get(format) ?? '',
    setData: (format: string, data: string) => {
      bag.set(format, data);
    },
    setDragImage: () => undefined,
  } as unknown as DataTransfer;
}

describe('sceneDragUtils', () => {
  describe('hasSceneDragMimeTypes', () => {
    it('returns true when scene MIME types are present', () => {
      const dt = makeDT();
      dt.setData(DRAG_SCENE_MIME, '42');
      expect(hasSceneDragMimeTypes(dt)).toBe(true);
    });

    it('returns true when scene-ids MIME type is present', () => {
      const dt = makeDT();
      dt.setData(DRAG_SCENES_MIME, '[42]');
      expect(hasSceneDragMimeTypes(dt)).toBe(true);
    });

    it('returns true for text/plain fallback', () => {
      const dt = makeDT();
      dt.setData('text/plain', '42');
      expect(hasSceneDragMimeTypes(dt)).toBe(true);
    });

    it('returns false when no scene MIME types are present', () => {
      const dt = makeDT();
      dt.setData('text/html', '<p>hello</p>');
      expect(hasSceneDragMimeTypes(dt)).toBe(false);
    });
  });

  describe('resolveDraggedSceneIdsFromTransfer', () => {
    const tokenMap = new Map<string, SceneId>([
      ['42', 42],
      ['99', 99],
    ]);

    it('uses refs first (intra-pane, reliable in dragOver)', () => {
      const dt = makeDT();
      // dataTransfer has old data but refs have current
      dt.setData(DRAG_SCENE_MIME, '99');
      const result = resolveDraggedSceneIdsFromTransfer(
        dt,
        tokenMap,
        42, // dragIdRef
        [42], // dragIdsRef
        42 // dragIdState
      );
      expect(result).toEqual([42]);
    });

    it('falls back to dataTransfer multi-ID JSON', () => {
      const dt = makeDT();
      dt.setData(DRAG_SCENES_MIME, JSON.stringify([42, 99]));
      const result = resolveDraggedSceneIdsFromTransfer(
        dt,
        tokenMap,
        null, // dragIdRef
        [], // dragIdsRef
        null // dragIdState
      );
      expect(result).toEqual([42, 99]);
    });

    it('falls back to dataTransfer single ID', () => {
      const dt = makeDT();
      dt.setData(DRAG_SCENE_MIME, '42');
      const result = resolveDraggedSceneIdsFromTransfer(dt, tokenMap, null, [], null);
      expect(result).toEqual([42]);
    });

    it('falls back to dragIdState as last resort', () => {
      const dt = makeDT();
      const result = resolveDraggedSceneIdsFromTransfer(dt, tokenMap, null, [], 42);
      expect(result).toEqual([42]);
    });

    it('returns empty array when nothing matches', () => {
      const dt = makeDT();
      const result = resolveDraggedSceneIdsFromTransfer(dt, tokenMap, null, [], null);
      expect(result).toEqual([]);
    });
  });

  describe('reorderIdsByPlacement', () => {
    const ids: SceneId[] = [1, 2, 3, 4, 5];

    it('moves source before target', () => {
      expect(reorderIdsByPlacement(ids, 5, 2, true)).toEqual([1, 5, 2, 3, 4]);
    });

    it('moves source after target', () => {
      expect(reorderIdsByPlacement(ids, 1, 3, false)).toEqual([2, 3, 1, 4, 5]);
    });

    it('returns original when source equals target', () => {
      expect(reorderIdsByPlacement(ids, 3, 3, true)).toEqual(ids);
    });

    it('returns original when source not found', () => {
      expect(reorderIdsByPlacement(ids, 99 as SceneId, 3, true)).toEqual(ids);
    });
  });

  describe('dedupeSceneIds', () => {
    it('removes duplicates preserving order', () => {
      expect(dedupeSceneIds([1, 2, 1, 3, 2])).toEqual([1, 2, 3]);
    });
  });
});
