// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the chat unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { ChatSession } from '../../types';
import {
  ChatApiMessage,
  ChatListResponse,
  ChatToolBatchMutationResponse,
  ChatToolExecutionResponse,
} from '../apiTypes';
import { fetchJson, postJson, deleteJson, projectEndpoint } from './shared';

export interface ChatApi {
  list: () => Promise<ChatSession[]>;
  load: (id: string) => Promise<ChatSession>;
  save: (
    id: string,
    data: {
      name: string;
      messages: unknown[];
      systemPrompt: string;
      allowWebSearch?: boolean;
      scratchpad?: string;
      projectContextRevision?: number | null;
    }
  ) => Promise<{ ok: boolean }>;
  delete: (id: string) => Promise<{ ok: boolean }>;
  deleteAll: () => Promise<{ ok: boolean }>;
  executeTools: (
    payload: {
      messages: ChatApiMessage[];
      active_chapter_id?: number;
      model_name?: string;
      chat_id?: string;
    },
    onProseChunk?: (
      chapId: number,
      writeMode: string,
      accumulated: string,
      streamId: number
    ) => void,
    isStopped?: () => boolean
  ) => Promise<ChatToolExecutionResponse>;
  undoToolBatch: (batchId: string) => Promise<{
    ok: boolean;
    batch_id?: string | null | undefined;
    detail?: string | null | undefined;
  }>;
  redoToolBatch: (batchId: string) => Promise<{
    ok: boolean;
    batch_id?: string | null | undefined;
    detail?: string | null | undefined;
  }>;
  getChapterBeforeContent: (
    batchId: string,
    chapterId: number
  ) => Promise<string | null>;
}

type ToolProseChunk = {
  chapId: number;
  writeMode: string;
  accumulated: string;
  streamId: number;
};

type ParsedChatToolEvent =
  | {
      type: 'prose_start';
      chapId: number;
      writeMode: string;
    }
  | {
      type: 'prose_chunk';
      chapId: number;
      writeMode: string;
      accumulated: string;
    }
  | {
      type: 'result';
      ok: boolean;
      appended_messages: ChatToolExecutionResponse['appended_messages'];
      mutations?: ChatToolExecutionResponse['mutations'];
    }
  | { type: 'error'; error: string };

const parseChatToolEvent = (dataStr: string): ParsedChatToolEvent | null => {
  if (dataStr === '[DONE]') return null;

  try {
    const event = JSON.parse(dataStr) as {
      type?: string;
      accumulated?: string;
      chap_id?: number;
      write_mode?: string;
      ok?: boolean;
      appended_messages?: ChatToolExecutionResponse['appended_messages'];
      mutations?: ChatToolExecutionResponse['mutations'];
      error?: string;
    };

    if (event.type === 'prose_start') {
      return {
        type: 'prose_start',
        chapId: event.chap_id ?? 0,
        writeMode: event.write_mode ?? '',
      };
    }

    if (event.type === 'prose_chunk') {
      return {
        type: 'prose_chunk',
        chapId: event.chap_id ?? 0,
        writeMode: event.write_mode ?? '',
        accumulated: event.accumulated ?? '',
      };
    }

    if (event.type === 'result') {
      return {
        type: 'result',
        ok: event.ok ?? true,
        appended_messages: event.appended_messages ?? [],
        mutations: event.mutations,
      };
    }

    if (event.type === 'error') {
      return { type: 'error', error: event.error ?? 'Tool execution failed' };
    }
  } catch {
    return null;
  }

  return null;
};

interface ProseChunkScheduler {
  setPendingProseChunk: (chunk: ToolProseChunk) => void;
  scheduleProseChunkFlush: () => void;
  cancelScheduledProseFlush: () => void;
  flushPendingProseChunk: () => void;
}

/**
 * Yield to the next macrotask via MessageChannel so Zustand store updates
 * triggered by the resumed code run outside React's render/commit phase.
 * Using requestAnimationFrame instead would fire inside React 19's concurrent
 * renderer commit phase and trigger "Maximum update depth exceeded" errors.
 */
const yieldToMacrotask = async (): Promise<void> => {
  await new Promise<void>((resolve: () => void) => {
    if (typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel();
      channel.port1.onmessage = (): void => resolve();
      channel.port2.postMessage(null);
    } else {
      setTimeout(resolve, 0);
    }
  });
};

const createProseChunkScheduler = (
  onProseChunk?: (
    chapId: number,
    writeMode: string,
    accumulated: string,
    streamId: number
  ) => void
): ProseChunkScheduler => {
  let pendingProseChunk: ToolProseChunk | null = null;
  let proseFlushHandle: ReturnType<typeof setTimeout> | null = null;
  let proseFlushToken = 0;

  const flushPendingProseChunk = (): void => {
    proseFlushHandle = null;
    if (!pendingProseChunk || !onProseChunk) return;
    const chunk = pendingProseChunk;
    pendingProseChunk = null;
    onProseChunk(chunk.chapId, chunk.writeMode, chunk.accumulated, chunk.streamId);
  };

  const scheduleProseChunkFlush = (): void => {
    if (!onProseChunk || proseFlushHandle !== null) return;

    // Coalesce bursts into a single macrotask flush so we render the latest
    // accumulated chunk without triggering React render-phase store updates.
    // setTimeout(0) is used (not requestAnimationFrame) because RAF fires
    // inside React 19's concurrent renderer commit phase, which causes
    // "Maximum update depth exceeded" errors when Zustand setState is called.
    const token = ++proseFlushToken;
    proseFlushHandle = setTimeout((): void => {
      if (proseFlushHandle === null || proseFlushToken !== token) {
        return;
      }
      flushPendingProseChunk();
    }, 0);
  };

  const cancelScheduledProseFlush = (): void => {
    if (proseFlushHandle === null) return;

    clearTimeout(proseFlushHandle);
    proseFlushToken += 1;
    proseFlushHandle = null;
  };

  const setPendingProseChunk = (chunk: ToolProseChunk): void => {
    pendingProseChunk = chunk;
  };

  return {
    setPendingProseChunk,
    scheduleProseChunkFlush,
    cancelScheduledProseFlush,
    flushPendingProseChunk,
  };
};

export const createChatApi = (projectName: string): ChatApi => ({
  list: async () => {
    const response = await fetchJson<ChatListResponse>(
      projectEndpoint(projectName, '/chats'),
      undefined,
      'Failed to list chats'
    );
    return response.chats ?? [];
  },

  load: async (id: string): Promise<ChatSession> => {
    return fetchJson<ChatSession>(
      projectEndpoint(projectName, `/chats/${id}`),
      undefined,
      'Failed to load chat'
    );
  },

  save: async (
    id: string,
    data: {
      name: string;
      messages: unknown[];
      systemPrompt: string;
      allowWebSearch?: boolean;
      scratchpad?: string;
      projectContextRevision?: number | null;
    }
  ): Promise<{ ok: boolean }> => {
    return postJson<{ ok: boolean }>(
      projectEndpoint(projectName, `/chats/${id}`),
      data,
      'Failed to save chat'
    );
  },

  delete: async (id: string): Promise<{ ok: boolean }> => {
    return deleteJson<{ ok: boolean }>(
      projectEndpoint(projectName, `/chats/${id}`),
      'Failed to delete chat'
    );
  },

  deleteAll: async (): Promise<{ ok: boolean }> => {
    return deleteJson<{ ok: boolean }>(
      projectEndpoint(projectName, '/chats'),
      'Failed to delete all chats'
    );
  },

  executeTools: async (
    payload: {
      messages: ChatApiMessage[];
      active_chapter_id?: number;
      model_name?: string;
      chat_id?: string;
    },
    onProseChunk?: (
      chapId: number,
      writeMode: string,
      accumulated: string,
      streamId: number
    ) => void,
    isStopped?: () => boolean
  ): Promise<ChatToolExecutionResponse> => {
    const res = await fetch(`/api/v1${projectEndpoint(projectName, '/chat/tools')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error('Failed to execute chat tools');
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('Failed to execute chat tools: no response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    const proseChunkScheduler = createProseChunkScheduler(onProseChunk);
    let currentProseStreamId = 0;

    try {
      while (true) {
        if (isStopped?.()) {
          // User stopped generation — close the stream so the backend disconnects.
          reader.cancel().catch((): undefined => undefined);
          return { ok: false, appended_messages: [] };
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (isStopped?.()) {
          reader.cancel().catch((): undefined => undefined);
          return { ok: false, appended_messages: [] };
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          const event = parseChatToolEvent(dataStr);
          if (!event) continue;

          if (event.type === 'prose_start') {
            currentProseStreamId += 1;
          } else if (event.type === 'prose_chunk') {
            proseChunkScheduler.setPendingProseChunk({
              chapId: event.chapId,
              writeMode: event.writeMode,
              accumulated: event.accumulated,
              streamId: currentProseStreamId,
            });
            proseChunkScheduler.scheduleProseChunkFlush();
          } else if (event.type === 'result') {
            proseChunkScheduler.cancelScheduledProseFlush();
            proseChunkScheduler.flushPendingProseChunk();
            // Let the browser paint the latest prose preview before control
            // returns to the chat loop and potentially starts more async work.
            await yieldToMacrotask();
            return {
              ok: event.ok,
              appended_messages: event.appended_messages,
              mutations: event.mutations,
            };
          } else if (event.type === 'error') {
            throw new Error(event.error);
          }
        }
      }
    } finally {
      proseChunkScheduler.cancelScheduledProseFlush();
      proseChunkScheduler.flushPendingProseChunk();
    }

    // Stream ended without a result event (should not normally happen).
    throw new Error('Failed to execute chat tools: stream ended unexpectedly');
  },

  undoToolBatch: async (
    batchId: string
  ): Promise<{
    ok: boolean;
    batch_id?: string | null | undefined;
    detail?: string | null | undefined;
  }> => {
    return fetchJson<ChatToolBatchMutationResponse>(
      projectEndpoint(projectName, `/chat/tools/undo/${encodeURIComponent(batchId)}`),
      {
        method: 'POST',
      },
      'Failed to undo AI tool batch'
    );
  },

  redoToolBatch: async (
    batchId: string
  ): Promise<{
    ok: boolean;
    batch_id?: string | null | undefined;
    detail?: string | null | undefined;
  }> => {
    return fetchJson<ChatToolBatchMutationResponse>(
      projectEndpoint(projectName, `/chat/tools/redo/${encodeURIComponent(batchId)}`),
      {
        method: 'POST',
      },
      'Failed to redo AI tool batch'
    );
  },

  getChapterBeforeContent: async (
    batchId: string,
    chapterId: number
  ): Promise<string | null> => {
    try {
      const res = await fetchJson<{ content: string }>(
        projectEndpoint(
          projectName,
          `/chat/tools/batches/${encodeURIComponent(batchId)}/chapter-before/${chapterId}`
        ),
        undefined,
        'Failed to get chapter before content'
      );
      return res.content ?? null;
    } catch {
      return null;
    }
  },
});

export const chatApi = createChatApi('');
