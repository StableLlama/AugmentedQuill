// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the use app ui actions unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { Dispatch, RefObject, SetStateAction, useCallback } from 'react';

import { api } from '../../services/api';
import { AppTheme, EditorSettings, StoryState } from '../../types';
import { EditorHandle } from './Editor';
import { useTheme } from '../layout/ThemeContext';
import { notifyError } from '../../services/errorNotifier';

type UseAppUiActionsParams = {
  editorRef: RefObject<EditorHandle | null>;
  activeFormats: string[];
  setIsFormatMenuOpen: (open: boolean) => void;
  setIsMobileFormatMenuOpen: (open: boolean) => void;
  selectChapter: (id: string | null) => void;
  setIsSidebarOpen: (open: boolean) => void;
  setEditorSettings: Dispatch<SetStateAction<EditorSettings>>;
  story: StoryState;
  currentProjectType: StoryState['projectType'];
  refreshStory: (historyLabel?: string) => Promise<void>;
  getErrorMessage: (error: unknown, fallback: string) => string;
  recordHistoryEntry?: (entry: {
    label: string;
    onUndo?: () => Promise<void>;
    onRedo?: () => Promise<void>;
  }) => void;
};

/** Custom React hook that manages app ui actions. */
export function useAppUiActions({
  editorRef,
  activeFormats,
  setIsFormatMenuOpen,
  setIsMobileFormatMenuOpen,
  selectChapter,
  setIsSidebarOpen,
  setEditorSettings,
  story,
  currentProjectType,
  refreshStory,
  getErrorMessage,
  recordHistoryEntry,
}: UseAppUiActionsParams): {
  handleFormat: (type: string) => void;
  handleChapterSelect: (id: string | null) => void;
  getFormatButtonClass: (type: string) => string;
  handleConvertProject: (newType: string) => Promise<void>;
  handleBookCreate: (title: string) => Promise<void>;
  handleBookDelete: (id: string) => Promise<void>;
  handleReorderChapters: (chapterIds: number[], bookId?: string) => Promise<void>;
  handleReorderBooks: (bookIds: string[]) => Promise<void>;
  handleOpenImages: () => void;
  setAppTheme: (theme: AppTheme) => void;
} {
  const { buttonActive, isLight } = useTheme();

  const handleFormat = useCallback(
    (type: string): void => {
      if (editorRef.current) {
        editorRef.current.format(type);
        setIsFormatMenuOpen(false);
        setIsMobileFormatMenuOpen(false);
      }
    },
    [editorRef, setIsFormatMenuOpen, setIsMobileFormatMenuOpen]
  );

  const handleChapterSelect = useCallback(
    (id: string | null): void => {
      selectChapter(id);
      if (typeof window !== 'undefined') {
        const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
        if (!isDesktop) {
          setIsSidebarOpen(false);
        }
      }
    },
    [selectChapter, setIsSidebarOpen]
  );

  const getFormatButtonClass = useCallback(
    (type: string): string => {
      const isActive = activeFormats.includes(type);
      if (isActive) return `p-1.5 rounded-md transition-colors ${buttonActive}`;
      return `p-1.5 rounded-md transition-colors ${
        isLight
          ? 'text-brand-gray-500 hover:bg-brand-gray-100 hover:text-brand-gray-700'
          : 'text-brand-gray-500 hover:bg-brand-gray-800 hover:text-brand-gray-300'
      }`;
    },
    [activeFormats, buttonActive, isLight]
  );

  const handleConvertProject = useCallback(
    async (newType: string): Promise<void> => {
      try {
        if (newType === currentProjectType) return;
        await api.projects.convert(newType);
        await refreshStory();
        recordHistoryEntry?.({
          label: `Convert project: ${currentProjectType} -> ${newType}`,
          onUndo: async (): Promise<void> => {
            await api.projects.convert(currentProjectType);
            await refreshStory();
          },
          onRedo: async (): Promise<void> => {
            await api.projects.convert(newType);
            await refreshStory();
          },
        });
      } catch (error: unknown) {
        notifyError(
          `Failed to convert project: ${getErrorMessage(error, 'Unknown error')}`,
          error
        );
      }
    },
    [currentProjectType, refreshStory, getErrorMessage, recordHistoryEntry]
  );

  const handleBookCreate = useCallback(
    async (title: string): Promise<void> => {
      try {
        const created = await api.books.create(title);
        let createdBookId = created.book_id || '';
        await refreshStory();
        recordHistoryEntry?.({
          label: `Create book: ${title}`,
          onUndo: async (): Promise<void> => {
            if (!createdBookId) return;
            await api.books.delete(createdBookId);
            await refreshStory();
          },
          onRedo: async (): Promise<void> => {
            const recreated = await api.books.create(title);
            createdBookId = recreated.book_id || createdBookId;
            await refreshStory();
          },
        });
      } catch (error: unknown) {
        notifyError(
          `Failed to create book: ${getErrorMessage(error, 'Unknown error')}`,
          error
        );
      }
    },
    [refreshStory, getErrorMessage, recordHistoryEntry]
  );

  const handleBookDelete = useCallback(
    async (id: string): Promise<void> => {
      try {
        const deleted = await api.books.delete(id);
        let latestRestoreId = deleted.restore_id || '';
        await refreshStory();
        recordHistoryEntry?.({
          label: `Delete book: ${id}`,
          onUndo: async (): Promise<void> => {
            if (!latestRestoreId) return;
            await api.books.restore(latestRestoreId);
            await refreshStory();
          },
          onRedo: async (): Promise<void> => {
            const redone = await api.books.delete(id);
            latestRestoreId = redone.restore_id || latestRestoreId;
            await refreshStory();
          },
        });
      } catch (error: unknown) {
        notifyError(
          `Failed to delete book: ${getErrorMessage(error, 'Unknown error')}`,
          error
        );
      }
    },
    [refreshStory, getErrorMessage, recordHistoryEntry]
  );

  const handleReorderChapters = useCallback(
    async (chapterIds: number[], bookId?: string): Promise<void> => {
      try {
        const previousChapterIds = story.chapters
          .filter((chapter: import('../../types').Chapter): boolean =>
            bookId ? chapter.book_id === bookId : true
          )
          .map((chapter: import('../../types').Chapter): number => Number(chapter.id));

        await api.chapters.reorder(chapterIds, bookId);
        await refreshStory();
        recordHistoryEntry?.({
          label: bookId ? `Reorder chapters in book ${bookId}` : 'Reorder chapters',
          onUndo: async (): Promise<void> => {
            await api.chapters.reorder(previousChapterIds, bookId);
            await refreshStory();
          },
          onRedo: async (): Promise<void> => {
            await api.chapters.reorder(chapterIds, bookId);
            await refreshStory();
          },
        });
      } catch (error: unknown) {
        notifyError(
          `Failed to reorder chapters: ${getErrorMessage(error, 'Unknown error')}`,
          error
        );
      }
    },
    [story.chapters, refreshStory, getErrorMessage, recordHistoryEntry]
  );

  const handleReorderBooks = useCallback(
    async (bookIds: string[]): Promise<void> => {
      try {
        const previousBookIds = (story.books || []).map(
          (book: import('../../types').Book): string => book.id
        );
        await api.books.reorder(bookIds);
        await refreshStory();
        recordHistoryEntry?.({
          label: 'Reorder books',
          onUndo: async (): Promise<void> => {
            await api.books.reorder(previousBookIds);
            await refreshStory();
          },
          onRedo: async (): Promise<void> => {
            await api.books.reorder(bookIds);
            await refreshStory();
          },
        });
      } catch (error: unknown) {
        notifyError(
          `Failed to reorder books: ${getErrorMessage(error, 'Unknown error')}`,
          error
        );
      }
    },
    [story.books, refreshStory, getErrorMessage, recordHistoryEntry]
  );

  const handleOpenImages = useCallback((): void => {
    if (editorRef.current?.openImageManager) {
      editorRef.current.openImageManager();
    }
  }, [editorRef]);

  const setAppTheme = useCallback(
    (theme: AppTheme): void => {
      setEditorSettings((previous: EditorSettings) => ({ ...previous, theme }));
    },
    [setEditorSettings]
  );

  return {
    handleFormat,
    handleChapterSelect,
    getFormatButtonClass,
    handleConvertProject,
    handleBookCreate,
    handleBookDelete,
    handleReorderChapters,
    handleReorderBooks,
    handleOpenImages,
    setAppTheme,
  };
}
