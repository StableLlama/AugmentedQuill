// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Zustand store for all chat runtime state – messages, session metadata,
 * and user preferences.  Moving this out of App-level useState ensures that
 * chat updates (including every streaming token) never trigger a re-render of
 * the root App component or unrelated subtrees such as the Editor and Sidebar.
 *
 * Only components that subscribe to a slice of this store (e.g. AppChatPanel)
 * will re-render when that slice changes.  App.tsx itself must not import any
 * store selectors from this file – it may only call getState()-based writes
 * through stable callbacks returned by useAppChatRuntime.
 */

import { create, StoreApi } from 'zustand';
import type { ChatMessage, ChatSession } from '../types';
import type { SessionMutation } from '../features/chat/components/MutationTags';

// ---------------------------------------------------------------------------
// Helper – resolves functional updaters the same way React setState does.
// ---------------------------------------------------------------------------

function resolve<T>(valueOrUpdater: T | ((prev: T) => T), prev: T): T {
  return typeof valueOrUpdater === 'function'
    ? (valueOrUpdater as (p: T) => T)(prev)
    : valueOrUpdater;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface ChatStoreState {
  // ── Frequently changing (every streaming token) ─────────────────────────
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  sessionMutations: SessionMutation[];
  latestServerUsage: Record<string, unknown> | null;

  // ── Prose streaming flag (only flips at turn start/end) ──────────────────
  /** True only while chat is actively writing prose into the editor. */
  isProseStreamingFromChat: boolean;
  /**
   * True after the user stops chat mid-write: streaming is done but the
   * editor keeps streamingMode=true (prefix diff) so the green block stays
   * visible.  Cleared when the next chat interaction begins.
   */
  isProseStreamingFrozen: boolean;

  // ── Session management ────────────────────────────────────────────────────
  chatHistoryList: ChatSession[];
  currentChatId: string | null;
  incognitoSessions: ChatSession[];
  projectContextRevision: number | null;

  // ── User preferences (rarely changing) ───────────────────────────────────
  isIncognito: boolean;
  allowWebSearch: boolean;
  systemPrompt: string;
  scratchpad: string;

  // ── Actions ───────────────────────────────────────────────────────────────
  setChatMessages: (
    v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => void;
  setIsChatLoading: (v: boolean) => void;
  setIsProseStreamingFromChat: (v: boolean) => void;
  setIsProseStreamingFrozen: (v: boolean) => void;
  /** Atomically clears isProseStreamingFromChat and sets isProseStreamingFrozen=true
   * so no render frame sees both flags false (which would drop the green highlight). */
  freezeProseStreaming: () => void;
  setSessionMutations: (
    v: SessionMutation[] | ((prev: SessionMutation[]) => SessionMutation[])
  ) => void;
  setLatestServerUsage: (v: Record<string, unknown> | null) => void;
  setChatHistoryList: (
    v: ChatSession[] | ((prev: ChatSession[]) => ChatSession[])
  ) => void;
  setCurrentChatId: (id: string | null) => void;
  setIncognitoSessions: (
    v: ChatSession[] | ((prev: ChatSession[]) => ChatSession[])
  ) => void;
  setProjectContextRevision: (v: number | null) => void;
  setIsIncognito: (v: boolean) => void;
  setAllowWebSearch: (v: boolean) => void;
  setSystemPrompt: (v: string | ((prev: string) => string)) => void;
  setScratchpad: (v: string) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useChatStore = create<ChatStoreState>()(
  (set: StoreApi<ChatStoreState>['setState']) => ({
    chatMessages: [],
    isChatLoading: false,
    isProseStreamingFromChat: false,
    isProseStreamingFrozen: false,
    sessionMutations: [],
    latestServerUsage: null,
    chatHistoryList: [],
    currentChatId: null,
    incognitoSessions: [],
    projectContextRevision: null,
    isIncognito: false,
    allowWebSearch: false,
    systemPrompt: '',
    scratchpad: '',

    setChatMessages: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) =>
      set((s: ChatStoreState): { chatMessages: ChatMessage[] } => ({
        chatMessages: resolve(v, s.chatMessages),
      })),
    setIsChatLoading: (v: boolean) =>
      set((s: ChatStoreState): ChatStoreState | { isChatLoading: boolean } =>
        s.isChatLoading === v ? s : { isChatLoading: v }
      ),
    setIsProseStreamingFromChat: (v: boolean) =>
      set(
        (s: ChatStoreState): ChatStoreState | { isProseStreamingFromChat: boolean } =>
          s.isProseStreamingFromChat === v ? s : { isProseStreamingFromChat: v }
      ),
    setIsProseStreamingFrozen: (v: boolean) =>
      set((s: ChatStoreState): ChatStoreState | { isProseStreamingFrozen: boolean } =>
        s.isProseStreamingFrozen === v ? s : { isProseStreamingFrozen: v }
      ),
    freezeProseStreaming: () =>
      set(
        (): { isProseStreamingFromChat: boolean; isProseStreamingFrozen: boolean } => ({
          isProseStreamingFromChat: false,
          isProseStreamingFrozen: true,
        })
      ),
    setSessionMutations: (
      v: SessionMutation[] | ((prev: SessionMutation[]) => SessionMutation[])
    ) =>
      set((s: ChatStoreState): { sessionMutations: SessionMutation[] } => ({
        sessionMutations: resolve(v, s.sessionMutations),
      })),
    setLatestServerUsage: (v: Record<string, unknown> | null) =>
      set((): { latestServerUsage: Record<string, unknown> | null } => ({
        latestServerUsage: v,
      })),
    setChatHistoryList: (v: ChatSession[] | ((prev: ChatSession[]) => ChatSession[])) =>
      set((s: ChatStoreState): { chatHistoryList: ChatSession[] } => ({
        chatHistoryList: resolve(v, s.chatHistoryList),
      })),
    setCurrentChatId: (id: string | null) =>
      set((): { currentChatId: string | null } => ({ currentChatId: id })),
    setIncognitoSessions: (
      v: ChatSession[] | ((prev: ChatSession[]) => ChatSession[])
    ) =>
      set((s: ChatStoreState): { incognitoSessions: ChatSession[] } => ({
        incognitoSessions: resolve(v, s.incognitoSessions),
      })),
    setProjectContextRevision: (v: number | null) =>
      set((): { projectContextRevision: number | null } => ({
        projectContextRevision: v,
      })),
    setIsIncognito: (v: boolean) =>
      set((): { isIncognito: boolean } => ({ isIncognito: v })),
    setAllowWebSearch: (v: boolean) =>
      set((): { allowWebSearch: boolean } => ({ allowWebSearch: v })),
    setSystemPrompt: (v: string | ((prev: string) => string)) =>
      set((s: ChatStoreState): { systemPrompt: string } => ({
        systemPrompt: resolve(v, s.systemPrompt),
      })),
    setScratchpad: (v: string) =>
      set((): { scratchpad: string } => ({ scratchpad: v })),
  })
);
