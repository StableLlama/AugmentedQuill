// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Derive the active writing unit and related editor metadata from
 * story state so App.tsx does not own these view calculations.
 */

import { useMemo } from 'react';

import type { Chapter, StoryState, WritingUnit } from '../../types';

type UseCurrentWritingUnitParams = {
  story: StoryState;
  currentChapterId: string | null;
  baselineState: StoryState;
};

type CurrentChapterContext = {
  id: string;
  title: string;
  is_empty: boolean;
} | null;

type UseCurrentWritingUnitResult = {
  activeChapter: Chapter | undefined;
  currentChapter: WritingUnit | null;
  currentChapterContext: CurrentChapterContext;
  isCurrentChapterEmpty: boolean;
  editorBaselineContent: string | undefined;
};

export function useCurrentWritingUnit({
  story,
  currentChapterId,
  baselineState,
}: UseCurrentWritingUnitParams): UseCurrentWritingUnitResult {
  return useMemo(() => {
    const activeChapter = story.chapters.find(
      (chapter: Chapter): boolean => chapter.id === currentChapterId
    );

    const currentChapter =
      story.projectType === 'short-story'
        ? story.draft
        : activeChapter
          ? { ...activeChapter, scope: 'chapter' as const }
          : null;

    if (typeof window !== 'undefined' && window.__AQ_DEBUG_RANGES) {
      const ch = activeChapter;
      if (ch) {
        console.log('[AQ:useCurrentWritingUnit] RECOMPUTING currentChapter');
        console.log('  chapter id:', ch.id, 'content length:', ch.content?.length ?? 0);
        console.log(
          '  has scene:13:end?',
          ch.content?.includes('<!--scene:13:end-->') ?? false
        );
      }
    }

    const currentChapterContext = activeChapter
      ? {
          id: activeChapter.id,
          title: activeChapter.title,
          is_empty: !activeChapter.content || activeChapter.content.trim().length === 0,
        }
      : null;

    const isCurrentChapterEmpty =
      !currentChapter ||
      !currentChapter.content ||
      currentChapter.content.trim().length === 0;

    const editorBaselineContent =
      currentChapter?.scope === 'story'
        ? baselineState.draft?.content
        : baselineState.chapters.find(
            (chapter: Chapter): boolean => chapter.id === currentChapter?.id
          )?.content;

    return {
      activeChapter,
      currentChapter,
      currentChapterContext,
      isCurrentChapterEmpty,
      editorBaselineContent,
    };
  }, [
    story.chapters,
    story.draft,
    story.projectType,
    currentChapterId,
    baselineState.draft?.content,
    baselineState.chapters,
  ]);
}
