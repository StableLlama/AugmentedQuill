import React, { useState, useEffect } from 'react';
import { Tag, Edit2, Save, X } from 'lucide-react';
import { Button } from './Button';
import {
  MarkdownView,
  hasUnsupportedSummaryMarkdown,
  SummaryWarning,
} from './MarkdownView';
import { AppTheme } from '../types';

interface StoryMetadataProps {
  title: string;
  summary: string;
  tags: string[];
  onUpdate: (title: string, summary: string, tags: string[]) => void;
  theme?: AppTheme;
}

export const StoryMetadata: React.FC<StoryMetadataProps> = ({
  title,
  summary,
  tags,
  onUpdate,
  theme = 'mixed',
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const [editSummary, setEditSummary] = useState(summary);
  const [editTags, setEditTags] = useState(tags.join(', '));

  const isLight = theme === 'light';
  const containerClass = isLight
    ? 'bg-brand-gray-50 text-brand-gray-800 border-brand-gray-200'
    : 'bg-brand-gray-900 text-brand-gray-300 border-brand-gray-800';
  const inputClass = isLight
    ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-900'
    : 'bg-brand-gray-800 border-brand-gray-700 text-brand-gray-300';
  const tagClass = isLight
    ? 'bg-brand-gray-50 text-brand-gray-600 border-brand-gray-200'
    : 'bg-brand-gray-800 text-brand-gray-400 border-brand-gray-700';

  useEffect(() => {
    setEditTitle(title);
    setEditSummary(summary);
    setEditTags(tags.join(', '));
  }, [title, summary, tags]);

  const handleSave = () => {
    const processedTags = editTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    onUpdate(editTitle, editSummary, processedTags);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(title);
    setEditSummary(summary);
    setEditTags(tags.join(', '));
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className={`p-4 border-b shadow-sm ${containerClass}`}>
        <div className="space-y-3">
          <input
            className={`w-full text-lg font-bold border-b p-2 rounded-t focus:outline-none focus:border-brand-500 ${inputClass}`}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Story Title"
          />
          <textarea
            className={`w-full text-sm rounded p-2 focus:ring-1 focus:ring-brand-500 focus:outline-none border ${inputClass}`}
            rows={3}
            value={editSummary}
            onChange={(e) => setEditSummary(e.target.value)}
            placeholder="Story Summary..."
          />
          {hasUnsupportedSummaryMarkdown(editSummary) && (
            <div className="text-xs text-brand-500 flex items-center">
              <SummaryWarning />
            </div>
          )}
          <div className="flex items-center space-x-2">
            <Tag size={16} className="text-brand-gray-500" />
            <input
              className={`flex-1 text-xs border-b p-1 focus:outline-none focus:border-brand-500 ${inputClass}`}
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="Tags (comma separated)"
            />
          </div>
          <div className="flex justify-end space-x-2 mt-2">
            <Button size="sm" variant="ghost" onClick={handleCancel} theme={theme}>
              <X size={14} />
            </Button>
            <Button size="sm" variant="primary" onClick={handleSave} theme={theme}>
              <Save size={14} />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-6 border-b ${containerClass}`}>
      <div className="flex justify-between items-start mb-3">
        <h1 className="text-xl font-bold font-serif tracking-wide">{title}</h1>
        <button
          onClick={() => setIsEditing(true)}
          className="text-brand-gray-500 hover:text-brand-gray-400 transition-colors"
        >
          <Edit2 size={16} />
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
