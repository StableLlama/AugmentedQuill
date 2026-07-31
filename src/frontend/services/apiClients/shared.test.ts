// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the shared.test unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchJson, deleteJson, patchJson } from './shared';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchJson', () => {
  it('returns parsed JSON for successful responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, value: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const data = await fetchJson<{ ok: boolean; value: number }>(
      '/health',
      undefined,
      'fallback'
    );

    expect(data.ok).toBe(true);
    expect(data.value).toBe(42);
  });

  it('throws detail when backend returns structured error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'bad request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(fetchJson('/broken', undefined, 'fallback')).rejects.toThrow(
      'bad request'
    );
  });

  it('stringifies non-string detail bodies for errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: { msg: 'bad request' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(fetchJson('/broken', undefined, 'fallback')).rejects.toThrow(
      '{"msg":"bad request"}'
    );
  });
});

describe('deleteJson', () => {
  it('resolves with undefined for 204 No Content responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    );

    const result = await deleteJson('/item/1', 'fallback');

    expect(result).toBeUndefined();
  });

  it('resolves with undefined for empty 200 body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

    const result = await deleteJson('/item/1', 'fallback');

    expect(result).toBeUndefined();
  });

  it('parses JSON body when server returns a 200 with content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await deleteJson<{ ok: boolean }>('/item/1', 'fallback');

    expect(result).toEqual({ ok: true });
  });

  it('throws the detail message on a 4xx error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(deleteJson('/item/99', 'fallback error')).rejects.toThrow('not found');
  });

  it('falls back to the provided error message when the error body is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));

    await expect(deleteJson('/item/1', 'delete failed')).rejects.toThrow(
      'delete failed'
    );
  });
});

describe('patchJson', () => {
  it('sends a PATCH request with a JSON body and returns parsed response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await patchJson<{ updated: boolean }>(
      '/item/1',
      { text: 'new' },
      'fallback'
    );

    expect(result).toEqual({ updated: true });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body as string)).toEqual({ text: 'new' });
  });

  it('throws the detail message on a 4xx error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'scene not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(patchJson('/item/1', {}, 'update failed')).rejects.toThrow(
      'scene not found'
    );
  });

  it('falls back to the provided error message when the error body is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 422 }));

    await expect(patchJson('/item/1', {}, 'patch failed')).rejects.toThrow(
      'patch failed'
    );
  });
});
