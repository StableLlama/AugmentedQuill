// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Assemble stable header and main-layout control props outside App.tsx.
 *
 * Stability contract: every useMemo / useCallback in this file must list
 * individual field deps (never a whole params object), and every value that is
 * "read at call time" inside a callback is accessed via a ref so the callback
 * itself stays stable even when those values change.
 */

import { useCallback, useMemo, useRef } from 'react';

import { AppHeader } from '../layout/AppHeader';
import { AppMainLayout } from '../layout/AppMainLayout';
import type {
  HeaderViewControls,
  HeaderFormatControls,
} from '../layout/layoutControlTypes';
import type {
  EditorSettings,
  SourcebookEntry,
  StoryState,
  SuggestionGenerationMode,
} from '../../types';
import { useStoryStore } from '../../stores/storyStore';

type AppHeaderProps = React.ComponentProps<typeof AppHeader>;
type AppMainLayoutProps = React.ComponentProps<typeof AppMainLayout>;

type UseAppHeaderPropsParams = {
  storyTitle: string;
  sidebarControls: AppHeaderProps['sidebarControls'];
  undo: () => void;
  redo: () => void;
  undoSteps: (steps: number) => void;
  redoSteps: (steps: number) => void;
  undoOptions: AppHeaderProps['historyControls']['undoOptions'];
  redoOptions: AppHeaderProps['historyControls']['redoOptions'];
  nextUndoLabel?: string | null;
  nextRedoLabel?: string | null;
  canUndo: boolean;
  canRedo: boolean;
  openImagesDialog: () => void;
  setIsSettingsOpen: (open: boolean) => void;
  setIsImagesOpen: (open: boolean) => void;
  setIsDebugLogsOpen: (open: boolean) => void;
  appearanceRef: React.RefObject<HTMLDivElement | null>;
  isAppearanceOpen: boolean;
  setIsAppearanceOpen: (open: boolean) => void;
  setAppTheme: (theme: EditorSettings['theme']) => void;
  editorSettings: EditorSettings;
  setEditorSettings: AppHeaderProps['appearanceControls']['setEditorSettings'];
  appSettings: AppHeaderProps['modelControls']['appSettings'];
  setAppSettings: AppHeaderProps['modelControls']['setAppSettings'];
  handleSaveSettings: AppHeaderProps['modelControls']['saveSettings'];
  modelConnectionStatus: AppHeaderProps['modelControls']['modelConnectionStatus'];
  detectedCapabilities: AppHeaderProps['modelControls']['detectedCapabilities'];
  recheckUnavailableProviderIfStale: AppHeaderProps['modelControls']['recheckUnavailableProviderIfStale'];
  handleAiAction: AppHeaderProps['aiControls']['handleAiAction'];
  isAiActionLoading: boolean;
  isWritingAvailable: boolean;
  isCurrentChapterEmpty: boolean;
  isChatOpen: boolean;
  setIsChatOpen: (open: boolean) => void;
  openSearch: () => void;
};

type UseAppMainLayoutPropsParams = {
  viewControls: HeaderViewControls;
  formatControls: HeaderFormatControls;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  currentChapterId: string | null;
  handleChapterSelect: (chapterId: string | null) => void;
  deleteChapter: (chapterId: string) => Promise<void>;
  updateChapter: (
    id: string,
    partial: Record<string, unknown>,
    sync?: boolean,
    pushHistory?: boolean,
    isUserEdit?: boolean
  ) => Promise<void>;
  updateBook: (id: string, partial: Record<string, unknown>) => Promise<void>;
  addChapter: (title?: string, content?: string, bookId?: string) => Promise<void>;
  handleBookCreate: (title: string) => Promise<void>;
  handleBookDelete: (bookId: string) => Promise<void>;
  handleReorderChapters: AppMainLayoutProps['sidebarControls']['handleReorderChapters'];
  handleReorderBooks: AppMainLayoutProps['sidebarControls']['handleReorderBooks'];
  handleSidebarAiAction: AppMainLayoutProps['sidebarControls']['handleSidebarAiAction'];
  isEditingAvailable: boolean;
  handleOpenImages: () => void;
  updateStoryMetadata: AppMainLayoutProps['sidebarControls']['updateStoryMetadata'];
  checkedEntries: Set<string>;
  handleToggleEntry: (id: string, checked: boolean) => void;
  isAutoSourcebookSelectionEnabled: boolean;
  setIsAutoSourcebookSelectionEnabled: (enabled: boolean) => void;
  isSourcebookSelectionRunning: boolean;
  sourcebookMutationEntryIds: Set<string>;
  baselineState: StoryState;
  advanceBaselineToCurrentStory: () => void;
  patchSourcebook: (entry: SourcebookEntry | null, entryId?: string) => boolean;
  pushExternalHistoryEntry: (params: {
    label: string;
    state?: StoryState;
    onUndo?: () => Promise<void> | void;
    onRedo?: () => Promise<void> | void;
    forceNewHistory?: boolean;
    entryId?: string;
  }) => void;
  refreshStory: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  searchState: { notifyContentChanged: (chapterId: number) => void };
  currentChapter: AppMainLayoutProps['editorControls']['currentChapter'];
  isChapterLoading: boolean;
  editorRef: AppMainLayoutProps['editorControls']['editorRef'];
  editorSettings: EditorSettings;
  storyLanguage?: string;
  setEditorSettings: AppHeaderProps['appearanceControls']['setEditorSettings'];
  viewMode: AppMainLayoutProps['editorControls']['viewMode'];
  continuations: string[];
  suggestionMode: SuggestionGenerationMode;
  setSuggestionMode: (mode: SuggestionGenerationMode) => void;
  isSuggesting: boolean;
  handleTriggerSuggestions: () => Promise<void>;
  cancelSuggestions: () => void;
  handleAcceptContinuation: (text: string, contentOverride?: string) => Promise<void>;
  isSuggestionMode: boolean;
  handleKeyboardSuggestionAction: AppMainLayoutProps['editorControls']['suggestionControls']['handleKeyboardSuggestionAction'];
  handleAiAction: AppHeaderProps['aiControls']['handleAiAction'];
  cancelAiAction: () => void;
  isAiActionLoading: boolean;
  isWritingAvailable: boolean;
  setActiveFormats: (formats: string[]) => void;
  showWhitespace: boolean;
  setShowWhitespace: (show: boolean) => void;
  editorBaselineContent?: string;
  openSearch: () => void;
  chatControls: AppMainLayoutProps['chatControls'];
  instructionLanguages: string[];
};

export function useAppHeaderProps(params: UseAppHeaderPropsParams): AppHeaderProps {
  const {
    storyTitle,
    sidebarControls,
    undo,
    redo,
    undoSteps,
    redoSteps,
    undoOptions,
    redoOptions,
    nextUndoLabel,
    nextRedoLabel,
    canUndo,
    canRedo,
    openImagesDialog: _openImagesDialog,
    setIsSettingsOpen,
    setIsImagesOpen,
    setIsDebugLogsOpen,
    appearanceRef,
    isAppearanceOpen,
    setIsAppearanceOpen,
    setAppTheme,
    editorSettings,
    setEditorSettings,
    appSettings,
    setAppSettings,
    handleSaveSettings,
    modelConnectionStatus,
    detectedCapabilities,
    recheckUnavailableProviderIfStale,
    handleAiAction,
    isAiActionLoading,
    isWritingAvailable,
    isCurrentChapterEmpty,
    isChatOpen,
    setIsChatOpen,
    openSearch,
  } = params;

  const searchControls = useMemo(
    (): { onOpenSearch: () => void } => ({ onOpenSearch: openSearch }),
    [openSearch]
  );
  const historyControls = useMemo(
    () => ({
      undo,
      redo,
      undoSteps,
      redoSteps,
      undoOptions,
      redoOptions,
      nextUndoLabel: nextUndoLabel ?? null,
      nextRedoLabel: nextRedoLabel ?? null,
      canUndo,
      canRedo,
    }),
    [
      undo,
      redo,
      undoSteps,
      redoSteps,
      undoOptions,
      redoOptions,
      nextUndoLabel,
      nextRedoLabel,
      canUndo,
      canRedo,
    ]
  );
  return useMemo(
    () => ({
      storyTitle,
      sidebarControls,
      settingsControls: {
        setIsSettingsOpen,
        setIsImagesOpen,
        setIsDebugLogsOpen,
      },
      historyControls,
      aiControls: {
        handleAiAction,
        isAiActionLoading,
        isWritingAvailable,
        isChapterEmpty: isCurrentChapterEmpty,
      },
      modelControls: {
        appSettings,
        setAppSettings,
        saveSettings: handleSaveSettings,
        modelConnectionStatus,
        detectedCapabilities,
        recheckUnavailableProviderIfStale,
      },
      appearanceControls: {
        appearanceRef,
        isAppearanceOpen,
        setIsAppearanceOpen,
        setAppTheme,
        editorSettings,
        setEditorSettings,
      },
      chatPanelControls: {
        isChatOpen,
        setIsChatOpen,
      },
      searchControls,
    }),
    [
      historyControls,
      searchControls,
      storyTitle,
      sidebarControls,
      setIsSettingsOpen,
      setIsImagesOpen,
      setIsDebugLogsOpen,
      handleAiAction,
      isAiActionLoading,
      isWritingAvailable,
      isCurrentChapterEmpty,
      appSettings,
      setAppSettings,
      handleSaveSettings,
      modelConnectionStatus,
      detectedCapabilities,
      recheckUnavailableProviderIfStale,
      appearanceRef,
      isAppearanceOpen,
      setIsAppearanceOpen,
      setAppTheme,
      editorSettings,
      setEditorSettings,
      isChatOpen,
      setIsChatOpen,
    ]
  );
}

export function useAppMainLayoutProps(params: UseAppMainLayoutPropsParams): {
  sidebarControls: AppMainLayoutProps['sidebarControls'];
  editorControls: AppMainLayoutProps['editorControls'];
  appMainLayoutProps: AppMainLayoutProps;
} {
  // Destructure all params so useMemo / useCallback deps are individual stable
  // values rather than the whole params object (which is a new reference every
  // render and would defeat all memoization).
  const {
    isSidebarOpen,
    setIsSidebarOpen,
    currentChapterId,
    handleChapterSelect,
    deleteChapter,
    updateChapter,
    updateBook,
    addChapter,
    handleBookCreate,
    handleBookDelete,
    handleReorderChapters,
    handleReorderBooks,
    handleSidebarAiAction,
    isEditingAvailable,
    handleOpenImages,
    updateStoryMetadata,
    checkedEntries,
    handleToggleEntry,
    isAutoSourcebookSelectionEnabled,
    setIsAutoSourcebookSelectionEnabled,
    isSourcebookSelectionRunning,
    sourcebookMutationEntryIds,
    advanceBaselineToCurrentStory,
    patchSourcebook,
    pushExternalHistoryEntry,
    refreshStory,
    undo,
    redo,
    searchState,
    currentChapter,
    isChapterLoading,
    editorRef,
    editorSettings,
    storyLanguage,
    setEditorSettings,
    viewMode,
    continuations,
    suggestionMode,
    setSuggestionMode,
    isSuggesting,
    handleTriggerSuggestions,
    cancelSuggestions,
    handleAcceptContinuation,
    isSuggestionMode,
    handleKeyboardSuggestionAction,
    handleAiAction,
    cancelAiAction,
    isAiActionLoading,
    isWritingAvailable,
    setActiveFormats,
    showWhitespace,
    setShowWhitespace,
    editorBaselineContent,
    openSearch,
    chatControls,
    instructionLanguages,
  } = params;

  // Keep a ref to baselineState so handleSourcebookMutated reads the
  // latest value at call time without having it in its deps (which would
  // make it unstable on every history change).
  const baselineStateRef = useRef(params.baselineState);
  baselineStateRef.current = params.baselineState;

  // Keep a ref to searchState for the same reason.
  const searchStateRef = useRef(searchState);
  searchStateRef.current = searchState;

  const checkedSourcebookIds = useMemo(
    (): string[] => Array.from(checkedEntries),
    [checkedEntries]
  );
  const handleSourcebookMutated = useCallback(
    async (mutation: {
      label: string;
      onUndo?: () => Promise<void>;
      onRedo?: () => Promise<void>;
      entryId?: string;
      entryExistsInBaseline?: boolean;
      updatedEntry?: SourcebookEntry | null;
    }): Promise<void> => {
      const existsInBaseline = Boolean(
        mutation.entryExistsInBaseline ??
        baselineStateRef.current.sourcebook?.some(
          (entry: SourcebookEntry): boolean => entry.id === mutation.entryId
        )
      );
      if (mutation.updatedEntry !== undefined) {
        if (!existsInBaseline) {
          advanceBaselineToCurrentStory();
        }
        if (!patchSourcebook(mutation.updatedEntry, mutation.entryId)) {
          return;
        }
        if (existsInBaseline) {
          advanceBaselineToCurrentStory();
        }
        // Use the freshly patched store snapshot so history never captures a
        // stale pre-patch sourcebook state.
        pushExternalHistoryEntry({
          ...mutation,
          state: useStoryStore.getState().story,
          forceNewHistory: true,
        });
        return;
      }
      if (!existsInBaseline) {
        advanceBaselineToCurrentStory();
      }
      await refreshStory();
      if (existsInBaseline) {
        advanceBaselineToCurrentStory();
      }
      pushExternalHistoryEntry(mutation);
    },
    [
      advanceBaselineToCurrentStory,
      patchSourcebook,
      pushExternalHistoryEntry,
      refreshStory,
    ]
  );
  const editorUpdateChapter = useCallback(
    (
      id: string,
      partial: Record<string, unknown>,
      isUndoRedo?: boolean
    ): Promise<void> => {
      if ('content' in partial) {
        searchStateRef.current.notifyContentChanged(Number.parseInt(id, 10));
      }
      if (isUndoRedo) {
        return updateChapter(id, partial, true, false, false);
      }
      return updateChapter(id, partial, true, true, true);
    },
    [updateChapter]
  );

  // Stable wrappers — undo/redo have empty deps in useStory, so these are
  // stable too.  Extracting them before the sidebarControls useMemo means
  // canUndo/canRedo are no longer dependencies of sidebarControls: the
  // object no longer gets a new reference on every debounced keystroke.
  const onAppUndo = useCallback(async (): Promise<void> => {
    undo();
  }, [undo]);
  const onAppRedo = useCallback(async (): Promise<void> => {
    redo();
  }, [redo]);

  const sidebarControls = useMemo(
    () => ({
      isSidebarOpen,
      setIsSidebarOpen,
      currentChapterId,
      handleChapterSelect,
      deleteChapter,
      updateChapter,
      updateBook,
      addChapter,
      handleBookCreate,
      handleBookDelete,
      handleReorderChapters,
      handleReorderBooks,
      handleSidebarAiAction,
      isEditingAvailable,
      handleOpenImages,
      updateStoryMetadata,
      checkedSourcebookIds,
      onToggleSourcebook: handleToggleEntry,
      isAutoSourcebookSelectionEnabled,
      onToggleAutoSourcebookSelection: setIsAutoSourcebookSelectionEnabled,
      isSourcebookSelectionRunning,
      mutatedSourcebookEntryIds: sourcebookMutationEntryIds,
      onSourcebookMutated: handleSourcebookMutated,
      onAppUndo,
      onAppRedo,
      // canAppUndo / canAppRedo intentionally omitted: they change on every
      // debounced keystroke and would destabilise this object, propagating
      // unnecessary re-renders to AppMainLayout and all its children.
      // AppSidebar reads them directly from storyStore via useStoryHistoryState.
    }),
    [
      isSidebarOpen,
      setIsSidebarOpen,
      currentChapterId,
      handleChapterSelect,
      deleteChapter,
      updateChapter,
      updateBook,
      addChapter,
      handleBookCreate,
      handleBookDelete,
      handleReorderChapters,
      handleReorderBooks,
      handleSidebarAiAction,
      isEditingAvailable,
      handleOpenImages,
      updateStoryMetadata,
      checkedSourcebookIds,
      handleToggleEntry,
      isAutoSourcebookSelectionEnabled,
      setIsAutoSourcebookSelectionEnabled,
      isSourcebookSelectionRunning,
      sourcebookMutationEntryIds,
      handleSourcebookMutated,
      onAppUndo,
      onAppRedo,
    ]
  );
  const editorControls = useMemo(
    () => ({
      currentChapter,
      isChapterLoading,
      editorRef,
      editorSettings,
      storyLanguage: storyLanguage || 'en',
      setEditorSettings,
      viewMode,
      updateChapter: editorUpdateChapter,
      suggestionControls: {
        continuations,
        suggestionMode,
        setSuggestionMode,
        isSuggesting,
        handleTriggerSuggestions,
        handleCancelSuggestions: cancelSuggestions,
        handleAcceptContinuation,
        isSuggestionMode,
        handleKeyboardSuggestionAction,
      },
      aiControls: {
        handleAiAction,
        cancelAiAction,
        isAiActionLoading,
        isWritingAvailable,
        isProseStreaming: isAiActionLoading,
        isChapterEmpty: !currentChapter?.content?.trim(),
      },
      setActiveFormats,
      showWhitespace,
      setShowWhitespace,
      baselineContent: editorBaselineContent,
      onOpenSearch: openSearch,
      recordHistoryEntry: pushExternalHistoryEntry,
    }),
    [
      editorUpdateChapter,
      currentChapter,
      isChapterLoading,
      editorRef,
      editorSettings,
      storyLanguage,
      setEditorSettings,
      viewMode,
      continuations,
      suggestionMode,
      setSuggestionMode,
      isSuggesting,
      handleTriggerSuggestions,
      cancelSuggestions,
      handleAcceptContinuation,
      isSuggestionMode,
      handleKeyboardSuggestionAction,
      handleAiAction,
      cancelAiAction,
      isAiActionLoading,
      isWritingAvailable,
      setActiveFormats,
      showWhitespace,
      setShowWhitespace,
      editorBaselineContent,
      openSearch,
      pushExternalHistoryEntry,
    ]
  );
  return {
    sidebarControls,
    editorControls,
    appMainLayoutProps: useMemo(
      () => ({
        sidebarControls,
        editorControls,
        chatControls,
        viewControls: params.viewControls,
        formatControls: params.formatControls,
        instructionLanguages,
      }),
      [
        sidebarControls,
        editorControls,
        chatControls,
        params.viewControls,
        params.formatControls,
        instructionLanguages,
      ]
    ),
  };
}
