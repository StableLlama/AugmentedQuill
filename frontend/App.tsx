// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the app unit so this responsibility stays isolated, testable, and easy to evolve.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useStory } from './features/story/useStory';
import { StoryMetadata } from './features/story/StoryMetadata';
import { ChapterList } from './features/chapters/ChapterList';
import { useChapterSuggestions } from './features/chapters/useChapterSuggestions';
import { Editor, EditorHandle } from './features/editor/Editor';
import { useAppUiActions } from './features/editor/useAppUiActions';
import { useEditorPreferences } from './features/editor/useEditorPreferences';
import { useAiActions } from './features/story/useAiActions';
import { Chat } from './features/chat/Chat';
import { useChatExecution } from './features/chat/useChatExecution';
import { useChatMessageActions } from './features/chat/useChatMessageActions';
import { ToolCallLimitDialog } from './features/chat/ToolCallLimitDialog';
import { useChatSessionManagement } from './features/chat/useChatSessionManagement';
import { AppDialogs } from './features/layout/AppDialogs';
import { AppHeader } from './features/layout/AppHeader';
import { AppMainLayout } from './features/layout/AppMainLayout';
import { ConfirmDialog } from './features/layout/ConfirmDialog';
import { useConfirmDialog } from './features/layout/useConfirmDialog';
import { ThemeProvider } from './features/layout/ThemeContext';
import { useProjectManagement } from './features/projects/useProjectManagement';
import { DebugLogs } from './features/debug/DebugLogs';
import { useAppSettings } from './features/settings/useAppSettings';
import { useProviderHealth } from './features/settings/useProviderHealth';
import { usePrompts } from './features/settings/usePrompts';
import { ChatMessage, ViewMode, AppSettings, DEFAULT_LLM_CONFIG } from './types';

// Default Settings
const DEFAULT_APP_SETTINGS: AppSettings = {
  providers: [DEFAULT_LLM_CONFIG],
  activeChatProviderId: DEFAULT_LLM_CONFIG.id,
  activeWritingProviderId: DEFAULT_LLM_CONFIG.id,
  activeEditingProviderId: DEFAULT_LLM_CONFIG.id,
  editor: {
    fontSize: 18,
    maxWidth: 60,
    brightness: 0.95,
    contrast: 0.9,
    theme: 'mixed',
    sidebarWidth: 320,
  },
  sidebarOpen: false,
  activeTab: 'chat',
};

const App: React.FC = () => {
  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  const { confirm, confirmDialogState, handleConfirm, handleCancel } =
    useConfirmDialog();

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
    canUndo,
    canRedo,
  } = useStory({ confirm, alert: window.alert });

  const currentChapter = story.chapters.find((c) => c.id === currentChapterId);
  const editorRef = useRef<EditorHandle | null>(null);
  const appearanceRef = useRef<HTMLDivElement>(null);

  const { appSettings, setAppSettings } = useAppSettings(DEFAULT_APP_SETTINGS);

  const prompts = usePrompts(story.id);

  const { modelConnectionStatus, detectedCapabilities } =
    useProviderHealth(appSettings);

  const [toolCallLoopDialog, setToolCallLoopDialog] = useState<{
    count: number;
    resolver: (choice: 'stop' | 'continue' | 'unlimited') => void;
  } | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        appearanceRef.current &&
        !appearanceRef.current.contains(event.target as Node)
      ) {
        setIsAppearanceOpen(false);
      }
    }

    if (isAppearanceOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAppearanceOpen]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isImagesOpen, setIsImagesOpen] = useState(false);
  const [isDebugLogsOpen, setIsDebugLogsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('raw');
  const [showWhitespace, setShowWhitespace] = useState<boolean>(false);
  const [activeFormats, setActiveFormats] = useState<string[]>([]);

  // UI State for Header Dropdowns
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
  const [isMobileFormatMenuOpen, setIsMobileFormatMenuOpen] = useState(false);

  const { editorSettings, setEditorSettings, currentTheme, isLight } =
    useEditorPreferences();

  const buttonActive = isLight
    ? 'bg-brand-100 text-brand-700'
    : 'bg-brand-900/40 text-brand-300 border border-brand-800/50';

  // Project Management Functions
  const getSystemPrompt = useCallback(() => {
    return prompts.system_messages.chat_llm || '';
  }, [prompts]);

  const {
    chatHistoryList,
    setChatHistoryList,
    currentChatId,
    isIncognito,
    setIsIncognito,
    allowWebSearch,
    setAllowWebSearch,
    systemPrompt,
    setSystemPrompt,
    incognitoSessions,
    refreshChatList,
    handleNewChat,
    handleSelectChat,
    handleDeleteChat,
    handleDeleteAllChats,
  } = useChatSessionManagement({
    storyId: story.id,
    getSystemPrompt,
    chatMessages,
    setChatMessages,
    isChatLoading,
  });

  const {
    projects,
    refreshProjects,
    isCreateProjectOpen,
    setIsCreateProjectOpen,
    handleLoadProject,
    handleImportProject,
    handleCreateProject,
    handleCreateProjectConfirm,
    handleDeleteProject,
    handleRenameProject,
  } = useProjectManagement({
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
  });

  // Get Active LLM Configs
  const activeChatConfig =
    appSettings.providers.find((p) => p.id === appSettings.activeChatProviderId) ||
    appSettings.providers[0];
  const activeWritingConfig =
    appSettings.providers.find((p) => p.id === appSettings.activeWritingProviderId) ||
    appSettings.providers[0];
  const activeEditingConfig =
    appSettings.providers.find((p) => p.id === appSettings.activeEditingProviderId) ||
    appSettings.providers[0];

  const { isAiActionLoading, handleAiAction, handleSidebarAiAction } = useAiActions({
    currentChapter,
    story,
    prompts,
    systemPrompt,
    activeEditingConfig,
    activeWritingConfig,
    updateChapter,
    setChatMessages,
    getErrorMessage,
  });

  const { handleEditMessage, handleDeleteMessage } = useChatMessageActions({
    setChatMessages,
  });

  const {
    continuations,
    isSuggesting,
    isSuggestionMode,
    suggestCursor,
    handleTriggerSuggestions,
    handleKeyboardSuggestionAction,
    handleAcceptContinuation,
  } = useChapterSuggestions({
    currentChapter,
    currentChapterId,
    story,
    systemPrompt,
    activeWritingConfig,
    updateChapter,
    viewMode,
    setChatMessages,
    getErrorMessage,
  });

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
    refreshStory,
    getErrorMessage,
  });

  const requestToolCallLoopAccess = (
    count: number
  ): Promise<'stop' | 'continue' | 'unlimited'> => {
    return new Promise((resolve) => {
      setToolCallLoopDialog({
        count,
        resolver: (choice) => {
          setToolCallLoopDialog(null);
          resolve(choice);
        },
      });
    });
  };

  const { handleSendMessage, handleStopChat, handleRegenerate } = useChatExecution({
    systemPrompt,
    activeChatConfig,
    allowWebSearch,
    currentChapterId,
    chatMessages,
    setChatMessages,
    isChatLoading,
    setIsChatLoading,
    refreshProjects,
    refreshStory,
    requestToolCallLoopAccess,
  });

  // Minimal theme values needed by the outer wrapper div.
  const bgMain = isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-950';
  const textMain = isLight ? 'text-brand-gray-800' : 'text-brand-gray-300';

  return (
    <ThemeProvider currentTheme={currentTheme}>
      <div
        className={`flex flex-col h-screen font-sans overflow-hidden ${bgMain} ${textMain}`}
        style={
          {
            '--sidebar-width': `${editorSettings.sidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <AppDialogs
          isSettingsOpen={isSettingsOpen}
          setIsSettingsOpen={setIsSettingsOpen}
          appSettings={appSettings}
          setAppSettings={setAppSettings}
          projects={projects}
          story={story}
          handleLoadProject={handleLoadProject}
          handleCreateProject={handleCreateProject}
          handleImportProject={handleImportProject}
          handleDeleteProject={handleDeleteProject}
          handleRenameProject={handleRenameProject}
          handleConvertProject={handleConvertProject}
          refreshProjects={refreshProjects}
          currentTheme={currentTheme}
          prompts={prompts}
          isImagesOpen={isImagesOpen}
          setIsImagesOpen={setIsImagesOpen}
          updateStoryImageSettings={updateStoryImageSettings}
          editorRef={editorRef}
          isCreateProjectOpen={isCreateProjectOpen}
          setIsCreateProjectOpen={setIsCreateProjectOpen}
          handleCreateProjectConfirm={handleCreateProjectConfirm}
        />

        <AppHeader
          storyTitle={story.title}
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          setIsSettingsOpen={setIsSettingsOpen}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          viewMode={viewMode}
          setViewMode={setViewMode}
          showWhitespace={showWhitespace}
          setShowWhitespace={setShowWhitespace}
          isViewMenuOpen={isViewMenuOpen}
          setIsViewMenuOpen={setIsViewMenuOpen}
          handleFormat={handleFormat}
          getFormatButtonClass={getFormatButtonClass}
          isFormatMenuOpen={isFormatMenuOpen}
          setIsFormatMenuOpen={setIsFormatMenuOpen}
          isMobileFormatMenuOpen={isMobileFormatMenuOpen}
          setIsMobileFormatMenuOpen={setIsMobileFormatMenuOpen}
          handleAiAction={handleAiAction}
          isAiActionLoading={isAiActionLoading}
          appSettings={appSettings}
          setAppSettings={setAppSettings}
          modelConnectionStatus={modelConnectionStatus}
          detectedCapabilities={detectedCapabilities}
          setIsImagesOpen={setIsImagesOpen}
          appearanceRef={appearanceRef}
          isAppearanceOpen={isAppearanceOpen}
          setIsAppearanceOpen={setIsAppearanceOpen}
          setAppTheme={setAppTheme}
          editorSettings={editorSettings}
          setEditorSettings={setEditorSettings}
          setIsDebugLogsOpen={setIsDebugLogsOpen}
          isChatOpen={isChatOpen}
          setIsChatOpen={setIsChatOpen}
        />

        <AppMainLayout
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          story={story}
          currentChapterId={currentChapterId}
          handleChapterSelect={handleChapterSelect}
          deleteChapter={deleteChapter}
          updateChapter={updateChapter}
          updateBook={updateBook}
          addChapter={addChapter}
          handleBookCreate={handleBookCreate}
          handleBookDelete={handleBookDelete}
          handleReorderChapters={handleReorderChapters}
          handleReorderBooks={handleReorderBooks}
          handleSidebarAiAction={handleSidebarAiAction}
          handleOpenImages={handleOpenImages}
          updateStoryMetadata={updateStoryMetadata}
          currentChapter={currentChapter}
          editorRef={editorRef}
          editorSettings={editorSettings}
          viewMode={viewMode}
          continuations={continuations}
          isSuggesting={isSuggesting}
          handleTriggerSuggestions={handleTriggerSuggestions}
          handleAcceptContinuation={handleAcceptContinuation}
          isSuggestionMode={isSuggestionMode}
          handleKeyboardSuggestionAction={handleKeyboardSuggestionAction}
          handleAiAction={handleAiAction}
          isAiActionLoading={isAiActionLoading}
          setActiveFormats={setActiveFormats}
          showWhitespace={showWhitespace}
          setShowWhitespace={setShowWhitespace}
          isChatOpen={isChatOpen}
          chatMessages={chatMessages}
          isChatLoading={isChatLoading}
          systemPrompt={systemPrompt}
          handleSendMessage={handleSendMessage}
          handleStopChat={handleStopChat}
          handleRegenerate={handleRegenerate}
          handleEditMessage={handleEditMessage}
          handleDeleteMessage={handleDeleteMessage}
          setSystemPrompt={setSystemPrompt}
          handleLoadProject={handleLoadProject}
          incognitoSessions={incognitoSessions}
          chatHistoryList={chatHistoryList}
          currentChatId={currentChatId}
          isIncognito={isIncognito}
          handleSelectChat={handleSelectChat}
          handleNewChat={handleNewChat}
          handleDeleteChat={handleDeleteChat}
          handleDeleteAllChats={handleDeleteAllChats}
          setIsIncognito={setIsIncognito}
          allowWebSearch={allowWebSearch}
          setAllowWebSearch={setAllowWebSearch}
        />

        <DebugLogs
          isOpen={isDebugLogsOpen}
          onClose={() => setIsDebugLogsOpen(false)}
          theme={currentTheme}
        />

        <ToolCallLimitDialog
          isOpen={!!toolCallLoopDialog}
          count={toolCallLoopDialog?.count ?? 0}
          theme={currentTheme}
          onResolve={(choice) => toolCallLoopDialog?.resolver(choice)}
        />

        <ConfirmDialog
          isOpen={confirmDialogState.isOpen}
          message={confirmDialogState.message}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      </div>
    </ThemeProvider>
  );
};

export default App;
