// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines tests for chat execution helpers so streaming UI update cadence stays smooth.
 */

import { describe, it, expect } from 'vitest';

import {
  applyScratchpadToolResult,
  buildToolPayload,
  makeMessageUpdater,
  refreshStaleProjectContextHistory,
} from './chatExecutionHelpers';
import { useChatStore } from '../../stores/chatStore';
import { INITIAL_STORY, useStoryStore } from '../../stores/storyStore';
import type { ChatMessage, ChatToolCall } from '../../types';

describe('chatExecutionHelpers streaming cadence', () => {
  it('flushes each incoming stream update immediately', () => {
    let state: ChatMessage[] = [];
    let setCalls = 0;

    const setChatMessages = (
      v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
    ): void => {
      setCalls += 1;
      state = typeof v === 'function' ? v(state) : v;
    };

    const updater = makeMessageUpdater(setChatMessages)('msg-1');

    updater({ text: 'He' });
    expect(setCalls).toBe(1);
    expect(state[0]?.text).toBe('He');

    updater({ text: 'Hello' });
    expect(setCalls).toBe(2);
    expect(state[0]?.text).toBe('Hello');
  });
});

describe('scratchpad tool results', () => {
  it('updates chat scratchpad when write_scratchpad tool is executed', () => {
    useChatStore.setState({
      scratchpad: '',
      isIncognito: false,
      currentChatId: null,
      incognitoSessions: [],
    });

    applyScratchpadToolResult({ content: 'Generated scratchpad text' });

    expect(useChatStore.getState().scratchpad).toBe('Generated scratchpad text');
  });

  it('updates incognito session scratchpad when write_scratchpad tool is executed in incognito', () => {
    const sessionId = 'incognito-1';
    useChatStore.setState({
      scratchpad: '',
      isIncognito: true,
      currentChatId: sessionId,
      incognitoSessions: [
        {
          id: sessionId,
          name: 'Incognito Chat',
          messages: [],
          systemPrompt: '',
          isIncognito: true,
          allowWebSearch: false,
          scratchpad: '',
        },
      ],
    });

    applyScratchpadToolResult({ content: 'Incognito scratchpad' });

    expect(useChatStore.getState().scratchpad).toBe('Incognito scratchpad');
    expect(useChatStore.getState().incognitoSessions[0].scratchpad).toBe(
      'Incognito scratchpad'
    );
  });

  it('supports raw tool args when write_scratchpad tool args are not parsed into an object', () => {
    useChatStore.setState({
      scratchpad: '',
      isIncognito: false,
      currentChatId: null,
      incognitoSessions: [],
    });

    applyScratchpadToolResult({ raw: '{"content":"raw args scratchpad"}' });

    expect(useChatStore.getState().scratchpad).toBe('raw args scratchpad');
  });

  it('falls back to result content when args are absent', () => {
    useChatStore.setState({
      scratchpad: '',
      isIncognito: false,
      currentChatId: null,
      incognitoSessions: [],
    });

    applyScratchpadToolResult(undefined, { content: 'result scratchpad' });

    expect(useChatStore.getState().scratchpad).toBe('result scratchpad');
  });
});

describe('build tool payload', () => {
  it('preserves tool result name and tool_call_id for tool messages', () => {
    const history: ChatMessage[] = [
      {
        id: 'tool-result',
        role: 'tool',
        text: '{"status":"ok"}',
        name: 'manage_scenes',
        tool_call_id: 'call-123',
      },
    ];

    const payload = buildToolPayload(history, null, null);

    expect(payload.messages[0]?.name).toBe('manage_scenes');
    expect(payload.messages[0]?.tool_call_id).toBe('call-123');
    expect(payload.messages[0]?.content).toBe('{"status":"ok"}');
  });
});

describe('project context refresh injection', () => {
  it('replaces stale project tool messages with a synthetic refresh tool payload', () => {
    const history: ChatMessage[] = [
      {
        id: 'assistant-tool',
        role: 'model',
        text: '',
        tool_calls: [
          {
            id: 'call-1',
            name: 'manage_story_core',
            args: { action: 'get_metadata' },
          },
        ],
      },
      {
        id: 'tool-result',
        role: 'tool',
        text: '{"title":"Old"}',
        name: 'manage_story_core',
        tool_call_id: 'call-1',
      },
      { id: 'user-1', role: 'user', text: 'Continue.' },
    ];

    const story = {
      ...INITIAL_STORY,
      id: 'story-1',
      title: 'New title',
      summary: 'Fresh summary',
      lastUpdated: 42,
      chapters: [
        {
          id: '1',
          title: 'Chapter 1',
          summary: 'Chapter summary',
          content: 'Fresh chapter content',
        },
      ],
      currentChapterId: '1',
      sourcebook: [
        {
          id: 'sb-1',
          name: 'Ada',
          description: 'Sourcebook description',
          synonyms: [],
          images: [],
        },
      ],
    };
    useStoryStore.setState({ story });

    const result = refreshStaleProjectContextHistory(
      history,
      story,
      {
        id: '1',
        title: 'Chapter 1',
      },
      1
    );

    expect(result.injected).toBe(true);
    expect(
      result.history.some(
        (message: ChatMessage) => message.name === 'manage_story_core'
      )
    ).toBe(false);

    const refreshAssistant = result.history.find(
      (message: ChatMessage) =>
        message.role === 'model' &&
        message.tool_calls?.some(
          (toolCall: ChatToolCall) => toolCall.name === 'refresh_project_context'
        )
    );
    expect(refreshAssistant).toBeDefined();

    const refreshTool = result.history.find(
      (message: ChatMessage) =>
        message.role === 'tool' && message.name === 'refresh_project_context'
    );
    expect(refreshTool).toBeDefined();
    const refreshArgs =
      refreshAssistant?.tool_calls?.find(
        (toolCall: ChatToolCall) => toolCall.name === 'refresh_project_context'
      )?.args ?? {};
    expect(refreshArgs).toHaveProperty('sections');
    expect(Array.isArray((refreshArgs as { sections?: unknown[] }).sections)).toBe(
      true
    );

    const refreshPayload = JSON.parse(refreshTool?.text ?? '{}') as {
      [section: string]: unknown;
    };
    expect(Object.keys(refreshPayload).length).toBeGreaterThan(0);
    expect(refreshPayload['chapter:1.summary']).toBe('Chapter summary');
    expect(refreshPayload['story.summary']).toBe('Fresh summary');
  });

  it('keeps short-story current_selection compact to avoid metadata duplication', () => {
    const history: ChatMessage[] = [
      {
        id: 'assistant-tool',
        role: 'model',
        text: '',
        tool_calls: [
          {
            id: 'call-1',
            name: 'manage_story_core',
            args: { action: 'get_metadata' },
          },
        ],
      },
      {
        id: 'tool-result',
        role: 'tool',
        text: '{"summary":"Old"}',
        name: 'manage_story_core',
        tool_call_id: 'call-1',
      },
    ];

    const story = {
      ...INITIAL_STORY,
      id: 'story-short',
      projectType: 'short-story' as const,
      title: 'Short story title',
      summary: 'Story summary',
      notes: 'Very long notes text that should not be duplicated in current_selection.',
      lastUpdated: 100,
      draft: {
        id: 'draft-story-short',
        scope: 'story' as const,
        title: 'Short story title',
        summary: 'Story summary',
        content:
          'Very long story content that should not be duplicated in current_selection.',
      },
    };
    useStoryStore.setState({ story });

    const result = refreshStaleProjectContextHistory(history, story, null, 1);
    const refreshTool = result.history.find(
      (message: ChatMessage) =>
        message.role === 'tool' && message.name === 'refresh_project_context'
    );
    const refreshPayload = JSON.parse(refreshTool?.text ?? '{}') as {
      [section: string]: unknown;
    };
    expect(Object.keys(refreshPayload).length).toBeGreaterThan(0);
    expect(refreshPayload['story.notes']).toBe(
      'Very long notes text that should not be duplicated in current_selection.'
    );
    expect(refreshPayload['story.private_notes']).toBeUndefined();
    expect(
      Object.keys(refreshPayload).some((section: string) =>
        section.startsWith('chapter:')
      )
    ).toBe(false);
    expect(JSON.stringify(refreshPayload)).not.toContain('Very long story content');
  });
});
