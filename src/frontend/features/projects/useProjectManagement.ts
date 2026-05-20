// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the use project management unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { useCallback, useEffect, useState } from 'react';
import { ChatMessage, ProjectMetadata, StoryState } from '../../types';
import { api } from '../../services/api';
import { ProjectListItem } from '../../services/apiTypes';
import { mapSelectStoryToState } from '../story/storyMappers';
import { formatError, notifyError } from '../../services/errorNotifier';
import { useChatStore } from '../../stores/chatStore';

type CreateProjectType = 'short-story' | 'novel' | 'series';

type LoadProjectOptions = {
  preserveActiveChatSession?: boolean;
};

type UseProjectManagementParams = {
  storyId: string;
  storyTitle: string;
  storyProjectType: 'short-story' | 'novel' | 'series';
  storyLanguage: string;
  storySummary: string;
  storyStyleTags: string[];
  storyConflicts: StoryState['conflicts'];
  refreshStory: (historyLabel?: string, resetHistory?: boolean) => Promise<void>;
  loadStory: (story: StoryState) => void;
  updateStoryMetadata: (
    title: string,
    summary: string,
    tags: string[],
    notes?: string,
    private_notes?: string,
    conflicts?: StoryState['conflicts'],
    language?: string
  ) => Promise<void>;
  handleSelectChat: (id: string) => Promise<void>;
  handleNewChat: (incognito?: boolean) => void;
  getErrorMessage: (error: unknown, fallback: string) => string;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  recordHistoryEntry?: (entry: {
    label: string;
    onUndo?: () => Promise<void>;
    onRedo?: () => Promise<void>;
  }) => void;
};

const VALID_PROJECT_TYPES = ['short-story', 'novel', 'series'] as const;

const normalizeProjectType = (
  t: string | undefined
): 'short-story' | 'novel' | 'series' => {
  if (VALID_PROJECT_TYPES.includes(t as 'short-story' | 'novel' | 'series')) {
    return t as 'short-story' | 'novel' | 'series';
  }
  return 'novel';
};

const mapProjectsList = (
  projects: ProjectListItem[]
): {
  id: string;
  title: string;
  type: 'short-story' | 'novel' | 'series';
  updatedAt: number;
  language: string;
}[] =>
  projects.map(
    (
      project: ProjectListItem
    ): {
      id: string;
      title: string;
      type: 'short-story' | 'novel' | 'series';
      updatedAt: number;
      language: string;
    } => ({
      id: project.name,
      title: project.title || project.name,
      type: normalizeProjectType(project.type),
      updatedAt: Date.now(),
      language: project.language ?? 'en',
    })
  );

/** Custom React hook that manages project management. */
export function useProjectManagement({
  storyId,
  storyTitle,
  storyProjectType,
  storyLanguage,
  storySummary,
  storyStyleTags,
  storyConflicts,
  refreshStory,
  loadStory,
  updateStoryMetadata,
  handleSelectChat,
  handleNewChat,
  getErrorMessage,
  isSettingsOpen,
  setIsSettingsOpen,
  recordHistoryEntry,
}: UseProjectManagementParams): {
  projects: ProjectMetadata[];
  setProjects: import('react').Dispatch<
    import('react').SetStateAction<ProjectMetadata[]>
  >;
  refreshProjects: () => Promise<void>;
  isCreateProjectOpen: boolean;
  setIsCreateProjectOpen: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  instructionLanguages: string[];
  handleLoadProject: (id: string, options?: LoadProjectOptions) => Promise<void>;
  handleImportProject: (file: File) => Promise<void>;
  handleCreateProject: () => void;
  handleCreateProjectConfirm: (
    name: string,
    type: CreateProjectType,
    language?: string
  ) => Promise<void>;
  handleDeleteProject: (id: string) => Promise<void>;
  handleRenameProject: (id: string, newName: string, newLang?: string) => void;
} {
  const [projects, setProjects] = useState<ProjectMetadata[]>(() => {
    const saved = localStorage.getItem('augmentedquill_projects_meta');
    return saved
      ? JSON.parse(saved)
      : [{ id: storyId, title: storyTitle, updatedAt: Date.now() }];
  });
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [instructionLanguages, setInstructionLanguages] = useState<string[]>(['en']);

  const refreshProjects = useCallback(async (): Promise<void> => {
    try {
      const data = await api.projects.list();
      if (data.available) {
        const listedProjects = mapProjectsList(data.available);
        setProjects((prev: ProjectMetadata[]): ProjectMetadata[] => {
          const hasActiveStory = listedProjects.some(
            (project: {
              id: string;
              title: string;
              type: 'short-story' | 'novel' | 'series';
              updatedAt: number;
              language: string;
            }): boolean => project.id === storyId
          );
          if (hasActiveStory) {
            return listedProjects;
          }
          const activeFromPreviousState = prev.find(
            (project: ProjectMetadata): boolean => project.id === storyId
          );
          return activeFromPreviousState
            ? [...listedProjects, activeFromPreviousState]
            : listedProjects;
        });
      }
    } catch (error) {
      console.error('Failed to fetch projects', error);
    }
  }, [storyId]);

  useEffect((): void => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect((): void => {
    localStorage.setItem('augmentedquill_projects_meta', JSON.stringify(projects));
  }, [projects]);

  useEffect((): void => {
    if (!storyId) return;

    localStorage.setItem(
      `project_${storyId}`,
      JSON.stringify({
        id: storyId,
        title: storyTitle,
        projectType: storyProjectType,
        language: storyLanguage,
      })
    );
    setProjects((prev: ProjectMetadata[]): ProjectMetadata[] => {
      const exists = prev.find(
        (project: ProjectMetadata): boolean => project.id === storyId
      );
      const language = storyLanguage || 'en';
      if (
        exists &&
        exists.title === storyTitle &&
        exists.type === storyProjectType &&
        exists.language === language
      ) {
        return prev.map(
          (project: ProjectMetadata): ProjectMetadata =>
            project.id === storyId ? { ...project, updatedAt: Date.now() } : project
        );
      }
      if (exists) {
        return prev.map(
          (project: ProjectMetadata): ProjectMetadata =>
            project.id === storyId
              ? {
                  ...project,
                  title: storyTitle,
                  type: storyProjectType,
                  language,
                  updatedAt: Date.now(),
                }
              : project
        );
      }
      return [
        ...prev,
        {
          id: storyId,
          title: storyTitle,
          type: storyProjectType,
          language,
          updatedAt: Date.now(),
        },
      ];
    });
  }, [storyId, storyTitle, storyProjectType, storyLanguage]);

  const getActivePersistentChatSnapshot = useCallback((): {
    chatId: string;
    payload: {
      name: string;
      messages: unknown[];
      systemPrompt: string;
      allowWebSearch: boolean;
      scratchpad: string;
      projectContextRevision: number | null;
    };
  } | null => {
    const {
      currentChatId,
      chatMessages,
      systemPrompt,
      allowWebSearch,
      scratchpad,
      projectContextRevision,
      isIncognito,
    } = useChatStore.getState();

    if (!currentChatId || isIncognito) {
      return null;
    }

    const firstUserMessage = chatMessages.find(
      (message: ChatMessage): boolean => message.role === 'user'
    );
    const name = firstUserMessage?.text?.substring(0, 40) || 'Untitled Chat';

    return {
      chatId: currentChatId,
      payload: {
        name,
        messages: chatMessages,
        systemPrompt,
        allowWebSearch,
        scratchpad,
        projectContextRevision,
      },
    };
  }, []);

  const handleLoadProject = useCallback(
    async (id: string, options?: LoadProjectOptions): Promise<void> => {
      try {
        const shouldPreserveActiveChat =
          Boolean(options?.preserveActiveChatSession) && id !== storyId;
        let targetProjectId = id;

        if (shouldPreserveActiveChat) {
          try {
            const listing = await api.projects.list();
            const match = listing.available.find(
              (project: ProjectListItem): boolean =>
                project.name === id || project.title === id
            );
            if (match) {
              targetProjectId = match.name;
            }
          } catch (error) {
            console.warn('Failed to resolve canonical project id before switch', error);
          }
        }

        let carriedChatId: string | null = null;

        if (shouldPreserveActiveChat) {
          const snapshot = getActivePersistentChatSnapshot();
          if (snapshot) {
            carriedChatId = snapshot.chatId;

            // Flush current project chat state so the source project keeps the
            // partial history up to this switch point.
            try {
              await api
                .forProject(storyId)
                .chat.save(snapshot.chatId, snapshot.payload);
            } catch (error) {
              console.warn('Failed to flush source chat before project switch', error);
            }

            try {
              await api
                .forProject(targetProjectId)
                .chat.save(snapshot.chatId, snapshot.payload);
            } catch (error) {
              console.warn('Failed to duplicate chat into target project', error);
              carriedChatId = null;
            }
          }
        }

        const response = await api.projects.select(targetProjectId);
        if (!response.ok) return;

        await refreshStory(undefined, true);
        const chats = await api.chat.list();
        useChatStore.getState().setChatHistoryList(chats);
        if (
          carriedChatId &&
          chats.some(
            (chat: import('../../types').ChatSession): boolean =>
              chat.id === carriedChatId
          )
        ) {
          await handleSelectChat(carriedChatId);
          return;
        }
        if (chats.length > 0) {
          await handleSelectChat(chats[0].id);
        } else {
          handleNewChat();
        }
      } catch (error) {
        console.error('Failed to load project', error);
      }
    },
    [
      storyId,
      refreshStory,
      handleSelectChat,
      handleNewChat,
      getActivePersistentChatSnapshot,
    ]
  );

  const handleImportProject = useCallback(
    async (file: File): Promise<void> => {
      try {
        const previousActiveProjectId = storyId;
        const importedFileSnapshot = file;
        const knownProjectIds = new Set(
          projects.map((project: ProjectMetadata): string => project.id)
        );
        const response = await api.projects.import(file);
        if (response.ok) {
          // Fetch the full project listing (which includes title, type, language)
          // rather than using the minimal registry snapshot in the mutation response.
          const listing = await api.projects.list();
          setProjects(mapProjectsList(listing.available));

          const importedNameFromList = listing.available
            .map((project: ProjectListItem): string => project.name)
            .find((name: string): boolean => !knownProjectIds.has(name));
          const importedNameFromMessage =
            typeof response.message === 'string'
              ? response.message.match(/Imported as\s+(.+)$/)?.[1]?.trim()
              : undefined;
          const importedProjectName =
            importedNameFromList || importedNameFromMessage || null;

          if (importedProjectName) {
            recordHistoryEntry?.({
              label: `Import project: ${importedProjectName}`,
              onUndo: async (): Promise<void> => {
                await api.projects.delete(importedProjectName);
                await refreshProjects();
                if (previousActiveProjectId) {
                  await handleLoadProject(previousActiveProjectId);
                }
              },
              onRedo: async (): Promise<void> => {
                await api.projects.import(importedFileSnapshot);
                await refreshProjects();
                await handleLoadProject(importedProjectName);
              },
            });
          }
        }
      } catch (error) {
        notifyError(`Import failed: ${getErrorMessage(error, 'Unknown error')}`, error);
      }
    },
    [
      storyId,
      projects,
      recordHistoryEntry,
      refreshProjects,
      handleLoadProject,
      getErrorMessage,
    ]
  );

  const handleCreateProject = useCallback((): void => {
    setIsCreateProjectOpen(true);
  }, []);

  // gather languages from the instructions endpoint so the create dialog can
  // populate its dropdown
  useEffect((): void => {
    const loadLangs = async (): Promise<void> => {
      try {
        const data = await api.settings.getPrompts();
        if (data.languages) setInstructionLanguages(data.languages);
      } catch (e) {
        console.error('unable to load instruction languages', e);
        setInstructionLanguages(['en']);
      }
    };
    loadLangs();
  }, []);

  const handleCreateProjectConfirm = useCallback(
    async (
      name: string,
      type: CreateProjectType,
      language: string = 'en'
    ): Promise<void> => {
      try {
        const trimmedName = name.trim();
        const previousProjectId = storyId;
        const result = await api.projects.create(trimmedName, type, language);
        if (!result.ok) return;

        const listing = await api.projects.list();
        if (listing.available) {
          setProjects(mapProjectsList(listing.available));
        }

        if (result.story) {
          const mappedStory: StoryState = mapSelectStoryToState(
            trimmedName,
            result.story,
            (result.story.chapters ?? []).map(
              (
                chapter: import('../../types/api.generated').components['schemas']['StoryChapterSummary'],
                index: number
              ) => ({
                id: String(index + 1),
                title: chapter.title ?? '',
                summary: chapter.summary ?? '',
                content: '',
                filename: chapter.filename ?? undefined,
                book_id: chapter.book_id ?? undefined,
                notes: chapter.notes ?? undefined,
                private_notes: chapter.private_notes ?? undefined,
                conflicts: (chapter.conflicts ??
                  []) as import('../../types').Conflict[],
              })
            ),
            null,
            []
          );

          if (type === 'short-story') {
            mappedStory.draft = {
              id: 'story',
              scope: 'story',
              title: mappedStory.title,
              summary: mappedStory.summary,
              content: '',
              notes: mappedStory.notes,
              private_notes: mappedStory.private_notes,
              conflicts: mappedStory.conflicts,
              filename: 'content.md',
            };
            mappedStory.currentChapterId = null;
          }

          loadStory(mappedStory);
          handleNewChat(false);

          recordHistoryEntry?.({
            label: `Create project: ${trimmedName}`,
            onUndo: async (): Promise<void> => {
              await api.projects.delete(trimmedName);
              await refreshProjects();
              if (previousProjectId && previousProjectId !== trimmedName) {
                await handleLoadProject(previousProjectId);
              }
            },
            onRedo: async (): Promise<void> => {
              await api.projects.create(trimmedName, type, language);
              await refreshProjects();
              await handleLoadProject(trimmedName);
            },
          });
        }

        setIsCreateProjectOpen(false);
        if (isSettingsOpen) setIsSettingsOpen(false);
      } catch (error) {
        notifyError(`Failed to create project: ${formatError(error)}`, error);
      }
    },
    [
      storyId,
      loadStory,
      handleNewChat,
      refreshProjects,
      handleLoadProject,
      recordHistoryEntry,
      isSettingsOpen,
      setIsSettingsOpen,
    ]
  );

  const handleDeleteProject = useCallback(
    async (id: string): Promise<void> => {
      if (projects.length <= 1) return;

      try {
        let exported: Blob | null = null;
        try {
          exported = await api.projects.export(id);
        } catch (snapshotError) {
          console.warn('Project export snapshot failed before delete', snapshotError);
        }

        await api.projects.delete(id);
        const newProjects = projects.filter(
          (project: ProjectMetadata): boolean => project.id !== id
        );
        setProjects(newProjects);
        localStorage.removeItem(`project_${id}`);

        if (id === storyId && newProjects.length > 0) {
          await handleLoadProject(newProjects[0].id);
        }

        if (exported) {
          recordHistoryEntry?.({
            label: `Delete project: ${id}`,
            onUndo: async (): Promise<void> => {
              const snapshotFile = new File([exported as Blob], `${id}.zip`, {
                type: 'application/zip',
              });
              await api.projects.import(snapshotFile);
              await refreshProjects();
              await handleLoadProject(id);
            },
            onRedo: async (): Promise<void> => {
              await api.projects.delete(id);
              await refreshProjects();
            },
          });
        }
      } catch (error) {
        notifyError(
          `Failed to delete project: ${getErrorMessage(error, 'Unknown error')}`,
          error
        );
      }
    },
    [
      projects,
      storyId,
      handleLoadProject,
      refreshProjects,
      recordHistoryEntry,
      getErrorMessage,
    ]
  );

  const handleRenameProject = useCallback(
    (id: string, newName: string, newLang?: string): void => {
      if (id === storyId) {
        // if the active project is renamed, update story metadata
        updateStoryMetadata(
          newName,
          storySummary,
          storyStyleTags,
          undefined,
          undefined,
          storyConflicts,
          newLang
        );
        return;
      }

      setProjects((prev: ProjectMetadata[]): ProjectMetadata[] =>
        prev.map(
          (project: ProjectMetadata): ProjectMetadata =>
            project.id === id
              ? { ...project, title: newName, language: newLang || project.language }
              : project
        )
      );
      const saved = localStorage.getItem(`project_${id}`);
      if (!saved) return;
      const loaded = JSON.parse(saved);
      loaded.title = newName;
      if (newLang) loaded.language = newLang;
      localStorage.setItem(`project_${id}`, JSON.stringify(loaded));
    },
    [storyId, storySummary, storyStyleTags, storyConflicts, updateStoryMetadata]
  );

  return {
    projects,
    setProjects,
    refreshProjects,
    isCreateProjectOpen,
    setIsCreateProjectOpen,
    instructionLanguages,
    handleLoadProject,
    handleImportProject,
    handleCreateProject,
    handleCreateProjectConfirm,
    handleDeleteProject,
    handleRenameProject,
  };
}
