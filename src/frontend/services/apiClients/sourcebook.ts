// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the sourcebook unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { SourcebookEntry } from '../../types';
import { SourcebookUpsertPayload } from '../apiTypes';
import { fetchJson } from './shared';

export const sourcebookApi = {
  list: async () => {
    return fetchJson<SourcebookEntry[]>(
      '/sourcebook',
      undefined,
      'Failed to load sourcebook'
    );
  },

  create: async (entry: SourcebookUpsertPayload) => {
    return fetchJson<SourcebookEntry>(
      '/sourcebook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      },
      'Failed to create entry'
    );
  },

  update: async (id: string, updates: Partial<SourcebookUpsertPayload>) => {
    return fetchJson<SourcebookEntry>(
      `/sourcebook/${id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      },
      'Failed to update entry'
    );
  },

  delete: async (id: string) => {
    return fetchJson<{ ok: boolean }>(
      `/sourcebook/${id}`,
      { method: 'DELETE' },
      'Failed to delete entry'
    );
  },
};
