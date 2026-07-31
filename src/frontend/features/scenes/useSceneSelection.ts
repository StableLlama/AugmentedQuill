// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Shared multi-select state hook for scene card views.
 *
 * Manages the selected set, active card, anchor for range selection,
 * and the prevPrimaryRef guard that prevents external primary echoes from
 * resetting an internal multi-selection.  Both PinboardView and NarrativeView
 * use this hook so the selection semantics are identical across views.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Scene, SceneId } from '../../types';

export interface UseSceneSelectionOptions {
  /**
   * Ordered list of scenes as they appear in the current view.
   * Used for Shift+click range selection so the range follows the
   * visual order rather than the raw store order.
   */
  displayOrder: Scene[];
  /** Externally driven primary selection (e.g. from editor cursor sync). */
  primarySelectedSceneId: SceneId | null;
  onSelectScene: (id: SceneId | null) => void;
  onSelectionChange?: (ids: ReadonlySet<SceneId>) => void;
}

export interface UseSceneSelectionResult {
  selectedSceneIds: ReadonlySet<SceneId>;
  activeSceneId: SceneId | null;
  setSelectedSceneIds: React.Dispatch<React.SetStateAction<ReadonlySet<SceneId>>>;
  setActiveSceneId: React.Dispatch<React.SetStateAction<SceneId | null>>;
  handleCardSelect: (sceneId: SceneId, e: MouseEvent) => void;
  anchorIdRef: React.MutableRefObject<SceneId | null>;
  prevPrimaryRef: React.MutableRefObject<SceneId | null>;
  activeSceneIdRef: React.MutableRefObject<SceneId | null>;
  selectedIdsRef: React.MutableRefObject<ReadonlySet<SceneId>>;
}

export function useSceneSelection({
  displayOrder,
  primarySelectedSceneId,
  onSelectScene,
  onSelectionChange,
}: UseSceneSelectionOptions): UseSceneSelectionResult {
  const [selectedSceneIds, setSelectedSceneIds] = useState<ReadonlySet<SceneId>>(
    primarySelectedSceneId ? new Set([primarySelectedSceneId]) : new Set()
  );
  const anchorIdRef = useRef<SceneId | null>(primarySelectedSceneId);

  const [activeSceneId, setActiveSceneId] = useState<SceneId | null>(null);
  const activeSceneIdRef = useRef<SceneId | null>(null);
  useEffect((): void => {
    activeSceneIdRef.current = activeSceneId;
  }, [activeSceneId]);

  const selectedIdsRef = useRef(selectedSceneIds);
  useEffect((): void => {
    selectedIdsRef.current = selectedSceneIds;
  }, [selectedSceneIds]);

  // Keep a stable ref to displayOrder for the shift-click handler closure.
  const displayOrderRef = useRef(displayOrder);
  useEffect((): void => {
    displayOrderRef.current = displayOrder;
  }, [displayOrder]);

  // When the externally driven primary selection changes (e.g. editor cursor
  // sync), reset the selection to that single card.  The prevPrimaryRef guard
  // prevents internal card clicks from triggering a reset when they call
  // onSelectScene and the parent echoes the same id back.
  const prevPrimaryRef = useRef(primarySelectedSceneId);
  useEffect((): void => {
    if (primarySelectedSceneId === prevPrimaryRef.current) return;
    prevPrimaryRef.current = primarySelectedSceneId;
    setSelectedSceneIds(
      primarySelectedSceneId ? new Set([primarySelectedSceneId]) : new Set()
    );
    anchorIdRef.current = primarySelectedSceneId;
    setActiveSceneId(primarySelectedSceneId);
  }, [primarySelectedSceneId]);

  useEffect((): void => {
    onSelectionChange?.(selectedSceneIds);
  }, [selectedSceneIds, onSelectionChange]);

  const handleCardSelect = useCallback(
    (sceneId: SceneId, e: MouseEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (!ctrl && !shift) {
        // Plain click: activate this card AND select only it.
        setActiveSceneId(sceneId);
        setSelectedSceneIds(new Set([sceneId]));
        anchorIdRef.current = sceneId;
        prevPrimaryRef.current = sceneId;
        onSelectScene(sceneId);
        return;
      }

      if (ctrl && !shift) {
        // Ctrl+click: add/remove from selection AND make this card the active one.
        setActiveSceneId(sceneId);
        setSelectedSceneIds((prev: ReadonlySet<SceneId>) => {
          const next = new Set(prev);
          if (next.has(sceneId)) {
            next.delete(sceneId);
          } else {
            next.add(sceneId);
          }
          return next;
        });
        anchorIdRef.current = sceneId;
        prevPrimaryRef.current = sceneId;
        onSelectScene(sceneId);
        return;
      }

      // Shift+click: extend selection from the anchor using the view's display
      // order, keep active scene unchanged.
      const order = displayOrderRef.current;
      const anchorIdx = order.findIndex(
        (s: Scene) => s.id === (anchorIdRef.current ?? sceneId)
      );
      const clickIdx = order.findIndex((s: Scene) => s.id === sceneId);
      if (anchorIdx === -1 || clickIdx === -1) {
        setSelectedSceneIds(new Set([sceneId]));
        anchorIdRef.current = sceneId;
        prevPrimaryRef.current = sceneId;
        onSelectScene(sceneId);
        return;
      }
      const lo = Math.min(anchorIdx, clickIdx);
      const hi = Math.max(anchorIdx, clickIdx);
      const rangeIds = order.slice(lo, hi + 1).map((s: Scene) => s.id);
      setSelectedSceneIds((prev: ReadonlySet<SceneId>) => {
        const next = new Set(prev);
        rangeIds.forEach((id: SceneId) => next.add(id));
        return next;
      });
      prevPrimaryRef.current = sceneId;
      onSelectScene(sceneId);
    },
    [onSelectScene]
  );

  return {
    selectedSceneIds,
    activeSceneId,
    setSelectedSceneIds,
    setActiveSceneId,
    handleCardSelect,
    anchorIdRef,
    prevPrimaryRef,
    activeSceneIdRef,
    selectedIdsRef,
  };
}
