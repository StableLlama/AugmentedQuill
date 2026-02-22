// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the story unit so this responsibility stays isolated, testable, and easy to evolve.

import { fetchJson } from './shared';

export const storyApi = {
  updateTitle: async (title: string) => {
    return fetchJson<{ ok: boolean; detail?: string }>(
      '/story/title',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      },
      'Failed to update story title'
    );
  },

  updateSummary: async (summary: string) => {
    return fetchJson<{ ok: boolean; summary?: string }>(
      '/story/summary',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      },
      'Failed to update story summary'
    );
  },

  updateTags: async (tags: string[]) => {
    return fetchJson<{ ok: boolean }>(
      '/story/tags',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      },
      'Failed to update story tags'
    );
  },

  updateSettings: async (settings: {
    image_style?: string;
    image_additional_info?: string;
  }) => {
    return fetchJson<{ ok: boolean; story?: unknown }>(
      '/story/settings',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      },
      'Failed to update story settings'
    );
  },

  updateMetadata: async (data: {
    title?: string;
    summary?: string;
    tags?: string[];
    notes?: string;
    private_notes?: string;
  }) => {
    return fetchJson<{ ok: boolean; detail?: string }>(
      '/story/metadata',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      'Failed to update story metadata'
    );
  },
};
