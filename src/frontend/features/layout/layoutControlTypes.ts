// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines shared layout control-bundle types so prop contracts stay consistent across layout components.
 */

import type { ComponentProps, Dispatch, RefObject, SetStateAction } from 'react';

import type {
  AppSettings,
  AppTheme,
  Chapter,
  ChatMessage,
  ChatSession,
  EditorSettings,
  StoryState,
  ViewMode,
} from '../../types';
import type { ModelSelector } from '../chat/ModelSelector';
import type { EditorHandle } from '../editor/Editor';

export type HeaderSidebarControls = {
  isSidebarOpen: boolean;
  setIsSidebarOpen: Dispatch<SetStateAction<boolean>>;
};

export type HeaderSettingsControls = {
  setIsSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setIsImagesOpen: Dispatch<SetStateAction<boolean>>;
  setIsDebugLogsOpen: Dispatch<SetStateAction<boolean>>;
};

export type HeaderHistoryControls = {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export type HeaderViewControls = {
  viewMode: ViewMode;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  showWhitespace: boolean;
  setShowWhitespace: Dispatch<SetStateAction<boolean>>;
  isViewMenuOpen: boolean;
  setIsViewMenuOpen: Dispatch<SetStateAction<boolean>>;
};

export type HeaderFormatControls = {
  handleFormat: (type: string) => void;
  getFormatButtonClass: (type: string) => string;
  isFormatMenuOpen: boolean;
  setIsFormatMenuOpen: Dispatch<SetStateAction<boolean>>;
  isMobileFormatMenuOpen: boolean;
  setIsMobileFormatMenuOpen: Dispatch<SetStateAction<boolean>>;
};

export type HeaderAiControls = {
  handleAiAction: (
    target: 'summary' | 'chapter',
    action: 'update' | 'rewrite' | 'extend'
  ) => Promise<void>;
  isAiActionLoading: boolean;
};

export type HeaderModelControls = {
  appSettings: AppSettings;
  setAppSettings: Dispatch<SetStateAction<AppSettings>>;
  modelConnectionStatus: ComponentProps<typeof ModelSelector>['connectionStatus'];
  detectedCapabilities: ComponentProps<typeof ModelSelector>['detectedCapabilities'];
};

export type HeaderAppearanceControlsState = {
  appearanceRef: RefObject<HTMLDivElement | null>;
  isAppearanceOpen: boolean;
  setIsAppearanceOpen: Dispatch<SetStateAction<boolean>>;
  setAppTheme: (theme: AppTheme) => void;
  editorSettings: EditorSettings;
  setEditorSettings: Dispatch<SetStateAction<EditorSettings>>;
};

export type HeaderChatPanelControls = {
  isChatOpen: boolean;
  setIsChatOpen: Dispatch<SetStateAction<boolean>>;
};

export type HeaderThemeTokens = {
  isLight: boolean;
  iconColor: string;
  iconHover: string;
  dividerColor: string;
  buttonActive: string;
  currentTheme: AppTheme;
};

export type MainSidebarControls = {
  isSidebarOpen: boolean;
  setIsSidebarOpen: Dispatch<SetStateAction<boolean>>;
  story: StoryState;
  currentChapterId: string | null;
  handleChapterSelect: (id: string) => void;
  deleteChapter: (id: string) => Promise<void>;
  updateChapter: (id: string, partial: Partial<Chapter>) => Promise<void>;
  updateBook: (
    id: string,
    partial: { title?: string; summary?: string }
  ) => Promise<void>;
  addChapter: (title?: string, content?: string, bookId?: string) => Promise<void>;
  handleBookCreate: (title: string) => Promise<void>;
  handleBookDelete: (id: string) => Promise<void>;
  handleReorderChapters: (chapterIds: number[], bookId?: string) => Promise<void>;
  handleReorderBooks: (bookIds: string[]) => Promise<void>;
  handleSidebarAiAction: (
    type: 'chapter' | 'book',
    id: string,
    action: 'write' | 'update' | 'rewrite',
    onProgress?: (text: string) => void
  ) => Promise<string | undefined>;
  handleOpenImages: () => void;
  updateStoryMetadata: (
    updates: Partial<{
      title: string;
      summary: string;
      styleTags: string[];
      notes: string;
      private_notes: string;
      conflicts: string[];
    }>
  ) => Promise<void>;
};

export type MainEditorSuggestionControls = {
  continuations: string[];
  isSuggesting: boolean;
  handleTriggerSuggestions: (
    cursor?: number,
    contentOverride?: string,
    enableSuggestionMode?: boolean
  ) => Promise<void>;
  handleAcceptContinuation: (text: string) => Promise<void>;
  isSuggestionMode: boolean;
  handleKeyboardSuggestionAction: (
    action: 'trigger' | 'chooseLeft' | 'chooseRight' | 'regenerate' | 'undo' | 'exit',
    cursor?: number
  ) => Promise<void>;
};

export type MainEditorAiControls = {
  handleAiAction: (
    target: 'summary' | 'chapter',
    action: 'update' | 'rewrite' | 'extend'
  ) => Promise<void>;
  isAiActionLoading: boolean;
};

export type MainEditorControls = {
  currentChapter?: Chapter;
  editorRef: RefObject<EditorHandle | null>;
  editorSettings: EditorSettings;
  viewMode: ViewMode;
  updateChapter: (id: string, partial: Partial<Chapter>) => Promise<void>;
  suggestionControls: MainEditorSuggestionControls;
  aiControls: MainEditorAiControls;
  setActiveFormats: Dispatch<SetStateAction<string[]>>;
  showWhitespace: boolean;
  setShowWhitespace: Dispatch<SetStateAction<boolean>>;
};

export type MainChatControls = {
  isChatOpen: boolean;
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  systemPrompt: string;
  handleSendMessage: (text: string) => Promise<void>;
  handleStopChat: () => void;
  handleRegenerate: () => Promise<void>;
  handleEditMessage: (id: string, newText: string) => void;
  handleDeleteMessage: (id: string) => void;
  setSystemPrompt: Dispatch<SetStateAction<string>>;
  handleLoadProject: (projectId: string) => Promise<void>;
  incognitoSessions: ChatSession[];
  chatHistoryList: ChatSession[];
  currentChatId: string | null;
  isIncognito: boolean;
  handleSelectChat: (chatId: string) => Promise<void>;
  handleNewChat: () => Promise<void>;
  handleDeleteChat: (chatId: string) => Promise<void>;
  handleDeleteAllChats: () => Promise<void>;
  setIsIncognito: Dispatch<SetStateAction<boolean>>;
  allowWebSearch: boolean;
  setAllowWebSearch: Dispatch<SetStateAction<boolean>>;
};
