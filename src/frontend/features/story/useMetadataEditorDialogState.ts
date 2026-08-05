// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Encapsulate metadata editor state, autosave, history, and AI orchestration.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Conflict, MetadataTab } from '../../types';
import { MetadataParams, computeSyncUpdates } from './metadataSync';
import { useSearchHighlight } from '../search/SearchHighlightContext';
import type { SearchHighlightRange } from '../search/useSearchReplace';
import { useMetadataDialogHistory } from './useMetadataDialogHistory';
type MetadataAction = 'write' | 'update' | 'rewrite';
type MetadataAiSource = 'chapter' | 'notes';

interface UseMetadataEditorDialogStateArgs {
  initialData: MetadataParams;
  baseline?: MetadataParams;
  onSave: (data: MetadataParams) => Promise<void>;
  onClose: () => void;
  language?: string;
  initialTab?: MetadataTab;
  theme: 'light' | 'dark' | 'mixed';
  primarySourceLabel: string;
  primarySourceAvailable: boolean;
  onAiGenerate?: (
    action: MetadataAction,
    onProgress?: (text: string) => void,
    currentText?: string,
    onThinking?: (thinking: string) => void,
    source?: MetadataAiSource
  ) => Promise<string | undefined>;
  aiDisabledReason?: string;
}

const normalizeConflict = (value: Partial<Conflict> | undefined | null): Conflict => ({
  id: value?.id || crypto.randomUUID(),
  description: value?.description || '',
  resolution: value?.resolution || 'TBD',
});

const conflictContentSignature = (
  value: Partial<Conflict> | undefined | null
): string =>
  JSON.stringify({
    description: value?.description || '',
    resolution: value?.resolution || '',
  });

const conflictsEqualByContent = (
  left: Array<Partial<Conflict>> | undefined,
  right: Array<Partial<Conflict>> | undefined
): boolean => {
  const leftConflicts = left || [];
  const rightConflicts = right || [];
  if (leftConflicts.length !== rightConflicts.length) return false;
  return leftConflicts.every(
    (conflict: Partial<Conflict> | undefined, index: number): boolean =>
      conflictContentSignature(conflict) ===
      conflictContentSignature(rightConflicts[index])
  );
};

const normalizeMetadataParams = (value: MetadataParams): MetadataParams => ({
  ...value,
  conflicts: (value.conflicts || []).map((conflict: Conflict): Conflict =>
    normalizeConflict(conflict)
  ),
});

const diffFieldsEqual = (a: MetadataParams, b: MetadataParams): boolean =>
  (a.summary || '') === (b.summary || '') &&
  (a.notes || '') === (b.notes || '') &&
  (a.private_notes || '') === (b.private_notes || '') &&
  conflictsEqualByContent(a.conflicts, b.conflicts);

/** Custom React hook that manages metadata data state. */
function useMetadataDataState({
  initialData,
  baseline,
  language,
  initialTab,
}: Pick<
  UseMetadataEditorDialogStateArgs,
  'initialData' | 'baseline' | 'language' | 'initialTab'
>): {
  data: MetadataParams;
  setData: React.Dispatch<React.SetStateAction<MetadataParams>>;
  effectiveLanguage: string;
  activeTab: MetadataTab;
  setActiveTab: React.Dispatch<React.SetStateAction<MetadataTab>>;
  isFullscreen: boolean;
  setIsFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
  showDiff: boolean;
  setShowDiff: React.Dispatch<React.SetStateAction<boolean>>;
  conflicts: Conflict[];
  baselineData: MetadataParams;
  setBaselineData: React.Dispatch<React.SetStateAction<MetadataParams>>;
  history: MetadataParams[];
  historyIndex: number;
  restoreMetadataHistory: (index: number) => void;
  summaryHighlightRanges: import('../search/useSearchReplace').SearchHighlightRange[];
  notesHighlightRanges: import('../search/useSearchReplace').SearchHighlightRange[];
  privateNotesHighlightRanges: import('../search/useSearchReplace').SearchHighlightRange[];
  getConflictRanges: (
    index: number,
    field: 'description' | 'resolution'
  ) => import('../search/useSearchReplace').SearchHighlightRange[];
  addConflict: () => void;
  deleteConflict: (id: string) => void;
  updateConflict: (id: string, field: keyof Conflict, value: string) => void;
  moveConflict: (index: number, direction: 'up' | 'down') => void;
} {
  const [data, setData] = useState<MetadataParams>(initialData);
  const effectiveLanguage = data.language || language || 'en';
  const [activeTab, setActiveTab] = useState<MetadataTab>(initialTab || 'summary');
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [showDiff, setShowDiff] = useState(true);
  const [conflicts, setConflicts] = useState<Conflict[]>(
    (initialData.conflicts || []).map((conflict: Conflict): Conflict =>
      normalizeConflict(conflict)
    )
  );

  const { getRanges } = useSearchHighlight();
  const summaryHighlightRanges = getRanges('story_metadata', 'story', 'story_summary');
  const notesHighlightRanges = getRanges('story_metadata', 'story', 'notes');
  const privateNotesHighlightRanges = getRanges(
    'story_metadata',
    'story',
    'private_notes'
  );
  const getConflictRanges = (
    index: number,
    field: 'description' | 'resolution'
  ): SearchHighlightRange[] =>
    getRanges(
      'story_metadata',
      'story',
      `conflicts[${index}].${field}`
    ) as SearchHighlightRange[];

  const { history, historyIndex, restoreMetadataHistory } = useMetadataDialogHistory({
    data,
    initialData,
    baseline,
    normalizeMetadataParams,
    diffFieldsEqual,
    setData,
    setConflicts,
  });

  const dataRef = useRef<MetadataParams>(data);
  useEffect((): void => {
    dataRef.current = data;
  }, [data]);

  const [baselineData, setBaselineData] = useState<MetadataParams>(() => {
    const raw = baseline || initialData;
    return {
      ...raw,
      conflicts: (raw.conflicts || []).map((conflict: Conflict): Conflict =>
        normalizeConflict(conflict)
      ),
    };
  });

  useEffect((): void => {
    const normalizedBaseline = baseline
      ? {
          ...baseline,
          conflicts: (baseline.conflicts || []).map((conflict: Conflict): Conflict =>
            normalizeConflict(conflict)
          ),
        }
      : null;

    if (normalizedBaseline) {
      setBaselineData((prev: MetadataParams): MetadataParams => {
        const currentData = dataRef.current;
        const isSaveRoundTrip =
          diffFieldsEqual(normalizedBaseline, currentData) &&
          !diffFieldsEqual(prev, currentData);

        if (isSaveRoundTrip || diffFieldsEqual(prev, normalizedBaseline)) {
          return prev;
        }
        return normalizedBaseline;
      });
      return;
    }

    // If there is no explicit baseline provided, keep the existing
    // baseline data unchanged for external updates. This preserves the prior
    // state so that LLM-driven changes to notes or conflicts continue to
    // appear as diff highlights instead of immediately advancing the baseline.
    setBaselineData((prev: MetadataParams): MetadataParams => prev);
  }, [initialData, baseline]);

  const prevInitialRef = useRef<MetadataParams>(initialData);

  useEffect((): void => {
    const updates = computeSyncUpdates(prevInitialRef.current, initialData, data);
    prevInitialRef.current = initialData;
    if (Object.keys(updates).length === 0) {
      return;
    }

    setData((prev: MetadataParams) => ({ ...prev, ...updates }));
    if (updates.conflicts) {
      setConflicts(
        updates.conflicts.map((conflict: Conflict): Conflict =>
          normalizeConflict(conflict)
        )
      );
    }
  }, [initialData]);

  useEffect((): void => {
    setData((prev: MetadataParams): MetadataParams => {
      if (conflictsEqualByContent(prev.conflicts, conflicts)) return prev;
      return { ...prev, conflicts };
    });
  }, [conflicts]);

  const addConflict = (): void => {
    const newConflict: Conflict = {
      id: crypto.randomUUID(),
      description: '',
      resolution: '',
    };
    setConflicts([...conflicts, newConflict]);
    setBaselineData((prev: MetadataParams) => ({
      ...prev,
      conflicts: [...(prev.conflicts || []), newConflict],
    }));
  };

  const deleteConflict = (id: string): void => {
    setConflicts(conflicts.filter((conflict: Conflict): boolean => conflict.id !== id));
  };

  const updateConflict = (id: string, field: keyof Conflict, value: string): void => {
    setConflicts(
      conflicts.map((conflict: Conflict): Conflict =>
        conflict.id === id ? { ...conflict, [field]: value } : conflict
      )
    );
  };

  const moveConflict = (index: number, direction: 'up' | 'down'): void => {
    if (direction === 'up' && index > 0) {
      const nextConflicts = [...conflicts];
      [nextConflicts[index], nextConflicts[index - 1]] = [
        nextConflicts[index - 1],
        nextConflicts[index],
      ];
      setConflicts(nextConflicts);
      return;
    }
    if (direction === 'down' && index < conflicts.length - 1) {
      const nextConflicts = [...conflicts];
      [nextConflicts[index], nextConflicts[index + 1]] = [
        nextConflicts[index + 1],
        nextConflicts[index],
      ];
      setConflicts(nextConflicts);
    }
  };

  return {
    data,
    setData,
    effectiveLanguage,
    activeTab,
    setActiveTab,
    isFullscreen,
    setIsFullscreen,
    showDiff,
    setShowDiff,
    conflicts,
    baselineData,
    setBaselineData,
    history,
    historyIndex,
    restoreMetadataHistory,
    summaryHighlightRanges,
    notesHighlightRanges,
    privateNotesHighlightRanges,
    getConflictRanges,
    addConflict,
    deleteConflict,
    updateConflict,
    moveConflict,
  };
}

/** Custom React hook that manages metadata autosave state. */
function useMetadataAutosaveState({
  data,
  initialData,
  onSave,
  onClose,
}: {
  data: MetadataParams;
  initialData: MetadataParams;
  onSave: (data: MetadataParams) => Promise<void>;
  onClose: () => void;
}): { saveStatus: 'error' | 'saved' | 'saving'; handleClose: () => Promise<void> } {
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const onSaveRef = useRef(onSave);
  const isFirstRun = useRef(true);
  const lastSavedDataRef = useRef<MetadataParams>(initialData);

  useEffect((): void => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect((): (() => void) | undefined => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    setSaveStatus('saving');
    const timer = setTimeout(async (): Promise<void> => {
      const lastSaved = lastSavedDataRef.current;
      const isTitleSame = (data.title || '') === (lastSaved.title || '');
      const isSummarySame = (data.summary || '') === (lastSaved.summary || '');
      const isNotesSame = (data.notes || '') === (lastSaved.notes || '');
      const isPrivateNotesSame =
        (data.private_notes || '') === (lastSaved.private_notes || '');
      const isTagsSame =
        JSON.stringify(data.tags || []) === JSON.stringify(lastSaved.tags || []);
      const isConflictsSame = conflictsEqualByContent(
        data.conflicts,
        lastSaved.conflicts
      );

      if (
        isTitleSame &&
        isSummarySame &&
        isNotesSame &&
        isTagsSame &&
        isPrivateNotesSame &&
        isConflictsSame
      ) {
        setSaveStatus('saved');
        return;
      }

      try {
        await onSaveRef.current(data);
        lastSavedDataRef.current = data;
        setSaveStatus('saved');
      } catch (error) {
        console.error(error);
        setSaveStatus('error');
      }
    }, 1000);

    return (): void => clearTimeout(timer);
  }, [data]);

  const handleClose = async (): Promise<void> => {
    if (saveStatus !== 'saved') {
      try {
        await onSave(data);
      } catch (error) {
        console.error('Failed to save on close', error);
      }
    }
    onClose();
  };

  return { saveStatus, handleClose };
}

/** Custom React hook that manages metadata ai state. */
function useMetadataAiState({
  data,
  setData,
  theme,
  primarySourceLabel,
  primarySourceAvailable,
  onAiGenerate,
  aiDisabledReason,
}: Pick<
  UseMetadataEditorDialogStateArgs,
  | 'theme'
  | 'primarySourceLabel'
  | 'primarySourceAvailable'
  | 'onAiGenerate'
  | 'aiDisabledReason'
> & {
  data: MetadataParams;
  setData: React.Dispatch<React.SetStateAction<MetadataParams>>;
}): {
  isAiGenerating: boolean;
  aiThinking: string | null;
  isThinkingExpanded: boolean;
  setIsThinkingExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  aiWriteSource: MetadataAiSource;
  setAiWriteSource: React.Dispatch<React.SetStateAction<MetadataAiSource>>;
  handleAiGenerate: (
    action: MetadataAction,
    source?: MetadataAiSource
  ) => Promise<void>;
  isDarkMode: boolean;
  hasAiSummaryControls: boolean;
  primarySourceTitle: string;
  regeneratePrimaryTitle: string;
  updatePrimaryTitle: string;
  rewritePrimaryTitle: string;
  hasNotesSource: boolean;
  hasPrimarySource: boolean;
} {
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiThinking, setAiThinking] = useState<string | null>(null);
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const [aiWriteSource, setAiWriteSource] = useState<MetadataAiSource>('chapter');

  const handleAiGenerate = async (
    action: MetadataAction,
    source: MetadataAiSource = 'chapter'
  ): Promise<void> => {
    if (aiDisabledReason || !onAiGenerate) {
      return;
    }

    setIsAiGenerating(true);
    setAiThinking(null);
    setIsThinkingExpanded(true);

    try {
      const sourceText = source === 'notes' ? data.notes || '' : undefined;
      let lastProgressAt = 0;
      const result = await onAiGenerate(
        action,
        (partialText: string): void => {
          const now = Date.now();
          if (now - lastProgressAt < 50) return;
          lastProgressAt = now;
          setData((prev: MetadataParams) => ({ ...prev, summary: partialText }));
        },
        sourceText,
        (thinking: string): void => {
          setAiThinking(thinking);
        },
        source
      );
      if (result) {
        setData((prev: MetadataParams) => ({ ...prev, summary: result }));
      }
    } catch (error) {
      console.error('AI Generation failed', error);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const isDarkMode = theme === 'dark' || theme === 'mixed';
  const hasAiSummaryControls = !!onAiGenerate || !!aiDisabledReason;
  const primarySourceTitle = `from ${primarySourceLabel}`;
  const regeneratePrimaryTitle = `Regenerate summary from ${primarySourceLabel}`;
  const updatePrimaryTitle = `Update existing summary with facts from ${primarySourceLabel}`;
  const rewritePrimaryTitle = `Rewrite existing summary using ${primarySourceLabel} style`;
  const hasNotesSource = !!data.notes?.trim();
  const hasPrimarySource = !!primarySourceAvailable;

  useEffect((): void => {
    if (!hasPrimarySource && hasNotesSource && aiWriteSource !== 'notes') {
      setAiWriteSource('notes');
      return;
    }
    if (!hasNotesSource && hasPrimarySource && aiWriteSource !== 'chapter') {
      setAiWriteSource('chapter');
    }
  }, [hasPrimarySource, hasNotesSource, aiWriteSource]);

  return {
    isAiGenerating,
    aiThinking,
    isThinkingExpanded,
    setIsThinkingExpanded,
    aiWriteSource,
    setAiWriteSource,
    handleAiGenerate,
    isDarkMode,
    hasAiSummaryControls,
    primarySourceTitle,
    regeneratePrimaryTitle,
    updatePrimaryTitle,
    rewritePrimaryTitle,
    hasNotesSource,
    hasPrimarySource,
  };
}

/** Custom React hook that manages metadata editor dialog state. */
export function useMetadataEditorDialogState(args: UseMetadataEditorDialogStateArgs): {
  isAiGenerating: boolean;
  aiThinking: string | null;
  isThinkingExpanded: boolean;
  setIsThinkingExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  aiWriteSource: MetadataAiSource;
  setAiWriteSource: React.Dispatch<React.SetStateAction<MetadataAiSource>>;
  handleAiGenerate: (
    action: MetadataAction,
    source?: MetadataAiSource
  ) => Promise<void>;
  isDarkMode: boolean;
  hasAiSummaryControls: boolean;
  primarySourceTitle: string;
  regeneratePrimaryTitle: string;
  updatePrimaryTitle: string;
  rewritePrimaryTitle: string;
  hasNotesSource: boolean;
  hasPrimarySource: boolean;
  saveStatus: 'error' | 'saved' | 'saving';
  handleClose: () => Promise<void>;
  data: MetadataParams;
  setData: React.Dispatch<React.SetStateAction<MetadataParams>>;
  effectiveLanguage: string;
  activeTab: MetadataTab;
  setActiveTab: React.Dispatch<React.SetStateAction<MetadataTab>>;
  isFullscreen: boolean;
  setIsFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
  showDiff: boolean;
  setShowDiff: React.Dispatch<React.SetStateAction<boolean>>;
  conflicts: Conflict[];
  baselineData: MetadataParams;
  setBaselineData: React.Dispatch<React.SetStateAction<MetadataParams>>;
  history: MetadataParams[];
  historyIndex: number;
  restoreMetadataHistory: (index: number) => void;
  summaryHighlightRanges: import('../search/useSearchReplace').SearchHighlightRange[];
  notesHighlightRanges: import('../search/useSearchReplace').SearchHighlightRange[];
  privateNotesHighlightRanges: import('../search/useSearchReplace').SearchHighlightRange[];
  getConflictRanges: (
    index: number,
    field: 'description' | 'resolution'
  ) => import('../search/useSearchReplace').SearchHighlightRange[];
  addConflict: () => void;
  deleteConflict: (id: string) => void;
  updateConflict: (id: string, field: keyof Conflict, value: string) => void;
  moveConflict: (index: number, direction: 'up' | 'down') => void;
} {
  const dataState = useMetadataDataState(args);
  const autosaveState = useMetadataAutosaveState({
    data: dataState.data,
    initialData: args.initialData,
    onSave: args.onSave,
    onClose: args.onClose,
  });
  const aiState = useMetadataAiState({
    data: dataState.data,
    setData: dataState.setData,
    theme: args.theme,
    primarySourceLabel: args.primarySourceLabel,
    primarySourceAvailable: args.primarySourceAvailable,
    onAiGenerate: args.onAiGenerate,
    aiDisabledReason: args.aiDisabledReason,
  });

  return {
    ...dataState,
    ...autosaveState,
    ...aiState,
  };
}
