// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the app unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStory } from './features/story/useStory';
import { useChapterSuggestions } from './features/chapters/useChapterSuggestions';
import { EditorHandle } from './features/editor/Editor';
import { useAppUiActions } from './features/editor/useAppUiActions';
import { useEditorPreferences } from './features/editor/useEditorPreferences';
import { useAiActions } from './features/story/useAiActions';
import { AppLayout } from './features/layout/AppLayout';
import { useConfirmDialog } from './features/layout/useConfirmDialog';
import { useProjectManagement } from './features/projects/useProjectManagement';
import { useAppSettings } from './features/settings/useAppSettings';
import { useProviderHealth } from './features/settings/useProviderHealth';
import { usePrompts } from './features/settings/usePrompts';
import { DEFAULT_APP_SETTINGS } from './features/app/appDefaults';
import { useAppChatRuntime } from './features/app/useAppChatRuntime';
import { isManageProjectCreateToolCall } from './features/chat/chatExecutionHelpers';
import {
  useAppHeaderProps,
  useAppMainLayoutProps,
} from './features/app/useAppControlProps';
import { useAppSearchNavigation } from './features/app/useAppSearchNavigation';
import { useBrowserHistory } from './features/app/useBrowserHistory';
import { useEditorUIState } from './features/app/useEditorUIState';
import { useSettingsPersistence } from './features/app/useSettingsPersistence';
import { useToolCallGate } from './features/app/useToolCallGate';
import { useUIPanels } from './features/app/useUIPanels';
import {
  restoreViewState,
  useAutoViewStatePersistence,
} from './features/app/useViewStatePersistence';
import { useSidebarIntents } from './features/layout/sidebarIntents';
import { useCurrentWritingUnit } from './features/story/useCurrentWritingUnit';
import {
  getErrorMessage,
  resolveActiveProviderConfigs,
  resolveRoleAvailability,
  supportsImageActions,
} from './features/app/appSelectors';
import { useToast } from './components/ui/Toast';
import { setErrorDispatcher } from './services/errorNotifier';
import { useChatStore, ChatStoreState } from './stores/chatStore';
import { uiStoreActions, useUIStore, UIStoreState } from './stores/uiStore';
import type { SceneEditorDialogState } from './stores/uiStore';
import type { SessionMutation } from './features/chat';
import type { ChatToolCall, SceneId } from './types';

// eslint-disable-next-line max-lines-per-function
const App: React.FC = () => {
  const { t } = useTranslation();
  const { confirm, alert, confirmDialogState, handleConfirm, handleCancel } =
    useConfirmDialog();

  const addToast = useToast();
  useEffect((): void => {
    setErrorDispatcher((msg: string): void => addToast(msg, 'error'));
  }, [addToast]);

  const {
    story,
    currentChapterId,
    selectChapter,
    updateStoryMetadata,
    updateStoryImageSettings,
    updateChapter,
    updateBook,
    addChapter,
    deleteChapter,
    loadStory,
    refreshStory,
    undo,
    redo,
    undoSteps,
    redoSteps,
    pushExternalHistoryEntry,
    undoOptions,
    redoOptions,
    nextUndoLabel,
    nextRedoLabel,
    historyIndex,
    canUndo,
    canRedo,
    baselineState,
    advanceBaselineToCurrentStory,
    patchSourcebook,
    isChapterLoading,
  } = useStory({ confirm, alert: (msg: string): undefined => void alert(msg) });

  // Stable ref to avoid recreating callbacks that read story state during
  // streaming (e.g. onProseChunk).
  const storyRef = useRef(story);
  storyRef.current = story;
  const editorRef = useRef<EditorHandle | null>(null);
  const refreshProjectsRef = useRef<null | (() => Promise<void>)>(null);

  useBrowserHistory({
    historyIndex,
    canUndo,
    canRedo,
    undoSteps,
    redoSteps,
    undo,
    redo,
  });

  const {
    currentChapter,
    currentChapterContext,
    isCurrentChapterEmpty,
    editorBaselineContent,
  } = useCurrentWritingUnit({
    story,
    currentChapterId,
    baselineState,
  });

  const { appSettings, setAppSettings } = useAppSettings(DEFAULT_APP_SETTINGS);

  const prompts = usePrompts(story.id);

  const {
    modelConnectionStatus,
    detectedCapabilities,
    refreshHealth,
    recheckUnavailableProviderIfStale,
  } = useProviderHealth(appSettings);

  const { handleSaveSettings } = useSettingsPersistence({
    appSettings,
    setAppSettings,
    pushExternalHistoryEntry,
    refreshHealth,
  });

  const roleAvailability = useMemo(
    (): { writing: boolean; editing: boolean; chat: boolean } =>
      resolveRoleAvailability(appSettings, modelConnectionStatus),
    [appSettings, modelConnectionStatus]
  );
  const imageActionsAvailable = useMemo(
    (): boolean =>
      supportsImageActions(appSettings, detectedCapabilities, modelConnectionStatus),
    [appSettings, detectedCapabilities, modelConnectionStatus]
  );

  const { toolCallLoopDialog, requestToolCallLoopAccess } = useToolCallGate();

  const {
    isChatOpen,
    setIsChatOpen,
    isSidebarOpen,
    setIsSidebarOpen,
    isAppearanceOpen,
    setIsAppearanceOpen,
    isSettingsOpen,
    setIsSettingsOpen,
    isImagesOpen,
    setIsImagesOpen,
    isDebugLogsOpen,
    setIsDebugLogsOpen,
    appearanceRef,
  } = useUIPanels();

  const openImagesDialog = useCallback(
    (): void => setIsImagesOpen(true),
    [setIsImagesOpen]
  );

  const {
    viewMode,
    setViewMode,
    showWhitespace,
    setShowWhitespace,
    activeFormats,
    setActiveFormats,
    isViewMenuOpen,
    setIsViewMenuOpen,
    isFormatMenuOpen,
    setIsFormatMenuOpen,
    isMobileFormatMenuOpen,
    setIsMobileFormatMenuOpen,
  } = useEditorUIState();
  const setWorkspaceMode = useUIStore(
    (s: UIStoreState): UIStoreState['setWorkspaceMode'] => s.setWorkspaceMode
  );

  const openSceneEditorDialog = useCallback(
    (
      sceneId: SceneId,
      openedViaTrigger: boolean = false,
      mutationHint: SceneEditorDialogState['mutationHint'] = null
    ): void => {
      setWorkspaceMode('scenes');
      uiStoreActions.openSceneEditorDialog(sceneId, openedViaTrigger, mutationHint);
    },
    [setWorkspaceMode]
  );

  const { editorSettings, setEditorSettings, currentTheme, isLight } =
    useEditorPreferences();

  const {
    openAndExpandStory,
    openSourcebookEntryDialog,
    openStoryMetadataDialog,
    openChapterMetadataDialog,
  } = useSidebarIntents({
    setEditorSettings,
  });

  // Get Active LLM Configs — memoized so hooks that receive these as params
  // don't re-run unnecessarily when unrelated appSettings fields change.
  const { activeChatConfig, activeWritingConfig } = useMemo(
    () => resolveActiveProviderConfigs(appSettings),
    [appSettings]
  );

  const {
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
  } = useAppUiActions({
    editorRef,
    activeFormats,
    setIsFormatMenuOpen,
    setIsMobileFormatMenuOpen,
    selectChapter,
    setIsSidebarOpen,
    setEditorSettings,
    story,
    currentProjectType: story.projectType,
    refreshStory,
    getErrorMessage,
    recordHistoryEntry: pushExternalHistoryEntry,
  });

  const confirmDangerousToolCalls = useCallback(
    async (toolCalls: ChatToolCall[]): Promise<boolean> => {
      const projectCreateCall = toolCalls.find(isManageProjectCreateToolCall);
      if (!projectCreateCall) {
        return true;
      }

      const args = projectCreateCall.args as Record<string, unknown>;
      const createData =
        typeof args.create_data === 'object' && args.create_data !== null
          ? (args.create_data as Record<string, unknown>)
          : {};
      const projectName = String(createData.name ?? '');
      const projectType = String(createData.project_type ?? createData.type ?? 'novel');

      return confirm({
        title: t('Confirm project creation'),
        message: projectName
          ? t(
              'The AI wants to create a new project named "{{name}}" of type "{{type}}". Allow this action?',
              {
                name: projectName,
                type: projectType,
              }
            )
          : t(
              'The AI wants to create a new project of type "{{type}}". Allow this action?',
              {
                type: projectType,
              }
            ),
        confirmLabel: t('Allow'),
        cancelLabel: t('Cancel'),
        variant: 'danger',
      });
    },
    [confirm, t]
  );

  const {
    onMutationClick,
    handleSendMessageWithReset,
    handleStopChat,
    handleRegenerateWithReset,
    handleEditMessage,
    handleDeleteMessage,
    handleNewChat,
    handleSelectChat,
    handleDeleteChat,
    handleDeleteAllChats,
    onUpdateScratchpad,
    onDeleteScratchpad,
  } = useAppChatRuntime({
    storyId: story.id,

    storyRef,
    prompts,
    activeChatConfig,
    isChatAvailable: roleAvailability.chat,
    currentChapterId,
    currentChapterContext,
    advanceBaselineToCurrentStory,
    refreshProjects: async (): Promise<void> => {
      await refreshProjectsRef.current?.();
    },
    refreshStory,
    updateChapter,
    pushExternalHistoryEntry,
    requestToolCallLoopAccess,
    confirmDangerousToolCalls,
    handleChapterSelect,
    openAndExpandStory,
    openSceneEditorDialog,
    openSourcebookEntryDialog,
    openStoryMetadataDialog,
    openChapterMetadataDialog,
  });

  // sessionMutations changes only when LLM tool calls complete (a few times per
  // conversation turn, not per streaming token) – subscribing here is intentional
  // and per the explicit-mutation exception in the architecture decision.
  const sessionMutations = useChatStore((s: ChatStoreState) => s.sessionMutations);
  const sourcebookMutationEntryIds = useMemo(
    (): Set<string> =>
      new Set(
        sessionMutations
          .filter((m: SessionMutation) => m.type === 'sourcebook' && m.targetId)
          .map((m: SessionMutation): string => m.targetId as string)
      ),
    [sessionMutations]
  );

  const {
    continuations,
    suggestionMode,
    setSuggestionMode,
    isSuggesting,
    isSuggestionMode,
    handleTriggerSuggestions,
    handleKeyboardSuggestionAction,
    handleAcceptContinuation,
    cancelSuggestions,
    checkedEntries,
    handleToggleEntry,
    isAutoSourcebookSelectionEnabled,
    setIsAutoSourcebookSelectionEnabled,
    isSourcebookSelectionRunning,
  } = useChapterSuggestions({
    currentUnit: currentChapter || undefined,
    storyTitle: story.title,
    storySummary: story.summary,
    storyStyleTags: story.styleTags,
    activeWritingConfig,
    isWritingAvailable: roleAvailability.writing,
    updateChapter,
    viewMode,
    getErrorMessage,
  });

  // Stabilize checkedSourcebookIds so useAiActions does not receive a new
  // array reference on every render when checkedEntries hasn't changed.
  const checkedSourcebookIdsMemo = useMemo(
    (): string[] => Array.from(checkedEntries),
    [checkedEntries]
  );

  const { isAiActionLoading, handleAiAction, handleSidebarAiAction, cancelAiAction } =
    useAiActions({
      currentUnit: currentChapter || undefined,
      prompts,
      isEditingAvailable: roleAvailability.editing,
      isWritingAvailable: roleAvailability.writing,
      checkedSourcebookIds: checkedSourcebookIdsMemo,
      updateChapter,
      getErrorMessage,
    });

  const {
    projects,
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
  } = useProjectManagement({
    storyId: story.id,
    storyTitle: story.title,
    storyProjectType: story.projectType,
    storyLanguage: story.language ?? 'en',
    storySummary: story.summary,
    storyStyleTags: story.styleTags,
    storyConflicts: story.conflicts,
    refreshStory,
    loadStory,
    updateStoryMetadata,
    handleSelectChat,
    handleNewChat,
    getErrorMessage,
    isSettingsOpen,
    setIsSettingsOpen,
    recordHistoryEntry: pushExternalHistoryEntry,
  });
  refreshProjectsRef.current = refreshProjects;

  // Restore view state (chapter, workspace mode, scenes view type) from
  // backend when the active project changes.
  useEffect((): void => {
    if (story.id) {
      restoreViewState(story.id);
    }
  }, [story.id]);

  // Auto-persist view state to backend when chapter/workspace/scenes-view changes.
  useAutoViewStatePersistence(story.id);

  const { searchState, openSearch, searchHighlightValue, searchReplaceDialogProps } =
    useAppSearchNavigation({
      editorRef,
      currentChapterId,
      currentChapterContent: currentChapter?.content,
      storyLanguage: story.language,
      refreshStory: async (): Promise<void> => {
        await refreshStory();
      },
      handleChapterSelect,
      openSourcebookEntryDialog,
      openStoryMetadataDialog,
    });

  // Minimal theme values needed by the outer wrapper div.
  const bgMain = isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-950';
  const textMain = isLight ? 'text-brand-gray-800' : 'text-brand-gray-300';

  // Memoize so AppChatPanel's React.memo actually fires; without this the
  // chat panel re-renders on every App update even when nothing chat-related
  // changed.
  const chatControls = useMemo(
    () => ({
      isChatOpen,
      setIsChatOpen,
      isChatAvailable: roleAvailability.chat,
      activeChatConfig,
      handleSendMessage: handleSendMessageWithReset,
      handleStopChat,
      handleRegenerate: handleRegenerateWithReset,
      handleEditMessage,
      handleDeleteMessage,
      handleLoadProject,
      handleSelectChat,
      handleNewChat,
      handleDeleteChat,
      handleDeleteAllChats,
      onUpdateScratchpad,
      onDeleteScratchpad,
      onMutationClick,
    }),
    [
      isChatOpen,
      setIsChatOpen,
      roleAvailability.chat,
      activeChatConfig,
      handleSendMessageWithReset,
      handleStopChat,
      handleRegenerateWithReset,
      handleEditMessage,
      handleDeleteMessage,
      handleLoadProject,
      handleSelectChat,
      handleNewChat,
      handleDeleteChat,
      handleDeleteAllChats,
      onUpdateScratchpad,
      onDeleteScratchpad,
      onMutationClick,
    ]
  );

  const { sidebarControls, appMainLayoutProps } = useAppMainLayoutProps({
    viewControls: {
      viewMode,
      setViewMode,
      showWhitespace,
      setShowWhitespace,
      isViewMenuOpen,
      setIsViewMenuOpen,
    },
    formatControls: {
      handleFormat,
      getFormatButtonClass,
      isFormatMenuOpen,
      setIsFormatMenuOpen,
      isMobileFormatMenuOpen,
      setIsMobileFormatMenuOpen,
      onOpenImages: openImagesDialog,
    },
    isSidebarOpen,
    setIsSidebarOpen,
    currentChapterId,
    handleChapterSelect,
    deleteChapter,
    updateChapter: (id: string, partial: Record<string, unknown>): Promise<void> =>
      updateChapter(id, partial, true, true, true),
    updateBook,
    addChapter,
    handleBookCreate,
    handleBookDelete,
    handleReorderChapters,
    handleReorderBooks,
    handleSidebarAiAction,
    isEditingAvailable: roleAvailability.editing,
    handleOpenImages,
    updateStoryMetadata,
    checkedEntries,
    handleToggleEntry,
    isAutoSourcebookSelectionEnabled,
    setIsAutoSourcebookSelectionEnabled,
    isSourcebookSelectionRunning,
    sourcebookMutationEntryIds,
    baselineState,
    advanceBaselineToCurrentStory,
    patchSourcebook,
    pushExternalHistoryEntry,
    refreshStory,
    undo,
    redo,
    canUndo,
    canRedo,
    searchState,
    currentChapter,
    isChapterLoading,
    editorRef,
    editorSettings,
    storyLanguage: story.language,
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
    isWritingAvailable: roleAvailability.writing,
    setActiveFormats,
    showWhitespace,
    setShowWhitespace,
    editorBaselineContent,
    openSearch,
    chatControls,
    instructionLanguages,
  });

  const appHeaderProps = useAppHeaderProps({
    storyTitle: story.title,
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
    openImagesDialog,
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
    isWritingAvailable: roleAvailability.writing,
    isCurrentChapterEmpty,
    isChatOpen,
    setIsChatOpen,
    openSearch,
  });

  return (
    <AppLayout
      confirm={confirm}
      searchHighlightValue={searchHighlightValue}
      currentTheme={currentTheme}
      confirmDialogState={confirmDialogState}
      handleConfirm={handleConfirm}
      handleCancel={handleCancel}
      bgMain={bgMain}
      textMain={textMain}
      sidebarWidth={editorSettings.sidebarWidth}
      appDialogsProps={{
        isSettingsOpen,
        setIsSettingsOpen,
        appSettings,
        setAppSettings: handleSaveSettings,
        projects,
        story,
        handleLoadProject,
        handleCreateProject,
        handleImportProject,
        handleDeleteProject,
        handleRenameProject,
        handleConvertProject,
        refreshProjects,
        currentTheme,
        prompts,
        instructionLanguages,
        isImagesOpen,
        setIsImagesOpen,
        updateStoryImageSettings,
        imageActionsAvailable,
        recordHistoryEntry: pushExternalHistoryEntry,
        editorRef,
        isCreateProjectOpen,
        setIsCreateProjectOpen,
        handleCreateProjectConfirm,
      }}
      appHeaderProps={appHeaderProps}
      appMainLayoutProps={appMainLayoutProps}
      isDebugLogsOpen={isDebugLogsOpen}
      setIsDebugLogsOpen={setIsDebugLogsOpen}
      toolCallLoopDialog={toolCallLoopDialog}
      searchReplaceDialogProps={searchReplaceDialogProps}
    />
  );
};

export default App;
