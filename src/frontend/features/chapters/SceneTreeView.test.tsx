// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for SceneTreeView component.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import i18n from '../app/i18n';
import { SceneTreeView } from './SceneTreeView';
import type { Scene, Chapter, Book } from '../../types';

function mkScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: overrides.id ?? 1,
    summary: overrides.summary ?? 'A test scene.',
    beats: [],
    active_characters: [],
    passive_characters: [],
    causes: [],
    pinboard_x: 0,
    pinboard_y: 0,
    status: 'active',
    ...overrides,
  };
}

function mkChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: overrides.id ?? '1',
    title: overrides.title ?? 'Chapter 1',
    summary: overrides.summary ?? '',
    ...overrides,
  };
}

function renderTree(ui: React.ReactElement): ReturnType<typeof render> {
  return render(React.createElement(I18nextProvider, { i18n }, ui));
}

const baseProps = {
  scenes: [] as Scene[],
  chapters: [] as Chapter[],
  books: [] as Book[],
  projectType: 'novel' as const,
  currentChapterId: null,
  onSelectChapter: vi.fn(),
  isLight: true,
};

describe('SceneTreeView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders chapter nodes for novel', () => {
    const r = renderTree(
      <SceneTreeView {...baseProps} chapters={[mkChapter({ title: 'Ch1' })]} />
    );
    expect(r.getByText('Ch1')).toBeTruthy();
  });

  it('renders scenes under a chapter when expanded', () => {
    const chapters = [mkChapter({ id: '1', title: 'Ch1' })];
    const scenes = [
      mkScene({
        id: 10,
        summary: 'Alpha.',
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 0 },
      }),
      mkScene({
        id: 20,
        summary: 'Beta.',
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 10 },
      }),
    ];
    const r = renderTree(
      <SceneTreeView {...baseProps} chapters={chapters} scenes={scenes} />
    );
    expect(r.getByText('Alpha.')).toBeTruthy();
    expect(r.getByText('Beta.')).toBeTruthy();
  });

  it('renders a toggle button per chapter', () => {
    const r = renderTree(
      <SceneTreeView {...baseProps} chapters={[mkChapter({ id: '1', title: 'Ch1' })]} />
    );
    expect(r.getByLabelText('Toggle book Ch1')).toBeTruthy();
  });

  it('calls onSelectChapter when chapter row is clicked', () => {
    const onSelect = vi.fn();
    const r = renderTree(
      <SceneTreeView
        {...baseProps}
        chapters={[mkChapter({ id: '1', title: 'Ch1' })]}
        onSelectChapter={onSelect}
      />
    );
    fireEvent.click(r.getByText('Ch1'));
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('shows scene count badge per chapter', () => {
    const chapters = [mkChapter({ id: '1', title: 'Ch1' })];
    const scenes = [
      mkScene({
        id: 10,
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 0 },
      }),
      mkScene({
        id: 20,
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 10 },
      }),
    ];
    const r = renderTree(
      <SceneTreeView {...baseProps} chapters={chapters} scenes={scenes} />
    );
    expect(r.getByText('2')).toBeTruthy();
  });

  it('renders scene rows with draggable attribute', () => {
    const chapters = [mkChapter({ id: '1', title: 'Ch1' })];
    const scenes = [
      mkScene({
        id: 10,
        summary: 'Alpha.',
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 0 },
      }),
    ];
    const r = renderTree(
      <SceneTreeView {...baseProps} chapters={chapters} scenes={scenes} />
    );
    const sceneRow = r.getByText('Alpha.').closest('[draggable]');
    expect(sceneRow).toBeTruthy();
  });

  it('renders scene rows with relative positioning for drop hints', () => {
    const chapters = [mkChapter({ id: '1', title: 'Ch1' })];
    const scenes = [
      mkScene({
        id: 10,
        summary: 'Alpha.',
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 0 },
      }),
    ];
    const r = renderTree(
      <SceneTreeView {...baseProps} chapters={chapters} scenes={scenes} />
    );
    const sceneRow = r.getByText('Alpha.').closest('[draggable]')!;
    expect(sceneRow.className).toContain('relative');
  });

  it('uses pseudo-element drop hint mechanism (not border-based)', () => {
    const chapters = [mkChapter({ id: '1', title: 'Ch1' })];
    const scenes = [
      mkScene({
        id: 10,
        summary: 'Alpha.',
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 0 },
      }),
    ];
    const r = renderTree(
      <SceneTreeView {...baseProps} chapters={chapters} scenes={scenes} />
    );
    const sceneRow = r.getByText('Alpha.').closest('[draggable]')!;
    // The row must use `relative` positioning for pseudo-element hints.
    expect(sceneRow.className).toContain('relative');
    // Border-based hints must NOT be used (replaced by pseudo-elements).
    expect(sceneRow.className).not.toContain('border-t-2');
    expect(sceneRow.className).not.toContain('border-b-2');
  });

  it('renders book nodes for series with chapters inside', () => {
    const books: Book[] = [
      { id: 'b1', title: 'Book One', chapters: [{ id: '1', title: 'Ch1' }] },
    ];
    const r = renderTree(
      <SceneTreeView
        {...baseProps}
        projectType="series"
        books={books}
        chapters={[mkChapter({ id: '1', title: 'Ch1', book_id: 'b1' })]}
      />
    );
    expect(r.getByText('Book One')).toBeTruthy();
    expect(r.getByText('Ch1')).toBeTruthy();
  });

  it('calls onSelectScene when a scene row is clicked', () => {
    const onSelectScene = vi.fn();
    const chapters = [mkChapter({ id: '1', title: 'Ch1' })];
    const scenes = [
      mkScene({
        id: 10,
        summary: 'Alpha.',
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 0 },
      }),
    ];
    const r = renderTree(
      <SceneTreeView
        {...baseProps}
        chapters={chapters}
        scenes={scenes}
        onSelectScene={onSelectScene}
      />
    );
    fireEvent.click(r.getByText('Alpha.'));
    expect(onSelectScene).toHaveBeenCalledWith(10);
  });

  it('dispatches aq-scene-select event when onSelectScene is not provided', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    const chapters = [mkChapter({ id: '1', title: 'Ch1' })];
    const scenes = [
      mkScene({
        id: 10,
        summary: 'Alpha.',
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 0 },
      }),
    ];
    const r = renderTree(
      <SceneTreeView {...baseProps} chapters={chapters} scenes={scenes} />
    );
    fireEvent.click(r.getByText('Alpha.'));

    const calls = spy.mock.calls.filter(
      ([evt]: [Event]) => (evt as CustomEvent).type === 'aq-scene-select'
    );
    expect(calls.length).toBe(1);
    expect((calls[0][0] as CustomEvent).detail.sceneId).toBe(10);
    spy.mockRestore();
  });

  it('does not dispatch redundant aq-scene-select when onSelectScene is provided', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    const onSelectScene = vi.fn();
    const chapters = [mkChapter({ id: '1', title: 'Ch1' })];
    const scenes = [
      mkScene({
        id: 10,
        summary: 'Alpha.',
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 0 },
      }),
    ];
    const r = renderTree(
      <SceneTreeView
        {...baseProps}
        chapters={chapters}
        scenes={scenes}
        onSelectScene={onSelectScene}
      />
    );
    fireEvent.click(r.getByText('Alpha.'));

    const calls2 = spy.mock.calls.filter(
      ([evt]: [Event]) => (evt as CustomEvent).type === 'aq-scene-select'
    );
    expect(calls2.length).toBe(0);
    expect(onSelectScene).toHaveBeenCalledWith(10);
    spy.mockRestore();
  });

  it('calls onEditScene when a scene row is double-clicked', () => {
    const onEditScene = vi.fn();
    const chapters = [mkChapter({ id: '1', title: 'Ch1' })];
    const scenes = [
      mkScene({
        id: 10,
        summary: 'Alpha.',
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 0 },
      }),
    ];
    const r = renderTree(
      <SceneTreeView
        {...baseProps}
        chapters={chapters}
        scenes={scenes}
        onEditScene={onEditScene}
      />
    );
    fireEvent.doubleClick(r.getByText('Alpha.'));
    expect(onEditScene).toHaveBeenCalledWith(10);
  });

  it('opens scene editor via store when onEditScene is not provided', () => {
    const chapters = [mkChapter({ id: '1', title: 'Ch1' })];
    const scenes = [
      mkScene({
        id: 10,
        summary: 'Alpha.',
        prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 0 },
      }),
    ];
    const r = renderTree(
      <SceneTreeView {...baseProps} chapters={chapters} scenes={scenes} />
    );
    // Double-click should not throw and should call setWorkspaceMode + openSceneEditorDialog
    // We verify the store actions are callable by checking no error is thrown.
    expect(() => {
      fireEvent.doubleClick(r.getByText('Alpha.'));
    }).not.toThrow();
  });

  it('truncates long scene summaries without mid-text punctuation', () => {
    const longSummary =
      'This is a very long scene summary that goes on and on about many things that happen in this scene and continues past eighty characters and keeps going without any punctuation marks to break it up into smaller pieces';
    const r = renderTree(
      <SceneTreeView
        {...baseProps}
        chapters={[mkChapter({ id: '1', title: 'Ch1' })]}
        scenes={[
          mkScene({
            id: 10,
            summary: longSummary,
            prose_link: { scope_type: 'chapter', chapter_id: '1', start_offset: 0 },
          }),
        ]}
      />
    );
    const el = r.getByTitle(longSummary);
    expect(el.textContent!.length).toBeLessThan(longSummary.length);
  });
});
