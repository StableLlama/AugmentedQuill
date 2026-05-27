// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Verify that first-run UI defaults are visible and guided.
 */

// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import { useChapterSuggestions } from '../features/chapters/useChapterSuggestions';
import { DEFAULT_LLM_CONFIG } from '../types';

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
});

describe('uiStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the AI chat panel by default on first launch', async () => {
    const { useUIStore, resetUIStore } = await import('./uiStore');

    resetUIStore();
    expect(useUIStore.getState().isChatOpen).toBe(true);
  });

  it('stores chapter ids for currently selected scenes', async () => {
    const { useUIStore, resetUIStore } = await import('./uiStore');

    resetUIStore();
    const chapterIds = new Set(['chapter-1', 'chapter-2']);
    useUIStore.getState().setSceneSelectionChapterIds(chapterIds);

    expect(useUIStore.getState().sceneSelectionChapterIds).toEqual(chapterIds);
  });
});

describe('useChapterSuggestions', () => {
  it('defaults suggest next paragraph mode to guided for first-run users', () => {
    const { result } = renderHook(() =>
      useChapterSuggestions({
        currentUnit: undefined,
        storyTitle: 'Story title',
        storySummary: 'Summary',
        storyStyleTags: [],
        activeWritingConfig: DEFAULT_LLM_CONFIG,
        isWritingAvailable: true,
        updateChapter: vi.fn().mockResolvedValue(undefined),
        viewMode: 'raw',
        getErrorMessage: (error: unknown) => String(error),
      })
    );

    expect(result.current.suggestionMode).toBe('guided');
  });
});
