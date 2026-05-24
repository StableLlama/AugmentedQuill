// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Encapsulate chat execution helpers so the main hook remains short
 * and the execution path can be tested independently.
 */

import { v4 as uuidv4 } from 'uuid';
import type { MutableRefObject } from 'react';

import { api } from '../../services/api';
import { createChatSession } from '../../services/openaiService';
import { useChatStore } from '../../stores/chatStore';
import { useStoryStore } from '../../stores/storyStore';
import type {
  Chapter,
  ChatAttachment,
  ChatMessage,
  ChatToolCall,
  ChatSession,
  LLMConfig,
  SourcebookEntry,
  StoryState,
} from '../../types';
import type {
  ChatToolExecutionResponse,
  ChatToolFunctionCall,
} from '../../services/apiTypes';

export type ChatToolMutationPayload = ChatToolExecutionResponse & {
  _call_results?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
  }>;
};

const PROJECT_CONTEXT_TOOL_NAMES = new Set<string>([
  'refresh_project_context',
  'get_current_chapter_id',
  'manage_project',
  'manage_story_core',
  'manage_sourcebook',
  'manage_images',
  'manage_scratchpad',
  'search_and_replace',
  'manage_scenes',
  'write_story_content',
  'get_book_metadata',
  'update_book_metadata',
  'read_book_content',
  'write_book_content',
  'get_chapter_metadata',
  'update_chapter_metadata',
  'get_chapter_summaries',
  'get_chapter_content',
  'write_chapter_content',
  'replace_text_in_chapter',
  'insert_text_at_marker',
  'apply_chapter_replacements',
  'write_chapter_summary',
  'sync_summary',
  'write_chapter',
  'continue_chapter',
  'create_new_chapter',
  'get_chapter_heading',
  'write_chapter_heading',
  'get_chapter_summary',
  'delete_chapter',
  'recommend_metadata_updates',
  'reorder_chapters',
  'reorder_books',
  'delete_book',
  'create_new_book',
]);

const trimText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
};

const normalizeSourcebookForRefresh = (
  story: StoryState
): { entries: Array<Record<string, unknown>>; omittedEntries: number } => {
  const entries = story.sourcebook ?? [];
  const maxEntries = 5;
  return {
    entries: entries.slice(0, maxEntries).map((entry: SourcebookEntry) => ({
      id: entry.id,
      name: entry.name,
      category: entry.category ?? '',
      description: trimText(entry.description ?? '', 600),
      synonyms: entry.synonyms.slice(0, 10),
      relations: (entry.relations ?? []).slice(0, 10),
    })),
    omittedEntries: Math.max(0, entries.length - maxEntries),
  };
};

const buildRefreshSections = (
  story: StoryState,
  currentChapter?: { id: string; title: string } | null
): string[] => {
  const sections = new Set<string>();

  sections.add('story.summary');
  sections.add('story.notes');
  sections.add('story.conflicts');

  if (story.projectType === 'short-story' && story.draft) {
    return Array.from(sections);
  }

  if (currentChapter?.id) {
    sections.add(`chapter:${currentChapter.id}.summary`);
    sections.add(`chapter:${currentChapter.id}.notes`);
    sections.add(`chapter:${currentChapter.id}.conflicts`);
  }

  const sourcebook = normalizeSourcebookForRefresh(story);
  sourcebook.entries.forEach((entry: Record<string, unknown>): void => {
    const entryId = typeof entry.id === 'string' ? entry.id : '';
    if (!entryId) {
      return;
    }
    sections.add(`sourcebook:${entryId}.description`);
    sections.add(`sourcebook:${entryId}.synonyms`);
    sections.add(`sourcebook:${entryId}.relations`);
  });

  return Array.from(sections);
};

const buildSectionRefreshPayload = (
  story: StoryState,
  sections: string[]
): Record<string, unknown> => {
  const results: Record<string, unknown> = {};

  const assignChapterSection = (section: string): boolean => {
    const chapterMatch = section.match(/^chapter:([^\.]+)\.(summary|notes|conflicts)$/);
    if (!chapterMatch) {
      return false;
    }
    const [, chapterId, field] = chapterMatch;
    const chapter = story.chapters.find(
      (candidate: Chapter): boolean => candidate.id === chapterId
    );
    if (!chapter) {
      return true;
    }
    if (field === 'summary') {
      results[section] = chapter.summary;
      return true;
    }
    if (field === 'notes') {
      results[section] = chapter.notes ?? '';
      return true;
    }
    results[section] = chapter.conflicts ?? [];
    return true;
  };

  const assignSourcebookSection = (section: string): boolean => {
    const sourcebookMatch = section.match(
      /^sourcebook:([^\.]+)\.(description|synonyms|relations)$/
    );
    if (!sourcebookMatch) {
      return false;
    }
    const [, entryId, field] = sourcebookMatch;
    const entry = (story.sourcebook ?? []).find(
      (candidate: SourcebookEntry): boolean => candidate.id === entryId
    );
    if (!entry) {
      return true;
    }
    if (field === 'description') {
      results[section] = trimText(entry.description ?? '', 600);
      return true;
    }
    if (field === 'synonyms') {
      results[section] = entry.synonyms.slice(0, 10);
      return true;
    }
    results[section] = (entry.relations ?? []).slice(0, 10);
    return true;
  };

  for (const section of sections) {
    if (section === 'story.summary') {
      results[section] = story.summary;
      continue;
    }
    if (section === 'story.notes') {
      results[section] = story.notes ?? '';
      continue;
    }
    if (section === 'story.conflicts') {
      results[section] = story.conflicts ?? [];
      continue;
    }

    if (assignChapterSection(section)) {
      continue;
    }

    assignSourcebookSection(section);
  }

  return results;
};

const hasProjectContextHistory = (history: ChatMessage[]): boolean =>
  history.some((message: ChatMessage): boolean => {
    if (message.role === 'tool') {
      return PROJECT_CONTEXT_TOOL_NAMES.has(message.name ?? '');
    }
    return (
      Array.isArray(message.tool_calls) &&
      message.tool_calls.some((call: ChatToolCall): boolean =>
        PROJECT_CONTEXT_TOOL_NAMES.has(call.name)
      )
    );
  });

const stripProjectContextMessages = (history: ChatMessage[]): ChatMessage[] =>
  history.flatMap((message: ChatMessage): ChatMessage[] => {
    if (message.role === 'tool' && PROJECT_CONTEXT_TOOL_NAMES.has(message.name ?? '')) {
      return [];
    }

    if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
      return [message];
    }

    const remainingToolCalls = message.tool_calls.filter(
      (call: ChatToolCall): boolean => !PROJECT_CONTEXT_TOOL_NAMES.has(call.name)
    );
    if (remainingToolCalls.length === message.tool_calls.length) {
      return [message];
    }

    if (
      remainingToolCalls.length === 0 &&
      !(message.text || '').trim() &&
      !(message.thinking || '').trim()
    ) {
      return [];
    }

    return [{ ...message, tool_calls: remainingToolCalls }];
  });

type RefreshHistoryResult = {
  history: ChatMessage[];
  injected: boolean;
};

export const refreshStaleProjectContextHistory = (
  history: ChatMessage[],
  story: StoryState,
  currentChapter?: { id: string; title: string } | null,
  projectContextRevision?: number | null
): RefreshHistoryResult => {
  const currentStoryRevision = story.lastUpdated ?? null;
  if (
    currentStoryRevision === projectContextRevision ||
    !hasProjectContextHistory(history)
  ) {
    return { history, injected: false };
  }

  const sanitizedHistory = stripProjectContextMessages(history);
  const sections = buildRefreshSections(story, currentChapter);
  const refreshedSections = buildSectionRefreshPayload(story, sections);
  const toolCallId = `project-context-refresh-${currentStoryRevision ?? Date.now()}`;
  const refreshArgs = {
    sections,
  };
  const refreshPayload = refreshedSections;

  return {
    history: [
      ...sanitizedHistory,
      {
        id: `${toolCallId}-assistant`,
        role: 'model',
        text: '',
        tool_calls: [
          {
            id: toolCallId,
            name: 'refresh_project_context',
            args: refreshArgs,
          },
        ],
      },
      {
        id: `${toolCallId}-tool`,
        role: 'tool',
        name: 'refresh_project_context',
        tool_call_id: toolCallId,
        text: JSON.stringify(refreshPayload),
      },
    ],
    injected: true,
  };
};

export type ExecuteChatRequestContext = {
  getSystemPrompt: () => string;
  activeChatConfig: LLMConfig;
  getAllowWebSearch: () => boolean;
  currentChapterId: string | null;
  getCurrentChatId: () => string | null;
  currentChapter?: { id: string; title: string } | null;
  onProseChunk?: (
    chapId: number,
    writeMode: string,
    accumulated: string,
    streamId: number
  ) => void;
  refreshProjects: () => Promise<void>;
  refreshStory: () => Promise<void>;
  requestToolCallLoopAccess: (
    count: number
  ) => Promise<'stop' | 'continue' | 'unlimited'>;
  onMutations?: (mutations: ChatToolMutationPayload) => void;
  pushExternalHistoryEntry?: (params: {
    label: string;
    onUndo?: () => Promise<void>;
    onRedo?: () => Promise<void>;
    forceNewHistory?: boolean;
    baselineChapterOverrides?: { id: string; content: string }[];
  }) => void;
  setChatMessages: (
    v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => void;
  setIsChatLoading: (v: boolean) => void;
  stopSignalRef: MutableRefObject<boolean>;
  createAssistantMessage: (
    id: string,
    result: {
      text?: string;
      thinking?: string;
      functionCalls?: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
      }>;
    }
  ) => ChatMessage;
};

export const ensureUniqueMessages = (messages: ChatMessage[]): ChatMessage[] => {
  const seen = new Set<string>();
  return messages.filter((message: ChatMessage): boolean => {
    if (!message.id) return true;
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
};

export const upsertChatMessage = (
  setChatMessages: (
    v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => void,
  ensureUniqueMessagesFn: (messages: ChatMessage[]) => ChatMessage[],
  msgId: string,
  messageUpdate: Partial<ChatMessage>
): void => {
  setChatMessages((prev: ChatMessage[]): ChatMessage[] => {
    const messageIndex = prev.findIndex(
      (item: ChatMessage): boolean => item.id === msgId
    );
    if (messageIndex !== -1) {
      const next = [...prev];
      next[messageIndex] = {
        ...next[messageIndex],
        ...messageUpdate,
        text: messageUpdate.text ?? next[messageIndex].text,
        thinking: messageUpdate.thinking ?? next[messageIndex].thinking,
        traceback: messageUpdate.traceback ?? next[messageIndex].traceback,
      } as ChatMessage;
      return ensureUniqueMessagesFn(next);
    }
    return ensureUniqueMessagesFn([
      ...prev,
      {
        id: msgId,
        role: 'model',
        text: messageUpdate.text ?? '',
        thinking: messageUpdate.thinking ?? '',
        traceback: messageUpdate.traceback ?? '',
        ...messageUpdate,
      } as ChatMessage,
    ]);
  });
};

export const buildChapterContextMessage = (
  history: ChatMessage[],
  chapter?: { id: string; title: string } | null
): ChatMessage | null => {
  if (!chapter?.id) return null;
  const chapterId = parseInt(chapter.id, 10);
  if (!Number.isFinite(chapterId)) return null;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'tool' && msg.name === 'get_current_chapter_id') {
      try {
        const parsed = JSON.parse(msg.text || '');
        if (parsed.chapter_id === chapterId) return null;
      } catch {
        // malformed content – fall through to inject
      }
      break;
    }
  }

  return {
    id: uuidv4(),
    role: 'tool',
    text: JSON.stringify({
      chapter_id: chapterId,
      chapter_title: chapter.title ?? '',
    }),
    name: 'get_current_chapter_id',
    tool_call_id: 'current_context',
  };
};

const parseToolCallResults = (
  messages: Array<{ content: string; tool_call_id: string; name: string }>,
  assistantMessage: ChatMessage
): Array<{
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}> => {
  const callResults: Array<{
    name: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
  }> = [];

  for (const message of messages) {
    const toolCall = assistantMessage.tool_calls?.find(
      (tc: import('../../types').ChatToolCall): boolean =>
        tc.id === message.tool_call_id
    );
    if (!toolCall) continue;

    let parsedResult: Record<string, unknown> = {};
    try {
      parsedResult = JSON.parse(message.content);
    } catch {
      // ignore malformed JSON
    }

    callResults.push({
      name: toolCall.name,
      args: toolCall.args,
      result: parsedResult,
    });
  }

  return callResults;
};

export const makeMessageUpdater =
  (
    setChatMessages: (
      v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
    ) => void
  ): ((
    msgId: string
  ) => (update: { text?: string; thinking?: string; traceback?: string }) => void) =>
  (
    msgId: string
  ): ((update: { text?: string; thinking?: string; traceback?: string }) => void) =>
  (update: { text?: string; thinking?: string; traceback?: string }): void => {
    upsertChatMessage(setChatMessages, ensureUniqueMessages, msgId, update);
  };

const normalizeFunctionCalls = (
  functionCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown> | string;
  }>
): Array<ChatToolFunctionCall> | undefined =>
  functionCalls?.map(
    (call: {
      id: string;
      name: string;
      args: Record<string, unknown> | string;
    }): { id: string; name: string; args: Record<string, unknown> } => ({
      id: call.id,
      name: call.name,
      args: typeof call.args === 'string' ? { raw: call.args } : call.args,
    })
  );

export const buildToolPayload = (
  currentHistory: ChatMessage[],
  currentChapterId: string | null,
  currentChatId: string | null
): {
  messages: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
    name?: string;
    tool_call_id?: string;
  }>;
  active_chapter_id?: number;
  chat_id?: string;
} => ({
  messages: currentHistory.map((message: ChatMessage) => {
    const payload: {
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
      name?: string;
      tool_call_id?: string;
    } = {
      role: (message.role === 'model' ? 'assistant' : message.role) as
        | 'user'
        | 'assistant'
        | 'system'
        | 'tool',
      content: message.text || null,
    };

    if (message.name) {
      payload.name = message.name;
    }

    if (message.tool_call_id) {
      payload.tool_call_id = message.tool_call_id;
    }

    if (message.tool_calls) {
      payload.tool_calls = message.tool_calls.map(
        (
          toolCall: import('../../types').ChatToolCall
        ): {
          id: string;
          type: 'function';
          function: { name: string; arguments: string };
        } => ({
          id: toolCall.id,
          type: 'function' as const,
          function: {
            name: toolCall.name,
            arguments:
              typeof toolCall.args === 'string'
                ? toolCall.args
                : JSON.stringify(toolCall.args),
          },
        })
      );
    }

    return payload;
  }),
  active_chapter_id: currentChapterId ? Number(currentChapterId) : undefined,
  chat_id: currentChatId || undefined,
});

const extractScratchpadContent = (
  args: Record<string, unknown> | string | undefined,
  result?: Record<string, unknown>
): string | undefined => {
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === 'object' && 'content' in parsed) {
        const content = (parsed as Record<string, unknown>).content;
        return typeof content === 'string' ? content : undefined;
      }
    } catch {
      // Fall back to the raw string if it looks like actual content.
      return args;
    }
    return args;
  }

  if (args) {
    if (typeof args.content === 'string') return args.content;
    if (typeof args.raw === 'string') {
      try {
        const parsed = JSON.parse(args.raw);
        if (parsed && typeof parsed === 'object' && 'content' in parsed) {
          const content = (parsed as Record<string, unknown>).content;
          return typeof content === 'string' ? content : undefined;
        }
      } catch {
        return args.raw;
      }
      return args.raw;
    }
  }

  if (result && typeof result.content === 'string') return result.content;
  return undefined;
};

export const applyScratchpadToolResult = (
  args: Record<string, unknown> | string | undefined,
  result?: Record<string, unknown>
): void => {
  const content = extractScratchpadContent(args, result);
  if (!content) return;

  const { setScratchpad, isIncognito, currentChatId, setIncognitoSessions } =
    useChatStore.getState();
  setScratchpad(content);

  if (isIncognito && currentChatId) {
    setIncognitoSessions((prev: ChatSession[]): ChatSession[] =>
      prev.map(
        (session: ChatSession): ChatSession =>
          session.id === currentChatId ? { ...session, scratchpad: content } : session
      )
    );
  }
};

const handleToolResponse = async (
  context: ExecuteChatRequestContext,
  toolResponse: ChatToolExecutionResponse,
  assistantMessage: ChatMessage,
  currentHistory: ChatMessage[],
  currentMsgId: string,
  accumulatedToolBatches: Array<{
    batch_id: string;
    label: string;
    operation_count?: number;
    changed_chapter_ids?: number[];
  }>,
  storyChangedState: { value: boolean }
): Promise<{
  currentHistory: ChatMessage[];
  currentMsgId: string;
  result: UnifiedChatResult;
} | null> => {
  const callResults = parseToolCallResults(
    toolResponse.appended_messages,
    assistantMessage
  );

  for (const message of toolResponse.appended_messages) {
    currentHistory.push({
      id: uuidv4(),
      role: 'tool',
      text: message.content,
      name: message.name,
      tool_call_id: message.tool_call_id,
    });
  }

  context.setChatMessages(ensureUniqueMessages([...currentHistory]));

  for (const callResult of callResults) {
    if (callResult.name === 'write_scratchpad') {
      applyScratchpadToolResult(callResult.args, callResult.result);
    }
  }

  if (toolResponse.mutations?.story_changed) {
    storyChangedState.value = true;
  }

  if (toolResponse.mutations) {
    context.onMutations?.({
      ...toolResponse,
      _call_results: callResults,
    });
  }

  const toolBatch = toolResponse.mutations?.tool_batch;
  if (toolBatch?.batch_id) {
    accumulatedToolBatches.push({
      batch_id: toolBatch.batch_id,
      label: toolBatch.label || `AI tools (${toolBatch.operation_count})`,
      operation_count: toolBatch.operation_count,
      changed_chapter_ids: Array.isArray(toolBatch.changed_chapter_ids)
        ? (toolBatch.changed_chapter_ids as number[])
        : undefined,
    });
  }

  if (context.stopSignalRef.current) {
    return null;
  }

  const nextSession = createChatSession(
    context.getSystemPrompt(),
    currentHistory,
    context.activeChatConfig,
    'CHAT',
    {
      allowWebSearch: context.getAllowWebSearch(),
      currentChapter: context.currentChapter,
      isStopped: (): boolean => context.stopSignalRef.current,
    }
  );

  const nextMsgId = uuidv4();
  const nextResult = await nextSession.sendMessage(
    { message: '' },
    makeMessageUpdater(context.setChatMessages)(nextMsgId)
  );

  return {
    currentHistory,
    currentMsgId: nextMsgId,
    result: nextResult,
  };
};

type UnifiedChatResult = {
  text: string;
  thinking?: string;
  functionCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown> | string;
  }>;
  traceback?: string;
};

const runToolCallLoop = async (
  context: ExecuteChatRequestContext,
  currentHistory: ChatMessage[],
  currentMsgId: string,
  result: UnifiedChatResult,
  accumulatedToolBatches: Array<{
    batch_id: string;
    label: string;
    operation_count?: number;
    changed_chapter_ids?: number[];
  }>,
  storyChangedState: { value: boolean }
): Promise<{
  currentHistory: ChatMessage[];
  currentMsgId: string;
  result: UnifiedChatResult;
}> => {
  let sequentialToolCalls = 0;
  let toolCallLimit = 10;

  while (result.functionCalls && result.functionCalls.length > 0) {
    if (context.stopSignalRef.current) break;

    sequentialToolCalls++;
    if (sequentialToolCalls >= toolCallLimit) {
      const choice = await context.requestToolCallLoopAccess(sequentialToolCalls);
      if (choice === 'stop') break;
      if (choice === 'continue') {
        toolCallLimit += 10;
      } else {
        toolCallLimit = Infinity;
      }
    }

    const assistantMessage = context.createAssistantMessage(currentMsgId, {
      text: result.text,
      thinking: result.thinking,
      functionCalls: normalizeFunctionCalls(result.functionCalls),
    });
    upsertChatMessage(
      context.setChatMessages,
      ensureUniqueMessages,
      currentMsgId,
      assistantMessage
    );
    currentHistory.push(assistantMessage);

    const currentChatId = context.getCurrentChatId();
    let toolResponse: ChatToolExecutionResponse;
    try {
      toolResponse = await api.chat.executeTools(
        buildToolPayload(currentHistory, context.currentChapterId, currentChatId),
        context.onProseChunk,
        (): boolean => context.stopSignalRef.current
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      toolResponse = {
        ok: false,
        appended_messages: [
          {
            role: 'tool',
            tool_call_id: assistantMessage.tool_calls?.[0]?.id ?? '',
            name: 'tool_error',
            content: `Tool execution failed: ${message}`,
          },
        ],
      };
    }

    if (toolResponse.ok === false && toolResponse.appended_messages.length === 0) {
      toolResponse.appended_messages = [
        {
          role: 'tool',
          tool_call_id: assistantMessage.tool_calls?.[0]?.id ?? '',
          name: 'tool_error',
          content: 'A tool failed to execute.',
        },
      ];
    }

    if (context.stopSignalRef.current) break;

    const nextState = await handleToolResponse(
      context,
      toolResponse,
      assistantMessage,
      currentHistory,
      currentMsgId,
      accumulatedToolBatches,
      storyChangedState
    );

    if (!nextState) break;

    currentHistory = nextState.currentHistory;
    currentMsgId = nextState.currentMsgId;
    result = nextState.result;
  }

  return { currentHistory, currentMsgId, result };
};

export const buildExecuteChatRequest =
  (context: ExecuteChatRequestContext) =>
  (
    userText: string,
    history: ChatMessage[],
    attachments?: ChatAttachment[],
    userMsgId?: string
  ): Promise<void> =>
    executeChatRequestImpl(context, userText, history, attachments, userMsgId);

const executeChatRequestImpl = async (
  context: ExecuteChatRequestContext,
  userText: string,
  history: ChatMessage[],
  attachments?: ChatAttachment[],
  userMsgId?: string
): Promise<void> => {
  context.setIsChatLoading(true);
  context.stopSignalRef.current = false;

  const updateMessage = makeMessageUpdater(context.setChatMessages);

  try {
    const story = useStoryStore.getState().story;
    const projectContextRevision = useChatStore.getState().projectContextRevision;
    const refreshedHistory = refreshStaleProjectContextHistory(
      history,
      story,
      context.currentChapter,
      projectContextRevision
    );
    let currentHistory = [...refreshedHistory.history];
    const session = createChatSession(
      context.getSystemPrompt(),
      currentHistory,
      context.activeChatConfig,
      'CHAT',
      {
        allowWebSearch: context.getAllowWebSearch(),
        currentChapter: context.currentChapter,
        isStopped: (): boolean => context.stopSignalRef.current,
      }
    );

    let currentMsgId = uuidv4();
    let result = await session.sendMessage(
      { message: userText, attachments },
      updateMessage(currentMsgId)
    );

    const effectiveUserMsgId = userMsgId || uuidv4();
    if (
      !currentHistory.some((msg: ChatMessage): boolean => msg.id === effectiveUserMsgId)
    ) {
      currentHistory.push({
        id: effectiveUserMsgId,
        role: 'user',
        text: userText,
        attachments,
      });
    }

    const accumulatedToolBatches: Array<{
      batch_id: string;
      label: string;
      operation_count?: number;
      changed_chapter_ids?: number[];
    }> = [];
    const storyChangedState = { value: false };
    const loopResult = await runToolCallLoop(
      context,
      currentHistory,
      currentMsgId,
      result,
      accumulatedToolBatches,
      storyChangedState
    );

    currentHistory = loopResult.currentHistory;
    currentMsgId = loopResult.currentMsgId;
    result = loopResult.result;

    if (storyChangedState.value) {
      await context.refreshProjects();
      await context.refreshStory();
    }

    const baselineChapterOverrides =
      await fetchBaselineChapterOverrides(accumulatedToolBatches);

    if (accumulatedToolBatches.length > 0) {
      await pushExternalHistoryEntryForToolBatches(
        context,
        accumulatedToolBatches,
        baselineChapterOverrides
      );
    } else if (storyChangedState.value) {
      await context.pushExternalHistoryEntry?.({
        label: 'AI tool changes',
        forceNewHistory: true,
      });
    }

    const botMessage = context.createAssistantMessage(currentMsgId, {
      text: result.text,
      thinking: result.thinking,
      functionCalls: normalizeFunctionCalls(result.functionCalls),
    });
    upsertChatMessage(
      context.setChatMessages,
      ensureUniqueMessages,
      currentMsgId,
      botMessage
    );
    useChatStore
      .getState()
      .setProjectContextRevision(useStoryStore.getState().story.lastUpdated ?? null);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }

    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred';
    let errorText = `AI Error: ${message}`;
    const detailedError = error as { data?: unknown; traceback?: string };
    if (detailedError.data) {
      const detail =
        typeof detailedError.data === 'string'
          ? detailedError.data
          : JSON.stringify(detailedError.data, null, 2);
      errorText += `\n\n**Details:**\n${detail}`;
    }

    const errorMessage: ChatMessage = {
      id: uuidv4(),
      role: 'model',
      text: errorText,
      isError: true,
      traceback: detailedError.traceback,
    };
    context.setChatMessages((prev: ChatMessage[]): ChatMessage[] => [
      ...prev,
      errorMessage,
    ]);
  } finally {
    context.setIsChatLoading(false);
    context.stopSignalRef.current = false;
  }
};

type ToolBatchSummary = {
  batch_id: string;
  label: string;
  operation_count?: number;
  changed_chapter_ids?: number[];
};

const fetchBaselineChapterOverrides = async (
  accumulatedToolBatches: ToolBatchSummary[]
): Promise<Array<{ id: string; content: string }>> => {
  const baselineChapterOverrides: Array<{ id: string; content: string }> = [];
  const seen = new Set<number>();

  for (const batch of accumulatedToolBatches) {
    if (!batch.changed_chapter_ids?.length) continue;
    for (const chapterId of batch.changed_chapter_ids) {
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);
      const content = await api.chat.getChapterBeforeContent(batch.batch_id, chapterId);
      if (content !== null) {
        baselineChapterOverrides.push({ id: String(chapterId), content });
      }
    }
  }

  return baselineChapterOverrides;
};

const buildToolBatchLabel = (batches: ToolBatchSummary[]): string =>
  batches.length === 1
    ? batches[0].label
    : `AI tools: ${batches.map((batch: ToolBatchSummary) => batch.label).join(', ')}`;

const pushExternalHistoryEntryForToolBatches = async (
  context: ExecuteChatRequestContext,
  accumulatedToolBatches: ToolBatchSummary[],
  baselineChapterOverrides: Array<{ id: string; content: string }>
): Promise<void> => {
  await context.pushExternalHistoryEntry?.({
    label: buildToolBatchLabel(accumulatedToolBatches),
    forceNewHistory: true,
    baselineChapterOverrides,
    onUndo: async (): Promise<void> => {
      for (const batch of [...accumulatedToolBatches].reverse()) {
        await api.chat.undoToolBatch(batch.batch_id);
      }
      await context.refreshProjects();
      await context.refreshStory();
    },
    onRedo: async (): Promise<void> => {
      for (const batch of accumulatedToolBatches) {
        await api.chat.redoToolBatch(batch.batch_id);
      }
      await context.refreshProjects();
      await context.refreshStory();
    },
  });
};
