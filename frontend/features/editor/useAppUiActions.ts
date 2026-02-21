import { Dispatch, RefObject, SetStateAction } from 'react';

import { api } from '../../services/api';
import { AppTheme, EditorSettings } from '../../types';
import { EditorHandle } from './Editor';

type UseAppUiActionsParams = {
  editorRef: RefObject<EditorHandle | null>;
  activeFormats: string[];
  buttonActive: string;
  isLight: boolean;
  setIsFormatMenuOpen: (open: boolean) => void;
  setIsMobileFormatMenuOpen: (open: boolean) => void;
  selectChapter: (id: string) => void;
  setIsSidebarOpen: (open: boolean) => void;
  setEditorSettings: Dispatch<SetStateAction<EditorSettings>>;
  refreshStory: () => Promise<void>;
  getErrorMessage: (error: unknown, fallback: string) => string;
};

export function useAppUiActions({
  editorRef,
  activeFormats,
  buttonActive,
  isLight,
  setIsFormatMenuOpen,
  setIsMobileFormatMenuOpen,
  selectChapter,
  setIsSidebarOpen,
  setEditorSettings,
  refreshStory,
  getErrorMessage,
}: UseAppUiActionsParams) {
  const handleFormat = (type: string) => {
    if (editorRef.current) {
      editorRef.current.format(type);
      setIsFormatMenuOpen(false);
      setIsMobileFormatMenuOpen(false);
    }
  };

  const handleChapterSelect = (id: string) => {
    selectChapter(id);
    setIsSidebarOpen(false);
  };

  const getFormatButtonClass = (type: string) => {
    const isActive = activeFormats.includes(type);
    if (isActive) return `p-1.5 rounded-md transition-colors ${buttonActive}`;
    return `p-1.5 rounded-md transition-colors ${
      isLight
        ? 'text-brand-gray-500 hover:bg-brand-gray-100 hover:text-brand-gray-700'
        : 'text-brand-gray-500 hover:bg-brand-gray-800 hover:text-brand-gray-300'
    }`;
  };

  const handleConvertProject = async (newType: string) => {
    try {
      await api.projects.convert(newType);
      await refreshStory();
    } catch (error: unknown) {
      alert(`Failed to convert project: ${getErrorMessage(error, 'Unknown error')}`);
    }
  };

  const handleBookCreate = async (title: string) => {
    try {
      await api.books.create(title);
      await refreshStory();
    } catch (error: unknown) {
      console.error(error);
      alert(`Failed to create book: ${getErrorMessage(error, 'Unknown error')}`);
    }
  };

  const handleBookDelete = async (id: string) => {
    try {
      await api.books.delete(id);
      await refreshStory();
    } catch (error: unknown) {
      console.error(error);
      alert(`Failed to delete book: ${getErrorMessage(error, 'Unknown error')}`);
    }
  };

  const handleReorderChapters = async (chapterIds: number[], bookId?: string) => {
    try {
      await api.chapters.reorder(chapterIds, bookId);
      await refreshStory();
    } catch (error: unknown) {
      console.error(error);
      alert(`Failed to reorder chapters: ${getErrorMessage(error, 'Unknown error')}`);
    }
  };

  const handleReorderBooks = async (bookIds: string[]) => {
    try {
      await api.books.reorder(bookIds);
      await refreshStory();
    } catch (error: unknown) {
      console.error(error);
      alert(`Failed to reorder books: ${getErrorMessage(error, 'Unknown error')}`);
    }
  };

  const handleOpenImages = () => {
    if (editorRef.current?.openImageManager) {
      editorRef.current.openImageManager();
    }
  };

  const setAppTheme = (theme: AppTheme) => {
    setEditorSettings((previous) => ({ ...previous, theme }));
  };

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
