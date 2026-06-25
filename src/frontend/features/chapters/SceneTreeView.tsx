// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Compact scene tree view for the left sidebar chapters section.
 * Renders chapters as expandable nodes with scenes in narrative order.
 * Supports drag-to-reorder via the same MIME types as NarrativeView,
 * and dispatches custom events for cross-pane DnD communication.
 */

/* eslint-disable max-lines-per-function */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Scene, SceneId, Chapter, Book } from '../../types';
import {
  proseSort,
  buildChapterOrderMap,
  normalizeChapterId,
} from '../scenes/sceneSortUtils';
import { ChevronRight, ChevronDown } from 'lucide-react';
import {
  DRAG_SCENE_MIME,
  DRAG_SCENES_MIME,
  hasSceneDragMimeTypes,
  resolveDraggedSceneIdsFromTransfer,
  reorderIdsByPlacement,
  dispatchOptimisticReorder,
  dispatchReorderProse,
  dispatchDropChapter,
  EVT_OPTIMISTIC_REORDER,
} from '../scenes/sceneDragUtils';
import { useUIStore, uiStoreActions, type UIStoreState } from '../../stores/uiStore';

export interface SceneTreeViewProps {
  scenes: Scene[];
  chapters: Chapter[];
  books: Book[];
  projectType: 'novel' | 'series';
  currentChapterId: string | null;
  onSelectChapter: (id: string) => void;
  /** Called to initiate a scene reorder via the prose-reorder API. */
  onReorderScene?: (
    sourceSceneId: SceneId,
    targetSceneId: SceneId,
    placeBefore: boolean
  ) => void;
  /** Called to move scenes into a chapter. */
  onDropScenesOnChapter?: (sceneIds: SceneId[], chapterId: string) => void;
  /** Called when a scene row is clicked so the main view can sync selection. */
  onSelectScene?: (id: SceneId) => void;
  /** Called when a scene row is double-clicked to open the scene editor. */
  onEditScene?: (id: SceneId) => void;
  isLight: boolean;
}

/**
 * Truncate scene summary to the first sentence or ~80 chars for compact display.
 */
function compactSummary(summary: string): string {
  if (!summary) return '';
  const trimmed = summary.trim();
  // Match the FIRST sentence-ending punctuation (lazy quantifier).
  const sentenceMatch = trimmed.match(/^([^.!?]+?[.!?])(?:\s|$)/);
  if (sentenceMatch) return sentenceMatch[1];
  return trimmed.length > 80 ? trimmed.slice(0, 77) + '\u2026' : trimmed;
}

export const SceneTreeView = ({
  scenes,
  chapters,
  books,
  projectType,
  currentChapterId,
  onSelectChapter,
  onReorderScene,
  onDropScenesOnChapter,
  onSelectScene,
  onEditScene,
  isLight,
}: SceneTreeViewProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({});
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>({});

  // Read the primary selected scene ID from the store so both panes stay
  // synchronised — the main view writes it, the left pane reads it.
  const primarySelectedSceneId = useUIStore(
    (s: UIStoreState): SceneId | null => s.sceneSelectionPrimaryId
  );

  const chapterOrderMap = useMemo(
    () => buildChapterOrderMap(projectType, chapters, books),
    [projectType, chapters, books]
  );

  const toggleChapter = useCallback((id: string): void => {
    setExpandedChapters((prev: Record<string, boolean>) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }, []);

  const toggleBook = useCallback((id: string): void => {
    setExpandedBooks((prev: Record<string, boolean>) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // ---- Drag state (mirrors NarrativeView pattern) ----
  const dragSceneIdRef = useRef<SceneId | null>(null);
  const dragSceneIdsRef = useRef<SceneId[]>([]);
  const [dragSceneId, setDragSceneId] = useState<SceneId | null>(null);
  const [dropHint, setDropHint] = useState<{
    id: SceneId;
    placeBefore: boolean;
  } | null>(null);
  const [chapterDropTargetId, setChapterDropTargetId] = useState<string | null>(null);

  // Optimistic ordering for immediate visual feedback during DnD.
  const [optimisticOrderIds, setOptimisticOrderIds] = useState<SceneId[] | null>(null);

  // Build a flat list of all scenes in narrative order across all chapters.
  const allScenesNarrative = useMemo((): Scene[] => {
    const sorted = [...scenes].sort((a: Scene, b: Scene) =>
      proseSort(a, b, chapterOrderMap)
    );
    return sorted.filter((s: Scene) => {
      const link = s.prose_link;
      return link?.scope_type === 'chapter' && link.chapter_id;
    });
  }, [scenes, chapterOrderMap]);

  // Display order: optimistic during DnD, canonical otherwise.
  const displaySceneOrder = useMemo((): SceneId[] => {
    if (optimisticOrderIds && optimisticOrderIds.length > 0) return optimisticOrderIds;
    return allScenesNarrative.map((s: Scene): SceneId => s.id);
  }, [optimisticOrderIds, allScenesNarrative]);

  // Clear optimistic order when it matches canonical.
  React.useEffect((): void => {
    if (!optimisticOrderIds) return;
    const canonical = allScenesNarrative.map((s: Scene): SceneId => s.id);
    if (
      canonical.length === optimisticOrderIds.length &&
      canonical.every(
        (id: SceneId, idx: number): boolean => id === optimisticOrderIds[idx]
      )
    ) {
      setOptimisticOrderIds(null);
    }
  }, [optimisticOrderIds, allScenesNarrative]);

  // Listen for optimistic reorders from the main view so both panes stay in
  // sync immediately, without waiting for the server response.
  React.useEffect(() => {
    const handler = (event: Event): void => {
      const custom = event as CustomEvent<{ orderIds?: SceneId[] }>;
      const orderIds = custom.detail?.orderIds;
      if (!Array.isArray(orderIds) || orderIds.length === 0) return;
      setOptimisticOrderIds(orderIds as SceneId[]);
    };
    window.addEventListener(EVT_OPTIMISTIC_REORDER, handler);
    return (): void => window.removeEventListener(EVT_OPTIMISTIC_REORDER, handler);
  }, []);

  // Scene lookup by ID.
  const sceneById = useMemo(() => {
    const map = new Map<SceneId, Scene>();
    scenes.forEach((s: Scene) => map.set(s.id, s));
    return map;
  }, [scenes]);

  // Group scenes by their chapter, using display order so optimistic DnD
  // reorders are reflected immediately without waiting for the API response.
  const scenesByChapter = useMemo(() => {
    const byChapter = new Map<string, Scene[]>();
    for (const sceneId of displaySceneOrder) {
      const scene = sceneById.get(sceneId);
      if (!scene) continue;
      const link = scene.prose_link;
      if (link?.scope_type === 'chapter' && link.chapter_id) {
        const cid = normalizeChapterId(link.chapter_id);
        if (cid) {
          const list = byChapter.get(cid) ?? [];
          list.push(scene);
          byChapter.set(cid, list);
        }
      }
    }
    return byChapter;
  }, [displaySceneOrder, sceneById]);

  const sceneIdByToken = useMemo(() => {
    const byToken = new Map<string, SceneId>();
    scenes.forEach((s: Scene): void => {
      byToken.set(String(s.id), s.id);
    });
    return byToken;
  }, [scenes]);

  // Resolve dragged scene IDs using shared utility.
  const resolveDraggedSceneIds = useCallback(
    (eventData: DataTransfer): SceneId[] =>
      resolveDraggedSceneIdsFromTransfer(
        eventData,
        sceneIdByToken,
        dragSceneIdRef.current,
        dragSceneIdsRef.current,
        dragSceneId
      ),
    [sceneIdByToken, dragSceneId]
  );

  // ---- Drag handlers ----
  const handleSceneDragStart = useCallback(
    (e: React.DragEvent, sceneId: SceneId): void => {
      dragSceneIdRef.current = sceneId;
      dragSceneIdsRef.current = [sceneId];
      setDragSceneId(sceneId);
      setDropHint(null);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(DRAG_SCENE_MIME, String(sceneId));
      e.dataTransfer.setData(DRAG_SCENES_MIME, JSON.stringify([sceneId]));
      e.dataTransfer.setData('text/plain', String(sceneId));
    },
    [DRAG_SCENE_MIME, DRAG_SCENES_MIME]
  );

  const handleSceneDragEnd = useCallback((): void => {
    dragSceneIdRef.current = null;
    dragSceneIdsRef.current = [];
    setDragSceneId(null);
    setDropHint(null);
    setChapterDropTargetId(null);
  }, []);

  const handleSceneDragOver = useCallback(
    (e: React.DragEvent, sceneId: SceneId): void => {
      // For cross-pane drags, check MIME types first to allow the drop.
      if (!hasSceneDragMimeTypes(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Intra-pane: use refs for precise hint.
      const sourceId = dragSceneIdRef.current ?? dragSceneId;
      if (!sourceId || sourceId === sceneId) {
        // Cross-pane: show generic hint.
        setDropHint((prev: { id: SceneId; placeBefore: boolean } | null) =>
          prev && prev.id === sceneId ? prev : { id: sceneId, placeBefore: true }
        );
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const placeBefore = e.clientY < rect.top + rect.height / 2;
      setDropHint((prev: { id: SceneId; placeBefore: boolean } | null) => {
        if (prev && prev.id === sceneId && prev.placeBefore === placeBefore)
          return prev;
        return { id: sceneId, placeBefore };
      });
    },
    [dragSceneId]
  );

  const handleSceneDragLeave = useCallback(
    (e: React.DragEvent, sceneId: SceneId): void => {
      const relatedTarget = e.relatedTarget;
      if (relatedTarget instanceof Node && e.currentTarget.contains(relatedTarget)) {
        return;
      }
      setDropHint((current: { id: SceneId; placeBefore: boolean } | null) =>
        current && current.id === sceneId ? null : current
      );
    },
    []
  );

  const handleSceneDrop = useCallback(
    (e: React.DragEvent, targetSceneId: SceneId): void => {
      e.preventDefault();
      const draggedIds = resolveDraggedSceneIds(e.dataTransfer);
      const sourceSceneId = draggedIds.length > 0 ? draggedIds[0] : null;
      if (!sourceSceneId || sourceSceneId === targetSceneId) return;

      const hintedPlaceBefore =
        dropHint && dropHint.id === targetSceneId ? dropHint.placeBefore : null;
      const rect = e.currentTarget.getBoundingClientRect();
      const placeBefore = hintedPlaceBefore ?? e.clientY < rect.top + rect.height / 2;

      // Optimistic reorder
      const currentIds = displaySceneOrder;
      const newOrder = reorderIdsByPlacement(
        currentIds,
        sourceSceneId,
        targetSceneId,
        placeBefore
      );
      setOptimisticOrderIds(newOrder);

      // Broadcast so the main view syncs immediately.
      dispatchOptimisticReorder(newOrder);

      dragSceneIdRef.current = null;
      dragSceneIdsRef.current = [];
      setDropHint(null);
      setDragSceneId(null);

      if (onReorderScene) {
        onReorderScene(sourceSceneId, targetSceneId, placeBefore);
      } else {
        dispatchReorderProse(sourceSceneId, targetSceneId, placeBefore);
      }
    },
    [displaySceneOrder, dropHint, onReorderScene, resolveDraggedSceneIds]
  );

  const handleChapterDragOver = useCallback(
    (e: React.DragEvent, chapterId: string): void => {
      if (!hasSceneDragMimeTypes(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setChapterDropTargetId(chapterId);
    },
    []
  );

  const handleChapterDrop = useCallback(
    (e: React.DragEvent, chapterId: string): void => {
      e.preventDefault();
      setChapterDropTargetId(null);
      const draggedIds = resolveDraggedSceneIds(e.dataTransfer);
      if (draggedIds.length === 0) return;

      if (onDropScenesOnChapter) {
        onDropScenesOnChapter(draggedIds, chapterId);
      } else {
        dispatchDropChapter(draggedIds, chapterId);
      }
      dragSceneIdRef.current = null;
      dragSceneIdsRef.current = [];
      setDragSceneId(null);
    },
    [onDropScenesOnChapter, resolveDraggedSceneIds]
  );

  // ---- Style helpers ----
  const textMuted = isLight ? 'text-brand-gray-500' : 'text-brand-gray-400';
  const textPrimary = isLight ? 'text-brand-gray-700' : 'text-brand-gray-300';
  const textActive = isLight ? 'text-brand-700' : 'text-brand-300';
  const hoverBg = isLight ? 'hover:bg-brand-gray-100' : 'hover:bg-brand-gray-800/50';
  const activeBg = isLight
    ? 'bg-brand-gray-50 border-brand-400 shadow-sm'
    : 'bg-brand-gray-800/50 border-brand-800 shadow-sm';
  const dropHighlight = isLight
    ? 'ring-2 ring-brand-400/70 bg-brand-50/80'
    : 'ring-2 ring-brand-500/70 bg-brand-900/20';

  const renderSceneRow = (scene: Scene): React.JSX.Element => {
    const isDragging = dragSceneId === scene.id;
    const isSelected = primarySelectedSceneId === scene.id;
    const compact = compactSummary(scene.summary);
    const hint = dropHint && dropHint.id === scene.id;
    const dropTop = hint && dropHint!.placeBefore;
    const dropBottom = hint && !dropHint!.placeBefore;

    const handleClick = (): void => {
      if (onSelectScene) {
        onSelectScene(scene.id);
      } else {
        window.dispatchEvent(
          new CustomEvent('aq-scene-select', { detail: { sceneId: scene.id } })
        );
      }
    };

    const handleDoubleClick = (e: React.MouseEvent): void => {
      e.stopPropagation();
      if (onEditScene) {
        onEditScene(scene.id);
      } else {
        // Open the scene editor via the store so it works regardless of
        // which workspace mode is active.
        useUIStore.getState().setWorkspaceMode('scenes');
        uiStoreActions.openSceneEditorDialog(scene.id);
      }
    };

    return (
      <div
        key={`scene-${scene.id}`}
        role="button"
        tabIndex={0}
        className={`relative group flex items-center px-3 py-0.5 text-xs border-l-2 transition-colors ${hoverBg} ${
          isDragging ? 'opacity-30' : ''
        } ${
          isSelected
            ? isLight
              ? 'border-brand-400 bg-brand-50 text-brand-700'
              : 'border-brand-400 bg-brand-800/30 text-brand-300'
            : 'border-transparent'
        } ${
          dropTop
            ? 'before:absolute before:left-0 before:right-0 before:-top-0.5 before:h-0.5 before:bg-brand-500 before:rounded'
            : ''
        } ${
          dropBottom
            ? 'after:absolute after:left-0 after:right-0 after:-bottom-0.5 after:h-0.5 after:bg-brand-500 after:rounded'
            : ''
        }`}
        draggable
        onDragStart={(e: React.DragEvent): void => handleSceneDragStart(e, scene.id)}
        onDragOver={(e: React.DragEvent): void => handleSceneDragOver(e, scene.id)}
        onDragLeave={(e: React.DragEvent): void => handleSceneDragLeave(e, scene.id)}
        onDrop={(e: React.DragEvent): void => handleSceneDrop(e, scene.id)}
        onDragEnd={handleSceneDragEnd}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={(e: React.KeyboardEvent): void => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <span className={`truncate flex-1 ${textMuted}`} title={scene.summary}>
          {compact || t('Untitled Scene')}
        </span>
      </div>
    );
  };

  const renderChapterNode = (chapter: Chapter): React.JSX.Element => {
    const normalizedId = normalizeChapterId(chapter.id);
    const chapterScenes = normalizedId ? (scenesByChapter.get(normalizedId) ?? []) : [];
    const isExpanded = expandedChapters[chapter.id] ?? true;
    const isCurrent = currentChapterId === chapter.id;

    return (
      <div key={`ch-${chapter.id}`} className="flex flex-col">
        <div
          role="button"
          tabIndex={0}
          className={`flex items-center gap-1 px-2 py-0.5 cursor-pointer text-xs font-medium transition-colors ${hoverBg} ${
            isCurrent ? activeBg : ''
          } ${chapterDropTargetId === chapter.id ? dropHighlight : ''}`}
          onClick={(): void => onSelectChapter(chapter.id)}
          onKeyDown={(e: React.KeyboardEvent): void => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectChapter(chapter.id);
            }
          }}
          onDragOver={(e: React.DragEvent): void =>
            handleChapterDragOver(e, chapter.id)
          }
          onDragLeave={(): void =>
            setChapterDropTargetId((cur: string | null) =>
              cur === chapter.id ? null : cur
            )
          }
          onDrop={(e: React.DragEvent): void => handleChapterDrop(e, chapter.id)}
        >
          <button
            type="button"
            className="p-0.5 shrink-0"
            onClick={(e: React.MouseEvent): void => {
              e.stopPropagation();
              toggleChapter(chapter.id);
            }}
            aria-label={t('Toggle book {{title}}', {
              title: chapter.title || t('Untitled Chapter'),
            })}
          >
            {isExpanded ? (
              <ChevronDown size={12} className={textMuted} />
            ) : (
              <ChevronRight size={12} className={textMuted} />
            )}
          </button>
          <span className={`truncate flex-1 ${isCurrent ? textActive : textPrimary}`}>
            {chapter.title || t('Untitled Chapter')}
          </span>
          <span className={`text-[10px] ${textMuted} shrink-0`}>
            {chapterScenes.length}
          </span>
        </div>
        {isExpanded && chapterScenes.length > 0 && (
          <div className="ml-4 border-l border-brand-gray-700/20">
            {chapterScenes.map(renderSceneRow)}
          </div>
        )}
      </div>
    );
  };

  // ---- Render ----
  if (projectType === 'series') {
    return (
      <div className="flex-1 overflow-y-auto p-1 space-y-1">
        {books.map((book: Book) => {
          const bookChapters = chapters.filter(
            (c: Chapter): boolean => c.book_id === book.id
          );
          const isExpanded = expandedBooks[book.id] ?? true;

          return (
            <div key={`book-${book.id}`} className="flex flex-col">
              <button
                type="button"
                className={`flex items-center gap-1 px-2 py-0.5 text-xs font-bold cursor-pointer ${hoverBg} ${textPrimary}`}
                onClick={(): void => toggleBook(book.id)}
              >
                {isExpanded ? (
                  <ChevronDown size={12} className={textMuted} />
                ) : (
                  <ChevronRight size={12} className={textMuted} />
                )}
                <span className="truncate flex-1">{book.title}</span>
                <span className={`text-[10px] ${textMuted}`}>
                  {bookChapters.length}
                </span>
              </button>
              {isExpanded && (
                <div className="ml-3 border-l border-brand-gray-700/20">
                  {bookChapters.map(renderChapterNode)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Novel: flat chapter list with scene trees
  return (
    <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
      {chapters.map(renderChapterNode)}
    </div>
  );
};
