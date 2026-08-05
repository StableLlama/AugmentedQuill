// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Render-level tests for Convergence Map snake ordering.
 */

// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../app/i18n';
import { parseZonedDateTime } from '../../utils/temporal';
import { ConvergenceMapView } from './ConvergenceMapView';
import type { Scene, SceneId } from '../../types';
import type { Book, Chapter, SourcebookEntry } from '../../types/domain';
import type { UseSceneLanesResult } from './useSceneLanes';

const noopDispatch = <T,>(_: React.SetStateAction<T>): void => undefined;
const noopMouseDown = (_: React.MouseEvent<HTMLElement>): void => undefined;
const noopMouseEvent = (_: React.MouseEvent<HTMLButtonElement>): void => undefined;
const noopDragEvent = (_: React.DragEvent<HTMLElement>): void => undefined;
const noopDragEnd = (): void => undefined;

const mockLaneButtonRefs = {
  current: new Map<string, HTMLButtonElement>(),
} as React.MutableRefObject<Map<string, HTMLButtonElement>>;

const mockAddLaneButtonRef = { current: null as HTMLButtonElement | null };

const bobEntry: SourcebookEntry = {
  id: 'Bob',
  name: 'Bob',
  synonyms: [],
  description: 'Character Bob',
  images: [],
  category: 'Character',
};

const makeScene = (
  id: SceneId,
  summary: string,
  sceneTime: string,
  timelineId: string
): Scene => ({
  id,
  summary,
  beats: [],
  active_characters: ['Bob'],
  passive_characters: [],
  sourcebook_entry_ids: [],
  location: null,
  time: null,
  scene_time: { temporal_zoned_datetime: sceneTime },
  color_tag: null,
  causes: [],
  pinboard_x: 0,
  pinboard_y: 0,
  status: 'active',
  timeline_id: timelineId,
});

const scenes = [
  makeScene(12, '12', '2026-05-12T14:00:08+00:00[UTC]', 'main'),
  makeScene(16, '16', '2026-05-16T12:00:00+00:00[UTC]', 'main'),
  makeScene(13, '13', '2026-05-13T12:00:00+00:00[UTC]', 'branch:16->10'),
];

const chapters: Chapter[] = [];
const books: Book[] = [];

const mockLanes = {
  visibleLaneEntryIds: ['Bob'],
  selectedLaneEntryIds: new Set<string>(),
  dragLaneEntryId: null,
  laneDropHint: null,
  pickerOpen: false,
  pickerQuery: '',
  pickerPosition: null,
  laneScrollLeft: 0,
  sourcebookEntriesById: new Map<string, SourcebookEntry>([['Bob', bobEntry]]),
  sceneEntryMarkerStyles: new Map<SceneId, Map<string, string>>(),
  markerStyleBySceneId: new Map<SceneId, Map<string, string>>([
    [12, new Map([['Bob', 'solid']])],
    [16, new Map([['Bob', 'solid']])],
    [13, new Map([['Bob', 'solid']])],
  ]),
  filteredScenes: scenes,
  sceneEpochNanosecondsById: new Map<SceneId, bigint>([
    [12, BigInt('1778594408000000000')],
    [16, BigInt('1778932800000000000')],
    [13, BigInt('1778673600000000000')],
  ]),
  referencedCharacterEntryIds: ['Bob'],
  projectImageByFilename: new Map<string, { url: string }>(),
  availableSourcebookEntries: [bobEntry],
  laneButtonRefs: mockLaneButtonRefs,
  addLaneButtonRef: mockAddLaneButtonRef,
  handleLaneSelect: noopMouseEvent,
  handleLaneRemove: (): void => undefined,
  handleLaneAdd: (): void => undefined,
  handleLaneDragStart: noopDragEvent,
  handleLaneDragEnd: noopDragEnd,
  handleLaneDragOver: noopDragEvent,
  handleLaneDrop: noopDragEvent,
  handleBackgroundMouseDown: noopMouseDown,
  setPickerOpen: noopDispatch<boolean>,
  setPickerQuery: noopDispatch<string>,
  setLaneScrollLeft: noopDispatch<number>,
  updatePickerAlignment: (): void => undefined,
} as unknown as UseSceneLanesResult;

vi.mock('../layout/ThemeContext', () => ({
  useTheme: vi.fn(() => ({ isLight: true })),
}));

vi.mock('./useSceneLanes', () => ({
  useSceneLanes: vi.fn(() => mockLanes),
  isCharacterEntry: (entry: SourcebookEntry | undefined): boolean =>
    Boolean(entry && entry.category?.toLowerCase() === 'character'),
}));

vi.mock('./useSceneSelection', () => ({
  useSceneSelection: vi.fn(() => ({
    selectedSceneIds: new Set<SceneId>(),
    activeSceneId: null as SceneId | null,
    handleCardSelect: vi.fn(),
  })),
}));

vi.mock('./SceneCard', () => ({
  SceneCard: ({ scene }: { scene: Scene }) => (
    <div data-scene-id={scene.id}>{scene.summary}</div>
  ),
}));

vi.mock('./LaneHeader', () => ({
  LaneHeader: ({
    lanes,
    laneTrackRef,
    prefixContent,
  }: {
    lanes: UseSceneLanesResult;
    laneTrackRef: React.RefObject<HTMLDivElement | null>;
    prefixContent?: React.ReactNode;
  }) => (
    <div ref={laneTrackRef} data-lane-track="true" style={{ display: 'flex' }}>
      {prefixContent}
      {lanes.visibleLaneEntryIds.map((entryId: string) => (
        <button
          key={entryId}
          ref={(el: HTMLButtonElement | null) => {
            if (el) {
              lanes.laneButtonRefs.current.set(entryId, el);
            } else {
              lanes.laneButtonRefs.current.delete(entryId);
            }
          }}
          type="button"
          data-lane-id={entryId}
          aria-label={entryId}
          style={{ width: 144 }}
        >
          {entryId}
        </button>
      ))}
    </div>
  ),
}));

beforeAll(() => {
  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);

  const mockGetBoundingClientRect = function (this: Element): DOMRect {
    const laneId = this.getAttribute?.('data-lane-id');
    if (laneId === 'Bob') {
      return {
        x: 200,
        y: 0,
        left: 200,
        top: 0,
        right: 344,
        bottom: 96,
        width: 144,
        height: 96,
        toJSON: () => ({}),
      } as DOMRect;
    }

    if (this.getAttribute?.('aria-label') === 'Prose narrative order') {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 144,
        bottom: 96,
        width: 144,
        height: 96,
        toJSON: () => ({}),
      } as DOMRect;
    }

    if (this.getAttribute?.('data-lane-track') === 'true') {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 400,
        bottom: 96,
        width: 400,
        height: 96,
        toJSON: () => ({}),
      } as DOMRect;
    }

    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    mockGetBoundingClientRect as unknown as () => DOMRect
  );
  vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockImplementation(
    mockGetBoundingClientRect as unknown as () => DOMRect
  );

  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
    this: HTMLElement
  ): number {
    const sceneId =
      this.querySelector('[data-scene-id]')?.getAttribute('data-scene-id');
    if (sceneId === '12') return 100;
    if (sceneId === '16') return 200;
    if (sceneId === '13') return 150;
    return 0;
  });

  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement
  ): number {
    const sceneId =
      this.querySelector('[data-scene-id]')?.getAttribute('data-scene-id');
    if (sceneId === '12') return 40;
    if (sceneId === '16') return 40;
    if (sceneId === '13') return 40;
    return 40;
  });

  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(
    function (): number {
      return 0;
    }
  );

  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement
  ): number {
    const laneId = this.getAttribute('data-lane-id');
    if (laneId === 'Bob') return 144;
    return 144;
  });
});

afterEach(() => {
  cleanup();
  mockLaneButtonRefs.current.clear();
  vi.clearAllMocks();
});

const wrap = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe('ConvergenceMapView render ordering', () => {
  it('renders Bob snake nodes in 12 -> 16 -> 13 order', async () => {
    const { container } = wrap(
      <ConvergenceMapView
        scenes={scenes}
        sourcebookEntries={[bobEntry]}
        projectType="series"
        chapters={chapters}
        books={books}
        primarySelectedSceneId={null}
        onSelectScene={(): void => undefined}
        editorSettings={{
          fontSize: 18,
          maxWidth: 60,
          brightness: 0.95,
          contrast: 0.9,
          theme: 'mixed',
          sidebarWidth: 320,
          showDiff: true,
        }}
      />
    );

    await waitFor(() => {
      const snakeGroups = container.querySelectorAll('svg:not([aria-hidden="true"]) g');
      expect(snakeGroups.length).toBeGreaterThanOrEqual(2);
    });

    const overlaySvg = container.querySelector('svg:not([aria-hidden="true"])');
    expect(overlaySvg).toBeTruthy();
    const bobGroup = overlaySvg?.querySelectorAll('g')[1];
    expect(bobGroup).toBeTruthy();

    const circleYs = Array.from(bobGroup?.querySelectorAll('circle') ?? []).map(
      (circle: Element) => (circle as SVGCircleElement).getAttribute('cy')
    );

    expect(circleYs).toEqual(['120', '220', '170']);
  });

  it('updates timeline dot preview while dragging left or right', async () => {
    const onAssignSceneTimeline = vi.fn();
    const { container } = wrap(
      <ConvergenceMapView
        scenes={scenes}
        sourcebookEntries={[bobEntry]}
        projectType="series"
        chapters={chapters}
        books={books}
        primarySelectedSceneId={null}
        onSelectScene={(): void => undefined}
        onAssignSceneTimeline={onAssignSceneTimeline}
        editorSettings={{
          fontSize: 18,
          maxWidth: 60,
          brightness: 0.95,
          contrast: 0.9,
          theme: 'mixed',
          sidebarWidth: 320,
          showDiff: true,
        }}
      />
    );

    await waitFor(() => {
      expect(container.querySelector('[data-scene-dot-id="13"]')).toBeTruthy();
    });

    const timelineSvg = container.querySelector('svg[aria-hidden="true"]');
    const dotGroup = container.querySelector('[data-scene-dot-id="13"]');
    expect(timelineSvg).toBeTruthy();
    expect(dotGroup).toBeTruthy();

    fireEvent.pointerDown(dotGroup?.querySelector('circle') as Element, {
      pointerId: 1,
      clientX: 50,
      clientY: 150,
    });
    fireEvent.pointerMove(timelineSvg as Element, {
      pointerId: 1,
      clientX: 10,
      clientY: 150,
    });

    expect(dotGroup?.querySelectorAll('circle').length).toBeGreaterThan(0);
    expect(onAssignSceneTimeline).not.toHaveBeenCalled();

    fireEvent.pointerUp(timelineSvg as Element, {
      pointerId: 1,
      clientX: 10,
      clientY: 150,
    });
  });

  it('renders prose snake chapter/book break tick markers', async () => {
    const chapterScenes: Scene[] = [
      {
        ...scenes[0],
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          book_id: 'book-1',
          start_offset: 0,
          end_offset: 5,
          content_hash: 'a',
          is_stale: false,
        },
      },
      {
        ...scenes[1],
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '2',
          book_id: 'book-1',
          start_offset: 10,
          end_offset: 20,
          content_hash: 'b',
          is_stale: false,
        },
      },
      {
        ...scenes[2],
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '3',
          book_id: 'book-2',
          start_offset: 30,
          end_offset: 40,
          content_hash: 'c',
          is_stale: false,
        },
      },
    ];

    const chaptersWithBooks: Chapter[] = [
      { id: '1', title: 'Chapter 1', summary: '', content: '', book_id: 'book-1' },
      { id: '2', title: 'Chapter 2', summary: '', content: '', book_id: 'book-1' },
      { id: '3', title: 'Chapter 3', summary: '', content: '', book_id: 'book-2' },
    ];
    const booksWithChapters: Book[] = [
      {
        id: 'book-1',
        title: 'Book 1',
        chapters: [
          { id: '1', title: 'Chapter 1', summary: '', content: '' } as Chapter,
          { id: '2', title: 'Chapter 2', summary: '', content: '' } as Chapter,
        ],
      },
      {
        id: 'book-2',
        title: 'Book 2',
        chapters: [
          { id: '3', title: 'Chapter 3', summary: '', content: '' } as Chapter,
        ],
      },
    ];

    const originalFilteredScenes = mockLanes.filteredScenes;
    mockLanes.filteredScenes = chapterScenes;

    const { container } = wrap(
      <ConvergenceMapView
        scenes={chapterScenes}
        sourcebookEntries={[bobEntry]}
        projectType="series"
        chapters={chaptersWithBooks}
        books={booksWithChapters}
        primarySelectedSceneId={null}
        onSelectScene={(): void => undefined}
        editorSettings={{
          fontSize: 18,
          maxWidth: 60,
          brightness: 0.95,
          contrast: 0.9,
          theme: 'mixed',
          sidebarWidth: 320,
          showDiff: true,
        }}
      />
    );

    await waitFor(() => {
      expect(container.querySelectorAll('[data-prose-break]').length).toBe(2);
    });

    expect(container.querySelectorAll('[data-prose-break="chapter"]').length).toBe(1);
    expect(container.querySelectorAll('[data-prose-break="book"]').length).toBe(1);

    mockLanes.filteredScenes = originalFilteredScenes;
  });

  it('places prose break markers on distinct transitions when chronology differs from chapter order', async () => {
    const timelineScrambledScenes: Scene[] = [
      {
        ...scenes[0],
        id: 1,
        summary: '1',
        scene_time: { temporal_zoned_datetime: '2026-05-13T12:00:00+00:00[UTC]' },
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          book_id: 'book-1',
          start_offset: 0,
          end_offset: 5,
          content_hash: 'a',
          is_stale: false,
        },
      },
      {
        ...scenes[1],
        id: 2,
        summary: '2',
        scene_time: { temporal_zoned_datetime: '2026-05-12T12:00:00+00:00[UTC]' },
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '2',
          book_id: 'book-1',
          start_offset: 10,
          end_offset: 20,
          content_hash: 'b',
          is_stale: false,
        },
      },
      {
        ...scenes[2],
        id: 3,
        summary: '3',
        scene_time: { temporal_zoned_datetime: '2026-05-14T12:00:00+00:00[UTC]' },
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '3',
          book_id: 'book-1',
          start_offset: 30,
          end_offset: 40,
          content_hash: 'c',
          is_stale: false,
        },
      },
    ];

    const chaptersSameBook: Chapter[] = [
      { id: '1', title: 'Chapter 1', summary: '', content: '', book_id: 'book-1' },
      { id: '2', title: 'Chapter 2', summary: '', content: '', book_id: 'book-1' },
      { id: '3', title: 'Chapter 3', summary: '', content: '', book_id: 'book-1' },
    ];

    const originalFilteredScenes = mockLanes.filteredScenes;
    const originalEpochMap = mockLanes.sceneEpochNanosecondsById;
    const originalOffsetTop = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetTop'
    );

    mockLanes.filteredScenes = timelineScrambledScenes;
    mockLanes.sceneEpochNanosecondsById = new Map<SceneId, bigint>([
      [2, BigInt('1715515200000000000')],
      [1, BigInt('1715601600000000000')],
      [3, BigInt('1715688000000000000')],
    ]);

    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement
    ): number {
      const sceneId =
        this.querySelector('[data-scene-id]')?.getAttribute('data-scene-id') ?? '';
      if (sceneId === '2') return 100;
      if (sceneId === '1') return 150;
      if (sceneId === '3') return 200;
      return 0;
    });

    const { container } = wrap(
      <ConvergenceMapView
        scenes={timelineScrambledScenes}
        sourcebookEntries={[bobEntry]}
        projectType="series"
        chapters={chaptersSameBook}
        books={[
          {
            id: 'book-1',
            title: 'Book 1',
            chapters: chaptersSameBook,
          },
        ]}
        primarySelectedSceneId={null}
        onSelectScene={(): void => undefined}
        editorSettings={{
          fontSize: 18,
          maxWidth: 60,
          brightness: 0.95,
          contrast: 0.9,
          theme: 'mixed',
          sidebarWidth: 320,
          showDiff: true,
        }}
      />
    );

    await waitFor(() => {
      expect(container.querySelectorAll('[data-prose-break="chapter"]').length).toBe(2);
    });

    const markerYs = Array.from(
      container.querySelectorAll('[data-prose-break="chapter"] line:first-child')
    )
      .map((line: Element) => Number((line as SVGLineElement).getAttribute('y1')))
      .sort((a: number, b: number) => a - b);

    const markerXs = Array.from(
      container.querySelectorAll('[data-prose-break="chapter"] line:first-child')
    )
      .map((line: Element) => {
        const svgLine = line as SVGLineElement;
        const x1 = Number(svgLine.getAttribute('x1'));
        const x2 = Number(svgLine.getAttribute('x2'));
        return (x1 + x2) / 2;
      })
      .sort((a: number, b: number) => a - b);

    // Expected transitions for prose order 1 -> 2 -> 3 with chronology 2 -> 1 -> 3:
    // break(1,2) at y=145 and break(2,3) at y=170 using mocked centers.
    expect(markerYs).toEqual([145, 170]);
    // One break is on the inter-run connector (mid X), the other on the run lane.
    expect(markerXs[0]).toBeLessThan(markerXs[1]);

    mockLanes.filteredScenes = originalFilteredScenes;
    mockLanes.sceneEpochNanosecondsById = originalEpochMap;
    if (originalOffsetTop) {
      Object.defineProperty(HTMLElement.prototype, 'offsetTop', originalOffsetTop);
    }
  });

  it('renders branch spawn lines and dotted arrows colored by the causing scene', async () => {
    const ttEntry: SourcebookEntry = {
      id: 'tt-jump',
      name: 'tt-jump',
      synonyms: [],
      description: 'DeLorean jump',
      images: [],
      category: 'Time Travel',
      origin_date: '2026-05-12T14:00:08+00:00[UTC]',
      destination_datetime: '2026-05-13T12:00:00+00:00[UTC]',
      creates_new_timeline: true,
      timeline_id: 'main',
    };

    // Scene 12 (blue) departs from main; scene 13 (green) lands on the branch
    // the jump creates.
    const ttScenes: Scene[] = [
      {
        ...scenes[0],
        sourcebook_entry_ids: ['tt-jump'],
        timeline_id: 'main',
        color_tag: 'blue',
      },
      {
        ...scenes[2],
        sourcebook_entry_ids: [],
        timeline_id: 'branch:tt-jump',
        color_tag: 'green',
      },
      scenes[1],
    ];

    const originalFilteredScenes = mockLanes.filteredScenes;
    mockLanes.filteredScenes = ttScenes;

    const { container } = wrap(
      <ConvergenceMapView
        scenes={ttScenes}
        sourcebookEntries={[ttEntry, bobEntry]}
        projectType="series"
        chapters={chapters}
        books={books}
        primarySelectedSceneId={null}
        onSelectScene={(): void => undefined}
        editorSettings={{
          fontSize: 18,
          maxWidth: 60,
          brightness: 0.95,
          contrast: 0.9,
          theme: 'mixed',
          sidebarWidth: 320,
          showDiff: true,
        }}
      />
    );

    await waitFor(() => {
      expect(container.querySelector('[data-scene-dot-id="13"]')).toBeTruthy();
    });

    const timelineSvg = container.querySelector('[data-scene-dot-id]')?.closest('svg');
    const allPaths = Array.from(timelineSvg?.querySelectorAll('path') ?? []);

    // 1) The spawned timeline gets a horizontal "side going" line from the
    // parent timeline (main, column 0 → X=8) across to its own lane (column 2
    // → X=64), followed by a rounded knee and a vertical line to the bottom.
    const spawnPath = allPaths.find((path: Element) => {
      const d = path.getAttribute('d') ?? '';
      return d.startsWith('M 8,') && d.includes(' L 64,');
    });
    expect(spawnPath).toBeTruthy();
    const spawnD = spawnPath?.getAttribute('d') ?? '';
    // Horizontal lead from main (X=8), a rounded knee (arc), then the vertical
    // trunk at the branch lane (X=64) — the directory-tree spawn shape.
    expect(spawnD.startsWith('M 8,')).toBe(true);
    expect(spawnD.includes(' a ')).toBe(true);
    expect(spawnD.includes(' L 64,')).toBe(true);

    // 2) The branch-creating jump is a VERTICAL arrow on its OWN swimlane
    // (column 1 → X=36, between main and the branch): it departs from the
    // origin scene marker on the source lane, leads a short way horizontally,
    // has a knee, then extends vertically to the branch point. It is DOTTED
    // and colored like the causing scene (scene 12 → blue #60a5fa). The
    // arrowhead is vertical.
    const jumpArrow = allPaths.find((path: Element) => {
      const me = path.getAttribute('marker-end') ?? '';
      if (!me.includes('tl-arrow-up') && !me.includes('tl-arrow-down')) {
        return false;
      }
      const d = path.getAttribute('d') ?? '';
      const lastCoords = (d.split('L').pop() ?? '').trim();
      const [lastX] = lastCoords.split(',').map(Number);
      return lastX === 36;
    });
    expect(jumpArrow).toBeTruthy();
    expect(jumpArrow?.getAttribute('marker-end') ?? '').toMatch(
      /url\(#tl-arrow-(up|down)\)/
    );
    expect(jumpArrow?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(jumpArrow?.getAttribute('stroke')).toBe('#60a5fa');

    // 3) The destination scene (13, green) is a scene that happens at the exact
    // moment the jump arrives, so its marker is drawn at the TIP of the arrow —
    // on the jump's own swimlane (X=36) — colored like the scene (#4ade80),
    // with the card at the same height to the right.
    const destDot = Array.from(
      container.querySelector('[data-scene-dot-id="13"]')?.querySelectorAll('circle') ??
        []
    ).pop();
    expect(destDot?.getAttribute('cx')).toBe('36');
    expect(destDot?.getAttribute('cx')).not.toBe('64');
    expect(destDot?.getAttribute('fill')).toBe('#4ade80');

    // 4) The causing scene (12, blue) keeps its marker on the main timeline
    // (X=8), colored blue.
    const originDot = Array.from(
      container.querySelector('[data-scene-dot-id="12"]')?.querySelectorAll('circle') ??
        []
    ).pop();
    expect(originDot?.getAttribute('cx')).toBe('8');
    expect(originDot?.getAttribute('fill')).toBe('#60a5fa');

    mockLanes.filteredScenes = originalFilteredScenes;
  });

  it('renders the spawned timeline tree with horizontal spawn lines for a multi-branch story', async () => {
    const mkScene = (
      id: number,
      summary: string,
      time: string,
      timelineId: string,
      sourcebook: string[],
      color: string | null
    ): Scene => ({
      id,
      summary,
      beats: [],
      active_characters: [],
      passive_characters: [],
      sourcebook_entry_ids: sourcebook,
      location: null,
      time: null,
      scene_time: { temporal_zoned_datetime: time },
      color_tag: color,
      causes: [],
      pinboard_x: 0,
      pinboard_y: 0,
      status: 'active',
      timeline_id: timelineId,
    });
    const bttfScenes: Scene[] = [
      mkScene(
        1,
        'Twin Pines Mall',
        '1985-10-26T01:15:00Z',
        'main',
        ['1985 -> 2015'],
        'blue'
      ),
      mkScene(
        2,
        'The Libyan attack',
        '1985-10-26T01:35:00Z',
        'main',
        ['1985 -> 1955', '1985 -> 1885'],
        'blue'
      ),
      mkScene(
        3,
        'Arrival in 1955',
        '1955-11-05T22:04:00Z',
        'branch:1985 -> 1955',
        [],
        'blue'
      ),
      mkScene(
        4,
        'Enchantment Under the Sea',
        '1955-11-12T21:00:00Z',
        'branch:1985 -> 1955',
        [],
        'blue'
      ),
      mkScene(
        5,
        'Lightning sends Marty home',
        '1955-11-12T22:04:00Z',
        'branch:1985 -> 1955',
        [],
        'blue'
      ),
      mkScene(
        6,
        'Hill Valley 2015',
        '2015-10-21T18:00:00Z',
        'branch:1985 -> 2015',
        ['2015 -> 1985A'],
        'orange'
      ),
      mkScene(
        7,
        'Alternate 1985 (1985A)',
        '1985-10-27T09:00:00Z',
        'branch:2015 -> 1985A',
        ['1985A -> 1955'],
        'orange'
      ),
      mkScene(
        8,
        'Return to 1955',
        '1955-11-12T21:30:00Z',
        'branch:1985A -> 1955',
        [],
        'orange'
      ),
      mkScene(
        9,
        'The Old West, 1885',
        '1885-09-02T12:00:00Z',
        'branch:1985 -> 1885',
        [],
        'green'
      ),
      mkScene(10, 'The return home', '1985-10-27T12:00:00Z', 'main', [], 'green'),
    ];
    const mkEntry = (
      id: string,
      origin: string,
      dest: string,
      timelineId: string
    ): SourcebookEntry => ({
      id,
      name: id,
      synonyms: [],
      description: id,
      images: [],
      category: 'Time Travel',
      origin_date: origin,
      destination_datetime: dest,
      creates_new_timeline: true,
      timeline_id: timelineId,
    });
    const bttfEntries: SourcebookEntry[] = [
      mkEntry('1985 -> 1955', '1985-10-26T01:35:00Z', '1955-11-05T22:04:00Z', 'main'),
      mkEntry('1985 -> 2015', '1985-10-26T01:15:00Z', '2015-10-21T18:00:00Z', 'main'),
      mkEntry(
        '2015 -> 1985A',
        '2015-10-21T18:00:00Z',
        '1985-10-27T09:00:00Z',
        'branch:1985 -> 2015'
      ),
      mkEntry(
        '1985A -> 1955',
        '1985-10-27T09:00:00Z',
        '1955-11-12T21:30:00Z',
        'branch:2015 -> 1985A'
      ),
      mkEntry('1985 -> 1885', '1985-10-26T01:35:00Z', '1885-09-02T12:00:00Z', 'main'),
    ];

    const epochNsById = new Map<SceneId, bigint>();
    bttfScenes.forEach((s: Scene) => {
      const p = parseZonedDateTime(s.scene_time?.temporal_zoned_datetime ?? null);
      if (p) epochNsById.set(s.id, p.epochNanoseconds);
    });

    const yById: Record<number, number> = {
      9: 100,
      3: 160,
      4: 220,
      8: 280,
      5: 340,
      1: 400,
      2: 460,
      7: 520,
      10: 580,
      6: 640,
    };
    const originalOffsetTop = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetTop'
    );
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement
    ): number {
      const sceneId =
        this.querySelector('[data-scene-id]')?.getAttribute('data-scene-id') ?? '';
      return yById[Number(sceneId)] ?? 0;
    });

    const originalFilteredScenes = mockLanes.filteredScenes;
    const originalEpochMap = mockLanes.sceneEpochNanosecondsById;
    mockLanes.filteredScenes = bttfScenes;
    mockLanes.sceneEpochNanosecondsById = epochNsById;

    const { container } = wrap(
      <ConvergenceMapView
        scenes={bttfScenes}
        sourcebookEntries={bttfEntries}
        projectType="series"
        chapters={chapters}
        books={books}
        primarySelectedSceneId={null}
        onSelectScene={(): void => undefined}
        editorSettings={{
          fontSize: 18,
          maxWidth: 60,
          brightness: 0.95,
          contrast: 0.9,
          theme: 'mixed',
          sidebarWidth: 320,
          showDiff: true,
        }}
      />
    );

    await waitFor(() => {
      expect(container.querySelector('[data-scene-dot-id="1"]')).toBeTruthy();
    });

    const svg = container.querySelector('[data-scene-dot-id]')?.closest('svg');
    const allPaths = Array.from(svg?.querySelectorAll('path') ?? []);

    // The spawned timelines are drawn as a directory tree: each branch lane has
    // a horizontal "side going" spawn line from its parent, then a knee down.
    // There are 5 branches, so 5 spawn paths (no marker-end).
    const spawnPaths = allPaths.filter(
      (p: Element) => p.getAttribute('marker-end') === null
    );
    expect(spawnPaths.length).toBe(5);

    // Branches that leave main spawn from X=8...
    const mainChildSpawn = spawnPaths.find((p: Element) =>
      (p.getAttribute('d') ?? '').startsWith('M 8,')
    );
    expect(mainChildSpawn).toBeTruthy();

    // ...and a nested branch (1985A) spawns off the 2015 lane (X=64), proving
    // branches can still start off a non-main parent.
    const chainSpawn = spawnPaths.find((p: Element) =>
      (p.getAttribute('d') ?? '').startsWith('M 64,')
    );
    expect(chainSpawn).toBeTruthy();

    // Every time-travel arrow is dotted, colored like its causing scene
    // (blue / orange / green), and drawn on its own swimlane with a vertical
    // arrowhead (never sharing a lane with another jump or a timeline).
    const arrows = allPaths.filter((p: Element) =>
      (p.getAttribute('marker-end') ?? '').includes('tl-arrow-')
    );
    expect(arrows.length).toBe(5);
    arrows.forEach((a: Element) => {
      expect(a.getAttribute('stroke-dasharray')).toBeTruthy();
      expect(['#60a5fa', '#fb923c', '#4ade80']).toContain(a.getAttribute('stroke'));
      expect(a.getAttribute('marker-end') ?? '').toMatch(/url\(#tl-arrow-(up|down)\)/);
    });

    mockLanes.filteredScenes = originalFilteredScenes;
    mockLanes.sceneEpochNanosecondsById = originalEpochMap;
    if (originalOffsetTop) {
      Object.defineProperty(HTMLElement.prototype, 'offsetTop', originalOffsetTop);
    }
  });

  it("renders a non-branching join from the departure scene's own timeline (marker origin)", async () => {
    // A non-branching "return" from a branch timeline back to main.  The join
    // arrow must depart from the branch lane — where the departure scene's dot
    // sits — and then join main.  It must never start on main while the marker
    // is on the branch.
    const returnEntry: SourcebookEntry = {
      id: 'b->main',
      name: 'b->main',
      synonyms: [],
      description: 'Return from branch to main',
      images: [],
      category: 'Time Travel',
      origin_date: '2026-05-12T10:00:00+00:00[UTC]',
      destination_datetime: '2026-05-13T10:00:00+00:00[UTC]',
      creates_new_timeline: false,
      timeline_id: 'main',
    };
    const branchEntry: SourcebookEntry = {
      id: 'a->b',
      name: 'a->b',
      synonyms: [],
      description: 'Branch from main',
      images: [],
      category: 'Time Travel',
      origin_date: '2026-05-11T10:00:00+00:00[UTC]',
      destination_datetime: '2026-05-12T10:00:00+00:00[UTC]',
      creates_new_timeline: true,
      timeline_id: 'main',
    };

    const ttScenes: Scene[] = [
      {
        ...scenes[0],
        id: 1,
        summary: 'main dep',
        scene_time: { temporal_zoned_datetime: '2026-05-11T10:00:00+00:00[UTC]' },
        sourcebook_entry_ids: ['a->b'],
        timeline_id: 'main',
      },
      {
        ...scenes[2],
        id: 2,
        summary: 'branch dest',
        scene_time: { temporal_zoned_datetime: '2026-05-12T10:00:00+00:00[UTC]' },
        sourcebook_entry_ids: [],
        timeline_id: 'branch:a->b',
      },
      {
        ...scenes[1],
        id: 3,
        summary: 'branch dep',
        scene_time: { temporal_zoned_datetime: '2026-05-12T14:00:00+00:00[UTC]' },
        sourcebook_entry_ids: ['b->main'],
        timeline_id: 'branch:a->b',
      },
      {
        ...scenes[0],
        id: 4,
        summary: 'main dest',
        scene_time: { temporal_zoned_datetime: '2026-05-13T10:00:00+00:00[UTC]' },
        sourcebook_entry_ids: [],
        timeline_id: 'main',
      },
    ];

    const originalFilteredScenes = mockLanes.filteredScenes;
    const originalEpochMap = mockLanes.sceneEpochNanosecondsById;
    mockLanes.filteredScenes = ttScenes;
    const epochNsById = new Map<SceneId, bigint>();
    ttScenes.forEach((s: Scene) => {
      const p = parseZonedDateTime(s.scene_time?.temporal_zoned_datetime ?? null);
      if (p) epochNsById.set(s.id, p.epochNanoseconds);
    });
    mockLanes.sceneEpochNanosecondsById = epochNsById;

    const { container } = wrap(
      <ConvergenceMapView
        scenes={ttScenes}
        sourcebookEntries={[returnEntry, branchEntry, bobEntry]}
        projectType="series"
        chapters={chapters}
        books={books}
        primarySelectedSceneId={null}
        onSelectScene={(): void => undefined}
        editorSettings={{
          fontSize: 18,
          maxWidth: 60,
          brightness: 0.95,
          contrast: 0.9,
          theme: 'mixed',
          sidebarWidth: 320,
          showDiff: true,
        }}
      />
    );

    await waitFor(() => {
      expect(container.querySelector('[data-scene-dot-id="2"]')).toBeTruthy();
    });

    const timelineSvg = container.querySelector('[data-scene-dot-id]')?.closest('svg');
    const allPaths = Array.from(timelineSvg?.querySelectorAll('path') ?? []);

    // The non-branching return arrow uses a horizontal arrowhead (joins main to
    // its left).  Its path must START on the branch lane (X=64) — the departure
    // scene's timeline — not on main (X=8).
    const returnArrow = allPaths.find((path: Element) => {
      const me = path.getAttribute('marker-end') ?? '';
      if (!me.includes('tl-arrow-left') && !me.includes('tl-arrow-right')) {
        return false;
      }
      const d = path.getAttribute('d') ?? '';
      return d.startsWith('M 64,');
    });
    expect(returnArrow).toBeTruthy();
    const returnD = returnArrow?.getAttribute('d') ?? '';
    expect(returnD.startsWith('M 64,')).toBe(true);
    // ...runs to its own swimlane (X=92), then joins main (X=8).
    expect(returnD.includes(' L 92,')).toBe(true);
    expect(returnD.includes(' L 8,')).toBe(true);

    // No join arrow starts on main's lane when its departure scene is elsewhere.
    const badMainOrigin = allPaths.some((path: Element) => {
      const me = path.getAttribute('marker-end') ?? '';
      const d = path.getAttribute('d') ?? '';
      return (
        (me.includes('tl-arrow-left') || me.includes('tl-arrow-right')) &&
        d.startsWith('M 8,')
      );
    });
    expect(badMainOrigin).toBe(false);

    mockLanes.filteredScenes = originalFilteredScenes;
    mockLanes.sceneEpochNanosecondsById = originalEpochMap;
  });

  it('renders jumps with no departure scene / uncoloured scenes (track-color fallback)', async () => {
    // Regression guard: the arrow geometry memo used the theme ``trackColor``
    // before it was initialised (a TDZ crash), but the fallback only fired once
    // a jump had no departure scene or a scene with no color_tag.  This fixture
    // exercises both fallback paths and must render without throwing.
    const mkScene = (
      id: number,
      summary: string,
      time: string,
      timelineId: string,
      sourcebook: string[],
      color: string | null
    ): Scene => ({
      id,
      summary,
      beats: [],
      active_characters: [],
      passive_characters: [],
      sourcebook_entry_ids: sourcebook,
      location: null,
      time: null,
      scene_time: { temporal_zoned_datetime: time },
      color_tag: color,
      causes: [],
      pinboard_x: 0,
      pinboard_y: 0,
      status: 'active',
      timeline_id: timelineId,
    });
    const mkEntry = (
      id: string,
      origin: string,
      dest: string | null,
      createsNewTimeline: boolean,
      timelineId: string
    ): SourcebookEntry => ({
      id,
      name: id,
      synonyms: [],
      description: id,
      images: [],
      category: 'Time Travel',
      origin_date: origin,
      destination_datetime: dest,
      creates_new_timeline: createsNewTimeline,
      timeline_id: timelineId,
    });
    const fallbackScenes: Scene[] = [
      mkScene(1, 'The Present', '1985-06-01T12:00:00Z', 'main', ['2010 -> 1990'], null),
      mkScene(2, 'The Future', '2030-06-01T12:00:00Z', 'branch:1985 -> 2030', [], null),
    ];
    const fallbackEntries: SourcebookEntry[] = [
      // Branch-creating jump with NO departure scene (path 1 of the fallback).
      mkEntry(
        '1985 -> 2030',
        '1985-06-01T12:00:00Z',
        '2030-06-01T12:00:00Z',
        true,
        'main'
      ),
      // Non-branching jump whose departure scene has no color_tag (path 2).
      mkEntry(
        '2010 -> 1990',
        '1985-06-01T12:00:00Z',
        '1990-06-01T12:00:00Z',
        false,
        'main'
      ),
    ];

    const epochNsById = new Map<SceneId, bigint>();
    fallbackScenes.forEach((s: Scene) => {
      const p = parseZonedDateTime(s.scene_time?.temporal_zoned_datetime ?? null);
      if (p) epochNsById.set(s.id, p.epochNanoseconds);
    });

    const originalOffsetTop = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetTop'
    );
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement
    ): number {
      const sceneId =
        this.querySelector('[data-scene-id]')?.getAttribute('data-scene-id') ?? '';
      return { 1: 100, 2: 400 }[Number(sceneId)] ?? 0;
    });

    const originalFilteredScenes = mockLanes.filteredScenes;
    const originalEpochMap = mockLanes.sceneEpochNanosecondsById;
    mockLanes.filteredScenes = fallbackScenes;
    mockLanes.sceneEpochNanosecondsById = epochNsById;

    const { container } = wrap(
      <ConvergenceMapView
        scenes={fallbackScenes}
        sourcebookEntries={fallbackEntries}
        projectType="series"
        chapters={chapters}
        books={books}
        primarySelectedSceneId={null}
        onSelectScene={(): void => undefined}
        editorSettings={{
          fontSize: 18,
          maxWidth: 60,
          brightness: 0.95,
          contrast: 0.9,
          theme: 'mixed',
          sidebarWidth: 320,
          showDiff: true,
        }}
      />
    );

    await waitFor(() => {
      expect(container.querySelector('[data-scene-dot-id="1"]')).toBeTruthy();
    });

    const svg = container.querySelector('[data-scene-dot-id]')?.closest('svg');
    const arrows = Array.from(svg?.querySelectorAll('path') ?? []).filter(
      (p: Element) => (p.getAttribute('marker-end') ?? '').includes('tl-arrow-')
    );
    // Both jumps render a dotted arrow, and the uncoloured ones fall back to
    // the muted track color (#6366f1 in light mode) instead of crashing.
    expect(arrows.length).toBe(2);
    arrows.forEach((a: Element) => {
      expect(a.getAttribute('stroke-dasharray')).toBeTruthy();
      expect(a.getAttribute('stroke')).toBe('#6366f1');
    });

    mockLanes.filteredScenes = originalFilteredScenes;
    mockLanes.sceneEpochNanosecondsById = originalEpochMap;
    if (originalOffsetTop) {
      Object.defineProperty(HTMLElement.prototype, 'offsetTop', originalOffsetTop);
    }
  });
});
