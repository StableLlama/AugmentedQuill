import { useState, useCallback, useEffect, useRef } from 'react';
import { StoryState, Chapter } from '../types';
import { api } from '../services/api';

const INITIAL_STORY: StoryState = {
  id: '',
  title: '',
  summary: '',
  styleTags: [],
  chapters: [],
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
              c.id === currentChapterId ? { ...c, content: res.content } : c
            );
            return { ...prev, chapters: updatedChapters };
          });
        } catch (e) {
          console.error('Failed to load chapter content', e);
        }
      };
      loadContent();
    }
  }, [currentChapterId]);

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
          }));

          const newStory: StoryState = {
            id: projects.current,
            title: res.story.title || projects.current,
            summary: res.story.summary || '',
            styleTags: res.story.tags || [],
            chapters: chapters,
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
    tags: string[]
  ) => {
    const newState = { ...story, title, summary, styleTags: tags };
    pushState(newState);

    try {
      await api.story.updateSummary(summary);
      await api.story.updateTags(tags);
    } catch (e) {
      console.error('Failed to update story metadata', e);
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
    } catch (e) {
      console.error('Failed to update chapter', e);
    }
  };

  const addChapter = async (title: string = 'New Chapter', summary: string = '') => {
    try {
      await api.chapters.create(title);
      const chaptersRes = await api.chapters.list();
      const newChapters = chaptersRes.chapters.map((c: any) => ({
        id: String(c.id),
        title: c.title,
        summary: c.summary,
        content: '',
      }));

      const newChapter = newChapters[newChapters.length - 1];

      const newState = {
        ...story,
        chapters: newChapters,
        currentChapterId: newChapter.id,
      };
      pushState(newState);
    } catch (e) {
      console.error('Failed to add chapter', e);
    }
  };

  const deleteChapter = async (id: string) => {
    try {
      await api.chapters.delete(Number(id));
      const newChapters = story.chapters.filter((ch) => ch.id !== id);
      const newSelection =
        currentChapterId === id ? newChapters[0]?.id || null : currentChapterId;

      const newState = {
        ...story,
        chapters: newChapters,
        currentChapterId: newSelection,
      };
      pushState(newState);
    } catch (e) {
      console.error('Failed to delete chapter', e);
    }
  };

  const loadStory = useCallback(
    (newStory: StoryState) => {
      if (newStory.id !== story.id) {
        api.projects.select(newStory.id).then(() => {
          fetchStory();
        });
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
    updateChapter,
    addChapter,
    deleteChapter,
    loadStory,
    undo,
    redo,
    canUndo: currentIndex > 0,
    canRedo: currentIndex < history.length - 1,
  };
};
