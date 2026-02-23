// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests centralized frontend error notifier behavior.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatError, notifyError } from './errorNotifier';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errorNotifier', () => {
  it('formats Error instances', () => {
    expect(formatError(new Error('bad'))).toBe('bad');
  });

  it('formats string errors', () => {
    expect(formatError('oops')).toBe('oops');
  });

  it('falls back for unknown errors', () => {
    expect(formatError({ any: 'shape' }, 'fallback')).toBe('fallback');
  });

  it('logs and alerts notification messages', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalAlert = (globalThis as { alert?: (text: string) => void }).alert;
    const alertMock = vi.fn();
    (globalThis as { alert?: (text: string) => void }).alert = alertMock;

    notifyError('message', new Error('trace'));

    expect(errorSpy).toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith('message');
    (globalThis as { alert?: (text: string) => void }).alert = originalAlert;
  });
});
