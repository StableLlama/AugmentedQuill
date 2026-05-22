// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the app main layout unit so this responsibility stays isolated, testable, and easy to evolve.
 * Composes AppSidebar, the story editor pane, and AppChatPanel.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Editor } from '../editor/Editor';
import { AppChatPanel } from './AppChatPanel';
import { AppSidebar } from './AppSidebar';
import { useTheme } from './ThemeContext';
import {
  MainChatControls,
  MainEditorControls,
  MainSidebarControls,
  HeaderFormatControls,
  HeaderViewControls,
} from './layoutControlTypes';
import { useStoryLanguage } from '../../stores/storyStore';

import { useWorkspaceMode } from '../../stores/uiStore';
import { EditorToolbar } from '../editor/EditorToolbar';
import { ScenesPanelContainer } from '../scenes/ScenesPanelContainer';

type AppMainLayoutProps = {
  sidebarControls: MainSidebarControls;
  editorControls: MainEditorControls;
  chatControls: MainChatControls;
  viewControls: HeaderViewControls;
  formatControls: HeaderFormatControls;
  instructionLanguages: string[];
};

interface SkeletonBarProps {
  isLight: boolean;
  widthClass?: string;
}

const SkeletonBar: React.FC<SkeletonBarProps> = ({
  isLight,
  widthClass = 'w-full',
}: SkeletonBarProps) => (
  <div
    className={`h-3 rounded ${widthClass} ${
      isLight ? 'bg-brand-gray-200' : 'bg-brand-gray-700'
    }`}
  />
);

interface ChapterLoadingSkeletonProps {
  isLight: boolean;
  t: (key: string) => string;
}

const ChapterLoadingSkeleton: React.FC<ChapterLoadingSkeletonProps> = ({
  isLight,
  t,
}: ChapterLoadingSkeletonProps) => (
  <div
    className="flex-1 p-8 space-y-4 animate-pulse"
    aria-busy="true"
    aria-label={t('Loading chapter')}
  >
    <div
      className={`h-5 w-1/3 rounded ${isLight ? 'bg-brand-gray-200' : 'bg-brand-gray-700'}`}
    />
    <SkeletonBar isLight={isLight} />
    <SkeletonBar isLight={isLight} widthClass="w-5/6" />
    <SkeletonBar isLight={isLight} />
    <SkeletonBar isLight={isLight} widthClass="w-3/4" />
    <div className="pt-2" />
    <SkeletonBar isLight={isLight} />
    <SkeletonBar isLight={isLight} widthClass="w-4/5" />
    <SkeletonBar isLight={isLight} />
    <SkeletonBar isLight={isLight} widthClass="w-2/3" />
  </div>
);

export const AppMainLayout: React.FC<AppMainLayoutProps> = React.memo(
  ({
    sidebarControls,
    editorControls,
    chatControls,
    viewControls,
    formatControls,
    instructionLanguages,
  }: AppMainLayoutProps) => {
    const { bgMain, isLight, currentTheme } = useTheme();
    const { t } = useTranslation();
    const workspaceMode = useWorkspaceMode();

    if (!sidebarControls || !editorControls || !chatControls) {
      console.error('AppMainLayout missing required controls', {
        sidebarControls,
        editorControls,
        chatControls,
      });
      return (
        <div className="flex-1 flex items-center justify-center p-8 text-center text-brand-red-500">
          <p className="text-lg font-semibold">
            {t('Application failed to initialize.')}
          </p>
          <p className="mt-2 text-sm text-brand-gray-400">
            {t('Please refresh the page or try again.')}
          </p>
        </div>
      );
    }

    const storyLanguage = useStoryLanguage();
    const { addChapter, isSidebarOpen, setIsSidebarOpen, onToggleSourcebook } =
      sidebarControls;

    const { editorSettings, setEditorSettings } = editorControls;
    const sidebarPrefs = editorSettings.sidebar || {};
    const sidebarRef = useRef<HTMLDivElement>(null);

    // storyId for the sidebar height initialization effect (avoids importing full story)
    const storyId = sidebarControls.currentChapterId ? 'loaded' : '';

    useEffect((): void => {
      const totalHeight = sidebarRef.current?.clientHeight || 0;
      if (
        totalHeight > 0 &&
        (!sidebarPrefs.storyHeight || !sidebarPrefs.chaptersHeight)
      ) {
        // Use static ratios; sidebar now reads from storyStore directly.
        const storyRatio = 0.33;
        const chaptersRatio = 0.33;

        const sHeight = Math.round(totalHeight * storyRatio);
        const cHeight = Math.round(totalHeight * chaptersRatio);

        setEditorSettings((prev: import('../../types').EditorSettings) => ({
          ...prev,
          sidebar: {
            ...prev.sidebar,
            storyHeight: prev.sidebar?.storyHeight || sHeight,
            chaptersHeight: prev.sidebar?.chaptersHeight || cHeight,
          },
        }));
      }
    }, [
      storyId,
      setEditorSettings,
      sidebarPrefs.storyHeight,
      sidebarPrefs.chaptersHeight,
    ]);

    // Collapse sidebar automatically when switching to split mode
    useEffect(() => {
      if (workspaceMode === 'split') {
        setIsSidebarOpen(false);
      }
    }, [workspaceMode, setIsSidebarOpen]);

    // Stable callbacks — setEditorSettings is a useState setter (always stable)
    // so these will never be recreated, preventing AppSidebar from re-rendering
    // just because AppMainLayout re-rendered (e.g. when editorControls changes).
    const toggleCollapsed = useCallback(
      (key: keyof NonNullable<typeof editorSettings.sidebar>): void => {
        setEditorSettings((prev: import('../../types').EditorSettings) => ({
          ...prev,
          sidebar: {
            ...prev.sidebar,
            [key]: !prev.sidebar?.[key],
          },
        }));
      },
      [setEditorSettings]
    );

    const updateHeight = useCallback(
      (key: keyof NonNullable<typeof editorSettings.sidebar>, height: number): void => {
        setEditorSettings((prev: import('../../types').EditorSettings) => ({
          ...prev,
          sidebar: {
            ...prev.sidebar,
            [key]: height,
          },
        }));
      },
      [setEditorSettings]
    );

    const {
      currentChapter,
      isChapterLoading,
      editorRef,
      recordHistoryEntry,
      viewMode,
      suggestionControls,
      aiControls,
      setActiveFormats,
      showWhitespace,
      setShowWhitespace,
      onOpenSearch,
    } = editorControls;

    // Stable callbacks so memoized sidebar sub-components don't re-render on
    // every AppMainLayout render caused by sidebarControls reference churn.
    const handleSourcebookToggle = useCallback(
      (id: string, checked: boolean): void => onToggleSourcebook?.(id, checked),
      [onToggleSourcebook]
    );
    const handleAddChapter = useCallback(
      async (bookId?: string): Promise<void> => {
        await addChapter('New Chapter', '', bookId);
      },
      [addChapter]
    );

    return (
      <main id="aq-main-layout" className="flex-1 flex overflow-hidden relative">
        <AppSidebar
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          sidebarControls={sidebarControls}
          sidebarPrefs={
            sidebarPrefs as NonNullable<MainEditorControls['editorSettings']['sidebar']>
          }
          isLight={isLight}
          currentTheme={currentTheme}
          instructionLanguages={instructionLanguages}
          handleSourcebookToggle={handleSourcebookToggle}
          handleAddChapter={handleAddChapter}
          toggleCollapsed={toggleCollapsed}
          updateHeight={updateHeight}
          workspaceMode={workspaceMode}
        />

        <section
          id="aq-workspace"
          role="main"
          aria-label={workspaceMode === 'scenes' ? t('Scenes') : t('Story editor')}
          className={`flex-1 flex relative overflow-hidden w-full h-full ${bgMain}`}
        >
          {workspaceMode === 'split' ? (
            <>
              <div className="w-1/3 border-r dark:border-brand-gray-800 h-full overflow-hidden">
                <ScenesPanelContainer
                  editorRef={editorRef}
                  currentChapter={currentChapter}
                  editorSettings={editorSettings}
                  recordHistoryEntry={recordHistoryEntry}
                />
              </div>
              <div className="flex-1 flex flex-col min-w-0 h-full relative">
                <EditorToolbar
                  viewControls={viewControls}
                  formatControls={formatControls}
                />
                <div className="flex-1 overflow-hidden h-full flex flex-col">
                  {isChapterLoading ? (
                    <ChapterLoadingSkeleton isLight={isLight} t={t} />
                  ) : currentChapter ? (
                    <Editor
                      ref={editorRef}
                      chapter={currentChapter}
                      settings={editorSettings}
                      language={editorControls.storyLanguage || 'en'}
                      viewMode={viewMode}
                      onChange={editorControls.updateChapter}
                      suggestionControls={{
                        continuations: suggestionControls.continuations,
                        suggestionMode: suggestionControls.suggestionMode,
                        setSuggestionMode: suggestionControls.setSuggestionMode,
                        isSuggesting: suggestionControls.isSuggesting,
                        onTriggerSuggestions:
                          suggestionControls.handleTriggerSuggestions,
                        onCancelSuggestion: suggestionControls.handleCancelSuggestions,
                        onAcceptContinuation:
                          suggestionControls.handleAcceptContinuation,
                        isSuggestionMode: suggestionControls.isSuggestionMode,
                        onKeyboardSuggestionAction:
                          suggestionControls.handleKeyboardSuggestionAction,
                      }}
                      aiControls={{
                        onAiAction: aiControls.handleAiAction,
                        isAiLoading: aiControls.isAiActionLoading,
                        isProseStreaming: aiControls.isProseStreaming,
                        isWritingAvailable: aiControls.isWritingAvailable,
                        onCancelAiAction: aiControls.cancelAiAction,
                      }}
                      onContextChange={setActiveFormats}
                      showWhitespace={showWhitespace}
                      onToggleShowWhitespace={(): void =>
                        setShowWhitespace(!showWhitespace)
                      }
                      baselineContent={editorControls.baselineContent}
                      spellCheck={true}
                      onOpenSearch={onOpenSearch}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-brand-gray-500">
                      <img
                        src="/static/images/logo_512.png"
                        srcSet="/static/images/logo_256.png 256w, /static/images/logo_512.png 512w, /static/images/logo_1024.png 1024w, /static/images/logo_2048.png 2048w"
                        sizes="(max-width: 640px) 128px, (max-width: 1024px) 192px, 256px"
                        className="w-64 h-64 mb-8 opacity-20"
                        alt="AugmentedQuill Logo"
                        decoding="async"
                        loading="lazy"
                      />
                      <p className="text-lg font-medium">
                        {t('Select or create a chapter to start writing.')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : workspaceMode === 'scenes' ? (
            <div className="flex-1 h-full overflow-hidden">
              <ScenesPanelContainer
                editorRef={editorRef}
                currentChapter={currentChapter}
                editorSettings={editorSettings}
                recordHistoryEntry={recordHistoryEntry}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-w-0 h-full relative">
              <EditorToolbar
                viewControls={viewControls}
                formatControls={formatControls}
              />
              <div className="flex-1 flex flex-col min-h-0 relative">
                {isChapterLoading ? (
                  <ChapterLoadingSkeleton isLight={isLight} t={t} />
                ) : currentChapter ? (
                  <Editor
                    ref={editorRef}
                    chapter={currentChapter}
                    settings={editorSettings}
                    language={editorControls.storyLanguage || 'en'}
                    viewMode={viewMode}
                    onChange={editorControls.updateChapter}
                    suggestionControls={{
                      continuations: suggestionControls.continuations,
                      suggestionMode: suggestionControls.suggestionMode,
                      setSuggestionMode: suggestionControls.setSuggestionMode,
                      isSuggesting: suggestionControls.isSuggesting,
                      onTriggerSuggestions: suggestionControls.handleTriggerSuggestions,
                      onCancelSuggestion: suggestionControls.handleCancelSuggestions,
                      onAcceptContinuation: suggestionControls.handleAcceptContinuation,
                      isSuggestionMode: suggestionControls.isSuggestionMode,
                      onKeyboardSuggestionAction:
                        suggestionControls.handleKeyboardSuggestionAction,
                    }}
                    aiControls={{
                      onAiAction: aiControls.handleAiAction,
                      isAiLoading: aiControls.isAiActionLoading,
                      isProseStreaming: aiControls.isProseStreaming,
                      isWritingAvailable: aiControls.isWritingAvailable,
                      onCancelAiAction: aiControls.cancelAiAction,
                    }}
                    onContextChange={setActiveFormats}
                    showWhitespace={showWhitespace}
                    onToggleShowWhitespace={(): void =>
                      setShowWhitespace(!showWhitespace)
                    }
                    baselineContent={editorControls.baselineContent}
                    spellCheck={true}
                    onOpenSearch={onOpenSearch}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-brand-gray-500">
                    <img
                      src="/static/images/logo_512.png"
                      srcSet="/static/images/logo_256.png 256w, /static/images/logo_512.png 512w, /static/images/logo_1024.png 1024w, /static/images/logo_2048.png 2048w"
                      sizes="(max-width: 640px) 128px, (max-width: 1024px) 192px, 256px"
                      className="w-64 h-64 mb-8 opacity-20"
                      alt="AugmentedQuill Logo"
                      decoding="async"
                      loading="lazy"
                    />
                    <p className="text-lg font-medium">
                      {t('Select or create a chapter to start writing.')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <AppChatPanel
          chatControls={chatControls}
          currentTheme={currentTheme}
          storyLanguage={storyLanguage ?? 'en'}
        />
      </main>
    );
  }
);
