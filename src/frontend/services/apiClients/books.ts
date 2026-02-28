// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the books unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { fetchJson, postJson } from './shared';

export const booksApi = {
  create: async (title: string) => {
    return postJson<{ ok: boolean; book_id?: string; story?: unknown }>(
      '/books/create',
      { name: title },
      'Failed to create book'
    );
  },

  delete: async (id: string) => {
    return postJson<{ ok: boolean; story?: unknown }>(
      '/books/delete',
      { name: id },
      'Failed to delete book'
    );
  },

  reorder: async (bookIds: string[]) => {
    return postJson<{ ok: boolean }>(
      '/books/reorder',
      { book_ids: bookIds },
      'Failed to reorder books'
    );
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
    return postJson<{ ok: boolean; detail?: string }>(
      `/books/${bookId}/metadata`,
      data,
      'Failed to update book metadata'
    );
  },
};
