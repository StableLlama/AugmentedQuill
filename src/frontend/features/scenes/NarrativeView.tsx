// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Narrative view for scenes.
 *
 * Shows all scenes as a full-width vertical list sorted by their prose
 * position (start_offset within their scope).  Horizontal dividers are
 * inserted at chapter and book boundaries so the writer can see how the
 * scenes map onto the story structure.
 *
 * Scenes without a prose link are collected at the bottom of the list.
 *
 * Selection semantics (single click, Ctrl+click, Shift+click, active scene
 * highlighting, and editor prose-highlight sync) are identical to the
 * Pinboard view, implemented via the shared useSceneSelection hook.
 */

import React, {
  useMemo,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
  useEffect,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { Scene, SceneId } from '../../types';
import type { Chapter, Book, SourcebookEntry } from '../../types/domain';
import type { ProseDropData } from './types';
import { SceneCard } from './SceneCard';
import { CauseArrows } from './ConstraintArrows';
import type { CardLayoutMap, CardLayout } from './ConstraintArrows';
import { useSceneSelection } from './useSceneSelection';
import { useTheme } from '../layout/ThemeContext';
import { useSceneLanes, isCharacterEntry } from './useSceneLanes';
import { LaneHeader } from './LaneHeader';
import {
  buildChapterOrderMap,
  proseSort,
  chronologicalSort,
  normalizeChapterId,
} from './sceneSortUtils';
import type { ProjectType } from './sceneSortUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NarrativeViewProps {
  scenes: Scene[];
  sourcebookEntries?: SourcebookEntry[];
  projectType: ProjectType;
  chapters: Chapter[];
  books?: Book[];
  sortMode?: 'narrative' | 'chronological';
  primarySelectedSceneId: SceneId | null;
  onSelectScene: (id: SceneId | null) => void;
  onSelectionChange?: (ids: ReadonlySet<SceneId>) => void;
  onEditScene: (sceneId: SceneId) => void;
  onDropProse?: (sceneId: SceneId, data: ProseDropData) => void;
  onReorderScene?: (
    sourceSceneId: SceneId,
    targetSceneId: SceneId,
    placeBefore: boolean
  ) => Promise<void>;
  onDropScenesOnChapter?: (
    sourceSceneIds: SceneId[],
    chapterId: string
  ) => Promise<void>;
  initialVisibleLaneEntryIds?: string[];
  initialRemovedReferencedLaneIds?: string[];
  onVisibleLaneEntryIdsChange?: (ids: string[]) => void;
  onRemovedReferencedLaneIdsChange?: (ids: string[]) => void;
}

// ---------------------------------------------------------------------------
// Rendering items (dividers + scene rows)
// ---------------------------------------------------------------------------

type NarrativeItem =
  | { kind: 'scene'; scene: Scene; sortIndex: number }
  | { kind: 'book-break'; bookId: string; bookTitle: string }
  | {
      kind: 'chapter-break';
      chapterId: string;
      chapterTitle: string;
      isLeading: boolean;
    }
  | { kind: 'unlinked-break' };

interface BreakState {
  prevChapterId: string | null | undefined;
  prevBookId: string | null | undefined;
}

function appendChapterBreakItems(
  items: NarrativeItem[],
  projectType: ProjectType,
  chapterById: Map<string, Chapter>,
  bookById: Map<string, Book>,
  chapterId: string | null,
  state: BreakState,
  hasPreviousScene: boolean
): void {
  const chapter = chapterId ? chapterById.get(chapterId) : undefined;
  if (!chapter) {
    return;
  }
  const bookId = chapter?.book_id ?? null;

  if (projectType === 'series' && bookId !== state.prevBookId) {
    const book = bookId ? bookById.get(bookId) : undefined;
    items.push({
      kind: 'book-break',
      bookId: bookId ?? '',
      bookTitle: book?.title ?? bookId ?? '',
    });
    state.prevBookId = bookId;
    state.prevChapterId = undefined;
  }

  if (projectType !== 'short-story' && chapterId !== state.prevChapterId) {
    items.push({
      kind: 'chapter-break',
      chapterId: chapterId ?? '',
      chapterTitle: chapter?.title ?? chapterId ?? '',
      isLeading: !hasPreviousScene,
    });
    state.prevChapterId = chapterId;
  }
}

function buildItems(
  sortedScenes: Scene[],
  sortMode: 'narrative' | 'chronological',
  sceneEpochNanosecondsById: Map<SceneId, bigint>,
  projectType: ProjectType,
  chapters: Chapter[],
  books: Book[]
): NarrativeItem[] {
  const chapterById = new Map<string, Chapter>(chapters.map((c: Chapter) => [c.id, c]));
  const bookById = new Map<string, Book>(books.map((b: Book) => [b.id, b]));

  const items: NarrativeItem[] = [];
  const state: BreakState = {
    prevChapterId: undefined,
    prevBookId: undefined,
  };
  let insertedUnlinkedBreak = false;

  sortedScenes.forEach((scene: Scene, sortIndex: number) => {
    const link = scene.prose_link;
    const hasValidTime = sceneEpochNanosecondsById.has(scene.id);
    const isChronologicalExtra = sortMode === 'chronological' && !link && !hasValidTime;

    if (isChronologicalExtra && !insertedUnlinkedBreak) {
      items.push({ kind: 'unlinked-break' });
      insertedUnlinkedBreak = true;
    }

    if (sortMode === 'narrative' && link && link.scope_type === 'chapter') {
      const chapterId = link.chapter_id ?? null;
      appendChapterBreakItems(
        items,
        projectType,
        chapterById,
        bookById,
        chapterId,
        state,
        sortIndex > 0
      );
    }

    items.push({ kind: 'scene', scene, sortIndex });
  });

  return items;
}

// ---------------------------------------------------------------------------
// Divider sub-components
// ---------------------------------------------------------------------------

interface BookBreakProps {
  title: string;
}

const BookBreak: React.FC<BookBreakProps> = ({ title }: BookBreakProps) => {
  const { t } = useTranslation();
  const { isLight } = useTheme();
  return (
    <div
      className="py-2"
      data-break-kind="book"
      role="separator"
      aria-label={t('Book: {{title}}', { title })}
    >
      <div className="space-y-1.5" aria-hidden="true">
        <div
          className={`h-px ${isLight ? 'bg-brand-gray-400' : 'bg-brand-gray-500'}`}
        />
        <div
          className={`h-px ${isLight ? 'bg-brand-gray-400' : 'bg-brand-gray-500'}`}
        />
      </div>
    </div>
  );
};

interface ChapterBreakProps {
  title: string;
  isLeading?: boolean;
}

const ChapterBreak: React.FC<ChapterBreakProps> = ({
  title,
  isLeading = false,
}: ChapterBreakProps) => {
  const { t } = useTranslation();
  const { isLight } = useTheme();
  return (
    <div
      className="py-2"
      data-break-kind="chapter"
      data-leading-break={isLeading ? 'true' : undefined}
      role="separator"
      aria-label={t('Chapter: {{title}}', { title })}
    >
      {!isLeading && (
        <div
          aria-hidden="true"
          className={`h-px ${isLight ? 'bg-brand-gray-200' : 'bg-brand-gray-700'}`}
        />
      )}
    </div>
  );
};

const UnlinkedBreak: React.FC = () => {
  const { t } = useTranslation();
  const { isLight } = useTheme();
  return (
    <div
      className={`flex items-center gap-2 py-2 ${isLight ? 'text-brand-gray-500' : 'text-brand-gray-400'}`}
      role="separator"
      aria-label={t('Scenes not yet linked to prose')}
    >
      <div
        className={`flex-1 h-px ${isLight ? 'bg-brand-gray-200' : 'bg-brand-gray-700'}`}
      />
      <span className="text-xs font-medium truncate max-w-xs">
        {t('Scenes not yet linked to prose')}
      </span>
      <div
        className={`flex-1 h-px ${isLight ? 'bg-brand-gray-200' : 'bg-brand-gray-700'}`}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/* eslint-disable complexity */
// Intentionally kept as one component to keep list, marker plane, and drag UX co-located.
// eslint-disable-next-line max-lines-per-function
export const NarrativeView: React.FC<NarrativeViewProps> = ({
  scenes,
  sourcebookEntries = [],
  projectType,
  chapters,
  books = [],
  sortMode = 'narrative',
  primarySelectedSceneId,
  onSelectScene,
  onSelectionChange,
  onEditScene,
  onDropProse,
  onReorderScene,
  onDropScenesOnChapter,
  initialVisibleLaneEntryIds,
  initialRemovedReferencedLaneIds,
  onVisibleLaneEntryIdsChange,
  onRemovedReferencedLaneIdsChange,
}: NarrativeViewProps) => {
  const DRAG_SCENE_MIME = 'application/x-augmentedquill-scene-id';
  const DRAG_SCENES_MIME = 'application/x-augmentedquill-scene-ids';
  const { t } = useTranslation();
  const { isLight } = useTheme();

  const parseSceneId = useCallback((raw: string): SceneId | null => {
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? (parsed as SceneId) : null;
  }, []);

  const lanes = useSceneLanes({
    scenes,
    sourcebookEntries,
    onSelectScene,
    onSelectionChange,
    initialVisibleLaneEntryIds,
    initialRemovedReferencedLaneIds,
    onVisibleLaneEntryIdsChange,
    onRemovedReferencedLaneIdsChange,
  });
  const {
    visibleLaneEntryIds,
    selectedLaneEntryIds,
    markerStyleBySceneId,
    filteredScenes,
    sceneEpochNanosecondsById,
    laneScrollLeft,
    setLaneScrollLeft,
    handleBackgroundMouseDown,
    laneButtonRefs,
    sourcebookEntriesById,
  } = lanes;

  // Build chapter order map for sorting (respects series book ordering).
  const chapterOrderMap = useMemo(
    () => buildChapterOrderMap(projectType, chapters, books),
    [projectType, chapters, books]
  );

  // Sort scenes either by prose order (Narrative) or by scene time (Chronological),
  // using prose order as deterministic fallback for ties and missing times.
  const sortedScenes = useMemo(
    () =>
      [...filteredScenes].sort((a: Scene, b: Scene) => {
        if (sortMode === 'chronological') {
          return chronologicalSort(a, b, chapterOrderMap, sceneEpochNanosecondsById);
        }
        return proseSort(a, b, chapterOrderMap);
      }),
    [filteredScenes, chapterOrderMap, sortMode, sceneEpochNanosecondsById]
  );

  const [optimisticOrderIds, setOptimisticOrderIds] = useState<SceneId[] | null>(null);

  const displayScenes = useMemo((): Scene[] => {
    if (!optimisticOrderIds || optimisticOrderIds.length === 0) return sortedScenes;
    const byId = new Map(
      sortedScenes.map((scene: Scene): [SceneId, Scene] => [scene.id, scene])
    );
    const ordered = optimisticOrderIds
      .map((id: SceneId): Scene | undefined => byId.get(id))
      .filter((scene: Scene | undefined): scene is Scene => scene !== undefined);
    return ordered.length === sortedScenes.length ? ordered : sortedScenes;
  }, [optimisticOrderIds, sortedScenes]);

  useEffect((): void => {
    if (!optimisticOrderIds) return;
    const canonical = sortedScenes.map((scene: Scene): SceneId => scene.id);
    if (
      canonical.length === optimisticOrderIds.length &&
      canonical.every(
        (id: SceneId, idx: number): boolean => id === optimisticOrderIds[idx]
      )
    ) {
      setOptimisticOrderIds(null);
    }
  }, [optimisticOrderIds, sortedScenes]);

  // Multi-select state — identical semantics to PinboardView.
  const { selectedSceneIds, activeSceneId, handleCardSelect } = useSceneSelection({
    displayOrder: displayScenes,
    primarySelectedSceneId,
    onSelectScene,
    onSelectionChange,
  });

  // Active scene relationship sets (for cause/effect glow on cards).
  // causes = scenes this scene causally precedes.
  const activeScene = activeSceneId
    ? (scenes.find((s: Scene) => s.id === activeSceneId) ?? null)
    : null;
  const causeIds = useMemo(() => {
    if (!activeSceneId) return new Set<SceneId>();
    const predecessors = scenes
      .filter((s: Scene) => (s.causes ?? []).includes(activeSceneId))
      .map((s: Scene) => s.id);
    return new Set<SceneId>(predecessors);
  }, [activeSceneId, scenes]);
  const effectIds = new Set<SceneId>(activeScene?.causes ?? []);

  // Build the ordered list of items (dividers + scenes) to render.
  const items = useMemo(
    () =>
      buildItems(
        displayScenes,
        sortMode,
        sceneEpochNanosecondsById,
        projectType,
        chapters,
        books
      ),
    [displayScenes, sortMode, sceneEpochNanosecondsById, projectType, chapters, books]
  );

  // Build a flat index of scene entries so we can pass the correct 'index' to
  // SceneCard (it's the display position, not the original store index).
  const sceneIndexMap = useMemo(() => {
    const map = new Map<SceneId, number>();
    let i = 0;
    for (const item of items) {
      if (item.kind === 'scene') {
        map.set(item.scene.id, i++);
      }
    }
    return map;
  }, [items]);

  const bgClass = isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-950';
  const markerTrackColor = isLight ? '#6366f1' : '#a5b4fc';
  const markerHollowFill = isLight ? '#f8fafc' : '#0f172a';
  const otherMarkerTrackColor = isLight ? '#8b1f3d' : '#f5c3d1';
  const otherMarkerSolidFill = isLight ? '#8b1f3d' : '#f5c3d1';

  // -------------------------------------------------------------------------
  // Card position tracking for SVG arrow overlay
  // -------------------------------------------------------------------------

  /** Refs to each scene card's wrapper div, keyed by scene id. */
  const cardWrapperRefs = useRef(new Map<SceneId, HTMLDivElement>());
  const narrativeRootRef = useRef<HTMLDivElement>(null);

  const laneTrackRef = useRef<HTMLDivElement>(null);
  const bottomLaneScrollRef = useRef<HTMLDivElement>(null);

  /** DOM-measured card layouts (x, y, w, h) relative to the inner container. */
  const [cardLayouts, setCardLayouts] = useState<CardLayoutMap>(new Map());
  const [laneCenterXById, setLaneCenterXById] = useState<Map<string, number>>(
    new Map()
  );
  /** Width of the full lane plane, used for SVG overlay and bottom scrollbar. */
  const [lanePlaneWidth, setLanePlaneWidth] = useState(0);
  /** Height of the full scrollable content area for vertical sourcebook lines. */
  const [lanePlaneHeight, setLanePlaneHeight] = useState(0);

  /** Ref to the inner positioned container (SVG coordinate origin). */
  const innerContainerRef = useRef<HTMLDivElement>(null);

  /** Stable empty maps so CauseArrows doesn't recreate objects on every render. */
  const emptyPositions = useMemo(
    () => new Map<SceneId, { x: number; y: number }>(),
    []
  );
  const emptyHeights = useMemo(() => new Map<SceneId, number>(), []);

  /**
   * Ordered relationship keys currently drawn by CauseArrows.
   *
   * We keep the exact cause/effect logic from the pinboard view; this list is
   * only used to assign a fixed x-lane per arrow in Narrative mode.
   */
  const narrativeArrowKeys = useMemo(() => {
    const keys: string[] = [];
    if (!activeSceneId) return keys;

    const active = scenes.find((s: Scene) => s.id === activeSceneId);
    if (!active) return keys;
    for (const scene of scenes) {
      if ((scene.causes ?? []).includes(activeSceneId)) {
        keys.push(`${scene.id}->${activeSceneId}`);
      }
    }
    for (const effectId of active.causes) {
      keys.push(`${activeSceneId}->${effectId}`);
    }
    return keys;
  }, [activeSceneId, scenes]);

  /**
   * Fixed x-lane per relation key, evenly spread over card width.
   *
   * This guarantees x1 === x2 for each arrow, while multiple arrows are still
   * distributed from left to right to avoid overlap.
   */
  const narrativeArrowLaneXByKey = useMemo(() => {
    const map = new Map<string, number>();
    if (narrativeArrowKeys.length === 0) return map;

    let anchorX = 0;
    let anchorW = innerContainerRef.current?.offsetWidth ?? 0;
    for (const scene of sortedScenes) {
      const layout = cardLayouts.get(scene.id);
      if (!layout) continue;
      anchorX = layout.x;
      anchorW = layout.w;
      break;
    }
    if (!anchorW) return map;

    const lanePadding = Math.min(36, Math.max(12, anchorW * 0.08));
    const left = anchorX + lanePadding;
    const right = Math.max(left, anchorX + anchorW - lanePadding);
    const count = narrativeArrowKeys.length;

    narrativeArrowKeys.forEach((key: string, i: number) => {
      const x =
        count === 1 ? (left + right) / 2 : left + (i * (right - left)) / (count - 1);
      map.set(key, x);
    });

    return map;
  }, [narrativeArrowKeys, sortedScenes, cardLayouts]);

  /** Re-measure all tracked card divs and update layout state. */
  const measureLayouts = useCallback(() => {
    const next = new Map<SceneId, CardLayout>();
    cardWrapperRefs.current.forEach((el: HTMLDivElement, id: SceneId) => {
      next.set(id, {
        x: el.offsetLeft,
        y: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
      });
    });
    setCardLayouts(next);

    const nextLaneCenters = new Map<string, number>();
    const overlayRect = innerContainerRef.current?.getBoundingClientRect();
    laneButtonRefs.current.forEach((el: HTMLButtonElement, id: string): void => {
      if (overlayRect) {
        const rect = el.getBoundingClientRect();
        nextLaneCenters.set(id, rect.left - overlayRect.left + rect.width / 2);
      } else {
        nextLaneCenters.set(id, el.offsetLeft + el.offsetWidth / 2);
      }
    });
    setLaneCenterXById(nextLaneCenters);
    setLanePlaneWidth(
      laneTrackRef.current?.scrollWidth ?? laneTrackRef.current?.offsetWidth ?? 0
    );
    setLanePlaneHeight(innerContainerRef.current?.scrollHeight ?? 0);
  }, []);

  // Measure after each render that changes the item list (scenes added/removed
  // or card heights change due to content reflow).
  useLayoutEffect(() => {
    measureLayouts();
  }, [items, visibleLaneEntryIds, measureLayouts]);

  // Also re-measure when the container is resized (window resize, panel drag).
  useEffect(() => {
    const el = innerContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measureLayouts);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureLayouts]);

  // -------------------------------------------------------------------------
  // Narrative drag/reorder interactions
  // -------------------------------------------------------------------------

  const [dragSceneId, setDragSceneId] = useState<SceneId | null>(null);
  const dragSceneIdRef = useRef<SceneId | null>(null);
  const dragSceneIdsRef = useRef<SceneId[]>([]);
  const [dropHint, setDropHint] = useState<{
    id: SceneId;
    placeBefore: boolean;
  } | null>(null);
  const [chapterDropTargetId, setChapterDropTargetId] = useState<string | null>(null);

  const selectedSceneIdsInDisplayOrder = useMemo(
    () =>
      displayScenes
        .map((scene: Scene): SceneId => scene.id)
        .filter((sceneId: SceneId): boolean => selectedSceneIds.has(sceneId)),
    [selectedSceneIds, displayScenes]
  );

  const reorderIdsByPlacement = useCallback(
    (
      ids: SceneId[],
      sourceId: SceneId,
      targetId: SceneId,
      placeBefore: boolean
    ): SceneId[] => {
      const sourceIndex = ids.indexOf(sourceId);
      const targetIndex = ids.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return ids;

      const next = [...ids];
      next.splice(sourceIndex, 1);
      const adjustedTargetIndex =
        sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      const insertIndex = placeBefore ? adjustedTargetIndex : adjustedTargetIndex + 1;
      next.splice(insertIndex, 0, sourceId);
      return next;
    },
    []
  );

  const resolveDraggedSceneIds = useCallback(
    (eventData: DataTransfer): SceneId[] => {
      if (dragSceneIdsRef.current.length > 0) {
        return dragSceneIdsRef.current;
      }

      const rawIds = eventData.getData(DRAG_SCENES_MIME);
      if (rawIds) {
        try {
          const parsed = JSON.parse(rawIds) as unknown;
          if (Array.isArray(parsed)) {
            return parsed.filter(
              (value: unknown): value is SceneId =>
                typeof value === 'number' && Number.isInteger(value)
            );
          }
        } catch {
          // Ignore malformed payloads.
        }
      }

      const single =
        dragSceneIdRef.current ||
        parseSceneId(eventData.getData(DRAG_SCENE_MIME)) ||
        parseSceneId(eventData.getData('text/plain')) ||
        dragSceneId;
      return single ? [single] : [];
    },
    [DRAG_SCENE_MIME, DRAG_SCENES_MIME, dragSceneId, parseSceneId]
  );

  const resolveDraggedSceneId = useCallback(
    (eventData: DataTransfer): SceneId | null => {
      const ids = resolveDraggedSceneIds(eventData);
      return ids.length > 0 ? ids[0] : null;
    },
    [resolveDraggedSceneIds]
  );
  const applyLaneScrollDelta = useCallback((delta: number): boolean => {
    const scroller = bottomLaneScrollRef.current;
    if (!scroller) return false;

    const maxScrollLeft = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
    if (maxScrollLeft <= 0) return false;

    const nextScrollLeft = Math.min(
      maxScrollLeft,
      Math.max(0, scroller.scrollLeft + delta)
    );
    if (Math.abs(nextScrollLeft - scroller.scrollLeft) < 0.1) return false;

    scroller.scrollLeft = nextScrollLeft;
    return true;
  }, []);

  const handleLaneWheelEvent = useCallback(
    (event: WheelEvent): void => {
      let delta = event.deltaX;
      if (Math.abs(delta) < 0.1 && event.shiftKey) {
        delta = event.deltaY;
      }
      if (Math.abs(delta) < 0.1) return;

      if (applyLaneScrollDelta(delta)) {
        event.preventDefault();
      }
    },
    [applyLaneScrollDelta]
  );

  useEffect(() => {
    const root = narrativeRootRef.current;
    if (!root) return;

    root.addEventListener('wheel', handleLaneWheelEvent, { passive: false });
    return () => {
      root.removeEventListener('wheel', handleLaneWheelEvent);
    };
  }, [handleLaneWheelEvent]);

  const handleSceneDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, sceneId: SceneId): void => {
      const dragIds =
        selectedSceneIds.has(sceneId) && selectedSceneIdsInDisplayOrder.length > 1
          ? selectedSceneIdsInDisplayOrder
          : [sceneId];

      dragSceneIdRef.current = sceneId;
      dragSceneIdsRef.current = dragIds;
      e.dataTransfer.effectAllowed = 'move';
      // Keep scene id in the drag payload in case React state isn't visible
      // synchronously inside dragover/drop handlers.
      e.dataTransfer.setData(DRAG_SCENE_MIME, String(sceneId));
      e.dataTransfer.setData(DRAG_SCENES_MIME, JSON.stringify(dragIds));
      e.dataTransfer.setData('text/plain', String(sceneId));
      setDragSceneId(sceneId);
      setDropHint(null);
    },
    [
      DRAG_SCENE_MIME,
      DRAG_SCENES_MIME,
      selectedSceneIds,
      selectedSceneIdsInDisplayOrder,
    ]
  );

  const handleSceneDragEnd = useCallback((): void => {
    dragSceneIdRef.current = null;
    dragSceneIdsRef.current = [];
    setDragSceneId(null);
    setDropHint(null);
    setChapterDropTargetId(null);
  }, []);

  const handleChapterDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, chapterId: string): void => {
      if (!onDropScenesOnChapter) return;
      const draggedIds = resolveDraggedSceneIds(e.dataTransfer);
      if (draggedIds.length === 0) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setChapterDropTargetId(chapterId);
    },
    [onDropScenesOnChapter, resolveDraggedSceneIds]
  );

  const handleChapterDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>, chapterId: string): Promise<void> => {
      const normalizedChapterId = chapterId.trim();
      if (!onDropScenesOnChapter || normalizedChapterId.length === 0) return;
      e.preventDefault();
      const draggedIds = resolveDraggedSceneIds(e.dataTransfer);
      if (draggedIds.length === 0) return;

      const currentIds = displayScenes.map((scene: Scene): SceneId => scene.id);
      const chapterSceneIds = displayScenes
        .filter((scene: Scene): boolean => {
          const link = scene.prose_link;
          return (
            link?.scope_type === 'chapter' &&
            normalizeChapterId(link.chapter_id) === normalizedChapterId
          );
        })
        .map((scene: Scene): SceneId => scene.id);
      if (chapterSceneIds.length > 0) {
        const withoutDragged = currentIds.filter(
          (id: SceneId): boolean => !draggedIds.includes(id)
        );
        const lastTargetId = chapterSceneIds[chapterSceneIds.length - 1];
        const targetPos = withoutDragged.indexOf(lastTargetId);
        if (targetPos >= 0) {
          const optimistic = [...withoutDragged];
          optimistic.splice(targetPos + 1, 0, ...draggedIds);
          setOptimisticOrderIds(optimistic);
        }
      }

      dragSceneIdRef.current = null;
      dragSceneIdsRef.current = [];
      setDropHint(null);
      setDragSceneId(null);
      setChapterDropTargetId(null);
      await onDropScenesOnChapter(draggedIds, normalizedChapterId);
    },
    [displayScenes, onDropScenesOnChapter, resolveDraggedSceneIds]
  );

  const handleSceneDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, sceneId: SceneId): void => {
      const sourceId = resolveDraggedSceneId(e.dataTransfer);
      if (!sourceId || sourceId === sceneId) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const placeBefore = e.clientY < rect.top + rect.height / 2;
      setDropHint((prev: { id: SceneId; placeBefore: boolean } | null) => {
        if (prev && prev.id === sceneId && prev.placeBefore === placeBefore)
          return prev;
        return { id: sceneId, placeBefore };
      });
    },
    [resolveDraggedSceneId]
  );

  const handleSceneDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>, targetId: SceneId): Promise<void> => {
      e.preventDefault();
      const sourceId = resolveDraggedSceneId(e.dataTransfer);
      if (!sourceId || sourceId === targetId) return;
      const hintedPlaceBefore =
        dropHint && dropHint.id === targetId ? dropHint.placeBefore : null;
      const rect = e.currentTarget.getBoundingClientRect();
      const placeBefore = hintedPlaceBefore ?? e.clientY < rect.top + rect.height / 2;

      const currentIds = displayScenes.map((scene: Scene): SceneId => scene.id);
      setOptimisticOrderIds(
        reorderIdsByPlacement(currentIds, sourceId, targetId, placeBefore)
      );

      dragSceneIdRef.current = null;
      setDropHint(null);
      setDragSceneId(null);
      await onReorderScene?.(sourceId, targetId, placeBefore);
    },
    [
      displayScenes,
      dropHint,
      onReorderScene,
      reorderIdsByPlacement,
      resolveDraggedSceneId,
    ]
  );

  const handleBottomLaneScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>): void => {
      const next = event.currentTarget.scrollLeft;
      setLaneScrollLeft((prev: number) => (Math.abs(prev - next) < 0.1 ? prev : next));
    },
    [setLaneScrollLeft]
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      ref={narrativeRootRef}
      className={`w-full h-full flex flex-col ${bgClass}`}
      role="region"
      aria-label={t(sortMode === 'chronological' ? 'Chronological' : 'Narrative')}
    >
      <div
        className={`sticky top-0 z-30 border-b ${isLight ? 'border-brand-gray-200 bg-brand-gray-50' : 'border-brand-gray-800 bg-brand-gray-950'}`}
      >
        <div className="overflow-hidden px-3 pt-2 pb-2">
          <LaneHeader lanes={lanes} laneTrackRef={laneTrackRef} />
        </div>
      </div>

      <div
        ref={innerContainerRef}
        className="relative flex-1 overflow-y-auto overflow-x-hidden"
        role="presentation"
        tabIndex={-1}
        onMouseDown={handleBackgroundMouseDown}
        onKeyDown={() => {}}
      >
        <div className="pointer-events-none absolute inset-0 z-0">
          <div
            className="relative h-full"
            style={{
              width: lanePlaneWidth > 0 ? `${lanePlaneWidth}px` : '100%',
              height: lanePlaneHeight > 0 ? `${lanePlaneHeight}px` : '100%',
              transform: `translateX(${-laneScrollLeft}px)`,
            }}
          >
            {visibleLaneEntryIds.map((entryId: string) => {
              const centerX = laneCenterXById.get(entryId);
              if (centerX === undefined) return null;
              const entry = sourcebookEntriesById.get(entryId);
              const entryLineColor =
                entry && isCharacterEntry(entry)
                  ? markerTrackColor
                  : otherMarkerTrackColor;
              return (
                <div
                  key={`line-${entryId}`}
                  data-sourcebook-line={entryId}
                  className="absolute w-px -translate-x-1/2"
                  style={{
                    left: centerX,
                    top: 0,
                    bottom: 0,
                    backgroundColor: entryLineColor,
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 z-20">
          <div
            className="relative h-full"
            style={{
              width: lanePlaneWidth > 0 ? `${lanePlaneWidth}px` : '100%',
              height: lanePlaneHeight > 0 ? `${lanePlaneHeight}px` : '100%',
              transform: `translateX(${-laneScrollLeft}px)`,
            }}
          >
            {items.map((item: NarrativeItem) => {
              if (item.kind !== 'scene') return null;
              const laneMarkers = markerStyleBySceneId.get(item.scene.id);
              const cardLayout = cardLayouts.get(item.scene.id);
              if (!laneMarkers || !cardLayout) return null;

              return visibleLaneEntryIds.map((entryId: string) => {
                const markerStyle = laneMarkers.get(entryId);
                const laneCenterX = laneCenterXById.get(entryId);
                if (!markerStyle || laneCenterX === undefined) {
                  return null;
                }
                const entry = sourcebookEntriesById.get(entryId);
                const entryIsCharacter = entry && isCharacterEntry(entry);
                const markerColor = entryIsCharacter
                  ? markerTrackColor
                  : otherMarkerTrackColor;
                const markerFill =
                  markerStyle === 'solid'
                    ? entryIsCharacter
                      ? markerTrackColor
                      : otherMarkerSolidFill
                    : markerHollowFill;

                return (
                  <span
                    key={`marker-${item.scene.id}-${entryId}`}
                    data-scene-link-marker={`${item.scene.id}:${entryId}`}
                    data-link-style={markerStyle}
                    className="absolute h-3 w-3 -translate-x-1/2 rounded-full border-2"
                    style={{
                      left: laneCenterX,
                      top: Math.max(cardLayout.y - 6, 0),
                      backgroundColor: markerFill,
                      borderColor: markerColor,
                    }}
                  />
                );
              });
            })}
          </div>
        </div>

        <div className="relative z-10 flex flex-col gap-2 p-3">
          {items.map((item: NarrativeItem, renderIdx: number) => {
            if (item.kind === 'book-break') {
              return (
                <BookBreak
                  key={`book-${item.bookId}-${renderIdx}`}
                  title={item.bookTitle}
                />
              );
            }
            if (item.kind === 'chapter-break') {
              return (
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                <div
                  key={`chapter-${item.chapterId}-${renderIdx}`}
                  onDragOver={(e: React.DragEvent<HTMLDivElement>): void =>
                    handleChapterDragOver(e, item.chapterId)
                  }
                  onDragEnter={(e: React.DragEvent<HTMLDivElement>): void =>
                    handleChapterDragOver(e, item.chapterId)
                  }
                  onDragLeave={(e: React.DragEvent<HTMLDivElement>): void => {
                    const relatedTarget = e.relatedTarget;
                    if (
                      relatedTarget instanceof Node &&
                      e.currentTarget.contains(relatedTarget)
                    ) {
                      return;
                    }
                    setChapterDropTargetId((current: string | null) =>
                      current === item.chapterId ? null : current
                    );
                  }}
                  onDrop={(e: React.DragEvent<HTMLDivElement>) =>
                    void handleChapterDrop(e, item.chapterId)
                  }
                  className={
                    chapterDropTargetId === item.chapterId
                      ? isLight
                        ? 'rounded-md ring-1 ring-brand-400/70 bg-brand-50/70'
                        : 'rounded-md ring-1 ring-brand-500/70 bg-brand-900/20'
                      : ''
                  }
                >
                  <ChapterBreak title={item.chapterTitle} isLeading={item.isLeading} />
                </div>
              );
            }
            if (item.kind === 'unlinked-break') {
              return <UnlinkedBreak key={`unlinked-${renderIdx}`} />;
            }

            const { scene } = item;
            const displayIndex = sceneIndexMap.get(scene.id) ?? 0;
            const dropTop = Boolean(
              dropHint &&
              dropHint.id === scene.id &&
              dropHint.placeBefore &&
              dragSceneId
            );
            const dropBottom = Boolean(
              dropHint &&
              dropHint.id === scene.id &&
              !dropHint.placeBefore &&
              dragSceneId
            );

            return (
              <div
                key={scene.id}
                ref={(el: HTMLDivElement | null) => {
                  if (el) {
                    cardWrapperRefs.current.set(scene.id, el);
                  } else {
                    cardWrapperRefs.current.delete(scene.id);
                  }
                }}
                role="presentation"
                tabIndex={-1}
                draggable={Boolean(onReorderScene)}
                onDragStart={(e: React.DragEvent<HTMLDivElement>) =>
                  handleSceneDragStart(e, scene.id)
                }
                onDragEnd={handleSceneDragEnd}
                onDragOver={(e: React.DragEvent<HTMLDivElement>) =>
                  handleSceneDragOver(e, scene.id)
                }
                onDrop={(e: React.DragEvent<HTMLDivElement>) =>
                  void handleSceneDrop(e, scene.id)
                }
                onKeyDown={() => {}}
                className={[
                  'relative',
                  dropTop
                    ? 'before:absolute before:left-0 before:right-0 before:-top-1 before:h-0.5 before:bg-brand-500 before:rounded'
                    : '',
                  dropBottom
                    ? 'after:absolute after:left-0 after:right-0 after:-bottom-1 after:h-0.5 after:bg-brand-500 after:rounded'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <SceneCard
                  scene={scene}
                  index={displayIndex}
                  variant="narrative"
                  onSelect={handleCardSelect}
                  onEdit={onEditScene}
                  isSelected={selectedSceneIds.has(scene.id)}
                  isActive={activeSceneId === scene.id}
                  isCause={causeIds.has(scene.id)}
                  isEffect={effectIds.has(scene.id)}
                  onDropProse={onDropProse}
                />
              </div>
            );
          })}
          {items.length === 0 && (
            <p
              className={`text-sm text-center py-8 ${isLight ? 'text-brand-gray-400' : 'text-brand-gray-500'}`}
            >
              {selectedLaneEntryIds.size > 0
                ? t('No scenes match the selected entries')
                : t('No scenes yet')}
            </p>
          )}
        </div>

        <CauseArrows
          scenes={scenes}
          livePositions={emptyPositions}
          cardHeights={emptyHeights}
          cardLayouts={cardLayouts}
          arrowLaneXByKey={narrativeArrowLaneXByKey}
          useVerticalCenterForConnectedOnly
          hideDefaultArrows
          activeSceneId={activeSceneId}
        />
      </div>

      <div
        className={`border-t px-3 py-1 ${isLight ? 'border-brand-gray-200 bg-brand-gray-50' : 'border-brand-gray-800 bg-brand-gray-950'}`}
      >
        <div
          ref={bottomLaneScrollRef}
          className="overflow-x-auto overflow-y-hidden"
          onScroll={handleBottomLaneScroll}
          aria-label={t('Lane horizontal scrollbar')}
        >
          <div
            style={{
              width: lanePlaneWidth,
              height: 1,
            }}
          />
        </div>
      </div>
    </div>
  );
};
/* eslint-enable complexity */

export default NarrativeView;
