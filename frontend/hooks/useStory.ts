// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { useState, useCallback, useEffect, useRef } from 'react';
import { StoryState, Chapter } from '../types';
import { api } from '../services/api';

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

export const useStory = () => {
  const [story, setStory] = useState<StoryState>(INITIAL_STORY);
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [history, setHistory] = useState<StoryState[]>([INITIAL_STORY]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const hasFetchedRef = useRef(false);

  const pushState = useCallback(
    (newState: StoryState) => {
      const updatedState = { ...newState, lastUpdated: Date.now() };
      const newHistory = history.slice(0, currentIndex + 1);
      newHistory.push(updatedState);
      setHistory(newHistory);
      setCurrentIndex(newHistory.length - 1);
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
        // Show dialog to update
        const shouldUpdate = confirm(
          `The story config is outdated (version ${res.current_version}). Current version is ${res.required_version}. Do you want to update it?`
        );
        if (shouldUpdate) {
          try {
            const updateRes = await api.projects.updateConfig();
            if (updateRes.ok) {
              // After update, reload the story
              const res2 = await api.projects.select(currentProject);
              if (res2.ok && res2.story) {
                const chaptersRes = await api.chapters.list();
                const chapters: Chapter[] = chaptersRes.chapters.map((c: any) => ({
                  id: String(c.id),
                  title: c.title,
                  summary: c.summary,
                  content: '',
                  filename: c.filename,
                  book_id: c.book_id,
                  notes: c.notes,
                  private_notes: c.private_notes,
                  conflicts: c.conflicts,
                }));

                // Re-anchor selection based on filename/book_id if IDs shifted
                let newSelection = currentChapterId;
                if (currentChapterId) {
                  const oldChap = story.chapters.find((c) => c.id === currentChapterId);
                  if (oldChap) {
                    const matching = chapters.find(
                      (c) =>
                        c.filename === oldChap.filename && c.book_id === oldChap.book_id
                    );
                    if (matching) {
                      newSelection = matching.id;
                    } else {
                      newSelection = null; // Reset if not found in new project
                    }
                  }
                } else if (chapters.length > 0) {
                  newSelection = null;
                }

                const newStory: StoryState = {
                  id: currentProject,
                  title: res2.story.project_title || currentProject,
                  summary: res2.story.story_summary || '',
                  styleTags: res2.story.tags || [],
                  image_style: res2.story.image_style || '',
                  image_additional_info: res2.story.image_additional_info || '',
                  chapters: chapters,
                  projectType: res2.story.project_type || 'novel',
                  books: res2.story.books || [],
                  sourcebook: res2.story.sourcebook || [],
                  conflicts: res2.story.conflicts || [],
                  llm_prefs: res2.story.llm_prefs,
                  currentChapterId: newSelection,
                  lastUpdated: Date.now(),
                };

                setStory(newStory);
                setCurrentChapterId(newSelection);
              } else if (res2.error) {
                // Handle errors after update
                if (res2.error === 'invalid_config') {
                  alert(`Invalid story config: ${res2.error_message}`);
                } else {
                  alert(`Failed to load story after update: ${res2.error}`);
                }
              }
            } else {
              alert(`Failed to update config: ${updateRes.detail}`);
            }
          } catch (e) {
            alert(`Failed to update config: ${e}`);
          }
        }
        return;
      } else if (res.error === 'invalid_config') {
        alert(`Invalid story config: ${res.error_message}`);
        return;
      } else if (res.ok && res.story) {
        const chaptersRes = await api.chapters.list();
        const chapters: Chapter[] = chaptersRes.chapters.map((c: any) => ({
          id: String(c.id),
          title: c.title,
          summary: c.summary,
          content: '',
          filename: c.filename,
          book_id: c.book_id,
          notes: c.notes,
          private_notes: c.private_notes,
          conflicts: c.conflicts,
        }));

        // Re-anchor selection based on filename/book_id if IDs shifted
        let newSelection = currentChapterId;
        if (currentChapterId) {
          const oldChap = story.chapters.find((c) => c.id === currentChapterId);
          if (oldChap) {
            const matching = chapters.find(
              (c) => c.filename === oldChap.filename && c.book_id === oldChap.book_id
            );
            if (matching) {
              newSelection = matching.id;
            } else {
              newSelection = null; // Reset if not found in new project
            }
          }
        } else if (chapters.length > 0) {
          newSelection = null;
        }

        const newStory: StoryState = {
          id: currentProject,
          title: res.story.project_title || currentProject,
          summary: res.story.story_summary || '',
          styleTags: res.story.tags || [],
          image_style: res.story.image_style || '',
          image_additional_info: res.story.image_additional_info || '',
          chapters: chapters,
          projectType: res.story.project_type || 'novel',
          books: res.story.books || [],
          sourcebook: res.story.sourcebook || [],
          conflicts: res.story.conflicts || [],
          llm_prefs: res.story.llm_prefs,
          currentChapterId: newSelection,
          lastUpdated: Date.now(),
        };

        setStory(newStory);
        setCurrentChapterId(newSelection);
      }
    } catch (e) {
      console.error('Failed to refresh story', e);
    }
  }, [story.id, currentChapterId]);

  const selectChapter = useCallback((id: string | null) => {
    setCurrentChapterId(id);
  }, []);

  // Load chapter content when currentChapterId changes
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
    if (story.id) return; // Already loaded
    try {
      const projects = await api.projects.list();
      if (projects.current) {
        const res = await api.projects.select(projects.current);
        if (res.ok && res.story) {
          const chaptersRes = await api.chapters.list();
          const chapters = chaptersRes.chapters.map((c: any) => ({
            id: String(c.id),
            title: c.title,
            summary: c.summary,
            content: '',
            filename: c.filename,
            book_id: c.book_id,
            notes: c.notes,
            private_notes: c.private_notes,
            conflicts: c.conflicts,
          }));

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
      // For metadata (notes, private_notes, conflicts), typically updateMetadata is used by caller
      // but if we wanted to support it here we could add it.
    } catch (e) {
      console.error('Failed to update chapter', e);
    }
  };

  const updateBook = async (id: string, partial: any) => {
    const newBooks =
      story.books?.map((b) => (b.id === id ? { ...b, ...partial } : b)) || [];
    const newState = { ...story, books: newBooks };
    pushState(newState);
    // Note: API calls for books are handled by the caller (MetadataEditorDialog/ChapterList usually)
    // or we could move them here.
  };

  const addChapter = async (
    title: string = 'New Chapter',
    summary: string = '',
    bookId?: string
  ) => {
    try {
      const res = await api.chapters.create(title, '', bookId);
      const chaptersRes = await api.chapters.list();
      const newChapters: Chapter[] = chaptersRes.chapters.map((c: any) => ({
        id: String(c.id),
        title: c.title,
        summary: c.summary,
        content: '',
        filename: c.filename,
        book_id: c.book_id,
      }));

      // Find the new chapter in the list by the ID returned from creation
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

      // Refresh the chapter list from the backend since IDs are positional
      // and deleting one shifts subsequent IDs in Series projects.
      const chaptersRes = await api.chapters.list();
      const newChapters: Chapter[] = chaptersRes.chapters.map((c: any) => ({
        id: String(c.id),
        title: c.title,
        summary: c.summary,
        content: '',
        filename: c.filename,
        book_id: c.book_id,
      }));

      // Re-anchor selection based on filename/book_id since IDs may have shifted
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

      // If we deleted the active chapter or couldn't find it, pick a neighbor
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
      // Always select project to ensure backend active state matches frontend
      if (newStory.id) {
        api.projects
          .select(newStory.id)
          .then(() => fetchStory())
          .catch((e) => console.error('Failed to select project', e));
      }

      // Update local state
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
