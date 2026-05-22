// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Render the metadata editor dialog UI while keeping orchestration logic in the container.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Maximize2,
  Minimize2,
  FileText,
  StickyNote,
  Lock,
  AlertTriangle,
  Loader2,
  Check,
  Trash2,
  Wand2,
  RefreshCw,
  PenLine,
  ChevronDown,
  ChevronRight,
  Undo,
  Redo,
  Brain,
  MessageSquareDiff,
} from 'lucide-react';
import { AppTheme, Conflict } from '../../types';
import { MetadataParams } from './metadataSync';
import { Button } from '../../components/ui/Button';
import { CodeMirrorEditor } from '../editor/CodeMirrorEditor';

type MetadataTab = 'summary' | 'notes' | 'private' | 'conflicts' | 'scenes';

type MetadataAction = 'write' | 'update' | 'rewrite';
type MetadataAiSource = 'chapter' | 'notes';

interface MetadataEditorDialogViewProps {
  title: string;
  type: 'story' | 'book' | 'chapter';
  theme: AppTheme;
  dialogRef: React.RefObject<HTMLDivElement | null>;
  saveStatus: 'saved' | 'saving' | 'error';
  isDarkMode: boolean;
  isFullscreen: boolean;
  showDiff: boolean;
  historyIndex: number;
  historyLength: number;
  activeTab: MetadataTab;
  data: MetadataParams;
  baselineData: MetadataParams;
  conflicts: Conflict[];
  languages?: string[];
  allowConflicts: boolean;
  hasAiSummaryControls: boolean;
  aiThinking: string | null;
  isThinkingExpanded: boolean;
  isAiGenerating: boolean;
  aiWriteSource: MetadataAiSource;
  aiDisabledReason?: string;
  primarySourceLabel: string;
  primarySourceTitle: string;
  regeneratePrimaryTitle: string;
  updatePrimaryTitle: string;
  rewritePrimaryTitle: string;
  hasPrimarySource: boolean;
  hasNotesSource: boolean;
  effectiveLanguage: string;
  spellCheck: boolean;
  summaryHighlightRanges: Array<{ start: number; end: number }>;
  notesHighlightRanges: Array<{ start: number; end: number }>;
  privateNotesHighlightRanges: Array<{ start: number; end: number }>;
  getConflictRanges: (
    index: number,
    field: 'description' | 'resolution'
  ) => Array<{ start: number; end: number }>;
  onSetIsFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
  onToggleShowDiff: () => void;
  onRestoreHistory: (index: number) => void;
  onClose: () => void;
  onSetActiveTab: (tab: MetadataTab) => void;
  onSetData: React.Dispatch<React.SetStateAction<MetadataParams>>;
  onSetBaselineData: React.Dispatch<React.SetStateAction<MetadataParams>>;
  onSetIsThinkingExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  onSetAiWriteSource: (source: MetadataAiSource) => void;
  onAiGenerate: (action: MetadataAction, source?: MetadataAiSource) => Promise<void>;
  onAddConflict: () => void;
  onDeleteConflict: (id: string) => void;
  onUpdateConflict: (id: string, field: keyof Conflict, value: string) => void;
  onMoveConflict: (index: number, direction: 'up' | 'down') => void;
  onEditorUndoRedo: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  chapterScenes?: Array<{ id: string; summary: string }>;
}

interface DialogHeaderProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  title: string;
  saveStatus: 'saved' | 'saving' | 'error';
  historyIndex: number;
  historyLength: number;
  showDiff: boolean;
  isFullscreen: boolean;
  onToggleShowDiff: () => void;
  onRestoreHistory: (index: number) => void;
  onSetIsFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
  onClose: () => void;
}

const DialogHeader: React.FC<DialogHeaderProps> = ({
  t,
  title,
  saveStatus,
  historyIndex,
  historyLength,
  showDiff,
  isFullscreen,
  onToggleShowDiff,
  onRestoreHistory,
  onSetIsFullscreen,
  onClose,
}: DialogHeaderProps) => {
  return (
    <div className="flex justify-between items-center p-4 border-b dark:border-brand-gray-800">
      <div className="flex items-center gap-3">
        <h2
          id="metadata-dialog-title"
          className="text-base font-semibold dark:text-brand-gray-300"
        >
          {title}
        </h2>
        <div className="text-xs font-mono" role="status" aria-live="polite">
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1 text-brand-500">
              <Loader2 size={12} className="animate-spin" /> {t('Saving...')}
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-green-500">
              <Check size={12} /> {t('Saved')}
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="text-red-500">{t('Error saving')}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={(): false | void =>
            historyIndex > 0 && onRestoreHistory(historyIndex - 1)
          }
          disabled={historyIndex === 0}
          className="text-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed dark:text-brand-gray-500 dark:hover:text-brand-gray-300"
          title={t('Undo')}
          aria-label={t('Undo metadata editor changes')}
        >
          <Undo size={16} />
        </button>
        <button
          onClick={(): false | void =>
            historyIndex < historyLength - 1 && onRestoreHistory(historyIndex + 1)
          }
          disabled={historyIndex >= historyLength - 1}
          className="text-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed dark:text-brand-gray-500 dark:hover:text-brand-gray-300"
          title={t('Redo')}
          aria-label={t('Redo metadata editor changes')}
        >
          <Redo size={16} />
        </button>
        <button
          onClick={onToggleShowDiff}
          className={`${showDiff ? 'text-brand-500 hover:text-brand-600' : 'text-gray-400 hover:text-gray-600 dark:text-brand-gray-600 dark:hover:text-brand-gray-400'}`}
          title={showDiff ? t('Hide diff highlights') : t('Show diff highlights')}
          aria-label={t('Toggle diff view')}
          aria-pressed={showDiff}
        >
          <MessageSquareDiff size={16} />
        </button>
        <button
          onClick={() => onSetIsFullscreen((value: boolean): boolean => !value)}
          className="text-gray-500 hover:text-gray-700 dark:text-brand-gray-500 dark:hover:text-brand-gray-300"
          title={
            isFullscreen ? t('Switch to Sidebar View') : t('Switch to Full Screen')
          }
          aria-label={
            isFullscreen ? t('Switch to sidebar view') : t('Switch to full screen view')
          }
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 dark:text-brand-gray-500 dark:hover:text-brand-gray-300"
          title={t('Close dialog')}
          aria-label={t('Close metadata editor dialog')}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

interface TitleFormSectionProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  type: 'story' | 'book' | 'chapter';
  data: MetadataParams;
  languages?: string[];
  onSetData: React.Dispatch<React.SetStateAction<MetadataParams>>;
}

const TitleFormSection: React.FC<TitleFormSectionProps> = ({
  t,
  type,
  data,
  languages,
  onSetData,
}: TitleFormSectionProps) => {
  return (
    <div className="p-4 border-b dark:border-brand-gray-800 space-y-2 flex-shrink-0">
      <label
        htmlFor="metadata-dialog-title-input"
        className="block text-sm font-medium dark:text-brand-gray-400"
      >
        {t('Title')}
      </label>
      <input
        id="metadata-dialog-title-input"
        value={data.title || ''}
        lang={data.language || 'en'}
        spellCheck={true}
        onChange={(event: React.ChangeEvent<HTMLInputElement, HTMLInputElement>) =>
          onSetData({ ...data, title: event.target.value })
        }
        className="w-full p-2 border rounded dark:bg-brand-gray-950 dark:border-brand-gray-800 text-brand-gray-900 dark:text-brand-gray-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 font-sans text-sm"
      />
      {type === 'story' && (
        <>
          <div className="flex items-start gap-3 mt-3">
            <div className="flex-1 min-w-0">
              <label className="block text-sm font-medium dark:text-brand-gray-400">
                {t('Style Tags')}
              </label>
              <input
                value={data.tags ? data.tags.join(', ') : ''}
                lang={data.language || 'en'}
                spellCheck={true}
                onChange={(
                  event: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
                ): void => {
                  const val = event.target.value;
                  const tags = val
                    .split(',')
                    .map((item: string): string => item.trimStart());
                  onSetData({ ...data, tags });
                }}
                className="w-full p-2 border rounded dark:bg-brand-gray-950 dark:border-brand-gray-800 text-brand-gray-900 dark:text-brand-gray-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 font-sans text-sm"
                placeholder={t('e.g. Noir, Sci-Fi, First-Person')}
              />
            </div>
            {languages && (
              <div className="flex-shrink-0 w-24">
                <label className="block text-sm font-medium dark:text-brand-gray-400 text-right">
                  {t('Lang')}
                </label>
                <select
                  value={data.language || ''}
                  onChange={(
                    event: React.ChangeEvent<HTMLSelectElement, HTMLSelectElement>
                  ) => onSetData({ ...data, language: event.target.value })}
                  className="w-full p-2 border rounded dark:bg-brand-gray-950 dark:border-brand-gray-800 text-brand-gray-900 dark:text-brand-gray-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 font-sans text-sm"
                >
                  {languages.map((lng: string) => (
                    <option key={lng} value={lng}>
                      {lng.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="text-xs text-brand-gray-500 dark:text-brand-gray-500 mt-2">
            {t(
              "Style tags guide the WRITING model's voice and the EDITING model's tone checks. Keep them short, specific, and stable."
            )}
          </p>
        </>
      )}
    </div>
  );
};

interface TabBarProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  activeTab: MetadataTab;
  type: 'story' | 'book' | 'chapter';
  allowConflicts: boolean;
  chapterScenes: Array<{ id: string; summary: string }>;
  onSetActiveTab: (tab: MetadataTab) => void;
}

const TabBar: React.FC<TabBarProps> = ({
  t,
  activeTab,
  type,
  allowConflicts,
  chapterScenes,
  onSetActiveTab,
}: TabBarProps) => {
  const tabClass = (tab: MetadataTab): string =>
    `px-4 py-2 flex items-center gap-2 whitespace-nowrap text-sm ${
      activeTab === tab
        ? 'border-b-2 border-primary text-primary font-semibold'
        : 'text-brand-gray-500 hover:text-brand-gray-700 dark:text-brand-gray-500 dark:hover:text-brand-gray-300'
    }`;
  return (
    <div className="flex border-b dark:border-brand-gray-800 overflow-x-auto flex-shrink-0">
      <button
        onClick={(): void => onSetActiveTab('summary')}
        className={tabClass('summary')}
      >
        <FileText size={16} />
        {t('Summary')}
      </button>
      <button
        onClick={(): void => onSetActiveTab('notes')}
        className={tabClass('notes')}
      >
        <StickyNote size={16} />
        {t('Notes')}
      </button>
      <button
        onClick={(): void => onSetActiveTab('private')}
        className={tabClass('private')}
      >
        <Lock size={16} />
        {t('Private Notes')}
      </button>
      {(type === 'chapter' || allowConflicts) && (
        <button
          onClick={(): void => onSetActiveTab('conflicts')}
          className={tabClass('conflicts')}
        >
          <AlertTriangle size={16} />
          {t('Conflicts')}
        </button>
      )}
      {type === 'chapter' && (
        <button
          onClick={(): void => onSetActiveTab('scenes')}
          className={tabClass('scenes')}
        >
          <FileText size={16} />
          {t('Scenes')}
          <span
            className="ml-1 inline-flex items-center justify-center rounded-full bg-brand-gray-200 dark:bg-brand-gray-700 px-1.5 py-0.5 text-[10px]"
            aria-label={t('Scene count: {{count}}', { count: chapterScenes.length })}
          >
            {chapterScenes.length}
          </span>
        </button>
      )}
    </div>
  );
};

interface AiWriteButtonGroupProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  theme: AppTheme;
  aiWriteSource: MetadataAiSource;
  isAiGenerating: boolean;
  aiDisabledReason?: string;
  hasPrimarySource: boolean;
  hasNotesSource: boolean;
  primarySourceTitle: string;
  primarySourceLabel: string;
  onSetAiWriteSource: (source: MetadataAiSource) => void;
  onAiGenerate: (action: MetadataAction, source?: MetadataAiSource) => Promise<void>;
}

const AiWriteButtonGroup: React.FC<AiWriteButtonGroupProps> = ({
  t,
  theme,
  aiWriteSource,
  isAiGenerating,
  aiDisabledReason,
  hasPrimarySource,
  hasNotesSource,
  primarySourceTitle,
  primarySourceLabel,
  onSetAiWriteSource,
  onAiGenerate,
}: AiWriteButtonGroupProps) => {
  return (
    <div
      className={`flex items-center rounded-md p-1 space-x-1 border ${
        theme === 'light'
          ? 'bg-brand-gray-100 border-brand-gray-200'
          : 'bg-brand-gray-800 border-brand-gray-700'
      }`}
      role="group"
      aria-label={t('AI summary generation')}
    >
      <span
        className={`inline-flex items-center justify-center rounded-md text-xs h-6 font-bold uppercase px-3 py-1.5 cursor-default pointer-events-none select-none ${
          aiWriteSource === 'chapter'
            ? 'bg-primary/20 text-primary'
            : 'text-brand-gray-500 hover:text-brand-gray-700 dark:hover:text-brand-gray-300'
        }`}
        aria-hidden="true"
      >
        AI Write
      </span>
      <div
        className={`w-px h-4 ${theme === 'light' ? 'bg-brand-gray-300' : 'bg-brand-gray-700'}`}
        role="presentation"
      />
      <Button
        theme={theme}
        variant="ghost"
        size="sm"
        icon={<Wand2 size={12} />}
        onClick={(): void => {
          onSetAiWriteSource('chapter');
          void onAiGenerate('write', 'chapter');
        }}
        disabled={!hasPrimarySource || isAiGenerating || !!aiDisabledReason}
        className="text-xs h-6"
        title={
          hasPrimarySource
            ? t('Generate summary {{source}}', {
                source: primarySourceTitle,
              })
            : t('{{label}} text not available', {
                label: primarySourceLabel,
              })
        }
        aria-label={t('Generate summary {{source}}', {
          source: primarySourceTitle,
        })}
      >
        {primarySourceTitle}
      </Button>
      <Button
        theme={theme}
        variant="ghost"
        size="sm"
        icon={<StickyNote size={12} />}
        onClick={(): void => {
          onSetAiWriteSource('notes');
          void onAiGenerate('write', 'notes');
        }}
        disabled={!hasNotesSource || isAiGenerating || !!aiDisabledReason}
        className="text-xs h-6"
        title={
          hasNotesSource
            ? t('Generate summary from Notes')
            : t('Add notes to enable this source')
        }
        aria-label={t('Generate summary from Notes')}
      >
        {t('from Notes')}
      </Button>
    </div>
  );
};

interface AiUpdateButtonGroupProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  theme: AppTheme;
  aiWriteSource: MetadataAiSource;
  isAiGenerating: boolean;
  aiDisabledReason?: string;
  hasPrimarySource: boolean;
  hasNotesSource: boolean;
  primarySourceTitle: string;
  primarySourceLabel: string;
  regeneratePrimaryTitle: string;
  updatePrimaryTitle: string;
  rewritePrimaryTitle: string;
  onSetAiWriteSource: (source: MetadataAiSource) => void;
  onAiGenerate: (action: MetadataAction, source?: MetadataAiSource) => Promise<void>;
}

const AiUpdateButtonGroup: React.FC<AiUpdateButtonGroupProps> = ({
  t,
  theme,
  aiWriteSource,
  isAiGenerating,
  aiDisabledReason,
  hasPrimarySource,
  hasNotesSource,
  primarySourceTitle,
  primarySourceLabel,
  regeneratePrimaryTitle,
  updatePrimaryTitle,
  rewritePrimaryTitle,
  onSetAiWriteSource,
  onAiGenerate,
}: AiUpdateButtonGroupProps) => {
  return (
    <>
      <div
        className={`flex items-center rounded-md p-1 space-x-1 border ${
          theme === 'light'
            ? 'bg-brand-gray-100 border-brand-gray-200'
            : 'bg-brand-gray-800 border-brand-gray-700'
        }`}
        role="group"
        aria-label={t('{{label}} summary actions', {
          label: primarySourceLabel,
        })}
      >
        <span
          className={`inline-flex items-center justify-center rounded-md text-xs h-6 font-bold uppercase px-3 py-1.5 cursor-default pointer-events-none select-none ${
            aiWriteSource === 'chapter'
              ? 'bg-primary/20 text-primary'
              : 'text-brand-gray-500'
          }`}
          aria-hidden="true"
          title={regeneratePrimaryTitle}
        >
          <Wand2 size={12} className="mr-2" />
          {primarySourceTitle}
        </span>
        <div
          className={`w-px h-4 ${theme === 'light' ? 'bg-brand-gray-300' : 'bg-brand-gray-700'}`}
          role="presentation"
        />
        <Button
          theme={theme}
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={12} />}
          onClick={(): void => {
            onSetAiWriteSource('chapter');
            void onAiGenerate('update', 'chapter');
          }}
          disabled={!hasPrimarySource || isAiGenerating || !!aiDisabledReason}
          className="text-xs h-6"
          title={
            hasPrimarySource
              ? updatePrimaryTitle
              : `${primarySourceLabel} text not available`
          }
          aria-label={t('Update summary {{source}}', {
            source: primarySourceTitle,
          })}
        >
          Update
        </Button>
        <Button
          theme={theme}
          variant="ghost"
          size="sm"
          icon={<PenLine size={12} />}
          onClick={(): void => {
            onSetAiWriteSource('chapter');
            void onAiGenerate('rewrite', 'chapter');
          }}
          disabled={!hasPrimarySource || isAiGenerating || !!aiDisabledReason}
          className="text-xs h-6"
          title={
            hasPrimarySource
              ? rewritePrimaryTitle
              : `${primarySourceLabel} text not available`
          }
          aria-label={t('Rewrite summary {{source}}', {
            source: primarySourceTitle,
          })}
        >
          Rewrite
        </Button>
      </div>

      <div
        className={`flex items-center rounded-md p-1 space-x-1 border ${
          theme === 'light'
            ? 'bg-brand-gray-100 border-brand-gray-200'
            : 'bg-brand-gray-800 border-brand-gray-700'
        }`}
        role="group"
        aria-label={t('Notes summary actions')}
      >
        <span
          className={`inline-flex items-center justify-center rounded-md text-xs h-6 font-bold uppercase px-3 py-1.5 cursor-default pointer-events-none select-none ${
            aiWriteSource === 'notes'
              ? 'bg-primary/20 text-primary'
              : 'text-brand-gray-500'
          }`}
          aria-hidden="true"
          title={t('Regenerate summary from Notes')}
        >
          <StickyNote size={12} className="mr-2" />
          {t('from Notes')}
        </span>
        <div
          className={`w-px h-4 ${theme === 'light' ? 'bg-brand-gray-300' : 'bg-brand-gray-700'}`}
          role="presentation"
        />
        <Button
          theme={theme}
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={12} />}
          onClick={(): void => {
            onSetAiWriteSource('notes');
            void onAiGenerate('update', 'notes');
          }}
          disabled={!hasNotesSource || isAiGenerating || !!aiDisabledReason}
          className="text-xs h-6"
          title={
            hasNotesSource
              ? t('Update existing summary with facts from Notes')
              : t('Add notes to enable this source')
          }
          aria-label={t('Update summary from Notes')}
        >
          {t('Update')}
        </Button>
        <Button
          theme={theme}
          variant="ghost"
          size="sm"
          icon={<PenLine size={12} />}
          onClick={(): void => {
            onSetAiWriteSource('notes');
            void onAiGenerate('rewrite', 'notes');
          }}
          disabled={!hasNotesSource || isAiGenerating || !!aiDisabledReason}
          className="text-xs h-6"
          title={
            hasNotesSource
              ? t('Rewrite existing summary using Notes style')
              : t('Add notes to enable this source')
          }
          aria-label={t('Rewrite summary from Notes')}
        >
          {t('Rewrite')}
        </Button>
      </div>
    </>
  );
};

interface AiSummaryControlsProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  theme: AppTheme;
  data: MetadataParams;
  aiThinking: string | null;
  isThinkingExpanded: boolean;
  isAiGenerating: boolean;
  aiWriteSource: MetadataAiSource;
  aiDisabledReason?: string;
  primarySourceLabel: string;
  primarySourceTitle: string;
  regeneratePrimaryTitle: string;
  updatePrimaryTitle: string;
  rewritePrimaryTitle: string;
  hasPrimarySource: boolean;
  hasNotesSource: boolean;
  onSetIsThinkingExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  onSetAiWriteSource: (source: MetadataAiSource) => void;
  onAiGenerate: (action: MetadataAction, source?: MetadataAiSource) => Promise<void>;
}

const AiSummaryControls: React.FC<AiSummaryControlsProps> = ({
  t,
  theme,
  data,
  aiThinking,
  isThinkingExpanded,
  isAiGenerating,
  aiWriteSource,
  aiDisabledReason,
  primarySourceLabel,
  primarySourceTitle,
  regeneratePrimaryTitle,
  updatePrimaryTitle,
  rewritePrimaryTitle,
  hasPrimarySource,
  hasNotesSource,
  onSetIsThinkingExpanded,
  onSetAiWriteSource,
  onAiGenerate,
}: AiSummaryControlsProps) => {
  return (
    <div className="flex flex-col gap-2 mb-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {aiThinking && (
            <button
              onClick={() =>
                onSetIsThinkingExpanded((value: boolean): boolean => !value)
              }
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors bg-brand-500/10 text-brand-600 hover:bg-brand-500/20 dark:bg-brand-500/20 dark:text-brand-400 dark:hover:bg-brand-500/30"
              title={isThinkingExpanded ? t('Hide thinking') : t('Show thinking')}
            >
              <Brain size={14} className={isAiGenerating ? 'animate-pulse' : ''} />
              <span>{t('Thinking')}</span>
              {isThinkingExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </button>
          )}
          {isAiGenerating && !aiThinking && (
            <span className="text-xs text-brand-500 flex items-center gap-1 animate-in fade-in">
              <Loader2 size={12} className="animate-spin" /> {t('Generating...')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 justify-end ml-auto">
          {!data.summary ? (
            <AiWriteButtonGroup
              t={t}
              theme={theme}
              aiWriteSource={aiWriteSource}
              isAiGenerating={isAiGenerating}
              aiDisabledReason={aiDisabledReason}
              hasPrimarySource={hasPrimarySource}
              hasNotesSource={hasNotesSource}
              primarySourceTitle={primarySourceTitle}
              primarySourceLabel={primarySourceLabel}
              onSetAiWriteSource={onSetAiWriteSource}
              onAiGenerate={onAiGenerate}
            />
          ) : (
            <AiUpdateButtonGroup
              t={t}
              theme={theme}
              aiWriteSource={aiWriteSource}
              isAiGenerating={isAiGenerating}
              aiDisabledReason={aiDisabledReason}
              hasPrimarySource={hasPrimarySource}
              hasNotesSource={hasNotesSource}
              primarySourceTitle={primarySourceTitle}
              primarySourceLabel={primarySourceLabel}
              regeneratePrimaryTitle={regeneratePrimaryTitle}
              updatePrimaryTitle={updatePrimaryTitle}
              rewritePrimaryTitle={rewritePrimaryTitle}
              onSetAiWriteSource={onSetAiWriteSource}
              onAiGenerate={onAiGenerate}
            />
          )}
        </div>
      </div>
    </div>
  );
};

interface SummaryTabContentProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  theme: AppTheme;
  data: MetadataParams;
  baselineData: MetadataParams;
  hasAiSummaryControls: boolean;
  aiThinking: string | null;
  isThinkingExpanded: boolean;
  isAiGenerating: boolean;
  aiWriteSource: MetadataAiSource;
  aiDisabledReason?: string;
  primarySourceLabel: string;
  primarySourceTitle: string;
  regeneratePrimaryTitle: string;
  updatePrimaryTitle: string;
  rewritePrimaryTitle: string;
  hasPrimarySource: boolean;
  hasNotesSource: boolean;
  effectiveLanguage: string;
  spellCheck: boolean;
  summaryHighlightRanges: Array<{ start: number; end: number }>;
  showDiff: boolean;
  onSetIsThinkingExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  onSetAiWriteSource: (source: MetadataAiSource) => void;
  onAiGenerate: (action: MetadataAction, source?: MetadataAiSource) => Promise<void>;
  onSetData: React.Dispatch<React.SetStateAction<MetadataParams>>;
  onSetBaselineData: React.Dispatch<React.SetStateAction<MetadataParams>>;
}

const SummaryTabContent: React.FC<SummaryTabContentProps> = ({
  t,
  theme,
  data,
  baselineData,
  hasAiSummaryControls,
  aiThinking,
  isThinkingExpanded,
  isAiGenerating,
  aiWriteSource,
  aiDisabledReason,
  primarySourceLabel,
  primarySourceTitle,
  regeneratePrimaryTitle,
  updatePrimaryTitle,
  rewritePrimaryTitle,
  hasPrimarySource,
  hasNotesSource,
  effectiveLanguage,
  spellCheck,
  summaryHighlightRanges,
  showDiff,
  onSetIsThinkingExpanded,
  onSetAiWriteSource,
  onAiGenerate,
  onSetData,
  onSetBaselineData,
}: SummaryTabContentProps) => {
  return (
    <div className="h-full flex flex-col gap-2">
      <div className="text-sm text-brand-gray-500 mb-1">
        {t(
          'This summary is part of the story logic that CHAT maintains and the other models read as context.'
        )}
      </div>
      {hasAiSummaryControls && (
        <AiSummaryControls
          t={t}
          theme={theme}
          data={data}
          aiThinking={aiThinking}
          isThinkingExpanded={isThinkingExpanded}
          isAiGenerating={isAiGenerating}
          aiWriteSource={aiWriteSource}
          aiDisabledReason={aiDisabledReason}
          primarySourceLabel={primarySourceLabel}
          primarySourceTitle={primarySourceTitle}
          regeneratePrimaryTitle={regeneratePrimaryTitle}
          updatePrimaryTitle={updatePrimaryTitle}
          rewritePrimaryTitle={rewritePrimaryTitle}
          hasPrimarySource={hasPrimarySource}
          hasNotesSource={hasNotesSource}
          onSetIsThinkingExpanded={onSetIsThinkingExpanded}
          onSetAiWriteSource={onSetAiWriteSource}
          onAiGenerate={onAiGenerate}
        />
      )}
      {aiThinking && isThinkingExpanded && (
        <div className="flex flex-col gap-1.5 p-3 rounded-lg border bg-brand-gray-50/50 dark:bg-brand-gray-800/20 border-brand-gray-200 dark:border-brand-gray-700 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-brand-gray-500 dark:text-brand-gray-400">
            <Brain size={12} />
            {t('LLM Thinking Process')}
          </div>
          <div className="text-xs font-serif leading-relaxed text-brand-gray-600 dark:text-brand-gray-400 whitespace-pre-wrap max-h-[150px] overflow-y-auto custom-scrollbar italic italic-shadow">
            {aiThinking}
            {isAiGenerating && (
              <span className="inline-block w-1.5 h-3 ml-1 bg-brand-500/50 animate-pulse" />
            )}
          </div>
        </div>
      )}
      <CodeMirrorEditor
        value={data.summary || ''}
        onChange={(value: string): void => {
          onSetBaselineData((prev: MetadataParams) => ({
            ...prev,
            summary: value,
          }));
          onSetData((prev: MetadataParams) => ({
            ...prev,
            summary: value,
          }));
        }}
        language={effectiveLanguage}
        spellCheck={spellCheck}
        baselineValue={baselineData.summary}
        showDiff={showDiff}
        searchHighlightRanges={summaryHighlightRanges}
        mode="markdown"
        className="flex-1 w-full p-4 border rounded-lg dark:bg-brand-gray-800/40 dark:border-brand-gray-700 text-brand-gray-900 dark:text-brand-gray-300 font-sans text-sm md:text-base leading-relaxed transition-all overflow-y-auto"
        placeholder={t('Write a public summary...')}
        style={{ minHeight: '300px' }}
      />
    </div>
  );
};

interface NotesTabContentProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  data: MetadataParams;
  baselineData: MetadataParams;
  effectiveLanguage: string;
  spellCheck: boolean;
  notesHighlightRanges: Array<{ start: number; end: number }>;
  showDiff: boolean;
  onSetData: React.Dispatch<React.SetStateAction<MetadataParams>>;
  onSetBaselineData: React.Dispatch<React.SetStateAction<MetadataParams>>;
}

const NotesTabContent: React.FC<NotesTabContentProps> = ({
  t,
  data,
  baselineData,
  effectiveLanguage,
  spellCheck,
  notesHighlightRanges,
  showDiff,
  onSetData,
  onSetBaselineData,
}: NotesTabContentProps) => {
  return (
    <div className="h-full flex flex-col">
      <div className="text-sm text-brand-gray-500 mb-2">{t('Visible to LLM')}</div>
      <div className="text-xs text-brand-gray-500 mb-2">
        {t(
          'Use notes for facts, intentions, foreshadowing, and constraints that should inform CHAT, EDITING, and WRITING.'
        )}
      </div>
      <CodeMirrorEditor
        value={data.notes || ''}
        onChange={(value: string): void => {
          onSetBaselineData((prev: MetadataParams) => ({
            ...prev,
            notes: value,
          }));
          onSetData((prev: MetadataParams) => ({ ...prev, notes: value }));
        }}
        language={effectiveLanguage}
        spellCheck={spellCheck}
        baselineValue={baselineData.notes}
        showDiff={showDiff}
        searchHighlightRanges={notesHighlightRanges}
        mode="markdown"
        className="flex-1 w-full p-4 border rounded-lg dark:bg-brand-gray-800/40 dark:border-brand-gray-700 text-brand-gray-900 dark:text-brand-gray-300 font-sans text-sm md:text-base leading-relaxed transition-all overflow-y-auto"
        placeholder={t('Write notes (readable by LLM)...')}
        style={{ minHeight: '300px' }}
      />
    </div>
  );
};

interface PrivateNotesTabContentProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  data: MetadataParams;
  baselineData: MetadataParams;
  effectiveLanguage: string;
  spellCheck: boolean;
  privateNotesHighlightRanges: Array<{ start: number; end: number }>;
  showDiff: boolean;
  onSetData: React.Dispatch<React.SetStateAction<MetadataParams>>;
  onSetBaselineData: React.Dispatch<React.SetStateAction<MetadataParams>>;
}

const PrivateNotesTabContent: React.FC<PrivateNotesTabContentProps> = ({
  t,
  data,
  baselineData,
  effectiveLanguage,
  spellCheck,
  privateNotesHighlightRanges,
  showDiff,
  onSetData,
  onSetBaselineData,
}: PrivateNotesTabContentProps) => {
  return (
    <div className="h-full flex flex-col">
      <div className="text-sm text-brand-gray-500 mb-2">{t('Not visible to LLM')}</div>
      <div className="text-xs text-brand-gray-500 mb-2">
        {t(
          'Keep private reminders, spoilers, and experiments here when they should stay outside model context.'
        )}
      </div>
      <CodeMirrorEditor
        value={data.private_notes || ''}
        onChange={(value: string): void => {
          onSetBaselineData((prev: MetadataParams) => ({
            ...prev,
            private_notes: value,
          }));
          onSetData((prev: MetadataParams) => ({
            ...prev,
            private_notes: value,
          }));
        }}
        language={effectiveLanguage}
        spellCheck={spellCheck}
        baselineValue={baselineData.private_notes}
        showDiff={showDiff}
        searchHighlightRanges={privateNotesHighlightRanges}
        mode="markdown"
        className="flex-1 w-full p-4 border rounded-lg dark:bg-brand-gray-800/40 dark:border-brand-gray-700 text-brand-gray-900 dark:text-brand-gray-300 font-sans text-sm md:text-base leading-relaxed transition-all overflow-y-auto"
        placeholder={t('Write private notes (hidden from LLM)...')}
        style={{ minHeight: '300px' }}
      />
    </div>
  );
};

interface ConflictsTabContentProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  theme: AppTheme;
  conflicts: Conflict[];
  baselineData: MetadataParams;
  allowConflicts: boolean;
  isFullscreen: boolean;
  effectiveLanguage: string;
  spellCheck: boolean;
  showDiff: boolean;
  getConflictRanges: (
    index: number,
    field: 'description' | 'resolution'
  ) => Array<{ start: number; end: number }>;
  onAddConflict: () => void;
  onDeleteConflict: (id: string) => void;
  onUpdateConflict: (id: string, field: keyof Conflict, value: string) => void;
  onMoveConflict: (index: number, direction: 'up' | 'down') => void;
  onSetBaselineData: React.Dispatch<React.SetStateAction<MetadataParams>>;
}

const ConflictsTabContent: React.FC<ConflictsTabContentProps> = ({
  t,
  theme,
  conflicts,
  baselineData,
  allowConflicts,
  isFullscreen,
  effectiveLanguage,
  spellCheck,
  showDiff,
  getConflictRanges,
  onAddConflict,
  onDeleteConflict,
  onUpdateConflict,
  onMoveConflict,
  onSetBaselineData,
}: ConflictsTabContentProps) => {
  return (
    <div className="space-y-4">
      <div className="text-sm text-brand-gray-500">
        {allowConflicts
          ? t(
              'Track unresolved tensions in the story draft. CHAT can use these conflicts to maintain continuity while planning and revising the text.'
            )
          : t(
              'Track unresolved tensions in story order. CHAT can use these to keep pacing and logic coherent while planning later chapters.'
            )}
      </div>
      <Button onClick={onAddConflict} variant="secondary" theme={theme}>
        + {t('Add Conflict')}
      </Button>
      <div className="space-y-4">
        {conflicts.map((conflict: Conflict, idx: number) => {
          const baselineConflict = (baselineData.conflicts || []).find(
            (baselineItem: Conflict): boolean => baselineItem.id === conflict.id
          );
          const isNewConflict = showDiff && baselineConflict === undefined;

          return (
            <div
              key={conflict.id}
              className={`border rounded-lg p-4 bg-gray-50 dark:bg-brand-gray-800/50 shadow-sm ${
                isNewConflict
                  ? 'border-green-400 dark:border-green-700'
                  : 'dark:border-brand-gray-700'
              }`}
            >
              <div className="flex justify-between mb-2">
                <span className="font-semibold text-sm dark:text-brand-gray-300 flex items-center gap-2">
                  {t('Conflict #{{index}}', { index: idx + 1 })}
                  {isNewConflict && (
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">
                      {t('New')}
                    </span>
                  )}
                </span>
                <div className="space-x-2 flex items-center">
                  <button
                    onClick={(): void => onMoveConflict(idx, 'up')}
                    disabled={idx === 0}
                    className="disabled:opacity-30 dark:text-brand-gray-500 hover:text-brand-gray-700 dark:hover:text-brand-gray-300 px-1"
                  >
                    ↑
                  </button>
                  <button
                    onClick={(): void => onMoveConflict(idx, 'down')}
                    disabled={idx === conflicts.length - 1}
                    className="disabled:opacity-30 dark:text-brand-gray-500 hover:text-brand-gray-700 dark:hover:text-brand-gray-300 px-1"
                  >
                    ↓
                  </button>
                  <button
                    onClick={(): void => onDeleteConflict(conflict.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1 ml-2"
                    title={t('Delete Conflict')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div
                className={`grid gap-4 ${isFullscreen ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}
              >
                <div>
                  <label className="block text-xs font-medium mb-1 dark:text-brand-gray-400 uppercase tracking-wide">
                    {t('Description')}
                  </label>
                  <CodeMirrorEditor
                    value={conflict.description}
                    onChange={(value: string): void => {
                      onUpdateConflict(conflict.id, 'description', value);
                      onSetBaselineData((prev: MetadataParams) => ({
                        ...prev,
                        conflicts: (prev.conflicts || []).map(
                          (baselineItem: Conflict): Conflict =>
                            baselineItem.id === conflict.id
                              ? { ...baselineItem, description: value }
                              : baselineItem
                        ),
                      }));
                    }}
                    language={effectiveLanguage}
                    spellCheck={spellCheck}
                    baselineValue={isNewConflict ? '' : baselineConflict?.description}
                    showDiff={showDiff}
                    searchHighlightRanges={getConflictRanges(idx, 'description')}
                    mode="markdown"
                    className="w-full p-3 border rounded-lg dark:bg-brand-gray-950 dark:border-brand-gray-800 dark:text-brand-gray-300 text-sm font-sans transition-all"
                    placeholder={t('Describe the conflict...')}
                    style={{ minHeight: '60px' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 dark:text-brand-gray-400 uppercase tracking-wide">
                    {t('Resolution Plan')}
                  </label>
                  <CodeMirrorEditor
                    value={conflict.resolution}
                    onChange={(value: string): void => {
                      onUpdateConflict(conflict.id, 'resolution', value);
                      onSetBaselineData((prev: MetadataParams) => ({
                        ...prev,
                        conflicts: (prev.conflicts || []).map(
                          (baselineItem: Conflict): Conflict =>
                            baselineItem.id === conflict.id
                              ? { ...baselineItem, resolution: value }
                              : baselineItem
                        ),
                      }));
                    }}
                    language={effectiveLanguage}
                    spellCheck={spellCheck}
                    baselineValue={isNewConflict ? '' : baselineConflict?.resolution}
                    showDiff={showDiff}
                    searchHighlightRanges={getConflictRanges(idx, 'resolution')}
                    mode="markdown"
                    className="w-full p-3 border rounded-lg dark:bg-brand-gray-950 dark:border-brand-gray-800 dark:text-brand-gray-300 text-sm font-sans transition-all"
                    placeholder={t('How will this conflict be resolved?')}
                    style={{ minHeight: '80px' }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface ScenesTabContentProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  chapterScenes: Array<{ id: string; summary: string }>;
}

const ScenesTabContent: React.FC<ScenesTabContentProps> = ({
  t,
  chapterScenes,
}: ScenesTabContentProps) => {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold dark:text-brand-gray-300">
        {t('Scenes in this chapter')}
      </h3>
      {chapterScenes.length === 0 ? (
        <p className="text-sm text-brand-gray-500">
          {t('No scenes currently assigned to this chapter.')}
        </p>
      ) : (
        <ol className="space-y-1.5 list-decimal list-inside">
          {chapterScenes.map(
            (scene: {
              id: string;
              summary: string;
            }): import('react/jsx-runtime').JSX.Element => (
              <li
                key={scene.id}
                className="text-sm text-brand-gray-700 dark:text-brand-gray-300"
              >
                {scene.summary}
              </li>
            )
          )}
        </ol>
      )}
    </div>
  );
};

export const MetadataEditorDialogView: React.FC<MetadataEditorDialogViewProps> = ({
  title,
  type,
  theme,
  dialogRef,
  saveStatus,
  isDarkMode,
  isFullscreen,
  showDiff,
  historyIndex,
  historyLength,
  activeTab,
  data,
  baselineData,
  conflicts,
  languages,
  allowConflicts,
  hasAiSummaryControls,
  aiThinking,
  isThinkingExpanded,
  isAiGenerating,
  aiWriteSource,
  aiDisabledReason,
  primarySourceLabel,
  primarySourceTitle,
  regeneratePrimaryTitle,
  updatePrimaryTitle,
  rewritePrimaryTitle,
  hasPrimarySource,
  hasNotesSource,
  effectiveLanguage,
  spellCheck,
  summaryHighlightRanges,
  notesHighlightRanges,
  privateNotesHighlightRanges,
  getConflictRanges,
  onSetIsFullscreen,
  onToggleShowDiff,
  onRestoreHistory,
  onClose,
  onSetActiveTab,
  onSetData,
  onSetBaselineData,
  onSetIsThinkingExpanded,
  onSetAiWriteSource,
  onAiGenerate,
  onAddConflict,
  onDeleteConflict,
  onUpdateConflict,
  onMoveConflict,
  onEditorUndoRedo,
  chapterScenes = [],
}: MetadataEditorDialogViewProps) => {
  const { t } = useTranslation();
  const modalContent = (
    <div
      ref={dialogRef}
      role="none"
      className={isDarkMode ? 'dark' : ''}
      onKeyDown={onEditorUndoRedo}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-dialog-title"
        tabIndex={-1}
        className={`${
          isFullscreen
            ? 'fixed inset-0 z-[100] flex items-center justify-center p-2 bg-black/50'
            : 'fixed top-14 bottom-0 z-[60] bg-white dark:bg-brand-gray-900 border-r dark:border-brand-gray-800 flex flex-col'
        }`}
        style={!isFullscreen ? { width: 'var(--sidebar-width)', left: 0 } : {}}
      >
        <div
          className={`flex flex-col pointer-events-auto ${
            isFullscreen
              ? 'w-[98vw] h-[95vh] bg-white dark:bg-brand-gray-900 text-brand-gray-800 dark:text-brand-gray-400 rounded-lg shadow-xl border dark:border-brand-gray-800'
              : 'w-full h-full text-brand-gray-800 dark:text-brand-gray-400'
          }`}
        >
          <DialogHeader
            t={t}
            title={title}
            saveStatus={saveStatus}
            historyIndex={historyIndex}
            historyLength={historyLength}
            showDiff={showDiff}
            isFullscreen={isFullscreen}
            onToggleShowDiff={onToggleShowDiff}
            onRestoreHistory={onRestoreHistory}
            onSetIsFullscreen={onSetIsFullscreen}
            onClose={onClose}
          />
          <div className="flex-1 overflow-y-auto flex flex-col">
            <TitleFormSection
              t={t}
              type={type}
              data={data}
              languages={languages}
              onSetData={onSetData}
            />
            <TabBar
              t={t}
              activeTab={activeTab}
              type={type}
              allowConflicts={allowConflicts}
              chapterScenes={chapterScenes}
              onSetActiveTab={onSetActiveTab}
            />
            <div className="flex-1 p-4 min-h-[500px]">
              {activeTab === 'summary' && (
                <SummaryTabContent
                  t={t}
                  theme={theme}
                  data={data}
                  baselineData={baselineData}
                  hasAiSummaryControls={hasAiSummaryControls}
                  aiThinking={aiThinking}
                  isThinkingExpanded={isThinkingExpanded}
                  isAiGenerating={isAiGenerating}
                  aiWriteSource={aiWriteSource}
                  aiDisabledReason={aiDisabledReason}
                  primarySourceLabel={primarySourceLabel}
                  primarySourceTitle={primarySourceTitle}
                  regeneratePrimaryTitle={regeneratePrimaryTitle}
                  updatePrimaryTitle={updatePrimaryTitle}
                  rewritePrimaryTitle={rewritePrimaryTitle}
                  hasPrimarySource={hasPrimarySource}
                  hasNotesSource={hasNotesSource}
                  effectiveLanguage={effectiveLanguage}
                  spellCheck={spellCheck}
                  summaryHighlightRanges={summaryHighlightRanges}
                  showDiff={showDiff}
                  onSetIsThinkingExpanded={onSetIsThinkingExpanded}
                  onSetAiWriteSource={onSetAiWriteSource}
                  onAiGenerate={onAiGenerate}
                  onSetData={onSetData}
                  onSetBaselineData={onSetBaselineData}
                />
              )}
              {activeTab === 'notes' && (
                <NotesTabContent
                  t={t}
                  data={data}
                  baselineData={baselineData}
                  effectiveLanguage={effectiveLanguage}
                  spellCheck={spellCheck}
                  notesHighlightRanges={notesHighlightRanges}
                  showDiff={showDiff}
                  onSetData={onSetData}
                  onSetBaselineData={onSetBaselineData}
                />
              )}
              {activeTab === 'private' && (
                <PrivateNotesTabContent
                  t={t}
                  data={data}
                  baselineData={baselineData}
                  effectiveLanguage={effectiveLanguage}
                  spellCheck={spellCheck}
                  privateNotesHighlightRanges={privateNotesHighlightRanges}
                  showDiff={showDiff}
                  onSetData={onSetData}
                  onSetBaselineData={onSetBaselineData}
                />
              )}
              {activeTab === 'conflicts' && (
                <ConflictsTabContent
                  t={t}
                  theme={theme}
                  conflicts={conflicts}
                  baselineData={baselineData}
                  allowConflicts={allowConflicts}
                  isFullscreen={isFullscreen}
                  effectiveLanguage={effectiveLanguage}
                  spellCheck={spellCheck}
                  showDiff={showDiff}
                  getConflictRanges={getConflictRanges}
                  onAddConflict={onAddConflict}
                  onDeleteConflict={onDeleteConflict}
                  onUpdateConflict={onUpdateConflict}
                  onMoveConflict={onMoveConflict}
                  onSetBaselineData={onSetBaselineData}
                />
              )}
              {activeTab === 'scenes' && type === 'chapter' && (
                <ScenesTabContent t={t} chapterScenes={chapterScenes} />
              )}
            </div>
          </div>
          <div className="h-4"></div>
        </div>
      </div>
    </div>
  );

  if (isFullscreen) {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};
