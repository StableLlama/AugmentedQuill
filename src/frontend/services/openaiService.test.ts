// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the openai service.test unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createChatSession,
  generateContinuations,
  parseToolArguments,
} from './openaiService';
import type { LLMConfig } from '../types';

describe('openaiService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('includes checkedSourcebookIds in request body when provided', async () => {
    const fakeReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: new Uint8Array() }),
    };
    const fakeBody = {
      getReader: () => fakeReader,
    };

    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: fakeBody });

    const cfg: LLMConfig = { id: 'x', name: 'x', baseUrl: '', apiKey: '', timeout: 5 };

    await generateContinuations('text', 'ctx', 'sys', cfg, '1', ['A', 'B']);

    expect(global.fetch).toHaveBeenCalled();
    const callArgs = (global.fetch as vi.Mock).mock.calls[0];
    const options = callArgs[1];
    const body = JSON.parse(options.body);
    expect(body.checked_sourcebook).toEqual(['A', 'B']);
  });

  it('includes suggestion mode in suggest request body', async () => {
    const fakeReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: new Uint8Array() }),
    };
    const fakeBody = {
      getReader: () => fakeReader,
    };

    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: fakeBody });

    const cfg: LLMConfig = { id: 'x', name: 'x', baseUrl: '', apiKey: '', timeout: 5 };

    await generateContinuations('text', 'ctx', 'sys', cfg, '1', undefined, {
      suggestionMode: 'pure',
    });

    const callArgs = (global.fetch as vi.Mock).mock.calls[0];
    const options = callArgs[1];
    const body = JSON.parse(options.body);
    expect(body.mode).toBe('pure');
  });

  it('includes checkedSourcebookIds in streamAiAction request body when provided', async () => {
    const fakeReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: new Uint8Array() }),
    };
    const fakeBody = {
      getReader: () => fakeReader,
    };

    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: fakeBody });

    // This call is intended to exercise streamAiAction; we only care about the request payload.
    await (
      await import('./openaiService')
    ).streamAiAction(
      'chapter',
      'extend',
      '1',
      'text',
      undefined,
      undefined,
      undefined,
      ['A', 'B']
    );

    expect(global.fetch).toHaveBeenCalled();
    const callArgs = (global.fetch as vi.Mock).mock.calls[0];
    const options = callArgs[1];
    const body = JSON.parse(options.body);
    expect(body.checked_sourcebook).toEqual(['A', 'B']);
  });

  it('repairs tool argument JSON with raw newlines', () => {
    const raw = '{"chap_id":1,"notes":"line1\nline2"}';
    const result = parseToolArguments(raw);
    expect(result).toEqual({ chap_id: 1, notes: 'line1\nline2' });
  });

  it('preserves streamed paragraph content and newlines', async () => {
    const events = [
      { content: '\n\n' },
      { content: 'Visible prose.' },
      { content: ' Continued.' },
    ]
      .map((evt: { content: string }) => `data: ${JSON.stringify(evt)}\n\n`)
      .join('')
      .concat('data: [DONE]\n\n');

    const encoder = new TextEncoder();
    const fakeReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode(events) })
        .mockResolvedValueOnce({ done: true, value: new Uint8Array() }),
    };
    const fakeBody = {
      getReader: () => fakeReader,
    };

    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: fakeBody });

    const svc = await import('./openaiService');
    const result = await svc.streamAiAction('chapter', 'rewrite', '1', 'draft');

    expect(result).toBe('\n\nVisible prose. Continued.');
  });

  it('captures server-provided usage and exposes it on the chat result', async () => {
    const events = [
      { content: 'Hello' },
      { usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 } },
    ]
      .map((evt: Record<string, unknown>) => `data: ${JSON.stringify(evt)}\n\n`)
      .join('')
      .concat('data: [DONE]\n\n');

    const encoder = new TextEncoder();
    const fakeReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode(events) })
        .mockResolvedValueOnce({ done: true, value: new Uint8Array() }),
    };
    const fakeBody = {
      getReader: () => fakeReader,
    };

    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: fakeBody });

    const cfg: LLMConfig = {
      id: 'x',
      name: 'x',
      baseUrl: '',
      apiKey: '',
      timeout: 5,
      modelId: 'gpt-4o',
      contextWindowTokens: 4096,
      maxTokens: 1024,
      prompts: { system: '', continuation: '', summary: '' },
    };

    const session = createChatSession('system', [], cfg);
    const result = await session.sendMessage('Hi');

    expect(result.text).toBe('Hello');
    expect(result.serverUsage).toEqual({
      prompt_tokens: 42,
      completion_tokens: 8,
      total_tokens: 50,
    });
  });
});
