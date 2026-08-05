// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines tests for the ChatMessageItem component.
 */

// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../app/i18n';
import { ChatMessageItem } from './ChatMessageItem';
import type { ChatMessage } from '../../../types';

describe('ChatMessageItem', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders function-call args with distinct JSON key/value styling', () => {
    const message: ChatMessage = {
      id: 'm1',
      role: 'model',
      text: 'Function call executed',
      tool_calls: [
        {
          id: 'c1',
          name: 'update_chapter_metadata',
          args: {
            chap_id: 1,
            notes: 'Line 1',
          },
        },
      ],
    };

    render(
      <I18nextProvider i18n={i18n}>
        <ChatMessageItem
          msg={message}
          isLast={true}
          isLoading={false}
          isLight={true}
          msgUserBg="bg-white"
          msgBotBg="bg-white"
          inputBg="bg-white"
          isEditing={false}
          editContent=""
          anyMessageBeingEdited={false}
          isThinkingExpanded={false}
          isModelAvailable={true}
          chatDisabledReason=""
          storyLanguage="en"
          theme="light"
          onStartEditing={vi.fn()}
          onCancelEdit={vi.fn()}
          onSaveEdit={vi.fn()}
          onSetEditContent={vi.fn()}
          onDeleteMessage={vi.fn()}
          onThinkingToggle={vi.fn()}
        />
      </I18nextProvider>
    );

    const toggleButton = screen.getByRole('button', { name: /Tool Call/i });
    fireEvent.click(toggleButton);

    expect(screen.getByText('"chap_id"')).toBeDefined();
    expect(screen.getByText('"Line 1"')).toBeDefined();
    expect(screen.getByText('"chap_id"').className).toContain('text-sky-400');
    expect(screen.getByText('"Line 1"').className).toContain('text-emerald-400');
  });

  it('renders JSON tool output with highlighting when the tool text is valid JSON', () => {
    const message: ChatMessage = {
      id: 'm2',
      role: 'tool',
      name: 'custom_tool',
      text: JSON.stringify({ status: 'ok', count: 3 }, null, 2),
    };

    render(
      <I18nextProvider i18n={i18n}>
        <ChatMessageItem
          msg={message}
          isLast={true}
          isLoading={false}
          isLight={true}
          msgUserBg="bg-white"
          msgBotBg="bg-white"
          inputBg="bg-white"
          isEditing={false}
          editContent=""
          anyMessageBeingEdited={false}
          isThinkingExpanded={false}
          isModelAvailable={true}
          chatDisabledReason=""
          storyLanguage="en"
          theme="light"
          onStartEditing={vi.fn()}
          onCancelEdit={vi.fn()}
          onSaveEdit={vi.fn()}
          onSetEditContent={vi.fn()}
          onDeleteMessage={vi.fn()}
          onThinkingToggle={vi.fn()}
        />
      </I18nextProvider>
    );

    const toggleButton = screen.getByRole('button', { name: /Tool Result:/i });
    fireEvent.click(toggleButton);

    expect(screen.getByText('"status"')).toBeDefined();
    expect(screen.getByText('"ok"')).toBeDefined();
    expect(screen.getByText('"status"').className).toContain('text-sky-400');
    expect(screen.getByText('"ok"').className).toContain('text-emerald-400');
  });
});
