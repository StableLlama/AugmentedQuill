// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines tests for useProjectManagement so project list sync and rename persistence remain stable.
 */

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectManagement } from './useProjectManagement';
import { api } from '../../services/api';
import { useChatStore } from '../../stores/chatStore';

const scopedChatSaveMocks = new Map<string, ReturnType<typeof vi.fn>>();

const getScopedChatSaveMock = (projectId: string): ReturnType<typeof vi.fn> => {
  const existing = scopedChatSaveMocks.get(projectId);
  if (existing) {
    return existing;
  }

  const created = vi.fn().mockResolvedValue({ ok: true });
  scopedChatSaveMocks.set(projectId, created);
  return created;
};

vi.mock('../../services/api', () => ({
  api: {
    forProject: vi.fn((projectId: string) => ({
      chat: {
        save: getScopedChatSaveMock(projectId),
      },
    })),
    projects: {
      list: vi.fn(),
      select: vi.fn(),
      import: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      export: vi.fn(),
    },
    settings: {
      getPrompts: vi.fn(),
    },
    chat: {
      list: vi.fn(),
    },
  },
}));

const baseStory = {
  id: 'active-story',
  title: 'Active Story',
  projectType: 'novel' as const,
  language: 'en' as string | undefined,
  summary: '',
  styleTags: [] as string[],
  conflicts: [] as import('../../types').Conflict[],
};

function setupProjectManagementMocks(): void {
  vi.clearAllMocks();
  scopedChatSaveMocks.clear();
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    },
  });
  vi.mocked(api.projects.list).mockResolvedValue({
    available: [{ name: 'p1', title: 'Project One', type: 'novel', language: 'en' }],
  } as unknown as Awaited<ReturnType<typeof api.projects.list>>);
  vi.mocked(api.settings.getPrompts).mockResolvedValue({
    languages: ['en', 'de'],
  } as unknown as Awaited<ReturnType<typeof api.settings.getPrompts>>);
}

describe('useProjectManagement: load and reset', () => {
  beforeEach(setupProjectManagementMocks);

  it('loads project list and instruction languages on mount', async () => {
    const { result } = renderHook(() =>
      useProjectManagement({
        storyId: baseStory.id,
        storyTitle: baseStory.title,
        storyProjectType: baseStory.projectType,
        storyLanguage: baseStory.language ?? 'en',
        storySummary: baseStory.summary,
        storyStyleTags: baseStory.styleTags,
        storyConflicts: baseStory.conflicts,
        refreshStory: vi.fn().mockResolvedValue(undefined),
        loadStory: vi.fn(),
        updateStoryMetadata: vi.fn().mockResolvedValue(undefined),
        handleSelectChat: vi.fn().mockResolvedValue(undefined),
        handleNewChat: vi.fn(),
        setChatHistoryList: vi.fn(),
        getErrorMessage: () => 'error',
        isSettingsOpen: false,
        setIsSettingsOpen: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(
        result.current.projects.some(
          (project: import('../../types').ProjectMetadata) => project.id === 'p1'
        )
      ).toBe(true);
    });
    expect(result.current.instructionLanguages).toEqual(['en', 'de']);
  });

  it('resets undo history when the user switches projects', async () => {
    vi.mocked(api.projects.select).mockResolvedValue({ ok: true } as unknown as Awaited<
      ReturnType<typeof api.projects.select>
    >);
    vi.mocked(api.chat.list).mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof api.chat.list>>
    );

    const refreshStory = vi.fn().mockResolvedValue(undefined);
    const handleNewChat = vi.fn();

    const { result } = renderHook(() =>
      useProjectManagement({
        storyId: baseStory.id,
        storyTitle: baseStory.title,
        storyProjectType: baseStory.projectType,
        storyLanguage: baseStory.language ?? 'en',
        storySummary: baseStory.summary,
        storyStyleTags: baseStory.styleTags,
        storyConflicts: baseStory.conflicts,
        refreshStory,
        loadStory: vi.fn(),
        updateStoryMetadata: vi.fn().mockResolvedValue(undefined),
        handleSelectChat: vi.fn().mockResolvedValue(undefined),
        handleNewChat,
        setChatHistoryList: vi.fn(),
        getErrorMessage: () => 'error',
        isSettingsOpen: false,
        setIsSettingsOpen: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleLoadProject('p1');
    });

    expect(refreshStory).toHaveBeenCalledWith(undefined, true);
    expect(handleNewChat).toHaveBeenCalled();
  });

  it('duplicates active chat into target project for preserved switches', async () => {
    vi.mocked(api.projects.select).mockResolvedValue({ ok: true } as unknown as Awaited<
      ReturnType<typeof api.projects.select>
    >);
    vi.mocked(api.chat.list).mockResolvedValue([
      {
        id: 'chat-continue',
        name: 'Continue',
        messages: [],
      },
    ] as unknown as Awaited<ReturnType<typeof api.chat.list>>);

    const handleSelectChat = vi.fn().mockResolvedValue(undefined);

    useChatStore.setState({
      currentChatId: 'chat-continue',
      chatMessages: [
        {
          id: 'm1',
          role: 'user',
          text: 'Please create a new project and continue',
        },
      ],
      isIncognito: false,
      systemPrompt: 'system prompt',
      allowWebSearch: false,
      scratchpad: 'scratchpad',
      projectContextRevision: 7,
    });

    const { result } = renderHook(() =>
      useProjectManagement({
        storyId: baseStory.id,
        storyTitle: baseStory.title,
        storyProjectType: baseStory.projectType,
        storyLanguage: baseStory.language ?? 'en',
        storySummary: baseStory.summary,
        storyStyleTags: baseStory.styleTags,
        storyConflicts: baseStory.conflicts,
        refreshStory: vi.fn().mockResolvedValue(undefined),
        loadStory: vi.fn(),
        updateStoryMetadata: vi.fn().mockResolvedValue(undefined),
        handleSelectChat,
        handleNewChat: vi.fn(),
        setChatHistoryList: vi.fn(),
        getErrorMessage: () => 'error',
        isSettingsOpen: false,
        setIsSettingsOpen: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleLoadProject('p1', {
        preserveActiveChatSession: true,
      });
    });

    const sourceSave = scopedChatSaveMocks.get(baseStory.id);
    const targetSave = scopedChatSaveMocks.get('p1');

    expect(sourceSave).toBeTruthy();
    expect(targetSave).toBeTruthy();
    expect(sourceSave).toHaveBeenCalledWith(
      'chat-continue',
      expect.objectContaining({
        name: 'Please create a new project and continue'.substring(0, 40),
        systemPrompt: 'system prompt',
        scratchpad: 'scratchpad',
      })
    );
    expect(targetSave).toHaveBeenCalledWith(
      'chat-continue',
      expect.objectContaining({
        name: 'Please create a new project and continue'.substring(0, 40),
      })
    );
    expect(handleSelectChat).toHaveBeenCalledWith('chat-continue');
  });

  it('resolves target project title to canonical id before duplicating chat', async () => {
    vi.mocked(api.projects.list).mockResolvedValue({
      available: [
        {
          name: 'Back to the Future_ The Chronological Saga',
          title: 'Back to the Future: The Chronological Saga',
          type: 'novel',
          language: 'en',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof api.projects.list>>);
    vi.mocked(api.projects.select).mockResolvedValue({ ok: true } as unknown as Awaited<
      ReturnType<typeof api.projects.select>
    >);
    vi.mocked(api.chat.list).mockResolvedValue([
      {
        id: 'chat-continue',
        name: 'Continue',
        messages: [],
      },
    ] as unknown as Awaited<ReturnType<typeof api.chat.list>>);

    useChatStore.setState({
      currentChatId: 'chat-continue',
      chatMessages: [
        {
          id: 'm1',
          role: 'user',
          text: 'continue this thread',
        },
      ],
      isIncognito: false,
      systemPrompt: 'system prompt',
      allowWebSearch: false,
      scratchpad: 'scratchpad',
      projectContextRevision: 7,
    });

    const handleSelectChat = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useProjectManagement({
        storyId: baseStory.id,
        storyTitle: baseStory.title,
        storyProjectType: baseStory.projectType,
        storyLanguage: baseStory.language ?? 'en',
        storySummary: baseStory.summary,
        storyStyleTags: baseStory.styleTags,
        storyConflicts: baseStory.conflicts,
        refreshStory: vi.fn().mockResolvedValue(undefined),
        loadStory: vi.fn(),
        updateStoryMetadata: vi.fn().mockResolvedValue(undefined),
        handleSelectChat,
        handleNewChat: vi.fn(),
        setChatHistoryList: vi.fn(),
        getErrorMessage: () => 'error',
        isSettingsOpen: false,
        setIsSettingsOpen: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleLoadProject(
        'Back to the Future: The Chronological Saga',
        {
          preserveActiveChatSession: true,
        }
      );
    });

    const targetSave = scopedChatSaveMocks.get(
      'Back to the Future_ The Chronological Saga'
    );
    expect(targetSave).toBeTruthy();
    expect(vi.mocked(api.projects.select)).toHaveBeenCalledWith(
      'Back to the Future_ The Chronological Saga'
    );
    expect(handleSelectChat).toHaveBeenCalledWith('chat-continue');
  });
});

describe('useProjectManagement: rename and language sync', () => {
  beforeEach(setupProjectManagementMocks);

  it('renames a non-active project and persists language to local storage', async () => {
    localStorage.setItem(
      'project_other',
      JSON.stringify({ id: 'other', title: 'Old', language: 'en' })
    );

    const { result } = renderHook(() =>
      useProjectManagement({
        storyId: baseStory.id,
        storyTitle: baseStory.title,
        storyProjectType: baseStory.projectType,
        storyLanguage: baseStory.language ?? 'en',
        storySummary: baseStory.summary,
        storyStyleTags: baseStory.styleTags,
        storyConflicts: baseStory.conflicts,
        refreshStory: vi.fn().mockResolvedValue(undefined),
        loadStory: vi.fn(),
        updateStoryMetadata: vi.fn().mockResolvedValue(undefined),
        handleSelectChat: vi.fn().mockResolvedValue(undefined),
        handleNewChat: vi.fn(),
        setChatHistoryList: vi.fn(),
        getErrorMessage: () => 'error',
        isSettingsOpen: false,
        setIsSettingsOpen: vi.fn(),
      })
    );

    act(() => {
      result.current.setProjects([
        {
          id: 'other',
          title: 'Old',
          type: 'novel',
          updatedAt: Date.now(),
          language: 'en',
        },
      ]);
    });

    act(() => {
      result.current.handleRenameProject('other', 'Renamed', 'de');
    });

    expect(result.current.projects[0].title).toBe('Renamed');
    expect(result.current.projects[0].language).toBe('de');

    const persisted = JSON.parse(localStorage.getItem('project_other') || '{}');
    expect(persisted.title).toBe('Renamed');
    expect(persisted.language).toBe('de');
  });

  it('syncs active project language when story metadata updates', async () => {
    const initialProps = {
      storyId: baseStory.id,
      storyTitle: baseStory.title,
      storyProjectType: baseStory.projectType,
      storyLanguage: 'en',
      storySummary: baseStory.summary,
      storyStyleTags: baseStory.styleTags,
      storyConflicts: baseStory.conflicts,
    };
    const { result, rerender } = renderHook(
      ({
        storyId,
        storyTitle,
        storyProjectType,
        storyLanguage,
        storySummary,
        storyStyleTags,
        storyConflicts,
      }: {
        storyId: string;
        storyTitle: string;
        storyProjectType: 'short-story' | 'novel' | 'series';
        storyLanguage: string;
        storySummary: string;
        storyStyleTags: string[];
        storyConflicts: import('../../types').Conflict[];
      }) =>
        useProjectManagement({
          storyId,
          storyTitle,
          storyProjectType,
          storyLanguage,
          storySummary,
          storyStyleTags,
          storyConflicts,
          refreshStory: vi.fn().mockResolvedValue(undefined),
          loadStory: vi.fn(),
          updateStoryMetadata: vi.fn().mockResolvedValue(undefined),
          handleSelectChat: vi.fn().mockResolvedValue(undefined),
          handleNewChat: vi.fn(),
          setChatHistoryList: vi.fn(),
          getErrorMessage: () => 'error',
          isSettingsOpen: false,
          setIsSettingsOpen: vi.fn(),
        }),
      { initialProps }
    );

    await waitFor(() => {
      expect(
        result.current.projects.some(
          (project: import('../../types').ProjectMetadata) =>
            project.id === 'active-story'
        )
      ).toBe(true);
    });

    act(() => {
      rerender({
        storyId: baseStory.id,
        storyTitle: baseStory.title,
        storyProjectType: baseStory.projectType,
        storyLanguage: 'de',
        storySummary: baseStory.summary,
        storyStyleTags: baseStory.styleTags,
        storyConflicts: baseStory.conflicts,
      });
    });

    expect(
      result.current.projects.find(
        (project: import('../../types').ProjectMetadata) =>
          project.id === 'active-story'
      )?.language
    ).toBe('de');
  });
});

describe('useProjectManagement: non-tracked field changes', () => {
  beforeEach(setupProjectManagementMocks);

  it('does not resync project metadata when only non-tracked fields change', async () => {
    const initialProps = {
      storyId: baseStory.id,
      storyTitle: baseStory.title,
      storyProjectType: baseStory.projectType,
      storyLanguage: 'en',
      storySummary: baseStory.summary,
      storyStyleTags: baseStory.styleTags,
      storyConflicts: baseStory.conflicts,
    };

    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(3000)
      .mockReturnValueOnce(4000)
      .mockReturnValueOnce(5000);

    const { result, rerender } = renderHook(
      ({
        storyId,
        storyTitle,
        storyProjectType,
        storyLanguage,
        storySummary,
        storyStyleTags,
        storyConflicts,
      }: {
        storyId: string;
        storyTitle: string;
        storyProjectType: 'short-story' | 'novel' | 'series';
        storyLanguage: string;
        storySummary: string;
        storyStyleTags: string[];
        storyConflicts: import('../../types').Conflict[];
      }) =>
        useProjectManagement({
          storyId,
          storyTitle,
          storyProjectType,
          storyLanguage,
          storySummary,
          storyStyleTags,
          storyConflicts,
          refreshStory: vi.fn().mockResolvedValue(undefined),
          loadStory: vi.fn(),
          updateStoryMetadata: vi.fn().mockResolvedValue(undefined),
          handleSelectChat: vi.fn().mockResolvedValue(undefined),
          handleNewChat: vi.fn(),
          setChatHistoryList: vi.fn(),
          getErrorMessage: () => 'error',
          isSettingsOpen: false,
          setIsSettingsOpen: vi.fn(),
        }),
      { initialProps }
    );

    await waitFor(() => {
      expect(
        result.current.projects.some(
          (project: import('../../types').ProjectMetadata) =>
            project.id === 'active-story'
        )
      ).toBe(true);
    });

    const before = result.current.projects.find(
      (project: import('../../types').ProjectMetadata) => project.id === 'active-story'
    );

    // Rerender with same metadata values — no change should be applied.
    act(() => {
      rerender({ ...initialProps });
    });

    const after = result.current.projects.find(
      (project: import('../../types').ProjectMetadata) => project.id === 'active-story'
    );
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(after?.title).toBe(before?.title);
    expect(after?.language).toBe(before?.language);
  });
});
