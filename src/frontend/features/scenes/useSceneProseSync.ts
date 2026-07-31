// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Hook that manages bidirectional selection sync between scene cards on the
 * pinboard and their linked prose ranges in the editor.
 *
 * - Clicking a scene card highlights its linked prose range in the editor
 *   using a background decoration (no cursor movement / text selection).
 * - Ctrl/Shift/lasso multi-select highlights all selected scenes simultaneously.
 * - Moving the editor cursor into a linked prose range selects the owning
 *   scene card on the pinboard (single-scene highlight in that direction).
 * - Moving the cursor out of all linked ranges clears all highlights and
 *   deselects the card.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Scene, SceneId } from '../../types';
import type { WritingUnit } from '../../types/domain';
import type { EditorHandle } from '../editor/Editor';
import type { ProseHighlightRange } from '../editor/CodeMirrorEditor';
import { toVisibleRange } from './proseLinkCoordinates';
import { stripInlineInternalMarkers } from '../editor/internalTags';

/** Returns true when two sets contain exactly the same SceneId members. */
function setsEqual(a: ReadonlySet<SceneId>, b: ReadonlySet<SceneId>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export interface SceneProseSyncResult {
  selectedSceneId: SceneId | null;
  handleSelectScene: (id: SceneId | null) => void;
  /** Called by PinboardView whenever the full multi-selection set changes. */
  handleMultipleSelectScenes: (ids: ReadonlySet<SceneId>) => void;
}

export function useSceneProseSync(
  scenes: Scene[],
  currentChapter: WritingUnit | null | undefined,
  editorRef: React.RefObject<EditorHandle | null> | undefined
): SceneProseSyncResult {
  const [selectedSceneId, setSelectedSceneId] = useState<SceneId | null>(null);
  // Full set of scene ids whose prose ranges should be highlighted.
  const [highlightSceneIds, setHighlightSceneIds] = useState<ReadonlySet<SceneId>>(
    new Set()
  );

  // Stable refs so the cursor callback closure never goes stale between renders.
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const currentChapterRef = useRef(currentChapter);
  currentChapterRef.current = currentChapter;

  // Track when the editor handle becomes available.  React ref.current
  // changes do not trigger re-renders, so we poll via useLayoutEffect
  // (which runs after every render) to detect the transition.  Once
  // detected we set a state flag so the cursor-callback effect below
  // re-runs and registers the callback even when editorRef.current was
  // null on the initial mount (e.g. because the Editor component is
  // conditionally rendered behind currentChapter).
  const [editorAttached, setEditorAttached] = useState(false);
  useLayoutEffect((): void => {
    const hasEditor = !!editorRef?.current;
    if (hasEditor !== editorAttached) {
      setEditorAttached(hasEditor);
    }
  });

  // Subscribe to editor cursor changes.  When the cursor moves into a linked
  // prose range we select the owning scene card and highlight the prose.
  // Moving out deselects the card and removes the highlight.
  //
  // Editor content has stripInlineInternalMarkers applied (markers are never
  // in the visible document).  We strip the chapter's stored content so
  // toVisibleRange computes offsets that match the editor's positions.
  useEffect((): (() => void) => {
    const editor = editorRef?.current;
    if (!editor) return (): void => {};

    editor.setOnCursorChange((_anchor: number, head: number): void => {
      const chapter = currentChapterRef.current;
      if (!chapter) {
        setSelectedSceneId(null);
        editor.clearProseHighlight();
        return;
      }

      if (typeof window !== 'undefined' && window.__AQ_DEBUG_RANGES) {
        console.log(
          '[AQ:useSceneProseSync] CURSOR CHANGE callback firing, head:',
          head
        );
      }

      const strippedChapter: WritingUnit = {
        ...chapter,
        content: stripInlineInternalMarkers(chapter.content),
      };

      const cursor = head;
      const fullContent = chapter.content;
      const found = scenesRef.current.find((s: Scene): boolean => {
        const visibleRange = toVisibleRange(
          s,
          strippedChapter,
          scenesRef.current,
          fullContent
        );
        if (!visibleRange) return false;
        return cursor >= visibleRange.from && cursor < visibleRange.to;
      });
      const foundId = found?.id ?? null;
      setSelectedSceneId(foundId);

      if (found) {
        const visibleRange = toVisibleRange(
          found,
          strippedChapter,
          scenesRef.current,
          fullContent
        );
        if (visibleRange) {
          editor.setProseHighlights([{ sceneId: found.id, ...visibleRange }]);
        }
      } else {
        editor.clearProseHighlight();
      }
    });

    return (): void => {
      editor.setOnCursorChange(null);
    };
  }, [editorRef, editorAttached]);

  // When the set of highlighted scenes changes, rebuild the decoration list
  // and push it to the editor so all selected cards are simultaneously lit.
  useEffect((): void => {
    const editor = editorRef?.current;
    if (!editor) return;

    if (highlightSceneIds.size === 0 || !currentChapter) {
      editor.clearProseHighlight();
      return;
    }

    if (typeof window !== 'undefined' && window.__AQ_DEBUG_RANGES) {
      console.log('[AQ:useSceneProseSync] HIGHLIGHT EFFECT FIRING');
      console.log(
        '  currentChapter.content length:',
        currentChapter.content?.length ?? 0
      );
      console.log(
        '  currentChapter.content starts with:',
        currentChapter.content?.slice(0, 60)
      );
    }

    const strippedChapter: WritingUnit = {
      ...currentChapter,
      content: stripInlineInternalMarkers(currentChapter.content),
    };
    const fullContent = currentChapter.content;

    const entries: ProseHighlightRange[] = [];
    for (const sceneId of highlightSceneIds) {
      const scene = scenesRef.current.find((s: Scene): boolean => s.id === sceneId);
      if (!scene) continue;
      const visibleRange = toVisibleRange(
        scene,
        strippedChapter,
        scenesRef.current,
        fullContent
      );
      if (!visibleRange) continue;
      entries.push({ sceneId, from: visibleRange.from, to: visibleRange.to });
    }

    if (typeof window !== 'undefined' && window.__AQ_DEBUG_RANGES) {
      console.log('[AQ:useSceneProseSync] setting highlights:', entries);
      console.log('  highlightSceneIds:', [...highlightSceneIds]);
      console.log('  fullContent length:', fullContent.length);
      console.log('  strippedContent length:', strippedChapter.content.length);
      console.log('  scenes count:', scenesRef.current.length);
    }

    if (entries.length === 0) {
      editor.clearProseHighlight();
    } else {
      editor.setProseHighlights(entries);
    }
  }, [highlightSceneIds, currentChapter, editorRef]);

  const handleSelectScene = useCallback((id: SceneId | null): void => {
    setSelectedSceneId(id);
    setHighlightSceneIds((prev: ReadonlySet<SceneId>) => {
      const next = id ? new Set<SceneId>([id]) : new Set<SceneId>();
      return setsEqual(prev, next) ? prev : next;
    });
  }, []);

  const handleMultipleSelectScenes = useCallback((ids: ReadonlySet<SceneId>): void => {
    setHighlightSceneIds((prev: ReadonlySet<SceneId>) =>
      setsEqual(prev, ids) ? prev : new Set(ids)
    );
  }, []);

  return { selectedSceneId, handleSelectScene, handleMultipleSelectScenes };
}
