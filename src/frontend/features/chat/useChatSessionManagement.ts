// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Manage chat sessions (list, select, create, delete, auto-save).
 *
 * All mutable state is now held in chatStore (Zustand) rather than local
 * useState so that session updates never propagate a re-render up to App.tsx.
 * The auto-save logic uses chatStore.subscribe() instead of a useEffect
 * dependency on chatMessages, which would otherwise create a chatStore
 * selector subscription in App-level code.
 */

import { useCallback, useEffect, startTransition } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { ChatSession, ChatMessage } from '../../types';
import { api } from '../../services/api';
import { useChatStore, ChatStoreState } from '../../stores/chatStore';
import { useStoryStore } from '../../stores/storyStore';

type UseChatSessionManagementParams = {
  storyId: string;
  getSystemPrompt: () => string;
};

/** Custom React hook that manages chat session management. */
export function useChatSessionManagement({
  storyId,
  getSystemPrompt,
}: UseChatSessionManagementParams): {
  refreshChatList: () => Promise<void>;
  handleNewChat: (incognito?: boolean) => void;
  handleSelectChat: (id: string) => Promise<void>;
  handleDeleteChat: (id: string) => Promise<void>;
  handleDeleteAllChats: () => Promise<void>;
  onUpdateScratchpad: (content: string) => void;
  onDeleteScratchpad: () => void;
} {
  // ---------------------------------------------------------------------------
  // Stable store-action aliases (Zustand actions never change identity)
  // ---------------------------------------------------------------------------
  const {
    setChatMessages,
    setChatHistoryList,
    setCurrentChatId,
    setIsIncognito,
    setAllowWebSearch,
    setSystemPrompt,
    setScratchpad,
    setIncognitoSessions,
    setSessionMutations,
    setProjectContextRevision,
    // Setters are stable — read via getState() to avoid subscribing to every token.
  } = useChatStore.getState();

  // Update systemPrompt when the project changes.
  useEffect((): void => {
    setSystemPrompt(getSystemPrompt());
  }, [storyId, getSystemPrompt, setSystemPrompt]);

  const refreshChatList = useCallback(async (): Promise<void> => {
    try {
      const chats = await api.chat.list();
      setChatHistoryList(chats);
    } catch (error) {
      console.error('Failed to list chats', error);
    }
  }, []);

  const handleNewChat = useCallback(
    (incognito: boolean = false): void => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const newId = incognito ? uuidv4() : `chat-${timestamp}`;
      const projectContextRevision = useStoryStore.getState().story.lastUpdated ?? null;
      if (incognito) {
        const newSession: ChatSession = {
          id: newId,
          name: 'Incognito Chat',
          messages: [],
          systemPrompt: getSystemPrompt(),
          isIncognito: true,
          allowWebSearch: false,
          scratchpad: '',
          projectContextRevision,
        };
        setIncognitoSessions((prev: ChatSession[]): ChatSession[] => [
          newSession,
          ...prev,
        ]);
        setChatMessages([]);
        setIsIncognito(true);
        setCurrentChatId(newId);
        setAllowWebSearch(false);
        setScratchpad('');
        setProjectContextRevision(projectContextRevision);
      } else {
        setChatMessages([]);
        setIsIncognito(false);
        setCurrentChatId(newId);
        setAllowWebSearch(false);
        setScratchpad('');
        setProjectContextRevision(projectContextRevision);
      }
      setSystemPrompt(getSystemPrompt());
      setSessionMutations([]);
    },
    [
      getSystemPrompt,
      setChatMessages,
      setIncognitoSessions,
      setIsIncognito,
      setCurrentChatId,
      setAllowWebSearch,
      setScratchpad,
      setProjectContextRevision,
      setSystemPrompt,
    ]
  );

  const handleSelectChat = useCallback(
    async (id: string): Promise<void> => {
      const incognito = useChatStore
        .getState()
        .incognitoSessions.find((session: ChatSession): boolean => session.id === id);
      if (incognito) {
        setChatMessages(incognito.messages || []);
        setCurrentChatId(id);
        setIsIncognito(true);
        setScratchpad(incognito.scratchpad || '');
        setProjectContextRevision(incognito.projectContextRevision ?? null);
        if (incognito.systemPrompt) {
          setSystemPrompt(incognito.systemPrompt);
        }
        setAllowWebSearch(incognito.allowWebSearch || false);
        return;
      }

      try {
        const chat = await api.chat.load(id);
        if (chat) {
          startTransition((): void => {
            setChatMessages(chat.messages || []);
            setCurrentChatId(id);
            setIsIncognito(false);
            setScratchpad(chat.scratchpad || '');
            setProjectContextRevision(chat.projectContextRevision ?? null);
            if (chat.systemPrompt) {
              setSystemPrompt(chat.systemPrompt);
            }
            setAllowWebSearch(chat.allowWebSearch || false);
          });
          setSessionMutations([]);
        }
      } catch (error) {
        console.error('Failed to load chat', error);
      }
    },
    [
      setChatMessages,
      setCurrentChatId,
      setIsIncognito,
      setScratchpad,
      setProjectContextRevision,
      setSystemPrompt,
      setAllowWebSearch,
    ]
  );

  const handleUpdateScratchpad = useCallback(
    (content: string): void => {
      setScratchpad(content);
      const { currentChatId, isIncognito } = useChatStore.getState();
      if (isIncognito && currentChatId) {
        setIncognitoSessions((prev: ChatSession[]): ChatSession[] =>
          prev.map((session: ChatSession): ChatSession =>
            session.id === currentChatId ? { ...session, scratchpad: content } : session
          )
        );
      }
    },
    [setScratchpad, setIncognitoSessions]
  );

  const handleDeleteScratchpad = useCallback((): void => {
    handleUpdateScratchpad('');
  }, [handleUpdateScratchpad]);

  const handleDeleteChat = useCallback(
    async (id: string): Promise<void> => {
      const { incognitoSessions, currentChatId } = useChatStore.getState();
      if (
        incognitoSessions.some((session: ChatSession): boolean => session.id === id)
      ) {
        setIncognitoSessions((prev: ChatSession[]): ChatSession[] =>
          prev.filter((session: ChatSession): boolean => session.id !== id)
        );
        if (currentChatId === id) {
          handleNewChat();
        }
        return;
      }

      try {
        await api.chat.delete(id);
        await refreshChatList();
        if (currentChatId === id) {
          handleNewChat();
        }
      } catch (error) {
        console.error('Failed to delete chat', error);
      }
    },
    [handleNewChat, refreshChatList, setIncognitoSessions]
  );

  const handleDeleteAllChats = useCallback(async (): Promise<void> => {
    if (
      !confirm(
        'Are you sure you want to delete ALL chats (including incognito)? This cannot be undone.'
      )
    ) {
      return;
    }

    try {
      setIncognitoSessions([]);
      await api.chat.deleteAll();
      await refreshChatList();
      handleNewChat();
    } catch (error) {
      console.error('Failed to delete all chats', error);
    }
  }, [refreshChatList, handleNewChat, setIncognitoSessions]);

  // ---------------------------------------------------------------------------
  // Initial chat load
  // ---------------------------------------------------------------------------
  useEffect((): void => {
    const { currentChatId, isIncognito } = useChatStore.getState();
    if (storyId && !currentChatId && !isIncognito) {
      const loadInitialChats = async (): Promise<void> => {
        try {
          const chats = await api.chat.list();
          startTransition(() => setChatHistoryList(chats));
          if (chats.length > 0) {
            await handleSelectChat(chats[0].id);
          } else {
            handleNewChat(false);
          }
        } catch (error) {
          console.error('Failed to load initial chats', error);
        }
      };
      loadInitialChats();
    }
  }, [storyId, handleSelectChat, handleNewChat, setChatHistoryList]);

  // ---------------------------------------------------------------------------
  // Auto-save: react to chatMessages / isChatLoading changes without
  // subscribing to the store as a React selector (which would propagate
  // re-renders up to App.tsx).  chatStore.subscribe() fires imperatively
  // without triggering any React render cycle.
  // ---------------------------------------------------------------------------
  useEffect((): (() => void) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = useChatStore.subscribe(
      (state: ChatStoreState, prevState: ChatStoreState): void => {
        // Only fire when persisted session fields actually changed.
        if (
          state.chatMessages === prevState.chatMessages &&
          state.isChatLoading === prevState.isChatLoading &&
          state.scratchpad === prevState.scratchpad &&
          state.systemPrompt === prevState.systemPrompt &&
          state.allowWebSearch === prevState.allowWebSearch &&
          state.currentChatId === prevState.currentChatId &&
          state.isIncognito === prevState.isIncognito
        ) {
          return;
        }

        clearTimeout(timeout);

        const {
          chatMessages,
          currentChatId,
          isChatLoading,
          isIncognito,
          systemPrompt,
          scratchpad,
          allowWebSearch,
          projectContextRevision,
        } = state;

        if (!currentChatId || isChatLoading) {
          return;
        }

        if (isIncognito) {
          const firstUserMsg = chatMessages.find(
            (message: ChatMessage): boolean => message.role === 'user'
          );
          const name = firstUserMsg?.text?.substring(0, 40) || 'Incognito Chat';
          useChatStore
            .getState()
            .setIncognitoSessions((prev: ChatSession[]): ChatSession[] =>
              prev.map((session: ChatSession): ChatSession =>
                session.id === currentChatId
                  ? {
                      ...session,
                      name,
                      messages: chatMessages,
                      systemPrompt,
                      allowWebSearch,
                      scratchpad,
                      projectContextRevision,
                    }
                  : session
              )
            );
        } else {
          timeout = setTimeout(async (): Promise<void> => {
            try {
              const {
                chatMessages: msgs,
                currentChatId: cid,
                systemPrompt: sp,
                allowWebSearch: aws,
                scratchpad: sc,
                projectContextRevision: pcr,
              } = useChatStore.getState();
              if (!cid) return;
              const firstUserMsg = msgs.find(
                (m: ChatMessage): boolean => m.role === 'user'
              );
              const name = firstUserMsg?.text?.substring(0, 40) || 'Untitled Chat';
              await api.chat.save(cid, {
                name,
                messages: msgs,
                systemPrompt: sp,
                allowWebSearch: aws,
                scratchpad: sc,
                projectContextRevision: pcr,
              });
              refreshChatList();
            } catch (error) {
              console.error('Failed to auto-save chat', error);
            }
          }, 2000);
        }
      }
    );

    return (): void => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [refreshChatList]);

  return {
    refreshChatList,
    handleNewChat,
    handleSelectChat,
    handleDeleteChat,
    handleDeleteAllChats,
    onUpdateScratchpad: handleUpdateScratchpad,
    onDeleteScratchpad: handleDeleteScratchpad,
  };
}
