// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines shared layout control-bundle types so prop contracts stay consistent across layout components.
 */

import type { ComponentProps, RefObject } from 'react';

import type {
  AppSettings,
  AppTheme,
  Chapter,
  ChatAttachment,
  EditorSettings,
  LLMConfig,
  StoryState,
  SourcebookEntry,
  SuggestionGenerationMode,
  ViewMode,
  WritingUnit,
} from '../../types';
import type { ModelSelector } from '../chat/ModelSelector';
import type { EditorHandle } from '../editor/Editor';
import type { SessionMutation } from '../chat/components/MutationTags';

export type HeaderSidebarControls = {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (v: boolean) => void;
};

export type HeaderSettingsControls = {
  setIsSettingsOpen: (v: boolean) => void;
  setIsImagesOpen: (v: boolean) => void;
  setIsDebugLogsOpen: (v: boolean) => void;
};

export type HeaderHistoryControls = {
  undo: () => void;
  redo: () => void;
  undoSteps: (steps: number) => void;
  redoSteps: (steps: number) => void;
  undoOptions: Array<{ id: string; label: string; steps: number }>;
  redoOptions: Array<{ id: string; label: string; steps: number }>;
  nextUndoLabel: string | null;
  nextRedoLabel: string | null;
  canUndo: boolean;
  canRedo: boolean;
};

export type HeaderViewControls = {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  showWhitespace: boolean;
  setShowWhitespace: (v: boolean) => void;
  isViewMenuOpen: boolean;
  setIsViewMenuOpen: (v: boolean) => void;
};

export type HeaderFormatControls = {
  handleFormat: (type: string) => void;
  getFormatButtonClass: (type: string) => string;
  isFormatMenuOpen: boolean;
  setIsFormatMenuOpen: (v: boolean) => void;
  isMobileFormatMenuOpen: boolean;
  setIsMobileFormatMenuOpen: (v: boolean) => void;
  onOpenImages: () => void;
};

export type HeaderAiControls = {
  handleAiAction: (
    target: 'summary' | 'chapter',
    action: 'update' | 'rewrite' | 'extend'
  ) => Promise<void>;
  isAiActionLoading: boolean;
  isWritingAvailable: boolean;
  isChapterEmpty?: boolean;
};

export type HeaderModelControls = {
  appSettings: AppSettings;
  setAppSettings: (v: AppSettings) => void;
  saveSettings?: (settings: AppSettings) => Promise<void>;
  modelConnectionStatus: ComponentProps<typeof ModelSelector>['connectionStatus'];
  detectedCapabilities: ComponentProps<typeof ModelSelector>['detectedCapabilities'];
  recheckUnavailableProviderIfStale: (providerId: string, minAgeMs?: number) => void;
};

export type HeaderAppearanceControlsState = {
  appearanceRef: RefObject<HTMLDivElement | null>;
  isAppearanceOpen: boolean;
  setIsAppearanceOpen: (v: boolean) => void;
  setAppTheme: (theme: AppTheme) => void;
  editorSettings: EditorSettings;
  setEditorSettings: (
    v: EditorSettings | ((prev: EditorSettings) => EditorSettings)
  ) => void;
};

export type HeaderSearchControls = {
  onOpenSearch: () => void;
};

export type HeaderChatPanelControls = {
  isChatOpen: boolean;
  setIsChatOpen: (v: boolean) => void;
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
  setIsSidebarOpen: (v: boolean) => void;
  currentChapterId: string | null;
  handleChapterSelect: (id: string | null) => void;
  deleteChapter: (id: string) => Promise<void>;
  updateChapter: (
    id: string,
    partial: Partial<Chapter>,
    sync?: boolean,
    pushHistory?: boolean,
    isUserEdit?: boolean
  ) => Promise<void>;
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
    type: 'chapter' | 'book' | 'story',
    id: string,
    action: 'write' | 'update' | 'rewrite',
    onProgress?: (text: string) => void,
    currentText?: string,
    onThinking?: (thinking: string) => void,
    source?: 'chapter' | 'notes'
  ) => Promise<string | undefined>;
  isEditingAvailable: boolean;
  handleOpenImages: () => void;
  // story metadata updates now include optional language so that the UI
  // can propagate project language changes from the metadata editor.
  updateStoryMetadata: (
    title: string,
    summary: string,
    tags: string[],
    notes?: string,
    private_notes?: string,
    conflicts?: Array<{ id: string; description: string; resolution: string }>,
    language?: string
  ) => Promise<void>;
  // optional sourcebook relevance controls (provided by suggestions hook)
  checkedSourcebookIds?: string[];
  onToggleSourcebook?: (id: string, checked: boolean) => void;
  isAutoSourcebookSelectionEnabled?: boolean;
  onToggleAutoSourcebookSelection?: (enabled: boolean) => void;
  isSourcebookSelectionRunning?: boolean;
  mutatedSourcebookEntryIds?: Set<string>;
  onSourcebookMutated?: (entry: {
    label: string;
    onUndo?: () => Promise<void>;
    onRedo?: () => Promise<void>;
    entryId?: string;
    entryExistsInBaseline?: boolean;
    /** The upserted entry after create/update, or null after delete.
     *  When provided, the receiver should patch story.sourcebook directly
     *  instead of calling refreshStory() to avoid a full app re-render. */
    updatedEntry?: SourcebookEntry | null;
  }) => Promise<void>;
  onAppUndo?: () => Promise<void>;
  onAppRedo?: () => Promise<void>;
  // canAppUndo / canAppRedo removed: AppSidebar reads them from storyStore
  // via useStoryHistoryState() to avoid destabilising sidebarControls.
};

export type MainEditorSuggestionControls = {
  continuations: string[];
  suggestionMode: SuggestionGenerationMode;
  setSuggestionMode: (mode: SuggestionGenerationMode) => void;
  isSuggesting: boolean;
  handleTriggerSuggestions: (
    cursor?: number,
    contentOverride?: string,
    enableSuggestionMode?: boolean
  ) => Promise<void>;
  handleCancelSuggestions: () => void;
  handleAcceptContinuation: (text: string, contentOverride?: string) => Promise<void>;
  isSuggestionMode: boolean;
  handleKeyboardSuggestionAction: (
    action: 'trigger' | 'chooseLeft' | 'chooseRight' | 'regenerate' | 'undo' | 'exit',
    cursor?: number,
    contentOverride?: string
  ) => Promise<void>;
};

export type MainEditorAiControls = {
  handleAiAction: (
    target: 'summary' | 'chapter',
    action: 'update' | 'rewrite' | 'extend'
  ) => Promise<void>;
  isAiActionLoading: boolean;
  isWritingAvailable: boolean;
  cancelAiAction: () => void;
  isChapterEmpty?: boolean;
  /** True whenever any LLM is writing prose into the editor (direct AI action or chat-tool streaming). */
  isProseStreaming?: boolean;
};

export type MainEditorControls = {
  currentChapter?: WritingUnit | null;
  isChapterLoading?: boolean;
  editorRef: RefObject<EditorHandle | null>;
  editorSettings: EditorSettings;
  storyLanguage?: string;
  setEditorSettings: (
    v: EditorSettings | ((prev: EditorSettings) => EditorSettings)
  ) => void;
  viewMode: ViewMode;
  updateChapter: (
    id: string,
    partial: Partial<WritingUnit>,
    sync?: boolean,
    pushHistory?: boolean,
    isUserEdit?: boolean
  ) => Promise<void>;
  suggestionControls: MainEditorSuggestionControls;
  aiControls: MainEditorAiControls;
  setActiveFormats: (v: string[]) => void;
  showWhitespace: boolean;
  setShowWhitespace: (v: boolean) => void;
  baselineContent?: string;
  onOpenSearch?: () => void;
  recordHistoryEntry?: (params: {
    label: string;
    state?: StoryState;
    onUndo?: () => Promise<void> | void;
    onRedo?: () => Promise<void> | void;
    forceNewHistory?: boolean;
  }) => void;
};

export type MainChatControls = {
  isChatOpen: boolean;
  setIsChatOpen: (v: boolean) => void;
  isChatAvailable: boolean;
  activeChatConfig: LLMConfig;
  handleSendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>;
  handleStopChat: () => void;
  handleRegenerate: () => Promise<void>;
  handleEditMessage: (id: string, newText: string) => void;
  handleDeleteMessage: (id: string) => void;
  handleLoadProject: (
    projectId: string,
    options?: { preserveActiveChatSession?: boolean }
  ) => Promise<void>;
  handleSelectChat: (chatId: string) => Promise<void>;
  handleNewChat: (incognito?: boolean) => void;
  handleDeleteChat: (chatId: string) => Promise<void>;
  handleDeleteAllChats: () => Promise<void>;
  onUpdateScratchpad: (content: string) => void;
  onDeleteScratchpad: () => void;
  onMutationClick: (m: SessionMutation) => void;
};
