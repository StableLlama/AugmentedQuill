// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Sidebar panel listing all annotations for the current prose scope.
 * Clicking an annotation scrolls the editor to it and highlights it.
 * The panel also provides inline edit and delete controls.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Pencil, Trash2, Check, X } from 'lucide-react';
import { useTheme } from '../layout/ThemeContext';
import type { Annotation } from '../../services/apiClients/annotations';

interface AnnotationItemProps {
  annotation: Annotation;
  isActive: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, comment: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  textMain: string;
  iconColor: string;
}

function AnnotationItem({
  annotation,
  isActive,
  onSelect,
  onUpdate,
  onDelete,
  textMain,
  iconColor,
}: AnnotationItemProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.comment);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useTranslation();

  useEffect((): void => {
    if (editing) {
      editTextareaRef.current?.focus();
    }
  }, [editing]);

  const handleSave = useCallback(async () => {
    await onUpdate(annotation.id, draft.trim());
    setEditing(false);
  }, [annotation.id, draft, onUpdate]);

  const handleCancel = useCallback(() => {
    setDraft(annotation.comment);
    setEditing(false);
  }, [annotation.comment]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSave();
      }
      if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  const handleItemKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (editing) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(annotation.id);
      }
    },
    [editing, onSelect, annotation.id]
  );

  return (
    <div
      className={`group relative rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
        isActive ? 'bg-amber-500/20 ring-1 ring-amber-500/50' : 'hover:bg-white/5'
      }`}
      role="button"
      tabIndex={editing ? -1 : 0}
      onClick={() => !editing && onSelect(annotation.id)}
      onKeyDown={handleItemKeyDown}
      aria-label={t('annotation_item', { comment: annotation.comment })}
    >
      <div className={'flex items-start gap-1.5'}>
        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400 opacity-80" />

        {editing ? (
          <div className="flex-1 flex flex-col gap-1">
            <textarea
              className={`w-full resize-none rounded border border-amber-500/50 bg-black/30 px-2 py-1 text-xs ${textMain} focus:outline-none focus:ring-1 focus:ring-amber-500`}
              rows={3}
              value={draft}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>): void =>
                setDraft(e.target.value)
              }
              onKeyDown={handleKeyDown}
              ref={editTextareaRef}
              aria-label={t('edit_annotation_comment')}
            />
            <div className="flex gap-1 justify-end">
              <button
                type="button"
                className="rounded p-0.5 hover:bg-green-500/20 text-green-400"
                onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
                  e.stopPropagation();
                  void handleSave();
                }}
                title={t('save')}
                aria-label={t('save')}
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="rounded p-0.5 hover:bg-red-500/20 text-red-400"
                onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
                  e.stopPropagation();
                  handleCancel();
                }}
                title={t('cancel')}
                aria-label={t('cancel')}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        ) : (
          <span
            className={`flex-1 text-xs leading-relaxed ${textMain} break-words whitespace-pre-wrap`}
          >
            {annotation.comment || <em className="opacity-50">{t('no_comment')}</em>}
          </span>
        )}

        {!editing && (
          <div className="ml-auto flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              type="button"
              className={`rounded p-0.5 hover:bg-white/10 ${iconColor}`}
              onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
                e.stopPropagation();
                setEditing(true);
              }}
              title={t('edit')}
              aria-label={t('edit_annotation')}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-red-500/20 text-red-400"
              onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
                e.stopPropagation();
                void onDelete(annotation.id);
              }}
              title={t('delete')}
              aria-label={t('delete_annotation')}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {annotation.start_offset == null && (
        <span className="mt-0.5 block text-[10px] text-amber-400/60 italic">
          {t('annotation_unanchored')}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

interface AnnotationSidebarProps {
  annotations: ReadonlyArray<Annotation>;
  isLoading: boolean;
  activeAnnotationId: string | null;
  onSelectAnnotation: (id: string) => void;
  onUpdateAnnotation: (id: string, comment: string) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
}

export function AnnotationSidebar({
  annotations,
  isLoading,
  activeAnnotationId,
  onSelectAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
}: AnnotationSidebarProps): React.ReactElement {
  const { t } = useTranslation();
  const { textMain, iconColor } = useTheme();

  if (isLoading) {
    return (
      <div className={`p-3 text-xs ${textMain} opacity-50`}>
        {t('loading_annotations')}
      </div>
    );
  }

  if (annotations.length === 0) {
    return (
      <div
        className={`flex flex-col items-center gap-2 p-4 text-center text-xs ${textMain} opacity-50`}
      >
        <MessageSquare className="h-6 w-6" />
        <p>{t('no_annotations')}</p>
        <p className="text-[10px] opacity-70">{t('annotation_hint')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-1 overflow-y-auto">
      {annotations.map((ann: Annotation) => (
        <AnnotationItem
          key={ann.id}
          annotation={ann}
          isActive={ann.id === activeAnnotationId}
          onSelect={onSelectAnnotation}
          onUpdate={onUpdateAnnotation}
          onDelete={onDeleteAnnotation}
          textMain={textMain}
          iconColor={iconColor}
        />
      ))}
    </div>
  );
}
