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
import { fetchJson } from './shared';

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
});
