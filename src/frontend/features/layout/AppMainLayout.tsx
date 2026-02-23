// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the app main layout unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React from 'react';

import { ChapterList } from '../chapters/ChapterList';
import { Chat } from '../chat/Chat';
import { Editor } from '../editor/Editor';
import { SourcebookList } from '../sourcebook/SourcebookList';
import { StoryMetadata } from '../story/StoryMetadata';
import { useTheme } from './ThemeContext';
import {
  MainChatControls,
  MainEditorControls,
  MainSidebarControls,
} from './layoutControlTypes';

type AppMainLayoutProps = {
  sidebarControls: MainSidebarControls;
  editorControls: MainEditorControls;
  chatControls: MainChatControls;
};

export const AppMainLayout: React.FC<AppMainLayoutProps> = ({
  sidebarControls,
  editorControls,
  chatControls,
}) => {
  const { bgMain, isLight, currentTheme } = useTheme();
  const {
    isSidebarOpen,
    setIsSidebarOpen,
    story,
    currentChapterId,
    handleChapterSelect,
    deleteChapter,
    updateChapter,
    updateBook,
    addChapter,
    handleBookCreate,
    handleBookDelete,
    handleReorderChapters,
    handleReorderBooks,
    handleSidebarAiAction,
    handleOpenImages,
    updateStoryMetadata,
  } = sidebarControls;
  const {
    currentChapter,
    editorRef,
    editorSettings,
    viewMode,
    suggestionControls,
    aiControls,
    setActiveFormats,
    showWhitespace,
    setShowWhitespace,
  } = editorControls;
  const {
    isChatOpen,
    chatMessages,
    isChatLoading,
    systemPrompt,
    handleSendMessage,
    handleStopChat,
    handleRegenerate,
    handleEditMessage,
    handleDeleteMessage,
    setSystemPrompt,
    handleLoadProject,
    incognitoSessions,
    chatHistoryList,
    currentChatId,
    isIncognito,
    handleSelectChat,
    handleNewChat,
    handleDeleteChat,
    handleDeleteAllChats,
    setIsIncognito,
    allowWebSearch,
    setAllowWebSearch,
  } = chatControls;

  return (
    <div className="flex-1 flex overflow-hidden relative">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-brand-gray-950/60 z-30 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}
      <div
        className={`fixed inset-y-0 left-0 top-14 w-[var(--sidebar-width)] flex-col border-r flex-shrink-0 z-40 transition-transform duration-300 ease-in-out lg:relative lg:top-auto lg:translate-x-0 flex h-full ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${
          isLight
            ? 'bg-brand-gray-50 border-brand-gray-200'
            : 'bg-brand-gray-900 border-brand-gray-800'
        }`}
      >
        <StoryMetadata
          title={story.title}
          summary={story.summary}
          tags={story.styleTags}
          notes={story.notes}
          private_notes={story.private_notes}
          conflicts={story.conflicts}
          onUpdate={updateStoryMetadata}
          theme={currentTheme}
        />
        <ChapterList
          chapters={story.chapters}
          books={story.books}
          projectType={story.projectType}
          currentChapterId={currentChapterId}
          onSelect={handleChapterSelect}
          onDelete={deleteChapter}
          onUpdateChapter={updateChapter}
          onUpdateBook={updateBook}
          onCreate={(bookId) => addChapter('New Chapter', '', bookId)}
          onBookCreate={handleBookCreate}
          onBookDelete={handleBookDelete}
          onReorderChapters={handleReorderChapters}
          onReorderBooks={handleReorderBooks}
          onAiAction={handleSidebarAiAction}
          theme={currentTheme}
          onOpenImages={handleOpenImages}
        />
        <SourcebookList theme={currentTheme} />
      </div>
      <div
        className={`flex-1 flex flex-col relative overflow-hidden w-full h-full ${bgMain}`}
      >
        <div className="flex-1 overflow-hidden h-full flex flex-col">
          {currentChapter ? (
            <Editor
              ref={editorRef}
              chapter={currentChapter}
              settings={editorSettings}
              viewMode={viewMode}
              onChange={editorControls.updateChapter}
              suggestionControls={{
                continuations: suggestionControls.continuations,
                isSuggesting: suggestionControls.isSuggesting,
                onTriggerSuggestions: suggestionControls.handleTriggerSuggestions,
                onAcceptContinuation: suggestionControls.handleAcceptContinuation,
                isSuggestionMode: suggestionControls.isSuggestionMode,
                onKeyboardSuggestionAction:
                  suggestionControls.handleKeyboardSuggestionAction,
              }}
              aiControls={{
                onAiAction: aiControls.handleAiAction,
                isAiLoading: aiControls.isAiActionLoading,
              }}
              onContextChange={setActiveFormats}
              showWhitespace={showWhitespace}
              onToggleShowWhitespace={() => setShowWhitespace((value) => !value)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-brand-gray-500">
              <img
                src="/static/images/logo_2048.png"
                className="w-64 h-64 mb-8 opacity-20"
                alt="AugmentedQuill Logo"
              />
              <p className="text-lg font-medium">
                Select or create a chapter to start writing.
              </p>
            </div>
          )}
        </div>
      </div>
      {isChatOpen && (
        <div className="fixed inset-y-0 right-0 top-14 w-full md:w-[var(--sidebar-width)] flex-shrink-0 flex flex-col z-40 shadow-xl transition duration-300 ease-in-out md:relative md:top-auto md:bottom-auto md:z-20 md:h-full">
          <Chat
            messages={chatMessages}
            isLoading={isChatLoading}
            systemPrompt={systemPrompt}
            onSendMessage={handleSendMessage}
            onStop={handleStopChat}
            onRegenerate={handleRegenerate}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onUpdateSystemPrompt={setSystemPrompt}
            onSwitchProject={handleLoadProject}
            theme={currentTheme}
            sessions={[...incognitoSessions, ...chatHistoryList]}
            currentSessionId={currentChatId}
            isIncognito={isIncognito}
            onSelectSession={handleSelectChat}
            onNewSession={handleNewChat}
            onDeleteSession={handleDeleteChat}
            onDeleteAllSessions={handleDeleteAllChats}
            onToggleIncognito={setIsIncognito}
            allowWebSearch={allowWebSearch}
            onToggleWebSearch={setAllowWebSearch}
          />
        </div>
      )}
    </div>
  );
};
