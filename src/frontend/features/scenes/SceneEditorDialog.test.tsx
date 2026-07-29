// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for SceneEditorDialog.
 *
 * Covers: rendering, form initialisation from props, save flow (including prose
 * content save only when dirty), delete confirmation two-step, onClose after
 * save, and state reset when the scene prop changes.
 */

// @vitest-environment jsdom

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import type { EditorView } from '@codemirror/view';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import i18n from '../app/i18n';
import { SceneEditorDialog } from './SceneEditorDialog';
import { useScenes } from '../../stores/storyStore';
import type {
  Scene,
  SceneProseLink,
  SourcebookEntry,
  SceneTagPersonalDatetime,
} from '../../types';
import type { Chapter, Book } from '../../types/domain';
import { TemporalApi } from '../../utils/temporal';

const { sourcebookEntriesState } = vi.hoisted(() => ({
  sourcebookEntriesState: [] as SourcebookEntry[],
}));

const { baselineScenesState } = vi.hoisted(() => ({
  baselineScenesState: [] as Scene[],
}));

const { chapterState, bookState, projectTypeState } = vi.hoisted(() => ({
  chapterState: [] as Chapter[],
  bookState: [] as Book[],
  projectTypeState: { value: 'novel' as 'short-story' | 'novel' | 'series' },
}));

// ---------------------------------------------------------------------------
// Store mock — SceneEditorDialog reads useScenes() for ordering display
// ---------------------------------------------------------------------------

vi.mock('../../stores/storyStore', () => ({
  useScenes: vi.fn(() => [] as Scene[]),
  useStoryLanguage: vi.fn(() => 'en'),
  useStoryMeta: vi.fn(() => ({ projectType: projectTypeState.value })),
  useStoryChaptersListMeta: vi.fn(() => chapterState),
  useStoryBooks: vi.fn(() => bookState),
  useStoryStore: vi.fn(
    (
      selector: (state: {
        story: { sourcebook: SourcebookEntry[] };
        baselineState: { scenes: Scene[] };
      }) => unknown
    ) =>
      selector({
        story: { sourcebook: sourcebookEntriesState },
        baselineState: { scenes: baselineScenesState },
      })
  ),
}));

// ThemeContext mock
vi.mock('../layout/ThemeContext', () => ({
  useThemeClasses: vi.fn(() => ({
    bg: '',
    text: '',
    border: '',
    muted: '',
    input: '',
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wrap = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

const readLinkedProseEditorText = (): string =>
  screen.getByRole('textbox', { name: /Linked Prose/i }).textContent ?? '';

function makeScene(overrides: Record<string, unknown> = {}): Scene {
  const legacy = overrides as {
    causes?: SceneId[];
    [key: string]: unknown;
  };
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

type SceneSaveHandler = (updates: Partial<Omit<Scene, 'id'>>) => Promise<void>;

const NOOP_SAVE = vi.fn<SceneSaveHandler>(
  async (_updates: Partial<Omit<Scene, 'id'>>) => undefined
);
const NOOP_DELETE = vi.fn(async () => undefined);
const NOOP_CLOSE = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(useScenes).mockReturnValue([] as Scene[]);
  sourcebookEntriesState.splice(0, sourcebookEntriesState.length);
  baselineScenesState.splice(0, baselineScenesState.length);
  chapterState.splice(0, chapterState.length);
  bookState.splice(0, bookState.length);
  projectTypeState.value = 'novel';
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// eslint-disable-next-line max-lines-per-function
describe('SceneEditorDialog rendering', () => {
  it('does not render when isOpen is false', () => {
    wrap(
      <SceneEditorDialog
        scene={makeScene()}
        isOpen={false}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens diff view when triggered by an LLM scene mutation', () => {
    wrap(
      <SceneEditorDialog
        scene={makeScene({ summary: 'AI-updated scene summary' })}
        isOpen={true}
        openedViaTrigger={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );
    const diffButton = screen.getByRole('button', { name: /Toggle diff view/i });
    expect(diffButton).toBeTruthy();
    expect(diffButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('highlights added beats in diff view', () => {
    wrap(
      <SceneEditorDialog
        scene={makeScene({
          summary: 'AI scene',
          beats: [{ id: 'beat-1', text: 'New beat' }],
        })}
        isOpen={true}
        openedViaTrigger={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    const beatTextarea = screen.getByDisplayValue('New beat');
    const beatRow = beatTextarea.closest('div[data-diff="changed"]');
    expect(beatRow).toBeTruthy();
  });

  it('highlights removed causes when opened from a scene mutation', () => {
    baselineScenesState.push(
      makeScene({ id: 'scene-1', summary: 'Current scene', causes: ['scene-2'] }),
      makeScene({ id: 'scene-2', summary: 'Linked effect scene' })
    );

    vi.mocked(useScenes).mockReturnValue([
      makeScene({ id: 'scene-1', summary: 'Current scene', causes: [] }),
      makeScene({ id: 'scene-2', summary: 'Linked effect scene' }),
    ]);

    wrap(
      <SceneEditorDialog
        scene={makeScene({ id: 'scene-1', summary: 'Current scene', causes: [] })}
        isOpen={true}
        openedViaTrigger={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    expect(screen.queryByText('Removed effects')).toBeNull();
    const removedCause = screen.getByText('Linked effect scene');
    expect(removedCause.className).toContain('line-through');
    expect(removedCause.className).toContain('text-red-600');
  });

  it('highlights added outgoing causes in green', () => {
    baselineScenesState.push(
      makeScene({ id: 'scene-1', summary: 'Current scene', causes: [] }),
      makeScene({ id: 'scene-2', summary: 'Linked effect scene' })
    );

    vi.mocked(useScenes).mockReturnValue([
      makeScene({ id: 'scene-1', summary: 'Current scene', causes: ['scene-2'] }),
      makeScene({ id: 'scene-2', summary: 'Linked effect scene' }),
    ]);

    wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-1',
          summary: 'Current scene',
          causes: ['scene-2'],
        })}
        isOpen={true}
        openedViaTrigger={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    const addedCause = screen.getByText('Linked effect scene');
    expect(addedCause.className).toContain('text-green-700');
  });

  it('shows previous scene time from mutation hint when opened from trigger', () => {
    const sameScene = makeScene({
      id: 'scene-time',
      summary: 'Time scene',
      scene_time: { temporal_zoned_datetime: '2026-06-01T14:00:00Z' },
    });
    baselineScenesState.push(sameScene);

    wrap(
      <SceneEditorDialog
        scene={sameScene}
        isOpen={true}
        openedViaTrigger={true}
        sceneChangeHint={{
          changedFields: ['scene_time'],
          previousValues: {
            scene_time: { temporal_zoned_datetime: '2026-06-01T09:00:00Z' },
          },
        }}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    expect(screen.getByText(/AI changed:/i)).toBeTruthy();
    const oldValue = screen.getByTestId('scene-time-diff-old');
    const newValue = screen.getByTestId('scene-time-diff-new');
    expect(oldValue.className).toContain('line-through');
    expect(oldValue.className).toContain('text-red-600');
    expect(newValue.className).toContain('text-green-700');
  });

  it('does not show scene time diff rows when previous and current values are equal', () => {
    const sameScene = makeScene({
      id: 'scene-time-noop',
      summary: 'Time scene',
      scene_time: { temporal_zoned_datetime: '2026-06-01T14:00:00Z' },
    });
    baselineScenesState.push(sameScene);

    wrap(
      <SceneEditorDialog
        scene={sameScene}
        isOpen={true}
        openedViaTrigger={true}
        sceneChangeHint={{
          changedFields: ['scene_time'],
          previousValues: {
            scene_time: { temporal_zoned_datetime: '2026-06-01T14:00:00Z' },
          },
        }}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    expect(screen.queryByTestId('scene-time-diff-old')).toBeNull();
    expect(screen.queryByTestId('scene-time-diff-new')).toBeNull();
  });

  it('keeps diff view disabled on normal open even when a baseline scene exists', () => {
    baselineScenesState.push(
      makeScene({
        id: 'scene-baseline',
        summary: 'Baseline summary',
      })
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-baseline',
          summary: 'Current summary',
        })}
        isOpen={true}
        openedViaTrigger={false}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    const diffButton = screen.getByRole('button', { name: /Toggle diff view/i });
    expect(diffButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not show diff decorations in linked prose editor when opened normally', () => {
    // When the user opens the dialog via double-click (not via LLM trigger),
    // the linked prose CodeMirror editor should NOT show diff decorations.
    // This verifies that showDiff=false properly disables the diff plugin.
    wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-1',
          prose_link: {
            scope_type: 'chapter',
            chapter_id: 'ch-1',
            book_id: null,
            start_offset: 0,
            end_offset: 11,
          },
        })}
        isOpen={true}
        openedViaTrigger={false}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        getLinkedProseText={() => 'Hello World'}
      />
    );

    const linkedProseEditor = screen.getByRole('textbox', {
      name: /Linked Prose/i,
    });
    // The editor should NOT contain any cm-diff-inserted or cm-diff-deleted spans
    expect(linkedProseEditor.innerHTML).not.toContain('cm-diff-inserted');
    expect(linkedProseEditor.innerHTML).not.toContain('cm-diff-deleted');
  });

  it('shows diff decorations in linked prose editor when opened via LLM trigger', () => {
    // When the dialog is opened via an LLM mutation (openedViaTrigger=true),
    // the linked prose CodeMirror SHOULD show diff decorations against the baseline.
    baselineScenesState.push(
      makeScene({
        id: 'scene-1',
        summary: 'Old summary',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 0,
          end_offset: 5,
        },
      })
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-1',
          summary: 'New AI summary',
          prose_link: {
            scope_type: 'story',
            chapter_id: null,
            book_id: null,
            start_offset: 0,
            end_offset: 5,
          },
        })}
        isOpen={true}
        openedViaTrigger={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        getLinkedProseText={() => 'New LLM prose'}
      />
    );

    // The diff button should be pressed
    const diffButton = screen.getByRole('button', { name: /Toggle diff view/i });
    expect(diffButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('does not show diff after user accepts all diffs and reopens dialog normally', () => {
    // User opens dialog via trigger, accepts diffs, closes. Then reopens
    // normally — no diffs should show because baseline was advanced.
    wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-1',
          prose_link: {
            scope_type: 'chapter',
            chapter_id: 'ch-1',
            book_id: null,
            start_offset: 0,
            end_offset: 11,
          },
        })}
        isOpen={true}
        openedViaTrigger={false}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        getLinkedProseText={() => 'Hello World'}
      />
    );

    // No diff decorations in linked prose
    const linkedProseEditor = screen.getByRole('textbox', {
      name: /Linked Prose/i,
    });
    expect(linkedProseEditor.innerHTML).not.toContain('cm-diff-inserted');
    expect(linkedProseEditor.innerHTML).not.toContain('cm-diff-deleted');

    // The diff toggle should not be pressed
    const diffButton = screen.getByRole('button', { name: /Toggle diff view/i });
    expect(diffButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders the dialog when isOpen is true', () => {
    wrap(
      <SceneEditorDialog
        scene={makeScene()}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows the scene summary in the textarea', () => {
    wrap(
      <SceneEditorDialog
        scene={makeScene({ summary: 'Opening act' })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );
    const editor = screen.getByRole('textbox', { name: /Scene summary/i });
    expect(editor.textContent).toContain('Opening act');
  });

  it('shows scene/chapter/book narrative context badges when available', () => {
    const mockedUseScenes = vi.mocked(useScenes);
    chapterState.push(
      {
        id: 'ch-1',
        title: 'Chapter One',
        summary: '',
        content: '',
        book_id: 'book-1',
      },
      {
        id: 'ch-2',
        title: 'Chapter Two',
        summary: '',
        content: '',
      }
    );
    bookState.push({ id: 'book-1', title: 'Book One', chapters: [] as Chapter[] });

    const target = makeScene({
      id: 'scene-target',
      summary: 'Target',
      order_index: 3,
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        book_id: 'book-1',
        start_offset: 6,
        end_offset: 9,
        content_hash: 'hash',
        is_stale: false,
      },
    });
    mockedUseScenes.mockReturnValue([
      makeScene({
        id: 'scene-prev',
        summary: 'Prev',
        order_index: 1,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: 'ch-1',
          book_id: 'book-1',
          start_offset: 0,
          end_offset: 5,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      target,
      makeScene({
        id: 'scene-next',
        summary: 'Next',
        order_index: 5,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: 'ch-1',
          book_id: 'book-1',
          start_offset: 10,
          end_offset: 20,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'scene-other',
        summary: 'Other',
        order_index: 7,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: 'ch-2',
          book_id: null,
          start_offset: 0,
          end_offset: 5,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
    ]);

    wrap(
      <SceneEditorDialog
        scene={target}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    expect(screen.getByText('Scene 2 of 4')).toBeTruthy();
    expect(screen.getByText('Chapter: Chapter One')).toBeTruthy();
    expect(screen.getByText('Book: Book One')).toBeTruthy();
    expect(screen.getByText('Chapter position 2 of 3')).toBeTruthy();
  });

  it('navigates to previous and next scenes in narrative order', () => {
    const onNavigateScene = vi.fn();
    const mockedUseScenes = vi.mocked(useScenes);

    const sceneA = makeScene({ id: 'scene-a', summary: 'A', order_index: 1 });
    const sceneB = makeScene({ id: 'scene-b', summary: 'B', order_index: 2 });
    const sceneC = makeScene({ id: 'scene-c', summary: 'C', order_index: 3 });
    mockedUseScenes.mockReturnValue([sceneA, sceneB, sceneC]);

    wrap(
      <SceneEditorDialog
        scene={sceneB}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        onNavigateScene={onNavigateScene}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Previous scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));

    expect(onNavigateScene).toHaveBeenNthCalledWith(1, 'scene-a');
    expect(onNavigateScene).toHaveBeenNthCalledWith(2, 'scene-c');
  });

  it('navigates to previous and next scenes in pinboard ID order', () => {
    const onNavigateScene = vi.fn();
    const mockedUseScenes = vi.mocked(useScenes);

    const sceneA = makeScene({ id: 'scene-a', summary: 'A' });
    const sceneB = makeScene({ id: 'scene-b', summary: 'B' });
    const sceneC = makeScene({ id: 'scene-c', summary: 'C' });
    mockedUseScenes.mockReturnValue([sceneB, sceneC, sceneA]);

    wrap(
      <SceneEditorDialog
        scene={sceneB}
        isOpen
        viewMode="pinboard"
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        onNavigateScene={onNavigateScene}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Previous scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));

    expect(onNavigateScene).toHaveBeenNthCalledWith(1, 'scene-a');
    expect(onNavigateScene).toHaveBeenNthCalledWith(2, 'scene-c');
  });

  it('navigates to previous and next scenes in numeric scene ID order in pinboard view', () => {
    const onNavigateScene = vi.fn();
    const mockedUseScenes = vi.mocked(useScenes);

    const scene1 = makeScene({ id: 1, summary: 'One' });
    const scene2 = makeScene({ id: 2, summary: 'Two' });
    const scene10 = makeScene({ id: 10, summary: 'Ten' });
    mockedUseScenes.mockReturnValue([scene2, scene10, scene1]);

    wrap(
      <SceneEditorDialog
        scene={scene2}
        isOpen
        viewMode="pinboard"
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        onNavigateScene={onNavigateScene}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Previous scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));

    expect(onNavigateScene).toHaveBeenNthCalledWith(1, 1);
    expect(onNavigateScene).toHaveBeenNthCalledWith(2, 10);
  });

  it('navigates to previous and next scenes in chronological order for chronological and convergence-map views', () => {
    const onNavigateScene = vi.fn();
    const mockedUseScenes = vi.mocked(useScenes);

    const sceneA = makeScene({
      id: 'scene-a',
      summary: 'A',
      scene_time: { temporal_zoned_datetime: '2023-01-01T00:00:00Z' },
    });
    const sceneB = makeScene({
      id: 'scene-b',
      summary: 'B',
      scene_time: { temporal_zoned_datetime: '2024-01-01T00:00:00Z' },
    });
    const sceneC = makeScene({
      id: 'scene-c',
      summary: 'C',
      scene_time: { temporal_zoned_datetime: '2025-01-01T00:00:00Z' },
    });
    mockedUseScenes.mockReturnValue([sceneB, sceneC, sceneA]);

    wrap(
      <SceneEditorDialog
        scene={sceneB}
        isOpen
        viewMode="chronological"
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        onNavigateScene={onNavigateScene}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Previous scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));

    expect(onNavigateScene).toHaveBeenNthCalledWith(1, 'scene-a');
    expect(onNavigateScene).toHaveBeenNthCalledWith(2, 'scene-c');

    cleanup();
    onNavigateScene.mockReset();

    wrap(
      <SceneEditorDialog
        scene={sceneB}
        isOpen
        viewMode="convergence-map"
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        onNavigateScene={onNavigateScene}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Previous scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));

    expect(onNavigateScene).toHaveBeenNthCalledWith(1, 'scene-a');
    expect(onNavigateScene).toHaveBeenNthCalledWith(2, 'scene-c');
  });
});

// ---------------------------------------------------------------------------
// Save flow
// ---------------------------------------------------------------------------

// eslint-disable-next-line max-lines-per-function
describe('SceneEditorDialog save flow', () => {
  it('calls onSave with updated values and then onClose', async () => {
    const onSave = vi.fn<SceneSaveHandler>(
      async (_updates: Partial<Omit<Scene, 'id'>>) => undefined
    );
    const onClose = vi.fn();
    const summaryRef = React.createRef<EditorView | null>();

    wrap(
      <SceneEditorDialog
        scene={makeScene({ summary: 'Original' })}
        isOpen
        onClose={onClose}
        onSave={onSave}
        onDelete={NOOP_DELETE}
        summaryEditorRef={summaryRef}
      />
    );

    // Change the summary using the CodeMirror editor's direct view reference.
    await act(async () => {
      const view = summaryRef.current;
      view?.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'Updated summary' },
      });
    });

    const saveBtn = screen.getByRole('button', { name: /Save/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(onSave).toHaveBeenCalledOnce();
    const arg = onSave.mock.calls[0][0] as Partial<Scene>;
    expect(arg.summary).toBe('Updated summary');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does NOT call onSaveProseContent when prose text is unchanged', async () => {
    const onSaveProseContent = vi.fn(async () => undefined);
    const proseLink: SceneProseLink = {
      scope_type: 'story',
      start_offset: 0,
      end_offset: 5,
      content_hash: 'abc',
      chapter_id: null,
      book_id: null,
      is_stale: false,
    };
    const getLinkedProseText = vi.fn(() => 'hello');

    wrap(
      <SceneEditorDialog
        scene={makeScene({ prose_link: proseLink })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        getLinkedProseText={getLinkedProseText}
        onSaveProseContent={onSaveProseContent}
      />
    );

    const saveBtn = screen.getByRole('button', { name: /Save/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(onSaveProseContent).not.toHaveBeenCalled();
  });

  it('calls onSaveProseContent BEFORE onSave when prose text was edited', async () => {
    const callOrder: string[] = [];
    const linkedProseEditorRef = React.createRef<EditorView | null>();
    const onSaveProseContent = vi.fn(async () => {
      callOrder.push('prose');
    });
    const onSave = vi.fn<SceneSaveHandler>(
      async (_updates: Partial<Omit<Scene, 'id'>>) => {
        callOrder.push('save');
      }
    );
    const proseLink: SceneProseLink = {
      scope_type: 'story',
      start_offset: 0,
      end_offset: 5,
      content_hash: 'abc',
      chapter_id: null,
      book_id: null,
      is_stale: false,
    };
    const getLinkedProseText = vi.fn(() => 'hello');

    wrap(
      <SceneEditorDialog
        scene={makeScene({ prose_link: proseLink })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={onSave}
        onDelete={NOOP_DELETE}
        getLinkedProseText={getLinkedProseText}
        onSaveProseContent={onSaveProseContent}
        linkedProseEditorRef={linkedProseEditorRef}
      />
    );

    await act(async () => {
      linkedProseEditorRef.current?.dispatch({
        changes: {
          from: 0,
          to: linkedProseEditorRef.current.state.doc.length,
          insert: 'modified prose',
        },
      });
    });

    const saveBtn = screen.getByRole('button', { name: /Save/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(onSaveProseContent).toHaveBeenCalledWith('modified prose');
    expect(onSave).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(['prose', 'save']);
  });

  it('does not call onSaveProseContent when there is no prose link', async () => {
    const onSaveProseContent = vi.fn(async () => undefined);

    wrap(
      <SceneEditorDialog
        scene={makeScene({ prose_link: null })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        onSaveProseContent={onSaveProseContent}
      />
    );

    const saveBtn = screen.getByRole('button', { name: /Save/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(onSaveProseContent).not.toHaveBeenCalled();
  });

  it('updates linked prose text while write-scene is still running', async () => {
    vi.useFakeTimers();
    try {
      const proseLink: SceneProseLink = {
        scope_type: 'story',
        start_offset: 0,
        end_offset: 5,
        content_hash: 'abc',
        chapter_id: null,
        book_id: null,
        is_stale: false,
      };

      let linkedProse = 'initial prose';
      const getLinkedProseText = vi.fn(() => linkedProse);
      const onWriteScene = vi.fn(async () => {
        linkedProse = 'chunk 1';
        await new Promise<void>((resolve: () => void) => setTimeout(resolve, 20));
        linkedProse = 'chunk 2';
        await new Promise<void>((resolve: () => void) => setTimeout(resolve, 20));
        linkedProse = 'chunk 3';
        await new Promise<void>((resolve: () => void) => setTimeout(resolve, 20));
      });

      wrap(
        <SceneEditorDialog
          scene={makeScene({ prose_link: proseLink })}
          isOpen
          onClose={NOOP_CLOSE}
          onSave={NOOP_SAVE}
          onDelete={NOOP_DELETE}
          getLinkedProseText={getLinkedProseText}
          onWriteScene={onWriteScene}
        />
      );

      expect(readLinkedProseEditorText()).toContain('initial prose');

      fireEvent.click(screen.getByRole('button', { name: /Write Scene/i }));

      await act(async () => {
        vi.advanceTimersByTime(25);
        await Promise.resolve();
      });

      expect(readLinkedProseEditorText()).toContain('chunk 1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('streams returned generated text when linked prose polling is unchanged', async () => {
    vi.useFakeTimers();
    try {
      const proseLink: SceneProseLink = {
        scope_type: 'story',
        start_offset: 0,
        end_offset: 5,
        content_hash: 'abc',
        chapter_id: null,
        book_id: null,
        is_stale: false,
      };

      const getLinkedProseText = vi.fn(() => 'initial prose');
      const onWriteScene = vi.fn(
        async () =>
          'Generated prose returned from write-scene for progressive rendering.'
      );

      wrap(
        <SceneEditorDialog
          scene={makeScene({ prose_link: proseLink })}
          isOpen
          onClose={NOOP_CLOSE}
          onSave={NOOP_SAVE}
          onDelete={NOOP_DELETE}
          getLinkedProseText={getLinkedProseText}
          onWriteScene={onWriteScene}
        />
      );

      expect(readLinkedProseEditorText()).toContain('initial prose');

      fireEvent.click(screen.getByRole('button', { name: /Write Scene/i }));

      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(40);
      });

      expect(readLinkedProseEditorText()).toContain(
        'Generated prose returned from write-scene for progressive rendering.'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('enables diff view after write-scene without rendering a separate prose preview block', async () => {
    const proseLink: SceneProseLink = {
      scope_type: 'story',
      start_offset: 0,
      end_offset: 5,
      content_hash: 'abc',
      chapter_id: null,
      book_id: null,
      is_stale: false,
    };

    const getLinkedProseText = vi.fn(() => 'initial prose');
    const onWriteScene = vi.fn(async () => 'updated prose from write scene');

    wrap(
      <SceneEditorDialog
        scene={makeScene({ prose_link: proseLink })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        getLinkedProseText={getLinkedProseText}
        onWriteScene={onWriteScene}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Write Scene/i }));

    await act(async () => {
      await Promise.resolve();
    });

    const diffButton = screen.getByRole('button', { name: /Toggle diff view/i });
    expect(diffButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Linked Prose Diff Preview')).toBeNull();
  });

  it('shows inline linked prose diff markers in normal diff mode after write-scene', async () => {
    const proseLink: SceneProseLink = {
      scope_type: 'story',
      start_offset: 0,
      end_offset: 5,
      content_hash: 'abc',
      chapter_id: null,
      book_id: null,
      is_stale: false,
    };

    const getLinkedProseText = vi.fn(() => 'initial prose');
    const onWriteScene = vi.fn(async () => 'updated prose from write scene');
    wrap(
      <SceneEditorDialog
        scene={makeScene({ prose_link: proseLink })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        getLinkedProseText={getLinkedProseText}
        onWriteScene={onWriteScene}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Write Scene/i }));

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      const content = readLinkedProseEditorText();
      expect(content).toContain('initial pros');
      expect(content).toContain('updated prose from write scene');
    });
    expect(screen.queryByLabelText('Linked Prose Diff Preview')).toBeNull();
  });

  it('does not reset streamed prose on same-scene rerender after write', async () => {
    const proseLink: SceneProseLink = {
      scope_type: 'story',
      start_offset: 0,
      end_offset: 5,
      content_hash: 'abc',
      chapter_id: null,
      book_id: null,
      is_stale: false,
    };

    const getLinkedProseText = vi.fn(() => 'initial prose');
    const onWriteScene = vi.fn(async () => 'updated prose');
    const scene = makeScene({
      id: 'scene-1',
      prose_link: proseLink,
      summary: 'before',
    });
    const { rerender } = wrap(
      <SceneEditorDialog
        scene={scene}
        isOpen
        defaultShowDiff={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        getLinkedProseText={getLinkedProseText}
        onWriteScene={onWriteScene}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Write Scene/i }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(readLinkedProseEditorText()).toContain('updated prose');
    expect(screen.queryByLabelText('Linked Prose Diff Preview')).toBeNull();

    rerender(
      <I18nextProvider i18n={i18n}>
        <SceneEditorDialog
          scene={makeScene({
            id: 'scene-1',
            prose_link: proseLink,
            summary: 'after store patch',
          })}
          isOpen
          onClose={NOOP_CLOSE}
          onSave={NOOP_SAVE}
          onDelete={NOOP_DELETE}
          getLinkedProseText={getLinkedProseText}
          onWriteScene={onWriteScene}
        />
      </I18nextProvider>
    );

    expect(readLinkedProseEditorText()).toContain('updated prose');
    expect(screen.queryByLabelText('Linked Prose Diff Preview')).toBeNull();
  });

  it('does not clear streamed prose when linked prose polling later returns empty', async () => {
    vi.useFakeTimers();
    try {
      const proseLink: SceneProseLink = {
        scope_type: 'story',
        start_offset: 0,
        end_offset: 5,
        content_hash: 'abc',
        chapter_id: null,
        book_id: null,
        is_stale: false,
      };

      let linkedProse = 'initial prose';
      const getLinkedProseText = vi.fn(() => linkedProse);
      const onWriteScene = vi.fn(async () => {
        linkedProse = 'freshly generated prose';
        await new Promise<void>((resolve: () => void) => setTimeout(resolve, 20));
        linkedProse = '';
        await new Promise<void>((resolve: () => void) => setTimeout(resolve, 40));
      });

      wrap(
        <SceneEditorDialog
          scene={makeScene({ prose_link: proseLink })}
          isOpen
          onClose={NOOP_CLOSE}
          onSave={NOOP_SAVE}
          onDelete={NOOP_DELETE}
          getLinkedProseText={getLinkedProseText}
          onWriteScene={onWriteScene}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Write Scene/i }));

      await act(async () => {
        vi.advanceTimersByTime(80);
        await Promise.resolve();
      });

      expect(readLinkedProseEditorText()).toContain('freshly generated prose');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps diff mode active after closing and reopening the same scene dialog', async () => {
    const proseLink: SceneProseLink = {
      scope_type: 'story',
      start_offset: 0,
      end_offset: 5,
      content_hash: 'abc',
      chapter_id: null,
      book_id: null,
      is_stale: false,
    };

    const getLinkedProseText = vi.fn(() => 'initial prose');
    const onWriteScene = vi.fn(async () => 'updated prose');
    const scene = makeScene({
      id: 'scene-1',
      prose_link: proseLink,
      summary: 'before',
    });
    const { unmount } = wrap(
      <SceneEditorDialog
        scene={scene}
        isOpen
        defaultShowDiff={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        getLinkedProseText={getLinkedProseText}
        onWriteScene={onWriteScene}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Write Scene/i }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen
        .getByRole('button', { name: /Toggle diff view/i })
        .getAttribute('aria-pressed')
    ).toBe('true');

    unmount();

    wrap(
      <SceneEditorDialog
        scene={scene}
        isOpen
        defaultShowDiff={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        getLinkedProseText={getLinkedProseText}
        onWriteScene={onWriteScene}
      />
    );

    expect(
      screen
        .getByRole('button', { name: /Toggle diff view/i })
        .getAttribute('aria-pressed')
    ).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------

describe('SceneEditorDialog delete flow', () => {
  it('requires a confirmation click before calling onDelete', async () => {
    const onDelete = vi.fn(async () => undefined);
    const onClose = vi.fn();

    wrap(
      <SceneEditorDialog
        scene={makeScene()}
        isOpen
        onClose={onClose}
        onSave={NOOP_SAVE}
        onDelete={onDelete}
      />
    );

    // First click: enters confirm state
    const deleteBtn = screen.getByRole('button', { name: /Delete Scene/i });
    fireEvent.click(deleteBtn);

    // onDelete not yet called
    expect(onDelete).not.toHaveBeenCalled();

    // Confirm button appears — same label "Delete Scene", now inside the confirm row
    // getAllByRole returns: [confirm-delete, footer-cancel, footer-save, header-close]
    // After confirmDelete=true there is ONE 'Delete Scene' button (the actual confirm)
    const confirmBtn = screen.getByRole('button', { name: /Delete Scene/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(onDelete).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('cancels delete when the cancel button is clicked', () => {
    const onDelete = vi.fn(async () => undefined);

    wrap(
      <SceneEditorDialog
        scene={makeScene()}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Delete Scene/i }));
    // After confirming, 'Cancel' appears in the confirm row AND in the footer.
    // getAllByRole returns them in DOM order; the confirm-row cancel comes first.
    const [confirmCancelBtn] = screen.getAllByRole('button', { name: /^Cancel$/i });
    fireEvent.click(confirmCancelBtn);

    expect(onDelete).not.toHaveBeenCalled();
    // Delete Scene button must be back (confirm state exited)
    expect(screen.getByRole('button', { name: /Delete Scene/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

describe('SceneEditorDialog state reset', () => {
  it('resets form to the new scene when the scene prop changes', () => {
    const sceneA = makeScene({ id: 'a', summary: 'Scene A' });
    const sceneB = makeScene({ id: 'b', summary: 'Scene B' });

    const { rerender } = wrap(
      <SceneEditorDialog
        scene={sceneA}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    const editorA = screen.getByRole('textbox', { name: /Scene summary/i });
    expect(editorA.textContent).toContain('Scene A');

    rerender(
      <I18nextProvider i18n={i18n}>
        <SceneEditorDialog
          scene={sceneB}
          isOpen
          onClose={NOOP_CLOSE}
          onSave={NOOP_SAVE}
          onDelete={NOOP_DELETE}
        />
      </I18nextProvider>
    );

    const editorB = screen.getByRole('textbox', { name: /Scene summary/i });
    expect(editorB.textContent).toContain('Scene B');
    expect(editorB.textContent).not.toContain('Scene A');
  });

  it('resets proseDirty flag when dialog re-opens for new scene', async () => {
    const onSaveProseContent = vi.fn(async () => undefined);
    const linkedProseEditorRef = React.createRef<EditorView | null>();
    const proseLink: SceneProseLink = {
      scope_type: 'story',
      start_offset: 0,
      end_offset: 5,
      content_hash: 'abc',
      chapter_id: null,
      book_id: null,
      is_stale: false,
    };
    const getLinkedProseText = vi.fn(() => 'hello');

    const { rerender } = wrap(
      <SceneEditorDialog
        scene={makeScene({ id: 'a', prose_link: proseLink })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        getLinkedProseText={getLinkedProseText}
        onSaveProseContent={onSaveProseContent}
        linkedProseEditorRef={linkedProseEditorRef}
      />
    );

    await act(async () => {
      linkedProseEditorRef.current?.dispatch({
        changes: {
          from: 0,
          to: linkedProseEditorRef.current.state.doc.length,
          insert: 'edited',
        },
      });
    });

    // Re-open with a different scene (same isOpen=true but scene changed)
    rerender(
      <I18nextProvider i18n={i18n}>
        <SceneEditorDialog
          scene={makeScene({ id: 'b', prose_link: proseLink })}
          isOpen
          onClose={NOOP_CLOSE}
          onSave={NOOP_SAVE}
          onDelete={NOOP_DELETE}
          getLinkedProseText={getLinkedProseText}
          onSaveProseContent={onSaveProseContent}
          linkedProseEditorRef={linkedProseEditorRef}
        />
      </I18nextProvider>
    );

    // Save with the new scene — prose should NOT be dirty
    const saveBtn = screen.getByRole('button', { name: /Save/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(onSaveProseContent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Character parsing
// ---------------------------------------------------------------------------

describe('SceneEditorDialog character parsing', () => {
  it('adds typed active-character tags and saves them as an array', async () => {
    const onSave = vi.fn<SceneSaveHandler>(
      async (_updates: Partial<Omit<Scene, 'id'>>) => undefined
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene()}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={onSave}
        onDelete={NOOP_DELETE}
      />
    );

    const activeInput = screen.getAllByPlaceholderText(/Type and press Enter/i)[0];
    fireEvent.change(activeInput, { target: { value: 'Alice' } });
    fireEvent.keyDown(activeInput, { key: 'Enter' });
    fireEvent.change(activeInput, { target: { value: 'Bob' } });
    fireEvent.keyDown(activeInput, { key: 'Enter' });
    fireEvent.change(activeInput, { target: { value: 'Charlie' } });
    fireEvent.keyDown(activeInput, { key: 'Enter' });

    const saveBtn = screen.getByRole('button', { name: /Save/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    const arg = onSave.mock.calls[0][0] as Partial<Scene>;
    expect(arg.active_characters).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('produces an empty array when the character field is blank', async () => {
    const onSave = vi.fn<SceneSaveHandler>(
      async (_updates: Partial<Omit<Scene, 'id'>>) => undefined
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene({ active_characters: ['Old'] })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={onSave}
        onDelete={NOOP_DELETE}
      />
    );

    const activeInput = screen.getAllByPlaceholderText(/Type and press Enter/i)[0];
    fireEvent.keyDown(activeInput, { key: 'Backspace' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    });

    const arg = onSave.mock.calls[0][0] as Partial<Scene>;
    expect(arg.active_characters).toEqual([]);
  });
});

describe('SceneEditorDialog sourcebook navigation safety', () => {
  it('asks for save/discard/abort before opening sourcebook when there are unsaved edits', async () => {
    sourcebookEntriesState.push({
      id: 'sb-1',
      name: 'Aether',
      category: 'world',
      aliases: [],
      synonyms: [],
      description: '',
      tags: [],
      relations: [],
      image_ids: [],
      image_notes: {},
      color_tag: null,
      role_in_story: null,
      statuses: [],
      chapters_featured: [],
      appears_in_locations: [],
      timeline_hint: null,
      first_appearance: null,
      visibility_scope: 'project',
      links: [],
      metadata: {},
      keywords: [],
      notes: [],
      events: [],
      project_language: 'en',
    } as unknown as SourcebookEntry);

    const onOpenSourcebookEntry = vi.fn();
    const onClose = vi.fn();

    wrap(
      <SceneEditorDialog
        scene={makeScene({ sourcebook_entry_ids: ['sb-1'] })}
        isOpen
        onClose={onClose}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        onOpenSourcebookEntry={onOpenSourcebookEntry}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Beat/i }));
    fireEvent.doubleClick(screen.getByText('Aether'));

    expect(screen.getByText(/You have unsaved scene changes/i)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Discard$/i }));
    });

    expect(onOpenSourcebookEntry).toHaveBeenCalledWith('sb-1');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('SceneEditorDialog sourcebook validation', () => {
  it('filters character entries out of sourcebook tags and save payloads', async () => {
    sourcebookEntriesState.push(
      {
        id: 'Bob',
        name: 'Bob',
        category: 'Character',
        aliases: [],
        synonyms: [],
        description: '',
        tags: [],
        relations: [],
        image_ids: [],
        image_notes: {},
        color_tag: null,
        role_in_story: null,
        statuses: [],
        chapters_featured: [],
        appears_in_locations: [],
        timeline_hint: null,
        first_appearance: null,
        visibility_scope: 'project',
        links: [],
        metadata: {},
        keywords: [],
        notes: [],
        events: [],
        project_language: 'en',
      } as unknown as SourcebookEntry,
      {
        id: 'sb-1',
        name: 'Aether',
        category: 'world',
        aliases: [],
        synonyms: [],
        description: '',
        tags: [],
        relations: [],
        image_ids: [],
        image_notes: {},
        color_tag: null,
        role_in_story: null,
        statuses: [],
        chapters_featured: [],
        appears_in_locations: [],
        timeline_hint: null,
        first_appearance: null,
        visibility_scope: 'project',
        links: [],
        metadata: {},
        keywords: [],
        notes: [],
        events: [],
        project_language: 'en',
      } as unknown as SourcebookEntry
    );

    const onSave = vi.fn<SceneSaveHandler>(
      async (_updates: Partial<Omit<Scene, 'id'>>) => undefined
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene({ sourcebook_entry_ids: ['Bob', 'sb-1'] })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={onSave}
        onDelete={NOOP_DELETE}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    });

    const arg = onSave.mock.calls[0][0] as Partial<Scene>;
    expect(arg.sourcebook_entry_ids).toEqual(['sb-1']);
  });

  it('shows computed age for active character tags when origin date and scene time exist', () => {
    sourcebookEntriesState.push({
      id: 'Alice',
      name: 'Alice',
      category: 'Character',
      synonyms: [],
      description: '',
      images: [],
      origin_date: '2020-01-01T00:00:00+00:00[UTC]',
    });

    wrap(
      <SceneEditorDialog
        scene={makeScene({
          active_characters: ['Alice'],
          scene_time: { temporal_zoned_datetime: '2040-01-01T00:00:00+00:00[UTC]' },
        })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    expect(screen.getByText('Age 20y')).toBeTruthy();
  });

  it('shows computed age for sourcebook tags even when timeline differs', () => {
    sourcebookEntriesState.push(
      {
        id: 'sb-main',
        name: 'Aether',
        category: 'world',
        synonyms: [],
        description: '',
        images: [],
        origin_date: '2020-01-01T00:00:00+00:00[UTC]',
      },
      {
        id: 'sb-branch',
        name: 'Branch Artifact',
        category: 'artifact',
        synonyms: [],
        description: '',
        images: [],
        origin_date: '2020-01-01T00:00:00+00:00[UTC]',
        timeline_id: 'branch:other',
      }
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene({
          sourcebook_entry_ids: ['sb-main', 'sb-branch'],
          timeline_id: 'main',
          scene_time: { temporal_zoned_datetime: '2025-01-01T00:00:00+00:00[UTC]' },
        })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    expect(screen.queryAllByText(/^Age 5y$/).length).toBe(2);
  });
});

describe('SceneEditorDialog Temporal time payload', () => {
  it('displays scene_time when stored as a loose ISO date value', () => {
    wrap(
      <SceneEditorDialog
        scene={makeScene({
          scene_time: { temporal_zoned_datetime: '1985-11-05' },
        })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    expect(screen.getAllByText(/1985/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/International format:/i)).toBeTruthy();
  });

  it('renders safely even when temporal locale formatting throws', () => {
    const temporalValue = '0044-03-15T12:00:00+00:00[UTC][u-ca=gregory]';
    const sample = TemporalApi.ZonedDateTime.from(temporalValue);
    const proto = Object.getPrototypeOf(sample) as {
      toLocaleString: (
        locales?: string | string[] | undefined,
        options?: Intl.DateTimeFormatOptions | undefined
      ) => string;
    };
    const spy = vi.spyOn(proto, 'toLocaleString').mockImplementation((): never => {
      throw new RangeError('Mismatched calendars.');
    });

    wrap(
      <SceneEditorDialog
        scene={makeScene({
          scene_time: { temporal_zoned_datetime: temporalValue },
        })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/International format:/i)).toBeTruthy();
    expect(screen.getAllByText(/UTC/i).length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('saves scene_time via Temporal payload and does not send legacy location/time fields', async () => {
    const onSave = vi.fn<SceneSaveHandler>(
      async (_updates: Partial<Omit<Scene, 'id'>>) => undefined
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene()}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={onSave}
        onDelete={NOOP_DELETE}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Set Time/i }));
    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '44' } });
    fireEvent.change(screen.getByLabelText(/Era/i), { target: { value: 'BCE' } });
    fireEvent.change(screen.getByLabelText(/Common Regions/i), {
      target: { value: 'Europe/Rome' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply Scene Time/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    });

    const payload = onSave.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.scene_time).toBeTruthy();
    expect(
      (payload.scene_time as { temporal_zoned_datetime: string })
        .temporal_zoned_datetime
    ).toContain('[Europe/Rome]');
    expect('location' in payload).toBe(false);
    expect('time' in payload).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Beat management
// ---------------------------------------------------------------------------

describe('SceneEditorDialog beat management', () => {
  it('adds a beat when the Add Beat button is clicked', () => {
    wrap(
      <SceneEditorDialog
        scene={makeScene({ beats: [] })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    const addBeatBtn = screen.getByRole('button', { name: /Add Beat/i });
    fireEvent.click(addBeatBtn);

    // A new beat textarea should appear
    const beatInputs = screen.getAllByPlaceholderText(/Beat text/i);
    expect(beatInputs.length).toBeGreaterThanOrEqual(1);
  });

  it('includes beats in the onSave payload', async () => {
    const onSave = vi.fn<SceneSaveHandler>(
      async (_updates: Partial<Omit<Scene, 'id'>>) => undefined
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene({
          beats: [{ id: 'b1', text: 'Initial beat', prose_link: null }],
        })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={onSave}
        onDelete={NOOP_DELETE}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    });

    const arg = onSave.mock.calls[0][0] as Partial<Scene>;
    expect(arg.beats).toHaveLength(1);
    expect(arg.beats![0].text).toBe('Initial beat');
  });
});

// ---------------------------------------------------------------------------
// Delete cause (causes / causes)
// ---------------------------------------------------------------------------

describe('SceneEditorDialog delete cause', () => {
  const mockedUseScenes = vi.mocked(useScenes);

  const sceneA = makeScene({ id: 'a', summary: 'Scene A', causes: ['b'] });
  const sceneB = makeScene({ id: 'b', summary: 'Scene B', causes: ['c'] });
  const sceneC = makeScene({ id: 'c', summary: 'Scene C' });

  beforeEach(() => {
    mockedUseScenes.mockReturnValue([sceneA, sceneB, sceneC]);
  });

  const renderB = (
    onDeleteCause: (fromId: string, toId: string) => Promise<void> = vi.fn(
      async () => undefined
    )
  ): ReturnType<typeof wrap> =>
    wrap(
      <SceneEditorDialog
        scene={sceneB}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        onDeleteCause={onDeleteCause}
      />
    );

  it('renders delete buttons for each cause relationship', () => {
    renderB();
    const deleteButtons = screen.getAllByRole('button', { name: /Delete cause/i });
    // One for causes ('c') and one for causes ('a')
    expect(deleteButtons.length).toBe(2);
  });

  it('calls onDeleteCause(causeId, sceneId) when deleting a predecessor entry', async () => {
    const onDeleteCause = vi.fn(async () => undefined);
    renderB(onDeleteCause);

    // "Caused by" section lists 'a' → delete button calls onDeleteCause(a.id, b.id)
    const [firstDeleteBtn] = screen.getAllByRole('button', { name: /Delete cause/i });
    await act(async () => {
      fireEvent.click(firstDeleteBtn);
    });

    expect(onDeleteCause).toHaveBeenCalledOnce();
    expect(onDeleteCause).toHaveBeenCalledWith('a', 'b');
  });

  it('calls onDeleteCause(sceneId, targetId) when deleting a cause entry', async () => {
    const onDeleteCause = vi.fn(async () => undefined);
    renderB(onDeleteCause);

    // "Causes" section lists 'c' → delete button calls onDeleteCause(b.id, c.id)
    const deleteButtons = screen.getAllByRole('button', { name: /Delete cause/i });
    await act(async () => {
      fireEvent.click(deleteButtons[1]);
    });

    expect(onDeleteCause).toHaveBeenCalledOnce();
    expect(onDeleteCause).toHaveBeenCalledWith('b', 'c');
  });

  it('does not render the Causes section when scene has no cause relationships', () => {
    wrap(
      <SceneEditorDialog
        scene={makeScene({ id: 'x', causes: [] })}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
        onDeleteCause={vi.fn(async () => undefined)}
      />
    );
    expect(screen.queryByRole('button', { name: /Delete cause/i })).toBeNull();
  });

  it('shows scene summary as display name in the cause list', () => {
    renderB();
    // 'Scene C' is the summary of sceneC which is listed in causes
    expect(screen.getByText('Scene C')).toBeTruthy();
    // 'Scene A' is listed in causes
    expect(screen.getByText('Scene A')).toBeTruthy();
  });

  it('falls back to the id when the scene is not found in the store', () => {
    mockedUseScenes.mockReturnValue([]); // no scenes in store
    renderB();
    // Without store data, fallback is the raw id for the referenced cause
    expect(screen.getByText('c')).toBeTruthy();
  });

  it('handles onDeleteCause rejection gracefully (no unhandled rejection)', async () => {
    const onDeleteCause = vi.fn(async () => {
      throw new Error('network error');
    });
    renderB(onDeleteCause);

    const [firstDeleteBtn] = screen.getAllByRole('button', { name: /Delete cause/i });
    // Should not throw / crash the test
    await act(async () => {
      fireEvent.click(firstDeleteBtn);
      // Swallow the rejection
      await Promise.resolve();
    });

    expect(onDeleteCause).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Age picker (tag_personal_datetimes)
// ---------------------------------------------------------------------------

describe('SceneEditorDialog age picker', () => {
  const mockedUseScenes = vi.mocked(useScenes);

  const aliceSbEntry: SourcebookEntry = {
    id: 'Alice',
    name: 'Alice',
    synonyms: [],
    description: 'Protagonist',
    images: [],
  };

  /** A TT sourcebook entry that creates a new timeline. */
  const ttEntry: SourcebookEntry = {
    id: 'tt-jump-1',
    name: 'The Jump',
    synonyms: [],
    description: 'Time travel event',
    images: [],
    category: 'Time Travel',
    creates_new_timeline: true,
  };

  /**
   * Two ISO-8601 datetimes to use so that sceneEarly has an epoch strictly
   * before sceneLate, which is needed for activeBranchTimelines detection.
   */
  const EARLY_TIME = '2020-01-01T00:00:00+00:00[UTC]';
  const LATE_TIME = '2025-06-01T00:00:00+00:00[UTC]';

  beforeEach(() => {
    sourcebookEntriesState.push(aliceSbEntry, ttEntry);
  });

  it('hides the age picker clock button when only one timeline exists', () => {
    const scene = makeScene({ active_characters: ['Alice'] });
    wrap(
      <SceneEditorDialog
        scene={scene}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    // With no TT entries creating timelines active before this scene,
    // the clock button must not be rendered.
    const ageBtns = screen.queryAllByRole('button', {
      name: /Set character state/i,
    });
    expect(ageBtns.length).toBe(0);
  });

  it('opens the age picker modal when the age clock icon is clicked (multi-timeline)', () => {
    // Set up an earlier scene that references the TT entry, establishing a branch.
    const sceneEarly = makeScene({
      id: 'scene-early',
      active_characters: ['Alice'],
      sourcebook_entry_ids: ['tt-jump-1'],
      scene_time: { temporal_zoned_datetime: EARLY_TIME },
    });
    mockedUseScenes.mockReturnValue([sceneEarly]);

    const scene = makeScene({
      id: 'scene-main',
      active_characters: ['Alice'],
      scene_time: { temporal_zoned_datetime: LATE_TIME },
    });
    wrap(
      <SceneEditorDialog
        scene={scene}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    const ageBtns = screen.getAllByRole('button', { name: /Set character state/i });
    expect(ageBtns.length).toBeGreaterThan(0);
    fireEvent.click(ageBtns[0]);

    // Age picker dialog should appear
    const pickerDialogs = screen.getAllByRole('dialog');
    const agePicker = pickerDialogs.find((d: HTMLElement) =>
      d.getAttribute('aria-label')?.includes('character state')
    );
    expect(agePicker).toBeTruthy();
  });

  it('shows age picker controls on branch scenes created by back-jump destination time', () => {
    const ttBackJump: SourcebookEntry = {
      id: 'tt-back-jump',
      name: 'Back Jump',
      synonyms: [],
      description: 'Back jump that creates a branch in the past',
      images: [],
      category: 'Time Travel',
      creates_new_timeline: true,
      origin_date: '2026-05-16T12:00:00+00:00[UTC]',
      destination_datetime: '2026-05-10T12:00:00+00:00[UTC]',
    };
    sourcebookEntriesState.push(ttBackJump);

    const scene = makeScene({
      id: 'scene-on-branch',
      active_characters: ['Alice'],
      timeline_id: 'branch:tt-back-jump',
      scene_time: { temporal_zoned_datetime: '2026-05-13T12:00:00+00:00[UTC]' },
    });

    wrap(
      <SceneEditorDialog
        scene={scene}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    const ageBtns = screen.getAllByRole('button', { name: /Set character state/i });
    expect(ageBtns.length).toBeGreaterThan(0);
  });

  it('shows known ages as chips per timeline and allows selecting one', async () => {
    const sceneEarly = makeScene({
      id: 'scene-early',
      active_characters: ['Alice'],
      sourcebook_entry_ids: ['tt-jump-1'],
      scene_time: { temporal_zoned_datetime: EARLY_TIME },
      tag_personal_datetimes: [
        { role: 'active', ref: 'Alice', index: 0, personal_age: '17y' },
      ],
    });
    const sceneMain = makeScene({
      id: 'scene-main',
      active_characters: ['Alice'],
      scene_time: { temporal_zoned_datetime: LATE_TIME },
    });

    mockedUseScenes.mockReturnValue([sceneEarly, sceneMain]);
    const onSave = vi.fn<SceneSaveHandler>(async () => undefined);

    wrap(
      <SceneEditorDialog
        scene={sceneMain}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={onSave}
        onDelete={NOOP_DELETE}
      />
    );

    // Open age picker for Alice
    const ageBtns = screen.getAllByRole('button', { name: /Set character state/i });
    fireEvent.click(ageBtns[0]);

    // Known age chip "17y" should appear (from the TT-branch timeline)
    const chip = screen.getByRole('button', { name: '17y' });
    fireEvent.click(chip);

    // Save and verify the personal_age was set (chip click applies directly)
    const saveBtn = screen.getByRole('button', { name: /^Save$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    const arg = onSave.mock.calls[0][0] as Partial<Scene>;
    const tagDt = arg.tag_personal_datetimes ?? [];
    const aliceTag = tagDt.find(
      (t: SceneTagPersonalDatetime) =>
        t.role === 'active' && t.ref === 'Alice' && t.personal_age === '17y'
    );
    expect(aliceTag).toBeTruthy();
  });

  it('hydrates personal ages using tag index when the same character appears twice', () => {
    const scene = makeScene({
      active_characters: ['Alice', 'Alice'],
      tag_personal_datetimes: [
        { role: 'active', ref: 'Alice', index: 0, personal_age: '17y' },
        { role: 'active', ref: 'Alice', index: 1, personal_age: '61y' },
      ],
    });

    wrap(
      <SceneEditorDialog
        scene={scene}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    expect(screen.getByText('17y')).toBeTruthy();
    expect(screen.getByText('61y')).toBeTruthy();
  });

  it('lets the user select a computed character state without typing an age', async () => {
    const ttBackJump: SourcebookEntry = {
      id: 'tt-back-jump-manual',
      name: 'Back Jump Manual',
      synonyms: [],
      description: 'Back jump branch without prior personal age samples',
      images: [],
      category: 'Time Travel',
      creates_new_timeline: true,
      origin_date: '2026-05-16T12:00:00+00:00[UTC]',
      destination_datetime: '2026-05-10T12:00:00+00:00[UTC]',
    };
    sourcebookEntriesState.push(ttBackJump);

    const departureScene = makeScene({
      id: 'scene-departure',
      active_characters: ['Alice'],
      sourcebook_entry_ids: ['tt-back-jump-manual'],
      scene_time: { temporal_zoned_datetime: '2026-05-16T12:00:00+00:00[UTC]' },
    });
    mockedUseScenes.mockReturnValue([departureScene]);

    const scene = makeScene({
      id: 'scene-manual-age',
      active_characters: ['Alice'],
      timeline_id: 'branch:tt-back-jump-manual',
      scene_time: { temporal_zoned_datetime: '2026-05-13T12:00:00+00:00[UTC]' },
    });

    const onSave = vi.fn<SceneSaveHandler>(async () => undefined);

    wrap(
      <SceneEditorDialog
        scene={scene}
        isOpen
        onClose={NOOP_CLOSE}
        onSave={onSave}
        onDelete={NOOP_DELETE}
      />
    );

    const ageBtns = screen.getAllByRole('button', { name: /Set character state/i });
    fireEvent.click(ageBtns[0]);

    fireEvent.click(
      screen.getByRole('button', {
        name: /After time travel: Back Jump Manual/i,
      })
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    });

    const arg = onSave.mock.calls[0][0] as Partial<Scene>;
    const tagDt = arg.tag_personal_datetimes ?? [];
    const aliceTag = tagDt.find(
      (t: SceneTagPersonalDatetime) =>
        t.role === 'active' &&
        t.ref === 'Alice' &&
        t.personal_age === 'state:0001:tt:tt-back-jump-manual'
    );
    expect(aliceTag).toBeTruthy();
  });
});

// ─── Diff accept / reject ──────────────────────────────────────────────────

describe('SceneEditorDialog diff accept / reject', () => {
  it('marks summary section with data-diff when diff is visible', async () => {
    baselineScenesState.push(
      makeScene({
        id: 'scene-1',
        summary: 'Baseline summary',
      })
    );

    const { container } = wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-1',
          summary: 'AI-updated summary',
        })}
        isOpen={true}
        openedViaTrigger={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    // Wait for state to settle after effects.
    await waitFor(() => {
      const diffSection = document.body.querySelector('[data-diff="changed"]');
      expect(diffSection).toBeTruthy();
    });
  });

  it('does not mark sections with data-diff when no diff is visible', async () => {
    const { container } = wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-1',
          summary: 'Same summary',
        })}
        isOpen={true}
        openedViaTrigger={false}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    await waitFor(() => {
      expect(document.body.querySelector('[data-diff="changed"]')).toBeNull();
    });
  });

  it('clears data-diff from summary section after an external accept', async () => {
    baselineScenesState.push(
      makeScene({
        id: 'scene-1',
        summary: 'Baseline summary',
      })
    );

    const { container, rerender } = wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-1',
          summary: 'AI-updated summary',
        })}
        isOpen={true}
        openedViaTrigger={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    await waitFor(() => {
      expect(document.body.querySelector('[data-diff="changed"]')).toBeTruthy();
    });

    // Simulate the parent updating baseline to match (accept via store)
    baselineScenesState[0] = makeScene({
      id: 'scene-1',
      summary: 'AI-updated summary',
    });

    // Re-render with updated scene — diff should clear
    rerender(
      <I18nextProvider i18n={i18n}>
        <SceneEditorDialog
          scene={makeScene({
            id: 'scene-1',
            summary: 'AI-updated summary',
          })}
          isOpen={true}
          openedViaTrigger={true}
          onClose={NOOP_CLOSE}
          onSave={NOOP_SAVE}
          onDelete={NOOP_DELETE}
        />
      </I18nextProvider>
    );

    // After baseline update, no diff should remain
    await waitFor(() => {
      expect(document.body.querySelector('[data-diff="changed"]')).toBeNull();
    });
  });
});

// ─── Spec: diff only for automatic changes ──────────────────────────────────

describe('Spec: SceneEditorDialog diff rules', () => {
  it('shows NO data-diff when opened normally (not via AI trigger)', async () => {
    // SPEC: User opens scene editor normally → NO diff.
    baselineScenesState.push(
      makeScene({
        id: 'scene-1',
        summary: 'Baseline summary that differs',
      })
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-1',
          summary: 'Current summary',
        })}
        isOpen={true}
        openedViaTrigger={false}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    await waitFor(() => {
      // Even though baseline and current differ, normal open means no diff.
      expect(document.body.querySelector('[data-diff="changed"]')).toBeNull();
    });
  });

  it('shows data-diff when opened via AI trigger with changed summary', async () => {
    // SPEC: Scene editor opened via AI trigger notification → diff shown.
    baselineScenesState.push(
      makeScene({
        id: 'scene-1',
        summary: 'Old baseline summary',
      })
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-1',
          summary: 'New AI summary',
        })}
        isOpen={true}
        openedViaTrigger={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    await waitFor(() => {
      const diffSection = document.body.querySelector('[data-diff="changed"]');
      expect(diffSection).toBeTruthy();
    });
  });

  it('shows NO diff when opened normally with showDiff enabled and baseline already advanced', async () => {
    // SPEC: User manually edited and saved → parent advanced baseline →
    // reopening (even with showDiff enabled) should NOT show diff for
    // the summary the user typed themselves.
    baselineScenesState.push(
      makeScene({
        id: 'scene-1',
        summary: 'User-typed summary',
      })
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-1',
          summary: 'User-typed summary',
        })}
        isOpen={true}
        openedViaTrigger={false}
        defaultShowDiff={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    await waitFor(() => {
      // Baseline matches current → no diff, even with showDiff enabled.
      expect(document.body.querySelector('[data-diff="changed"]')).toBeNull();
    });
  });

  it('shows diff when opened normally with showDiff enabled and baseline differs from AI change', async () => {
    // SPEC: User has AI changes they haven't reviewed → opening with
    // showDiff enabled should still show the AI's diffs.
    baselineScenesState.push(
      makeScene({
        id: 'scene-1',
        summary: 'Old baseline',
      })
    );

    wrap(
      <SceneEditorDialog
        scene={makeScene({
          id: 'scene-1',
          summary: 'AI-updated summary',
        })}
        isOpen={true}
        openedViaTrigger={false}
        defaultShowDiff={true}
        onClose={NOOP_CLOSE}
        onSave={NOOP_SAVE}
        onDelete={NOOP_DELETE}
      />
    );

    await waitFor(() => {
      const diffSection = document.body.querySelector('[data-diff="changed"]');
      expect(diffSection).toBeTruthy();
    });
  });
});
