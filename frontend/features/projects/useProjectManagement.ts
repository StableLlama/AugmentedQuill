// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the use project management unit so this responsibility stays isolated, testable, and easy to evolve.

import { useCallback, useEffect, useState } from 'react';
import { StoryState, ProjectMetadata, ChatSession } from '../../types';
import { api } from '../../services/api';
import { ProjectListItem } from '../../services/apiTypes';
import { mapSelectStoryToState } from '../story/storyMappers';

type CreateProjectType = 'short-story' | 'novel' | 'series';

type UseProjectManagementParams = {
  story: StoryState;
  refreshStory: () => Promise<void>;
  loadStory: (story: StoryState) => void;
  updateStoryMetadata: (
    title: string,
    summary: string,
    tags: string[]
  ) => Promise<void>;
  handleSelectChat: (id: string) => Promise<void>;
  handleNewChat: (incognito?: boolean) => void;
  setChatHistoryList: (list: ChatSession[]) => void;
  getErrorMessage: (error: unknown, fallback: string) => string;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
};

export function useProjectManagement({
  story,
  refreshStory,
  loadStory,
  updateStoryMetadata,
  handleSelectChat,
  handleNewChat,
  setChatHistoryList,
  getErrorMessage,
  isSettingsOpen,
  setIsSettingsOpen,
}: UseProjectManagementParams) {
  const [projects, setProjects] = useState<ProjectMetadata[]>(() => {
    const saved = localStorage.getItem('augmentedquill_projects_meta');
    return saved
      ? JSON.parse(saved)
      : [{ id: story.id, title: story.title, updatedAt: Date.now() }];
  });
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);

  const refreshProjects = useCallback(async () => {
    try {
      const data = await api.projects.list();
      if (data.available) {
        setProjects(
          data.available.map((project: ProjectListItem) => ({
            id: project.name,
            title: project.title || project.name,
            type: project.type || 'novel',
            updatedAt: Date.now(),
          }))
        );
      }
    } catch (error) {
      console.error('Failed to fetch projects', error);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    localStorage.setItem('augmentedquill_projects_meta', JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    if (!story || !story.id) return;

    localStorage.setItem(`project_${story.id}`, JSON.stringify(story));
    setProjects((prev) => {
      const exists = prev.find((project) => project.id === story.id);
      if (exists && exists.title === story.title && exists.type === story.projectType) {
        return prev.map((project) =>
          project.id === story.id ? { ...project, updatedAt: Date.now() } : project
        );
      }
      if (exists) {
        return prev.map((project) =>
          project.id === story.id
            ? {
                ...project,
                title: story.title,
                type: story.projectType,
                updatedAt: Date.now(),
              }
            : project
        );
      }
      return [
        ...prev,
        {
          id: story.id,
          title: story.title,
          type: story.projectType,
          updatedAt: Date.now(),
        },
      ];
    });
  }, [
    story.id,
    story.title,
    story.projectType,
    story.chapters,
    story.summary,
    story.styleTags,
  ]);

  const handleLoadProject = useCallback(
    async (id: string) => {
      try {
        const response = await api.projects.select(id);
        if (!response.ok) return;

        await refreshStory();
        const chats = await api.chat.list();
        setChatHistoryList(chats);
        if (chats.length > 0) {
          await handleSelectChat(chats[0].id);
        } else {
          handleNewChat();
        }
      } catch (error) {
        console.error('Failed to load project', error);
      }
    },
    [refreshStory, setChatHistoryList, handleSelectChat, handleNewChat]
  );

  const handleImportProject = useCallback(
    async (file: File) => {
      try {
        const response = await api.projects.import(file);
        if (response.ok && response.available) {
          setProjects(
            response.available.map((project: ProjectListItem) => ({
              id: project.name,
              title: project.title || project.name,
              type: project.type || 'novel',
              updatedAt: Date.now(),
            }))
          );
        }
      } catch (error) {
        console.error(error);
        alert(`Import failed: ${getErrorMessage(error, 'Unknown error')}`);
      }
    },
    [getErrorMessage]
  );

  const handleCreateProject = useCallback(() => {
    setIsCreateProjectOpen(true);
  }, []);

  const handleCreateProjectConfirm = useCallback(
    async (name: string, type: CreateProjectType) => {
      try {
        const result = await api.projects.create(name, type);
        if (!result.ok) return;

        const listing = await api.projects.list();
        if (listing.projects) {
          setProjects(
            listing.projects.map((project: ProjectListItem) => ({
              id: project.name,
              title: project.title || project.name,
              updatedAt: Date.now(),
            }))
          );
        }

        if (result.story) {
          const mappedStory: StoryState = mapSelectStoryToState(
            name,
            result.story,
            (result.story.chapters || []).map((chapter, index) => ({
              id: String(index + 1),
              title: chapter.title || '',
              summary: chapter.summary || '',
              content: '',
              filename: chapter.filename,
              book_id: chapter.book_id,
              notes: chapter.notes,
              private_notes: chapter.private_notes,
              conflicts: chapter.conflicts,
            })),
            null,
            []
          );

          if (type === 'short-story' && mappedStory.chapters.length === 0) {
            mappedStory.chapters = [
              {
                id: '1',
                title: mappedStory.title,
                summary: '',
                content: '',
              },
            ];
            mappedStory.currentChapterId = '1';
          }

          loadStory(mappedStory);
          handleNewChat(false);
        }

        setIsCreateProjectOpen(false);
        if (isSettingsOpen) setIsSettingsOpen(false);
      } catch (error) {
        console.error('Failed to create project', error);
        alert(`Failed to create project: ${error}`);
      }
    },
    [loadStory, handleNewChat, isSettingsOpen, setIsSettingsOpen]
  );

  const handleDeleteProject = useCallback(
    async (id: string) => {
      if (projects.length <= 1) return;

      try {
        await api.projects.delete(id);
        const newProjects = projects.filter((project) => project.id !== id);
        setProjects(newProjects);
        localStorage.removeItem(`project_${id}`);

        if (id === story.id && newProjects.length > 0) {
          await handleLoadProject(newProjects[0].id);
        }
      } catch (error) {
        console.error('Failed to delete project', error);
        alert(`Failed to delete project: ${getErrorMessage(error, 'Unknown error')}`);
      }
    },
    [projects, story.id, handleLoadProject, getErrorMessage]
  );

  const handleRenameProject = useCallback(
    (id: string, newName: string) => {
      if (id === story.id) {
        updateStoryMetadata(newName, story.summary, story.styleTags);
        return;
      }

      setProjects((prev) =>
        prev.map((project) =>
          project.id === id ? { ...project, title: newName } : project
        )
      );
      const saved = localStorage.getItem(`project_${id}`);
      if (!saved) return;
      const loaded = JSON.parse(saved);
      loaded.title = newName;
      localStorage.setItem(`project_${id}`, JSON.stringify(loaded));
    },
    [story.id, story.summary, story.styleTags, updateStoryMetadata]
  );

  return {
    projects,
    setProjects,
    refreshProjects,
    isCreateProjectOpen,
    setIsCreateProjectOpen,
    handleLoadProject,
    handleImportProject,
    handleCreateProject,
    handleCreateProjectConfirm,
    handleDeleteProject,
    handleRenameProject,
  };
}
