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
