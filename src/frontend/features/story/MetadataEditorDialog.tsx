// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the metadata editor dialog unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useEffect, useRef } from 'react';
import { MetadataParams } from './metadataSync';
import { useFocusTrap } from '../layout/useFocusTrap';
import { AppTheme } from '../../types';
import { MetadataEditorDialogView } from './MetadataEditorDialogView';
import { useMetadataEditorDialogState } from './useMetadataEditorDialogState';

interface Props {
  type: 'story' | 'book' | 'chapter';
  initialData: MetadataParams;
  baseline?: MetadataParams;
  onSave: (data: MetadataParams) => Promise<void>;
  onClose: () => void;
  title: string;
  theme?: AppTheme;
  languages?: string[];
  language?: string;
  spellCheck?: boolean;
  allowConflicts?: boolean;
  primarySourceLabel?: string;
  primarySourceAvailable?: boolean;
  initialTab?: 'summary' | 'notes' | 'private' | 'conflicts' | 'scenes';
  onAiGenerate?: (
    action: 'write' | 'update' | 'rewrite',
    onProgress?: (text: string) => void,
    currentText?: string,
    onThinking?: (thinking: string) => void,
    source?: 'chapter' | 'notes'
  ) => Promise<string | undefined>;
  aiDisabledReason?: string;
  chapterScenes?: Array<{ id: string; summary: string }>;
}

/** React component for metadata editor. */
export function MetadataEditorDialog({
  type,
  initialData,
  baseline,
  onSave,
  onClose,
  title,
  theme = 'mixed',
  languages = [],
  language,
  spellCheck = true,
  allowConflicts = false,
  primarySourceLabel = 'Chapters',
  primarySourceAvailable = true,
  initialTab,
  onAiGenerate,
  aiDisabledReason,
  chapterScenes,
}: Props): import('react/jsx-runtime').JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, dialogRef, onClose);

  const state = useMetadataEditorDialogState({
    initialData,
    baseline,
    onSave,
    onClose,
    language,
    initialTab,
    theme,
    primarySourceLabel,
    primarySourceAvailable,
    onAiGenerate,
    aiDisabledReason,
  });

  useEffect((): (() => void) => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void state.handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return (): void => document.removeEventListener('keydown', handleEscape);
  }, [state]);

  const handleEditorUndoRedo = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const isCtrlOrMeta = event.ctrlKey || event.metaKey;
    if (!isCtrlOrMeta) return;
    const isUndo = !event.shiftKey && event.key === 'z';
    const isRedo = (event.shiftKey && event.key === 'z') || event.key === 'y';
    if (!isUndo && !isRedo) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (isUndo) state.restoreMetadataHistory(state.historyIndex - 1);
    else state.restoreMetadataHistory(state.historyIndex + 1);
  };

  return (
    <MetadataEditorDialogView
      title={title}
      type={type}
      theme={theme}
      dialogRef={dialogRef}
      saveStatus={state.saveStatus}
      isDarkMode={state.isDarkMode}
      isFullscreen={state.isFullscreen}
      showDiff={state.showDiff}
      historyIndex={state.historyIndex}
      historyLength={state.history.length}
      activeTab={state.activeTab}
      data={state.data}
      baselineData={state.baselineData}
      conflicts={state.conflicts}
      languages={languages}
      allowConflicts={allowConflicts}
      hasAiSummaryControls={state.hasAiSummaryControls}
      aiThinking={state.aiThinking}
      isThinkingExpanded={state.isThinkingExpanded}
      isAiGenerating={state.isAiGenerating}
      aiWriteSource={state.aiWriteSource}
      aiDisabledReason={aiDisabledReason}
      primarySourceLabel={primarySourceLabel}
      primarySourceTitle={state.primarySourceTitle}
      regeneratePrimaryTitle={state.regeneratePrimaryTitle}
      updatePrimaryTitle={state.updatePrimaryTitle}
      rewritePrimaryTitle={state.rewritePrimaryTitle}
      hasPrimarySource={state.hasPrimarySource}
      hasNotesSource={state.hasNotesSource}
      effectiveLanguage={state.effectiveLanguage}
      spellCheck={spellCheck}
      summaryHighlightRanges={state.summaryHighlightRanges}
      notesHighlightRanges={state.notesHighlightRanges}
      privateNotesHighlightRanges={state.privateNotesHighlightRanges}
      getConflictRanges={state.getConflictRanges}
      onSetIsFullscreen={state.setIsFullscreen}
      onToggleShowDiff={() => state.setShowDiff((value: boolean): boolean => !value)}
      onRestoreHistory={state.restoreMetadataHistory}
      onClose={state.handleClose}
      onSetActiveTab={state.setActiveTab}
      onSetData={state.setData}
      onSetBaselineData={state.setBaselineData}
      onSetIsThinkingExpanded={state.setIsThinkingExpanded}
      onSetAiWriteSource={state.setAiWriteSource}
      onAiGenerate={state.handleAiGenerate}
      onAddConflict={state.addConflict}
      onDeleteConflict={state.deleteConflict}
      onUpdateConflict={state.updateConflict}
      onMoveConflict={state.moveConflict}
      onEditorUndoRedo={handleEditorUndoRedo}
      chapterScenes={chapterScenes}
    />
  );
}
