// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests that the Edit Scene dialog supplies dark-surface highlight colour
 * tokens to its CodeMirror editors when rendered on the dark chrome
 * (dark/mixed themes) and light-surface tokens in the light theme.
 *
 * Without this, the dialog's inline diff red/green highlights keep the
 * light-paper defaults and are hard to read against the dark dialog
 * background in dark/mixed mode.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, vi, afterEach } from 'vitest';
import i18n from '../app/i18n';
import { SceneEditorDialog } from './SceneEditorDialog';
import type { Scene, SceneId } from '../../types';
import type { Chapter, Book } from '../../types/domain';

// Shared hoisted state so vi.mock factories can read/write test values.
const capturedProps = vi.hoisted(() => ({
  last: null as Record<string, unknown> | null,
}));
const themeState = vi.hoisted(() => ({ isLight: false }));
const projectTypeState = vi.hoisted(() => ({
  value: 'novel' as 'short-story' | 'novel' | 'series',
}));

vi.mock('../editor/CodeMirrorEditor', () => ({
  CodeMirrorEditor: (props: Record<string, unknown>): React.ReactElement => {
    capturedProps.last = props;
    return <div data-testid="cm-editor" />;
  },
}));

vi.mock('../../stores/storyStore', () => ({
  useScenes: vi.fn(() => [] as Scene[]),
  useStoryLanguage: vi.fn(() => 'en'),
  useStoryMeta: vi.fn(() => ({ projectType: projectTypeState.value })),
  useStoryChaptersListMeta: vi.fn(() => [] as Chapter[]),
  useStoryBooks: vi.fn(() => [] as Book[]),
  useStoryStore: vi.fn(
    (
      selector: (state: {
        story: { sourcebook: unknown[] };
        baselineState: { scenes: Scene[] };
      }) => unknown
    ) =>
      selector({
        story: { sourcebook: [] },
        baselineState: { scenes: [] },
      })
  ),
}));

vi.mock('../layout/ThemeContext', () => ({
  useThemeClasses: () => ({
    isLight: themeState.isLight,
    bg: '',
    text: '',
    border: '',
    muted: '',
    input: '',
  }),
  useTheme: () => ({
    currentTheme: themeState.isLight ? 'light' : 'dark',
  }),
}));

const wrap = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

function makeScene(overrides: Record<string, unknown> = {}): Scene {
  const legacy = overrides as { causes?: SceneId[]; [key: string]: unknown };
  const { causes = [], ...rest } = legacy;
  return {
    id: 'scene-1',
    summary: 'Test scene',
    beats: [],
    prose_link: null,
    active_characters: [],
    passive_characters: [],
    sourcebook_entry_ids: [],
    scene_time: null,
    location: null,
    time: null,
    color_tag: null,
    status: 'active',
    pinboard_x: 0,
    pinboard_y: 0,
    causes: [...causes],
    ...rest,
  } as Scene;
}

const NOOP = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  capturedProps.last = null;
  themeState.isLight = false;
  projectTypeState.value = 'novel';
});

describe('SceneEditorDialog theme-aware diff colours', () => {
  it('passes dark-surface highlight colours in dark/mixed chrome', () => {
    themeState.isLight = false;

    wrap(
      <SceneEditorDialog
        scene={makeScene()}
        isOpen
        onClose={NOOP}
        onSave={NOOP}
        onDelete={NOOP}
      />
    );

    expect(capturedProps.last).toBeTruthy();
    const colors = capturedProps.last?.highlightColors as
      Record<string, string> | undefined;
    expect(colors).toBeTruthy();
    expect(colors?.diffInsertBg).toBe('rgba(34, 197, 94, 0.22)');
    expect(colors?.diffInsertBorder).toBe('rgba(74, 222, 128, 0.55)');
    expect(colors?.diffDeleteBg).toBe('rgba(239, 68, 68, 0.22)');
    expect(colors?.diffDeleteBorder).toBe('rgba(248, 113, 113, 0.55)');
  });

  it('passes light-surface highlight colours in the light theme', () => {
    themeState.isLight = true;

    wrap(
      <SceneEditorDialog
        scene={makeScene()}
        isOpen
        onClose={NOOP}
        onSave={NOOP}
        onDelete={NOOP}
      />
    );

    expect(capturedProps.last).toBeTruthy();
    const colors = capturedProps.last?.highlightColors as
      Record<string, string> | undefined;
    expect(colors).toBeTruthy();
    expect(colors?.diffInsertBg).toBe('rgba(34, 197, 94, 0.14)');
    expect(colors?.diffInsertBorder).toBe('rgba(34, 197, 94, 0.45)');
  });
});
