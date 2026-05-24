// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Own App-level chat/session orchestration so App.tsx only coordinates features.
 */

import { useCallback, useEffect, useRef, startTransition } from 'react';

import { useChatExecution } from '../chat/useChatExecution';
import { useChatMessageActions } from '../chat/useChatMessageActions';
import { useChatSessionManagement } from '../chat/useChatSessionManagement';
import type { ChatToolCall } from '../../types';
import { MUTATION_TOOL_REGISTRY } from '../chat/mutationToolRegistry';
import type { SessionMutation } from '../chat';
import { applySmartQuotes } from '../../utils/textUtils';
import type { ChatAttachment, LLMConfig, MetadataTab, StoryState } from '../../types';
import type { PromptsState } from '../settings/usePrompts';
import type { ChatToolExecutionResponse } from '../../services/apiTypes';
import { useChatStore, ChatStoreState } from '../../stores/chatStore';
import { useStoryStore } from '../../stores/storyStore';
import type { SceneId } from '../../types';

type CurrentChapterContext = {
  id: string;
  title: string;
  is_empty: boolean;
} | null;

type UseAppChatRuntimeParams = {
  storyId: string;
  storyRef: React.MutableRefObject<StoryState>;
  prompts: PromptsState;
  activeChatConfig: LLMConfig;
  isChatAvailable: boolean;
  currentChapterId: string | null;
  currentChapterContext: CurrentChapterContext;
  advanceBaselineToCurrentStory: () => void;
  refreshProjects: () => Promise<void>;
  refreshStory: () => Promise<void>;
  updateChapter: (
    id: string,
    partial: Record<string, unknown>,
    sync?: boolean,
    pushHistory?: boolean,
    forceNewHistory?: boolean
  ) => Promise<unknown>;
  pushExternalHistoryEntry?: (params: {
    label: string;
    onUndo?: () => Promise<void>;
    onRedo?: () => Promise<void>;
  }) => void;
  requestToolCallLoopAccess: (
    count: number
  ) => Promise<'stop' | 'continue' | 'unlimited'>;
  confirmDangerousToolCalls: (toolCalls: ChatToolCall[]) => Promise<boolean>;
  handleChapterSelect: (chapterId: string | null) => void;
  openAndExpandStory: () => void;
  openSceneEditorDialog: (sceneId: SceneId, openedViaTrigger?: boolean) => void;
  openSourcebookEntryDialog: (entryId: string) => void;
  openStoryMetadataDialog: (tab?: MetadataTab) => void;
  openChapterMetadataDialog: (chapterId: string, initialTab?: MetadataTab) => void;
};

type UseAppChatRuntimeResult = ReturnType<typeof useChatSessionManagement> & {
  onMutationClick: (mutation: SessionMutation) => void;
  handleSendMessageWithReset: (
    text: string,
    attachments?: ChatAttachment[]
  ) => Promise<void>;
  handleStopChat: () => void;
  handleRegenerateWithReset: () => Promise<void>;
  handleEditMessage: (messageId: string, text: string) => void;
  handleDeleteMessage: (messageId: string) => void;
};

type ToolMutationPayload = ChatToolExecutionResponse & {
  _call_results?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
  }>;
};

type MutationNavigationCallbacks = {
  handleChapterSelect: (chapterId: string | null) => void;
  openAndExpandStory: () => void;
  openSceneEditorDialog: (sceneId: SceneId, openedViaTrigger?: boolean) => void;
  openSourcebookEntryDialog: (entryId: string) => void;
  openStoryMetadataDialog: (tab?: MetadataTab) => void;
  openChapterMetadataDialog: (chapterId: string, initialTab?: MetadataTab) => void;
};

/** Route a mutation badge click to the corresponding UI navigation intent. */
export function handleSessionMutationClick(
  mutation: SessionMutation,
  {
    handleChapterSelect,
    openAndExpandStory,
    openSceneEditorDialog,
    openSourcebookEntryDialog,
    openStoryMetadataDialog,
    openChapterMetadataDialog,
  }: MutationNavigationCallbacks
): void {
  if (mutation.type === 'chapter') {
    openAndExpandStory();
    handleChapterSelect(mutation.targetId ?? null);
  } else if (mutation.type === 'scene') {
    openAndExpandStory();
    handleChapterSelect(null);
    if (mutation.targetId) {
      const sceneId = Number(mutation.targetId);
      if (Number.isInteger(sceneId)) {
        openSceneEditorDialog(sceneId);
      }
    }
  } else if (mutation.type === 'story') {
    openAndExpandStory();
    handleChapterSelect(null);
  } else if (mutation.type === 'metadata') {
    openAndExpandStory();
    if (mutation.targetId && mutation.targetId !== 'story') {
      handleChapterSelect(mutation.targetId);
      openChapterMetadataDialog(
        mutation.targetId,
        mutation.subType as MetadataTab | undefined
      );
    } else {
      openStoryMetadataDialog(mutation.subType as MetadataTab | undefined);
    }
  } else if (mutation.type === 'sourcebook') {
    if (mutation.targetId) {
      openSourcebookEntryDialog(mutation.targetId);
    }
  }
}

export function useAppChatRuntime({
  storyId,
  storyRef,
  prompts,
  activeChatConfig,
  isChatAvailable,
  currentChapterId,
  currentChapterContext,
  advanceBaselineToCurrentStory,
  refreshProjects,
  refreshStory,
  updateChapter,
  pushExternalHistoryEntry,
  requestToolCallLoopAccess,
  confirmDangerousToolCalls,
  handleChapterSelect,
  openAndExpandStory,
  openSceneEditorDialog,
  openSourcebookEntryDialog,
  openStoryMetadataDialog,
  openChapterMetadataDialog,
}: UseAppChatRuntimeParams): UseAppChatRuntimeResult {
  // Setters are stable function references — use getState() to avoid subscribing
  // this hook (and its App.tsx caller) to every streaming token update.
  const { setChatMessages, setSessionMutations } = useChatStore.getState();

  const getSystemPrompt = useCallback(
    (): string => prompts.system_messages.chat_llm || '',
    [prompts]
  );

  const sessionState = useChatSessionManagement({
    storyId,
    getSystemPrompt,
  });

  const { handleEditMessage, handleDeleteMessage } = useChatMessageActions({
    setChatMessages,
  });

  const onChatNewMessageBegin = useCallback((): void => {
    setSessionMutations([]);
    // Clear any frozen prose streaming state left over from a previous stop so
    // the green diff overlay is dismissed before the new interaction starts.
    useChatStore.getState().setIsProseStreamingFrozen(false);
    useStoryStore.getState().setStreamingContent(null);
    advanceBaselineToCurrentStory();
  }, [advanceBaselineToCurrentStory, setSessionMutations]);

  const onToolMutations = useCallback((muts: ToolMutationPayload): void => {
    const newMuts: SessionMutation[] = [];
    (muts?._call_results || []).forEach(
      (res: {
        name: string;
        args?: Record<string, unknown>;
        result?: Record<string, unknown>;
      }): void => {
        const factory = MUTATION_TOOL_REGISTRY[res.name];
        if (!factory) {
          return;
        }
        const produced = factory({ args: res.args || {}, result: res.result || {} });
        (Array.isArray(produced) ? produced : [produced]).forEach(
          (item: SessionMutation | null): void => {
            if (item) {
              newMuts.push(item);
            }
          }
        );
      }
    );
    if (!newMuts.length) {
      return;
    }
    setSessionMutations((prev: SessionMutation[]): SessionMutation[] => {
      const combined = [...prev];
      newMuts.forEach((mutation: SessionMutation): void => {
        const exists = combined.some(
          (entry: SessionMutation): boolean =>
            entry.type === mutation.type &&
            entry.label === mutation.label &&
            entry.targetId === mutation.targetId
        );
        if (!exists) {
          combined.push(mutation);
        }
      });
      return combined;
    });
  }, []);

  const prosePreviewStateRef = useRef<
    Record<
      string,
      { base: string; lastAccumulated: string; lastAppliedContent?: string }
    >
  >({});

  // Stable ref so the isChatLoading subscriber below can call updateChapter without
  // needing to re-register the subscription every render.
  const updateChapterRef = useRef(updateChapter);
  updateChapterRef.current = updateChapter;

  // Whether the user explicitly stopped generation while prose was streaming.
  // Set by the handleStopChat wrapper below; cleared when loading ends.
  const stoppedDuringProseRef = useRef(false);

  useEffect(() => {
    if (!useChatStore.getState().isChatLoading) {
      prosePreviewStateRef.current = {};
    }
    // Subscribe to isChatLoading changes imperatively to reset prose preview state
    const unsubscribe = useChatStore.subscribe(
      (state: ChatStoreState, prevState: ChatStoreState): void => {
        if (prevState.isChatLoading && !state.isChatLoading) {
          const pendingProse = prosePreviewStateRef.current;
          const wasStopped = stoppedDuringProseRef.current;
          stoppedDuringProseRef.current = false;
          prosePreviewStateRef.current = {};

          // If the user stopped while prose was being streamed, the backend write was
          // cancelled. Commit the partial content to the story now so the editor keeps
          // the streamed text and an undo entry is pushed.
          if (wasStopped) {
            const writes = Object.entries(pendingProse).filter(
              ([, s]: [string, { lastAppliedContent?: string }]): boolean =>
                s.lastAppliedContent !== undefined
            );
            if (writes.length > 0) {
              void (async (): Promise<void> => {
                for (const [streamKey, streamState] of writes) {
                  const chapId = streamKey.split(':')[0];
                  if (chapId && streamState.lastAppliedContent !== undefined) {
                    await updateChapterRef.current(
                      chapId,
                      { content: streamState.lastAppliedContent },
                      true, // sync
                      true, // pushHistory
                      false // isUserEdit=false keeps old baseline so diff stays green
                    );
                  }
                }
                // Atomically transition active→frozen so no render frame sees both
                // flags false (which would drop the green prefix-diff highlight).
                useChatStore.getState().freezeProseStreaming();
                useStoryStore.getState().setStreamingContent(null);
              })();
              // Async commit in progress — skip the synchronous clear below so the
              // editor keeps showing the streamed preview until the commit resolves.
              return;
            }
          }

          // Clear the streaming slot so the editor shows the committed chapter content.
          useStoryStore.getState().setStreamingContent(null);
          useChatStore.getState().setIsProseStreamingFromChat(false);
        }
      }
    );
    return unsubscribe;
  }, [refreshStory]);

  const { handleSendMessage, handleStopChat, handleRegenerate } = useChatExecution({
    getSystemPrompt: () => useChatStore.getState().systemPrompt,
    activeChatConfig,
    isChatAvailable,
    getAllowWebSearch: () => useChatStore.getState().allowWebSearch,
    currentChapterId,
    getCurrentChatId: () => useChatStore.getState().currentChatId,
    currentChapter: currentChapterContext,
    refreshProjects,
    refreshStory,
    onProseChunk: useCallback(
      (
        chapterId: number,
        writeMode: string,
        accumulated: string,
        streamId: number
      ): void => {
        if (!useChatStore.getState().isChatLoading) {
          return;
        }

        const currentStory = storyRef.current;
        const unit =
          currentStory.projectType === 'short-story' && currentStory.draft
            ? currentStory.draft
            : currentStory.chapters.find(
                (chapter: { id: string }): boolean => Number(chapter.id) === chapterId
              ) || null;
        if (!unit || writeMode === 'insert_at_marker') {
          return;
        }

        const streamKey = `${chapterId}:${writeMode}:${streamId}`;
        const previous = prosePreviewStateRef.current[streamKey];
        const restarted =
          !previous ||
          accumulated.length < previous.lastAccumulated.length ||
          !accumulated.startsWith(previous.lastAccumulated);
        const streamState = restarted
          ? {
              base: unit.content || '',
              lastAccumulated: '',
              lastAppliedContent: undefined,
            }
          : previous;
        const typographicAccumulated = applySmartQuotes(accumulated);
        const separator =
          streamState.base && !streamState.base.endsWith('\n') ? '\n' : '';
        const newContent =
          writeMode === 'replace'
            ? typographicAccumulated
            : `${streamState.base}${separator}${typographicAccumulated}`;

        prosePreviewStateRef.current[streamKey] = {
          base: streamState.base,
          lastAccumulated: accumulated,
          lastAppliedContent: newContent,
        };

        if (
          newContent === unit.content ||
          newContent === streamState.lastAppliedContent
        ) {
          return;
        }

        void useStoryStore.getState().setStreamingContent({
          chapterId: unit.id,
          content: newContent,
          writeMode,
        });
        useChatStore.getState().setIsProseStreamingFromChat(true);
      },
      [storyRef, updateChapter]
    ),
    onMutations: onToolMutations,
    pushExternalHistoryEntry: (
      params: Parameters<NonNullable<typeof pushExternalHistoryEntry>>[0]
    ): void | undefined => pushExternalHistoryEntry?.(params),
    requestToolCallLoopAccess,
    confirmDangerousToolCalls,
  });

  const handleSendMessageWithReset = useCallback(
    async (text: string, attachments?: ChatAttachment[]): Promise<void> => {
      onChatNewMessageBegin();
      await handleSendMessage(text, attachments);
    },
    [handleSendMessage, onChatNewMessageBegin]
  );

  const handleRegenerateWithReset = useCallback(async (): Promise<void> => {
    onChatNewMessageBegin();
    await handleRegenerate();
  }, [handleRegenerate, onChatNewMessageBegin]);

  const onMutationClick = useCallback(
    (mutation: SessionMutation): void => {
      startTransition((): void => {
        requestAnimationFrame((): void => {
          handleSessionMutationClick(mutation, {
            handleChapterSelect,
            openAndExpandStory,
            openSceneEditorDialog,
            openSourcebookEntryDialog,
            openStoryMetadataDialog,
            openChapterMetadataDialog,
          });
        });
      });
    },
    [
      handleChapterSelect,
      openAndExpandStory,
      openChapterMetadataDialog,
      openSourcebookEntryDialog,
      openStoryMetadataDialog,
    ]
  );

  return {
    ...sessionState,
    onMutationClick,
    handleSendMessageWithReset,
    handleStopChat: useCallback((): void => {
      // Record that a stop was triggered while prose may be streaming, so the
      // isChatLoading subscriber can commit the partial text to the story.
      if (useChatStore.getState().isProseStreamingFromChat) {
        stoppedDuringProseRef.current = true;
      }
      handleStopChat();
    }, [handleStopChat]),
    handleRegenerateWithReset,
    handleEditMessage,
    handleDeleteMessage,
  };
}
