// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests app selector helpers used by top-level app orchestration.
 */

import { describe, expect, it } from 'vitest';
import { AppSettings } from '../../types';
import { getErrorMessage, resolveActiveProviderConfigs } from './appSelectors';

const appSettings: AppSettings = {
  providers: [
    {
      id: 'a',
      name: 'A',
      baseUrl: 'http://a',
      apiKey: 'a',
      timeout: 1,
      modelId: 'a-model',
      prompts: { system: '', continuation: '', summary: '' },
    },
    {
      id: 'b',
      name: 'B',
      baseUrl: 'http://b',
      apiKey: 'b',
      timeout: 1,
      modelId: 'b-model',
      prompts: { system: '', continuation: '', summary: '' },
    },
  ],
  activeWritingProviderId: 'b',
  activeChatProviderId: 'a',
  activeEditingProviderId: 'missing',
  editor: {
    fontSize: 16,
    maxWidth: 60,
    brightness: 1,
    contrast: 1,
    theme: 'mixed',
    sidebarWidth: 320,
  },
  sidebarOpen: false,
  activeTab: 'chat',
};

describe('appSelectors', () => {
  it('selects requested providers and falls back for missing ids', () => {
    const resolved = resolveActiveProviderConfigs(appSettings);
    expect(resolved.activeChatConfig.id).toBe('a');
    expect(resolved.activeWritingConfig.id).toBe('b');
    expect(resolved.activeEditingConfig.id).toBe('a');
  });

  it('extracts error message from Error instances', () => {
    expect(getErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('uses fallback for non-error values', () => {
    expect(getErrorMessage({ bad: true }, 'fallback')).toBe('fallback');
  });
});
