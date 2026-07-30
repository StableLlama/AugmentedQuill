// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Syncs view state (last chapter, workspace mode, scenes view type,
 * scroll position) between the frontend stores and the backend
 * view_state.json file so the user's workspace layout survives reloads.
 */

import { useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { useStoryStore } from '../../stores/storyStore';
import { useUIStore } from '../../stores/uiStore';
import type { ViewStatePayload } from '../../services/apiClients/viewState';

/**
 * Load the persisted view state from the backend for the current project
 * and apply it to the relevant stores.
 *
 * Call this after a project has been fully loaded (story + chapters present).
 */
export async function restoreViewState(projectName: string): Promise<void> {
  try {
    const response = await api.forProject(projectName).viewState.get();
    const vs = response.view_state;
    if (!vs) return;

    const store = useStoryStore.getState();
    const uiStore = useUIStore.getState();

    // Restore chapter selection
    if (vs.current_chapter_id) {
      const chapterExists = store.story.chapters.some(
        (ch: { id: string }): boolean => ch.id === vs.current_chapter_id
      );
      if (chapterExists) {
        store.setCurrentChapterId(vs.current_chapter_id);
      }
    }

    // Restore workspace mode
    if (
      vs.workspace_mode === 'page' ||
      vs.workspace_mode === 'scenes' ||
      vs.workspace_mode === 'split'
    ) {
      uiStore.setWorkspaceMode(vs.workspace_mode);
    }

    // Restore scenes view type
    if (vs.scenes_view_type) {
      uiStore.setScenesViewType(vs.scenes_view_type);
    }
  } catch (err) {
    // Silently ignore – view state is best-effort
    console.debug('Could not restore view state', err);
  }
}

/**
 * Build the current view state payload from the stores.
 */
function buildViewStatePayload(_projectName: string): ViewStatePayload {
  const storyStore = useStoryStore.getState();
  const uiStore = useUIStore.getState();

  return {
    current_chapter_id: storyStore.currentChapterId,
    scroll_position: 0, // Will be wired to editor scroll position later
    workspace_mode: uiStore.workspaceMode,
    scenes_view_type: uiStore.scenesViewType,
  };
}

/**
 * Persist current view state to the backend.
 */
export async function persistViewState(projectName: string): Promise<void> {
  if (!projectName) return;
  try {
    const payload = buildViewStatePayload(projectName);
    await api.forProject(projectName).viewState.put(payload);
  } catch (err) {
    console.debug('Could not persist view state', err);
  }
}

/**
 * React hook that automatically saves view state to the backend whenever
 * the relevant store values change.
 *
 * @param projectName - The current project name (empty string to skip).
 */
export function useAutoViewStatePersistence(projectName: string): void {
  const currentChapterId = useStoryStore(
    (s: { currentChapterId: string | null }): string | null => s.currentChapterId
  );
  const workspaceMode = useUIStore(
    (s: { workspaceMode: 'page' | 'scenes' | 'split' }): 'page' | 'scenes' | 'split' =>
      s.workspaceMode
  );
  const scenesViewType = useUIStore(
    (s: { scenesViewType: string }): string => s.scenesViewType
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectName) return;

    // Debounce saves to avoid excessive writes during rapid changes
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      persistViewState(projectName);
    }, 500);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [projectName, currentChapterId, workspaceMode, scenesViewType]);
}
