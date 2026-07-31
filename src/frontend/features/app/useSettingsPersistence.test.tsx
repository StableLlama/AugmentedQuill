// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Verify the settings persistence hook saves machine config and updates app state.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, render } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

import { api } from '../../services/api';
import { useSettingsPersistence } from './useSettingsPersistence';
import { AppSettings } from '../../types';

const mockAppSettings: AppSettings = {
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

describe('useSettingsPersistence', () => {
  it('saves machine config and updates app state', async () => {
    const saveSpy = vi.spyOn(api.machine, 'save').mockResolvedValue(undefined);
    const setAppSettings = vi.fn();
    const pushExternalHistoryEntry = vi.fn();
    const refreshHealth = vi.fn();

    let handleSaveSettings: ((settings: AppSettings) => Promise<void>) | null = null;

    const TestComponent = (): JSX.Element | null => {
      const hook = useSettingsPersistence({
        appSettings: mockAppSettings,
        setAppSettings,
        pushExternalHistoryEntry,
        refreshHealth,
      });
      handleSaveSettings = hook.handleSaveSettings;
      return null;
    };

    render(<TestComponent />);

    const nextSettings: AppSettings = {
      ...mockAppSettings,
      activeChatProviderId: 'default',
    };

    await act(async () => {
      await handleSaveSettings?.(nextSettings);
    });

    expect(saveSpy).toHaveBeenCalled();
    expect(setAppSettings).toHaveBeenCalledWith(nextSettings);
    expect(refreshHealth).toHaveBeenCalled();
    expect(pushExternalHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Update machine settings',
      })
    );
  });
});
