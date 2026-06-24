// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the api unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { machineApi } from './apiClients/machine';
import { projectsApi } from './apiClients/projects';
import { createBooksApi } from './apiClients/books';
import { createChaptersApi } from './apiClients/chapters';
import { createStoryApi } from './apiClients/story';
import { createSettingsApi } from './apiClients/settings';
import { createChatApi } from './apiClients/chat';
import { createSourcebookApi } from './apiClients/sourcebook';
import { debugApi } from './apiClients/debug';
import { createCheckpointsApi } from './apiClients/checkpoints';
import { createSearchApi } from './apiClients/search';
import { createScenesApi } from './apiClients/scenes';
import { createAnnotationsApi } from './apiClients/annotations';
import { createViewStateApi } from './apiClients/viewState';
import { useStoryStore } from '../stores/storyStore';

type ProjectApiClients = {
  books: ReturnType<typeof createBooksApi>;
  chapters: ReturnType<typeof createChaptersApi>;
  story: ReturnType<typeof createStoryApi>;
  settings: ReturnType<typeof createSettingsApi>;
  chat: ReturnType<typeof createChatApi>;
  sourcebook: ReturnType<typeof createSourcebookApi>;
  checkpoints: ReturnType<typeof createCheckpointsApi>;
  search: ReturnType<typeof createSearchApi>;
  scenes: ReturnType<typeof createScenesApi>;
  annotations: ReturnType<typeof createAnnotationsApi>;
  viewState: ReturnType<typeof createViewStateApi>;
};

const projectApiCache = new Map<string, ProjectApiClients>();
const unscopedSettingsApi = createSettingsApi('');
const unscopedChaptersApi = createChaptersApi('');
const unscopedStoryApi = createStoryApi('');

function getCurrentProjectName(): string {
  return useStoryStore.getState().story.id;
}

function requireCurrentProjectName(): string {
  const projectName = getCurrentProjectName();
  if (!projectName) {
    throw new Error('No active project selected');
  }
  return projectName;
}

function forProject(projectName: string): ProjectApiClients {
  const cached = projectApiCache.get(projectName);
  if (cached) return cached;

  const scoped: ProjectApiClients = {
    books: createBooksApi(projectName),
    chapters: createChaptersApi(projectName),
    story: createStoryApi(projectName),
    settings: createSettingsApi(projectName),
    chat: createChatApi(projectName),
    sourcebook: createSourcebookApi(projectName),
    checkpoints: createCheckpointsApi(projectName),
    search: createSearchApi(projectName),
    scenes: createScenesApi(projectName),
    annotations: createAnnotationsApi(projectName),
    viewState: createViewStateApi(projectName),
  };
  projectApiCache.set(projectName, scoped);
  return scoped;
}

const currentProjectApi = (): ProjectApiClients =>
  forProject(requireCurrentProjectName());

export const api = {
  forProject,
  machine: machineApi,
  projects: projectsApi,
  books: {
    create: (...args: Parameters<ProjectApiClients['books']['create']>) =>
      currentProjectApi().books.create(...args),
    delete: (...args: Parameters<ProjectApiClients['books']['delete']>) =>
      currentProjectApi().books.delete(...args),
    restore: (...args: Parameters<ProjectApiClients['books']['restore']>) =>
      currentProjectApi().books.restore(...args),
    reorder: (
      ...args: Parameters<ProjectApiClients['books']['reorder']>
    ): Promise<{ ok: boolean }> => currentProjectApi().books.reorder(...args),
    updateBookMetadata: (
      ...args: Parameters<ProjectApiClients['books']['updateBookMetadata']>
    ): Promise<{ ok: boolean; detail?: string | undefined }> =>
      currentProjectApi().books.updateBookMetadata(...args),
  },
  chapters: {
    list: (...args: Parameters<ProjectApiClients['chapters']['list']>) =>
      getCurrentProjectName()
        ? currentProjectApi().chapters.list(...args)
        : unscopedChaptersApi.list(...args),
    get: (...args: Parameters<ProjectApiClients['chapters']['get']>) =>
      currentProjectApi().chapters.get(...args),
    create: (
      ...args: Parameters<ProjectApiClients['chapters']['create']>
    ): Promise<{
      ok: boolean;
      id: number;
      title: string;
      book_id?: string | undefined;
    }> => currentProjectApi().chapters.create(...args),
    updateContent: (
      ...args: Parameters<ProjectApiClients['chapters']['updateContent']>
    ): Promise<{ ok: boolean }> => currentProjectApi().chapters.updateContent(...args),
    updateTitle: (
      ...args: Parameters<ProjectApiClients['chapters']['updateTitle']>
    ): Promise<{ ok: boolean }> => currentProjectApi().chapters.updateTitle(...args),
    updateSummary: (
      ...args: Parameters<ProjectApiClients['chapters']['updateSummary']>
    ): Promise<{ ok: boolean }> => currentProjectApi().chapters.updateSummary(...args),
    updateMetadata: (
      ...args: Parameters<ProjectApiClients['chapters']['updateMetadata']>
    ): Promise<{
      ok: boolean;
      id?: number | undefined;
      message?: string | undefined;
    }> => currentProjectApi().chapters.updateMetadata(...args),
    delete: (
      ...args: Parameters<ProjectApiClients['chapters']['delete']>
    ): Promise<{ ok: boolean }> => currentProjectApi().chapters.delete(...args),
    reorder: (
      ...args: Parameters<ProjectApiClients['chapters']['reorder']>
    ): Promise<{ ok: boolean }> => currentProjectApi().chapters.reorder(...args),
  },
  story: {
    updateTitle: (
      ...args: Parameters<ProjectApiClients['story']['updateTitle']>
    ): Promise<{ ok: boolean; detail?: string | undefined }> =>
      currentProjectApi().story.updateTitle(...args),
    updateSummary: (
      ...args: Parameters<ProjectApiClients['story']['updateSummary']>
    ): Promise<{ ok: boolean; summary?: string | undefined }> =>
      currentProjectApi().story.updateSummary(...args),
    updateTags: (
      ...args: Parameters<ProjectApiClients['story']['updateTags']>
    ): Promise<{ ok: boolean }> => currentProjectApi().story.updateTags(...args),
    updateSettings: (
      ...args: Parameters<ProjectApiClients['story']['updateSettings']>
    ): Promise<{ ok: boolean; story?: unknown }> =>
      currentProjectApi().story.updateSettings(...args),
    updateMetadata: (
      ...args: Parameters<ProjectApiClients['story']['updateMetadata']>
    ): Promise<{ ok: boolean; detail?: string | undefined }> =>
      currentProjectApi().story.updateMetadata(...args),
    getContent: (
      ...args: Parameters<ProjectApiClients['story']['getContent']>
    ): Promise<{ ok: boolean; content: string }> =>
      getCurrentProjectName()
        ? currentProjectApi().story.getContent(...args)
        : unscopedStoryApi.getContent(...args),
    updateContent: (
      ...args: Parameters<ProjectApiClients['story']['updateContent']>
    ): Promise<{ ok: boolean }> => currentProjectApi().story.updateContent(...args),
    computeSourcebookRelevance: (
      ...args: Parameters<ProjectApiClients['story']['computeSourcebookRelevance']>
    ): Promise<{ relevant: string[] }> =>
      currentProjectApi().story.computeSourcebookRelevance(...args),
  },
  settings: {
    getPrompts: (...args: Parameters<ProjectApiClients['settings']['getPrompts']>) =>
      getCurrentProjectName()
        ? currentProjectApi().settings.getPrompts(...args)
        : unscopedSettingsApi.getPrompts(...args),
  },
  chat: {
    list: (...args: Parameters<ProjectApiClients['chat']['list']>) =>
      currentProjectApi().chat.list(...args),
    load: (...args: Parameters<ProjectApiClients['chat']['load']>) =>
      currentProjectApi().chat.load(...args),
    save: (
      ...args: Parameters<ProjectApiClients['chat']['save']>
    ): Promise<{ ok: boolean }> => currentProjectApi().chat.save(...args),
    delete: (
      ...args: Parameters<ProjectApiClients['chat']['delete']>
    ): Promise<{ ok: boolean }> => currentProjectApi().chat.delete(...args),
    deleteAll: (
      ...args: Parameters<ProjectApiClients['chat']['deleteAll']>
    ): Promise<{ ok: boolean }> => currentProjectApi().chat.deleteAll(...args),
    executeTools: (...args: Parameters<ProjectApiClients['chat']['executeTools']>) =>
      currentProjectApi().chat.executeTools(...args),
    undoToolBatch: (
      ...args: Parameters<ProjectApiClients['chat']['undoToolBatch']>
    ): Promise<{
      ok: boolean;
      batch_id?: string | null | undefined;
      detail?: string | null | undefined;
    }> => currentProjectApi().chat.undoToolBatch(...args),
    redoToolBatch: (
      ...args: Parameters<ProjectApiClients['chat']['redoToolBatch']>
    ): Promise<{
      ok: boolean;
      batch_id?: string | null | undefined;
      detail?: string | null | undefined;
    }> => currentProjectApi().chat.redoToolBatch(...args),
    getChapterBeforeContent: (
      ...args: Parameters<ProjectApiClients['chat']['getChapterBeforeContent']>
    ): Promise<string | null> =>
      currentProjectApi().chat.getChapterBeforeContent(...args),
  },
  sourcebook: {
    list: (...args: Parameters<ProjectApiClients['sourcebook']['list']>) =>
      currentProjectApi().sourcebook.list(...args),
    create: (...args: Parameters<ProjectApiClients['sourcebook']['create']>) =>
      currentProjectApi().sourcebook.create(...args),
    update: (...args: Parameters<ProjectApiClients['sourcebook']['update']>) =>
      currentProjectApi().sourcebook.update(...args),
    delete: (
      ...args: Parameters<ProjectApiClients['sourcebook']['delete']>
    ): Promise<{ ok: boolean }> => currentProjectApi().sourcebook.delete(...args),
    generateKeywords: (
      ...args: Parameters<ProjectApiClients['sourcebook']['generateKeywords']>
    ): Promise<{ keywords: string[] }> =>
      currentProjectApi().sourcebook.generateKeywords(...args),
  },
  debug: debugApi,
  checkpoints: {
    list: (...args: Parameters<ProjectApiClients['checkpoints']['list']>) =>
      currentProjectApi().checkpoints.list(...args),
    create: (
      ...args: Parameters<ProjectApiClients['checkpoints']['create']>
    ): Promise<{ ok: boolean; timestamp: string }> =>
      currentProjectApi().checkpoints.create(...args),
    load: (
      ...args: Parameters<ProjectApiClients['checkpoints']['load']>
    ): Promise<{ ok: boolean }> => currentProjectApi().checkpoints.load(...args),
    delete: (
      ...args: Parameters<ProjectApiClients['checkpoints']['delete']>
    ): Promise<{ ok: boolean }> => currentProjectApi().checkpoints.delete(...args),
  },
  search: {
    search: (...args: Parameters<ProjectApiClients['search']['search']>) =>
      currentProjectApi().search.search(...args),
    replaceAll: (...args: Parameters<ProjectApiClients['search']['replaceAll']>) =>
      currentProjectApi().search.replaceAll(...args),
    replaceSingle: (
      ...args: Parameters<ProjectApiClients['search']['replaceSingle']>
    ) => currentProjectApi().search.replaceSingle(...args),
  },
  scenes: {
    list: (...args: Parameters<ProjectApiClients['scenes']['list']>) =>
      currentProjectApi().scenes.list(...args),
    create: (...args: Parameters<ProjectApiClients['scenes']['create']>) =>
      currentProjectApi().scenes.create(...args),
    get: (...args: Parameters<ProjectApiClients['scenes']['get']>) =>
      currentProjectApi().scenes.get(...args),
    update: (...args: Parameters<ProjectApiClients['scenes']['update']>) =>
      currentProjectApi().scenes.update(...args),
    delete: (...args: Parameters<ProjectApiClients['scenes']['delete']>) =>
      currentProjectApi().scenes.delete(...args),
    linkProse: (...args: Parameters<ProjectApiClients['scenes']['linkProse']>) =>
      currentProjectApi().scenes.linkProse(...args),
    unlinkProse: (...args: Parameters<ProjectApiClients['scenes']['unlinkProse']>) =>
      currentProjectApi().scenes.unlinkProse(...args),
    reorderProse: (...args: Parameters<ProjectApiClients['scenes']['reorderProse']>) =>
      currentProjectApi().scenes.reorderProse(...args),
    updateProseContent: (
      ...args: Parameters<ProjectApiClients['scenes']['updateProseContent']>
    ) => currentProjectApi().scenes.updateProseContent(...args),
    detectBoundaries: (
      ...args: Parameters<ProjectApiClients['scenes']['detectBoundaries']>
    ) => currentProjectApi().scenes.detectBoundaries(...args),
    autoLinkScope: (
      ...args: Parameters<ProjectApiClients['scenes']['autoLinkScope']>
    ) => currentProjectApi().scenes.autoLinkScope(...args),
    writeScene: (...args: Parameters<ProjectApiClients['scenes']['writeScene']>) =>
      currentProjectApi().scenes.writeScene(...args),
  },
  annotations: {
    list: (...args: Parameters<ProjectApiClients['annotations']['list']>) =>
      currentProjectApi().annotations.list(...args),
    create: (...args: Parameters<ProjectApiClients['annotations']['create']>) =>
      currentProjectApi().annotations.create(...args),
    update: (...args: Parameters<ProjectApiClients['annotations']['update']>) =>
      currentProjectApi().annotations.update(...args),
    remove: (...args: Parameters<ProjectApiClients['annotations']['remove']>) =>
      currentProjectApi().annotations.remove(...args),
  },
};
