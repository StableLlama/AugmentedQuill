// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for the scenes API client endpoint mappings.
 */

import { describe, expect, it, vi } from 'vitest';
import { createScenesApi } from './scenes';
import { fetchJson, postJson, putJson, patchJson, deleteJson } from './shared';
import { registerSharedApiMockCleanup } from './testSharedMocks';

vi.mock('./shared', () => ({
  projectEndpoint: vi.fn((projectName: string, path: string) => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (!projectName) return normalizedPath;
    return `/projects/${encodeURIComponent(projectName)}${normalizedPath}`;
  }),
  fetchJson: vi.fn(),
  postJson: vi.fn(),
  putJson: vi.fn(),
  patchJson: vi.fn(),
  deleteJson: vi.fn(),
}));
registerSharedApiMockCleanup();

const PROJECT = 'my-story';
const api = createScenesApi(PROJECT);
const BASE = `/projects/${PROJECT}/scenes`;

const stubScene = (): {
  id: number;
  summary: string;
  beats: never[];
  prose_link: null;
  active_characters: never[];
  passive_characters: never[];
  pinboard_x: number;
  pinboard_y: number;
  causes: never[];
} => ({
  id: 1,
  summary: 'A scene',
  beats: [],
  prose_link: null,
  active_characters: [],
  passive_characters: [],
  pinboard_x: 0,
  pinboard_y: 0,
  causes: [],
});

describe('createScenesApi basic CRUD', () => {
  it('list calls GET /scenes', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce([stubScene()]);
    const result = await api.list();
    expect(fetchJson).toHaveBeenCalledWith(BASE, undefined, 'Failed to load scenes');
    expect(result).toHaveLength(1);
  });

  it('create calls POST /scenes', async () => {
    vi.mocked(postJson).mockResolvedValueOnce(stubScene());
    await api.create({ summary: 'New scene' });
    expect(postJson).toHaveBeenCalledWith(
      BASE,
      { summary: 'New scene' },
      'Failed to create scene'
    );
  });

  it('get calls GET /scenes/{id}', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(stubScene());
    await api.get(1);
    expect(fetchJson).toHaveBeenCalledWith(
      `${BASE}/1`,
      undefined,
      'Failed to load scene'
    );
  });

  it('update calls PUT /scenes/{id}', async () => {
    vi.mocked(putJson).mockResolvedValueOnce(stubScene());
    await api.update(1, { summary: 'Updated' });
    expect(putJson).toHaveBeenCalledWith(
      `${BASE}/1`,
      { summary: 'Updated' },
      'Failed to update scene'
    );
  });

  it('delete calls DELETE /scenes/{id}', async () => {
    vi.mocked(deleteJson).mockResolvedValueOnce(undefined);
    await api.delete(1);
    expect(deleteJson).toHaveBeenCalledWith(`${BASE}/1`, 'Failed to delete scene');
  });
});

describe('createScenesApi prose linking', () => {
  it('linkProse calls POST /scenes/{id}/link-prose', async () => {
    vi.mocked(postJson).mockResolvedValueOnce([stubScene()]);
    await api.linkProse(1, {
      scope_type: 'story',
      start_offset: 0,
      end_offset: 10,
    });
    expect(postJson).toHaveBeenCalledWith(
      `${BASE}/1/link-prose`,
      { scope_type: 'story', start_offset: 0, end_offset: 10 },
      'Failed to link prose'
    );
  });

  it('unlinkProse calls POST /scenes/{id}/unlink-prose', async () => {
    vi.mocked(postJson).mockResolvedValueOnce([stubScene()]);
    await api.unlinkProse(1);
    expect(postJson).toHaveBeenCalledWith(
      `${BASE}/1/unlink-prose`,
      {},
      'Failed to unlink prose'
    );
  });

  it('reorderProse calls POST /scenes/reorder-prose', async () => {
    vi.mocked(postJson).mockResolvedValueOnce({
      scenes: [stubScene()],
      scope_type: 'story',
      scope_start: 0,
      scope_end: 1,
      rebuilt_text: 'x',
    });
    await api.reorderProse({
      source_scene_id: 1,
      target_scene_id: 2,
      place_before: true,
    });
    expect(postJson).toHaveBeenCalledWith(
      `${BASE}/reorder-prose`,
      { source_scene_id: 1, target_scene_id: 2, place_before: true },
      'Failed to reorder prose'
    );
  });

  it('updateProseContent calls PATCH /scenes/{id}/prose-content', async () => {
    vi.mocked(patchJson).mockResolvedValueOnce(stubScene());
    await api.updateProseContent(1, 'Hello world');
    expect(patchJson).toHaveBeenCalledWith(
      `${BASE}/1/prose-content`,
      { text: 'Hello world' },
      'Failed to update prose content'
    );
  });
});
