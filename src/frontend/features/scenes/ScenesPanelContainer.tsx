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

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { EditorView } from '@codemirror/view';
import type { EditorHandle } from '../editor/Editor';
import type { Scene, SceneProseLink, StoryState, SceneId } from '../../types';
import type { EditorSettings } from '../../types/ui';
import type { WritingUnit, Chapter, Book } from '../../types/domain';
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
import { uiStoreActions, useUIStore, useScenesViewType } from '../../stores/uiStore';
import type { UIStoreState } from '../../stores/uiStore';
import { externalValueSyncAnnotation } from '../editor/codeMirrorDiffPlugin';
import {
  getSceneMarkerSpanRange,
  hasInlineSceneMarkers,
  sceneMarkerTokenLength,
  stripInlineInternalMarkers,
  toVisibleOffset,
} from '../editor/internalTags';
import {
  getLinkedProseFromTextSource,
  toOriginalOffset,
  toVisibleLinkedOffset,
} from './proseLinkCoordinates';

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
  /** Called when the user selects a scene from a different chapter. */
  onSelectChapter?: (chapterId: string) => void;
}

type BoundaryAdjustment = {
  id: SceneId;
  link: SceneProseLink;
  newStart: number;
  newEnd: number;
};

function collectBoundaryAdjustments(
  scenes: Scene[],
  sceneId: SceneId,
  link: SceneProseLink,
  edge: 'start' | 'end',
  startOffset: number,
  endOffset: number
): { toAdjust: BoundaryAdjustment[]; toUnlink: SceneId[] } {
  const toAdjust: BoundaryAdjustment[] = [];
  const toUnlink: SceneId[] = [];
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
    } else {
      // Engulfed: the other scene's entire range falls inside the dragged
      // scene's new range ('zero-width' or inverted).  Unlink it so it
      // does not persist as an overlapping ghost range.
      toUnlink.push(other.id);
    }
  }
  return { toAdjust, toUnlink };
}

function linkMatchesCurrentChapter(
  link: SceneProseLink,
  currentChapter: WritingUnit
): boolean {
  return link.scope_type === 'story'
    ? currentChapter.scope === 'story'
    : link.scope_type === 'chapter' &&
        normalizeChapterId(link.chapter_id) === normalizeChapterId(currentChapter.id);
}

function snapRangeOutsideMarkers(
  docText: string,
  from: number,
  to: number
): { from: number; to: number } {
  const markerRe = /<!--scene:[^:>]+:(?:start|end)-->/g;
  let safeFrom = from;
  let safeTo = to;
  let match: RegExpExecArray | null = markerRe.exec(docText);
  while (match) {
    const markerStart = match.index;
    const markerEnd = markerStart + match[0].length;

    if (safeFrom > markerStart && safeFrom < markerEnd) {
      safeFrom = markerEnd;
    }
    if (safeTo > markerStart && safeTo < markerEnd) {
      safeTo = markerStart;
    }

    match = markerRe.exec(docText);
  }

  if (safeTo < safeFrom) {
    safeTo = safeFrom;
  }
  return { from: safeFrom, to: safeTo };
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

async function streamEditorReplace(
  view: EditorView,
  from: number,
  to: number,
  text: string
): Promise<void> {
  const chunkSize = 48;
  let renderedLength = 0;
  let hasRenderedChunk = false;

  for (let end = chunkSize; end < text.length; end += chunkSize) {
    const chunk = text.slice(0, end);
    const replaceTo = hasRenderedChunk ? from + renderedLength : to;
    view.dispatch({
      changes: { from, to: replaceTo, insert: chunk },
      annotations: [externalValueSyncAnnotation.of(true)],
    });
    renderedLength = chunk.length;
    hasRenderedChunk = true;
    await new Promise<void>((resolve: () => void) => {
      if (typeof window !== 'undefined' && window.requestAnimationFrame) {
        window.requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 8);
      }
    });
  }

  const replaceTo = hasRenderedChunk ? from + renderedLength : to;
  view.dispatch({
    changes: { from, to: replaceTo, insert: text },
    annotations: [externalValueSyncAnnotation.of(true)],
  });
}

export const ScenesPanelContainer: React.FC<ScenesPanelContainerProps> = ({
  editorRef,
  currentChapter,
  editorSettings,
  recordHistoryEntry,
  onSelectChapter,
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
  const setSceneSelectionChapterIds = useUIStore(
    (s: UIStoreState): UIStoreState['setSceneSelectionChapterIds'] =>
      s.setSceneSelectionChapterIds
  );
  const setSceneSelectionPrimaryId = useUIStore(
    (s: UIStoreState): UIStoreState['setSceneSelectionPrimaryId'] =>
      s.setSceneSelectionPrimaryId
  );
  const scenes = useScenes();
  const story = useStoryStore((s: StoryStoreState) => s.story);
  const patchScene = useStoryStore((s: StoryStoreState) => s.patchScene);
  const setStory = useStoryStore((s: StoryStoreState) => s.setStory);
  const { projectType } = useStoryMeta();
  const chapters = useStoryChaptersListMeta();
  const books = useStoryBooks();

  const scenesViewType = useScenesViewType();
  const setScenesViewType = useUIStore((s: UIStoreState) => s.setScenesViewType);
  const [viewMode, setViewMode] = useState<ViewMode>(
    (scenesViewType as ViewMode) || 'narrative'
  );

  // Stable callback references for scene-lane state sync — these are
  // wrapped in useCallback with empty deps because they use the Zustand
  // functional updater form (prev => ...) which requires no closure
  // over external state.  Without this, every ScenesPanelContainer render
  // creates new inline functions, causing useSceneLanes to recreate its
  // updateVisibleLaneEntryIds callback, which re-runs effects, which call
  // setSceneLaneState, which re-renders ScenesPanelContainer → infinite loop.
  const handleVisibleLaneEntryIdsChange = useCallback((ids: string[]): void => {
    setSceneLaneState((prev: UIStoreState['sceneLaneState']) => ({
      ...prev,
      visibleLaneEntryIds: ids,
    }));
  }, []);
  const handleRemovedReferencedLaneIdsChange = useCallback((ids: string[]): void => {
    setSceneLaneState((prev: UIStoreState['sceneLaneState']) => ({
      ...prev,
      removedReferencedLaneIds: ids,
    }));
  }, []);
  const [editingSceneId, setEditingSceneId] = useState<SceneId | null>(null);
  const lastHandledSceneIntentVersionRef = React.useRef(0);

  const storyRef = React.useRef(story);
  storyRef.current = story;

  // Refs that always hold the latest React state so async operations
  // (like handleProseBoundaryChange) never read stale closures.
  const scenesRef = React.useRef(scenes);
  scenesRef.current = scenes;
  const currentChapterRef = React.useRef(currentChapter);
  currentChapterRef.current = currentChapter;
  // Sequence counter: incremented on each boundary drag start so stale
  // API responses from superseded drags are silently discarded.
  const boundaryDragSeqRef = React.useRef(0);

  // Subscribe to the store's setBaselineState action so we can advance the
  // baseline after user-initiated scene saves.
  const setBaselineState = useStoryStore(
    (s: StoryStoreState): StoryStoreState['setBaselineState'] => s.setBaselineState
  );

  const updateCurrentChapterContent = useCallback(
    (content: string): void => {
      if (!currentChapter) return;
      if (typeof window !== 'undefined' && window.__AQ_DEBUG_RANGES) {
        console.log('[AQ:updateCurrentChapterContent] BEFORE setStory');
        console.log(
          '  currentChapter.id:',
          currentChapter.id,
          'scope:',
          currentChapter.scope
        );
        console.log('  new content length:', content.length);
        console.log(
          '  new content has scene:13:end?',
          content.includes('<!--scene:13:end-->')
        );
        console.log(
          '  new content has scene:14:start?',
          content.includes('<!--scene:14:start-->')
        );
      }
      setStory((prev: StoryState) => {
        if (currentChapter.scope === 'story') {
          return {
            ...prev,
            draft: prev.draft ? { ...prev.draft, content } : prev.draft,
          };
        }

        return {
          ...prev,
          chapters: prev.chapters.map(
            (chapter: Chapter): Chapter =>
              chapter.id === currentChapter.id ? { ...chapter, content } : chapter
          ),
        };
      });
    },
    [currentChapter, setStory]
  );

  const recordSceneHistory = useCallback(
    (
      label: string,
      nextScenes: Scene[],
      handlers?: {
        onUndo?: () => Promise<void> | void;
        onRedo?: () => Promise<void> | void;
      }
    ): void => {
      if (!recordHistoryEntry) {
        return;
      }
      // Use the actual current chapter ID (from the ref) instead of
      // storyRef.current.currentChapterId, which can be stale because
      // setCurrentChapterId only updates the top-level store field, not
      // the nested story.currentChapterId.
      const currentId =
        currentChapterRef.current?.scope === 'chapter'
          ? currentChapterRef.current.id
          : storyRef.current.currentChapterId;
      recordHistoryEntry({
        label,
        state: { ...storyRef.current, scenes: nextScenes, currentChapterId: currentId },
        onUndo: handlers?.onUndo,
        onRedo: handlers?.onRedo,
        forceNewHistory: true,
      });
    },
    [recordHistoryEntry]
  );

  // ---- Scene selection + bidirectional prose-link sync ----
  const { selectedSceneId, handleSelectScene, handleMultipleSelectScenes } =
    useSceneProseSync(scenes, currentChapter, editorRef);

  const handleSelectSceneWithChapterSwitch = useCallback(
    (id: SceneId | null): void => {
      if (id && currentChapter && onSelectChapter) {
        const scene = scenes.find((s: Scene): boolean => s.id === id);
        if (
          scene?.prose_link?.scope_type === 'chapter' &&
          scene.prose_link.chapter_id &&
          normalizeChapterId(scene.prose_link.chapter_id) !==
            normalizeChapterId(currentChapter.id)
        ) {
          onSelectChapter(scene.prose_link.chapter_id);
        }
      }
      handleSelectScene(id);
    },
    [scenes, currentChapter, onSelectChapter, handleSelectScene]
  );

  const dialogOpenedViaTrigger =
    sceneEditorDialog.openedViaTrigger && sceneEditorDialog.isOpen;
  const editingScene = editingSceneId
    ? (scenes.find((s: Scene) => s.id === editingSceneId) ?? null)
    : null;

  const computeSelectedSceneChapterIds = useCallback(
    (sceneIds: ReadonlySet<SceneId>): ReadonlySet<string> => {
      const result = new Set<string>();
      for (const sceneId of sceneIds) {
        const scene = scenes.find((candidate: Scene) => candidate.id === sceneId);
        const chapterId = scene?.prose_link?.chapter_id;
        const normalized = normalizeChapterId(chapterId);
        if (normalized) {
          result.add(normalized);
        }
      }
      return result;
    },
    [scenes]
  );

  const handleSceneSelectionChange = useCallback(
    (ids: ReadonlySet<SceneId>): void => {
      handleMultipleSelectScenes(ids);
      setSceneSelectionChapterIds(computeSelectedSceneChapterIds(ids));
    },
    [
      computeSelectedSceneChapterIds,
      handleMultipleSelectScenes,
      setSceneSelectionChapterIds,
    ]
  );

  useEffect((): (() => void) => {
    return (): void => {
      setSceneSelectionChapterIds(new Set<string>());
      setSceneSelectionPrimaryId(null);
    };
  }, [setSceneSelectionChapterIds, setSceneSelectionPrimaryId]);

  // Keep uiStore.sceneSelectionPrimaryId in sync with local selection state
  // so the left-pane SceneTreeView always shows the current selection.
  useEffect((): void => {
    setSceneSelectionPrimaryId(selectedSceneId);
  }, [selectedSceneId, setSceneSelectionPrimaryId]);

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

  const chapterRelatedSceneIds = React.useMemo((): ReadonlySet<SceneId> => {
    if (currentChapter?.scope !== 'chapter') {
      return new Set();
    }
    const normalizedCurrentChapterId = normalizeChapterId(currentChapter.id);
    if (!normalizedCurrentChapterId) {
      return new Set();
    }
    return new Set(
      scenes
        .filter(
          (scene: Scene): boolean =>
            scene.prose_link?.scope_type === 'chapter' &&
            normalizeChapterId(scene.prose_link.chapter_id) ===
              normalizedCurrentChapterId
        )
        .map((scene: Scene): SceneId => scene.id)
    );
  }, [currentChapter, scenes]);

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
      const nextScenes = applyScenePatch(scenes, updated as Scene);
      patchScene(updated as Scene);
      recordSceneHistory('Update scene', nextScenes);
      // Advance the baseline so the user's own edits are not shown as diffs
      // when the dialog reopens.  User saves implicitly accept all current
      // changes.  Use the explicitly computed nextScenes so we don't depend
      // on a React re-render having refreshed storyRef.current.
      setBaselineState({ ...storyRef.current, scenes: nextScenes });
    },
    [editingSceneId, patchScene, recordSceneHistory, scenes, setBaselineState]
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
    const deletedScene = scenes.find((s: Scene): boolean => s.id === editingSceneId);
    await api.scenes.delete(editingSceneId);
    patchScene(null, editingSceneId);
    // Persist the undo: re-creating the scene on the backend so a reload does
    // not permanently lose it (BUG-6).  The backend assigns a fresh id on
    // restore, so the in-memory copy restored from history is replaced with the
    // backend-persisted scene to keep ids consistent.
    const activeId = { current: editingSceneId };
    recordSceneHistory('Delete scene', applyScenePatch(scenes, null, editingSceneId), {
      onUndo: async (): Promise<void> => {
        if (!deletedScene) return;
        const restored = (await api.scenes.create({
          summary: deletedScene.summary,
          beats: deletedScene.beats,
          active_characters: deletedScene.active_characters,
          passive_characters: deletedScene.passive_characters,
          sourcebook_entry_ids: deletedScene.sourcebook_entry_ids,
          location: deletedScene.location,
          time: deletedScene.time,
          scene_time: deletedScene.scene_time,
          timeline_id: deletedScene.timeline_id,
          color_tag: deletedScene.color_tag,
          status: deletedScene.status,
          pinboard_x: deletedScene.pinboard_x,
          pinboard_y: deletedScene.pinboard_y,
          causes: deletedScene.causes,
        })) as Scene;
        activeId.current = restored.id;
        // Remove the stale (old-id) scene restored from history and add the
        // backend-persisted scene in its place.
        patchScene(null, deletedScene.id);
        patchScene(restored);
      },
      onRedo: async (): Promise<void> => {
        await api.scenes.delete(activeId.current);
        patchScene(null, activeId.current);
      },
    });
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

        // The backend returns scope_start / scope_end / rebuilt_text in the
        // marker-inclusive (original) coordinate space.  The editor document
        // is marker-stripped (hideSceneMarkers=true), so we must convert
        // offsets to visible space and strip markers from the rebuilt text
        // before dispatching.  Failing to do this corrupts linked prose by
        // inserting markers into the visible document at wrong positions.
        const fullContent = currentChapter.content ?? '';
        const visibleStart = toVisibleOffset(fullContent, reorderResult.scope_start);
        const visibleEnd = toVisibleOffset(fullContent, reorderResult.scope_end);
        const strippedText = stripInlineInternalMarkers(reorderResult.rebuilt_text);
        const docLength = view.state.doc.length;
        const safeEnd = Math.min(visibleEnd, docLength);
        view.dispatch({
          changes: {
            from: visibleStart,
            to: safeEnd,
            insert: strippedText,
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

      if (!sourceScene.prose_link || !targetScene.prose_link) return;
      await handleLinkedProseNarrativeReorder(
        sourceSceneId,
        targetSceneId,
        placeBefore
      );
    },
    [handleLinkedProseNarrativeReorder, scenes]
  );

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

      let workingScenes = scenes;

      const sourceIdsToMove = orderedSourceIds.filter((id: SceneId): boolean => {
        const source = scenes.find((scene: Scene): boolean => scene.id === id);
        const link = source?.prose_link;
        if (!link || link.scope_type === 'unlinked') return true;
        if (link.scope_type !== 'chapter') return true;
        return normalizeChapterId(link.chapter_id) !== targetChapterId;
      });

      const moveSourceScenesToTargetChapter = async (): Promise<boolean> => {
        if (sourceIdsToMove.length === 0) return false;

        let chapterContent = targetChapter?.content ?? '';
        const targetBookId = targetChapter?.book_id ?? null;
        const targetSceneIds = new Set(
          workingScenes
            .filter((scene: Scene): boolean => {
              const link = scene.prose_link;
              return (
                link?.scope_type === 'chapter' &&
                normalizeChapterId(link.chapter_id) === targetChapterId
              );
            })
            .map((scene: Scene): SceneId => scene.id)
        );

        const numericChapterId = Number(targetChapterId);
        if (
          Number.isInteger(numericChapterId) &&
          (chapterContent.length === 0 || targetSceneIds.size > 0)
        ) {
          try {
            const chapterDetail = await api.chapters.get(numericChapterId);
            chapterContent = chapterDetail.content ?? chapterContent;
          } catch {
            // Fall back to link-derived placement when chapter detail is unavailable.
          }
        }

        const chapterContentLength = Math.max(0, chapterContent.length);
        const previousScenesById = new Map<SceneId, Scene>();

        const linkedChapterTailOffset = (scopeScenes: Scene[]): number =>
          scopeScenes
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
                link.end_offset ?? (Number.isFinite(startOffset) ? startOffset : 0)
              );
              const markerBlockEnd = Math.max(
                endOffset + sceneMarkerTokenLength(scene.id, 'end'),
                startOffset +
                  sceneMarkerTokenLength(scene.id, 'start') +
                  sceneMarkerTokenLength(scene.id, 'end')
              );

              return Math.max(maxOffset, markerBlockEnd);
            }, 0);

        let nextScenes = workingScenes;
        try {
          for (const sourceId of sourceIdsToMove) {
            const chapterLinkEnd = Math.max(
              1,
              chapterContentLength,
              linkedChapterTailOffset(nextScenes)
            );
            const chapterLinkStart = Math.max(0, chapterLinkEnd - 1);

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

      await moveSourceScenesToTargetChapter();
    },
    [books, chapters, patchScene, projectType, recordSceneHistory, scenes, t]
  );
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

    // Listen for scene reorder events dispatched from the left-pane scene tree.
    const handleExternalSceneReorder = (event: Event): void => {
      const custom = event as CustomEvent<{
        sourceSceneId?: SceneId;
        targetSceneId?: SceneId;
        placeBefore?: boolean;
      }>;
      const sourceSceneId = custom.detail?.sourceSceneId;
      const targetSceneId = custom.detail?.targetSceneId;
      const placeBefore = custom.detail?.placeBefore ?? false;
      if (typeof sourceSceneId !== 'number' || typeof targetSceneId !== 'number') {
        return;
      }
      void handleNarrativeReorder(sourceSceneId, targetSceneId, placeBefore);
    };

    window.addEventListener(
      'aq-scene-reorder-prose',
      handleExternalSceneReorder as EventListener
    );

    // Listen for scene-select events dispatched from the left-pane scene tree.
    const handleExternalSceneSelect = (event: Event): void => {
      const custom = event as CustomEvent<{ sceneId?: SceneId }>;
      const sceneId = custom.detail?.sceneId;
      if (typeof sceneId !== 'number') return;
      handleSelectSceneWithChapterSwitch(sceneId);
    };

    window.addEventListener(
      'aq-scene-select',
      handleExternalSceneSelect as EventListener
    );
    return (): void => {
      window.removeEventListener(
        'aq-scene-drop-chapter',
        handleExternalChapterDrop as EventListener
      );
      window.removeEventListener(
        'aq-scene-reorder-prose',
        handleExternalSceneReorder as EventListener
      );
      window.removeEventListener(
        'aq-scene-select',
        handleExternalSceneSelect as EventListener
      );
    };
  }, [
    handleDropScenesOnChapter,
    handleNarrativeReorder,
    handleSelectSceneWithChapterSwitch,
  ]);

  // ---- Prose-link boundary drag (update start/end offset) ----
  const handleProseBoundaryChange = useCallback(
    async (sceneId: SceneId, edge: 'start' | 'end', offset: number): Promise<void> => {
      // Serialize boundary drags so rapid consecutive drags are processed
      // in order and stale closures cannot produce overlapping ranges.
      const seq = ++boundaryDragSeqRef.current;

      // Read the latest state from refs so the async body never uses a
      // stale React render snapshot.
      const latestScenes = scenesRef.current;
      const latestChapter = currentChapterRef.current;

      const scene = latestScenes.find((s: Scene): boolean => s.id === sceneId);
      if (!scene?.prose_link) return;
      const link = scene.prose_link;

      // The drag offset is in VISIBLE (marker-stripped) coordinates because
      // the CodeMirror editor strips <!--scene:...--> tokens when
      // hideSceneMarkers=true.  Convert back to ORIGINAL (marker-inclusive)
      // coordinates before persisting, so the backend stores offsets that
      // match the full content (with markers).
      const fullContent = latestChapter?.content ?? '';
      const originalOffset =
        fullContent.length > 0 ? toOriginalOffset(offset, fullContent) : offset;

      const currentStart = Number(link.start_offset ?? 0);
      const currentEnd = Number(link.end_offset ?? currentStart);
      const startOffset = edge === 'start' ? originalOffset : currentStart;
      const endOffset = edge === 'end' ? originalOffset : currentEnd;

      // If the drag would trim the scene to zero-size, unlink it instead
      if (startOffset >= endOffset) {
        try {
          const updated = await api.scenes.unlinkProse(sceneId);
          if (seq !== boundaryDragSeqRef.current) return; // superseded
          updated.forEach((s: Scene) => patchScene(s));
          recordSceneHistory(
            'Unlink prose (boundary drag)',
            applyScenePatches(latestScenes, updated)
          );
        } catch (err) {
          if (seq !== boundaryDragSeqRef.current) return;
          notifyError(t('Unlink prose'), err);
        }
        return;
      }

      const { toAdjust, toUnlink } = collectBoundaryAdjustments(
        latestScenes,
        sceneId,
        link,
        edge,
        startOffset,
        endOffset
      );

      try {
        // Build batch payload: convert all original offsets to stripped
        // (marker-free) positions so relink_scope_prose can inject all
        // markers atomically without corrupting adjacent marker tokens.
        const fullContent = latestChapter?.content ?? '';
        const batchAssignments: SceneBoundaryAssignment[] = [];
        for (const adj of toAdjust) {
          batchAssignments.push({
            scene_id: adj.id,
            start_offset: fullContent
              ? toVisibleLinkedOffset(
                  adj.newStart,
                  null as unknown as never,
                  [],
                  true,
                  fullContent
                )
              : adj.newStart,
            end_offset: fullContent
              ? toVisibleLinkedOffset(
                  adj.newEnd,
                  null as unknown as never,
                  [],
                  true,
                  fullContent
                )
              : adj.newEnd,
          });
        }
        batchAssignments.push({
          scene_id: sceneId,
          start_offset: fullContent
            ? toVisibleLinkedOffset(
                startOffset,
                null as unknown as never,
                [],
                true,
                fullContent
              )
            : startOffset,
          end_offset: fullContent
            ? toVisibleLinkedOffset(
                endOffset,
                null as unknown as never,
                [],
                true,
                fullContent
              )
            : endOffset,
        });

        if (typeof window !== 'undefined' && window.__AQ_DEBUG_RANGES) {
          console.log(
            '[AQ:handleProseBoundaryChange] batch assignments:',
            batchAssignments
          );
          console.log('  sceneId:', sceneId, 'edge:', edge);
          console.log('  visible offset from drag:', offset);
          console.log('  original offset:', originalOffset);
          console.log('  fullContent length:', fullContent.length);
          console.log('  toAdjust:', toAdjust);
          console.log('  toUnlink:', toUnlink);
        }

        const modified = await api.scenes.batchLinkProse({
          scope_type: link.scope_type,
          chapter_id: link.chapter_id ?? null,
          book_id: link.book_id ?? null,
          assignments: batchAssignments,
          unlink_ids: toUnlink,
        });
        if (seq !== boundaryDragSeqRef.current) return; // superseded
        let nextScenes = latestScenes;
        modified.forEach((s: Scene) => patchScene(s));
        nextScenes = applyScenePatches(nextScenes, modified);

        // Unlink engulfed scenes in the frontend store.  The API response
        // does not include unlinked scenes, so without explicitly setting
        // prose_link=null here the visible-offset calculation would
        // incorrectly subtract marker token lengths for scenes whose
        // markers have already been removed from the file — producing
        // wrong visible offsets and "too short" scene display.
        for (const unlinkedId of toUnlink) {
          const unlinked = nextScenes.find((s: Scene): boolean => s.id === unlinkedId);
          if (unlinked) {
            patchScene({ ...unlinked, prose_link: null });
            nextScenes = applyScenePatch(nextScenes, { ...unlinked, prose_link: null });
          }
        }

        if (typeof window !== 'undefined' && window.__AQ_DEBUG_RANGES) {
          console.log(
            '[AQ:handleProseBoundaryChange] API response scenes:',
            modified.map((s: Scene) => ({
              id: s.id,
              prose_link: s.prose_link
                ? {
                    start: s.prose_link.start_offset,
                    end: s.prose_link.end_offset,
                    scope: s.prose_link.scope_type,
                    chap: s.prose_link.chapter_id,
                  }
                : null,
            }))
          );
        }

        // Refresh stored chapter/story content so useSceneProseSync
        // recomputes visible ranges with correct marker positions.
        // Fetch fresh content from the API — the backend has already
        // written updated markers to disk.
        if (link.chapter_id) {
          const ch = await api.chapters.get(Number(link.chapter_id));
          if (seq !== boundaryDragSeqRef.current) return;
          recordSceneHistory('Adjust scene prose boundary', nextScenes);
          updateCurrentChapterContent(ch.content ?? '');
        } else {
          // Story-scope: refresh content.md
          try {
            const storyContent = await api.story.getContent();
            if (seq !== boundaryDragSeqRef.current) return;
            if (storyContent.ok) {
              recordSceneHistory('Adjust scene prose boundary', nextScenes);
              updateCurrentChapterContent(storyContent.content);
            }
          } catch {
            /* non-critical */
          }
        }
      } catch (err) {
        if (seq !== boundaryDragSeqRef.current) return;
        notifyError(t('Update prose link'), err);
      }
    },
    [patchScene, recordSceneHistory, t, updateCurrentChapterContent]
  );

  // Register the boundary-change handler on the editor handle.
  // Uses useLayoutEffect (no deps) so it fires every render — this ensures
  // the callback is registered as soon as editorRef.current is populated,
  // regardless of sibling render order between ScenesPanelContainer and Editor.
  useLayoutEffect((): (() => void) => {
    editorRef?.current?.setOnProseBoundaryChange(handleProseBoundaryChange);
    return (): void => {
      editorRef?.current?.setOnProseBoundaryChange(null);
    };
  });

  // ---- Get linked prose text from editor content ----
  const getLinkedProseText = useCallback(
    (link: SceneProseLink): string | null => {
      const view: EditorView | null = editorRef?.current?.getEditorView() ?? null;
      if (view && currentChapter && linkMatchesCurrentChapter(link, currentChapter)) {
        return getLinkedProseFromTextSource(
          view.state.doc.sliceString(0, view.state.doc.length),
          link,
          currentChapter,
          scenes
        );
      }

      if (link.scope_type === 'story') {
        const storyText = story.draft?.content;
        if (typeof storyText !== 'string') return null;
        const storyContext = {
          id: 'story',
          scope: 'story',
          title: 'Story',
          summary: '',
          content: storyText,
        } as WritingUnit;
        return getLinkedProseFromTextSource(storyText, link, storyContext, scenes);
      }

      if (link.scope_type === 'chapter') {
        const targetChapterId = normalizeChapterId(link.chapter_id);
        if (!targetChapterId) return null;
        const chapter = story.chapters.find(
          (candidate: Chapter): boolean =>
            normalizeChapterId(candidate.id) === targetChapterId
        );
        if (!chapter || typeof chapter.content !== 'string') return null;
        const chapterContext = {
          id: String(chapter.id),
          scope: 'chapter',
          title: chapter.title,
          summary: chapter.summary,
          content: chapter.content,
        } as WritingUnit;
        return getLinkedProseFromTextSource(
          chapter.content,
          link,
          chapterContext,
          scenes
        );
      }

      return null;
    },
    [editorRef, currentChapter, scenes, story]
  );

  const handleSaveProseContent = useCallback(
    async (text: string): Promise<void> => {
      if (!editingSceneId) return;
      // Capture the prose link before the API call so we know which range to
      // replace in the editor (the backend may return a different end_offset).
      const proseLink =
        scenes.find((s: Scene) => s.id === editingSceneId)?.prose_link ?? null;
      // Guard: only scenes with a real content scope (story/chapter) have prose
      // that lives in an editor document.  Unlinked-scope scenes (brand-new
      // scenes) must not be written into any chapter — doing so corrupts the
      // chapter text at a wrong offset (BUG-1).
      if (!proseLink || proseLink.scope_type === 'unlinked') return;

      const previousText = getLinkedProseText(proseLink) ?? '';
      const matchesCurrentScope =
        currentChapter != null && linkMatchesCurrentChapter(proseLink, currentChapter);

      const updated = await api.scenes.updateProseContent(editingSceneId, text);
      patchScene(updated as Scene);
      recordSceneHistory(
        'Edit scene linked prose',
        applyScenePatch(scenes, updated as Scene),
        {
          // Persist the revert to the backend so the prose actually changes
          // back (not just the in-memory story state) — BUG-2.
          onUndo: async (): Promise<void> => {
            const reverted = await api.scenes.updateProseContent(
              editingSceneId,
              previousText
            );
            patchScene(reverted as Scene);
          },
          onRedo: async (): Promise<void> => {
            const redone = await api.scenes.updateProseContent(editingSceneId, text);
            patchScene(redone as Scene);
          },
        }
      );
      // Reflect the change immediately in the editor so the writer sees the
      // updated text without having to close and reopen the chapter.  Update
      // the store's full content (scene markers included) instead of
      // dispatching into the CodeMirror document: a raw dispatch leaves the
      // editor's marker baseline (lastSavedFullContentRef) stale, so the next
      // debounced autosave re-injects markers against the OLD text, drops the
      // scene marker, and corrupts the chapter file (BUG-2).  The editor
      // re-syncs externally from the store and skips onChange for external
      // value syncs, so no autosave overwrites the backend.
      // prose_link offsets are marker-inclusive in the full content.
      if (matchesCurrentScope && currentChapter?.content) {
        const fullContent = currentChapter.content;
        const start = Math.min(Number(proseLink.start_offset ?? 0), fullContent.length);
        const end = Math.min(
          Math.max(Number(proseLink.end_offset ?? start), start),
          fullContent.length
        );
        updateCurrentChapterContent(
          `${fullContent.slice(0, start)}${text}${fullContent.slice(end)}`
        );
      }
    },
    [
      editingSceneId,
      patchScene,
      recordSceneHistory,
      scenes,
      currentChapter,
      getLinkedProseText,
      updateCurrentChapterContent,
    ]
  );

  // eslint-disable-next-line complexity
  const handleWriteScene = useCallback(async (): Promise<string | null> => {
    if (!editingSceneId) return null;

    const sceneBeforeWrite = scenes.find((s: Scene) => s.id === editingSceneId);
    const linkedScope = sceneBeforeWrite?.prose_link;

    const replaceRange = (
      content: string,
      startOffset: number,
      endOffset: number,
      insert: string
    ): string => {
      const docLen = content.length;
      const from = Math.min(Math.max(Number(startOffset), 0), docLen);
      const to = Math.min(Math.max(Number(endOffset), from), docLen);
      return `${content.slice(0, from)}${insert}${content.slice(to)}`;
    };

    const updateLinkedScopeContent = (
      link: SceneProseLink | null | undefined,
      text: string
    ): void => {
      if (!link) return;

      if (link.scope_type === 'story') {
        setStory((prev: StoryState) => {
          if (!prev.draft) return prev;
          const nextDraftContent = replaceRange(
            prev.draft.content ?? '',
            Number(link.start_offset ?? 0),
            Number(link.end_offset ?? link.start_offset ?? 0),
            text
          );
          return {
            ...prev,
            draft: {
              ...prev.draft,
              content: nextDraftContent,
            },
          };
        });
        return;
      }

      if (link.scope_type !== 'chapter') return;
      const targetChapterId = normalizeChapterId(link.chapter_id);
      if (!targetChapterId) return;

      setStory((prev: StoryState) => ({
        ...prev,
        chapters: prev.chapters.map((chapter: Chapter): Chapter => {
          if (normalizeChapterId(chapter.id) !== targetChapterId) {
            return chapter;
          }
          const nextContent = replaceRange(
            chapter.content ?? '',
            Number(link.start_offset ?? 0),
            Number(link.end_offset ?? link.start_offset ?? 0),
            text
          );
          return {
            ...chapter,
            content: nextContent,
          };
        }),
      }));
    };

    const payload =
      linkedScope?.scope_type === 'chapter' &&
      normalizeChapterId(linkedScope.chapter_id).length > 0
        ? {
            scope_type: 'chapter' as const,
            chapter_id: normalizeChapterId(linkedScope.chapter_id),
            book_id: linkedScope.book_id ?? null,
            include_following_scenes: 1,
            detect_boundaries: true,
          }
        : linkedScope?.scope_type === 'story'
          ? {
              scope_type: 'story' as const,
              include_following_scenes: 1,
              detect_boundaries: true,
            }
          : currentChapter?.scope === 'chapter'
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
    const isNewWrite = !sceneBeforeWrite?.prose_link;
    const updates = [result.scene, ...result.scenes];
    updates.forEach((scene: Scene): void => {
      patchScene(scene);
    });
    recordSceneHistory('Write scene prose', applyScenePatches(scenes, updates));

    const linkedScopeAfterWrite =
      result.scene.prose_link ?? sceneBeforeWrite?.prose_link;

    const editedAssignment = result.assignments.find(
      (assignment: SceneBoundaryAssignment): boolean =>
        String(assignment.scene_id) === String(editingSceneId)
    );
    const view: EditorView | null = editorRef?.current?.getEditorView() ?? null;
    if (!view || !currentChapter) {
      updateLinkedScopeContent(linkedScopeAfterWrite, result.generated_text);
      return result.generated_text;
    }

    const isScopeMatch =
      payload.scope_type === 'story'
        ? currentChapter.scope === 'story'
        : currentChapter.scope === 'chapter' &&
          normalizeChapterId(currentChapter.id) ===
            normalizeChapterId(payload.chapter_id ?? currentChapter.id);
    if (!isScopeMatch) {
      updateLinkedScopeContent(linkedScopeAfterWrite, result.generated_text);
      return result.generated_text;
    }

    const docLen = view.state.doc.length;

    if (isNewWrite) {
      // Keep the visible editor marker-free. Marker offsets are maintained
      // through prose_link metadata and translated by useSceneProseSync.
      const currentContent = view.state.doc.toString();
      const separator =
        currentContent.length > 0 && !currentContent.endsWith('\n') ? '\n' : '';
      await streamEditorReplace(
        view,
        docLen,
        docLen,
        `${separator}${result.generated_text}`
      );
    } else {
      // For an existing linked scene the markers are already in the editor;
      // only the prose text between them needs to be replaced.
      const fallbackLink = result.scene.prose_link ?? sceneBeforeWrite?.prose_link;
      const proseLinkSource = fallbackLink
        ? {
            start_offset: fallbackLink.start_offset,
            end_offset: fallbackLink.end_offset ?? docLen,
          }
        : null;
      const docText = view.state.doc.sliceString(0, docLen);
      const markerSpanRange = getSceneMarkerSpanRange(docText, editingSceneId);
      if (markerSpanRange) {
        await streamEditorReplace(
          view,
          markerSpanRange.from,
          markerSpanRange.to,
          result.generated_text
        );
        updateCurrentChapterContent(view.state.doc.toString());
        return result.generated_text;
      }

      const chapterHasInlineSceneMarkers =
        typeof currentChapter.content === 'string' &&
        hasInlineSceneMarkers(currentChapter.content);
      const docHasInlineSceneMarkers = hasInlineSceneMarkers(docText);
      const hasInlineMarkers = chapterHasInlineSceneMarkers || docHasInlineSceneMarkers;

      // Use this scene's prose_link range first. Assignment offsets can be
      // computed in a different coordinate space and should not drive
      // single-scene replacement when a stable scene-local link is available.
      const linkSource = proseLinkSource ?? editedAssignment ?? null;
      if (hasInlineMarkers && !proseLinkSource) {
        updateCurrentChapterContent(view.state.doc.toString());
        return result.generated_text;
      }

      if (!linkSource) return result.generated_text;

      // prose_link offsets are marker-inclusive.  When the editor document
      // is marker-stripped (hideSceneMarkers=true), convert to visible space
      // so the replacement targets the correct range.
      const fullContent: string = currentChapter.content ?? '';
      const rawFrom = Math.min(
        Math.max(
          docHasInlineSceneMarkers
            ? linkSource.start_offset
            : toVisibleOffset(fullContent, linkSource.start_offset),
          0
        ),
        docLen
      );
      const rawTo = Math.min(
        Math.max(
          docHasInlineSceneMarkers
            ? (linkSource.end_offset ?? rawFrom)
            : toVisibleOffset(fullContent, linkSource.end_offset ?? fullContent.length),
          rawFrom
        ),
        docLen
      );
      const { from, to } = hasInlineMarkers
        ? snapRangeOutsideMarkers(docText, rawFrom, rawTo)
        : { from: rawFrom, to: rawTo };
      await streamEditorReplace(view, from, to, result.generated_text);
    }

    updateCurrentChapterContent(view.state.doc.toString());
    return result.generated_text;
  }, [
    currentChapter,
    editingSceneId,
    editorRef,
    patchScene,
    recordSceneHistory,
    scenes,
    setStory,
    updateCurrentChapterContent,
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
                onClick={() => {
                  setViewMode(mode);
                  setScenesViewType(mode);
                }}
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
            onSelectScene={handleSelectSceneWithChapterSwitch}
            onSelectionChange={handleSceneSelectionChange}
            relatedSceneIds={chapterRelatedSceneIds}
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
            onSelectScene={handleSelectSceneWithChapterSwitch}
            onSelectionChange={handleSceneSelectionChange}
            relatedSceneIds={chapterRelatedSceneIds}
            onEditScene={setEditingSceneId}
            onDropProse={handleDropProse}
            onCreateCause={handleCreateCause}
            onReorderScene={
              viewMode === 'narrative' ? handleNarrativeReorder : undefined
            }
            onDropScenesOnChapter={
              viewMode === 'narrative' ? handleDropScenesOnChapter : undefined
            }
            initialVisibleLaneEntryIds={sceneLaneState.visibleLaneEntryIds}
            initialRemovedReferencedLaneIds={sceneLaneState.removedReferencedLaneIds}
            onVisibleLaneEntryIdsChange={handleVisibleLaneEntryIdsChange}
            onRemovedReferencedLaneIdsChange={handleRemovedReferencedLaneIdsChange}
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
            onSelectScene={handleSelectSceneWithChapterSwitch}
            onSelectionChange={handleSceneSelectionChange}
            relatedSceneIds={chapterRelatedSceneIds}
            onEditScene={setEditingSceneId}
            onAssignSceneTimeline={handleAssignSceneTimeline}
            onCreateCause={handleCreateCause}
            editorSettings={editorSettings}
            initialVisibleLaneEntryIds={sceneLaneState.visibleLaneEntryIds}
            initialRemovedReferencedLaneIds={sceneLaneState.removedReferencedLaneIds}
            onVisibleLaneEntryIdsChange={handleVisibleLaneEntryIdsChange}
            onRemovedReferencedLaneIdsChange={handleRemovedReferencedLaneIdsChange}
          />
        )}
      </div>

      {/* Scene editor dialog */}
      {editingScene && (
        <SceneEditorDialog
          scene={editingScene}
          isOpen={true}
          viewMode={viewMode}
          openedViaTrigger={dialogOpenedViaTrigger}
          defaultShowDiff={false}
          sceneChangeHint={sceneEditorDialog.mutationHint}
          onClose={() => {
            setEditingSceneId(null);
            uiStoreActions.closeSceneEditorDialog();
          }}
          onNavigateScene={(sceneId: SceneId): void => {
            setEditingSceneId(sceneId);
            handleSelectSceneWithChapterSwitch(sceneId);
          }}
          onSave={handleSaveScene}
          onDelete={handleDeleteScene}
          onDeleteCause={handleDeleteCause}
          getLinkedProseText={editorRef ? getLinkedProseText : undefined}
          onSaveProseContent={editorRef ? handleSaveProseContent : undefined}
          onWriteScene={handleWriteScene}
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
