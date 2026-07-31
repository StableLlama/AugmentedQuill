// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Verifies Chapter AI button disable behavior when the active chapter is empty.
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { HeaderCenterControls } from './HeaderCenterControls';
import type { AppSettings } from '../../types';

describe('HeaderCenterControls', () => {
  const noop = vi.fn();
  const baseProps = {
    viewControls: {
      viewMode: 'page',
      setViewMode: noop,
      showWhitespace: false,
      setShowWhitespace: noop,
      isViewMenuOpen: false,
      setIsViewMenuOpen: noop,
    },
    formatControls: {
      handleFormat: noop,
      getFormatButtonClass: () => '',
      isFormatMenuOpen: false,
      setIsFormatMenuOpen: noop,
      isMobileFormatMenuOpen: false,
      setIsMobileFormatMenuOpen: noop,
      onOpenImages: noop,
    },
    modelControls: {
      appSettings: {
        providers: [
          {
            id: 'default',
            name: 'Default',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
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
            presetId: null,
            prompts: { system: '', continuation: '', summary: '' },
          },
        ],
        activeWritingProviderId: 'default',
        activeEditingProviderId: 'default',
        activeChatProviderId: 'default',
        editor: { theme: 'light', fontSize: 16, lineHeight: 1.4, maxWidth: 80 },
        sidebarOpen: true,
        activeTab: 'editor',
      } as unknown as AppSettings,
      setAppSettings: noop,
      modelConnectionStatus: { default: 'success' },
      detectedCapabilities: {
        default: { is_multimodal: false, supports_function_calling: false },
      },
      recheckUnavailableProviderIfStale: noop,
    },
    themeTokens: {
      isLight: true,
      iconColor: '',
      iconHover: '',
      dividerColor: '',
      buttonActive: '',
      currentTheme: 'light',
    },
  };

  it('disables rewrite but enables extend when chapter is empty', () => {
    render(
      <HeaderCenterControls
        {...baseProps}
        aiControls={{
          handleAiAction: noop,
          isAiActionLoading: false,
          isWritingAvailable: true,
          isChapterEmpty: true,
        }}
      />
    );

    const extendButton = screen.getByTitle('Extend Chapter (WRITING model)');
    const rewriteButton = screen.getByTitle(
      'Chapter is empty; cannot rewrite existing text.'
    );

    expect(extendButton).toBeInstanceOf(HTMLButtonElement);
    expect((extendButton as HTMLButtonElement).disabled).toBe(false);

    expect(rewriteButton).toBeInstanceOf(HTMLButtonElement);
    expect((rewriteButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables chapter Extend/Rewrite when chapter has text and writing model is available', () => {
    render(
      <HeaderCenterControls
        {...baseProps}
        aiControls={{
          handleAiAction: noop,
          isAiActionLoading: false,
          isWritingAvailable: true,
          isChapterEmpty: false,
        }}
      />
    );

    const extendButtons = screen.getAllByTitle('Extend Chapter (WRITING model)');
    const rewriteButtons = screen.getAllByTitle('Rewrite Chapter (WRITING model)');

    expect(extendButtons.length).toBeGreaterThan(0);
    extendButtons.forEach((btn: HTMLElement) => {
      expect(btn).toBeInstanceOf(HTMLButtonElement);
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });

    expect(rewriteButtons.length).toBeGreaterThan(0);
    rewriteButtons.forEach((btn: HTMLElement) => {
      expect(btn).toBeInstanceOf(HTMLButtonElement);
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
