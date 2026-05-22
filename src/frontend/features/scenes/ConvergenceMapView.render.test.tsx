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
  order_before: [],
  order_after: [],
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
    [12, BigInt('1715522408000000000')],
    [16, BigInt('1715851200000000000')],
    [13, BigInt('1715616000000000000')],
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
  vi.restoreAllMocks();
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

  it('assigns a scene to a different timeline when the timeline dot is dragged left or right', async () => {
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

    const movedDot = dotGroup?.querySelectorAll('circle')[1] as SVGCircleElement | null;
    expect(movedDot).toBeTruthy();
    expect(movedDot?.getAttribute('cx')).toBe('8');
    expect(onAssignSceneTimeline).not.toHaveBeenCalled();

    fireEvent.pointerUp(timelineSvg as Element, {
      pointerId: 1,
      clientX: 10,
      clientY: 150,
    });

    expect(onAssignSceneTimeline).toHaveBeenCalledWith(13, 'main');
  });
});
