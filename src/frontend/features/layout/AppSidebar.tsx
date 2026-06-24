// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Sidebar panel containing story metadata, chapter list, and sourcebook sections.
 * Extracted from AppMainLayout to keep each layout zone a focused single-responsibility unit.
 * Story data is now read from storyStore; dialog state from uiStore.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { ChapterList } from '../chapters/ChapterList';
import { SourcebookList } from '../sourcebook/SourcebookList';
import { StoryMetadata } from '../story/StoryMetadata';
import { CollapsibleSection } from './CollapsibleSection';
import { MainEditorControls, MainSidebarControls } from './layoutControlTypes';
import type { AppTheme } from '../../types';
import {
  useStoryBaseline,
  useStoryBooks,
  useStoryCanRedo,
  useStoryCanUndo,
  useStoryChaptersListMeta,
  useStoryMeta,
  useStorySourcebook,
} from '../../stores/storyStore';

export interface AppSidebarProps {
  workspaceMode?: 'page' | 'scenes' | 'split';
  isSidebarOpen: boolean;
  setIsSidebarOpen: (v: boolean) => void;
  sidebarControls: MainSidebarControls;
  sidebarPrefs: NonNullable<MainEditorControls['editorSettings']['sidebar']>;
  isLight: boolean;
  currentTheme: AppTheme;
  instructionLanguages: string[];
  handleSourcebookToggle: (id: string, checked: boolean) => void;
  handleAddChapter: (bookId?: string) => Promise<void>;
  toggleCollapsed: (
    key: keyof NonNullable<MainEditorControls['editorSettings']['sidebar']>
  ) => void;
  updateHeight: (
    key: keyof NonNullable<MainEditorControls['editorSettings']['sidebar']>,
    height: number
  ) => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = React.memo(
  ({
    workspaceMode,
    isSidebarOpen,
    setIsSidebarOpen,
    sidebarControls,
    sidebarPrefs,
    isLight,
    currentTheme,
    instructionLanguages,
    handleSourcebookToggle,
    handleAddChapter,
    toggleCollapsed,
    updateHeight,
  }: AppSidebarProps) => {
    const { t } = useTranslation();

    // Story data from Zustand storyStore (granular subscriptions)
    const storyMeta = useStoryMeta();
    // useStoryChaptersListMeta uses structural equality so typing in a chapter
    // does not cause the sidebar to re-render on every debounced keystroke.
    const chaptersMeta = useStoryChaptersListMeta();
    // Read undo/redo availability directly from storyStore so these boolean
    // values are not part of sidebarControls — keeping sidebarControls stable
    // during content-only edits and preventing AppMainLayout from re-rendering.
    const canAppUndo = useStoryCanUndo();
    const canAppRedo = useStoryCanRedo();
    const books = useStoryBooks();
    const sourcebook = useStorySourcebook();
    const baseline = useStoryBaseline();

    const {
      currentChapterId,
      handleChapterSelect,
      deleteChapter,
      updateChapter,
      updateBook,
      handleBookCreate,
      handleBookDelete,
      handleReorderChapters,
      handleReorderBooks,
      handleSidebarAiAction,
      isEditingAvailable,
      handleOpenImages,
      updateStoryMetadata,
      checkedSourcebookIds,
      onSourcebookMutated,
      onAppUndo,
      onAppRedo,
    } = sidebarControls;

    // canAppUndo / canAppRedo are read from storyStore above, not from sidebarControls.

    // Refs used during render for dynamic maxHeight computation
    const sidebarContentRef = React.useRef<HTMLDivElement>(null);

    // Minimum visible space reserved for the sourcebook header (never pushed off-screen).
    const SOURCEBOOK_MIN_VISIBLE = 56;

    // Minimum height for any resizable section (matches CollapsibleSection minHeaderHeight).
    const SECTION_MIN_HEIGHT = 56;

    const containerEl = sidebarContentRef.current;
    const containerHeight = containerEl?.clientHeight ?? 0;

    // Redistribute space when one section is resized: if Story grows too large,
    // shrink Chapters to keep sourcebook visible, and vice versa.
    const handleResizeHeight = React.useCallback(
      (key: 'storyHeight' | 'chaptersHeight', newHeight: number): void => {
        const containerH = sidebarContentRef.current?.clientHeight ?? 0;
        const available = containerH - SOURCEBOOK_MIN_VISIBLE;
        if (available <= 0) {
          updateHeight(key, newHeight);
          return;
        }

        const otherKey: 'storyHeight' | 'chaptersHeight' =
          key === 'storyHeight' ? 'chaptersHeight' : 'storyHeight';
        const otherHeight = Math.max(sidebarPrefs[otherKey] ?? 0, SECTION_MIN_HEIGHT);

        // Clamp the requested height to at least the section minimum
        const clamped = Math.max(newHeight, SECTION_MIN_HEIGHT);

        if (clamped + otherHeight <= available) {
          // Both fit comfortably
          updateHeight(key, clamped);
        } else if (clamped + SECTION_MIN_HEIGHT <= available) {
          // Shrink the other section to its minimum to make room
          updateHeight(key, clamped);
          updateHeight(otherKey, Math.max(SECTION_MIN_HEIGHT, available - clamped));
        } else {
          // Even at the other's minimum we would overflow: cap the request
          updateHeight(
            key,
            Math.max(SECTION_MIN_HEIGHT, available - SECTION_MIN_HEIGHT)
          );
          updateHeight(otherKey, SECTION_MIN_HEIGHT);
        }
      },
      [updateHeight, sidebarPrefs.chaptersHeight, sidebarPrefs.storyHeight]
    );

    // Stable callbacks for onDragResize (called continuously during drag)
    const handleStoryDragResize = React.useCallback(
      (h: number): void => handleResizeHeight('storyHeight', h),
      [handleResizeHeight]
    );
    const handleChaptersDragResize = React.useCallback(
      (h: number): void => handleResizeHeight('chaptersHeight', h),
      [handleResizeHeight]
    );

    return (
      <nav
        id="aq-sidebar"
        role="navigation"
        aria-label={t('Project sidebar')}
        className={`fixed inset-y-0 left-0 top-14 w-[var(--sidebar-width)] flex-col border-r flex-shrink-0 z-40 transition-transform duration-300 ease-in-out flex h-full ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${workspaceMode !== 'split' ? 'lg:relative lg:top-auto' : ''} ${
          workspaceMode !== 'split' && !isSidebarOpen ? 'lg:hidden' : ''
        } ${
          isLight
            ? 'bg-brand-gray-50 border-brand-gray-200'
            : 'bg-brand-gray-900 border-brand-gray-800'
        }`}
      >
        {isSidebarOpen && (
          <button
            className={`fixed inset-0 bg-brand-gray-950/60 z-30 cursor-default ${
              workspaceMode === 'split' ? 'lg:block' : 'lg:hidden'
            }`}
            onClick={(): void => setIsSidebarOpen(false)}
            aria-label={t('Close sidebar')}
          ></button>
        )}

        <div
          ref={sidebarContentRef}
          className="relative z-40 flex flex-col h-full overflow-hidden flex-1 bg-inherit"
        >
          <CollapsibleSection
            title={t('Story')}
            isCollapsed={!!sidebarPrefs.isStoryCollapsed}
            onToggle={(): void => toggleCollapsed('isStoryCollapsed')}
            height={sidebarPrefs.storyHeight}
            onHeightChange={(h: number): void => handleResizeHeight('storyHeight', h)}
            onDragResize={handleStoryDragResize}
            isLight={isLight}
          >
            <StoryMetadata
              title={storyMeta.title}
              summary={storyMeta.summary}
              tags={storyMeta.styleTags}
              notes={storyMeta.notes}
              private_notes={storyMeta.private_notes}
              language={storyMeta.language}
              conflicts={storyMeta.conflicts}
              projectType={storyMeta.projectType}
              baselineSummary={baseline?.summary}
              baselineNotes={baseline?.notes}
              baselinePrivateNotes={baseline?.private_notes}
              baselineConflicts={baseline?.conflicts}
              onAiGenerateSummary={(
                action: 'update' | 'rewrite' | 'write',
                onProgress: ((text: string) => void) | undefined,
                currentText: string | undefined,
                onThinking: ((thinking: string) => void) | undefined,
                source: 'notes' | 'chapter' | undefined
              ): Promise<string | undefined> =>
                handleSidebarAiAction(
                  'story',
                  storyMeta.id,
                  action,
                  onProgress,
                  currentText,
                  onThinking,
                  source
                )
              }
              summaryAiDisabledReason={
                !isEditingAvailable
                  ? t(
                      'Summary AI is unavailable because no working EDITING model is configured.'
                    )
                  : undefined
              }
              primarySourceAvailable={
                storyMeta.projectType === 'short-story'
                  ? !storyMeta.draftIsEmpty
                  : undefined
              }
              onUpdate={updateStoryMetadata}
              theme={currentTheme}
              languages={instructionLanguages}
              spellCheck={true}
            />
          </CollapsibleSection>

          {storyMeta.projectType !== 'short-story' && (
            <CollapsibleSection
              title={t('Chapters')}
              isCollapsed={!!sidebarPrefs.isChaptersCollapsed}
              onToggle={(): void => toggleCollapsed('isChaptersCollapsed')}
              height={sidebarPrefs.chaptersHeight}
              onHeightChange={(h: number): void =>
                handleResizeHeight('chaptersHeight', h)
              }
              onDragResize={handleChaptersDragResize}
              isLight={isLight}
            >
              <ChapterList
                chapters={chaptersMeta}
                books={books}
                projectType={storyMeta.projectType}
                currentChapterId={currentChapterId}
                onSelect={handleChapterSelect}
                onDelete={deleteChapter}
                onUpdateChapter={updateChapter}
                onUpdateBook={updateBook}
                onCreate={handleAddChapter}
                onBookCreate={handleBookCreate}
                onBookDelete={handleBookDelete}
                onReorderChapters={handleReorderChapters}
                onReorderBooks={handleReorderBooks}
                onAiAction={handleSidebarAiAction}
                isAiAvailable={isEditingAvailable}
                theme={currentTheme}
                onOpenImages={handleOpenImages}
                languages={instructionLanguages}
                baselineChapters={baseline?.chapters}
                language={storyMeta.language}
                spellCheck={true}
              />
            </CollapsibleSection>
          )}

          <CollapsibleSection
            title={t('Sourcebook')}
            isCollapsed={!!sidebarPrefs.isSourcebookCollapsed}
            onToggle={(): void => toggleCollapsed('isSourcebookCollapsed')}
            isLast
            isLight={isLight}
          >
            <SourcebookList
              theme={currentTheme}
              language={storyMeta.language}
              externalEntries={sourcebook}
              checkedIds={checkedSourcebookIds || []}
              onToggle={handleSourcebookToggle}
              isAutoSelectionEnabled={sidebarControls.isAutoSourcebookSelectionEnabled}
              onToggleAutoSelection={sidebarControls.onToggleAutoSourcebookSelection}
              isAutoSelectionRunning={sidebarControls.isSourcebookSelectionRunning}
              mutatedEntryIds={sidebarControls.mutatedSourcebookEntryIds}
              onMutated={onSourcebookMutated}
              onAppUndo={onAppUndo}
              onAppRedo={onAppRedo}
              canAppUndo={canAppUndo}
              canAppRedo={canAppRedo}
              baselineEntries={baseline?.sourcebook}
            />
          </CollapsibleSection>
        </div>
      </nav>
    );
  }
);
