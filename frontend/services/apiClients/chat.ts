import { ChatSession } from '../../types';
import { ChatApiMessage, ChatToolExecutionResponse } from '../apiTypes';
import { fetchJson } from './shared';

export const chatApi = {
  list: async () =>
    fetchJson<ChatSession[]>('/chats', undefined, 'Failed to list chats'),

  load: async (id: string) => {
    return fetchJson<ChatSession>(`/chats/${id}`, undefined, 'Failed to load chat');
  },

  save: async (
    id: string,
    data: {
      name: string;
      messages: unknown[];
      systemPrompt: string;
      allowWebSearch?: boolean;
    }
  ) => {
    return fetchJson<{ ok: boolean }>(
      `/chats/${id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      'Failed to save chat'
    );
  },

  delete: async (id: string) => {
    return fetchJson<{ ok: boolean }>(
      `/chats/${id}`,
      { method: 'DELETE' },
      'Failed to delete chat'
    );
  },

  deleteAll: async () => {
    return fetchJson<{ ok: boolean }>(
      '/chats',
      { method: 'DELETE' },
      'Failed to delete all chats'
    );
  },

  executeTools: async (payload: {
    messages: ChatApiMessage[];
    active_chapter_id?: number;
    model_name?: string;
  }) => {
    return fetchJson<ChatToolExecutionResponse>(
      '/chat/tools',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'Failed to execute chat tools'
    );
  },
};
