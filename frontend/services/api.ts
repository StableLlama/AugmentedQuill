// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { ChatSession, Conflict, SourcebookEntry } from '../types';
import {
  MachineConfigResponse,
  ProjectsListResponse,
  ProjectSelectResponse,
  ProjectMutationResponse,
  ChapterListResponse,
  ChapterDetailResponse,
  ChatApiMessage,
  ChatToolExecutionResponse,
  ListImagesResponse,
  DebugLogEntry,
  SourcebookUpsertPayload,
} from './apiTypes';

const API_BASE = '/api';

export const api = {
  machine: {
    get: async () => {
      const res = await fetch(`${API_BASE}/machine`);
      if (!res.ok) throw new Error('Failed to load machine config');
      return res.json() as Promise<MachineConfigResponse>;
    },
    save: async (machine: MachineConfigResponse) => {
      const res = await fetch(`${API_BASE}/machine`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(machine),
      });
      if (!res.ok) throw new Error('Failed to save machine config');
      return res.json() as Promise<{ ok: boolean; detail?: string }>;
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
      return res.json() as Promise<ProjectsListResponse>;
    },
    select: async (name: string) => {
      const res = await fetch(`${API_BASE}/projects/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Failed to select project');
      return res.json() as Promise<ProjectSelectResponse>;
    },
    create: async (name: string, type: 'short-story' | 'novel' | 'series') => {
      const res = await fetch(`${API_BASE}/projects/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type }),
      });
      if (!res.ok) throw new Error('Failed to create project');
      return res.json() as Promise<ProjectMutationResponse>;
    },
    convert: async (new_type: string) => {
      const res = await fetch(`${API_BASE}/projects/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_type }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { detail?: string };
        throw new Error(body.detail || 'Failed to convert project');
      }
      return res.json() as Promise<ProjectMutationResponse>;
    },
    delete: async (name: string) => {
      const res = await fetch(`${API_BASE}/projects/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Failed to delete project');
      return res.json() as Promise<ProjectMutationResponse>;
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
      const data = (await res.json()) as { ok?: boolean; detail?: string };
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
          const err = (await res.json()) as { detail?: string };
          throw new Error(err.detail || 'Failed to import project');
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : 'Failed to import project';
          throw new Error(message);
        }
      }
      return res.json() as Promise<ProjectMutationResponse>;
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
      return res.json() as Promise<{ ok: boolean; filename: string; url: string }>;
    },
    updateImage: async (filename: string, description?: string, title?: string) => {
      const res = await fetch(`${API_BASE}/projects/images/update_description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, description, title }),
      });
      if (!res.ok) throw new Error('Failed to update image metadata');
      return res.json() as Promise<{ ok: boolean }>;
    },
    createImagePlaceholder: async (description: string, title?: string) => {
      const res = await fetch(`${API_BASE}/projects/images/create_placeholder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, title }),
      });
      if (!res.ok) throw new Error('Failed to create placeholder');
      return res.json() as Promise<{ ok: boolean; filename: string }>;
    },
    listImages: async () => {
      const res = await fetch(`${API_BASE}/projects/images/list`);
      if (!res.ok) throw new Error('Failed to list images');
      return res.json() as Promise<ListImagesResponse>;
    },
    deleteImage: async (filename: string) => {
      const res = await fetch(`${API_BASE}/projects/images/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      if (!res.ok) throw new Error('Failed to delete image');
      return res.json() as Promise<{ ok: boolean }>;
    },
  },
  books: {
    create: async (title: string) => {
      const res = await fetch(`${API_BASE}/books/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: title }),
      });
      if (!res.ok) throw new Error('Failed to create book');
      return res.json() as Promise<{ ok: boolean; book_id?: string; story?: unknown }>;
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_BASE}/books/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: id }),
      });
      if (!res.ok) throw new Error('Failed to delete book');
      return res.json() as Promise<{ ok: boolean; story?: unknown }>;
    },
    uploadImage: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE}/projects/images/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Failed to upload image');
      return res.json() as Promise<{ ok: boolean; filename: string; url: string }>;
    },
    listImages: async () => {
      const res = await fetch(`${API_BASE}/projects/images/list`);
      if (!res.ok) throw new Error('Failed to list images');
      return res.json() as Promise<ListImagesResponse>;
    },
    deleteImage: async (filename: string) => {
      const res = await fetch(`${API_BASE}/projects/images/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      if (!res.ok) throw new Error('Failed to delete image');
      return res.json() as Promise<{ ok: boolean }>;
    },
    reorder: async (bookIds: string[]) => {
      const res = await fetch(`${API_BASE}/books/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_ids: bookIds }),
      });
      if (!res.ok) throw new Error('Failed to reorder books');
      return res.json() as Promise<{ ok: boolean }>;
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
      return res.json() as Promise<{ ok: boolean; detail?: string }>;
    },
  },
  chapters: {
    list: async () => {
      const res = await fetch(`${API_BASE}/chapters`);
      if (!res.ok) throw new Error('Failed to list chapters');
      return res.json() as Promise<ChapterListResponse>;
    },
    get: async (id: number) => {
      const res = await fetch(`${API_BASE}/chapters/${id}`);
      if (!res.ok) throw new Error('Failed to get chapter');
      return res.json() as Promise<ChapterDetailResponse>;
    },
    create: async (title: string, content: string = '', book_id?: string) => {
      const res = await fetch(`${API_BASE}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, book_id }),
      });
      if (!res.ok) throw new Error('Failed to create chapter');
      return res.json() as Promise<{
        ok: boolean;
        id: number;
        title: string;
        book_id?: string;
      }>;
    },
    updateContent: async (id: number, content: string) => {
      const res = await fetch(`${API_BASE}/chapters/${id}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error('Failed to update chapter content');
      return res.json() as Promise<{ ok: boolean }>;
    },
    updateTitle: async (id: number, title: string) => {
      const res = await fetch(`${API_BASE}/chapters/${id}/title`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('Failed to update chapter title');
      return res.json() as Promise<{ ok: boolean }>;
    },
    updateSummary: async (id: number, summary: string) => {
      const res = await fetch(`${API_BASE}/chapters/${id}/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      if (!res.ok) throw new Error('Failed to update chapter summary');
      return res.json() as Promise<{ ok: boolean }>;
    },
    updateMetadata: async (
      id: number,
      data: {
        summary?: string;
        notes?: string;
        private_notes?: string;
        conflicts?: Conflict[];
      }
    ) => {
      const res = await fetch(`${API_BASE}/chapters/${id}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update chapter metadata');
      return res.json() as Promise<{ ok: boolean; id?: number; message?: string }>;
    },
    delete: async (id: number) => {
      const res = await fetch(`${API_BASE}/chapters/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete chapter');
      return res.json() as Promise<{ ok: boolean }>;
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
      return res.json() as Promise<{ ok: boolean }>;
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
      return res.json() as Promise<{ ok: boolean; detail?: string }>;
    },
    updateSummary: async (summary: string) => {
      const res = await fetch(`${API_BASE}/story/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      if (!res.ok) throw new Error('Failed to update story summary');
      return res.json() as Promise<{ ok: boolean; summary?: string }>;
    },
    updateTags: async (tags: string[]) => {
      const res = await fetch(`${API_BASE}/story/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) throw new Error('Failed to update story tags');
      return res.json() as Promise<{ ok: boolean }>;
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
      return res.json() as Promise<{ ok: boolean; story?: unknown }>;
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
      return res.json() as Promise<{ ok: boolean; detail?: string }>;
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
      return res.json() as Promise<ChatSession[]>;
    },
    load: async (id: string) => {
      const res = await fetch(`${API_BASE}/chats/${id}`);
      if (!res.ok) throw new Error('Failed to load chat');
      return res.json() as Promise<ChatSession>;
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
      const res = await fetch(`${API_BASE}/chats/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to save chat');
      return res.json() as Promise<{ ok: boolean }>;
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_BASE}/chats/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete chat');
      return res.json() as Promise<{ ok: boolean }>;
    },
    deleteAll: async () => {
      const res = await fetch(`${API_BASE}/chats`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete all chats');
      return res.json() as Promise<{ ok: boolean }>;
    },
    executeTools: async (payload: {
      messages: ChatApiMessage[];
      active_chapter_id?: number;
      model_name?: string;
    }) => {
      const res = await fetch(`${API_BASE}/chat/tools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to execute chat tools');
      return res.json() as Promise<ChatToolExecutionResponse>;
    },
  },
  sourcebook: {
    list: async () => {
      const res = await fetch(`${API_BASE}/sourcebook`);
      if (!res.ok) throw new Error('Failed to load sourcebook');
      return res.json() as Promise<SourcebookEntry[]>;
    },
    create: async (entry: SourcebookUpsertPayload) => {
      const res = await fetch(`${API_BASE}/sourcebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (!res.ok) throw new Error('Failed to create entry');
      return res.json() as Promise<SourcebookEntry>;
    },
    update: async (id: string, updates: Partial<SourcebookUpsertPayload>) => {
      const res = await fetch(`${API_BASE}/sourcebook/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update entry');
      return res.json() as Promise<SourcebookEntry>;
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_BASE}/sourcebook/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete entry');
      return res.json() as Promise<{ ok: boolean }>;
    },
  },
  debug: {
    getLogs: async () => {
      const res = await fetch(`${API_BASE}/debug/llm_logs`);
      if (!res.ok) throw new Error('Failed to fetch debug logs');
      return res.json() as Promise<DebugLogEntry[]>;
    },
    clearLogs: async () => {
      const res = await fetch(`${API_BASE}/debug/llm_logs`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to clear debug logs');
      return res.json() as Promise<{ status: string }>;
    },
  },
};
