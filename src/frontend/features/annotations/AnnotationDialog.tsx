// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Small popover dialog for adding or editing an annotation comment.
 * Appears when text is selected in the editor and the user triggers the
 * annotation action (Ctrl+Shift+A / Cmd+Shift+A or toolbar button).
 */

import React, { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, X } from 'lucide-react';
import { useTheme } from '../layout/ThemeContext';

interface AnnotationDialogProps {
  isOpen: boolean;
  initialComment?: string;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
  /** When provided the dialog is in edit mode (shows "Update" label). */
  editMode?: boolean;
}

export function AnnotationDialog({
  isOpen,
  initialComment = '',
  onConfirm,
  onCancel,
  editMode = false,
}: AnnotationDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { bgMain, textMain, dividerColor } = useTheme();
  const [comment, setComment] = React.useState(initialComment);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  // Reset comment whenever dialog opens.
  useEffect(() => {
    if (isOpen) {
      setComment(initialComment);
      // Defer focus to avoid race with animation.
      const tid = setTimeout(() => textareaRef.current?.focus(), 40);
      return () => clearTimeout(tid);
    }
    return undefined;
  }, [isOpen, initialComment]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!comment.trim()) {
      return;
    }
    onConfirm(comment.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      className="fixed inset-0 z-50 flex items-start justify-center pt-32"
    >
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
        aria-label={t('cancel')}
      />

      {/* Panel */}
      <form
        onSubmit={handleSubmit}
        className={`relative z-10 w-80 rounded-lg border ${dividerColor} ${bgMain} shadow-2xl p-4 flex flex-col gap-3`}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-amber-400" />
            <span id={`${id}-title`} className={`text-sm font-medium ${textMain}`}>
              {editMode ? t('edit_annotation') : t('add_annotation')}
            </span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className={`rounded p-1 hover:bg-white/10 ${textMain} opacity-60 hover:opacity-100`}
            aria-label={t('cancel')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Textarea */}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-comment`} className={`text-xs ${textMain} opacity-60`}>
            {t('annotation_comment_label')}
          </label>
          <textarea
            id={`${id}-comment`}
            ref={textareaRef}
            rows={4}
            className={`resize-none rounded border border-amber-500/40 bg-black/20 px-2 py-1.5 text-sm ${textMain} placeholder:opacity-40 focus:outline-none focus:ring-1 focus:ring-amber-500`}
            placeholder={t('annotation_comment_placeholder')}
            value={comment}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>): void =>
              setComment(e.target.value)
            }
            onKeyDown={handleKeyDown}
            maxLength={4096}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={`rounded px-3 py-1 text-xs ${textMain} hover:bg-white/10`}
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={!comment.trim()}
            className="rounded bg-amber-500/20 px-3 py-1 text-xs text-amber-300 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {editMode ? t('update') : t('add_annotation')}
          </button>
        </div>
      </form>
    </div>
  );
}
