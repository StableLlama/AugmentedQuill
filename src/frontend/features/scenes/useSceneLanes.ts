// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Shared hook encapsulating sourcebook-lane state and operations for
 * scene views (NarrativeView, ConvergenceMapView). Manages visible entries,
 * selection, drag-reorder, the add-entry picker, scroll position, and all
 * derived marker/filter data.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Scene, SceneId } from '../../types';
import type { SourcebookEntry } from '../../types/domain';
import type { ProjectImage } from '../../services/apiTypes';
import { listProjectImages } from '../sourcebook/sourcebookApi';
import { getSceneEpochNanoseconds } from './sceneSortUtils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LANE_DRAG_MIME = 'application/x-augmentedquill-sourcebook-lane-id';
export const CHARACTER_CATEGORY = 'character';

export function isCharacterEntry(entry?: SourcebookEntry): boolean {
  return Boolean(entry && normalizeCategory(entry.category) === CHARACTER_CATEGORY);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LaneMarkerStyle = 'solid' | 'hollow';

export interface UseSceneLanesParams {
  scenes: Scene[];
  sourcebookEntries: SourcebookEntry[];
  onSelectScene: (id: SceneId | null) => void;
  onSelectionChange?: (ids: ReadonlySet<SceneId>) => void;
  initialVisibleLaneEntryIds?: string[];
  initialRemovedReferencedLaneIds?: string[];
  onVisibleLaneEntryIdsChange?: (ids: string[]) => void;
  onRemovedReferencedLaneIdsChange?: (ids: string[]) => void;
}

export interface UseSceneLanesResult {
  // Visibility / selection
  visibleLaneEntryIds: string[];
  selectedLaneEntryIds: Set<string>;

  // Lane drag state (for drop indicators)
  dragLaneEntryId: string | null;
  laneDropHint: { id: string; placeBefore: boolean } | null;

  // Picker state
  pickerOpen: boolean;
  pickerQuery: string;
  pickerPosition: { top: number; left: number } | null;

  // Scroll position (horizontal lane scroll)
  laneScrollLeft: number;

  // Derived lookups
  sourcebookEntriesById: Map<string, SourcebookEntry>;
  sceneEntryMarkerStyles: Map<SceneId, Map<string, LaneMarkerStyle>>;
  /** markerStyleBySceneId filtered to only visible lanes. */
  markerStyleBySceneId: Map<SceneId, Map<string, LaneMarkerStyle>>;
  filteredScenes: Scene[];
  sceneEpochNanosecondsById: Map<SceneId, bigint>;
  referencedCharacterEntryIds: string[];
  projectImageByFilename: Map<string, ProjectImage>;
  availableSourcebookEntries: SourcebookEntry[];

  // Refs (created once inside the hook, stable across renders)
  laneButtonRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  addLaneButtonRef: React.MutableRefObject<HTMLButtonElement | null>;

  // Handlers
  handleLaneSelect: (
    event: React.MouseEvent<HTMLButtonElement>,
    entryId: string,
    index: number
  ) => void;
  handleLaneRemove: (entryId: string) => void;
  handleLaneAdd: (entryId: string) => void;
  handleLaneDragStart: (event: React.DragEvent<HTMLElement>, entryId: string) => void;
  handleLaneDragEnd: () => void;
  handleLaneDragOver: (event: React.DragEvent<HTMLElement>, entryId: string) => void;
  handleLaneDrop: (event: React.DragEvent<HTMLElement>, targetId: string) => void;
  handleBackgroundMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
  setPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPickerQuery: React.Dispatch<React.SetStateAction<string>>;
  setLaneScrollLeft: React.Dispatch<React.SetStateAction<number>>;
  updatePickerAlignment: () => void;
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeCategory(value: string | null | undefined): string {
  return normalizeToken(value);
}

function arraysEqual(valuesA: string[], valuesB: string[]): boolean {
  return (
    valuesA.length === valuesB.length &&
    valuesA.every((v: string, i: number) => v === valuesB[i])
  );
}

function reorderValues(
  values: string[],
  sourceId: string,
  targetId: string,
  placeBefore: boolean
): string[] {
  if (sourceId === targetId) return values;
  const next = [...values];
  const sourceIndex = next.indexOf(sourceId);
  const targetIndex = next.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return values;

  next.splice(sourceIndex, 1);
  const adjustedTargetIndex = next.indexOf(targetId);
  const insertIndex = placeBefore ? adjustedTargetIndex : adjustedTargetIndex + 1;
  next.splice(insertIndex, 0, sourceId);
  return next;
}

function mergeMarkerStyle(
  current: LaneMarkerStyle | undefined,
  incoming: LaneMarkerStyle
): LaneMarkerStyle {
  if (current === 'solid' || incoming === 'solid') return 'solid';
  return 'hollow';
}

export function getHorizontalDropBoundary(element: HTMLElement): {
  left: number;
  width: number;
} {
  const rect = element.getBoundingClientRect();
  if (rect.width > 0) return { left: rect.left, width: rect.width };

  const button = element.querySelector('button');
  if (button instanceof HTMLButtonElement) {
    const buttonRect = button.getBoundingClientRect();
    return { left: buttonRect.left, width: buttonRect.width };
  }

  return { left: rect.left, width: rect.width };
}

function useProjectImages(): ProjectImage[] {
  const [projectImages, setProjectImages] = useState<ProjectImage[]>([]);

  useEffect(() => {
    let isMounted = true;
    void listProjectImages()
      .then((images: ProjectImage[]) => {
        if (isMounted) setProjectImages(images);
      })
      .catch(() => {
        // Ignore image-list failures so views keep rendering in tests
        // and when project images are unavailable.
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return projectImages;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
// eslint-disable-next-line max-lines-per-function
export function useSceneLanes({
  scenes,
  sourcebookEntries,
  onSelectScene,
  onSelectionChange,
  initialVisibleLaneEntryIds,
  initialRemovedReferencedLaneIds,
  onVisibleLaneEntryIdsChange,
  onRemovedReferencedLaneIdsChange,
}: UseSceneLanesParams): UseSceneLanesResult {
  const sourcebookEntriesById = useMemo(
    () => new Map(sourcebookEntries.map((entry: SourcebookEntry) => [entry.id, entry])),
    [sourcebookEntries]
  );

  const sourcebookEntryIds = useMemo(
    () => new Set(sourcebookEntries.map((entry: SourcebookEntry) => entry.id)),
    [sourcebookEntries]
  );

  const entryIdsByToken = useMemo(() => {
    const map = new Map<string, string[]>();
    sourcebookEntries.forEach((entry: SourcebookEntry) => {
      [entry.name, ...(entry.synonyms ?? [])].forEach((label: string) => {
        const normalized = normalizeToken(label);
        if (!normalized) return;
        const current = map.get(normalized) ?? [];
        if (!current.includes(entry.id)) {
          current.push(entry.id);
          map.set(normalized, current);
        }
      });
    });
    return map;
  }, [sourcebookEntries]);

  const sceneEntryMarkerStyles = useMemo(() => {
    const stylesBySceneId = new Map<SceneId, Map<string, LaneMarkerStyle>>();

    const register = (
      sceneId: SceneId,
      entryId: string,
      style: LaneMarkerStyle
    ): void => {
      const sceneStyles =
        stylesBySceneId.get(sceneId) ?? new Map<string, LaneMarkerStyle>();
      sceneStyles.set(entryId, mergeMarkerStyle(sceneStyles.get(entryId), style));
      stylesBySceneId.set(sceneId, sceneStyles);
    };

    scenes.forEach((scene: Scene) => {
      scene.active_characters.forEach((name: string) => {
        (entryIdsByToken.get(normalizeToken(name)) ?? []).forEach((entryId: string) => {
          const entry = sourcebookEntriesById.get(entryId);
          if (isCharacterEntry(entry)) {
            register(scene.id, entryId, 'solid');
          }
        });
      });

      scene.passive_characters.forEach((name: string) => {
        (entryIdsByToken.get(normalizeToken(name)) ?? []).forEach((entryId: string) => {
          const entry = sourcebookEntriesById.get(entryId);
          if (isCharacterEntry(entry)) {
            register(scene.id, entryId, 'hollow');
          }
        });
      });

      (scene.sourcebook_entry_ids ?? []).forEach((entryId: string) => {
        const entry = sourcebookEntriesById.get(entryId);
        if (entry && !isCharacterEntry(entry)) {
          register(scene.id, entryId, 'solid');
        }
      });

      [scene.location, scene.time].forEach((label: string | null | undefined) => {
        (entryIdsByToken.get(normalizeToken(label)) ?? []).forEach(
          (entryId: string) => {
            const entry = sourcebookEntriesById.get(entryId);
            if (entry && !isCharacterEntry(entry)) {
              register(scene.id, entryId, 'solid');
            }
          }
        );
      });
    });

    return stylesBySceneId;
  }, [entryIdsByToken, scenes, sourcebookEntriesById]);

  const referencedCharacterEntryIds = useMemo(() => {
    const orderedIds: string[] = [];
    const seen = new Set<string>();

    scenes.forEach((scene: Scene) => {
      const sceneStyles = sceneEntryMarkerStyles.get(scene.id);
      if (!sceneStyles) return;
      sceneStyles.forEach((_style: LaneMarkerStyle, entryId: string) => {
        const entry = sourcebookEntriesById.get(entryId);
        if (!entry || normalizeCategory(entry.category) !== CHARACTER_CATEGORY) return;
        if (!seen.has(entryId)) {
          seen.add(entryId);
          orderedIds.push(entryId);
        }
      });
    });

    return orderedIds;
  }, [sceneEntryMarkerStyles, scenes, sourcebookEntriesById]);

  const [visibleLaneEntryIds, setVisibleLaneEntryIds] = useState<string[]>(
    initialVisibleLaneEntryIds ?? referencedCharacterEntryIds
  );
  const [removedReferencedLaneIds, setRemovedReferencedLaneIds] = useState<Set<string>>(
    () => new Set<string>(initialRemovedReferencedLaneIds ?? [])
  );

  const updateVisibleLaneEntryIds = useCallback((nextIds: string[]): void => {
    setVisibleLaneEntryIds((prev: string[]) => {
      if (arraysEqual(prev, nextIds)) return prev;
      return nextIds;
    });
  }, []);

  const updateRemovedReferencedLaneIds = useCallback((nextIds: Set<string>): void => {
    setRemovedReferencedLaneIds((prev: Set<string>) => {
      const prevArray = [...prev].sort();
      const nextArray = [...nextIds].sort();
      if (arraysEqual(prevArray, nextArray)) return prev;
      return nextIds;
    });
  }, []);

  useEffect(() => {
    if (initialVisibleLaneEntryIds) {
      updateVisibleLaneEntryIds(initialVisibleLaneEntryIds);
    }
  }, [initialVisibleLaneEntryIds, updateVisibleLaneEntryIds]);

  useEffect(() => {
    if (initialRemovedReferencedLaneIds) {
      updateRemovedReferencedLaneIds(new Set(initialRemovedReferencedLaneIds));
    }
  }, [initialRemovedReferencedLaneIds, updateRemovedReferencedLaneIds]);

  // Sync local visibleLaneEntryIds to the parent's external store.
  // This must be a separate effect (not inside the useState updater) to
  // avoid calling setSceneLaneState (or any external store update) during
  // React's state reconciliation, which triggers cross-component re-renders
  // in the middle of the render phase.
  useEffect(() => {
    onVisibleLaneEntryIdsChange?.(visibleLaneEntryIds);
  }, [visibleLaneEntryIds, onVisibleLaneEntryIdsChange]);

  useEffect(() => {
    onRemovedReferencedLaneIdsChange?.([...removedReferencedLaneIds]);
  }, [removedReferencedLaneIds, onRemovedReferencedLaneIdsChange]);

  const [selectedLaneEntryIds, setSelectedLaneEntryIds] = useState<Set<string>>(
    () => new Set<string>()
  );
  const [lastSelectedLaneIndex, setLastSelectedLaneIndex] = useState<number | null>(
    null
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerPosition, setPickerPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const projectImages = useProjectImages();
  const [laneScrollLeft, setLaneScrollLeft] = useState(0);

  const [dragLaneEntryId, setDragLaneEntryId] = useState<string | null>(null);
  const dragLaneEntryIdRef = useRef<string | null>(null);
  const [laneDropHint, setLaneDropHint] = useState<{
    id: string;
    placeBefore: boolean;
  } | null>(null);

  const laneButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const addLaneButtonRef = useRef<HTMLButtonElement | null>(null);
  // Keep removedReferencedLaneIds in sync when sourcebook entries change.
  useEffect(() => {
    const next = new Set<string>();
    removedReferencedLaneIds.forEach((entryId: string) => {
      if (
        sourcebookEntryIds.has(entryId) &&
        referencedCharacterEntryIds.includes(entryId)
      ) {
        next.add(entryId);
      }
    });
    updateRemovedReferencedLaneIds(next);
  }, [
    referencedCharacterEntryIds,
    sourcebookEntryIds,
    removedReferencedLaneIds,
    updateRemovedReferencedLaneIds,
  ]);

  // Sync visible lanes when sourcebook entries or referenced characters change.
  useEffect(() => {
    const next = visibleLaneEntryIds.filter((entryId: string) =>
      sourcebookEntryIds.has(entryId)
    );
    referencedCharacterEntryIds.forEach((entryId: string) => {
      if (!removedReferencedLaneIds.has(entryId) && !next.includes(entryId)) {
        next.push(entryId);
      }
    });
    if (!arraysEqual(visibleLaneEntryIds, next)) {
      updateVisibleLaneEntryIds(next);
    }
  }, [
    referencedCharacterEntryIds,
    removedReferencedLaneIds,
    sourcebookEntryIds,
    updateVisibleLaneEntryIds,
    visibleLaneEntryIds,
  ]);

  // Drop selected lanes that were removed from visible list.
  useEffect(() => {
    setSelectedLaneEntryIds((prev: Set<string>) => {
      const next = new Set<string>();
      prev.forEach((entryId: string) => {
        if (visibleLaneEntryIds.includes(entryId)) next.add(entryId);
      });
      if (
        next.size === prev.size &&
        [...next].every((entryId: string) => prev.has(entryId))
      ) {
        return prev;
      }
      return next;
    });
  }, [visibleLaneEntryIds]);

  const projectImageByFilename = useMemo(
    () => new Map(projectImages.map((image: ProjectImage) => [image.filename, image])),
    [projectImages]
  );

  const markerStyleBySceneId = useMemo(() => {
    const stylesBySceneId = new Map<SceneId, Map<string, LaneMarkerStyle>>();
    sceneEntryMarkerStyles.forEach(
      (styles: Map<string, LaneMarkerStyle>, sceneId: SceneId) => {
        const filtered = new Map<string, LaneMarkerStyle>();
        visibleLaneEntryIds.forEach((entryId: string) => {
          const style = styles.get(entryId);
          if (style) filtered.set(entryId, style);
        });
        if (filtered.size > 0) stylesBySceneId.set(sceneId, filtered);
      }
    );
    return stylesBySceneId;
  }, [sceneEntryMarkerStyles, visibleLaneEntryIds]);

  const filteredScenes = useMemo(() => {
    if (selectedLaneEntryIds.size === 0) return scenes;
    return scenes.filter((scene: Scene) => {
      const sceneStyles = sceneEntryMarkerStyles.get(scene.id);
      if (!sceneStyles) return false;
      return [...selectedLaneEntryIds].some((entryId: string) =>
        sceneStyles.has(entryId)
      );
    });
  }, [sceneEntryMarkerStyles, scenes, selectedLaneEntryIds]);

  const sceneEpochNanosecondsById = useMemo(() => {
    const map = new Map<SceneId, bigint>();
    for (const scene of scenes) {
      const epoch = getSceneEpochNanoseconds(scene);
      if (epoch !== null) map.set(scene.id, epoch);
    }
    return map;
  }, [scenes]);

  const availableSourcebookEntries = useMemo(() => {
    const visibleIds = new Set<string>(visibleLaneEntryIds);
    const query = normalizeToken(pickerQuery);
    return sourcebookEntries
      .filter((entry: SourcebookEntry) => !visibleIds.has(entry.id))
      .filter((entry: SourcebookEntry) => {
        if (!query) return true;
        return [entry.name, ...(entry.synonyms ?? []), entry.category ?? ''].some(
          (v: string) => normalizeToken(v).includes(query)
        );
      })
      .sort((a: SourcebookEntry, b: SourcebookEntry) => a.name.localeCompare(b.name));
  }, [pickerQuery, sourcebookEntries, visibleLaneEntryIds]);

  // -------------------------------------------------------------------------
  // Picker alignment
  // -------------------------------------------------------------------------

  const updatePickerAlignment = useCallback((): void => {
    const rect = addLaneButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      setPickerPosition(null);
      return;
    }

    const menuWidth = 288;
    const menuHeight = 320;
    const viewportPadding = 8;
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - menuWidth - viewportPadding
    );
    const left = Math.min(maxLeft, Math.max(viewportPadding, rect.left));
    const preferredTop = rect.bottom + 8;
    const maxTop = Math.max(
      viewportPadding,
      window.innerHeight - menuHeight - viewportPadding
    );
    const top = Math.min(maxTop, Math.max(viewportPadding, preferredTop));
    setPickerPosition({ top, left });
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const handleViewportChange = (): void => updatePickerAlignment();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [pickerOpen, updatePickerAlignment]);

  // -------------------------------------------------------------------------
  // Lane handlers
  // -------------------------------------------------------------------------

  const handleLaneSelect = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement>,
      entryId: string,
      index: number
    ): void => {
      setSelectedLaneEntryIds((prev: Set<string>) => {
        if (event.shiftKey && lastSelectedLaneIndex !== null) {
          const start = Math.min(lastSelectedLaneIndex, index);
          const end = Math.max(lastSelectedLaneIndex, index);
          const range = visibleLaneEntryIds.slice(start, end + 1);
          return new Set<string>(
            event.ctrlKey || event.metaKey ? [...prev, ...range] : range
          );
        }

        if (event.ctrlKey || event.metaKey) {
          const next = new Set<string>(prev);
          if (next.has(entryId)) {
            next.delete(entryId);
          } else {
            next.add(entryId);
          }
          return next;
        }

        if (prev.size === 1 && prev.has(entryId)) return new Set<string>();
        return new Set<string>([entryId]);
      });
      setLastSelectedLaneIndex(index);
    },
    [lastSelectedLaneIndex, visibleLaneEntryIds]
  );

  const handleLaneRemove = useCallback(
    (entryId: string): void => {
      if (referencedCharacterEntryIds.includes(entryId)) {
        const next = new Set<string>(removedReferencedLaneIds);
        next.add(entryId);
        updateRemovedReferencedLaneIds(next);
      }
      updateVisibleLaneEntryIds(
        visibleLaneEntryIds.filter((id: string) => id !== entryId)
      );
      setSelectedLaneEntryIds((prev: Set<string>) => {
        if (!prev.has(entryId)) return prev;
        const next = new Set<string>(prev);
        next.delete(entryId);
        return next;
      });
    },
    [
      referencedCharacterEntryIds,
      removedReferencedLaneIds,
      updateRemovedReferencedLaneIds,
      updateVisibleLaneEntryIds,
      visibleLaneEntryIds,
    ]
  );

  const handleLaneAdd = useCallback(
    (entryId: string): void => {
      if (!visibleLaneEntryIds.includes(entryId)) {
        updateVisibleLaneEntryIds([...visibleLaneEntryIds, entryId]);
      }
      if (removedReferencedLaneIds.has(entryId)) {
        const next = new Set<string>(removedReferencedLaneIds);
        next.delete(entryId);
        updateRemovedReferencedLaneIds(next);
      }
      setPickerOpen(false);
      setPickerQuery('');
    },
    [
      removedReferencedLaneIds,
      updateRemovedReferencedLaneIds,
      updateVisibleLaneEntryIds,
      visibleLaneEntryIds,
    ]
  );

  const handleLaneDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>, entryId: string): void => {
      dragLaneEntryIdRef.current = entryId;
      setDragLaneEntryId(entryId);
      setLaneDropHint(null);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(LANE_DRAG_MIME, entryId);
      event.dataTransfer.setData('text/plain', entryId);
    },
    []
  );

  const handleLaneDragEnd = useCallback((): void => {
    dragLaneEntryIdRef.current = null;
    setDragLaneEntryId(null);
    setLaneDropHint(null);
  }, []);

  const handleLaneDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>, entryId: string): void => {
      const sourceId =
        dragLaneEntryIdRef.current ||
        event.dataTransfer.getData(LANE_DRAG_MIME) ||
        dragLaneEntryId;
      if (!sourceId || sourceId === entryId) return;
      event.preventDefault();
      const boundary = getHorizontalDropBoundary(event.currentTarget);
      const placeBefore = event.clientX < boundary.left + boundary.width / 2;
      setLaneDropHint((prev: { id: string; placeBefore: boolean } | null) => {
        if (prev && prev.id === entryId && prev.placeBefore === placeBefore)
          return prev;
        return { id: entryId, placeBefore };
      });
    },
    [dragLaneEntryId]
  );

  const handleLaneDrop = useCallback(
    (event: React.DragEvent<HTMLElement>, targetId: string): void => {
      event.preventDefault();
      const sourceId =
        dragLaneEntryIdRef.current ||
        event.dataTransfer.getData(LANE_DRAG_MIME) ||
        dragLaneEntryId;
      if (!sourceId || sourceId === targetId) return;
      const boundary = getHorizontalDropBoundary(event.currentTarget);
      const placeBefore = event.clientX < boundary.left + boundary.width / 2;
      updateVisibleLaneEntryIds(
        reorderValues(visibleLaneEntryIds, sourceId, targetId, placeBefore)
      );
      dragLaneEntryIdRef.current = null;
      setDragLaneEntryId(null);
      setLaneDropHint(null);
    },
    [dragLaneEntryId, updateVisibleLaneEntryIds, visibleLaneEntryIds]
  );

  const handleBackgroundMouseDown = useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-scene-card]')) return;
      if (target.closest('[data-sourcebook-lane-item]')) return;
      if (target.closest('button, input, textarea, select, a, [role="button"]')) return;
      setSelectedLaneEntryIds(new Set<string>());
      onSelectScene(null);
      onSelectionChange?.(new Set<SceneId>());
    },
    [onSelectScene, onSelectionChange]
  );

  return {
    visibleLaneEntryIds,
    selectedLaneEntryIds,
    dragLaneEntryId,
    laneDropHint,
    pickerOpen,
    pickerQuery,
    pickerPosition,
    laneScrollLeft,
    sourcebookEntriesById,
    sceneEntryMarkerStyles,
    markerStyleBySceneId,
    filteredScenes,
    sceneEpochNanosecondsById,
    referencedCharacterEntryIds,
    projectImageByFilename,
    availableSourcebookEntries,
    laneButtonRefs,
    addLaneButtonRef,
    handleLaneSelect,
    handleLaneRemove,
    handleLaneAdd,
    handleLaneDragStart,
    handleLaneDragEnd,
    handleLaneDragOver,
    handleLaneDrop,
    handleBackgroundMouseDown,
    setPickerOpen,
    setPickerQuery,
    setLaneScrollLeft,
    updatePickerAlignment,
  };
}
