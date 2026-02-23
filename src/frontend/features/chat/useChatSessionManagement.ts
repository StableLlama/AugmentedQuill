// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the use chat session management unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { Dispatch, SetStateAction, useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { ChatMessage, ChatSession } from '../../types';
import { api } from '../../services/api';

type UseChatSessionManagementParams = {
  storyId: string;
  getSystemPrompt: () => string;
  chatMessages: ChatMessage[];
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  isChatLoading: boolean;
};

export function useChatSessionManagement({
  storyId,
  getSystemPrompt,
  chatMessages,
  setChatMessages,
  isChatLoading,
}: UseChatSessionManagementParams) {
  const [chatHistoryList, setChatHistoryList] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isIncognito, setIsIncognito] = useState(false);
  const [allowWebSearch, setAllowWebSearch] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(getSystemPrompt());
  const [incognitoSessions, setIncognitoSessions] = useState<ChatSession[]>([]);

  useEffect(() => {
    setSystemPrompt(getSystemPrompt());
  }, [storyId, getSystemPrompt]);

  const refreshChatList = useCallback(async () => {
    try {
      const chats = await api.chat.list();
      setChatHistoryList(chats);
    } catch (error) {
      console.error('Failed to list chats', error);
    }
  }, []);

  const handleNewChat = useCallback(
    (incognito: boolean = false) => {
      const newId = uuidv4();
      if (incognito) {
        const newSession: ChatSession = {
          id: newId,
          name: 'Incognito Chat',
          messages: [],
          systemPrompt: getSystemPrompt(),
          isIncognito: true,
          allowWebSearch: false,
        };
        setIncognitoSessions((prev) => [newSession, ...prev]);
        setChatMessages([]);
        setIsIncognito(true);
        setCurrentChatId(newId);
        setAllowWebSearch(false);
      } else {
        setChatMessages([]);
        setIsIncognito(false);
        setCurrentChatId(newId);
        setAllowWebSearch(false);
      }
      setSystemPrompt(getSystemPrompt());
    },
    [getSystemPrompt, setChatMessages]
  );

  const handleSelectChat = useCallback(
    async (id: string) => {
      const incognito = incognitoSessions.find((session) => session.id === id);
      if (incognito) {
        setChatMessages(incognito.messages || []);
        setCurrentChatId(id);
        setIsIncognito(true);
        if (incognito.systemPrompt) {
          setSystemPrompt(incognito.systemPrompt);
        }
        setAllowWebSearch(incognito.allowWebSearch || false);
        return;
      }

      try {
        const chat = await api.chat.load(id);
        if (chat) {
          setChatMessages(chat.messages || []);
          setCurrentChatId(id);
          setIsIncognito(false);
          if (chat.systemPrompt) {
            setSystemPrompt(chat.systemPrompt);
          }
          setAllowWebSearch(chat.allowWebSearch || false);
        }
      } catch (error) {
        console.error('Failed to load chat', error);
      }
    },
    [incognitoSessions, setChatMessages]
  );

  const handleDeleteChat = useCallback(
    async (id: string) => {
      if (incognitoSessions.some((session) => session.id === id)) {
        setIncognitoSessions((prev) => prev.filter((session) => session.id !== id));
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
    [incognitoSessions, currentChatId, handleNewChat, refreshChatList]
  );

  const handleDeleteAllChats = useCallback(async () => {
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
  }, [refreshChatList, handleNewChat]);

  useEffect(() => {
    if (storyId && !currentChatId && !isIncognito) {
      const loadInitialChats = async () => {
        try {
          const chats = await api.chat.list();
          setChatHistoryList(chats);
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
  }, [storyId, currentChatId, isIncognito, handleSelectChat, handleNewChat]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (currentChatId && chatMessages.length > 0 && !isChatLoading) {
      if (isIncognito) {
        const firstUserMsg = chatMessages.find((message) => message.role === 'user');
        const name = firstUserMsg?.text?.substring(0, 40) || 'Incognito Chat';
        setIncognitoSessions((prev) =>
          prev.map((session) =>
            session.id === currentChatId
              ? {
                  ...session,
                  name,
                  messages: chatMessages,
                  systemPrompt,
                  allowWebSearch,
                }
              : session
          )
        );
      } else {
        timeout = setTimeout(async () => {
          try {
            const firstUserMsg = chatMessages.find(
              (message) => message.role === 'user'
            );
            const name = firstUserMsg?.text?.substring(0, 40) || 'Untitled Chat';
            await api.chat.save(currentChatId, {
              name,
              messages: chatMessages,
              systemPrompt,
              allowWebSearch,
            });
            refreshChatList();
          } catch (error) {
            console.error('Failed to auto-save chat', error);
          }
        }, 2000);
      }
    }

    return () => clearTimeout(timeout);
  }, [
    chatMessages,
    currentChatId,
    isIncognito,
    systemPrompt,
    isChatLoading,
    allowWebSearch,
    refreshChatList,
  ]);

  return {
    chatHistoryList,
    setChatHistoryList,
    currentChatId,
    setCurrentChatId,
    isIncognito,
    setIsIncognito,
    allowWebSearch,
    setAllowWebSearch,
    systemPrompt,
    setSystemPrompt,
    incognitoSessions,
    setIncognitoSessions,
    refreshChatList,
    handleNewChat,
    handleSelectChat,
    handleDeleteChat,
    handleDeleteAllChats,
  };
}
