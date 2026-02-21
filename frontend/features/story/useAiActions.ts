// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the use ai actions unit so this responsibility stays isolated, testable, and easy to evolve.

import { Dispatch, SetStateAction, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { ChatMessage, Chapter, LLMConfig, StoryState } from '../../types';
import { generateSimpleContent } from '../../services/openaiService';

type PromptsState = {
  system_messages: Record<string, string>;
  user_prompts: Record<string, string>;
};

type UseAiActionsParams = {
  currentChapter?: Chapter;
  story: StoryState;
  prompts: PromptsState;
  systemPrompt: string;
  activeEditingConfig: LLMConfig;
  activeWritingConfig: LLMConfig;
  updateChapter: (id: string, partial: Partial<Chapter>) => Promise<void>;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  getErrorMessage: (error: unknown, fallback: string) => string;
};

export function useAiActions({
  currentChapter,
  story,
  prompts,
  systemPrompt,
  activeEditingConfig,
  activeWritingConfig,
  updateChapter,
  setChatMessages,
  getErrorMessage,
}: UseAiActionsParams) {
  const [isAiActionLoading, setIsAiActionLoading] = useState(false);

  const handleAiAction = async (
    target: 'summary' | 'chapter',
    action: 'update' | 'rewrite' | 'extend'
  ) => {
    if (!currentChapter) return;
    setIsAiActionLoading(true);
    let prompt = '';
    let sysMsg = systemPrompt;

    if (target === 'summary') {
      if (action === 'update') {
        sysMsg = prompts.system_messages.ai_action_summary_update || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_summary_update_user ||
          'Current Summary: {current_summary}\n\nChapter Content:\n{chapter_content}';
        prompt = template
          .replace('{current_summary}', currentChapter.summary)
          .replace('{chapter_content}', currentChapter.content);
      } else {
        sysMsg = prompts.system_messages.ai_action_summary_rewrite || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_summary_rewrite_user ||
          'Chapter Content:\n{chapter_content}';
        prompt = template.replace('{chapter_content}', currentChapter.content);
      }
    } else {
      if (action === 'extend') {
        sysMsg = prompts.system_messages.ai_action_chapter_extend || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_chapter_extend_user ||
          'Summary: {chapter_summary}\n\nExisting Content:\n{chapter_content}';
        prompt = template
          .replace('{chapter_summary}', currentChapter.summary)
          .replace('{chapter_content}', currentChapter.content);
      } else {
        sysMsg = prompts.system_messages.ai_action_chapter_rewrite || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_chapter_rewrite_user ||
          'Summary: {chapter_summary}\nStyle: {style_tags}';
        prompt = template
          .replace('{chapter_summary}', currentChapter.summary)
          .replace('{style_tags}', story.styleTags.join(', '));
      }
    }

    try {
      const modelType = target === 'summary' ? 'EDITING' : 'WRITING';
      const config = target === 'summary' ? activeEditingConfig : activeWritingConfig;
      const result = await generateSimpleContent(prompt, sysMsg, config, modelType, {
        tool_choice: 'none',
      });

      if (target === 'summary') {
        await updateChapter(currentChapter.id, { summary: result });
      } else if (action === 'extend') {
        const separator =
          currentChapter.content.length > 0 && !currentChapter.content.endsWith('\n')
            ? '\n\n'
            : '';
        await updateChapter(currentChapter.id, {
          content: currentChapter.content + separator + result,
        });
      } else {
        await updateChapter(currentChapter.id, { content: result });
      }
    } catch (error: unknown) {
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'model',
        text: `AI Action Error: ${getErrorMessage(error, 'Failed to perform AI action')}`,
        isError: true,
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsAiActionLoading(false);
    }
  };

  const handleSidebarAiAction = async (
    type: 'chapter' | 'book',
    id: string,
    action: 'write' | 'update' | 'rewrite',
    onProgress?: (text: string) => void
  ): Promise<string | undefined> => {
    setIsAiActionLoading(true);
    try {
      let prompt = '';
      let sysMsg = '';

      let currentSummary = '';
      let contentContext = '';

      if (type === 'chapter') {
        const chapter = story.chapters.find((item) => item.id === id);
        if (!chapter) return undefined;
        currentSummary = chapter.summary;
        contentContext = chapter.content || '';
      } else {
        const book = story.books.find((item) => item.id === id);
        if (!book) return undefined;
        currentSummary = book.summary || '';

        const bookChapters = story.chapters.filter((chapter) => chapter.book_id === id);
        const chaptersText = bookChapters
          .map(
            (chapter) =>
              `Chapter: ${chapter.title}\nSummary: ${chapter.summary || 'No summary'}`
          )
          .join('\n\n');
        contentContext = `Book Title: ${book.title}\n\nChapters:\n${chaptersText}`;
      }

      if (action === 'update' && !currentSummary.trim()) {
        action = 'write';
      }

      const modelType = 'EDITING';
      const config = activeEditingConfig;

      if (action === 'update') {
        sysMsg = prompts.system_messages.ai_action_summary_update || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_summary_update_user ||
          'Current Summary: {current_summary}\n\nContent:\n{chapter_content}';

        prompt = template
          .replace('{current_summary}', currentSummary)
          .replace('{chapter_content}', contentContext);
      } else {
        sysMsg = prompts.system_messages.ai_action_summary_rewrite || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_summary_rewrite_user ||
          'Content:\n{chapter_content}';
        prompt = template.replace('{chapter_content}', contentContext);
      }

      const cleanText = (text: string) => {
        return text.replace(/^(\*\*?|##\s*)?(Updated )?Summary:?\**\s*/i, '');
      };

      const result = await generateSimpleContent(prompt, sysMsg, config, modelType, {
        tool_choice: 'none',
        onUpdate: onProgress
          ? (partial) => {
              onProgress(cleanText(partial));
            }
          : undefined,
      });

      return cleanText(result);
    } catch (error: unknown) {
      console.error(error);
      alert(`AI Action Failed: ${getErrorMessage(error, 'Unknown error')}`);
      return undefined;
    } finally {
      setIsAiActionLoading(false);
    }
  };

  return {
    isAiActionLoading,
    handleAiAction,
    handleSidebarAiAction,
  };
}
