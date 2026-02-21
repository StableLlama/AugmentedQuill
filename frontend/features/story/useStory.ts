// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the use story unit so this responsibility stays isolated, testable, and easy to evolve.

import { useState, useCallback, useEffect, useRef } from 'react';
import { StoryState, Chapter, Book } from '../../types';
import { api } from '../../services/api';
import { mapApiChapters, mapSelectStoryToState } from './storyMappers';

/** Maximum number of undo/redo states retained in memory. */
const MAX_HISTORY = 50;

/**
 * Injectable dialog callbacks for useStory.
 * Defaults use window.confirm / window.alert, which can be replaced in tests
 * or by a React-based dialog system in App.tsx.
 */
export interface StoryDialogs {
  confirm: (message: string) => Promise<boolean>;
  alert: (message: string) => void;
}

const defaultDialogs: StoryDialogs = {
  confirm: (message) => Promise.resolve(window.confirm(message)),
  alert: (message) => window.alert(message),
};

const INITIAL_STORY: StoryState = {
  id: '',
  title: '',
  summary: '',
  styleTags: [],
  image_style: '',
  image_additional_info: '',
  chapters: [],
  projectType: 'novel',
  books: [],
  sourcebook: [],
  conflicts: [],
  currentChapterId: null,
  lastUpdated: Date.now(),
};

export const useStory = (dialogs: StoryDialogs = defaultDialogs) => {
  const [story, setStory] = useState<StoryState>(INITIAL_STORY);
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [history, setHistory] = useState<StoryState[]>([INITIAL_STORY]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const hasFetchedRef = useRef(false);
  // Hold dialog callbacks in a ref so refreshStory callbacks never go stale.
  const dialogsRef = useRef(dialogs);
  useEffect(() => {
    dialogsRef.current = dialogs;
  });

  const pushState = useCallback(
    (newState: StoryState) => {
      const updatedState = { ...newState, lastUpdated: Date.now() };
      const trimmed = history.slice(0, currentIndex + 1);
      trimmed.push(updatedState);
      const bounded = trimmed.slice(-MAX_HISTORY);
      setHistory(bounded);
      setCurrentIndex(bounded.length - 1);
      setStory(updatedState);
    },
    [history, currentIndex]
  );

  const refreshStory = useCallback(async () => {
    try {
      const projects = await api.projects.list();
      const currentProject = projects.current || story.id;
      if (!currentProject) return;

      const res = await api.projects.select(currentProject);
      if (res.error === 'version_outdated') {
        // Block normal loading so schema transitions are explicit and recoverable.
        const shouldUpdate = await dialogsRef.current.confirm(
          `The story config is outdated (version ${res.current_version}). Current version is ${res.required_version}. Do you want to update it?`
        );
        if (shouldUpdate) {
          try {
            const updateRes = await api.projects.updateConfig();
            if (updateRes.ok) {
              // Reload immediately to ensure local state reflects migrated structure.
              const res2 = await api.projects.select(currentProject);
              if (res2.ok && res2.story) {
                const chaptersRes = await api.chapters.list();
                const chapters: Chapter[] = mapApiChapters(chaptersRes.chapters);

                const newStory: StoryState = mapSelectStoryToState(
                  currentProject,
                  res2.story,
                  chapters,
                  currentChapterId,
                  story.chapters
                );

                setStory(newStory);
                setCurrentChapterId(newStory.currentChapterId);
              } else if (res2.error) {
                if (res2.error === 'invalid_config') {
                  dialogsRef.current.alert(
                    `Invalid story config: ${res2.error_message}`
                  );
                } else {
                  dialogsRef.current.alert(
                    `Failed to load story after update: ${res2.error}`
                  );
                }
              }
            } else {
              dialogsRef.current.alert(`Failed to update config: ${updateRes.detail}`);
            }
          } catch (e) {
            dialogsRef.current.alert(`Failed to update config: ${e}`);
          }
        }
        return;
      } else if (res.error === 'invalid_config') {
        dialogsRef.current.alert(`Invalid story config: ${res.error_message}`);
        return;
      } else if (res.ok && res.story) {
        const chaptersRes = await api.chapters.list();
        const chapters: Chapter[] = mapApiChapters(chaptersRes.chapters);

        const newStory: StoryState = mapSelectStoryToState(
          currentProject,
          res.story,
          chapters,
          currentChapterId,
          story.chapters
        );

        setStory(newStory);
        setCurrentChapterId(newStory.currentChapterId);
      }
    } catch (e) {
      console.error('Failed to refresh story', e);
    }
  }, [story.id, currentChapterId]);

  const selectChapter = useCallback((id: string | null) => {
    setCurrentChapterId(id);
  }, []);

  // Load chapter content lazily so list refreshes stay responsive.
  useEffect(() => {
    if (currentChapterId) {
      const loadContent = async () => {
        try {
          const res = await api.chapters.get(Number(currentChapterId));
          setStory((prev) => {
            const updatedChapters = prev.chapters.map((c) =>
              c.id === currentChapterId
                ? {
                    ...c,
                    content: res.content,
                    notes: res.notes,
                    private_notes: res.private_notes,
                    conflicts: res.conflicts,
                    title: res.title,
                    summary: res.summary,
                  }
                : c
            );
            return { ...prev, chapters: updatedChapters };
          });
        } catch (e) {
          console.error('Failed to load chapter content', e);
        }
      };
      loadContent();
    }
  }, [currentChapterId, story.lastUpdated]);

  const fetchStory = useCallback(async () => {
    if (story.id) return;
    try {
      const projects = await api.projects.list();
      if (projects.current) {
        const res = await api.projects.select(projects.current);
        if (res.ok && res.story) {
          const chaptersRes = await api.chapters.list();
          const chapters = mapApiChapters(chaptersRes.chapters);

          const newStory: StoryState = {
            id: projects.current,
            title: res.story.project_title || projects.current,
            summary: res.story.story_summary || '',
            styleTags: res.story.tags || [],
            image_style: res.story.image_style || '',
            image_additional_info: res.story.image_additional_info || '',
            chapters: chapters,
            projectType: res.story.project_type || 'novel',
            books: res.story.books || [],
            sourcebook: res.story.sourcebook || [],
            conflicts: res.story.conflicts || [],
            currentChapterId: chapters.length > 0 ? chapters[0].id : null,
            lastUpdated: Date.now(),
          };

          setStory(newStory);
          setHistory([newStory]);
          setCurrentIndex(0);

          setCurrentChapterId(newStory.currentChapterId);
        }
      }
    } catch (e) {
      console.error('Failed to fetch story', e);
    }
  }, []);

  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchStory();
    }
  }, [fetchStory]);

  const updateStoryMetadata = async (
    title: string,
    summary: string,
    tags: string[],
    notes?: string,
    private_notes?: string
  ) => {
    const newState = {
      ...story,
      title,
      summary,
      styleTags: tags,
      notes,
      private_notes,
    };
    pushState(newState);

    try {
      await api.story.updateMetadata({
        title,
        summary,
        tags,
        notes,
        private_notes,
      });
      await api.story.updateTags(tags);
    } catch (e) {
      console.error('Failed to update story metadata', e);
    }
  };

  const updateStoryImageSettings = async (style: string, info: string) => {
    const newState = { ...story, image_style: style, image_additional_info: info };
    pushState(newState);
    try {
      await api.story.updateSettings({
        image_style: style,
        image_additional_info: info,
      });
    } catch (e) {
      console.error('Failed to update story image settings', e);
    }
  };

  const updateChapter = async (id: string, partial: Partial<Chapter>) => {
    const newChapters = story.chapters.map((ch) =>
      ch.id === id ? { ...ch, ...partial } : ch
    );
    const newState = { ...story, chapters: newChapters };
    pushState(newState);

    try {
      const numId = Number(id);
      if (partial.content !== undefined)
        await api.chapters.updateContent(numId, partial.content);
      if (partial.title !== undefined)
        await api.chapters.updateTitle(numId, partial.title);
      if (partial.summary !== undefined)
        await api.chapters.updateSummary(numId, partial.summary);
      // Metadata fields are managed through dedicated metadata flows to avoid
      // partial writes racing with dialog autosave.
    } catch (e) {
      console.error('Failed to update chapter', e);
    }
  };

  const updateBook = async (id: string, partial: Partial<Book>) => {
    const newBooks =
      story.books?.map((b) => (b.id === id ? { ...b, ...partial } : b)) || [];
    const newState = { ...story, books: newBooks };
    pushState(newState);
    // Book persistence stays at call sites that own the surrounding workflow
    // (rename, reorder, metadata edit) to keep this hook narrowly scoped.
  };

  const addChapter = async (
    title: string = 'New Chapter',
    summary: string = '',
    bookId?: string
  ) => {
    try {
      const res = await api.chapters.create(title, '', bookId);
      const chaptersRes = await api.chapters.list();
      const newChapters: Chapter[] = mapApiChapters(chaptersRes.chapters);

      // Prefer backend-returned identity, then fallback to list tail for compatibility.
      const newChapter =
        newChapters.find((c) => c.id === String(res.id)) ||
        newChapters[newChapters.length - 1];

      const newState: StoryState = {
        ...story,
        chapters: newChapters,
        currentChapterId: newChapter.id,
        lastUpdated: Date.now(),
      };
      pushState(newState);
    } catch (e) {
      console.error('Failed to add chapter', e);
    }
  };

  const deleteChapter = async (id: string) => {
    try {
      const deletedChapter = story.chapters.find((c) => c.id === id);
      const currentChap = story.chapters.find((c) => c.id === currentChapterId);

      await api.chapters.delete(Number(id));

      // Re-fetch after deletion because positional IDs can shift in series mode.
      const chaptersRes = await api.chapters.list();
      const newChapters: Chapter[] = mapApiChapters(chaptersRes.chapters);

      // Re-anchor via stable file/book coordinates instead of transient numeric IDs.
      let newSelection = null;
      if (currentChapterId !== id && currentChap) {
        const matching = newChapters.find(
          (c) =>
            c.filename === currentChap.filename && c.book_id === currentChap.book_id
        );
        if (matching) {
          newSelection = matching.id;
        }
      }

      // Keep editor continuity by selecting a nearby chapter when possible.
      if (!newSelection && newChapters.length > 0) {
        const oldIndex = story.chapters.findIndex((c) => c.id === id);
        newSelection =
          newChapters[oldIndex]?.id || newChapters[newChapters.length - 1].id;
      }

      const newState: StoryState = {
        ...story,
        chapters: newChapters,
        currentChapterId: newSelection,
        lastUpdated: Date.now(),
      };
      pushState(newState);
    } catch (e) {
      console.error('Failed to delete chapter', e);
    }
  };

  const loadStory = useCallback(
    (newStory: StoryState) => {
      // Keep backend active-project context aligned before local state updates.
      if (newStory.id) {
        api.projects
          .select(newStory.id)
          .then(() => fetchStory())
          .catch((e) => console.error('Failed to select project', e));
      }

      setStory(newStory);
      setHistory([newStory]);
      setCurrentIndex(0);
      if (newStory.currentChapterId) {
        setCurrentChapterId(newStory.currentChapterId);
      } else if (newStory.chapters.length > 0) {
        setCurrentChapterId(newStory.chapters[0].id);
      } else {
        setCurrentChapterId(null);
      }
    },
    [story.id, fetchStory]
  );

  const undo = useCallback(() => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      const prevState = history[prevIndex];
      setStory(prevState);
      if (prevState.currentChapterId) setCurrentChapterId(prevState.currentChapterId);
    }
  }, [currentIndex, history]);

  const redo = useCallback(() => {
    if (currentIndex < history.length - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      const nextState = history[nextIndex];
      setStory(nextState);
      if (nextState.currentChapterId) setCurrentChapterId(nextState.currentChapterId);
    }
  }, [currentIndex, history]);

  return {
    story,
    currentChapterId,
    selectChapter: (id: string) => selectChapter(id),
    updateStoryMetadata,
    updateStoryImageSettings,
    updateChapter,
    addChapter,
    deleteChapter,
    updateBook,
    loadStory,
    refreshStory,
    undo,
    redo,
    canUndo: currentIndex > 0,
    canRedo: currentIndex < history.length - 1,
  };
};
