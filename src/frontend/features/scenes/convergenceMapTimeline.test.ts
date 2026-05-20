// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for deterministic Convergence Map timeline lane allocation.
 */

import { describe, expect, it } from 'vitest';
import type { Scene } from '../../types';
import type { SourcebookEntry } from '../../types/domain';
import { parseZonedDateTime } from '../../utils/temporal';
import {
  buildTimelinePanelModel,
  type TimelineJumpEvent,
} from './convergenceMapTimeline';

const makeScene: (
  id: number,
  iso: string,
  timelineId?: string,
  sourcebookEntryIds?: string[]
) => Scene = (
  id: number,
  iso: string,
  timelineId: string = 'main',
  sourcebookEntryIds: string[] = []
): Scene => ({
  id,
  summary: `Scene ${id}`,
  beats: [],
  active_characters: [],
  passive_characters: [],
  sourcebook_entry_ids: sourcebookEntryIds,
  location: null,
  time: null,
  scene_time: { temporal_zoned_datetime: iso },
  timeline_id: timelineId,
  color_tag: null,
  prose_link: null,
  order_before: [],
  order_after: [],
  pinboard_x: 0,
  pinboard_y: 0,
  status: 'active',
});

const makeEntry: (
  id: string,
  origin: string,
  destination: string,
  createsNewTimeline: boolean,
  timelineId?: string
) => SourcebookEntry = (
  id: string,
  origin: string,
  destination: string,
  createsNewTimeline: boolean,
  timelineId?: string
): SourcebookEntry => ({
  id,
  name: id,
  synonyms: [],
  description: id,
  images: [],
  category: 'Time Travel',
  origin_date: origin,
  destination_datetime: destination,
  creates_new_timeline: createsNewTimeline,
  timeline_id: timelineId ?? null,
});

const buildEpochMap: (scenes: Scene[]) => Map<number, bigint> = (
  scenes: Scene[]
): Map<number, bigint> => {
  const nsById = new Map<number, bigint>();
  scenes.forEach((scene: Scene): void => {
    const parsed = parseZonedDateTime(
      scene.scene_time?.temporal_zoned_datetime ?? null
    );
    if (parsed !== null) {
      nsById.set(scene.id, parsed.epochNanoseconds);
    }
  });
  return nsById;
};

describe('buildTimelinePanelModel', () => {
  it('maps scene lanes from explicit timeline_id values', () => {
    const scenes: Scene[] = [
      makeScene(1, '2026-05-11T10:00:00Z[UTC]', 'main'),
      makeScene(2, '2026-05-12T10:00:00Z[UTC]', 'branch:alpha'),
      makeScene(3, '2026-05-13T10:00:00Z[UTC]', 'branch:beta'),
    ];

    const model = buildTimelinePanelModel(scenes, [], buildEpochMap(scenes));

    expect(model.laneBySceneId.get(1)).toBe(0);
    expect(model.laneBySceneId.get(2)).toBe(1);
    expect(model.laneBySceneId.get(3)).toBe(2);
    expect(model.laneNumbers).toEqual([0, 1, 2]);
  });

  it('keeps overlapping branch timelines on separate lanes', () => {
    const scenes: Scene[] = [
      makeScene(1, '2026-05-11T10:00:00Z[UTC]', 'main'),
      makeScene(2, '2026-05-12T10:00:00Z[UTC]', 'branch:alpha'),
      makeScene(3, '2026-05-12T10:00:00Z[UTC]', 'branch:beta'),
    ];

    const model = buildTimelinePanelModel(scenes, [], buildEpochMap(scenes));

    expect(model.laneBySceneId.get(1)).toBe(0);
    expect(model.laneBySceneId.get(2)).toBe(1);
    expect(model.laneBySceneId.get(3)).toBe(2);
    expect(model.laneNumbers).toEqual([0, 1, 2]);
  });

  it('routes branch events to the entry timeline_id lane', () => {
    const scenes: Scene[] = [
      makeScene(1, '2026-05-19T14:02:35+00:00[UTC][u-ca=gregory]', 'main', [
        'tt-branch',
      ]),
      makeScene(2, '2026-05-17T12:00:00+00:00[UTC][u-ca=gregory]', 'branch:branch-1'),
    ];

    const entries: SourcebookEntry[] = [
      makeEntry(
        'tt-branch',
        '2026-05-19T14:02:35+00:00[UTC][u-ca=gregory]',
        '2026-05-17T12:00:00+00:00[UTC][u-ca=gregory]',
        true,
        'branch:branch-1'
      ),
    ];

    const model = buildTimelinePanelModel(scenes, entries, buildEpochMap(scenes));
    const jump = model.events.find(
      (event: TimelineJumpEvent) => event.entryId === 'tt-branch'
    );

    expect(jump).toBeDefined();
    expect(jump?.sourceLane).toBe(model.laneBySceneId.get(2));
    expect(jump?.destinationLane).not.toBe(jump?.sourceLane);
    expect(model.laneNumbers).toContain(jump?.sourceLane ?? -1);
    expect(model.laneNumbers).toContain(jump?.destinationLane ?? -1);
  });

  it('normalizes non-prefixed sourcebook timeline_id for branch lineage', () => {
    const scenes: Scene[] = [
      makeScene(1, '2026-05-11T13:59:33+00:00[UTC][u-ca=gregory]', 'branch:16->10'),
      makeScene(2, '2026-05-17T12:00:00+00:00[UTC][u-ca=gregory]', 'branch:19->17'),
      makeScene(3, '2026-05-18T14:03:37+00:00[UTC][u-ca=gregory]', 'main'),
    ];

    const entries: SourcebookEntry[] = [
      makeEntry(
        '19->17',
        '2026-05-19T14:02:35+00:00[UTC][u-ca=gregory]',
        '2026-05-17T12:00:00+00:00[UTC][u-ca=gregory]',
        true,
        '16->10'
      ),
    ];

    const model = buildTimelinePanelModel(scenes, entries, buildEpochMap(scenes));
    const jump = model.events.find(
      (event: TimelineJumpEvent) => event.entryId === '19->17'
    );

    expect(jump).toBeDefined();
    expect(jump?.sourceLane).toBe(model.laneBySceneId.get(1));
    expect(jump?.sourceLane).not.toBe(0);
  });

  it('creates a destination lane for branch events even when no scene exists there yet', () => {
    const scenes: Scene[] = [
      makeScene(1, '2026-05-19T14:02:35+00:00[UTC][u-ca=gregory]', 'main', [
        'tt-future-branch',
      ]),
    ];

    const entries: SourcebookEntry[] = [
      makeEntry(
        'tt-future-branch',
        '2026-05-19T14:02:35+00:00[UTC][u-ca=gregory]',
        '2026-05-17T12:00:00+00:00[UTC][u-ca=gregory]',
        true,
        'branch:future'
      ),
    ];

    const model = buildTimelinePanelModel(scenes, entries, buildEpochMap(scenes));
    const jump = model.events.find(
      (event: TimelineJumpEvent) => event.entryId === 'tt-future-branch'
    );

    expect(jump).toBeDefined();
    expect(jump?.destinationLane).not.toBe(jump?.sourceLane);
    expect(model.laneNumbers).toContain(0);
    expect(model.laneNumbers).toContain(jump?.sourceLane ?? -1);
    expect(model.laneNumbers).toContain(jump?.destinationLane ?? -1);
  });

  it('builds sourcebook fallback events without departure scenes using origin and destination datetimes', () => {
    const scenes: Scene[] = [
      makeScene(1, '2026-05-17T12:00:00+00:00[UTC][u-ca=gregory]', 'branch:19->17'),
      makeScene(2, '2026-05-18T14:03:37+00:00[UTC][u-ca=gregory]', 'main'),
    ];
    const entries: SourcebookEntry[] = [
      makeEntry(
        '19->17',
        '2026-05-19T14:02:35+00:00[UTC][u-ca=gregory]',
        '2026-05-17T12:00:00+00:00[UTC][u-ca=gregory]',
        true,
        'main'
      ),
    ];

    const model = buildTimelinePanelModel(scenes, entries, buildEpochMap(scenes));
    const jump = model.events.find(
      (event: TimelineJumpEvent) => event.entryId === '19->17'
    );

    expect(jump).toBeDefined();
    expect(jump?.departureSceneId).toBeNull();
    expect(jump?.sourceLane).toBe(0);
    expect(jump?.destinationLane).toBe(1);
  });

  it('emits exactly one jump per sourcebook time-travel entry', () => {
    const scenes: Scene[] = [
      makeScene(1, '2026-05-11T13:59:33+00:00[UTC][u-ca=gregory]', 'branch:16->10'),
      makeScene(2, '2026-05-12T14:00:08+00:00[UTC][u-ca=gregory]', 'main'),
      makeScene(3, '2026-05-14T14:01:39+00:00[UTC][u-ca=gregory]', 'main'),
      makeScene(4, '2026-05-17T12:00:00+00:00[UTC][u-ca=gregory]', 'branch:19->17'),
      makeScene(5, '2026-05-18T14:03:37+00:00[UTC][u-ca=gregory]', 'main'),
      makeScene(6, '2026-05-20T14:03:55+00:00[UTC][u-ca=gregory]', 'branch:19->17'),
    ];

    const entries: SourcebookEntry[] = [
      makeEntry(
        '16->10',
        '2026-05-16T13:57:11+00:00[UTC][u-ca=gregory]',
        '2026-05-10T13:58:26+00:00[UTC][u-ca=gregory]',
        true,
        'main'
      ),
      makeEntry(
        '15->13',
        '2026-05-15T14:00:52+00:00[UTC][u-ca=gregory]',
        '2026-05-13T14:00:57+00:00[UTC][u-ca=gregory]',
        false,
        'branch:16->10'
      ),
      makeEntry(
        '19->17',
        '2026-05-19T14:02:35+00:00[UTC][u-ca=gregory]',
        '2026-05-17T12:00:00+00:00[UTC][u-ca=gregory]',
        true,
        'main'
      ),
    ];

    const model = buildTimelinePanelModel(scenes, entries, buildEpochMap(scenes));

    expect(model.events).toHaveLength(3);

    const jump1610 = model.events.find(
      (event: TimelineJumpEvent) => event.entryId === '16->10'
    );
    const jump1513 = model.events.find(
      (event: TimelineJumpEvent) => event.entryId === '15->13'
    );
    const jump1917 = model.events.find(
      (event: TimelineJumpEvent) => event.entryId === '19->17'
    );

    expect(jump1610).toBeDefined();
    expect(jump1610?.sourceLane).toBe(0);
    expect(jump1610?.destinationLane).toBe(1);

    expect(jump1513).toBeDefined();
    expect(jump1513?.sourceLane).toBe(1);
    expect(jump1513?.destinationLane).toBe(1);

    expect(jump1917).toBeDefined();
    expect(jump1917?.sourceLane).toBe(0);
    expect(jump1917?.destinationLane).toBe(2);
    expect(model.laneNumbers).toEqual([0, 1, 2]);
  });

  it('does not build jumps from legacy scene-local time travel events', () => {
    const sceneWithLegacyEvent = makeScene(
      1,
      '2026-05-16T13:57:11+00:00[UTC][u-ca=gregory]',
      'main'
    ) as Scene & {
      time_travel_events?: Array<{ target_datetime?: string }>;
    };
    sceneWithLegacyEvent.time_travel_events = [
      { target_datetime: '2026-05-10T13:58:26+00:00[UTC][u-ca=gregory]' },
    ];

    const scenes: Scene[] = [sceneWithLegacyEvent];
    const model = buildTimelinePanelModel(scenes, [], buildEpochMap(scenes));

    expect(model.events).toHaveLength(0);
  });
});
