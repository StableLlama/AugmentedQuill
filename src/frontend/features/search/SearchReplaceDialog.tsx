// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Modal dialog for project-wide search and replace, supporting
 * literal, regex, and phonetic modes across chapters, sourcebook, and metadata.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  X,
  ChevronDown,
  ChevronRight,
  Search,
  ArrowUp,
  ArrowDown,
  Loader2,
} from 'lucide-react';
import { useFocusTrap } from '../layout/useFocusTrap';
import { useThemeClasses } from '../layout/ThemeContext';
import { Button } from '../../components/ui/Button';
import type { UseSearchReplaceResult } from './useSearchReplace';
import type { SearchScope } from '../../services/apiClients/search';

interface SearchReplaceDialogProps {
  searchState: UseSearchReplaceResult;
  activeChapterId: number | null;
  storyLanguage: string;
  onJumpToPosition: (start: number, end: number) => void;
  onStoryChanged: () => void;
  onNavigateToChapter: (
    chapterId: number,
    jumpStart?: number,
    jumpEnd?: number
  ) => void;
  onNavigateToSourcebookEntry: (entryId: string) => void;
  onNavigateToStoryMetadata: (field: string) => void;
}

const SCOPES: { value: SearchScope; labelKey: string }[] = [
  { value: 'current_chapter', labelKey: 'Current Chapter' },
  { value: 'all_chapters', labelKey: 'All Chapters' },
  { value: 'sourcebook', labelKey: 'Sourcebook' },
  { value: 'metadata', labelKey: 'Metadata' },
  { value: 'all', labelKey: 'All' },
];

function navigateSearchMatch(
  sectionType: string,
  sectionId: string,
  field: string,
  start: number,
  end: number,
  activeChapterId: number | null,
  onJumpToPosition: (start: number, end: number) => void,
  onNavigateToChapter: (
    chapterId: number,
    jumpStart?: number,
    jumpEnd?: number
  ) => void,
  onNavigateToSourcebookEntry: (entryId: string) => void,
  onNavigateToStoryMetadata: (field: string) => void
): void {
  if (sectionType === 'chapter_content') {
    if (activeChapterId !== null && sectionId === String(activeChapterId)) {
      onJumpToPosition(start, end);
      return;
    }

    const chapId = parseInt(sectionId, 10);
    if (!Number.isNaN(chapId)) {
      onNavigateToChapter(chapId, start, end);
    }
    return;
  }

  if (sectionType === 'chapter_metadata') {
    const chapId = parseInt(sectionId, 10);
    if (!Number.isNaN(chapId)) {
      onNavigateToChapter(chapId);
    }
    return;
  }

  if (sectionType === 'story_metadata') {
    onNavigateToStoryMetadata(field);
    return;
  }

  if (sectionType === 'sourcebook') {
    onNavigateToSourcebookEntry(sectionId);
  }
}

interface SearchDialogTheme {
  dialogTheme: 'light' | 'dark';
  toggleActiveClass: string;
  toggleInactiveClass: string;
  radioLabelClass: string;
  sectionHeaderClass: string;
  matchItemClass: string;
  statusClass: string;
  counterClass: string;
  closeClass: string;
}

function buildSearchDialogTheme(isLight: boolean): SearchDialogTheme {
  return {
    dialogTheme: isLight ? 'light' : 'dark',
    toggleActiveClass: isLight
      ? 'px-2 py-1 text-xs rounded border bg-brand-100 border-brand-300 text-brand-700 font-medium'
      : 'px-2 py-1 text-xs rounded border bg-brand-900 border-brand-700 text-brand-300 font-medium',
    toggleInactiveClass: isLight
      ? 'px-2 py-1 text-xs rounded border border-brand-gray-300 text-brand-gray-600 hover:bg-brand-gray-100 transition-colors'
      : 'px-2 py-1 text-xs rounded border border-brand-gray-600 text-brand-gray-400 hover:bg-brand-gray-800 transition-colors',
    radioLabelClass: isLight
      ? 'flex items-center gap-1 text-xs text-brand-gray-700 cursor-pointer'
      : 'flex items-center gap-1 text-xs text-brand-gray-300 cursor-pointer',
    sectionHeaderClass: isLight
      ? 'flex items-center gap-1 w-full text-left text-sm font-medium text-brand-gray-700 py-1 hover:text-brand-gray-900 transition-colors'
      : 'flex items-center gap-1 w-full text-left text-sm font-medium text-brand-gray-300 py-1 hover:text-brand-gray-100 transition-colors',
    matchItemClass: isLight
      ? 'text-xs text-brand-gray-600 py-0.5 pl-4 hover:bg-brand-gray-50 cursor-pointer rounded transition-colors'
      : 'text-xs text-brand-gray-400 py-0.5 pl-4 hover:bg-brand-gray-800 cursor-pointer rounded transition-colors',
    statusClass: isLight
      ? 'text-xs text-brand-gray-500 flex-1'
      : 'text-xs text-brand-gray-400 flex-1',
    counterClass: isLight
      ? 'text-xs text-brand-gray-600 font-medium'
      : 'text-xs text-brand-gray-300 font-medium',
    closeClass: isLight
      ? 'p-1 rounded-md text-brand-gray-500 hover:text-brand-gray-700 hover:bg-brand-gray-100 transition-colors'
      : 'p-1 rounded-md text-brand-gray-400 hover:text-brand-gray-100 hover:bg-brand-gray-800 transition-colors',
  };
}

interface SearchDialogContentProps {
  dialogRef: React.RefObject<HTMLDivElement | null>;
  queryInputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  isRegex: boolean;
  isPhonetic: boolean;
  scope: SearchScope;
  results: import('../../services/apiClients/search').SearchResultSection[];
  totalMatches: number;
  currentMatchIndex: number | null;
  flatMatches: unknown[];
  isLoading: boolean;
  error: string | null;
  collapsedSections: Set<string>;
  storyLanguage: string;
  activeChapterId: number | null;
  theme: SearchDialogTheme;
  themeClasses: ReturnType<typeof useThemeClasses>;
  isLight: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
  close: (keepOpen?: boolean) => void;
  setQuery: (v: string) => void;
  setReplacement: (v: string) => void;
  setCaseSensitive: (v: boolean) => void;
  setIsRegex: (v: boolean) => void;
  setIsPhonetic: (v: boolean) => void;
  setScope: (v: SearchScope) => void;
  selectMatch: (idx: number) => void;
  navigateNext: () => void;
  navigatePrev: () => void;
  handleSearch: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleReplaceCurrent: () => Promise<void>;
  handleReplaceAll: () => Promise<void>;
  toggleSection: (key: string) => void;
  handleMatchClick: (
    sectionType: string,
    sectionId: string,
    field: string,
    start: number,
    end: number
  ) => void;
}

const SearchDialogContent: React.FC<SearchDialogContentProps> = ({
  dialogRef,
  queryInputRef,
  query,
  replacement,
  caseSensitive,
  isRegex,
  isPhonetic,
  scope,
  results,
  totalMatches,
  currentMatchIndex,
  flatMatches,
  isLoading,
  error,
  collapsedSections,
  storyLanguage,
  activeChapterId,
  theme,
  themeClasses,
  isLight,
  t,
  close,
  setQuery,
  setReplacement,
  setCaseSensitive,
  setIsRegex,
  setIsPhonetic,
  setScope,
  selectMatch,
  navigateNext,
  navigatePrev,
  handleSearch,
  handleKeyDown,
  handleReplaceCurrent,
  handleReplaceAll,
  toggleSection,
  handleMatchClick,
}: SearchDialogContentProps) => {
  const overlayClass =
    'fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4';
  const dialogClass = `border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col ${themeClasses.bg} ${themeClasses.border}`;
  const headerClass = `flex items-center justify-between px-4 py-3 border-b ${themeClasses.border}`;
  const titleClass = `flex items-center gap-2 font-semibold ${themeClasses.text}`;
  const inputClass = `flex-1 px-3 py-2 rounded-md border ${themeClasses.border} text-sm ${themeClasses.text} ${themeClasses.input} focus:outline-none focus:ring-2 focus:ring-brand-500`;
  const {
    dialogTheme,
    toggleActiveClass,
    toggleInactiveClass,
    radioLabelClass,
    sectionHeaderClass,
    matchItemClass,
    statusClass,
    counterClass,
    closeClass,
  } = theme;
  return (
    <div className={overlayClass} role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('Search and Replace')}
        className={dialogClass}
      >
        <div className={headerClass}>
          <span className={titleClass}>
            <Search size={16} />
            {t('Search and Replace')}
          </span>
          <button
            type="button"
            onClick={(): void => close()}
            aria-label={t('Close search')}
            className={closeClass}
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-3 space-y-2 border-b border-brand-gray-200 dark:border-brand-gray-700">
          <div className="flex gap-2">
            <input
              ref={queryInputRef}
              type="text"
              value={query}
              onChange={(
                e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
              ): void => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('Search...')}
              aria-label={t('Search...')}
              lang={storyLanguage}
              className={inputClass}
              autoComplete="off"
              spellCheck={true}
            />
            <Button
              type="button"
              theme={dialogTheme}
              variant="primary"
              size="md"
              onClick={handleSearch}
              disabled={isLoading || !query.trim()}
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : t('Find')}
            </Button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={replacement}
              onChange={(
                e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
              ): void => setReplacement(e.target.value)}
              placeholder={t('Replace...')}
              aria-label={t('Replace...')}
              lang={storyLanguage}
              className={inputClass}
              autoComplete="off"
              spellCheck={true}
            />
            <Button
              type="button"
              theme={dialogTheme}
              variant="secondary"
              size="md"
              onClick={handleReplaceCurrent}
              disabled={isLoading || currentMatchIndex === null || !query.trim()}
            >
              {t('Replace')}
            </Button>
            <Button
              type="button"
              theme={dialogTheme}
              variant="secondary"
              size="md"
              onClick={handleReplaceAll}
              disabled={isLoading || totalMatches === 0 || !query.trim()}
            >
              {t('Replace All')}
            </Button>
          </div>
        </div>
        <div className="px-4 py-2 border-b border-brand-gray-200 dark:border-brand-gray-700 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={(): void => setCaseSensitive(!caseSensitive)}
              className={caseSensitive ? toggleActiveClass : toggleInactiveClass}
              aria-pressed={caseSensitive}
              title={t('Case Sensitive')}
            >
              Aa
            </button>
            <button
              type="button"
              onClick={(): void => {
                setIsRegex(!isRegex);
                if (!isRegex) setIsPhonetic(false);
              }}
              className={isRegex ? toggleActiveClass : toggleInactiveClass}
              aria-pressed={isRegex}
              title={t('Regular Expression')}
            >
              .*
            </button>
            <button
              type="button"
              onClick={(): void => {
                setIsPhonetic(!isPhonetic);
                if (!isPhonetic) setIsRegex(false);
              }}
              className={isPhonetic ? toggleActiveClass : toggleInactiveClass}
              aria-pressed={isPhonetic}
              title={t('Phonetic')}
            >
              ~
            </button>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {SCOPES.map(
              ({ value, labelKey }: { value: SearchScope; labelKey: string }) => (
                <label key={value} className={radioLabelClass}>
                  <input
                    type="radio"
                    name="search-scope"
                    value={value}
                    checked={scope === value}
                    onChange={(): void => setScope(value)}
                    className="accent-brand-600"
                  />
                  {t(labelKey)}
                </label>
              )
            )}
          </div>
        </div>
        <div className="px-4 py-2 flex items-center gap-2 border-b border-brand-gray-200 dark:border-brand-gray-700">
          <span className={statusClass}>
            {error ? (
              <span className="text-red-500">{error}</span>
            ) : isLoading ? (
              <span className="flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" />
                {t('Find')}…
              </span>
            ) : totalMatches === 0 && query.trim() ? (
              t('No matches found')
            ) : totalMatches > 0 ? (
              t('{{count}} matches found', { count: totalMatches })
            ) : null}
          </span>
          {flatMatches.length > 0 && (
            <div className="flex items-center gap-1">
              <span className={counterClass}>
                {currentMatchIndex !== null ? currentMatchIndex + 1 : 0}/
                {flatMatches.length}
              </span>
              <button
                type="button"
                onClick={navigatePrev}
                aria-label={t('Previous match')}
                className={toggleInactiveClass}
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                onClick={navigateNext}
                aria-label={t('Next match')}
                className={toggleInactiveClass}
              >
                <ArrowDown size={12} />
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1 min-h-0">
          {results.map(
            (
              section: import('../../services/apiClients/search').SearchResultSection,
              si: number
            ) => {
              const sectionKey = `${section.section_type}:${section.section_id}:${section.field}`;
              const isCollapsed = collapsedSections.has(sectionKey);
              const sectionLabel =
                section.section_type === 'chapter_content' ||
                section.section_type === 'chapter_metadata'
                  ? t('Chapter {{title}}', { title: section.section_title })
                  : section.section_type === 'sourcebook'
                    ? `${t('Sourcebook')}: ${section.section_title}`
                    : section.section_type === 'scene_metadata'
                      ? `${t('Scene')}: ${section.section_title}`
                      : t('Story Metadata');
              let firstFlatIdx = 0;
              for (let i = 0; i < si; i++) {
                firstFlatIdx += (results[i].matches ?? []).length;
              }
              return (
                <div key={sectionKey}>
                  <button
                    type="button"
                    onClick={(): void => toggleSection(sectionKey)}
                    className={sectionHeaderClass}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                    <span>
                      {sectionLabel}
                      {section.field_display ? ` · ${section.field_display}` : ''}
                    </span>
                    <span className="ml-1 text-xs opacity-60">
                      ({(section.matches ?? []).length})
                    </span>
                  </button>
                  {!isCollapsed && (
                    <ul>
                      {(section.matches ?? []).map(
                        (
                          match: import('../../services/apiClients/search').SearchMatch,
                          mi: number
                        ) => {
                          const flatIdx = firstFlatIdx + mi;
                          const isCurrentMatch = flatIdx === currentMatchIndex;
                          const clickTitle =
                            section.section_type === 'chapter_content' &&
                            activeChapterId !== null &&
                            section.section_id === String(activeChapterId)
                              ? t('Jump to match in editor')
                              : section.section_type === 'chapter_content' ||
                                  section.section_type === 'chapter_metadata'
                                ? t('Navigate to chapter')
                                : section.section_type === 'story_metadata'
                                  ? t('Open story metadata')
                                  : section.section_type === 'scene_metadata'
                                    ? t('Open scene')
                                    : section.section_type === 'sourcebook'
                                      ? t('Open sourcebook entry')
                                      : undefined;
                          return (
                            <li
                              key={mi}
                              role="button"
                              tabIndex={0}
                              className={
                                isCurrentMatch
                                  ? isLight
                                    ? 'bg-brand-50 border-l-2 border-brand-500 pl-3 py-0.5 text-xs text-brand-gray-700 rounded-r cursor-pointer'
                                    : 'bg-brand-950 border-l-2 border-brand-500 pl-3 py-0.5 text-xs text-brand-gray-200 rounded-r cursor-pointer'
                                  : matchItemClass
                              }
                              onClick={(): void => {
                                selectMatch(flatIdx);
                                handleMatchClick(
                                  section.section_type,
                                  section.section_id,
                                  section.field,
                                  match.start,
                                  match.end
                                );
                              }}
                              onDoubleClick={(): void => close(true)}
                              onKeyDown={(
                                e: React.KeyboardEvent<HTMLLIElement>
                              ): void => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  selectMatch(flatIdx);
                                  handleMatchClick(
                                    section.section_type,
                                    section.section_id,
                                    section.field,
                                    match.start,
                                    match.end
                                  );
                                }
                              }}
                              title={clickTitle}
                            >
                              <span className="opacity-60">{match.context_before}</span>
                              <mark
                                className={
                                  isLight
                                    ? 'bg-yellow-200 text-brand-gray-900 rounded px-0.5'
                                    : 'bg-yellow-800 text-yellow-100 rounded px-0.5'
                                }
                              >
                                {match.match_text}
                              </mark>
                              <span className="opacity-60">{match.context_after}</span>
                            </li>
                          );
                        }
                      )}
                    </ul>
                  )}
                </div>
              );
            }
          )}
        </div>
      </div>
    </div>
  );
};

export const SearchReplaceDialog: React.FC<SearchReplaceDialogProps> = ({
  searchState,
  activeChapterId,
  storyLanguage,
  onJumpToPosition,
  onStoryChanged,
  onNavigateToChapter,
  onNavigateToSourcebookEntry,
  onNavigateToStoryMetadata,
}: SearchReplaceDialogProps) => {
  const { t } = useTranslation();
  const themeClasses = useThemeClasses();
  const { isLight } = themeClasses;
  const dialogRef = useRef<HTMLDivElement>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const {
    isOpen,
    close,
    query,
    setQuery,
    replacement,
    setReplacement,
    caseSensitive,
    setCaseSensitive,
    isRegex,
    setIsRegex,
    isPhonetic,
    setIsPhonetic,
    scope,
    setScope,
    results,
    totalMatches,
    currentMatchIndex,
    flatMatches,
    isLoading,
    error,
    runSearch,
    selectMatch,
    navigateNext,
    navigatePrev,
    replaceCurrent,
    replaceAllMatches,
  } = searchState;

  useFocusTrap(isOpen, dialogRef, close);

  // Focus query input when dialog opens
  useEffect((): void => {
    if (isOpen) {
      setTimeout((): void | undefined => queryInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSearch = useCallback((): void => {
    void runSearch(activeChapterId);
  }, [runSearch, activeChapterId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSearch();
      }
    },
    [handleSearch]
  );

  const handleReplaceCurrent = useCallback(async (): Promise<void> => {
    const changed = await replaceCurrent(activeChapterId);
    if (changed) onStoryChanged();
  }, [replaceCurrent, activeChapterId, onStoryChanged]);

  const handleReplaceAll = useCallback(async (): Promise<void> => {
    const { storyChanged } = await replaceAllMatches(activeChapterId);
    if (storyChanged) onStoryChanged();
  }, [replaceAllMatches, activeChapterId, onStoryChanged]);

  const toggleSection = useCallback((key: string): void => {
    setCollapsedSections((prev: Set<string>): Set<string> => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleMatchClick = useCallback(
    (
      sectionType: string,
      sectionId: string,
      field: string,
      start: number,
      end: number
    ): void => {
      navigateSearchMatch(
        sectionType,
        sectionId,
        field,
        start,
        end,
        activeChapterId,
        onJumpToPosition,
        onNavigateToChapter,
        onNavigateToSourcebookEntry,
        onNavigateToStoryMetadata
      );
    },
    [
      activeChapterId,
      onJumpToPosition,
      onNavigateToChapter,
      onNavigateToSourcebookEntry,
      onNavigateToStoryMetadata,
    ]
  );

  if (!isOpen) return null;

  return createPortal(
    <SearchDialogContent
      dialogRef={dialogRef}
      queryInputRef={queryInputRef}
      query={query}
      replacement={replacement}
      caseSensitive={caseSensitive}
      isRegex={isRegex}
      isPhonetic={isPhonetic}
      scope={scope}
      results={results}
      totalMatches={totalMatches}
      currentMatchIndex={currentMatchIndex}
      flatMatches={flatMatches}
      isLoading={isLoading}
      error={error}
      collapsedSections={collapsedSections}
      storyLanguage={storyLanguage}
      activeChapterId={activeChapterId}
      theme={buildSearchDialogTheme(isLight)}
      themeClasses={themeClasses}
      isLight={isLight}
      t={t}
      close={close}
      setQuery={setQuery}
      setReplacement={setReplacement}
      setCaseSensitive={setCaseSensitive}
      setIsRegex={setIsRegex}
      setIsPhonetic={setIsPhonetic}
      setScope={setScope}
      selectMatch={selectMatch}
      navigateNext={navigateNext}
      navigatePrev={navigatePrev}
      handleSearch={handleSearch}
      handleKeyDown={handleKeyDown}
      handleReplaceCurrent={handleReplaceCurrent}
      handleReplaceAll={handleReplaceAll}
      toggleSection={toggleSection}
      handleMatchClick={handleMatchClick}
    />,
    document.body
  );
};
