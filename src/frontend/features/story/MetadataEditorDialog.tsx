// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the metadata editor dialog unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
} from 'lucide-react';
import { Conflict, AppTheme } from '../../types';
import { Button } from '../../components/ui/Button';

interface MetadataParams {
  title?: string;
  summary?: string;
  tags?: string[];
  notes?: string;
  private_notes?: string;
  conflicts?: Conflict[];
}

interface Props {
  type: 'story' | 'book' | 'chapter';
  initialData: MetadataParams;
  onSave: (data: MetadataParams) => Promise<void>;
  onClose: () => void;
  title: string;
  theme?: AppTheme;
  onAiGenerate?: (
    action: 'write' | 'update' | 'rewrite',
    onProgress?: (text: string) => void
  ) => Promise<string | undefined>;
}

export function MetadataEditorDialog({
  type,
  initialData,
  onSave,
  onClose,
  title,
  theme = 'mixed',
  onAiGenerate,
}: Props) {
  const [data, setData] = useState<MetadataParams>(initialData);
  const [activeTab, setActiveTab] = useState<
    'summary' | 'notes' | 'private' | 'conflicts'
  >('summary');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  // Store the latest callback reference so debounced saves use current props.
  const onSaveRef = useRef(onSave);
  const isFirstRun = useRef(true);

  const normalizeConflict = (value: Conflict): Conflict => {
    return {
      id: value.id || crypto.randomUUID(),
      description: value.description || '',
      resolution: value.resolution || 'TBD',
    };
  };

  const [conflicts, setConflicts] = useState<Conflict[]>(
    (initialData.conflicts || []).map((c) => normalizeConflict(c))
  );

  // Reconcile external updates (for example, AI writes) without clobbering
  // in-flight autosave operations.
  useEffect(() => {
    const normalizedPropConflicts = (initialData.conflicts || []).map((c) => ({
      description: c.description || '',
      resolution: c.resolution || 'TBD',
    }));
    const normalizedLocalConflicts = conflicts.map((c) => ({
      description: c.description,
      resolution: c.resolution,
    }));

    const hasConflictsChanged =
      JSON.stringify(normalizedPropConflicts) !==
      JSON.stringify(normalizedLocalConflicts);

    if (hasConflictsChanged && saveStatus !== 'saving') {
      setConflicts((initialData.conflicts || []).map((c) => normalizeConflict(c)));
    }

    if (saveStatus !== 'saving') {
      const hasTitleChanged = (initialData.title || '') !== (data.title || '');
      const hasSummaryChanged = (initialData.summary || '') !== (data.summary || '');
      const hasNotesChanged = (initialData.notes || '') !== (data.notes || '');
      const hasPrivateNotesChanged =
        (initialData.private_notes || '') !== (data.private_notes || '');

      if (
        hasTitleChanged ||
        hasSummaryChanged ||
        hasNotesChanged ||
        hasPrivateNotesChanged
      ) {
        setData((prev) => ({
          ...prev,
          title: initialData.title || prev.title || '',
          summary: initialData.summary || prev.summary || '',
          notes: initialData.notes || prev.notes || '',
          private_notes: initialData.private_notes || prev.private_notes || '',
          tags: prev.tags && prev.tags.length > 0 ? prev.tags : initialData.tags || [],
        }));
      }
    }
  }, [initialData]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    setData((prev) => ({ ...prev, conflicts }));
  }, [conflicts]);

  // Debounced autosave reduces write pressure while preserving quick feedback.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    setSaveStatus('saving');
    const timer = setTimeout(async () => {
      const isTitleSame = (data.title || '') === (initialData.title || '');
      const isSummarySame = (data.summary || '') === (initialData.summary || '');
      const isNotesSame = (data.notes || '') === (initialData.notes || '');
      const isPrivateNotesSame =
        (data.private_notes || '') === (initialData.private_notes || '');
      const isConflictsSame =
        JSON.stringify(data.conflicts || []) ===
        JSON.stringify(initialData.conflicts || []);

      if (
        isTitleSame &&
        isSummarySame &&
        isNotesSame &&
        isPrivateNotesSame &&
        isConflictsSame
      ) {
        setSaveStatus('saved');
        return;
      }

      try {
        await onSaveRef.current(data);
        setSaveStatus('saved');
      } catch (e) {
        console.error(e);
        setSaveStatus('error');
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [data]);

  const handleClose = async () => {
    // Best-effort flush on close prevents losing the latest unsaved keystrokes.
    if (saveStatus !== 'saved') {
      try {
        await onSave(data);
      } catch (e) {
        console.error('Failed to save on close', e);
      }
    }
    onClose();
  };

  const addConflict = () => {
    setConflicts([
      ...conflicts,
      {
        id: crypto.randomUUID(),
        description: '',
        resolution: '',
      },
    ]);
  };

  const deleteConflict = (id: string) => {
    setConflicts(conflicts.filter((c) => c.id !== id));
  };

  const updateConflict = (id: string, field: keyof Conflict, value: string) => {
    setConflicts(conflicts.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const moveConflict = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index > 0) {
      const newConfigs = [...conflicts];
      [newConfigs[index], newConfigs[index - 1]] = [
        newConfigs[index - 1],
        newConfigs[index],
      ];
      setConflicts(newConfigs);
    } else if (direction === 'down' && index < conflicts.length - 1) {
      const newConfigs = [...conflicts];
      [newConfigs[index], newConfigs[index + 1]] = [
        newConfigs[index + 1],
        newConfigs[index],
      ];
      setConflicts(newConfigs);
    }
  };

  const handleAiGenerate = async (action: 'write' | 'update' | 'rewrite') => {
    if (!onAiGenerate) return;
    setIsAiGenerating(true);
    try {
      // Stream partial text into the editor so users can intervene early.
      const result = await onAiGenerate(action, (partialText) => {
        setData((prev) => ({ ...prev, summary: partialText }));
      });
      if (result) {
        setData((prev) => ({ ...prev, summary: result }));
      }
    } catch (e) {
      console.error('AI Generation failed', e);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const isDarkMode = theme === 'dark' || theme === 'mixed';

  const modalContent = (
    <div className={isDarkMode ? 'dark' : ''}>
      <div
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
          {/* Header */}
          <div className="flex justify-between items-center p-4 border-b dark:border-brand-gray-800">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold dark:text-brand-gray-300">
                {title}
              </h2>
              <div className="text-xs font-mono">
                {saveStatus === 'saving' && (
                  <span className="flex items-center gap-1 text-brand-500">
                    <Loader2 size={12} className="animate-spin" /> Saving...
                  </span>
                )}
                {saveStatus === 'saved' && (
                  <span className="flex items-center gap-1 text-green-500">
                    <Check size={12} /> Saved
                  </span>
                )}
                {saveStatus === 'error' && (
                  <span className="text-red-500">Error saving</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="text-gray-500 hover:text-gray-700 dark:text-brand-gray-500 dark:hover:text-brand-gray-300"
                title={
                  isFullscreen ? 'Switch to Sidebar View' : 'Switch to Full Screen'
                }
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                onClick={handleClose}
                className="text-gray-500 hover:text-gray-700 dark:text-brand-gray-500 dark:hover:text-brand-gray-300"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col">
            {/* Title Editor */}
            <div className="p-4 border-b dark:border-brand-gray-800 space-y-2 flex-shrink-0">
              <label className="block text-sm font-medium dark:text-brand-gray-400">
                Title
              </label>
              <input
                value={data.title || ''}
                onChange={(e) => setData({ ...data, title: e.target.value })}
                className="w-full p-2 border rounded dark:bg-brand-gray-950 dark:border-brand-gray-800 text-brand-gray-900 dark:text-brand-gray-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 font-sans text-sm"
              />

              {type === 'story' && (
                <>
                  <label className="block text-sm font-medium dark:text-brand-gray-400 mt-3">
                    Style Tags
                  </label>
                  <input
                    value={data.tags ? data.tags.join(', ') : ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Preserve user-entered ordering; normalization happens server-side.
                      const tags = val.split(',').map((s) => s.trimStart());
                      setData({ ...data, tags: tags });
                    }}
                    className="w-full p-2 border rounded dark:bg-brand-gray-950 dark:border-brand-gray-800 text-brand-gray-900 dark:text-brand-gray-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 font-sans text-sm"
                    placeholder="e.g. Noir, Sci-Fi, First-Person"
                  />
                </>
              )}
            </div>

            {/* Tabs */}
            <div className="flex border-b dark:border-brand-gray-800 overflow-x-auto flex-shrink-0">
              <button
                onClick={() => setActiveTab('summary')}
                className={`px-4 py-2 flex items-center gap-2 whitespace-nowrap text-sm ${
                  activeTab === 'summary'
                    ? 'border-b-2 border-primary text-primary font-semibold'
                    : 'text-brand-gray-500 hover:text-brand-gray-700 dark:text-brand-gray-500 dark:hover:text-brand-gray-300'
                }`}
              >
                <FileText size={16} />
                Summary
              </button>
              <button
                onClick={() => setActiveTab('notes')}
                className={`px-4 py-2 flex items-center gap-2 whitespace-nowrap text-sm ${
                  activeTab === 'notes'
                    ? 'border-b-2 border-primary text-primary font-semibold'
                    : 'text-brand-gray-500 hover:text-brand-gray-700 dark:text-brand-gray-500 dark:hover:text-brand-gray-300'
                }`}
              >
                <StickyNote size={16} />
                Notes
              </button>
              <button
                onClick={() => setActiveTab('private')}
                className={`px-4 py-2 flex items-center gap-2 whitespace-nowrap text-sm ${
                  activeTab === 'private'
                    ? 'border-b-2 border-primary text-primary font-semibold'
                    : 'text-brand-gray-500 hover:text-brand-gray-700 dark:text-brand-gray-500 dark:hover:text-brand-gray-300'
                }`}
              >
                <Lock size={16} />
                Private Notes
              </button>
              {type === 'chapter' && (
                <button
                  onClick={() => setActiveTab('conflicts')}
                  className={`px-4 py-2 flex items-center gap-2 whitespace-nowrap text-sm ${
                    activeTab === 'conflicts'
                      ? 'border-b-2 border-primary text-primary font-semibold'
                      : 'text-brand-gray-500 hover:text-brand-gray-700 dark:text-brand-gray-500 dark:hover:text-brand-gray-300'
                  }`}
                >
                  <AlertTriangle size={16} />
                  Conflicts
                </button>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 p-4 min-h-[500px]">
              {activeTab === 'summary' && (
                <div className="h-full flex flex-col gap-2">
                  {onAiGenerate && (
                    <div className="flex items-center gap-2 justify-end">
                      {isAiGenerating ? (
                        <span className="text-xs text-brand-500 flex items-center gap-1">
                          <Loader2 size={12} className="animate-spin" /> Generating...
                        </span>
                      ) : (
                        <>
                          {!data.summary ? (
                            <Button
                              theme={theme}
                              variant="secondary"
                              size="sm"
                              icon={<Wand2 size={14} />}
                              onClick={() => handleAiGenerate('write')}
                              disabled={isAiGenerating}
                              className="text-xs py-1 h-7"
                            >
                              AI Write
                            </Button>
                          ) : (
                            <>
                              <Button
                                theme={theme}
                                variant="secondary"
                                size="sm"
                                icon={<RefreshCw size={14} />}
                                onClick={() => handleAiGenerate('update')}
                                disabled={isAiGenerating}
                                className="text-xs py-1 h-7"
                              >
                                AI Update
                              </Button>
                              <Button
                                theme={theme}
                                variant="secondary"
                                size="sm"
                                icon={<PenLine size={14} />}
                                onClick={() => handleAiGenerate('rewrite')}
                                disabled={isAiGenerating}
                                className="text-xs py-1 h-7"
                              >
                                AI Rewrite
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <textarea
                    value={data.summary || ''}
                    onChange={(e) => setData({ ...data, summary: e.target.value })}
                    className="w-full h-full p-4 border rounded-lg dark:bg-brand-gray-800/40 dark:border-brand-gray-700 text-brand-gray-900 dark:text-brand-gray-300 placeholder-brand-gray-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500 font-sans text-sm md:text-base leading-relaxed transition-all"
                    placeholder="Write a public summary..."
                  />
                </div>
              )}
              {activeTab === 'notes' && (
                <div className="h-full flex flex-col">
                  <div className="text-sm text-brand-gray-500 mb-2">Visible to LLM</div>
                  <textarea
                    value={data.notes || ''}
                    onChange={(e) => setData({ ...data, notes: e.target.value })}
                    className="flex-1 w-full p-4 border rounded-lg dark:bg-brand-gray-800/40 dark:border-brand-gray-700 text-brand-gray-900 dark:text-brand-gray-300 placeholder-brand-gray-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500 font-sans text-sm md:text-base leading-relaxed transition-all"
                    placeholder="Write notes (readable by LLM)..."
                  />
                </div>
              )}
              {activeTab === 'private' && (
                <div className="h-full flex flex-col">
                  <div className="text-sm text-brand-gray-500 mb-2">
                    Not visible to LLM
                  </div>
                  <textarea
                    value={data.private_notes || ''}
                    onChange={(e) =>
                      setData({ ...data, private_notes: e.target.value })
                    }
                    className="flex-1 w-full p-4 border rounded-lg dark:bg-brand-gray-800/40 dark:border-brand-gray-700 text-brand-gray-900 dark:text-brand-gray-300 placeholder-brand-gray-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500 font-sans text-sm md:text-base leading-relaxed transition-all"
                    placeholder="Write private notes (hidden from LLM)..."
                  />
                </div>
              )}
              {activeTab === 'conflicts' && (
                <div className="space-y-4">
                  <Button onClick={addConflict} variant="secondary" theme={theme}>
                    + Add Conflict
                  </Button>
                  <div className="space-y-4">
                    {conflicts.map((c, idx) => (
                      <div
                        key={c.id}
                        className="border rounded-lg p-4 bg-gray-50 dark:bg-brand-gray-800/50 dark:border-brand-gray-700 shadow-sm"
                      >
                        <div className="flex justify-between mb-2">
                          <span className="font-semibold text-sm dark:text-brand-gray-300">
                            Conflict #{idx + 1}
                          </span>
                          <div className="space-x-2 flex items-center">
                            <button
                              onClick={() => moveConflict(idx, 'up')}
                              disabled={idx === 0}
                              className="disabled:opacity-30 dark:text-brand-gray-500 hover:text-brand-gray-700 dark:hover:text-brand-gray-300 px-1"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => moveConflict(idx, 'down')}
                              disabled={idx === conflicts.length - 1}
                              className="disabled:opacity-30 dark:text-brand-gray-500 hover:text-brand-gray-700 dark:hover:text-brand-gray-300 px-1"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => deleteConflict(c.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors p-1 ml-2"
                              title="Delete Conflict"
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
                              Conflict Description
                            </label>
                            <textarea
                              value={c.description}
                              rows={2}
                              onChange={(e) =>
                                updateConflict(c.id, 'description', e.target.value)
                              }
                              className="w-full p-3 border rounded-lg dark:bg-brand-gray-950 dark:border-brand-gray-800 dark:text-brand-gray-300 placeholder-brand-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-500/40 text-sm font-sans transition-all resize-none"
                              placeholder="Describe the conflict..."
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1 dark:text-brand-gray-400 uppercase tracking-wide">
                              Resolution Plan
                            </label>
                            <textarea
                              value={c.resolution}
                              rows={3}
                              onChange={(e) =>
                                updateConflict(c.id, 'resolution', e.target.value)
                              }
                              className="w-full p-3 border rounded-lg dark:bg-brand-gray-950 dark:border-brand-gray-800 dark:text-brand-gray-300 placeholder-brand-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-500/40 text-sm font-sans transition-all resize-none"
                              placeholder="How will this conflict be resolved?"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer removed for autosave */}
          <div className="h-4"></div>
        </div>
      </div>
    </div>
  );

  if (isFullscreen) {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
}
