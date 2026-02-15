// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

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
        capabilities?: {
          is_multimodal: boolean;
          supports_function_calling: boolean;
        };
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
    create: async (name: string, type: string) => {
      const res = await fetch(`${API_BASE}/projects/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type }),
      });
      if (!res.ok) throw new Error('Failed to create project');
      return res.json();
    },
    convert: async (new_type: string) => {
      const res = await fetch(`${API_BASE}/projects/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_type }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || 'Failed to convert project');
      }
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
    export: async (name?: string) => {
      const url = name
        ? `${API_BASE}/projects/export?name=${encodeURIComponent(name)}`
        : `${API_BASE}/projects/export`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to export project');
      return res.blob();
    },
    updateConfig: async () => {
      const res = await fetch(`${API_BASE}/settings/update_story_config`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to update story config');
      return data;
    },
    import: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE}/projects/import`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        try {
          const err = await res.json();
          throw new Error(err.detail || 'Failed to import project');
        } catch (e: any) {
          throw new Error(e.message || 'Failed to import project');
        }
      }
      return res.json();
    },
    uploadImage: async (file: File, targetName?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      const url = targetName
        ? `${API_BASE}/projects/images/upload?target_name=${encodeURIComponent(targetName)}`
        : `${API_BASE}/projects/images/upload`;

      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Failed to upload image');
      return res.json();
    },
    updateImage: async (filename: string, description?: string, title?: string) => {
      const res = await fetch(`${API_BASE}/projects/images/update_description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, description, title }),
      });
      if (!res.ok) throw new Error('Failed to update image metadata');
      return res.json();
    },
    createImagePlaceholder: async (description: string, title?: string) => {
      const res = await fetch(`${API_BASE}/projects/images/create_placeholder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, title }),
      });
      if (!res.ok) throw new Error('Failed to create placeholder');
      return res.json();
    },
    listImages: async () => {
      const res = await fetch(`${API_BASE}/projects/images/list`);
      if (!res.ok) throw new Error('Failed to list images');
      return res.json();
    },
    deleteImage: async (filename: string) => {
      const res = await fetch(`${API_BASE}/projects/images/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      if (!res.ok) throw new Error('Failed to delete image');
      return res.json();
    },
  },
  books: {
    create: async (title: string) => {
      // Create via Chat Tool or dedicated endpoint?
      // Since I didn't add a dedicated REST endpoint in api/projects.py, I should add one OR use the chat tool.
      // But using Chat Tool from GUI is weird.
      // Let's assume I WILL add the endpoint in api/projects.py now because it's cleaner.
      const res = await fetch(`${API_BASE}/books/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('Failed to create book');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_BASE}/books/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: id }),
      });
      if (!res.ok) throw new Error('Failed to delete book');
      return res.json();
    },
    uploadImage: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE}/projects/images/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Failed to upload image');
      return res.json();
    },
    listImages: async () => {
      const res = await fetch(`${API_BASE}/projects/images/list`);
      if (!res.ok) throw new Error('Failed to list images');
      return res.json();
    },
    deleteImage: async (filename: string) => {
      const res = await fetch(`${API_BASE}/projects/images/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      if (!res.ok) throw new Error('Failed to delete image');
      return res.json();
    },
    reorder: async (bookIds: string[]) => {
      const res = await fetch(`${API_BASE}/books/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_ids: bookIds }),
      });
      if (!res.ok) throw new Error('Failed to reorder books');
      return res.json();
    },
    updateBookMetadata: async (
      bookId: string,
      data: {
        title?: string;
        summary?: string;
        notes?: string;
        private_notes?: string;
      }
    ) => {
      const res = await fetch(`${API_BASE}/books/${bookId}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update book metadata');
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
    create: async (title: string, content: string = '', book_id?: string) => {
      const res = await fetch(`${API_BASE}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, book_id }),
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
    updateMetadata: async (
      id: number,
      data: {
        summary?: string;
        notes?: string;
        private_notes?: string;
        conflicts?: any[];
      }
    ) => {
      const res = await fetch(`${API_BASE}/chapters/${id}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update chapter metadata');
      return res.json();
    },
    delete: async (id: number) => {
      const res = await fetch(`${API_BASE}/chapters/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete chapter');
      return res.json();
    },
    reorder: async (chapterIds: number[], bookId?: string) => {
      const res = await fetch(`${API_BASE}/chapters/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          bookId
            ? { book_id: bookId, chapter_ids: chapterIds }
            : { chapter_ids: chapterIds }
        ),
      });
      if (!res.ok) throw new Error('Failed to reorder chapters');
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
    updateSettings: async (settings: {
      image_style?: string;
      image_additional_info?: string;
    }) => {
      const res = await fetch(`${API_BASE}/story/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Failed to update story settings');
      return res.json();
    },
    updateMetadata: async (data: {
      title?: string;
      summary?: string;
      tags?: string[];
      notes?: string;
      private_notes?: string;
    }) => {
      const res = await fetch(`${API_BASE}/story/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update story metadata');
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
    list: async () => {
      const res = await fetch(`${API_BASE}/chats`);
      if (!res.ok) throw new Error('Failed to list chats');
      return res.json();
    },
    load: async (id: string) => {
      const res = await fetch(`${API_BASE}/chats/${id}`);
      if (!res.ok) throw new Error('Failed to load chat');
      return res.json();
    },
    save: async (id: string, data: any) => {
      const res = await fetch(`${API_BASE}/chats/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to save chat');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_BASE}/chats/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete chat');
      return res.json();
    },
    deleteAll: async () => {
      const res = await fetch(`${API_BASE}/chats`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete all chats');
      return res.json();
    },
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
  sourcebook: {
    list: async () => {
      const res = await fetch(`${API_BASE}/sourcebook`);
      if (!res.ok) throw new Error('Failed to load sourcebook');
      return res.json();
    },
    create: async (entry: any) => {
      const res = await fetch(`${API_BASE}/sourcebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (!res.ok) throw new Error('Failed to create entry');
      return res.json();
    },
    update: async (id: string, updates: any) => {
      const res = await fetch(`${API_BASE}/sourcebook/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update entry');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_BASE}/sourcebook/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete entry');
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
