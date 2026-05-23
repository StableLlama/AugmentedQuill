// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Container for the Scenes workspace panel.
 * Handles API calls, store updates, and renders the toolbar + active view.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { EditorView } from '@codemirror/view';
import type { EditorHandle } from '../editor/Editor';
import type { Scene, SceneProseLink, StoryState, SceneId } from '../../types';
import type { EditorSettings } from '../../types/ui';
import type { WritingUnit } from '../../types/domain';
import { useScenes } from '../../stores/storyStore';
import { useStoryStore } from '../../stores/storyStore';
import type { StoryStoreState } from '../../stores/storyStore';
import {
  useStoryMeta,
  useStoryChaptersListMeta,
  useStoryBooks,
} from '../../stores/storyStore';
import { api } from '../../services/api';
import { notifyError } from '../../services/errorNotifier';
import { useThemeClasses, useTheme } from '../layout/ThemeContext';
import { PinboardView } from './PinboardView';
import { NarrativeView } from './NarrativeView';
import { ConvergenceMapView } from './ConvergenceMapView';
import { SceneEditorDialog } from './SceneEditorDialog';
import type {
  SceneBoundaryAssignment,
  SceneUpdatePayload,
} from '../../services/apiClients/scenes';
import type { ProseDropData } from './types';
import { useSceneProseSync } from './useSceneProseSync';
import { buildChapterOrderMap, proseSort, normalizeChapterId } from './sceneSortUtils';
import { uiStoreActions, useUIStore } from '../../stores/uiStore';
import type { UIStoreState } from '../../stores/uiStore';

type ViewMode = 'pinboard' | 'narrative' | 'chronological' | 'convergence-map';

interface ScenesPanelContainerProps {
  editorRef?: React.RefObject<EditorHandle | null>;
  currentChapter?: WritingUnit | null;
  editorSettings: EditorSettings;
  recordHistoryEntry?: (params: {
    label: string;
    state?: StoryState;
    onUndo?: () => Promise<void> | void;
    onRedo?: () => Promise<void> | void;
    forceNewHistory?: boolean;
  }) => void;
}

type BoundaryAdjustment = {
  id: SceneId;
  link: SceneProseLink;
  newStart: number;
  newEnd: number;
};

type NarrativeOrderUpdate = {
  id: SceneId;
  order_index: number;
};

function collectBoundaryAdjustments(
  scenes: Scene[],
  sceneId: SceneId,
  link: SceneProseLink,
  edge: 'start' | 'end',
  startOffset: number,
  endOffset: number
): BoundaryAdjustment[] {
  const toAdjust: BoundaryAdjustment[] = [];
  for (const other of scenes) {
    if (other.id === sceneId || !other.prose_link) continue;
    const ol = other.prose_link;
    if (ol.scope_type !== link.scope_type) continue;
    if (link.scope_type === 'chapter' && ol.chapter_id !== link.chapter_id) continue;

    const otherStart = Number(ol.start_offset ?? 0);
    const otherEnd = Number(ol.end_offset ?? otherStart);
    if (otherEnd <= startOffset || otherStart >= endOffset) continue;

    const newOtherStart = edge === 'end' ? endOffset : otherStart;
    const newOtherEnd = edge === 'start' ? startOffset : otherEnd;
    if (newOtherStart < newOtherEnd) {
      toAdjust.push({
        id: other.id,
        link: ol,
        newStart: newOtherStart,
        newEnd: newOtherEnd,
      });
    }
  }
  return toAdjust;
}

function applyScenePatch(
  prevScenes: Scene[],
  scene: Scene | null,
  sceneId?: SceneId
): Scene[] {
  if (scene === null) {
    return prevScenes.filter((candidate: Scene): boolean => candidate.id !== sceneId);
  }

  const idx = prevScenes.findIndex(
    (candidate: Scene): boolean => candidate.id === scene.id
  );
  if (idx >= 0) {
    const next = [...prevScenes];
    next[idx] = scene;
    return next;
  }
  return [...prevScenes, scene];
}

function applyScenePatches(prevScenes: Scene[], updates: Scene[]): Scene[] {
  return updates.reduce(
    (nextScenes: Scene[], nextScene: Scene): Scene[] =>
      applyScenePatch(nextScenes, nextScene),
    prevScenes
  );
}

function _getNarrativeOrderIndex(scene: Scene): number {
  return Number.isFinite(scene.order_index) ? (scene.order_index as number) : scene.id;
}

function reorderByPlacement<T>(
  items: T[],
  sourceIndex: number,
  targetIndex: number,
  placeBefore: boolean
): T[] {
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  let insertIndex = targetIndex + (placeBefore ? 0 : 1);
  if (sourceIndex < insertIndex) insertIndex -= 1;
  next.splice(insertIndex, 0, moved);
  return next;
}

// eslint-disable-next-line max-lines-per-function
export const ScenesPanelContainer: React.FC<ScenesPanelContainerProps> = ({
  editorRef,
  currentChapter,
  editorSettings,
  recordHistoryEntry,
}: ScenesPanelContainerProps) => {
  const { t } = useTranslation();
  const tc = useThemeClasses();
  const { isLight } = useTheme();
  const setIsSidebarOpen = useUIStore(
    (s: UIStoreState): UIStoreState['setIsSidebarOpen'] => s.setIsSidebarOpen
  );
  const sceneEditorDialog = useUIStore(
    (s: UIStoreState): UIStoreState['sceneEditorDialog'] => s.sceneEditorDialog
  );
  const sceneLaneState = useUIStore(
    (s: UIStoreState): UIStoreState['sceneLaneState'] => s.sceneLaneState
  );
  const setSceneLaneState = useUIStore(
    (s: UIStoreState): UIStoreState['setSceneLaneState'] => s.setSceneLaneState
  );
  const scenes = useScenes();
  const story = useStoryStore((s: StoryStoreState) => s.story);
  const patchScene = useStoryStore((s: StoryStoreState) => s.patchScene);
  const { projectType } = useStoryMeta();
  const chapters = useStoryChaptersListMeta();
  const books = useStoryBooks();

  const [viewMode, setViewMode] = useState<ViewMode>('pinboard');
  const [editingSceneId, setEditingSceneId] = useState<SceneId | null>(null);
  const lastHandledSceneIntentVersionRef = React.useRef(0);

  const storyRef = React.useRef(story);
  storyRef.current = story;

  const recordSceneHistory = useCallback(
    (label: string, nextScenes: Scene[]): void => {
      if (!recordHistoryEntry) {
        return;
      }
      recordHistoryEntry({
        label,
        state: { ...storyRef.current, scenes: nextScenes },
        forceNewHistory: true,
      });
    },
    [recordHistoryEntry]
  );

  // ---- Scene selection + bidirectional prose-link sync ----
  const { selectedSceneId, handleSelectScene, handleMultipleSelectScenes } =
    useSceneProseSync(scenes, currentChapter, editorRef);

  const dialogOpenedViaTrigger =
    sceneEditorDialog.openedViaTrigger && sceneEditorDialog.isOpen;
  const editingScene = editingSceneId
    ? (scenes.find((s: Scene) => s.id === editingSceneId) ?? null)
    : null;

  useEffect((): void => {
    if (!sceneEditorDialog.isOpen || !sceneEditorDialog.sceneId) {
      return;
    }
    if (sceneEditorDialog.version === lastHandledSceneIntentVersionRef.current) {
      return;
    }
    lastHandledSceneIntentVersionRef.current = sceneEditorDialog.version;
    setEditingSceneId(sceneEditorDialog.sceneId);
    handleSelectScene(sceneEditorDialog.sceneId);
  }, [
    sceneEditorDialog.isOpen,
    sceneEditorDialog.sceneId,
    sceneEditorDialog.version,
    handleSelectScene,
  ]);

  // ---- Create ----
  const handleAddScene = useCallback(async (): Promise<void> => {
    try {
      const created = await api.scenes.create({
        summary: '',
        pinboard_x: 40 + Math.random() * 200,
        pinboard_y: 40 + Math.random() * 200,
      });
      patchScene(created as Scene);
      recordSceneHistory('Add scene', applyScenePatch(scenes, created as Scene));
      setEditingSceneId(created.id);
    } catch (err) {
      notifyError(t('Add Scene'), err);
    }
  }, [patchScene, recordSceneHistory, scenes, t]);

  // ---- Create scene from prose drop on the Add Scene button ----
  const handleAddSceneDragOver = useCallback((e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes('application/aq-prose-selection')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
    }
  }, []);

  const handleAddSceneDrop = useCallback(
    async (e: React.DragEvent): Promise<void> => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/aq-prose-selection');
      if (!raw) return;
      let data: ProseDropData;
      try {
        data = JSON.parse(raw) as ProseDropData;
      } catch {
        return;
      }
      try {
        const created = await api.scenes.create({
          summary: '',
          pinboard_x: 40 + Math.random() * 200,
          pinboard_y: 40 + Math.random() * 200,
        });
        patchScene(created as Scene);
        const modified = await api.scenes.linkProse(created.id, {
          scope_type: data.scopeType,
          chapter_id: data.chapterId ?? null,
          book_id: data.bookId ?? null,
          start_offset: data.startOffset,
          end_offset: data.endOffset,
        });
        modified.forEach((s: Scene) => patchScene(s));
        const scenesAfterCreate = applyScenePatch(scenes, created as Scene);
        recordSceneHistory(
          'Add scene from prose',
          applyScenePatches(scenesAfterCreate, modified as Scene[])
        );
        setEditingSceneId(created.id);
      } catch (err) {
        notifyError(t('Add Scene'), err);
      }
    },
    [patchScene, recordSceneHistory, scenes, t]
  );

  // ---- Move (position update from drag) ----
  const handleMoveScene = useCallback(
    async (sceneId: SceneId, x: number, y: number): Promise<void> => {
      // Optimistic store update
      const prev = scenes.find((s: Scene) => s.id === sceneId);
      if (!prev) return;
      patchScene({ ...prev, pinboard_x: x, pinboard_y: y });
      try {
        const updated = await api.scenes.update(sceneId, {
          pinboard_x: x,
          pinboard_y: y,
        });
        patchScene(updated as Scene);
        recordSceneHistory('Move scene', applyScenePatch(scenes, updated as Scene));
      } catch (err) {
        // Revert on failure
        patchScene(prev);
        notifyError(t('Save'), err);
      }
    },
    [scenes, patchScene, recordSceneHistory, t]
  );

  // ---- Save from editor ----
  const handleSaveScene = useCallback(
    async (updates: Partial<Omit<Scene, 'id'>>): Promise<void> => {
      if (!editingSceneId) return;
      const updated = await api.scenes.update(
        editingSceneId,
        updates as SceneUpdatePayload
      );
      patchScene(updated as Scene);
      recordSceneHistory('Update scene', applyScenePatch(scenes, updated as Scene));
    },
    [editingSceneId, patchScene, recordSceneHistory, scenes]
  );

  const handleAssignSceneTimeline = useCallback(
    async (sceneId: SceneId, timelineId: string): Promise<void> => {
      try {
        const updated = await api.scenes.update(sceneId, {
          timeline_id: timelineId,
        } as SceneUpdatePayload);
        patchScene(updated as Scene);
        recordSceneHistory('Update scene', applyScenePatch(scenes, updated as Scene));
      } catch (err) {
        notifyError(t('Update scene'), err);
        throw err;
      }
    },
    [patchScene, recordSceneHistory, scenes, t]
  );

  // ---- Delete from editor ----
  const handleDeleteScene = useCallback(async (): Promise<void> => {
    if (!editingSceneId) return;
    await api.scenes.delete(editingSceneId);
    patchScene(null, editingSceneId);
    recordSceneHistory('Delete scene', applyScenePatch(scenes, null, editingSceneId));
    setEditingSceneId(null);
  }, [editingSceneId, patchScene, recordSceneHistory, scenes]);

  // ---- Delete cause ----
  const handleDeleteCause = useCallback(
    async (fromId: SceneId, toId: SceneId): Promise<void> => {
      const fromScene = scenes.find((s: Scene) => s.id === fromId);
      if (!fromScene) return;

      const newCauses = (fromScene.causes ?? []).filter((id: SceneId) => id !== toId);

      // Optimistic update
      patchScene({ ...fromScene, causes: newCauses });

      try {
        const updatedFrom = await api.scenes.update(fromId, {
          causes: newCauses,
        } as SceneUpdatePayload);
        patchScene(updatedFrom as Scene);
        recordSceneHistory(
          'Remove scene dependency',
          applyScenePatch(scenes, updatedFrom as Scene)
        );
      } catch (err) {
        // Revert
        patchScene(fromScene);
        notifyError(t('Save'), err);
      }
    },
    [scenes, patchScene, recordSceneHistory, t]
  );

  // ---- Create cause (Alt+drag on pinboard) ----
  const handleCreateCause = useCallback(
    async (fromId: SceneId, toId: SceneId): Promise<void> => {
      const fromScene = scenes.find((s: Scene) => s.id === fromId);
      if (!fromScene) return;
      if ((fromScene.causes ?? []).includes(toId)) return; // already set

      const newCauses = [...(fromScene.causes ?? []), toId];

      // Optimistic update
      patchScene({ ...fromScene, causes: newCauses });

      try {
        const updatedFrom = await api.scenes.update(fromId, {
          causes: newCauses,
        } as SceneUpdatePayload);
        patchScene(updatedFrom as Scene);
        recordSceneHistory(
          'Add scene dependency',
          applyScenePatch(scenes, updatedFrom as Scene)
        );
      } catch (err) {
        // Revert
        patchScene(fromScene);
        notifyError(t('Save'), err);
      }
    },
    [scenes, patchScene, recordSceneHistory, t]
  );

  // ---- Prose drop (drag from editor to scene card) ----
  const handleDropProse = useCallback(
    async (sceneId: SceneId, data: ProseDropData): Promise<void> => {
      try {
        const modified = await api.scenes.linkProse(sceneId, {
          scope_type: data.scopeType,
          chapter_id: data.chapterId ?? null,
          book_id: data.bookId ?? null,
          start_offset: data.startOffset,
          end_offset: data.endOffset,
        });
        modified.forEach((s: Scene) => patchScene(s));
        recordSceneHistory('Link scene prose', applyScenePatches(scenes, modified));
      } catch (err) {
        notifyError(t('Link Prose'), err);
      }
    },
    [patchScene, recordSceneHistory, scenes, t]
  );

  // ---- Narrative reorder (drag in list + move linked prose text) ----
  const handleUnlinkedNarrativeReorder = useCallback(
    async (
      sourceSceneId: SceneId,
      targetSceneId: SceneId,
      placeBefore: boolean
    ): Promise<void> => {
      const chapterOrderMap = buildChapterOrderMap(projectType, chapters, books ?? []);
      const sortedScenes = [...scenes].sort((a: Scene, b: Scene) =>
        proseSort(a, b, chapterOrderMap)
      );

      const sourceScene = scenes.find((s: Scene) => s.id === sourceSceneId);
      const targetScene = scenes.find((s: Scene) => s.id === targetSceneId);
      if (!sourceScene || !targetScene) return;

      // Find positions in the globally sorted list (both linked and unlinked).
      const sourcePos = sortedScenes.findIndex((s: Scene) => s.id === sourceSceneId);
      const targetPos = sortedScenes.findIndex((s: Scene) => s.id === targetSceneId);
      if (sourcePos < 0 || targetPos < 0) return;

      // Reorder in the global sorted list
      const reordered = reorderByPlacement(
        sortedScenes,
        sourcePos,
        targetPos,
        placeBefore
      );

      // Compute new order_index for the moved scene, preserving interleaving between linked scenes.
      const newPos = reordered.findIndex((s: Scene) => s.id === sourceSceneId);
      if (newPos < 0) return;

      let newOrderIndex: number | null = null;

      if (newPos === 0) {
        // Moved to start – place before the first scene's order_index (or at 0.0 if it's also unlinked).
        const firstScene = reordered[0];
        if (firstScene.prose_link) {
          newOrderIndex = (firstScene.order_index ?? Infinity) - 1.0;
        } else {
          newOrderIndex = 0.0;
        }
      } else if (newPos === reordered.length - 1) {
        // Moved to end – place after the last scene's order_index (or Infinity if no linked scenes).
        const lastScene = reordered[reordered.length - 1];
        newOrderIndex = (lastScene.order_index ?? Infinity) + 1.0;
      } else {
        // Between two scenes – use midpoint of their order_indices.
        const prevScene = reordered[newPos - 1];
        const nextScene = reordered[newPos + 1];
        const prevOrder = prevScene.order_index ?? Infinity;
        const nextOrder = nextScene.order_index ?? Infinity;
        newOrderIndex = (prevOrder + nextOrder) / 2.0;
      }

      if (newOrderIndex === null) return;

      const updates = [{ id: sourceSceneId, order_index: newOrderIndex }];

      const previousById = new Map<SceneId, Scene>(
        scenes.map((scene: Scene): [SceneId, Scene] => [scene.id, scene])
      );
      updates.forEach((update: NarrativeOrderUpdate): void => {
        const prev = previousById.get(update.id);
        if (!prev) return;
        patchScene({ ...prev, order_index: update.order_index });
      });

      try {
        const persisted = await Promise.all(
          updates.map((update: NarrativeOrderUpdate) =>
            api.scenes.update(update.id, {
              order_index: update.order_index,
            } as SceneUpdatePayload)
          )
        );
        persisted.forEach((scene: Scene): void => {
          patchScene(scene);
        });
        recordSceneHistory(
          'Reorder scene narrative',
          applyScenePatches(scenes, persisted)
        );
      } catch (err) {
        updates.forEach((update: NarrativeOrderUpdate): void => {
          const prev = previousById.get(update.id);
          if (prev) patchScene(prev);
        });
        notifyError(t('Save'), err);
      }
    },
    [books, chapters, patchScene, projectType, recordSceneHistory, scenes, t]
  );

  const handleLinkedProseNarrativeReorder = useCallback(
    async (
      sourceSceneId: SceneId,
      targetSceneId: SceneId,
      placeBefore: boolean
    ): Promise<void> => {
      try {
        const reorderResult = await api.scenes.reorderProse({
          source_scene_id: sourceSceneId,
          target_scene_id: targetSceneId,
          place_before: placeBefore,
        });
        reorderResult.scenes.forEach((scene: Scene) => patchScene(scene));
        recordSceneHistory(
          'Reorder scene prose',
          applyScenePatches(scenes, reorderResult.scenes)
        );

        if (reorderResult.scenes.length === 0) return;

        const view: EditorView | null = editorRef?.current?.getEditorView() ?? null;
        if (!view || !currentChapter) return;

        const scopeMatchesCurrentChapter =
          reorderResult.scope_type === 'story'
            ? currentChapter.scope === 'story'
            : reorderResult.scope_type === 'chapter' &&
              reorderResult.chapter_id === currentChapter.id;

        if (!scopeMatchesCurrentChapter) return;

        view.dispatch({
          changes: {
            from: reorderResult.scope_start,
            to: reorderResult.scope_end,
            insert: reorderResult.rebuilt_text,
          },
        });
      } catch (err) {
        notifyError(t('Save'), err);
      }
    },
    [currentChapter, editorRef, patchScene, recordSceneHistory, scenes, t]
  );

  const handleNarrativeReorder = useCallback(
    async (
      sourceSceneId: SceneId,
      targetSceneId: SceneId,
      placeBefore: boolean
    ): Promise<void> => {
      if (sourceSceneId === targetSceneId) return;

      const sourceScene = scenes.find((s: Scene) => s.id === sourceSceneId);
      const targetScene = scenes.find((s: Scene) => s.id === targetSceneId);
      if (!sourceScene || !targetScene) return;

      if (!sourceScene.prose_link) {
        await handleUnlinkedNarrativeReorder(sourceSceneId, targetSceneId, placeBefore);
        return;
      }

      if (!targetScene.prose_link) return;
      await handleLinkedProseNarrativeReorder(
        sourceSceneId,
        targetSceneId,
        placeBefore
      );
    },
    [handleLinkedProseNarrativeReorder, handleUnlinkedNarrativeReorder, scenes]
  );

  /* eslint-disable complexity */
  const handleDropScenesOnChapter = useCallback(
    async (sourceSceneIds: SceneId[], chapterId: string): Promise<void> => {
      const targetChapterId = normalizeChapterId(chapterId);
      if (!targetChapterId || sourceSceneIds.length === 0) return;

      const targetChapter = chapters.find(
        (chapter: Chapter): boolean =>
          normalizeChapterId(chapter.id) === targetChapterId
      );
      if (!targetChapter) return;
      if (projectType === 'short-story') return;
      if (projectType !== 'series' && targetChapter.book_id) return;
      if (projectType === 'series' && targetChapter.book_id) {
        const chapterBookId = String(targetChapter.book_id).trim();
        if (
          chapterBookId.length > 0 &&
          !(books ?? []).some(
            (book: Book): boolean => String(book.id).trim() === chapterBookId
          )
        ) {
          return;
        }
      }

      const chapterOrderMap = buildChapterOrderMap(projectType, chapters, books ?? []);
      const sortedScenes = [...scenes].sort((a: Scene, b: Scene) =>
        proseSort(a, b, chapterOrderMap)
      );

      const orderedSourceIds = sortedScenes
        .map((scene: Scene): SceneId => scene.id)
        .filter((id: SceneId): boolean => sourceSceneIds.includes(id));
      const newlyLinkedSourceIds = new Set<SceneId>();

      let workingScenes = scenes;

      const unlinkedSourceIds = orderedSourceIds.filter((id: SceneId): boolean => {
        const source = scenes.find((scene: Scene): boolean => scene.id === id);
        return !source?.prose_link;
      });

      const linkUnlinkedScenesToTargetChapter = async (): Promise<boolean> => {
        if (unlinkedSourceIds.length === 0) return false;

        let chapterContentLength = Math.max(0, (targetChapter?.content ?? '').length);
        if (chapterContentLength === 0) {
          const numericChapterId = Number(targetChapterId);
          if (Number.isInteger(numericChapterId)) {
            try {
              const chapterDetail = await api.chapters.get(numericChapterId);
              chapterContentLength = Math.max(
                chapterContentLength,
                chapterDetail.content?.length ?? 0
              );
            } catch {
              // Fall back to link-derived placement when chapter detail is unavailable.
            }
          }
        }
        const targetBookId = targetChapter?.book_id ?? null;
        const previousScenesById = new Map<SceneId, Scene>();

        let nextScenes = workingScenes;
        try {
          const linkedTargetTailOffset = nextScenes
            .filter((scene: Scene): boolean => {
              const link = scene.prose_link;
              return (
                link?.scope_type === 'chapter' &&
                normalizeChapterId(link.chapter_id) === targetChapterId
              );
            })
            .reduce((maxOffset: number, scene: Scene): number => {
              const link = scene.prose_link;
              if (!link) return maxOffset;
              const startOffset = Number(link.start_offset ?? 0);
              const endOffset = Number(
                link.end_offset ?? (Number.isFinite(startOffset) ? startOffset + 1 : 1)
              );
              return Math.max(maxOffset, startOffset + 1, endOffset);
            }, 0);
          const insertionBaseEnd = Math.max(
            1,
            chapterContentLength,
            linkedTargetTailOffset
          );

          for (const [index, sourceId] of unlinkedSourceIds.entries()) {
            const chapterLinkEnd = insertionBaseEnd + index;
            const chapterLinkStart = chapterLinkEnd - 1;

            const sourceScene = nextScenes.find(
              (scene: Scene): boolean => scene.id === sourceId
            );
            if (sourceScene) {
              previousScenesById.set(sourceId, sourceScene);
              const optimisticScene: Scene = {
                ...sourceScene,
                prose_link: {
                  scope_type: 'chapter',
                  chapter_id: targetChapterId,
                  book_id: targetBookId,
                  start_offset: chapterLinkStart,
                  end_offset: chapterLinkEnd,
                },
              };
              patchScene(optimisticScene);
              nextScenes = applyScenePatch(nextScenes, optimisticScene);
            }

            const modified = await api.scenes.linkProse(sourceId, {
              scope_type: 'chapter',
              chapter_id: targetChapterId,
              book_id: targetBookId,
              start_offset: chapterLinkStart,
              end_offset: chapterLinkEnd,
            });
            modified.forEach((scene: Scene): void => {
              patchScene(scene);
            });
            if (
              modified.some(
                (scene: Scene): boolean =>
                  scene.id === sourceId &&
                  scene.prose_link?.scope_type === 'chapter' &&
                  normalizeChapterId(scene.prose_link.chapter_id) === targetChapterId
              )
            ) {
              newlyLinkedSourceIds.add(sourceId);
            }
            nextScenes = applyScenePatches(nextScenes, modified);
          }
          recordSceneHistory('Move scene to chapter', nextScenes);
          workingScenes = nextScenes;
        } catch (err) {
          previousScenesById.forEach((previousScene: Scene): void => {
            patchScene(previousScene);
          });
          notifyError(t('Move scene to chapter'), err);
          return false;
        }
        return true;
      };

      await linkUnlinkedScenesToTargetChapter();

      // Refresh scene/link state after any linkProse mutations before reordering.
      const currentScenes = workingScenes;
      const currentSortedScenes = [...currentScenes].sort((a: Scene, b: Scene) =>
        proseSort(a, b, chapterOrderMap)
      );
      const currentDirectChapterBySceneId = new Map<SceneId, string | null>();
      currentSortedScenes.forEach((scene: Scene): void => {
        const link = scene.prose_link;
        const directChapterId =
          link?.scope_type === 'chapter'
            ? normalizeChapterId(link.chapter_id) || null
            : null;
        currentDirectChapterBySceneId.set(scene.id, directChapterId);
      });

      const currentDirectChapterSceneIds = currentSortedScenes
        .filter(
          (scene: Scene): boolean =>
            currentDirectChapterBySceneId.get(scene.id) === targetChapterId
        )
        .map((scene: Scene): SceneId => scene.id);
      if (currentDirectChapterSceneIds.length === 0) return;

      const firstChapterSceneId = currentDirectChapterSceneIds[0];
      const lastChapterSceneId =
        currentDirectChapterSceneIds[currentDirectChapterSceneIds.length - 1];
      const firstChapterIndex = currentSortedScenes.findIndex(
        (scene: Scene): boolean => scene.id === firstChapterSceneId
      );
      const lastChapterIndex = currentSortedScenes.findIndex(
        (scene: Scene): boolean => scene.id === lastChapterSceneId
      );
      if (firstChapterIndex < 0 || lastChapterIndex < 0) return;

      const candidateIds = orderedSourceIds.filter((id: SceneId): boolean => {
        if (newlyLinkedSourceIds.has(id)) return true;
        const source = currentScenes.find((scene: Scene): boolean => scene.id === id);
        if (!source?.prose_link) return false;
        return currentDirectChapterBySceneId.get(id) !== targetChapterId;
      });
      if (candidateIds.length === 0) return;

      const orderedCandidates = currentSortedScenes
        .map((scene: Scene): SceneId => scene.id)
        .filter((id: SceneId): boolean => candidateIds.includes(id));

      const beforeChapterIds = orderedCandidates.filter((id: SceneId): boolean => {
        const sourceIndex = currentSortedScenes.findIndex(
          (scene: Scene): boolean => scene.id === id
        );
        return sourceIndex >= 0 && sourceIndex < firstChapterIndex;
      });

      const afterChapterIds = orderedCandidates.filter((id: SceneId): boolean => {
        const sourceIndex = currentSortedScenes.findIndex(
          (scene: Scene): boolean => scene.id === id
        );
        return sourceIndex >= firstChapterIndex;
      });

      for (const sourceId of beforeChapterIds) {
        if (sourceId === firstChapterSceneId) continue;
        const sourceScene = workingScenes.find(
          (scene: Scene): boolean => scene.id === sourceId
        );
        const targetScene = workingScenes.find(
          (scene: Scene): boolean => scene.id === firstChapterSceneId
        );
        if (!sourceScene?.prose_link || !targetScene?.prose_link) continue;
        await handleLinkedProseNarrativeReorder(sourceId, firstChapterSceneId, true);
      }

      for (const sourceId of [...afterChapterIds].reverse()) {
        if (sourceId === lastChapterSceneId) continue;
        const sourceScene = workingScenes.find(
          (scene: Scene): boolean => scene.id === sourceId
        );
        const targetScene = workingScenes.find(
          (scene: Scene): boolean => scene.id === lastChapterSceneId
        );
        if (!sourceScene?.prose_link || !targetScene?.prose_link) continue;
        await handleLinkedProseNarrativeReorder(sourceId, lastChapterSceneId, false);
      }
    },
    [
      books,
      chapters,
      handleLinkedProseNarrativeReorder,
      patchScene,
      projectType,
      recordSceneHistory,
      scenes,
      t,
    ]
  );
  /* eslint-enable complexity */

  useEffect((): (() => void) => {
    const handleExternalChapterDrop = (event: Event): void => {
      const custom = event as CustomEvent<{
        sourceSceneIds?: SceneId[];
        chapterId?: string;
      }>;
      const sourceSceneIds = custom.detail?.sourceSceneIds;
      const chapterId = custom.detail?.chapterId;
      if (!Array.isArray(sourceSceneIds) || typeof chapterId !== 'string') {
        return;
      }
      void handleDropScenesOnChapter(sourceSceneIds, chapterId);
    };

    window.addEventListener(
      'aq-scene-drop-chapter',
      handleExternalChapterDrop as EventListener
    );
    return (): void => {
      window.removeEventListener(
        'aq-scene-drop-chapter',
        handleExternalChapterDrop as EventListener
      );
    };
  }, [handleDropScenesOnChapter]);

  // ---- Prose-link boundary drag (update start/end offset) ----
  const handleProseBoundaryChange = useCallback(
    async (sceneId: SceneId, edge: 'start' | 'end', offset: number): Promise<void> => {
      const scene = scenes.find((s: Scene): boolean => s.id === sceneId);
      if (!scene?.prose_link) return;
      const link = scene.prose_link;
      const currentStart = Number(link.start_offset ?? 0);
      const currentEnd = Number(link.end_offset ?? currentStart);
      const startOffset = edge === 'start' ? offset : currentStart;
      const endOffset = edge === 'end' ? offset : currentEnd;

      // If the drag would trim the scene to zero-size, unlink it instead
      if (startOffset >= endOffset) {
        try {
          const updated = await api.scenes.unlinkProse(sceneId);
          updated.forEach((s: Scene) => patchScene(s));
          recordSceneHistory(
            'Unlink prose (boundary drag)',
            applyScenePatches(scenes, updated)
          );
        } catch (err) {
          notifyError(t('Unlink prose'), err);
        }
        return;
      }

      const toAdjust = collectBoundaryAdjustments(
        scenes,
        sceneId,
        link,
        edge,
        startOffset,
        endOffset
      );

      try {
        let nextScenes = scenes;
        // Adjust neighbours first so the backend does not see transient overlaps.
        for (const adj of toAdjust) {
          const modified = await api.scenes.linkProse(adj.id, {
            scope_type: adj.link.scope_type,
            chapter_id: adj.link.chapter_id ?? null,
            book_id: adj.link.book_id ?? null,
            start_offset: adj.newStart,
            end_offset: adj.newEnd,
          });
          modified.forEach((s: Scene) => patchScene(s));
          nextScenes = applyScenePatches(nextScenes, modified);
        }
        const modified = await api.scenes.linkProse(sceneId, {
          scope_type: link.scope_type,
          chapter_id: link.chapter_id ?? null,
          book_id: link.book_id ?? null,
          start_offset: startOffset,
          end_offset: endOffset,
        });
        modified.forEach((s: Scene) => patchScene(s));
        nextScenes = applyScenePatches(nextScenes, modified);
        recordSceneHistory('Adjust scene prose boundary', nextScenes);
      } catch (err) {
        notifyError(t('Update prose link'), err);
      }
    },
    [scenes, patchScene, recordSceneHistory, t]
  );

  // Register the boundary-change handler on the editor handle so the callback
  // is always current without re-running the mount effect.
  useEffect((): (() => void) => {
    editorRef?.current?.setOnProseBoundaryChange(handleProseBoundaryChange);
    return (): void => {
      editorRef?.current?.setOnProseBoundaryChange(null);
    };
  }, [editorRef, handleProseBoundaryChange]);

  // ---- Get linked prose text from editor content ----
  const getLinkedProseText = useCallback(
    (link: SceneProseLink): string | null => {
      const view: EditorView | null = editorRef?.current?.getEditorView() ?? null;
      if (!view || !currentChapter) return null;
      const isScopeMatch =
        link.scope_type === 'story'
          ? currentChapter.scope === 'story'
          : link.scope_type === 'chapter' && link.chapter_id === currentChapter.id;
      if (!isScopeMatch) return null;
      const doc = view.state.doc;
      const end = link.end_offset ?? doc.length;
      return doc.sliceString(
        Math.min(Number(link.start_offset ?? 0), doc.length),
        Math.min(end, doc.length)
      );
    },
    [editorRef, currentChapter]
  );

  const handleSaveProseContent = useCallback(
    async (text: string): Promise<void> => {
      if (!editingSceneId) return;
      // Capture the prose link before the API call so we know which range to
      // replace in the editor (the backend may return a different end_offset).
      const proseLink =
        scenes.find((s: Scene) => s.id === editingSceneId)?.prose_link ?? null;
      const updated = await api.scenes.updateProseContent(editingSceneId, text);
      patchScene(updated as Scene);
      recordSceneHistory(
        'Edit scene linked prose',
        applyScenePatch(scenes, updated as Scene)
      );
      // Reflect the change immediately in the editor so the writer sees the
      // updated text without having to close and reopen the chapter.
      if (proseLink && editorRef?.current) {
        const view: EditorView | null = editorRef.current.getEditorView();
        if (view) {
          const docLen = view.state.doc.length;
          const from = Math.min(Number(proseLink.start_offset ?? 0), docLen);
          const to = Math.min(proseLink.end_offset ?? docLen, docLen);
          view.dispatch({ changes: { from, to, insert: text } });
        }
      }
    },
    [editingSceneId, patchScene, recordSceneHistory, scenes, editorRef]
  );

  const handleWriteScene = useCallback(async (): Promise<void> => {
    if (!editingSceneId) return;

    const payload =
      currentChapter?.scope === 'chapter'
        ? {
            scope_type: 'chapter' as const,
            chapter_id: currentChapter.id,
            book_id: currentChapter.book_id ?? null,
            include_following_scenes: 1,
            detect_boundaries: true,
          }
        : {
            scope_type: 'story' as const,
            include_following_scenes: 1,
            detect_boundaries: true,
          };

    const result = await api.scenes.writeScene(editingSceneId, payload);
    // Capture whether the scene was previously unlinked before patching the store,
    // so we can decide whether to include the surrounding scene markers in the
    // editor dispatch below.
    const sceneBeforeWrite = scenes.find((s: Scene) => s.id === editingSceneId);
    const isNewWrite = !sceneBeforeWrite?.prose_link;
    const updates = [result.scene, ...result.scenes];
    updates.forEach((scene: Scene): void => {
      patchScene(scene);
    });
    recordSceneHistory('Write scene prose', applyScenePatches(scenes, updates));

    const editedAssignment = result.assignments.find(
      (assignment: SceneBoundaryAssignment): boolean =>
        assignment.scene_id === editingSceneId
    );
    const view: EditorView | null = editorRef?.current?.getEditorView() ?? null;
    if (!editedAssignment || !view || !currentChapter) return;

    const isScopeMatch =
      payload.scope_type === 'story'
        ? currentChapter.scope === 'story'
        : currentChapter.scope === 'chapter' &&
          currentChapter.id === (payload.chapter_id ?? currentChapter.id);
    if (!isScopeMatch) return;

    const docLen = view.state.doc.length;

    if (isNewWrite) {
      // For a new scene write the backend appended the text and injected the
      // surrounding markers into the file.  The editor must mirror this exactly
      // (including the separator and markers) so the in-editor content stays in
      // sync with the file on disk and the scene highlight offset is correct.
      const currentContent = view.state.doc.toString();
      const separator =
        currentContent.length > 0 && !currentContent.endsWith('\n') ? '\n' : '';
      const startMarker = `<!--scene:${String(editingSceneId)}:start-->`;
      const endMarker = `<!--scene:${String(editingSceneId)}:end-->`;
      view.dispatch({
        changes: {
          from: docLen,
          to: docLen,
          insert: separator + startMarker + result.generated_text + endMarker,
        },
      });
    } else {
      // For an existing linked scene the markers are already in the editor;
      // only the prose text between them needs to be replaced.
      const from = Math.min(Math.max(editedAssignment.start_offset, 0), docLen);
      const to = Math.min(Math.max(editedAssignment.end_offset, from), docLen);
      view.dispatch({ changes: { from, to, insert: result.generated_text } });
    }
  }, [
    currentChapter,
    editingSceneId,
    editorRef,
    patchScene,
    recordSceneHistory,
    scenes,
  ]);

  return (
    <div className="flex flex-col w-full h-full">
      {/* Toolbar */}
      <div
        className={`flex items-center justify-between px-3 py-1.5 border-b ${tc.border} flex-shrink-0`}
      >
        <div
          className={`flex items-center rounded-md p-0.5 border ${
            isLight
              ? 'bg-brand-gray-100 border-brand-gray-200'
              : 'bg-brand-gray-800 border-brand-gray-700'
          }`}
          role="group"
          aria-label={t('View mode')}
        >
          {(['pinboard', 'narrative', 'chronological', 'convergence-map'] as const).map(
            (mode: ViewMode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
                  viewMode === mode
                    ? isLight
                      ? 'bg-white shadow-sm text-brand-gray-900 border border-brand-gray-200'
                      : 'bg-brand-gray-700 text-brand-gray-100 border border-brand-gray-600'
                    : isLight
                      ? 'text-brand-gray-500 hover:text-brand-gray-700'
                      : 'text-brand-gray-400 hover:text-brand-gray-200 hover:bg-brand-gray-700/50'
                }`}
              >
                {t(
                  mode === 'pinboard'
                    ? 'Pinboard'
                    : mode === 'narrative'
                      ? 'Narrative'
                      : mode === 'chronological'
                        ? 'Chronological'
                        : 'Convergence Map'
                )}
              </button>
            )
          )}
        </div>
        <button
          type="button"
          aria-label={t('Add Scene')}
          onClick={handleAddScene}
          onDragOver={handleAddSceneDragOver}
          onDrop={handleAddSceneDrop}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 ${
            isLight
              ? 'bg-brand-600 text-white border-brand-500 hover:bg-brand-700'
              : 'bg-brand-gray-800 text-brand-gray-200 border-brand-gray-700 hover:bg-brand-gray-700'
          }`}
        >
          <Plus size={14} aria-hidden="true" />
          {t('Add Scene')}
        </button>
      </div>

      {/* View area */}
      <div className="flex-1 overflow-hidden relative">
        {viewMode === 'pinboard' && (
          <PinboardView
            scenes={scenes}
            primarySelectedSceneId={selectedSceneId}
            onSelectScene={handleSelectScene}
            onSelectionChange={handleMultipleSelectScenes}
            onMoveScene={handleMoveScene}
            onEditScene={setEditingSceneId}
            onCreateCause={handleCreateCause}
            onDropProse={handleDropProse}
          />
        )}
        {(viewMode === 'narrative' || viewMode === 'chronological') && (
          <NarrativeView
            scenes={scenes}
            sourcebookEntries={story.sourcebook ?? []}
            projectType={projectType}
            chapters={chapters}
            books={books}
            sortMode={viewMode === 'chronological' ? 'chronological' : 'narrative'}
            primarySelectedSceneId={selectedSceneId}
            onSelectScene={handleSelectScene}
            onSelectionChange={handleMultipleSelectScenes}
            onEditScene={setEditingSceneId}
            onDropProse={handleDropProse}
            onReorderScene={
              viewMode === 'narrative' ? handleNarrativeReorder : undefined
            }
            onDropScenesOnChapter={
              viewMode === 'narrative' ? handleDropScenesOnChapter : undefined
            }
            initialVisibleLaneEntryIds={sceneLaneState.visibleLaneEntryIds}
            initialRemovedReferencedLaneIds={sceneLaneState.removedReferencedLaneIds}
            onVisibleLaneEntryIdsChange={(ids: string[]): void =>
              setSceneLaneState((prev: UIStoreState['sceneLaneState']) => ({
                ...prev,
                visibleLaneEntryIds: ids,
              }))
            }
            onRemovedReferencedLaneIdsChange={(ids: string[]): void =>
              setSceneLaneState((prev: UIStoreState['sceneLaneState']) => ({
                ...prev,
                removedReferencedLaneIds: ids,
              }))
            }
          />
        )}
        {viewMode === 'convergence-map' && (
          <ConvergenceMapView
            scenes={scenes}
            sourcebookEntries={story.sourcebook ?? []}
            projectType={projectType}
            chapters={chapters}
            books={books}
            primarySelectedSceneId={selectedSceneId}
            onSelectScene={handleSelectScene}
            onSelectionChange={handleMultipleSelectScenes}
            onEditScene={setEditingSceneId}
            onAssignSceneTimeline={handleAssignSceneTimeline}
            editorSettings={editorSettings}
            initialVisibleLaneEntryIds={sceneLaneState.visibleLaneEntryIds}
            initialRemovedReferencedLaneIds={sceneLaneState.removedReferencedLaneIds}
            onVisibleLaneEntryIdsChange={(ids: string[]): void =>
              setSceneLaneState((prev: UIStoreState['sceneLaneState']) => ({
                ...prev,
                visibleLaneEntryIds: ids,
              }))
            }
            onRemovedReferencedLaneIdsChange={(ids: string[]): void =>
              setSceneLaneState((prev: UIStoreState['sceneLaneState']) => ({
                ...prev,
                removedReferencedLaneIds: ids,
              }))
            }
          />
        )}
      </div>

      {/* Scene editor dialog */}
      {editingScene && (
        <SceneEditorDialog
          scene={editingScene}
          isOpen={true}
          openedViaTrigger={dialogOpenedViaTrigger}
          onClose={() => setEditingSceneId(null)}
          onNavigateScene={(sceneId: SceneId): void => {
            setEditingSceneId(sceneId);
            handleSelectScene(sceneId);
          }}
          onSave={handleSaveScene}
          onDelete={handleDeleteScene}
          onDeleteCause={handleDeleteCause}
          getLinkedProseText={editorRef ? getLinkedProseText : undefined}
          onSaveProseContent={editorRef ? handleSaveProseContent : undefined}
          onWriteScene={(): Promise<void> => handleWriteScene()}
          onUnlinkProse={async (sceneId: SceneId): Promise<void> => {
            try {
              const updated = await api.scenes.unlinkProse(sceneId);
              updated.forEach((s: Scene) => patchScene(s));
              recordSceneHistory('Unlink prose', applyScenePatches(scenes, updated));
            } catch (err) {
              notifyError(t('Unlink prose'), err);
            }
          }}
          onOpenSourcebookEntry={(entryId: string): void => {
            setIsSidebarOpen(true);
            uiStoreActions.openSourcebookDialog(entryId);
          }}
        />
      )}
    </div>
  );
};
