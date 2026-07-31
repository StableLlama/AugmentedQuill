// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the chat context unit so this responsibility stays isolated, testable, and easy to evolve.
 * Provides all chat state and callbacks to the Chat component tree via React context,
 * eliminating the 29-prop drilling chain through AppMainLayout and AppChatPanel.
 */

import React, { createContext, useContext } from 'react';
import {
  ChatMessage,
  ChatAttachment,
  AppTheme,
  ChatSession,
  LLMConfig,
} from '../../types';
import { SessionMutation } from './components/MutationTags';

export interface ChatContextValue {
  /** Whether the chat panel is open/visible. */
  isChatOpen: boolean;
  messages: ChatMessage[];
  isLoading: boolean;
  isModelAvailable: boolean;
  activeChatConfig: LLMConfig;
  systemPrompt: string;
  onSendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>;
  onStop: () => void;
  onRegenerate: () => Promise<void>;
  onEditMessage: (id: string, newText: string) => void;
  onDeleteMessage: (id: string) => void;
  onUpdateSystemPrompt: (newPrompt: string) => void;
  onSwitchProject: (
    projectId: string,
    options?: { preserveActiveChatSession?: boolean }
  ) => Promise<void>;
  /** Merged list of incognito + persistent chat sessions. */
  sessions: ChatSession[];
  currentSessionId: string | null;
  isIncognito: boolean;
  onSelectSession: (id: string) => Promise<void>;
  onNewSession: (incognito?: boolean) => void;
  onDeleteSession: (id: string) => Promise<void>;
  onDeleteAllSessions: () => Promise<void>;
  onToggleIncognito: (val: boolean) => void;
  allowWebSearch: boolean;
  onToggleWebSearch: (val: boolean) => void;
  scratchpad: string;
  onUpdateScratchpad: (content: string) => void;
  onDeleteScratchpad: () => void;
  sessionMutations: SessionMutation[];
  onMutationClick: (m: SessionMutation) => void;
  storyLanguage: string;
  currentTheme: AppTheme;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export const useChatContext = (): ChatContextValue => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be called inside <ChatProvider>');
  return ctx;
};

interface ChatProviderProps {
  value: ChatContextValue;
  children: React.ReactNode;
}

export const ChatProvider: React.FC<ChatProviderProps> = ({
  value,
  children,
}: ChatProviderProps) => (
  <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
);
