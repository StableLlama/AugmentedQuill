// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for view state persistence and restoration logic.
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { restoreViewState, persistViewState } from './useViewStatePersistence';
import { resetUIStore, useUIStore } from '../../stores/uiStore';
import { resetStoryStore, useStoryStore } from '../../stores/storyStore';
import { INITIAL_STORY } from '../../stores/storyStore';

// ---------------------------------------------------------------------------
// Mock the API layer
// ---------------------------------------------------------------------------

const mockViewStateGet = vi.fn();
const mockViewStatePut = vi.fn();

vi.mock('../../services/api', () => ({
  api: {
    forProject: (_name: string) => ({
      viewState: {
        get: mockViewStateGet,
        put: mockViewStatePut,
      },
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let storage: Record<string, string>;

beforeEach(async () => {
  storage = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key in storage ? storage[key] : null),
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      storage = {};
    },
  });
  vi.resetModules();
  mockViewStateGet.mockReset();
  mockViewStatePut.mockReset();
  resetUIStore();
  resetStoryStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('restoreViewState', () => {
  it('does nothing when backend returns null view_state', async () => {
    mockViewStateGet.mockResolvedValue({ ok: true, view_state: null });

    await restoreViewState('test-project');

    expect(useStoryStore.getState().currentChapterId).toBeNull();
  });

  it('restores chapter id when chapter exists in story', async () => {
    mockViewStateGet.mockResolvedValue({
      ok: true,
      view_state: {
        current_chapter_id: 'ch-42',
        scroll_position: 0,
        workspace_mode: 'scenes',
        scenes_view_type: 'narrative',
      },
    });

    useStoryStore.getState().setStory({
      ...INITIAL_STORY,
      chapters: [{ id: 'ch-42', title: 'Ch 42', summary: '', content: '' }],
    });

    await restoreViewState('test-project');

    expect(useStoryStore.getState().currentChapterId).toBe('ch-42');
  });

  it('does not restore chapter id when chapter does not exist', async () => {
    mockViewStateGet.mockResolvedValue({
      ok: true,
      view_state: {
        current_chapter_id: 'nonexistent',
        scroll_position: 0,
        workspace_mode: 'page',
        scenes_view_type: 'narrative',
      },
    });

    await restoreViewState('test-project');

    expect(useStoryStore.getState().currentChapterId).toBeNull();
  });

  it('restores workspace mode', async () => {
    mockViewStateGet.mockResolvedValue({
      ok: true,
      view_state: {
        current_chapter_id: null,
        scroll_position: 0,
        workspace_mode: 'split',
        scenes_view_type: 'narrative',
      },
    });

    await restoreViewState('test-project');

    expect(useUIStore.getState().workspaceMode).toBe('split');
  });

  it('restores scenes view type', async () => {
    mockViewStateGet.mockResolvedValue({
      ok: true,
      view_state: {
        current_chapter_id: null,
        scroll_position: 0,
        workspace_mode: 'page',
        scenes_view_type: 'convergence-map',
      },
    });

    await restoreViewState('test-project');

    expect(useUIStore.getState().scenesViewType).toBe('convergence-map');
  });

  it('silently handles API errors', async () => {
    mockViewStateGet.mockRejectedValue(new Error('Network error'));

    await expect(restoreViewState('test-project')).resolves.toBeUndefined();
  });
});

describe('persistViewState', () => {
  it('sends current store state to backend', async () => {
    mockViewStatePut.mockResolvedValue({ ok: true });

    useUIStore.getState().setWorkspaceMode('scenes');
    useUIStore.getState().setScenesViewType('narrative');
    useStoryStore.getState().setCurrentChapterId('ch-1');

    await persistViewState('test-project');

    expect(mockViewStatePut).toHaveBeenCalledWith({
      current_chapter_id: 'ch-1',
      scroll_position: 0,
      workspace_mode: 'scenes',
      scenes_view_type: 'narrative',
    });
  });

  it('does nothing when project name is empty', async () => {
    await persistViewState('');
    expect(mockViewStatePut).not.toHaveBeenCalled();
  });

  it('silently handles API errors', async () => {
    mockViewStatePut.mockRejectedValue(new Error('Network error'));

    await expect(persistViewState('test-project')).resolves.toBeUndefined();
  });
});
