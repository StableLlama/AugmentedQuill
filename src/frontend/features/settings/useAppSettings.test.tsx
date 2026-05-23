// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Verify app settings sync uses browser default when GUI language is empty.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import i18n from '../app/i18n';
import { api } from '../../services/api';
import { useAppSettings } from './useAppSettings';
import { AppSettings } from '../../types';

const baseSettings: AppSettings = {
  providers: [
    {
      id: 'default',
      name: 'Default',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'key',
      timeout: 30,
      modelId: 'gpt-4o',
      temperature: 0.7,
      topP: 0.95,
      maxTokens: 16384,
      presencePenalty: 0,
      frequencyPenalty: 0,
      stop: [],
      seed: undefined,
      topK: undefined,
      minP: undefined,
      extraBody: '',
      presetId: undefined,
      writingWarning: undefined,
      isMultimodal: false,
      supportsFunctionCalling: false,
      prompts: {},
    },
  ],
  activeWritingProviderId: 'default',
  activeEditingProviderId: 'default',
  activeChatProviderId: 'default',
  editor: { theme: 'light', fontSize: 16, lineHeight: 1.4, maxWidth: 80 },
  sidebarOpen: true,
  activeTab: 'editor',
};

let storage: Record<string, string>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key in storage ? storage[key] : null),
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      storage = {};
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAppSettings', () => {
  it('reverts blank GUI language to the browser default', async () => {
    localStorage.setItem(
      'augmentedquill_settings',
      JSON.stringify({ guiLanguage: '' })
    );
    const changeSpy = vi.spyOn(i18n, 'changeLanguage');
    vi.spyOn(api.machine, 'get').mockResolvedValue({});

    await act(async () => {
      await i18n.changeLanguage('de');
    });

    const TestComponent = (): JSX.Element | null => {
      useAppSettings(baseSettings);
      return null;
    };

    render(<TestComponent />);

    await waitFor(() => {
      expect(changeSpy).toHaveBeenCalledWith('en');
    });
  });
});
