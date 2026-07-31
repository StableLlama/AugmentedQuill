// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines chat API client tests so frontend/backend endpoint contracts stay explicit and verifiable.
 */

import { describe, expect, it, vi } from 'vitest';

import { chatApi } from './chat';
import { fetchJson, postJson, deleteJson } from './shared';
import { registerSharedApiMockCleanup } from './testSharedMocks';

vi.mock('./shared', () => ({
  projectEndpoint: vi.fn((projectName: string, path: string) => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (!projectName) return normalizedPath;
    return `/projects/${encodeURIComponent(projectName)}${normalizedPath}`;
  }),
  fetchJson: vi.fn(),
  postJson: vi.fn(),
  deleteJson: vi.fn(),
}));
registerSharedApiMockCleanup();

describe('chatApi', () => {
  it('calls GET /chats', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce([]);

    await chatApi.list();

    expect(fetchJson).toHaveBeenCalledWith('/chats', undefined, 'Failed to list chats');
  });

  it('calls GET /chats/{id}', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ id: 'c1' });

    await chatApi.load('c1');

    expect(fetchJson).toHaveBeenCalledWith(
      '/chats/c1',
      undefined,
      'Failed to load chat'
    );
  });

  it('calls POST /chats/{id}', async () => {
    vi.mocked(postJson).mockResolvedValueOnce({ ok: true });

    const payload = {
      name: 'Session',
      messages: [],
      systemPrompt: 'Prompt',
      allowWebSearch: true,
      projectContextRevision: 12,
    };

    await chatApi.save('c1', payload);

    expect(postJson).toHaveBeenCalledWith('/chats/c1', payload, 'Failed to save chat');
  });

  it('calls DELETE /chats/{id}', async () => {
    vi.mocked(deleteJson).mockResolvedValueOnce({ ok: true });

    await chatApi.delete('c1');

    expect(deleteJson).toHaveBeenCalledWith('/chats/c1', 'Failed to delete chat');
  });

  it('calls DELETE /chats', async () => {
    vi.mocked(deleteJson).mockResolvedValueOnce({ ok: true });

    await chatApi.deleteAll();

    expect(deleteJson).toHaveBeenCalledWith('/chats', 'Failed to delete all chats');
  });

  it('calls POST /chat/tools', async () => {
    const payload = {
      messages: [
        {
          role: 'assistant' as const,
          content: 'hello',
          tool_calls: [],
        },
      ],
      active_chapter_id: 1,
      model_name: 'demo-model',
    };

    const encoder = new TextEncoder();
    const resultChunk = encoder.encode(
      'data: {"type":"result","ok":true,"appended_messages":[]}\n\n'
    );
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: resultChunk })
      .mockResolvedValueOnce({ done: true, value: undefined });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({ read }),
      },
    } as unknown as Response);

    await chatApi.executeTools(payload);

    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/chat/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    fetchSpy.mockRestore();
  });

  it('isolates consecutive prose streams with distinct stream ids', async () => {
    const payload = {
      messages: [
        {
          role: 'assistant' as const,
          content: 'hello',
          tool_calls: [],
        },
      ],
      active_chapter_id: 1,
      model_name: 'demo-model',
    };

    const encoder = new TextEncoder();
    const firstReadChunk = encoder.encode(
      'data: {"type":"prose_start","chap_id":1,"write_mode":"append"}\n\n' +
        'data: {"type":"prose_chunk","chap_id":1,"write_mode":"append","accumulated":"The darkness might reveal."}\n\n'
    );
    const secondReadChunk = encoder.encode(
      'data: {"type":"prose_start","chap_id":1,"write_mode":"append"}\n\n' +
        'data: {"type":"prose_chunk","chap_id":1,"write_mode":"append","accumulated":"The darkness might reveal more."}\n\n' +
        'data: {"type":"result","ok":true,"appended_messages":[]}\n\n'
    );

    let readIndex = 0;
    const read = vi.fn(async () => {
      readIndex += 1;
      if (readIndex === 1) {
        return { done: false, value: firstReadChunk };
      }
      if (readIndex === 2) {
        await new Promise<void>((resolve: () => void) => setTimeout(resolve, 1));
        return { done: false, value: secondReadChunk };
      }
      return { done: true, value: undefined };
    });

    const onProseChunk = vi.fn();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({ read }),
      },
    } as unknown as Response);

    await chatApi.executeTools(payload, onProseChunk);

    expect(onProseChunk).toHaveBeenNthCalledWith(
      1,
      1,
      'append',
      'The darkness might reveal.',
      1
    );
    expect(onProseChunk).toHaveBeenNthCalledWith(
      2,
      1,
      'append',
      'The darkness might reveal more.',
      2
    );

    fetchSpy.mockRestore();
  });

  it('uses stream id 0 when prose_start is absent', async () => {
    const payload = {
      messages: [
        {
          role: 'assistant' as const,
          content: 'hello',
          tool_calls: [],
        },
      ],
    };

    const encoder = new TextEncoder();
    const resultChunk = encoder.encode(
      'data: {"type":"prose_chunk","chap_id":1,"write_mode":"append","accumulated":"Chunk only."}\n\n' +
        'data: {"type":"result","ok":true,"appended_messages":[]}\n\n'
    );
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: resultChunk })
      .mockResolvedValueOnce({ done: true, value: undefined });

    const onProseChunk = vi.fn();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({ read }),
      },
    } as unknown as Response);

    await chatApi.executeTools(payload, onProseChunk);

    expect(onProseChunk).toHaveBeenCalledWith(1, 'append', 'Chunk only.', 0);

    fetchSpy.mockRestore();
  });
});
