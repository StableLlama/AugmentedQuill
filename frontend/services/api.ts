import { Chapter, ProjectMetadata, StoryState } from '../types';

const API_BASE = '/api';

export const api = {
  machine: {
    get: async () => {
      const res = await fetch(`${API_BASE}/machine`);
      if (!res.ok) throw new Error('Failed to load machine config');
      return res.json();
    },
    save: async (machine: any) => {
      const res = await fetch(`${API_BASE}/machine`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(machine),
      });
      if (!res.ok) throw new Error('Failed to save machine config');
      return res.json();
    },
    test: async (payload: {
      base_url: string;
      api_key?: string;
      timeout_s?: number;
    }) => {
      const res = await fetch(`${API_BASE}/machine/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to test connection');
      return res.json() as Promise<{
        ok: boolean;
        models: string[];
        detail?: string;
      }>;
    },
    testModel: async (payload: {
      base_url: string;
      api_key?: string;
      timeout_s?: number;
      model_id: string;
    }) => {
      const res = await fetch(`${API_BASE}/machine/test_model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to test model');
      return res.json() as Promise<{
        ok: boolean;
        model_ok: boolean;
        models: string[];
        detail?: string;
      }>;
    },
  },
  projects: {
    list: async () => {
      const res = await fetch(`${API_BASE}/projects`);
      if (!res.ok) throw new Error('Failed to list projects');
      return res.json();
    },
    select: async (name: string) => {
      const res = await fetch(`${API_BASE}/projects/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Failed to select project');
      return res.json();
    },
    delete: async (name: string) => {
      const res = await fetch(`${API_BASE}/projects/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Failed to delete project');
      return res.json();
    },
  },
  chapters: {
    list: async () => {
      const res = await fetch(`${API_BASE}/chapters`);
      if (!res.ok) throw new Error('Failed to list chapters');
      return res.json();
    },
    get: async (id: number) => {
      const res = await fetch(`${API_BASE}/chapters/${id}`);
      if (!res.ok) throw new Error('Failed to get chapter');
      return res.json();
    },
    create: async (title: string, content: string = '') => {
      const res = await fetch(`${API_BASE}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (!res.ok) throw new Error('Failed to create chapter');
      return res.json();
    },
    updateContent: async (id: number, content: string) => {
      const res = await fetch(`${API_BASE}/chapters/${id}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error('Failed to update chapter content');
      return res.json();
    },
    updateTitle: async (id: number, title: string) => {
      const res = await fetch(`${API_BASE}/chapters/${id}/title`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('Failed to update chapter title');
      return res.json();
    },
    updateSummary: async (id: number, summary: string) => {
      const res = await fetch(`${API_BASE}/chapters/${id}/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      if (!res.ok) throw new Error('Failed to update chapter summary');
      return res.json();
    },
    delete: async (id: number) => {
      const res = await fetch(`${API_BASE}/chapters/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete chapter');
      return res.json();
    },
  },
  story: {
    updateTitle: async (title: string) => {
      const res = await fetch(`${API_BASE}/story/title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('Failed to update story title');
      return res.json();
    },
    updateSummary: async (summary: string) => {
      const res = await fetch(`${API_BASE}/story/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      if (!res.ok) throw new Error('Failed to update story summary');
      return res.json();
    },
    updateTags: async (tags: string[]) => {
      const res = await fetch(`${API_BASE}/story/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) throw new Error('Failed to update story tags');
      return res.json();
    },
  },
  settings: {
    getPrompts: async (modelName?: string) => {
      const url = modelName
        ? `${API_BASE}/prompts?model_name=${encodeURIComponent(modelName)}`
        : `${API_BASE}/prompts`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch prompts');
      return res.json() as Promise<{
        ok: boolean;
        system_messages: Record<string, string>;
        user_prompts: Record<string, string>;
      }>;
    },
  },
  chat: {
    executeTools: async (payload: {
      messages: any[];
      active_chapter_id?: number;
      model_name?: string;
    }) => {
      const res = await fetch(`${API_BASE}/chat/tools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to execute chat tools');
      return res.json();
    },
  },
  debug: {
    getLogs: async () => {
      const res = await fetch(`${API_BASE}/debug/llm_logs`);
      if (!res.ok) throw new Error('Failed to fetch debug logs');
      return res.json();
    },
    clearLogs: async () => {
      const res = await fetch(`${API_BASE}/debug/llm_logs`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to clear debug logs');
      return res.json();
    },
  },
};
