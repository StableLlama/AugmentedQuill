// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the chapters unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { Conflict } from '../../types';
import { ChapterDetailResponse, ChapterListResponse } from '../apiTypes';
import { fetchJson } from './shared';

export const chaptersApi = {
  list: async () =>
    fetchJson<ChapterListResponse>('/chapters', undefined, 'Failed to list chapters'),

  get: async (id: number) => {
    return fetchJson<ChapterDetailResponse>(
      `/chapters/${id}`,
      undefined,
      'Failed to get chapter'
    );
  },

  create: async (title: string, content: string = '', book_id?: string) => {
    return fetchJson<{ ok: boolean; id: number; title: string; book_id?: string }>(
      '/chapters',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, book_id }),
      },
      'Failed to create chapter'
    );
  },

  updateContent: async (id: number, content: string) => {
    return fetchJson<{ ok: boolean }>(
      `/chapters/${id}/content`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      },
      'Failed to update chapter content'
    );
  },

  updateTitle: async (id: number, title: string) => {
    return fetchJson<{ ok: boolean }>(
      `/chapters/${id}/title`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      },
      'Failed to update chapter title'
    );
  },

  updateSummary: async (id: number, summary: string) => {
    return fetchJson<{ ok: boolean }>(
      `/chapters/${id}/summary`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      },
      'Failed to update chapter summary'
    );
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
    return fetchJson<{ ok: boolean; id?: number; message?: string }>(
      `/chapters/${id}/metadata`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      'Failed to update chapter metadata'
    );
  },

  delete: async (id: number) => {
    return fetchJson<{ ok: boolean }>(
      `/chapters/${id}`,
      { method: 'DELETE' },
      'Failed to delete chapter'
    );
  },

  reorder: async (chapterIds: number[], bookId?: string) => {
    return fetchJson<{ ok: boolean }>(
      '/chapters/reorder',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          bookId
            ? { book_id: bookId, chapter_ids: chapterIds }
            : { chapter_ids: chapterIds }
        ),
      },
      'Failed to reorder chapters'
    );
  },
};
