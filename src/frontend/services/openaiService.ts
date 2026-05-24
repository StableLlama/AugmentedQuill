// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the openai service unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { ChatAttachment, LLMConfig, SuggestionGenerationMode } from '../types';
import { applySmartQuotes } from '../utils/textUtils';
import {
  ChatContextUsage,
  prepareChatContext,
  ChatHistoryMessage,
} from '../features/chat/chatContextBudget';
type ErrorData = string | Record<string, unknown> | unknown[];

type UserMessageInput = string | { message: string; attachments?: ChatAttachment[] };

type ServerUsage = Record<string, unknown>;

type ToolCallChunk = {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

export const parseToolArguments = (args: string): Record<string, unknown> | string => {
  try {
    return JSON.parse(args);
  } catch {
    // Some tool argument payloads can contain unescaped newlines or other
    // characters that make the JSON invalid when streamed from the backend.
    // Try a best-effort repair so we don't lose tool call data.
    const normalized = args
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
      .replace(/\r\n/g, '\\n')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');

    const firstBrace = normalized.indexOf('{');
    const lastBrace = normalized.lastIndexOf('}');
    const candidate =
      firstBrace !== -1 && lastBrace > firstBrace
        ? normalized.slice(firstBrace, lastBrace + 1)
        : normalized;

    try {
      return JSON.parse(candidate);
    } catch {
      // Fall back to the raw string so callers can still pass it through.
      return args;
    }
  }
};

type ParsedFunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown> | string;
};

/** Represents error. */
export class ChatError extends Error {
  traceback?: string;
  status?: number;
  data?: ErrorData;

  constructor(
    message: string,
    options?: { traceback?: string; status?: number; data?: ErrorData }
  ) {
    super(message);
    this.name = 'ChatError';
    this.traceback = options?.traceback;
    this.status = options?.status;
    this.data = options?.data;
  }
}

export interface UnifiedChat {
  sendMessage(
    message: UserMessageInput,
    onUpdate?: (update: {
      text?: string;
      thinking?: string;
      traceback?: string;
    }) => void
  ): Promise<{
    text: string;
    thinking?: string;
    functionCalls?: ParsedFunctionCall[];
    serverUsage?: ServerUsage;
    traceback?: string;
  }>;
}

export type CancelSignal = {
  cancelled: boolean;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
};

/** Read ssestream. */
// eslint-disable-next-line complexity
async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onToolCalls?: (toolCalls: ToolCallChunk[]) => void,
  onThinking?: (thinking: string) => void,
  onContent?: (content: string) => void,
  onUsage?: (usage: ServerUsage) => void,
  cancelSignal?: CancelSignal,
  isStopped?: () => boolean
): Promise<string> {
  let text = '';
  let buffer = '';
  const decoder = new TextDecoder();

  if (cancelSignal) {
    cancelSignal.reader = reader;
  }

  const shouldStop = (): boolean => Boolean(cancelSignal?.cancelled || isStopped?.());

  const cancelAndBreak = async (): Promise<void> => {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  };

  while (true) {
    if (shouldStop()) {
      await cancelAndBreak();
      break;
    }

    const { done, value } = await reader.read();
    if (done) break;

    // Check immediately after the read resolves — stop may have fired while we were waiting.
    if (shouldStop()) {
      await cancelAndBreak();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') continue;
        try {
          const data = JSON.parse(dataStr) as {
            error?: string;
            message?: string;
            traceback?: string;
            status?: number;
            data?: ErrorData;
            content?: string;
            thinking?: string;
            tool_calls?: ToolCallChunk[];
            usage?: unknown;
          };
          if (data.error) {
            const msg = data.message || data.error;
            throw new ChatError(msg, {
              traceback: data.traceback,
              status: data.status,
              data: data.data,
            });
          }
          if (data.content) {
            text += data.content;
            if (onContent) onContent(data.content);
          }
          if (data.thinking && onThinking) {
            onThinking(data.thinking);
          }
          if (data.tool_calls && onToolCalls) {
            onToolCalls(data.tool_calls);
          }
          if ('usage' in data && data.usage && onUsage) {
            onUsage(data.usage as ServerUsage);
          }
        } catch (e) {
          if (e instanceof Error) {
            const msg = e.message.toLowerCase();
            if (
              msg.includes('status:') ||
              msg.includes('error') ||
              msg.includes('failed') ||
              msg.includes('traceback')
            ) {
              // Re-throw handled errors from backend
              throw e;
            }
          }
          console.error('Failed to parse SSE data', e);
        }
      }
    }
  }
  return text;
}

export const createChatSession = (
  systemInstruction: string,
  history: ChatHistoryMessage[],
  config: LLMConfig,
  modelType: 'CHAT' | 'WRITING' | 'EDITING' = 'CHAT',
  options?: {
    allowWebSearch?: boolean;
    currentChapter?: { id: string; title: string } | null;
    onContextUsage?: (usage: ChatContextUsage) => void;
    onServerUsage?: (usage: ServerUsage) => void;
    isStopped?: () => boolean;
  }
): UnifiedChat => {
  return {
    sendMessage: async (
      msg: UserMessageInput,
      onUpdate:
        | ((update: { text?: string; thinking?: string; traceback?: string }) => void)
        | undefined
    ) => {
      const userMsgText = typeof msg === 'string' ? msg : msg.message;
      const preparedContext = prepareChatContext({
        systemInstruction,
        history,
        config,
        userMessageText: userMsgText,
      });
      options?.onContextUsage?.(preparedContext.usage);

      if (preparedContext.usage.enabled && !preparedContext.usage.withinBudget) {
        throw new ChatError(
          'Chat context is still too large after compaction. Start a new chat or remove older long messages.'
        );
      }

      try {
        const res = await fetch('/api/v1/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: preparedContext.messages,
            model_type: modelType,
            model_name: config.name || config.id,
            allow_web_search: options?.allowWebSearch,
            current_chapter: options?.currentChapter,
            attachments: typeof msg === 'object' ? msg.attachments : undefined,
          }),
        });

        if (!res.ok) throw new Error('Chat request failed');

        const reader = res.body?.getReader();
        if (!reader) return { text: '' };

        const toolCallsAccumulator: Array<{ id: string; name: string; args: string }> =
          [];
        let thinking = '';
        let fullText = '';
        let serverUsage: ServerUsage | undefined;
        const cancelSignal: CancelSignal = { cancelled: false };
        const text = await readSSEStream(
          reader,
          (calls: ToolCallChunk[]): void => {
            for (const call of calls) {
              const index = call.index ?? 0;
              if (!toolCallsAccumulator[index]) {
                toolCallsAccumulator[index] = { id: '', name: '', args: '' };
              }
              if (call.id) toolCallsAccumulator[index].id = call.id;
              if (call.function) {
                if (call.function.name) {
                  // Only append if it's not exactly the same as what we already have.
                  // This prevents doubling up if the backend sends the full name twice.
                  if (toolCallsAccumulator[index].name !== call.function.name) {
                    toolCallsAccumulator[index].name += call.function.name;
                  }
                }
                if (call.function.arguments)
                  toolCallsAccumulator[index].args += call.function.arguments;
              }
            }
          },
          (t: string): void => {
            thinking += t;
            if (onUpdate) onUpdate({ thinking: applySmartQuotes(thinking) });
          },
          (chunk: string): void => {
            fullText += chunk;
            if (onUpdate) onUpdate({ text: applySmartQuotes(fullText) });
          },
          (usage: ServerUsage): void => {
            serverUsage = usage;
            if (options?.onServerUsage) options.onServerUsage(usage);
          },
          cancelSignal,
          options?.isStopped
        );

        const functionCalls = toolCallsAccumulator
          .filter(
            (c: { id: string; name: string; args: string }): string =>
              c && (c.name || c.args)
          )
          .map((c: { id: string; name: string; args: string }) => ({
            id: c.id,
            name: c.name,
            args: c.args ? parseToolArguments(c.args) : {},
          }));

        return {
          text: applySmartQuotes(text),
          thinking: thinking ? applySmartQuotes(thinking) : undefined,
          functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
          serverUsage,
          traceback: undefined, // Or capture if needed
        };
      } catch (e: unknown) {
        throw e;
      }
    },
  };
};

export const generateSimpleContent = async (
  prompt: string,
  systemInstruction: string,
  config: LLMConfig,
  modelType?: 'CHAT' | 'WRITING' | 'EDITING',
  options?: {
    tool_choice?: string;
    onUpdate?: (partialText: string) => void;
  }
): Promise<string> => {
  const messages = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: prompt },
  ];

  try {
    const res = await fetch('/api/v1/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        model_type: modelType,
        model_name: config.name || config.id,
        tool_choice: options?.tool_choice,
      }),
    });

    if (!res.ok) throw new Error('Generation failed');

    const reader = res.body?.getReader();
    if (!reader) return '';

    let accumulated = '';
    const finalResult = await readSSEStream(
      reader,
      undefined,
      undefined,
      (delta: string): void => {
        accumulated += delta;
        options?.onUpdate?.(applySmartQuotes(accumulated));
      }
    );
    return applySmartQuotes(finalResult);
  } catch (e: unknown) {
    // Re-throw so the caller can handle it and show it to the user
    throw e;
  }
};

export const streamAiAction = async (
  target: 'book_summary' | 'story_summary' | 'summary' | 'chapter',
  action: 'write' | 'update' | 'rewrite' | 'extend',
  targetId: string,
  currentText: string,
  onUpdate?: (fullText: string) => void,
  onThinking?: (thinking: string) => void,
  source?: 'chapter' | 'notes',
  checkedSourcebookIds?: string[],
  cancelSignal?: CancelSignal
): Promise<string> => {
  const scope = targetId === 'story' ? 'story' : 'chapter';
  const body: Record<string, unknown> = {
    target,
    action,
    scope,
    chap_id: scope === 'chapter' ? Number(targetId) : undefined,
    target_id: scope === 'chapter' ? Number(targetId) : targetId,
    current_text: currentText,
    source,
  };
  if (checkedSourcebookIds && checkedSourcebookIds.length > 0) {
    body.checked_sourcebook = checkedSourcebookIds;
  }

  const res = await fetch('/api/v1/story/action/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res
      .json()
      .catch((): { detail: string } => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || 'Action failed');
  }

  const reader = res.body?.getReader();
  if (!reader) return '';

  let accumulated = '';
  let thinking = '';
  const finalResult = await readSSEStream(
    reader,
    undefined,
    (t: string): void => {
      thinking += t;
      onThinking?.(thinking);
    },
    (delta: string): void => {
      accumulated += delta;
      onUpdate?.(applySmartQuotes(accumulated));
    },
    undefined,
    cancelSignal
  );

  if (cancelSignal?.cancelled) {
    return accumulated;
  }

  return applySmartQuotes(finalResult);
};

export const generateContinuations = async (
  currentContent: string,
  storyContext: string,
  systemInstruction: string,
  config: LLMConfig,
  chapterId?: string,
  checkedSourcebookIds?: string[],
  options?: {
    onSuggestionUpdate?: (index: number, text: string) => void;
    cancelSignal?: CancelSignal;
    loopGuardEnabled?: boolean;
    loopGuardNgram?: 3 | 4;
    loopGuardMinRepeats?: number;
    loopGuardMaxRegens?: number;
    suggestionMode?: SuggestionGenerationMode;
  }
): Promise<string[]> => {
  if (!chapterId) return [];
  const scope = chapterId === 'story' ? 'story' : 'chapter';

  // eslint-disable-next-line complexity
  const fetchSuggestion = async (index: number): Promise<string> => {
    try {
      const body: Record<string, unknown> = {
        scope,
        chap_id: scope === 'chapter' ? Number(chapterId) : undefined,
        model_name: config.name || config.id,
        current_text: currentContent,
        mode: options?.suggestionMode || 'guided',
      };
      if (checkedSourcebookIds && checkedSourcebookIds.length > 0) {
        body.checked_sourcebook = checkedSourcebookIds;
      }
      if (typeof options?.loopGuardEnabled === 'boolean') {
        body.loop_guard_enabled = options.loopGuardEnabled;
      }
      if (options?.loopGuardNgram === 3 || options?.loopGuardNgram === 4) {
        body.loop_guard_ngram = options.loopGuardNgram;
      }
      if (
        typeof options?.loopGuardMinRepeats === 'number' &&
        Number.isFinite(options.loopGuardMinRepeats)
      ) {
        body.loop_guard_min_repeats = Math.floor(options.loopGuardMinRepeats);
      }
      if (
        typeof options?.loopGuardMaxRegens === 'number' &&
        Number.isFinite(options.loopGuardMaxRegens)
      ) {
        body.loop_guard_max_regens = Math.floor(options.loopGuardMaxRegens);
      }
      const res = await fetch('/api/v1/story/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) return '';

      const reader = res.body?.getReader();
      let text = '';
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          if (options?.cancelSignal?.cancelled) {
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          options?.onSuggestionUpdate?.(index, applySmartQuotes(text));
        }
        text += decoder.decode();
        options?.onSuggestionUpdate?.(index, applySmartQuotes(text));
      }
      return applySmartQuotes(text);
    } catch {
      return '';
    }
  };

  const [opt1, opt2] = await Promise.all([fetchSuggestion(0), fetchSuggestion(1)]);
  return [opt1, opt2];
};
