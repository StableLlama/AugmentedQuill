// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the chat unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatAttachment } from '../../types';
import { useThemeClasses } from '../layout/ThemeContext';
import { useChatContext } from './ChatContext';
import { ChatStoreState, useChatStore } from '../../stores/chatStore';
import { Loader2, Bot, RefreshCw, X, Paperclip } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { MutationTags } from './components/MutationTags';
import { ChatHeader } from './components/ChatHeader';
import { ChatHistoryPanel } from './components/ChatHistoryPanel';
import { ChatComposer } from './components/ChatComposer';
import { ChatMessageItem } from './components/ChatMessageItem';
import { ChatScratchpadDialog } from './components/ChatScratchpadDialog';
import { ChatSystemPromptPanel } from './components/ChatSystemPromptPanel';
import { estimateChatContextUsage } from './chatContextBudget';
import { useChatScroll } from './hooks/useChatScroll';
import { useChatEditing } from './hooks/useChatEditing';
import { useChatUIState } from './hooks/useChatUIState';
import { useChatMessages } from './hooks/useChatMessages';

/* eslint-disable complexity */
function ChatComponent(): React.JSX.Element {
  const {
    messages,
    isLoading,
    isModelAvailable,
    activeChatConfig,
    systemPrompt,
    onSendMessage,
    onStop,
    onRegenerate,
    onEditMessage,
    onDeleteMessage,
    onUpdateSystemPrompt,
    onSwitchProject,
    currentTheme: theme,
    sessions,
    currentSessionId,
    isIncognito,
    onSelectSession,
    onNewSession,
    onDeleteSession,
    onDeleteAllSessions,
    allowWebSearch,
    onToggleWebSearch,
    scratchpad,
    onUpdateScratchpad,
    onDeleteScratchpad,
    sessionMutations,
    onMutationClick,
    storyLanguage,
  } = useChatContext();

  const {
    editingMessageId,
    editContent,
    setEditContent,
    handleStartEditing,
    handleSaveEdit,
    handleCancelEdit,
  } = useChatEditing(onEditMessage);

  const {
    showSystemPrompt,
    setShowSystemPrompt,
    showHistory,
    setShowHistory,
    showScratchpad,
    setShowScratchpad,
    thinkingProcessExpanded,
    handleThinkingToggle,
  } = useChatUIState();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  const {
    scrollContainerRef,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    scrollToBottom,
  } = useChatScroll({
    messages,
    isLoading,
    editingMessageId,
    currentSessionId,
  });

  const { visibleMessages } = useChatMessages(messages, currentSessionId);

  const themeClasses = useThemeClasses();
  const { isLight } = themeClasses;
  const latestServerUsage = useChatStore(
    (state: ChatStoreState) => state.latestServerUsage
  );
  const { t } = useTranslation();
  const chatDisabledReason = t(
    'Chat is unavailable because no working CHAT model is configured.'
  );
  const bgMain = isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-900';
  const textMain = isLight ? 'text-brand-gray-800' : 'text-brand-gray-400';
  const headerBg = isLight ? 'bg-brand-gray-100' : 'bg-brand-gray-900';
  const msgUserBg = isLight
    ? 'bg-blue-600 text-white'
    : 'bg-blue-900/40 text-blue-300 border border-blue-800/50';
  const msgBotBg = isLight
    ? 'bg-brand-gray-50 border border-brand-gray-200 shadow-sm'
    : 'bg-brand-gray-800/50 border border-brand-gray-700 shadow-sm';
  const inputBg = isLight
    ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-900'
    : 'bg-brand-gray-950 border-brand-gray-800 text-brand-gray-300';

  const handleSubmit = (text: string, files?: ChatAttachment[]): void => {
    if (isLoading || !isModelAvailable) return;

    onSendMessage(text, files);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Force scroll to bottom on user message
    setTimeout((): void => scrollToBottom('auto'), 0);
  };

  const hasUserMessage = messages.some(
    (msg: import('../../types').ChatMessage): boolean => msg.role === 'user'
  );
  const canRegenerate = !isLoading && isModelAvailable && hasUserMessage;
  const serverUsagePercent = useMemo((): number | null => {
    const promptTokens = latestServerUsage
      ? (latestServerUsage['prompt_tokens'] as number | undefined)
      : undefined;
    const contextWindow = activeChatConfig.contextWindowTokens;
    if (
      typeof promptTokens === 'number' &&
      contextWindow !== undefined &&
      contextWindow > 0
    ) {
      return Math.round(Math.min(promptTokens / contextWindow, 1) * 100);
    }
    return null;
  }, [activeChatConfig.contextWindowTokens, latestServerUsage]);

  const contextUsage = useMemo(
    () =>
      estimateChatContextUsage({
        systemInstruction: systemPrompt,
        messages,
        config: activeChatConfig,
      }),
    [activeChatConfig, messages, systemPrompt]
  );

  return (
    <div
      id="chat-panel"
      className={`flex flex-col h-full border-l ${bgMain} ${themeClasses.border} ${textMain}`}
    >
      <ChatHeader
        title={isIncognito ? t('Incognito Chat') : t('Writing Partner')}
        headerBg={headerBg}
        isLightTheme={isLight}
        currentSessionId={currentSessionId}
        isIncognito={isIncognito}
        contextUsage={contextUsage}
        serverUsagePercent={serverUsagePercent}
        isDisabled={!isModelAvailable}
        disabledReason={chatDisabledReason}
        showHistory={showHistory}
        setShowHistory={setShowHistory}
        showSystemPrompt={showSystemPrompt}
        setShowSystemPrompt={setShowSystemPrompt}
        allowWebSearch={allowWebSearch}
        onDeleteSession={onDeleteSession}
        onNewSession={onNewSession}
        onScratchpadOpen={(): void => setShowScratchpad(true)}
        onToggleWebSearch={onToggleWebSearch}
      />

      {showHistory && (
        <ChatHistoryPanel
          sessions={sessions}
          currentSessionId={currentSessionId}
          isDisabled={!isModelAvailable}
          disabledReason={chatDisabledReason}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          onDeleteAllSessions={onDeleteAllSessions}
          onClose={(): void => setShowHistory(false)}
        />
      )}

      <ChatScratchpadDialog
        isOpen={showScratchpad}
        isLight={isLight}
        storyLanguage={storyLanguage}
        scratchpad={scratchpad}
        onClose={(): void => setShowScratchpad(false)}
        onDelete={onDeleteScratchpad}
        onSave={onUpdateScratchpad}
      />

      <ChatSystemPromptPanel
        isOpen={showSystemPrompt}
        isLight={isLight}
        bgMain={bgMain}
        borderClass={themeClasses.border}
        inputBg={inputBg}
        systemPrompt={systemPrompt}
        isModelAvailable={isModelAvailable}
        chatDisabledReason={chatDisabledReason}
        storyLanguage={storyLanguage}
        theme={theme}
        onClose={(): void => setShowSystemPrompt(false)}
        onSave={onUpdateSystemPrompt}
      />

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        className={`flex-1 overflow-y-auto p-4 space-y-4 ${
          isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-950/30'
        }`}
      >
        {!isModelAvailable && (
          <div
            className={`rounded-md border px-3 py-2 text-xs ${
              isLight
                ? 'border-amber-500/40 bg-amber-100/50 text-amber-700'
                : 'border-amber-500/40 bg-amber-900/20 text-amber-300'
            }`}
          >
            {chatDisabledReason}
          </div>
        )}

        {visibleMessages.length === 0 && !showSystemPrompt && (
          <div className="text-center text-brand-gray-500 mt-10 p-4">
            <Bot className="mx-auto mb-3 opacity-50" size={40} />
            <p className="text-sm">
              {t(
                "I'm your AI co-author. Ask me to write, edit, or brainstorm ideas for your story!"
              )}
            </p>
          </div>
        )}

        {visibleMessages.map((msg: import('../../types').ChatMessage, i: number) => (
          <ChatMessageItem
            key={msg.id || `msg-${i}`}
            msg={msg}
            isLast={i === visibleMessages.length - 1}
            isLoading={isLoading}
            isLight={isLight}
            msgUserBg={msgUserBg}
            msgBotBg={msgBotBg}
            inputBg={inputBg}
            isEditing={editingMessageId === msg.id}
            editContent={editingMessageId === msg.id ? editContent : ''}
            anyMessageBeingEdited={!!editingMessageId}
            isThinkingExpanded={thinkingProcessExpanded[msg.id]}
            isModelAvailable={isModelAvailable}
            chatDisabledReason={chatDisabledReason}
            storyLanguage={storyLanguage}
            theme={theme}
            onSwitchProject={onSwitchProject}
            onStartEditing={handleStartEditing}
            onCancelEdit={handleCancelEdit}
            onSaveEdit={handleSaveEdit}
            onSetEditContent={setEditContent}
            onDeleteMessage={onDeleteMessage}
            onThinkingToggle={handleThinkingToggle}
          />
        ))}

        {isLoading && (
          <div className="flex items-center space-x-3" role="status" aria-live="polite">
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${
                isLight
                  ? 'bg-brand-gray-50 border-brand-gray-200'
                  : 'bg-brand-gray-900/30 border-brand-gray-800'
              }`}
            >
              <Bot size={16} className="text-brand-gray-400" />
            </div>
            <div
              className={`px-4 py-2 rounded-lg shadow-sm border ${
                isLight
                  ? 'bg-brand-gray-50 border-brand-gray-200'
                  : 'bg-brand-gray-800 border-brand-gray-700'
              }`}
            >
              <Loader2 className="animate-spin text-brand-500" size={16} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={`p-4 border-t ${bgMain} ${themeClasses.border}`}>
        {sessionMutations.length > 0 && (
          <div className="mb-3">
            <MutationTags
              mutations={sessionMutations}
              onMutationClick={onMutationClick}
            />
          </div>
        )}
        {(canRegenerate || isLoading || attachments.length === 0) && (
          <div className="relative mb-3 min-h-[2.75rem] py-1">
            <div className="absolute inset-x-0 flex justify-center">
              {isLoading ? (
                <Button
                  theme={theme}
                  size="sm"
                  variant="secondary"
                  onClick={onStop}
                  icon={<X size={12} />}
                  className="text-xs py-1 h-7 border-dashed border-red-500/50 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                  title={t('Stop generation')}
                >
                  {t('Stop generation')}
                </Button>
              ) : canRegenerate ? (
                <Button
                  theme={theme}
                  size="sm"
                  variant="secondary"
                  onClick={onRegenerate}
                  disabled={!isModelAvailable}
                  icon={<RefreshCw size={12} />}
                  className="text-xs py-1 h-7 border-dashed"
                  title={
                    !isModelAvailable
                      ? chatDisabledReason
                      : t('Regenerate last response (CHAT model)')
                  }
                >
                  {t('Regenerate last response')}
                </Button>
              ) : null}
            </div>
            {attachments.length === 0 && (
              <button
                type="button"
                onClick={(): void | undefined => fileInputRef.current?.click()}
                title={t('Attach files')}
                aria-label={t('Attach files')}
                className={`absolute right-0 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition ${
                  isLight
                    ? 'border-brand-gray-300 bg-white text-brand-gray-700 hover:bg-brand-gray-50'
                    : 'border-brand-gray-700 bg-brand-gray-900 text-brand-gray-200 hover:bg-brand-gray-800'
                }`}
              >
                <Paperclip size={16} />
              </button>
            )}
          </div>
        )}

        <ChatComposer
          textareaRef={textareaRef}
          fileInputRef={fileInputRef}
          isLoading={isLoading}
          isModelAvailable={isModelAvailable}
          disabledReason={chatDisabledReason}
          inputBg={inputBg}
          attachments={attachments}
          language={storyLanguage}
          onAttachmentsChange={setAttachments}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
/* eslint-enable complexity */

export const Chat: React.FC = React.memo(ChatComponent);
Chat.displayName = 'Chat';
