// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Drag and drop interaction tests for NarrativeView.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import i18n from '../app/i18n';
import { NarrativeView } from './NarrativeView';
import type { Scene, SceneId } from '../../types';
import type { Book, Chapter, SourcebookEntry } from '../../types/domain';

const { selectionState } = vi.hoisted(() => ({
  selectionState: {
    selectedSceneIds: new Set<SceneId>(),
    activeSceneId: null as SceneId | null,
    causeIds: new Set<SceneId>(),
    effectIds: new Set<SceneId>(),
    handleCardSelect: vi.fn(),
  },
}));

vi.mock('../layout/ThemeContext', () => ({
  useThemeClasses: () => ({ bg: '' }),
  useTheme: () => ({ isLight: true }),
}));

vi.mock('./ConstraintArrows', () => ({
  CauseArrows: () => null,
}));

vi.mock('./useSceneSelection', () => ({
  useSceneSelection: () => selectionState,
}));

vi.mock('./SceneCard', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SceneCard: ({ scene }: any) => <div data-scene-card={scene.id}>{scene.summary}</div>,
}));

beforeAll(() => {
  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  selectionState.selectedSceneIds = new Set<string>();
  selectionState.activeSceneId = null;
});

function makeScene(overrides: Record<string, unknown>): Scene {
  const legacy = overrides as {
    causes?: SceneId[];
    [key: string]: unknown;
  };
  return {
    id: 'scene-1',
    summary: 'Scene',
    beats: [],
    prose_link: {
      scope_type: 'story',
      chapter_id: null,
      book_id: null,
      start_offset: 0,
      end_offset: 5,
      content_hash: 'hash',
      is_stale: false,
    },
    active_characters: [],
    passive_characters: [],
    location: null,
    time: null,
    color_tag: null,
    status: 'active',
    pinboard_x: 0,
    pinboard_y: 0,
    causes: [...(legacy.causes ?? [])],
    ...rest,
  } as Scene;
}

function makeDataTransfer(): DataTransfer {
  const bag = new Map<string, string>();
  return {
    effectAllowed: 'all',
    dropEffect: 'move',
    files: {} as FileList,
    items: {} as DataTransferItemList,
    types: [],
    clearData: (format?: string) => {
      if (format) {
        bag.delete(format);
      } else {
        bag.clear();
      }
    },
    getData: (format: string) => bag.get(format) ?? '',
    setData: (format: string, data: string) => {
      bag.set(format, data);
    },
    setDragImage: () => undefined,
  } as unknown as DataTransfer;
}

describe('NarrativeView drag reorder interactions', () => {
  it.each([
    {
      label: 'no affected scenes selected and no active scene',
      selectedSceneIds: new Set<string>(),
      activeSceneId: null,
    },
    {
      label: 'some affected scenes selected with active scene',
      selectedSceneIds: new Set<string>(['a']),
      activeSceneId: 'a',
    },
    {
      label: 'all affected scenes selected with no active scene',
      selectedSceneIds: new Set<string>(['a', 'b']),
      activeSceneId: null,
    },
  ])(
    'calls onReorderScene when dragging one scene onto another ($label)',
    async ({
      selectedSceneIds,
      activeSceneId,
    }: {
      label: string;
      selectedSceneIds: Set<SceneId>;
      activeSceneId: SceneId | null;
    }) => {
      selectionState.selectedSceneIds = selectedSceneIds;
      selectionState.activeSceneId = activeSceneId;

      const onReorderScene = vi.fn(async () => undefined);
      const sceneA = makeScene({ id: 'a', summary: 'A' });
      const sceneB = makeScene({ id: 'b', summary: 'B' });

      const { getByText } = render(
        <I18nextProvider i18n={i18n}>
          <NarrativeView
            scenes={[sceneA, sceneB]}
            projectType="novel"
            chapters={[]}
            books={[]}
            primarySelectedSceneId={null}
            onSelectScene={vi.fn()}
            onSelectionChange={vi.fn()}
            onEditScene={vi.fn()}
            onReorderScene={onReorderScene}
          />
        </I18nextProvider>
      );

      const sourceWrapper = getByText('A').parentElement as HTMLDivElement;
      const targetWrapper = getByText('B').parentElement as HTMLDivElement;
      const transfer = makeDataTransfer();

      vi.spyOn(targetWrapper, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 100,
        width: 200,
        height: 80,
        top: 100,
        left: 0,
        right: 200,
        bottom: 180,
        toJSON: () => ({}),
      });

      fireEvent.dragStart(sourceWrapper, { dataTransfer: transfer });
      fireEvent.dragOver(targetWrapper, { dataTransfer: transfer, clientY: 110 });
      fireEvent.drop(targetWrapper, { dataTransfer: transfer, clientY: 110 });

      await waitFor(() => {
        expect(onReorderScene).toHaveBeenCalledWith('a', 'b', expect.any(Boolean));
      });
    }
  );

  it('does not call onReorderScene when dropped onto the same scene', async () => {
    const onReorderScene = vi.fn(async () => undefined);
    const sceneA = makeScene({ id: 'a', summary: 'A' });

    const { getByText } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={[sceneA]}
          projectType="novel"
          chapters={[]}
          books={[]}
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
          onReorderScene={onReorderScene}
        />
      </I18nextProvider>
    );

    const wrapper = getByText('A').parentElement as HTMLDivElement;
    const transfer = makeDataTransfer();

    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 100,
      width: 200,
      height: 80,
      top: 100,
      left: 0,
      right: 200,
      bottom: 180,
      toJSON: () => ({}),
    });

    fireEvent.dragStart(wrapper, { dataTransfer: transfer });
    fireEvent.dragOver(wrapper, { dataTransfer: transfer, clientY: 110 });
    fireEvent.drop(wrapper, { dataTransfer: transfer, clientY: 110 });

    await waitFor(() => {
      expect(onReorderScene).not.toHaveBeenCalled();
    });
  });

  it('uses last drag-over hint for placeBefore and text/plain drag payload fallback', async () => {
    const onReorderScene = vi.fn(async () => undefined);
    const sceneA = makeScene({ id: 1, summary: 'A' });
    const sceneB = makeScene({ id: 2, summary: 'B' });

    const { getByText } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={[sceneA, sceneB]}
          projectType="novel"
          chapters={[]}
          books={[]}
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
          onReorderScene={onReorderScene}
        />
      </I18nextProvider>
    );

    const sourceWrapper = getByText('A').parentElement as HTMLDivElement;
    const targetWrapper = getByText('B').parentElement as HTMLDivElement;
    const transfer = makeDataTransfer();

    vi.spyOn(targetWrapper, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 100,
      width: 200,
      height: 80,
      top: 100,
      left: 0,
      right: 200,
      bottom: 180,
      toJSON: () => ({}),
    });

    fireEvent.dragStart(sourceWrapper, { dataTransfer: transfer });

    // Emulate a browser that only preserves text/plain in the drop payload.
    transfer.clearData('application/x-augmentedquill-scene-id');

    // Drag over lower half => placeBefore should be false and reused on drop.
    fireEvent.dragOver(targetWrapper, { dataTransfer: transfer, clientY: 179 });

    // Drop with a conflicting coordinate: if handler ignored hint, this would
    // wrongly reorder as placeBefore=true.
    fireEvent.drop(targetWrapper, { dataTransfer: transfer, clientY: 101 });

    await waitFor(() => {
      expect(onReorderScene).toHaveBeenCalledWith(1, 2, false);
    });
  });

  it('highlights chapter break as a valid drop target and calls onDropScenesOnChapter', async () => {
    const onDropScenesOnChapter = vi.fn(async () => undefined);
    const onReorderScene = vi.fn(async () => undefined);
    const sceneSource = makeScene({
      id: 'source',
      summary: 'Source',
      prose_link: null,
    });
    const sceneChapter = makeScene({
      id: 'chapter-scene',
      summary: 'Chapter Scene',
      prose_link: {
        scope_type: 'chapter',
        chapter_id: '1',
        book_id: null,
        start_offset: 0,
        end_offset: 10,
        content_hash: 'hash',
        is_stale: false,
      },
    });

    const { getByText, container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={[sceneSource, sceneChapter]}
          projectType="novel"
          chapters={[{ id: '1', title: 'Chapter 1', summary: '', content: '' }]}
          books={[]}
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
          onReorderScene={onReorderScene}
          onDropScenesOnChapter={onDropScenesOnChapter}
        />
      </I18nextProvider>
    );

    const sourceWrapper = getByText('Source').parentElement as HTMLDivElement;
    const chapterBreak = container.querySelector(
      '[data-break-kind="chapter"]'
    ) as HTMLDivElement;
    const chapterDropWrapper = chapterBreak.parentElement as HTMLDivElement;
    const transfer = makeDataTransfer();

    fireEvent.dragStart(sourceWrapper, { dataTransfer: transfer });
    fireEvent.dragOver(chapterDropWrapper, { dataTransfer: transfer });

    expect(chapterDropWrapper.className).toContain('ring-1');

    fireEvent.drop(chapterDropWrapper, { dataTransfer: transfer });

    await waitFor(() => {
      expect(onDropScenesOnChapter).toHaveBeenCalledWith(['source'], '1');
    });
  });
});

describe('NarrativeView series sorting and grouping', () => {
  it('renders scenes in book/chapter order when books chapter metadata lacks chapter ids', () => {
    const books: Book[] = [
      {
        id: 'book-1',
        title: 'Book 1',
        chapters: [
          { title: 'Book 1 Chapter 1', summary: '', content: '' } as Chapter,
          { title: 'Book 1 Chapter 2', summary: '', content: '' } as Chapter,
        ],
      },
      {
        id: 'book-2',
        title: 'Book 2',
        chapters: [{ title: 'Book 2 Chapter 1', summary: '', content: '' } as Chapter],
      },
    ];

    const chapters: Chapter[] = [
      {
        id: '1',
        title: 'Book 1 Chapter 1',
        summary: '',
        content: '',
        book_id: 'book-1',
      },
      {
        id: '2',
        title: 'Book 1 Chapter 2',
        summary: '',
        content: '',
        book_id: 'book-1',
      },
      {
        id: '3',
        title: 'Book 2 Chapter 1',
        summary: '',
        content: '',
        book_id: 'book-2',
      },
    ];

    const scenes: Scene[] = [
      makeScene({
        id: 'scene-b2-c1-a',
        summary: 'B2C1-A',
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '3',
          book_id: 'book-2',
          start_offset: 0,
          end_offset: 8,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'scene-b1-c2-a',
        summary: 'B1C2-A',
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '2',
          book_id: 'book-1',
          start_offset: 0,
          end_offset: 8,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'scene-b1-c1-a',
        summary: 'B1C1-A',
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          book_id: 'book-1',
          start_offset: 0,
          end_offset: 8,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'scene-b2-c1-b',
        summary: 'B2C1-B',
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '3',
          book_id: 'book-2',
          start_offset: 10,
          end_offset: 18,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'scene-b1-c1-b',
        summary: 'B1C1-B',
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          book_id: 'book-1',
          start_offset: 10,
          end_offset: 18,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          projectType="series"
          chapters={chapters}
          books={books}
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    const renderedSceneOrder = Array.from(
      container.querySelectorAll('[data-scene-card]')
    ).map((el: Element) => el.textContent?.trim());

    expect(renderedSceneOrder).toEqual([
      'B1C1-A',
      'B1C1-B',
      'B1C2-A',
      'B2C1-A',
      'B2C1-B',
    ]);

    const separators = Array.from(container.querySelectorAll('[aria-label]')).map(
      (el: Element) => el.getAttribute('aria-label')
    );
    expect(separators).toContain('Book: Book 1');
    expect(separators).toContain('Chapter: Book 1 Chapter 1');
    expect(separators).toContain('Chapter: Book 1 Chapter 2');
    expect(separators).toContain('Book: Book 2');
    expect(separators).toContain('Chapter: Book 2 Chapter 1');

    const sequence = separators.filter(
      (label: string | null) =>
        label === 'Book: Book 1' ||
        label === 'Chapter: Book 1 Chapter 1' ||
        label === 'Chapter: Book 1 Chapter 2' ||
        label === 'Book: Book 2' ||
        label === 'Chapter: Book 2 Chapter 1'
    );
    expect(sequence).toEqual([
      'Book: Book 1',
      'Chapter: Book 1 Chapter 1',
      'Chapter: Book 1 Chapter 2',
      'Book: Book 2',
      'Chapter: Book 2 Chapter 1',
    ]);
  });

  it('keeps unlinked scenes interleaved by narrative order_index inside chapter runs', () => {
    const chapters: Chapter[] = [
      {
        id: '1',
        title: 'Chapter 1',
        summary: '',
        content: '',
      },
      {
        id: '2',
        title: 'Chapter 2',
        summary: '',
        content: '',
      },
    ];

    const scenes: Scene[] = [
      makeScene({
        id: 'c1-a',
        summary: 'C1-A',
        order_index: 1,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          book_id: null,
          start_offset: 0,
          end_offset: 8,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'unlinked-between',
        summary: 'UNLINKED',
        order_index: 2,
        prose_link: null,
      }),
      makeScene({
        id: 'c1-b',
        summary: 'C1-B',
        order_index: 3,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          book_id: null,
          start_offset: 20,
          end_offset: 28,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'c2-a',
        summary: 'C2-A',
        order_index: 5,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '2',
          book_id: null,
          start_offset: 0,
          end_offset: 8,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          projectType="novel"
          chapters={chapters}
          books={[]}
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    const renderedSceneOrder = Array.from(
      container.querySelectorAll('[data-scene-card]')
    ).map((el: Element) => el.textContent?.trim());
    expect(renderedSceneOrder).toEqual(['C1-A', 'UNLINKED', 'C1-B', 'C2-A']);

    expect(container.querySelectorAll('[data-break-kind="chapter"]').length).toBe(2);
  });

  it('does not render a visible chapter line before the first scene card', () => {
    const chapters: Chapter[] = [
      { id: '1', title: 'Chapter 1', summary: '', content: '' },
      { id: '2', title: 'Chapter 2', summary: '', content: '' },
    ];
    const scenes: Scene[] = [
      makeScene({
        id: 'scene-1',
        summary: 'Scene 1',
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          book_id: null,
          start_offset: 0,
          end_offset: 5,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'scene-2',
        summary: 'Scene 2',
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '2',
          book_id: null,
          start_offset: 10,
          end_offset: 15,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          projectType="novel"
          chapters={chapters}
          books={[]}
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    const firstChapterBreak = container.querySelector(
      '[data-break-kind="chapter"][data-leading-break="true"]'
    );
    expect(firstChapterBreak).toBeTruthy();
    expect(firstChapterBreak?.querySelector('div.h-px')).toBeNull();
  });

  it('does not render chapter separators for scenes linked to unknown chapters', () => {
    const chapters: Chapter[] = [
      { id: '1', title: 'Chapter 1', summary: '', content: '' },
    ];
    const scenes: Scene[] = [
      makeScene({
        id: 'scene-stale-link',
        summary: 'Stale Link Scene',
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '999',
          book_id: null,
          start_offset: 0,
          end_offset: 5,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          projectType="novel"
          chapters={chapters}
          books={[]}
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    expect(container.querySelectorAll('[data-break-kind="chapter"]').length).toBe(0);
    expect(container.querySelectorAll('[data-break-kind="book"]').length).toBe(0);
  });
});

// eslint-disable-next-line max-lines-per-function
describe('NarrativeView chronological sorting', () => {
  it('does not render chapter or book separators in chronological mode', () => {
    const chapters: Chapter[] = [
      { id: '1', title: 'Chapter 1', summary: '', content: '', book_id: 'book-1' },
      { id: '2', title: 'Chapter 2', summary: '', content: '', book_id: 'book-1' },
    ];
    const books: Book[] = [
      { id: 'book-1', title: 'Book 1', chapters: [] as Chapter[] },
    ];
    const scenes: Scene[] = [
      makeScene({
        id: 'scene-1',
        summary: 'Scene 1',
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          book_id: 'book-1',
          start_offset: 0,
          end_offset: 5,
          content_hash: 'hash',
          is_stale: false,
        },
        scene_time: {
          temporal_zoned_datetime: '2024-03-01T12:00:00+00:00[UTC][u-ca=gregory]',
        },
      }),
      makeScene({
        id: 'scene-2',
        summary: 'Scene 2',
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '2',
          book_id: 'book-1',
          start_offset: 10,
          end_offset: 15,
          content_hash: 'hash',
          is_stale: false,
        },
        scene_time: {
          temporal_zoned_datetime: '2024-03-02T12:00:00+00:00[UTC][u-ca=gregory]',
        },
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          projectType="series"
          chapters={chapters}
          books={books}
          sortMode="chronological"
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    expect(container.querySelectorAll('[data-break-kind="chapter"]').length).toBe(0);
    expect(container.querySelectorAll('[data-break-kind="book"]').length).toBe(0);
  });

  it('sorts by scene_time while allowing flashback ordering independent of prose order', () => {
    const scenes: Scene[] = [
      makeScene({
        id: 'late-prose-early-time',
        summary: 'Flashback',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 100,
          end_offset: 110,
          content_hash: 'hash',
          is_stale: false,
        },
        scene_time: {
          temporal_zoned_datetime: '2024-03-01T12:00:00+00:00[UTC][u-ca=gregory]',
        },
      }),
      makeScene({
        id: 'early-prose-late-time',
        summary: 'Present',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 10,
          end_offset: 20,
          content_hash: 'hash',
          is_stale: false,
        },
        scene_time: {
          temporal_zoned_datetime: '2024-03-02T12:00:00+00:00[UTC][u-ca=gregory]',
        },
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          projectType="novel"
          chapters={[]}
          books={[]}
          sortMode="chronological"
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    const renderedSceneOrder = Array.from(
      container.querySelectorAll('[data-scene-card]')
    ).map((el: Element) => el.textContent?.trim());

    expect(renderedSceneOrder).toEqual(['Flashback', 'Present']);
  });

  it('falls back to prose position for scenes without valid scene_time', () => {
    const scenes: Scene[] = [
      makeScene({
        id: 'timed',
        summary: 'Timed',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 5,
          end_offset: 8,
          content_hash: 'hash',
          is_stale: false,
        },
        scene_time: {
          temporal_zoned_datetime: '2024-03-01T10:00:00+00:00[UTC][u-ca=gregory]',
        },
      }),
      makeScene({
        id: 'untimed-2',
        summary: 'Untimed B',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 70,
          end_offset: 80,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'untimed-1',
        summary: 'Untimed A',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 30,
          end_offset: 40,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'invalid-time',
        summary: 'Invalid Time',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 50,
          end_offset: 60,
          content_hash: 'hash',
          is_stale: false,
        },
        scene_time: { temporal_zoned_datetime: 'not-a-valid-temporal-value' },
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          projectType="novel"
          chapters={[]}
          books={[]}
          sortMode="chronological"
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    const renderedSceneOrder = Array.from(
      container.querySelectorAll('[data-scene-card]')
    ).map((el: Element) => el.textContent?.trim());

    expect(renderedSceneOrder).toEqual([
      'Timed',
      'Untimed A',
      'Invalid Time',
      'Untimed B',
    ]);
  });

  it('keeps only unlinked and untimed scenes in the Not yet linked section', () => {
    const scenes: Scene[] = [
      makeScene({
        id: 'linked-untimed',
        summary: 'Linked Untimed',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 10,
          end_offset: 20,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'unlinked-timed',
        summary: 'Unlinked Timed',
        prose_link: null,
        scene_time: {
          temporal_zoned_datetime: '2024-02-01T10:00:00+00:00[UTC][u-ca=gregory]',
        },
      }),
      makeScene({
        id: 'unlinked-untimed',
        summary: 'Unlinked Untimed',
        prose_link: null,
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          projectType="novel"
          chapters={[]}
          books={[]}
          sortMode="chronological"
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    const renderSequence = Array.from(
      container.querySelectorAll('[data-scene-card], [role="separator"]')
    ).map((el: Element) => {
      const separatorLabel = el.getAttribute('aria-label');
      return separatorLabel || el.textContent?.trim() || '';
    });

    const headerIndex = renderSequence.indexOf('Scenes not yet linked to prose');
    expect(headerIndex).toBeGreaterThan(-1);

    const unlinkedTimedIndex = renderSequence.indexOf('Unlinked Timed');
    const unlinkedUntimedIndex = renderSequence.indexOf('Unlinked Untimed');

    expect(unlinkedTimedIndex).toBeGreaterThan(-1);
    expect(unlinkedUntimedIndex).toBeGreaterThan(-1);
    expect(unlinkedTimedIndex).toBeLessThan(headerIndex);
    expect(unlinkedUntimedIndex).toBeGreaterThan(headerIndex);
  });

  it('interleaves a linked untimed scene between timed scenes using prose order', () => {
    const scenes: Scene[] = [
      makeScene({
        id: 'timed-early',
        summary: 'Timed Early',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 10,
          end_offset: 20,
          content_hash: 'hash',
          is_stale: false,
        },
        scene_time: {
          temporal_zoned_datetime: '2024-02-01T10:00:00+00:00[UTC][u-ca=gregory]',
        },
      }),
      makeScene({
        id: 'untimed-middle',
        summary: 'Untimed Middle',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 50,
          end_offset: 60,
          content_hash: 'hash',
          is_stale: false,
        },
      }),
      makeScene({
        id: 'timed-late',
        summary: 'Timed Late',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 90,
          end_offset: 100,
          content_hash: 'hash',
          is_stale: false,
        },
        scene_time: {
          temporal_zoned_datetime: '2024-02-01T12:00:00+00:00[UTC][u-ca=gregory]',
        },
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          projectType="novel"
          chapters={[]}
          books={[]}
          sortMode="chronological"
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    const renderedSceneOrder = Array.from(
      container.querySelectorAll('[data-scene-card]')
    ).map((el: Element) => el.textContent?.trim());

    expect(renderedSceneOrder).toEqual(['Timed Early', 'Untimed Middle', 'Timed Late']);
  });

  it('treats invalid scene_time like untimed and places it by prose position', () => {
    const scenes: Scene[] = [
      makeScene({
        id: 'timed-early',
        summary: 'Timed Early',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 10,
          end_offset: 20,
          content_hash: 'hash',
          is_stale: false,
        },
        scene_time: {
          temporal_zoned_datetime: '2024-02-01T10:00:00+00:00[UTC][u-ca=gregory]',
        },
      }),
      makeScene({
        id: 'invalid-middle',
        summary: 'Invalid Middle',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 50,
          end_offset: 60,
          content_hash: 'hash',
          is_stale: false,
        },
        scene_time: { temporal_zoned_datetime: 'not-a-valid-temporal-value' },
      }),
      makeScene({
        id: 'timed-late',
        summary: 'Timed Late',
        prose_link: {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
          start_offset: 90,
          end_offset: 100,
          content_hash: 'hash',
          is_stale: false,
        },
        scene_time: {
          temporal_zoned_datetime: '2024-02-01T12:00:00+00:00[UTC][u-ca=gregory]',
        },
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          projectType="novel"
          chapters={[]}
          books={[]}
          sortMode="chronological"
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    const renderedSceneOrder = Array.from(
      container.querySelectorAll('[data-scene-card]')
    ).map((el: Element) => el.textContent?.trim());

    expect(renderedSceneOrder).toEqual(['Timed Early', 'Invalid Middle', 'Timed Late']);
  });

  it('keeps an unlinked timed scene out of the Not yet linked section', () => {
    const scenes: Scene[] = [
      makeScene({
        id: 'zz-unlinked-timed',
        summary: 'Unlinked Timed',
        prose_link: null,
        scene_time: {
          temporal_zoned_datetime: '2024-02-01T09:00:00+00:00[UTC][u-ca=gregory]',
        },
      }),
      makeScene({
        id: 'aa-unlinked-untimed',
        summary: 'Unlinked Untimed',
        prose_link: null,
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          projectType="novel"
          chapters={[]}
          books={[]}
          sortMode="chronological"
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    const renderSequence = Array.from(
      container.querySelectorAll('[data-scene-card], [role="separator"]')
    ).map((el: Element) => {
      const separatorLabel = el.getAttribute('aria-label');
      return separatorLabel || el.textContent?.trim() || '';
    });

    const headerIndex = renderSequence.indexOf('Scenes not yet linked to prose');
    const timedIndex = renderSequence.indexOf('Unlinked Timed');
    const untimedIndex = renderSequence.indexOf('Unlinked Untimed');

    expect(headerIndex).toBeGreaterThan(-1);
    expect(timedIndex).toBeGreaterThan(-1);
    expect(untimedIndex).toBeGreaterThan(-1);
    expect(timedIndex).toBeLessThan(headerIndex);
    expect(untimedIndex).toBeGreaterThan(headerIndex);
  });
});

describe('NarrativeView sourcebook lanes', () => {
  it('shows referenced character lanes and filters scenes by selected entries', () => {
    const sourcebookEntries: SourcebookEntry[] = [
      {
        id: 'alice',
        name: 'Alice',
        synonyms: [],
        category: 'Character',
        description: '',
        images: [],
      },
      {
        id: 'bob',
        name: 'Bob',
        synonyms: [],
        category: 'character',
        description: '',
        images: [],
      },
      {
        id: 'harbor',
        name: 'Harbor',
        synonyms: [],
        category: 'Location',
        description: '',
        images: [],
      },
    ];

    const scenes: Scene[] = [
      makeScene({
        id: 'scene-a',
        summary: 'Alice Active',
        active_characters: ['Alice'],
        sourcebook_entry_ids: ['harbor'],
      }),
      makeScene({
        id: 'scene-b',
        summary: 'Alice Passive',
        passive_characters: ['Alice'],
      }),
      makeScene({
        id: 'scene-c',
        summary: 'Bob Active',
        active_characters: ['Bob'],
      }),
    ];

    const { container, getByRole, queryByText } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          sourcebookEntries={sourcebookEntries}
          projectType="novel"
          chapters={[]}
          books={[]}
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    const laneLabels = Array.from(
      container.querySelectorAll('[data-sourcebook-lane-label]')
    ).map((element: Element) => element.textContent?.trim());

    expect(laneLabels).toEqual(['Alice', 'Bob']);
    expect(queryByText('Harbor')).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Alice' }));

    expect(queryByText('Alice Active')).not.toBeNull();
    expect(queryByText('Alice Passive')).not.toBeNull();
    expect(queryByText('Bob Active')).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Bob' }), { ctrlKey: true });

    expect(queryByText('Bob Active')).not.toBeNull();

    expect(
      container
        .querySelector('[data-scene-link-marker="scene-a:alice"]')
        ?.getAttribute('data-link-style')
    ).toBe('solid');
    expect(
      container
        .querySelector('[data-scene-link-marker="scene-b:alice"]')
        ?.getAttribute('data-link-style')
    ).toBe('hollow');
    expect(container.querySelector('[data-sourcebook-line="alice"]')).not.toBeNull();
  });

  it('extends sourcebook lines to full scroll height', async () => {
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(1200);

    const sourcebookEntries: SourcebookEntry[] = [
      {
        id: 'alice',
        name: 'Alice',
        synonyms: [],
        category: 'Character',
        description: '',
        images: [],
      },
    ];

    const scenes: Scene[] = [
      makeScene({
        id: 'scene-a',
        summary: 'Alice Active',
        active_characters: ['Alice'],
      }),
    ];

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          sourcebookEntries={sourcebookEntries}
          projectType="novel"
          chapters={[]}
          books={[]}
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    const overlay = container.querySelector(
      '.pointer-events-none.absolute.inset-0.z-0'
    );
    const markerOverlay = container.querySelector(
      '.pointer-events-none.absolute.inset-0.z-20'
    );
    const lineElement = container.querySelector('[data-sourcebook-line="alice"]');
    const linePlane = lineElement?.parentElement;

    await waitFor(() => {
      expect(overlay).not.toBeNull();
      expect(markerOverlay).not.toBeNull();
      expect(overlay?.className).not.toContain('overflow-hidden');
      expect(markerOverlay?.className).not.toContain('overflow-hidden');
      expect(linePlane).not.toBeNull();
      expect(linePlane?.style.height).toBe('1200px');
    });

    scrollHeightSpy.mockRestore();
  });

  it('allows removing and adding sourcebook lanes', () => {
    const sourcebookEntries: SourcebookEntry[] = [
      {
        id: 'alice',
        name: 'Alice',
        synonyms: [],
        category: 'Character',
        description: '',
        images: [],
      },
      {
        id: 'bob',
        name: 'Bob',
        synonyms: [],
        category: 'Character',
        description: '',
        images: [],
      },
      {
        id: 'harbor',
        name: 'Harbor',
        synonyms: [],
        category: 'Location',
        description: '',
        images: [],
      },
    ];

    const scenes: Scene[] = [
      makeScene({
        id: 'scene-a',
        summary: 'Alice Scene',
        active_characters: ['Alice'],
      }),
      makeScene({
        id: 'scene-b',
        summary: 'Bob Scene',
        active_characters: ['Bob'],
      }),
    ];

    const { container, getByRole, getByText, queryByRole } = render(
      <I18nextProvider i18n={i18n}>
        <NarrativeView
          scenes={scenes}
          sourcebookEntries={sourcebookEntries}
          projectType="novel"
          chapters={[]}
          books={[]}
          primarySelectedSceneId={null}
          onSelectScene={vi.fn()}
          onSelectionChange={vi.fn()}
          onEditScene={vi.fn()}
        />
      </I18nextProvider>
    );

    fireEvent.click(getByRole('button', { name: 'Remove Bob' }));
    expect(queryByRole('button', { name: 'Bob' })).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Add sourcebook lane' }));
    fireEvent.click(getByText('Harbor'));

    const laneLabelsAfterAdd = Array.from(
      container.querySelectorAll('[data-sourcebook-lane-label]')
    ).map((element: Element) => element.textContent?.trim());
    expect(laneLabelsAfterAdd).toEqual(['Alice', 'Harbor']);

    expect(
      container.querySelector('[data-sourcebook-lane-item="alice"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-sourcebook-lane-item="harbor"]')
    ).not.toBeNull();
  });
});
