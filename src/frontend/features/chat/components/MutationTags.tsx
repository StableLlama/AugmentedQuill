// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Provide a list of tags representing recent modifications made by the AI.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../layout/ThemeContext';
import { FileText, Book, Info, ScrollText } from 'lucide-react';
import {
  useScenes,
  useStoryBooks,
  useStoryChaptersListMeta,
} from '../../../stores/storyStore';
import type { Chapter, Scene, Book as StoryBook } from '../../../types';

export type SessionMutation = {
  id: string;
  type: 'story' | 'chapter' | 'scene' | 'sourcebook' | 'metadata' | 'book';
  label: string;
  targetId?: string; // chapter ID, entry ID, etc.
  subType?: string; // further field detail if applicable (e.g. metadata tab)
  sceneChangeHint?: {
    changedFields?: string[];
    previousValues?: Record<string, unknown>;
  };
};

interface MutationTagsProps {
  mutations: SessionMutation[];
  onMutationClick: (mutation: SessionMutation) => void;
}

function buildSceneMutationLabel(
  mutation: SessionMutation,
  scenes: Scene[],
  chapters: Chapter[],
  books: StoryBook[]
): string {
  if (mutation.type !== 'scene' || !mutation.targetId) {
    return mutation.label;
  }

  const sceneIndex = scenes.findIndex((scene: Scene): boolean => {
    const targetId = mutation.targetId;
    return targetId != null && scene.id === Number(targetId);
  });
  if (sceneIndex < 0) {
    return mutation.label;
  }

  const sceneNumber = sceneIndex + 1;
  const scene = scenes[sceneIndex];
  const proseLink = scene.prose_link;
  if (!proseLink || proseLink.scope_type !== 'chapter' || !proseLink.chapter_id) {
    return `Scene ${sceneNumber}`;
  }

  const chapterIndex = chapters.findIndex(
    (chapter: Chapter): boolean => chapter.id === proseLink.chapter_id
  );
  if (chapterIndex < 0) {
    return `Scene ${sceneNumber}`;
  }

  const chapterNumberGlobal = chapterIndex + 1;
  const chapter = chapters[chapterIndex];
  const resolvedBookId = proseLink.book_id ?? chapter.book_id;
  if (!resolvedBookId) {
    return `Chapter ${chapterNumberGlobal} / Scene ${sceneNumber}`;
  }

  const bookIndex = books.findIndex(
    (book: StoryBook): boolean => book.id === resolvedBookId
  );
  if (bookIndex < 0) {
    return `Chapter ${chapterNumberGlobal} / Scene ${sceneNumber}`;
  }

  const chapterNumberInBook =
    books[bookIndex].chapters.findIndex(
      (bookChapter: Chapter): boolean => bookChapter.id === proseLink.chapter_id
    ) + 1;
  const chapterNumber =
    chapterNumberInBook > 0 ? chapterNumberInBook : chapterNumberGlobal;

  return `Book ${bookIndex + 1} / Chapter ${chapterNumber} / Scene ${sceneNumber}`;
}

export const MutationTags: React.FC<MutationTagsProps> = ({
  mutations,
  onMutationClick,
}: MutationTagsProps): React.ReactElement | null => {
  const { isLight } = useTheme();
  const { t } = useTranslation();
  const scenes = useScenes();
  const chapters = useStoryChaptersListMeta();
  const books = useStoryBooks() ?? [];

  if (mutations.length === 0) return null;

  const bgClass = isLight
    ? 'bg-amber-50 border-amber-200'
    : 'bg-amber-900/20 border-amber-800/50';
  const textClass = isLight ? 'text-amber-800' : 'text-amber-200';
  const hoverClass = isLight ? 'hover:bg-amber-100' : 'hover:bg-amber-800/40';

  const getIcon = (type: SessionMutation['type']): React.ReactElement => {
    switch (type) {
      case 'story':
      case 'chapter':
      case 'scene':
        return <FileText size={12} />;
      case 'book':
        return <Book size={12} />;
      case 'sourcebook':
        return <ScrollText size={12} />;
      case 'metadata':
        return <Info size={12} />;
      default:
        return <Info size={12} />;
    }
  };

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {mutations.map((m: SessionMutation) => (
        <button
          type="button"
          key={m.id}
          title={
            m.type === 'scene' && m.targetId
              ? t('Scene ID: {{id}}', { id: m.targetId })
              : undefined
          }
          onClick={(event: React.MouseEvent<HTMLButtonElement, MouseEvent>): void => {
            event.preventDefault();
            onMutationClick(m);
          }}
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium transition-colors ${bgClass} ${textClass} ${hoverClass}`}
        >
          {getIcon(m.type)}
          <span>
            {m.type === 'scene'
              ? buildSceneMutationLabel(m, scenes, chapters, books)
              : t(m.label)}
          </span>
        </button>
      ))}
    </div>
  );
};
