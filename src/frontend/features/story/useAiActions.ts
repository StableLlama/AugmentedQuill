// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the use ai actions unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { useEffect, useRef, useState } from 'react';

import { WritingUnit, Scene } from '../../types';
import { streamAiAction } from '../../services/openaiService';
import { notifyError } from '../../services/errorNotifier';
import { api } from '../../services/api';
import { setupMountedRefLifecycle } from '../../utils/mountedRef';
import { joinSuggestionToContent } from '../../utils/textUtils';
import { useStoryStore } from '../../stores/storyStore';
import { useChatStore } from '../../stores/chatStore';

type PromptsState = {
  system_messages: Record<string, string>;
  user_prompts: Record<string, string>;
};

type UseAiActionsParams = {
  currentUnit?: WritingUnit;
  prompts: PromptsState;
  isEditingAvailable: boolean;
  isWritingAvailable: boolean;
  checkedSourcebookIds?: string[];
  updateChapter: (
    id: string,
    partial: Partial<WritingUnit>,
    sync?: boolean,
    pushHistory?: boolean,
    isUserEdit?: boolean
  ) => Promise<void>;
  getErrorMessage: (error: unknown, fallback: string) => string;
};

type StreamedContent = {
  chapterId: string;
  content: string;
};

type AutoLinkScopeType = 'story' | 'chapter';

function buildAutoLinkPayload(
  unit: WritingUnit,
  content: string
): {
  scope_type: AutoLinkScopeType;
  chapter_id?: string;
  book_id?: string | null;
  current_text: string;
} {
  const scopeType: AutoLinkScopeType = unit.scope === 'chapter' ? 'chapter' : 'story';
  return {
    scope_type: scopeType,
    chapter_id: scopeType === 'chapter' ? unit.id : undefined,
    book_id: scopeType === 'chapter' ? (unit.book_id ?? null) : undefined,
    current_text: content,
  };
}

const createPrefillStripper =
  (
    imposedActionPrefill: string,
    imposedHeadingPrefix: string
  ): ((text: string) => string) =>
  (text: string): string => {
    if (!text) return text;
    let cleaned = text;

    if (imposedActionPrefill && cleaned.startsWith(imposedActionPrefill)) {
      cleaned = cleaned.slice(imposedActionPrefill.length);
    }
    if (imposedHeadingPrefix && cleaned.startsWith(imposedHeadingPrefix)) {
      cleaned = cleaned.slice(imposedHeadingPrefix.length);
    }

    return cleaned;
  };

const normalizeAiActionText = (text: string): string =>
  text.replace(/^(\*\*?|##\s*)?(Updated )?Summary:?\*\*?\s*/i, '');

const fillLastEmptySceneSpanForExtend = (
  baseContent: string,
  generatedText: string
): string => {
  if (!generatedText.trim()) {
    return baseContent;
  }

  const markerRe = /<!--scene:([^:>]+):start-->([\s\S]*?)<!--scene:\1:end-->/g;
  let match: RegExpExecArray | null = markerRe.exec(baseContent);
  let lastEmpty: {
    innerStart: number;
    innerEnd: number;
  } | null = null;

  while (match) {
    const sceneId = String(match[1]);
    const innerText = String(match[2] ?? '');
    if (innerText.trim().length === 0) {
      const fullStart = match.index;
      const fullEnd = markerRe.lastIndex;
      const startToken = `<!--scene:${sceneId}:start-->`;
      const endToken = `<!--scene:${sceneId}:end-->`;
      lastEmpty = {
        innerStart: fullStart + startToken.length,
        innerEnd: fullEnd - endToken.length,
      };
    }
    match = markerRe.exec(baseContent);
  }

  if (!lastEmpty) {
    return joinSuggestionToContent(baseContent, generatedText);
  }

  const inserted = joinSuggestionToContent('', generatedText);
  return (
    baseContent.slice(0, lastEmpty.innerStart) +
    inserted +
    baseContent.slice(lastEmpty.innerEnd)
  );
};

const getImposedHeadingPrefix = (
  target: 'summary' | 'chapter',
  action: 'update' | 'rewrite' | 'extend',
  title: string
): string =>
  target === 'chapter' && action === 'rewrite' && title.trim().length > 0
    ? `# ${title.trim()}\n\n`
    : '';

const getImposedActionPrefill = (
  target: 'summary' | 'chapter',
  action: 'update' | 'rewrite' | 'extend',
  title: string,
  baseContent: string,
  imposedHeadingPrefix: string
): string =>
  target === 'chapter' && action === 'extend' && title.trim().length > 0
    ? `${imposedHeadingPrefix}${baseContent}`
    : action === 'rewrite'
      ? imposedHeadingPrefix
      : '';

const getAiActionTarget = (
  target: 'summary' | 'chapter',
  scope: string | undefined
): 'summary' | 'story_summary' | 'chapter' =>
  target === 'chapter' ? 'chapter' : scope === 'chapter' ? 'summary' : 'story_summary';

/**
 * Creates a throttled progress pusher for streaming AI chapter content previews.
 * 150ms macrotask throttle avoids "Maximum update depth exceeded" in React 19.
 */
function createStreamingPusher(
  isChapterStreamingAction: boolean,
  baseContent: string,
  action: 'update' | 'rewrite' | 'extend',
  chapterId: string,
  stripPrefillEcho: (text: string) => string,
  onLastStreamed: (sc: StreamedContent) => void
): {
  pushProgress: (partial: string) => void;
  cancelThrottle: () => void;
} {
  let pendingPartial: string | null = null;
  let throttleHandle: ReturnType<typeof setTimeout> | null = null;

  const flushPending = (): void => {
    throttleHandle = null;
    if (pendingPartial === null) return;
    const partial = pendingPartial;
    pendingPartial = null;
    const normalizedPartial = stripPrefillEcho(partial);
    const nextContent =
      action === 'extend'
        ? fillLastEmptySceneSpanForExtend(baseContent, normalizedPartial)
        : normalizedPartial;
    const writeMode = action === 'rewrite' ? 'replace' : 'append';
    onLastStreamed({ chapterId, content: nextContent });
    useStoryStore
      .getState()
      .setStreamingContent({ chapterId, content: nextContent, writeMode });
  };

  const pushProgress = (partial: string): void => {
    if (!isChapterStreamingAction) return;
    pendingPartial = partial;
    if (throttleHandle === null) {
      throttleHandle = setTimeout(flushPending, 150);
    }
  };

  const cancelThrottle = (): void => {
    if (throttleHandle !== null) {
      clearTimeout(throttleHandle);
      throttleHandle = null;
      pendingPartial = null;
    }
  };

  return { pushProgress, cancelThrottle };
}

/**
 * Commits partial streamed content after a cancel, freezes the prose streaming
 * highlight, and clears the streaming slot once the commit resolves.
 * Extracted from useAiActions to keep the hook under the line-length limit.
 */
async function commitCancelledProseContent(
  unit: WritingUnit,
  content: string,
  updateChapter: (
    id: string,
    partial: Partial<WritingUnit>,
    sync?: boolean,
    pushHistory?: boolean,
    isUserEdit?: boolean
  ) => Promise<void>,
  onDone: () => void
): Promise<void> {
  try {
    await updateChapter(unit.id, { content }, true, true, false);
    try {
      const linked = await api.scenes.autoLinkScope(
        buildAutoLinkPayload(unit, content)
      );
      linked.scenes.forEach((scene: Scene): void => {
        useStoryStore.getState().patchScene(scene);
      });
    } catch {
      // Keep the cancel commit resilient even if auto-link fails temporarily.
    }
    useStoryStore.getState().setStreamingContent(null);
  } finally {
    onDone();
  }
}

/** Custom React hook that manages ai actions. */
export function useAiActions({
  currentUnit,
  isEditingAvailable,
  isWritingAvailable,
  checkedSourcebookIds,
  updateChapter,
  getErrorMessage,
}: UseAiActionsParams): {
  isAiActionLoading: boolean;
  handleAiAction: (
    target: 'summary' | 'chapter',
    action: 'update' | 'rewrite' | 'extend'
  ) => Promise<void>;
  handleSidebarAiAction: (
    type: 'chapter' | 'book' | 'story',
    id: string,
    action: 'write' | 'update' | 'rewrite',
    onProgress?: (text: string) => void,
    currentText?: string,
    onThinking?: (thinking: string) => void,
    source?: 'chapter' | 'notes'
  ) => Promise<string | undefined>;
  cancelAiAction: () => void;
} {
  const [isAiActionLoading, setIsAiActionLoading] = useState(false);
  const cancelSignalRef = useRef<{
    cancelled: boolean;
    reader?: ReadableStreamDefaultReader<Uint8Array>;
  }>({ cancelled: false });
  const isMountedRef = useRef(true);
  // Tracks the latest content flushed to the streaming slot for cancel-commit.
  const lastStreamedContentRef = useRef<StreamedContent | null>(null);
  // True while a cancel-triggered commit is in progress.
  const cancelCommitInProgressRef = useRef(false);

  // Avoid updating state after the component has unmounted.
  // This can happen if the user cancels a streaming action while the component is still tearing down.
  useEffect((): (() => void) => setupMountedRefLifecycle(isMountedRef), []);

  const cancelAiAction = (): void => {
    cancelSignalRef.current.cancelled = true;
    cancelSignalRef.current.reader?.cancel();
    cancelSignalRef.current.reader = undefined;

    const lastStreamed = lastStreamedContentRef.current;
    if (lastStreamed && currentUnit) {
      // Set frozen flag BEFORE clearing isAiActionLoading so no render frame
      // sees streamingModeActive=false while partial content is still visible.
      useChatStore.getState().setIsProseStreamingFrozen(true);
      cancelCommitInProgressRef.current = true;
      void commitCancelledProseContent(
        currentUnit,
        lastStreamed.content,
        updateChapter,
        (): void => {
          cancelCommitInProgressRef.current = false;
          lastStreamedContentRef.current = null;
        }
      );
    } else {
      useStoryStore.getState().setStreamingContent(null);
    }

    if (isMountedRef.current) {
      setIsAiActionLoading(false);
    }
  };

  const handleAiAction = async (
    target: 'summary' | 'chapter',
    action: 'update' | 'rewrite' | 'extend'
  ): Promise<void> => {
    if (!currentUnit) return;
    if (target === 'summary' && !isEditingAvailable) return;
    if (target === 'chapter' && !isWritingAvailable) return;

    setIsAiActionLoading(true);

    cancelSignalRef.current = { cancelled: false };
    // Reset tracking state and clear any frozen highlight from a prior stop.
    lastStreamedContentRef.current = null;
    cancelCommitInProgressRef.current = false;
    useChatStore.getState().setIsProseStreamingFrozen(false);

    try {
      const isChapterStreamingAction =
        target === 'chapter' && (action === 'extend' || action === 'rewrite');
      const baseContent = currentUnit.content;
      const imposedHeadingPrefix = getImposedHeadingPrefix(
        target,
        action,
        currentUnit.title
      );
      const imposedActionPrefill = getImposedActionPrefill(
        target,
        action,
        currentUnit.title,
        baseContent,
        imposedHeadingPrefix
      );
      const stripPrefillEcho = createPrefillStripper(
        imposedActionPrefill,
        imposedHeadingPrefix
      );

      const { pushProgress, cancelThrottle } = createStreamingPusher(
        isChapterStreamingAction,
        baseContent,
        action,
        currentUnit.id,
        stripPrefillEcho,
        (sc: StreamedContent): void => {
          lastStreamedContentRef.current = sc;
        }
      );

      const selectedTarget = getAiActionTarget(target, currentUnit.scope);

      const result = await streamAiAction(
        selectedTarget,
        action,
        currentUnit.id,
        currentUnit.content,
        pushProgress,
        undefined,
        undefined,
        checkedSourcebookIds,
        cancelSignalRef.current
      );

      // Clear pending throttle flush before applying the final result.
      cancelThrottle();

      // If cancelled, bail out before applying any final updates.
      if (cancelSignalRef.current.cancelled) {
        return;
      }

      // Clear streaming slot so the editor transitions directly to final text.
      useStoryStore.getState().setStreamingContent(null);

      if (target === 'summary') {
        await updateChapter(currentUnit.id, { summary: result });
      } else if (action === 'extend') {
        const nextContent = fillLastEmptySceneSpanForExtend(
          baseContent,
          stripPrefillEcho(result)
        );
        await updateChapter(currentUnit.id, {
          content: nextContent,
        });
        const linked = await api.scenes.autoLinkScope(
          buildAutoLinkPayload(currentUnit, nextContent)
        );
        linked.scenes.forEach((scene: Scene): void => {
          useStoryStore.getState().patchScene(scene);
        });
      } else {
        const nextContent = stripPrefillEcho(result);
        await updateChapter(currentUnit.id, {
          content: stripPrefillEcho(result),
        });
        const linked = await api.scenes.autoLinkScope(
          buildAutoLinkPayload(currentUnit, nextContent)
        );
        linked.scenes.forEach((scene: Scene): void => {
          useStoryStore.getState().patchScene(scene);
        });
      }
    } catch (error: unknown) {
      console.error('AI Action Error:', error);
      notifyError(getErrorMessage(error, 'Failed to perform AI action'));
    } finally {
      // Safety-net: clear the streaming slot unless cancelAiAction is handling
      // an async commit (which will clear it after the commit resolves).
      if (!cancelCommitInProgressRef.current) {
        useStoryStore.getState().setStreamingContent(null);
      }
      if (isMountedRef.current) {
        setIsAiActionLoading(false);
      }
      cancelSignalRef.current.cancelled = true;
    }
  };

  const handleSidebarAiAction = async (
    type: 'chapter' | 'book' | 'story',
    id: string,
    action: 'write' | 'update' | 'rewrite',
    onProgress?: (text: string) => void,
    currentText?: string,
    onThinking?: (thinking: string) => void,
    source?: 'chapter' | 'notes'
  ): Promise<string | undefined> => {
    if (!isEditingAvailable) return undefined;
    setIsAiActionLoading(true);

    cancelSignalRef.current = { cancelled: false };

    try {
      const cleanText = (text: string): string => normalizeAiActionText(text);

      const target: 'summary' | 'book_summary' | 'story_summary' =
        type === 'chapter'
          ? 'summary'
          : type === 'book'
            ? 'book_summary'
            : 'story_summary';

      const result = await streamAiAction(
        target,
        action,
        type === 'story' ? 'story' : id,
        currentText ?? '',
        onProgress
          ? (partial: string): void => onProgress(cleanText(partial))
          : undefined,
        onThinking,
        source,
        undefined,
        cancelSignalRef.current
      );

      return cleanText(result);
    } catch (error: unknown) {
      console.error('AI Sidebar action error:', error);
      notifyError(
        `AI Action Failed: ${getErrorMessage(error, 'Unknown error')}`,
        error
      );
      return undefined;
    } finally {
      if (isMountedRef.current) {
        setIsAiActionLoading(false);
      }
      cancelSignalRef.current.cancelled = true;
    }
  };

  return {
    isAiActionLoading,
    handleAiAction,
    handleSidebarAiAction,
    cancelAiAction,
  };
}
