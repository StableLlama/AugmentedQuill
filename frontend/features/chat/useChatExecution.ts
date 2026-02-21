// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the use chat execution unit so this responsibility stays isolated, testable, and easy to evolve.

import { Dispatch, SetStateAction, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { api } from '../../services/api';
import { createChatSession } from '../../services/openaiService';
import { ChatMessage, LLMConfig } from '../../types';

type ToolLoopChoice = 'stop' | 'continue' | 'unlimited';

type UseChatExecutionParams = {
  systemPrompt: string;
  activeChatConfig: LLMConfig;
  allowWebSearch: boolean;
  currentChapterId: string | null;
  chatMessages: ChatMessage[];
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  isChatLoading: boolean;
  setIsChatLoading: Dispatch<SetStateAction<boolean>>;
  refreshProjects: () => Promise<void>;
  refreshStory: () => Promise<void>;
  requestToolCallLoopAccess: (count: number) => Promise<ToolLoopChoice>;
};

export function useChatExecution({
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
}: UseChatExecutionParams) {
  const stopSignalRef = useRef(false);

  const executeChatRequest = async (
    userText: string,
    history: ChatMessage[],
    userMsgId?: string
  ) => {
    setIsChatLoading(true);
    stopSignalRef.current = false;

    let sequentialToolCalls = 0;
    let toolCallLimit = 10;

    try {
      let currentHistory = [...history];
      const session = createChatSession(
        systemPrompt,
        currentHistory,
        activeChatConfig,
        'CHAT',
        {
          allowWebSearch,
        }
      );

      const updateMessage = (
        msgId: string,
        update: { text?: string; thinking?: string; traceback?: string }
      ) => {
        if (stopSignalRef.current) return;
        setChatMessages((prev) => {
          const messageIndex = prev.findIndex((item) => item.id === msgId);
          if (messageIndex !== -1) {
            const next = [...prev];
            next[messageIndex] = {
              ...next[messageIndex],
              text: update.text ?? next[messageIndex].text,
              thinking: update.thinking ?? next[messageIndex].thinking,
              traceback: update.traceback ?? next[messageIndex].traceback,
            };
            return next;
          }

          return [
            ...prev,
            {
              id: msgId,
              role: 'model',
              text: update.text ?? '',
              thinking: update.thinking ?? '',
              traceback: update.traceback ?? '',
            },
          ];
        });
      };

      let currentMsgId = uuidv4();
      let result = await session.sendMessage({ message: userText }, (update) =>
        updateMessage(currentMsgId, update)
      );

      currentHistory.push({
        id: userMsgId || uuidv4(),
        role: 'user',
        text: userText,
      });

      while (result.functionCalls && result.functionCalls.length > 0) {
        if (stopSignalRef.current) break;

        sequentialToolCalls++;
        if (sequentialToolCalls >= toolCallLimit) {
          const choice = await requestToolCallLoopAccess(sequentialToolCalls);
          if (choice === 'stop') break;
          if (choice === 'continue') {
            toolCallLimit += 10;
          } else {
            toolCallLimit = Infinity;
          }
        }

        const assistantMessage: ChatMessage = {
          id: currentMsgId,
          role: 'model',
          text: result.text || '',
          thinking: result.thinking,
          tool_calls: result.functionCalls,
        };

        setChatMessages((prev) => {
          const messageIndex = prev.findIndex((item) => item.id === currentMsgId);
          if (messageIndex !== -1) {
            const next = [...prev];
            next[messageIndex] = assistantMessage;
            return next;
          }
          return [...prev, assistantMessage];
        });

        currentHistory.push(assistantMessage);

        const toolResponse = await api.chat.executeTools({
          messages: currentHistory.map((message) => ({
            role: message.role === 'model' ? 'assistant' : message.role,
            content: message.text || null,
            tool_calls: message.tool_calls?.map((toolCall) => ({
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.name,
                arguments:
                  typeof toolCall.args === 'string'
                    ? toolCall.args
                    : JSON.stringify(toolCall.args),
              },
            })),
          })),
          active_chapter_id: currentChapterId ? Number(currentChapterId) : undefined,
        });

        if (stopSignalRef.current) break;

        if (!toolResponse.ok) break;

        for (const message of toolResponse.appended_messages) {
          currentHistory.push({
            id: uuidv4(),
            role: 'tool',
            text: message.content,
            name: message.name,
            tool_call_id: message.tool_call_id,
          });
        }
        setChatMessages([...currentHistory]);

        if (toolResponse.mutations?.story_changed) {
          await refreshProjects();
          await refreshStory();
        }

        if (stopSignalRef.current) break;

        const nextSession = createChatSession(
          systemPrompt,
          currentHistory,
          activeChatConfig,
          'CHAT',
          {
            allowWebSearch,
          }
        );
        currentMsgId = uuidv4();
        result = await nextSession.sendMessage({ message: '' }, (update) =>
          updateMessage(currentMsgId, update)
        );
      }

      if (!stopSignalRef.current) {
        const botMessage: ChatMessage = {
          id: currentMsgId,
          role: 'model',
          text: result.text || '',
          thinking: result.thinking,
          tool_calls: result.functionCalls,
        };
        setChatMessages((prev) => {
          const messageIndex = prev.findIndex((item) => item.id === currentMsgId);
          if (messageIndex !== -1) {
            const next = [...prev];
            next[messageIndex] = botMessage;
            return next;
          }
          return [...prev, botMessage];
        });
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      const message =
        error instanceof Error ? error.message : 'An unexpected error occurred';
      let errorText = `AI Error: ${message}`;
      const detailedError = error as { data?: unknown; traceback?: string };
      if (detailedError.data) {
        const detail =
          typeof detailedError.data === 'string'
            ? detailedError.data
            : JSON.stringify(detailedError.data, null, 2);
        errorText += `\n\n**Details:**\n${detail}`;
      }

      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'model',
        text: errorText,
        isError: true,
        traceback: detailedError.traceback,
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsChatLoading(false);
      stopSignalRef.current = false;
    }
  };

  const handleSendMessage = async (text: string) => {
    const userMsgId = uuidv4();
    const newMessage: ChatMessage = { id: userMsgId, role: 'user', text };
    const historyBefore = [...chatMessages];
    setChatMessages((prev) => [...prev, newMessage]);
    await executeChatRequest(text, historyBefore, userMsgId);
  };

  const handleStopChat = () => {
    stopSignalRef.current = true;
    setIsChatLoading(false);
  };

  const handleRegenerate = async () => {
    const lastMessageIndex = chatMessages.length - 1;
    if (lastMessageIndex < 0) return;

    const lastMessage = chatMessages[lastMessageIndex];
    if (lastMessage.role !== 'model') return;

    let userMessageIndex = -1;
    for (let index = lastMessageIndex; index >= 0; index--) {
      if (chatMessages[index].role === 'user') {
        userMessageIndex = index;
        break;
      }
    }

    if (userMessageIndex === -1) return;

    const userMessage = chatMessages[userMessageIndex];
    const newHistory = chatMessages.slice(0, userMessageIndex);
    setChatMessages([...newHistory, userMessage]);
    await executeChatRequest(userMessage.text, newHistory, userMessage.id);
  };

  return {
    isChatLoading,
    handleSendMessage,
    handleStopChat,
    handleRegenerate,
  };
}
