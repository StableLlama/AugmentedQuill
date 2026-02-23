// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the story metadata unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useState, useEffect } from 'react';
import { Tag, Edit, Save, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import {
  MarkdownView,
  hasUnsupportedSummaryMarkdown,
  SummaryWarning,
} from '../editor/MarkdownView';
import { AppTheme, Story, Conflict } from '../../types';
import { MetadataEditorDialog } from './MetadataEditorDialog';
import { api } from '../../services/api';
import { notifyError } from '../../services/errorNotifier';

interface StoryMetadataProps {
  title: string;
  summary: string;
  tags: string[];
  notes?: string;
  private_notes?: string;
  onUpdate: (
    title: string,
    summary: string,
    tags: string[],
    notes?: string,
    private_notes?: string
  ) => void;
  theme?: AppTheme;
}

export const StoryMetadata: React.FC<StoryMetadataProps> = ({
  title,
  summary,
  tags,
  notes,
  private_notes,
  onUpdate,
  theme = 'mixed',
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [metadataModalOpen, setMetadataModalOpen] = useState(false);

  const isLight = theme === 'light';
  const containerClass = isLight
    ? 'bg-brand-gray-50 text-brand-gray-800 border-brand-gray-200'
    : 'bg-brand-gray-900 text-brand-gray-300 border-brand-gray-800';
  const tagClass = isLight
    ? 'bg-brand-gray-50 text-brand-gray-600 border-brand-gray-200'
    : 'bg-brand-gray-800 text-brand-gray-400 border-brand-gray-700';

  const handleMetadataSave = async (data: {
    title: string;
    summary: string;
    tags: string[];
    notes?: string;
    private_notes?: string;
  }) => {
    try {
      await api.story.updateMetadata({
        title: data.title,
        summary: data.summary,
        tags: data.tags,
        notes: data.notes,
        private_notes: data.private_notes,
      });
      onUpdate(
        data.title,
        data.summary,
        data.tags || [],
        data.notes,
        data.private_notes
      );
      // Keep dialog open because saves are triggered by autosave while editing.
    } catch (e) {
      notifyError('Failed to update story metadata', e);
    }
  };

  return (
    <div className={`p-6 border-b ${containerClass}`}>
      {metadataModalOpen && (
        <MetadataEditorDialog
          type="story"
          title="Edit Story Metadata"
          initialData={{
            title,
            summary,
            tags,
            notes,
            private_notes,
          }}
          onSave={handleMetadataSave}
          onClose={() => setMetadataModalOpen(false)}
          theme={theme}
        />
      )}
      <div className="flex justify-between items-start mb-3">
        <h1 className="text-xl font-bold font-serif tracking-wide">{title}</h1>
        <button
          onClick={() => setMetadataModalOpen(true)}
          className="text-brand-gray-500 hover:text-brand-gray-400 transition-colors"
        >
          <Edit size={16} />
        </button>
      </div>
      <div className="text-sm text-brand-gray-500 mb-4 leading-relaxed">
        {summary ? (
          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
            <MarkdownView content={summary} simple />
            {hasUnsupportedSummaryMarkdown(summary) && <SummaryWarning />}
          </div>
        ) : (
          <span className="italic">No description yet.</span>
        )}
      </div>
      {notes && (
        <div className="text-sm text-brand-gray-500 mb-4 leading-relaxed border-t pt-2 dark:border-gray-700">
          <span className="text-xs uppercase font-bold text-brand-gray-600 block mb-1">
            Notes (LLM Visible)
          </span>
          <div className="max-h-24 overflow-y-auto custom-scrollbar">
            <MarkdownView content={notes} simple />
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {tags.map((tag, i) => (
          <span key={i} className={`px-2 py-1 text-xs rounded-full border ${tagClass}`}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
};
