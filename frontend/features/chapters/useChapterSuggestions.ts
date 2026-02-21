// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the use chapter suggestions unit so this responsibility stays isolated, testable, and easy to evolve.

import { Dispatch, SetStateAction, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { ChatMessage, Chapter, LLMConfig, StoryState, ViewMode } from '../../types';
import { generateContinuations } from '../../services/openaiService';

type UseChapterSuggestionsParams = {
  currentChapter?: Chapter;
  currentChapterId: string | null;
  story: StoryState;
  systemPrompt: string;
  activeWritingConfig: LLMConfig;
  updateChapter: (id: string, partial: Partial<Chapter>) => Promise<void>;
  viewMode: ViewMode;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  getErrorMessage: (error: unknown, fallback: string) => string;
};

export function useChapterSuggestions({
  currentChapter,
  currentChapterId,
  story,
  systemPrompt,
  activeWritingConfig,
  updateChapter,
  viewMode,
  setChatMessages,
  getErrorMessage,
}: UseChapterSuggestionsParams) {
  const [continuations, setContinuations] = useState<string[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSuggestionMode, setIsSuggestionMode] = useState(false);
  const [suggestCursor, setSuggestCursor] = useState<number | null>(null);
  const [suggestUndoStack, setSuggestUndoStack] = useState<
    Array<{ content: string; cursor: number }>
  >([]);

  const clampCursor = (cursor: number, content: string) => {
    if (!Number.isFinite(cursor)) return content.length;
    return Math.max(0, Math.min(Math.floor(cursor), content.length));
  };

  const handleTriggerSuggestions = async (
    cursor?: number,
    contentOverride?: string,
    enableSuggestionMode: boolean = true
  ) => {
    if (!currentChapter) return;
    if (isSuggesting) return;

    const baseContent = contentOverride ?? currentChapter.content;
    const c = clampCursor(cursor ?? baseContent.length, baseContent);

    if (enableSuggestionMode) setIsSuggestionMode(true);
    setSuggestCursor(c);

    setIsSuggesting(true);
    setContinuations([]);
    try {
      const storyContext = `Title: ${story.title}\nSummary: ${story.summary}\nTags: ${story.styleTags.join(', ')}`;
      const options = await generateContinuations(
        baseContent.slice(0, c),
        storyContext,
        systemPrompt,
        activeWritingConfig,
        currentChapter.id
      );
      setContinuations(options);
    } catch (error: unknown) {
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'model',
        text: `Suggestion Error: ${getErrorMessage(error, 'Failed to generate suggestions')}`,
        isError: true,
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleAcceptContinuation = async (text: string) => {
    if (!currentChapterId || !currentChapter) return;

    if (!text) {
      setContinuations([]);
      setIsSuggestionMode(false);
      setSuggestCursor(null);
      setSuggestUndoStack([]);
      return;
    }

    const currentContent = currentChapter.content;
    const c = clampCursor(suggestCursor ?? currentContent.length, currentContent);
    const prefix = currentContent.slice(0, c);
    const suffix = currentContent.slice(c);

    const startsWithWhitespace = text.length > 0 && /^\s/.test(text);
    const endsWithWhitespace = prefix.length > 0 && /\s$/.test(prefix);

    const needsTokenBoundary =
      prefix.length > 0 && !endsWithWhitespace && !startsWithWhitespace;

    const countTrailingNewlines = (value: string) => {
      let index = value.length - 1;
      let count = 0;
      while (index >= 0 && value[index] === '\n') {
        count++;
        index--;
      }
      return count;
    };
    const countLeadingNewlines = (value: string) => {
      let index = 0;
      let count = 0;
      while (index < value.length && value[index] === '\n') {
        count++;
        index++;
      }
      return count;
    };

    let separator = '';

    if (prefix.length === 0) {
      separator = '';
    } else if (viewMode === 'raw') {
      separator = needsTokenBoundary ? ' ' : '';
    } else {
      const preNewlines = countTrailingNewlines(prefix);
      const textNewlines = countLeadingNewlines(text);
      const totalBoundaryNewlines = preNewlines + textNewlines;

      if (totalBoundaryNewlines >= 2) {
        separator = '';
      } else if (preNewlines > 0 || textNewlines > 0) {
        separator = '\n'.repeat(Math.max(0, 2 - totalBoundaryNewlines));
      } else {
        separator = needsTokenBoundary ? ' ' : '\n\n';
      }
    }

    const newContent = prefix + separator + text + suffix;

    setSuggestUndoStack((prev) => [...prev, { content: currentContent, cursor: c }]);
    await updateChapter(currentChapterId, { content: newContent });

    const newCursor = c + separator.length + text.length;
    setSuggestCursor(newCursor);
    setIsSuggestionMode(true);

    await handleTriggerSuggestions(newCursor, newContent, true);
  };

  const handleKeyboardSuggestionAction = async (
    action: 'trigger' | 'chooseLeft' | 'chooseRight' | 'regenerate' | 'undo' | 'exit',
    cursor?: number
  ) => {
    if (!currentChapterId || !currentChapter) return;
    if (isSuggesting && action !== 'exit') return;

    if (action === 'exit') {
      setContinuations([]);
      setIsSuggestionMode(false);
      setSuggestCursor(null);
      setSuggestUndoStack([]);
      return;
    }

    if (action === 'trigger') {
      await handleTriggerSuggestions(cursor, undefined, true);
      return;
    }

    if (action === 'chooseLeft') {
      if (continuations[0]) await handleAcceptContinuation(continuations[0]);
      return;
    }

    if (action === 'chooseRight') {
      if (continuations[1]) await handleAcceptContinuation(continuations[1]);
      return;
    }

    if (action === 'regenerate') {
      const clampedCursor = clampCursor(
        suggestCursor ?? cursor ?? currentChapter.content.length,
        currentChapter.content
      );
      await handleTriggerSuggestions(clampedCursor, undefined, true);
      return;
    }

    if (action === 'undo') {
      const last = suggestUndoStack[suggestUndoStack.length - 1];
      if (!last) return;
      const nextStack = suggestUndoStack.slice(0, -1);
      setSuggestUndoStack(nextStack);

      await updateChapter(currentChapterId, { content: last.content });
      setSuggestCursor(last.cursor);
      setIsSuggestionMode(true);
      await handleTriggerSuggestions(last.cursor, last.content, true);
    }
  };

  return {
    continuations,
    isSuggesting,
    isSuggestionMode,
    suggestCursor,
    handleTriggerSuggestions,
    handleKeyboardSuggestionAction,
    handleAcceptContinuation,
  };
}
