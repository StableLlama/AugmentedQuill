// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines tests for Chat component behavior.
 */

// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import i18n from '../app/i18n';
import { Chat } from './Chat';
import { ChatScratchpadDialog } from './components/ChatScratchpadDialog';
import { ChatProvider, ChatContextValue } from './ChatContext';
import { LLMConfig } from '../../types';

const mockConfig: LLMConfig = {
  id: 'm1',
  name: 'Test Model',
  baseUrl: 'http://example.invalid',
  apiKey: 'key',
  timeout: 1000,
  modelId: 'm1',
  prompts: { system: '', continuation: '', summary: '' },
};

const defaultContext: ChatContextValue = {
  isChatOpen: true,
  messages: [],
  isLoading: false,
  isModelAvailable: true,
  activeChatConfig: mockConfig,
  systemPrompt: '',
  onSendMessage: vi.fn(),
  onStop: vi.fn(),
  onRegenerate: vi.fn(),
  onEditMessage: vi.fn(),
  onDeleteMessage: vi.fn(),
  onUpdateSystemPrompt: vi.fn(),
  onSwitchProject: vi.fn(),
  currentTheme: 'light' as const,
  sessions: [],
  currentSessionId: null,
  isIncognito: false,
  onSelectSession: vi.fn(),
  onNewSession: vi.fn(),
  onDeleteSession: vi.fn(),
  onDeleteAllSessions: vi.fn(),
  onToggleIncognito: vi.fn(),
  allowWebSearch: false,
  onToggleWebSearch: vi.fn(),
  scratchpad: '',
  onUpdateScratchpad: vi.fn(),
  onDeleteScratchpad: vi.fn(),
  sessionMutations: [],
  onMutationClick: vi.fn(),
  storyLanguage: 'en',
};

const renderWithI18n = (
  contextOverrides: Partial<ChatContextValue> = {}
): ReturnType<typeof render> =>
  render(
    <I18nextProvider i18n={i18n}>
      <ChatProvider value={{ ...defaultContext, ...contextOverrides }}>
        <Chat />
      </ChatProvider>
    </I18nextProvider>
  );

beforeAll(() => {
  const htmlProto = window.HTMLElement.prototype as unknown as {
    scrollTo?: () => void;
  };
  if (!htmlProto.scrollTo) {
    htmlProto.scrollTo = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Chat', () => {
  it('automatically expands active stream thinking and then collapses when stream ends, while user-open persists', () => {
    const messages = [
      {
        id: 'm1',
        role: 'model' as const,
        text: 'Hello',
        thinking: 'first streaming content',
      },
    ];

    const { rerender } = renderWithI18n({ messages, isLoading: true });

    expect(screen.getByText('first streaming content')).toBeTruthy();

    rerender(
      <I18nextProvider i18n={i18n}>
        <ChatProvider value={{ ...defaultContext, messages, isLoading: false }}>
          <Chat />
        </ChatProvider>
      </I18nextProvider>
    );
    expect(screen.queryByText('first streaming content')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Thinking Process/i }));
    expect(screen.getByText('first streaming content')).toBeTruthy();

    rerender(
      <I18nextProvider i18n={i18n}>
        <ChatProvider value={{ ...defaultContext, messages, isLoading: true }}>
          <Chat />
        </ChatProvider>
      </I18nextProvider>
    );
    expect(screen.getByText('first streaming content')).toBeTruthy();

    rerender(
      <I18nextProvider i18n={i18n}>
        <ChatProvider value={{ ...defaultContext, messages, isLoading: false }}>
          <Chat />
        </ChatProvider>
      </I18nextProvider>
    );
    expect(screen.getByText('first streaming content')).toBeTruthy();
  });

  it('does not auto-switch project when loading historical manage_project tool messages', async () => {
    const onSwitchProject = vi.fn();
    const historicalToolMessage = {
      id: 'tool-1',
      role: 'tool' as const,
      name: 'manage_project',
      text: JSON.stringify({
        ok: true,
        message: 'Project created: Back to the Future_ The Chronological Saga',
        project_name: 'Back to the Future_ The Chronological Saga',
      }),
    };

    renderWithI18n({
      isLoading: false,
      messages: [historicalToolMessage],
      onSwitchProject,
    });

    await waitFor(() => {
      expect(onSwitchProject).not.toHaveBeenCalled();
    });
  });

  it('auto-switches project exactly once for live manage_project tool message', async () => {
    const onSwitchProject = vi.fn();
    const liveToolMessage = {
      id: 'tool-2',
      role: 'tool' as const,
      name: 'manage_project',
      text: JSON.stringify({
        ok: true,
        message: 'Project created: Arbor_1',
        project_name: 'Arbor_1',
      }),
    };

    const { rerender } = renderWithI18n({
      isLoading: true,
      messages: [liveToolMessage],
      onSwitchProject,
    });

    await waitFor(() => {
      expect(onSwitchProject).toHaveBeenCalledTimes(1);
      expect(onSwitchProject).toHaveBeenCalledWith('Arbor_1', {
        preserveActiveChatSession: true,
      });
    });

    rerender(
      <I18nextProvider i18n={i18n}>
        <ChatProvider
          value={{
            ...defaultContext,
            isLoading: true,
            messages: [liveToolMessage],
            onSwitchProject,
          }}
        >
          <Chat />
        </ChatProvider>
      </I18nextProvider>
    );

    expect(onSwitchProject).toHaveBeenCalledTimes(1);
  });
});

describe('Chat scratchpad dialog', () => {
  it('opens and saves scratchpad modal content', () => {
    const onUpdateScratchpad = vi.fn();
    const onDeleteScratchpad = vi.fn();

    renderWithI18n({ scratchpad: 'initial', onUpdateScratchpad, onDeleteScratchpad });

    fireEvent.click(screen.getByTitle('Open Scratchpad'));
    expect(screen.getByRole('dialog', { name: /scratchpad/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Save Scratchpad/i }));

    expect(onUpdateScratchpad).toHaveBeenCalledWith('initial');
  });

  it('renders markdown content in the scratchpad editor', async () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const onSave = vi.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <ChatScratchpadDialog
          isOpen
          isLight
          storyLanguage="en"
          scratchpad=""
          onClose={onClose}
          onDelete={onDelete}
          onSave={onSave}
        />
      </I18nextProvider>
    );

    const editor = screen.getByRole('textbox', { name: /scratchpad/i });
    fireEvent.focus(editor);
    fireEvent.input(editor, { target: { textContent: '**bold** _italics_' } });

    await waitFor(() => {
      expect(screen.getByText('bold')).toBeTruthy();
      expect(screen.getByText('italics')).toBeTruthy();
    });
  });

  it('shows scratchpad content when dialog opens after content is loaded', () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const onSave = vi.fn();

    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <ChatScratchpadDialog
          isOpen={false}
          isLight={true}
          storyLanguage="en"
          scratchpad=""
          onClose={onClose}
          onDelete={onDelete}
          onSave={onSave}
        />
      </I18nextProvider>
    );

    rerender(
      <I18nextProvider i18n={i18n}>
        <ChatScratchpadDialog
          isOpen={true}
          isLight={true}
          storyLanguage="en"
          scratchpad="initial"
          onClose={onClose}
          onDelete={onDelete}
          onSave={onSave}
        />
      </I18nextProvider>
    );

    expect(screen.getByText('initial')).toBeTruthy();
  });

  it('renders mutation tags as buttons and invokes click handler', () => {
    const onMutationClick = vi.fn();
    renderWithI18n({
      sessionMutations: [
        { id: 'm1', type: 'chapter', label: 'Updated chapter title', targetId: '1' },
      ],
      onMutationClick,
    });

    const tagButton = screen.getByRole('button', { name: /Updated chapter title/i });
    expect(tagButton.getAttribute('type')).toBe('button');

    fireEvent.click(tagButton);
    expect(onMutationClick).toHaveBeenCalledWith({
      id: 'm1',
      type: 'chapter',
      label: 'Updated chapter title',
      targetId: '1',
    });
  });

  it('renders scene mutation tags and invokes click handler', () => {
    const onMutationClick = vi.fn();
    renderWithI18n({
      sessionMutations: [
        { id: 'm2', type: 'scene', label: 'Scene 4 summary', targetId: '4' },
      ],
      onMutationClick,
    });

    const tagButton = screen.getByRole('button', { name: /Scene 4 summary/i });
    fireEvent.click(tagButton);

    expect(onMutationClick).toHaveBeenCalledWith({
      id: 'm2',
      type: 'scene',
      label: 'Scene 4 summary',
      targetId: '4',
    });
  });

  it('allows file attachments to be added, previewed, and sent', async () => {
    const onSendMessage = vi.fn();
    const file = new File(['story'], 'example.txt', { type: 'text/plain' });

    renderWithI18n({ onSendMessage });

    fireEvent.click(screen.getByRole('button', { name: /Attach files/i }));
    fireEvent.change(screen.getByTestId('chat-attachment-input'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByTitle(/Click to remove example.txt/i)).toBeTruthy();
    });

    const input = screen.getByRole('textbox', { name: /Chat message/i });
    fireEvent.change(input, { target: { value: 'Please review this file' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Message/i }));

    expect(onSendMessage).toHaveBeenCalledWith('Please review this file', [
      expect.objectContaining({ name: 'example.txt' }),
    ]);
  });

  it('allows file attachments to be added by dropping on the message input', async () => {
    const onSendMessage = vi.fn();
    const file = new File(['story'], 'drop-example.txt', { type: 'text/plain' });
    const dataTransfer = {
      files: [file],
      types: ['Files'],
    } as unknown as DataTransfer;

    renderWithI18n({ onSendMessage });

    const input = screen.getByRole('textbox', { name: /Chat message/i });
    fireEvent.drop(input, {
      dataTransfer,
    });

    await waitFor(() => {
      expect(screen.getByTitle(/Click to remove drop-example.txt/i)).toBeTruthy();
    });

    fireEvent.change(input, { target: { value: 'Please handle this dropped file' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Message/i }));

    expect(onSendMessage).toHaveBeenCalledWith('Please handle this dropped file', [
      expect.objectContaining({ name: 'drop-example.txt' }),
    ]);
  });

  it('offers removal when clicking an attachment preview', async () => {
    const file = new File(['story'], 'example.txt', { type: 'text/plain' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithI18n({});

    fireEvent.click(screen.getByRole('button', { name: /Attach files/i }));
    fireEvent.change(screen.getByTestId('chat-attachment-input'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByTitle(/Click to remove example.txt/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle(/Click to remove example.txt/i));
    expect(confirmSpy).toHaveBeenCalledWith('Remove attachment “example.txt”?');

    await waitFor(() => {
      expect(screen.queryByTitle(/Click to remove example.txt/i)).toBeNull();
    });

    confirmSpy.mockRestore();
  });

  it('closes system instruction panel on Escape', () => {
    renderWithI18n({});

    fireEvent.click(screen.getByTitle('Chat Settings'));
    expect(screen.getByText('System Instruction')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('System Instruction')).toBeNull();
  });

  it('shows tool call names in the hidden tool call title', () => {
    renderWithI18n({
      messages: [
        {
          id: 'a1',
          role: 'model' as const,
          text: 'Planning a tool call',
          tool_calls: [{ id: 't1', name: 'search_books', args: { query: 'fantasy' } }],
        },
      ],
    });

    expect(screen.getByText(/1 Tool Call \[search_books\]/i)).toBeTruthy();
  });

  it('shows regenerate button when there is a user message and generation is not active', () => {
    renderWithI18n({
      messages: [{ id: 'u1', role: 'user' as const, text: 'Hello' }],
    });

    expect(
      screen.getByRole('button', { name: /Regenerate last response/i })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Regenerate last response/i }));
    expect(defaultContext.onRegenerate).toHaveBeenCalled();
  });

  it('applies story language to chat inputs and dialog textareas', () => {
    renderWithI18n({ storyLanguage: 'fr' });

    const composer = screen.getByRole('textbox', { name: /Chat message/i });
    expect(composer.getAttribute('lang')).toBe('fr');

    fireEvent.click(screen.getByTitle('Chat Settings'));
    expect(
      screen
        .getByPlaceholderText("Define the AI's persona and rules...")
        .getAttribute('lang')
    ).toBe('fr');

    fireEvent.click(screen.getByTitle('Open Scratchpad'));
    expect(
      screen.getByRole('textbox', { name: /scratchpad/i }).getAttribute('lang')
    ).toBe('fr');
  });
});
