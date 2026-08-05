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
  causes: [],
  causes: [],
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
    // main = 0, this jump's own swimlane = 1, the branch it creates = 2.
    expect(jump?.destinationLane).toBe(2);
    expect(jump?.lane).toBe(1);
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
    expect(jump1610?.destinationLane).toBe(4);

    expect(jump1513).toBeDefined();
    expect(jump1513?.sourceLane).toBe(4);
    expect(jump1513?.destinationLane).toBe(4);

    expect(jump1917).toBeDefined();
    expect(jump1917?.sourceLane).toBe(0);
    expect(jump1917?.destinationLane).toBe(2);
    // Columns: main=0, jump19->17=1, branch:19->17=2, jump16->10=3,
    // branch:16->10=4, jump15->13=5.  Timelines live on 0/2/4.
    expect(model.laneNumbers).toEqual([0, 1, 2, 3, 4, 5]);
    expect(model.timelineLaneNumbers).toEqual([0, 2, 4]);
  });

  it('does not emit an event for a time-travel entry with no destination', () => {
    // A time travel with incomplete data (missing destination) must not show a
    // time travel arrow: both endpoints are needed to draw one.
    const scenes: Scene[] = [
      makeScene(1, '2026-05-11T10:00:00+00:00[UTC][u-ca=gregory]', 'main', [
        'incomplete',
      ]),
    ];
    const incomplete: SourcebookEntry = {
      id: 'incomplete',
      name: 'incomplete',
      synonyms: [],
      description: 'A travel to parts unknown',
      images: [],
      category: 'Time Travel',
      origin_date: '2026-05-11T10:00:00+00:00[UTC][u-ca=gregory]',
      destination_datetime: null,
      creates_new_timeline: false,
      timeline_id: null,
    };
    const complete: SourcebookEntry = {
      ...makeEntry(
        'complete',
        '2026-05-11T10:00:00+00:00[UTC][u-ca=gregory]',
        '2026-05-13T10:00:00+00:00[UTC][u-ca=gregory]',
        false,
        'main'
      ),
      id: 'complete',
    };

    const model = buildTimelinePanelModel(
      scenes,
      [incomplete, complete],
      buildEpochMap(scenes)
    );

    // Only the complete entry produces an arrow; the destination-less one is
    // kept in the sourcebook but emits no timeline-panel event.
    expect(model.events).toHaveLength(1);
    expect(model.events[0]?.entryId).toBe('complete');
  });

  it("orders a parent's branch children by destination epoch descending so later arrivals sit closer to the parent", () => {
    const scenes: Scene[] = [
      makeScene(1, '2026-05-11T10:00:00Z[UTC]', 'main'),
      makeScene(2, '2026-05-12T10:00:00Z[UTC]', 'branch:early'),
      makeScene(3, '2026-05-14T10:00:00Z[UTC]', 'branch:late'),
    ];
    const entries: SourcebookEntry[] = [
      makeEntry(
        'early',
        '2026-05-11T10:00:00Z[UTC]',
        '2026-05-12T10:00:00Z[UTC]',
        true,
        'main'
      ),
      makeEntry(
        'late',
        '2026-05-11T10:00:00Z[UTC]',
        '2026-05-14T10:00:00Z[UTC]',
        true,
        'main'
      ),
    ];

    const model = buildTimelinePanelModel(scenes, entries, buildEpochMap(scenes));

    // 'branch:late' arrives later (larger destination epoch) → column 2,
    // closest to main (columns: main=0, late-jump=1, branch:late=2,
    // early-jump=3, branch:early=4).  'branch:early' arrives earlier → column 4.
    expect(model.laneBySceneId.get(3)).toBe(2);
    expect(model.laneBySceneId.get(2)).toBe(4);
  });

  it('never draws two timelines or time jumps over each other (one swimlane per item)', () => {
    // A story with a main timeline, two branches and a non-branching future
    // join that stays on the same timeline.
    const scenes: Scene[] = [
      makeScene(1, '2026-05-11T10:00:00Z[UTC]', 'main', ['a->b', 'future join']),
      makeScene(2, '2026-05-13T10:00:00Z[UTC]', 'main', ['a->c']),
      makeScene(3, '2026-05-12T10:00:00Z[UTC]', 'branch:a->b'),
      makeScene(4, '2026-05-14T10:00:00Z[UTC]', 'branch:a->c'),
      makeScene(5, '2026-05-15T10:00:00Z[UTC]', 'main'),
    ];
    const entries: SourcebookEntry[] = [
      makeEntry(
        'a->b',
        '2026-05-11T10:00:00Z[UTC]',
        '2026-05-12T10:00:00Z[UTC]',
        true,
        'main'
      ),
      makeEntry(
        'a->c',
        '2026-05-13T10:00:00Z[UTC]',
        '2026-05-14T10:00:00Z[UTC]',
        true,
        'main'
      ),
      makeEntry(
        'future join',
        '2026-05-11T10:00:00Z[UTC]',
        '2026-05-15T10:00:00Z[UTC]',
        false,
        'main'
      ),
    ];

    const model = buildTimelinePanelModel(scenes, entries, buildEpochMap(scenes));

    const timelineColumns = new Set<number>(model.timelineLaneNumbers);
    const jumpColumns = model.events.map((event: TimelineJumpEvent) => event.lane);

    // Universal rule: every swimlane holds at most ONE thing — either one
    // timeline or one time jump.
    jumpColumns.forEach((lane: number) => {
      expect(timelineColumns.has(lane)).toBe(false);
    });
    expect(new Set<number>(jumpColumns).size).toBe(jumpColumns.length);
    expect(new Set<number>(model.timelineLaneNumbers).size).toBe(
      model.timelineLaneNumbers.length
    );
    expect(new Set<number>(model.laneNumbers).size).toBe(model.laneNumbers.length);
  });

  it('lands a timeline on an even swimlane when two jumps sit to its left', () => {
    // main owns column 0; two non-branching joins reserve columns 1 and 2;
    // then the branch-creating jump reserves column 3 and the branch it
    // creates lands on column 4 — an EVEN swimlane.
    const scenes: Scene[] = [
      makeScene(1, '2026-05-11T10:00:00Z[UTC]', 'main', ['join-1', 'join-2', 'a->b']),
      makeScene(2, '2026-05-12T10:00:00Z[UTC]', 'branch:a->b'),
      makeScene(3, '2026-05-13T10:00:00Z[UTC]', 'main'),
    ];
    const entries: SourcebookEntry[] = [
      makeEntry(
        'join-1',
        '2026-05-11T10:00:00Z[UTC]',
        '2026-05-13T10:00:00Z[UTC]',
        false,
        'main'
      ),
      makeEntry(
        'join-2',
        '2026-05-11T10:00:00Z[UTC]',
        '2026-05-13T10:00:00Z[UTC]',
        false,
        'main'
      ),
      makeEntry(
        'a->b',
        '2026-05-11T10:00:00Z[UTC]',
        '2026-05-12T10:00:00Z[UTC]',
        true,
        'main'
      ),
    ];

    const model = buildTimelinePanelModel(scenes, entries, buildEpochMap(scenes));

    expect(model.timelineLaneNumbers).toContain(4);
    expect(model.laneBySceneId.get(2)).toBe(4);
    // And the exclusivity rule still holds.
    const jumpColumns = model.events.map((event: TimelineJumpEvent) => event.lane);
    const timelineColumns = new Set<number>(model.timelineLaneNumbers);
    jumpColumns.forEach((lane: number) => {
      expect(timelineColumns.has(lane)).toBe(false);
    });
    expect(new Set<number>(jumpColumns).size).toBe(jumpColumns.length);
  });

  it("sources a non-branching jump from the departure scene's own timeline", () => {
    // A non-branching "return" from a branch timeline back to main.  The jump
    // arrow must depart from the branch — where the departure scene's dot sits
    // — and join main, NOT the other way around (the arrow must never be on
    // main while its scene marker is on the branch).
    const scenes: Scene[] = [
      makeScene(1, '2026-05-11T10:00:00Z[UTC]', 'main', ['a->b']),
      makeScene(2, '2026-05-12T10:00:00Z[UTC]', 'branch:a->b', ['b->main']),
      makeScene(3, '2026-05-13T10:00:00Z[UTC]', 'main'),
    ];
    const entries: SourcebookEntry[] = [
      makeEntry(
        'a->b',
        '2026-05-11T10:00:00Z[UTC]',
        '2026-05-12T10:00:00Z[UTC]',
        true,
        'main'
      ),
      makeEntry(
        'b->main',
        '2026-05-12T10:00:00Z[UTC]',
        '2026-05-13T10:00:00Z[UTC]',
        false,
        'main'
      ),
    ];

    const model = buildTimelinePanelModel(scenes, entries, buildEpochMap(scenes));
    const jump = model.events.find(
      (event: TimelineJumpEvent) => event.entryId === 'b->main'
    );

    expect(jump).toBeDefined();
    // The arrow departs from the branch the departure scene lives on, then
    // lands on main.
    expect(jump?.sourceLane).toBe(model.laneBySceneId.get(2));
    expect(jump?.sourceLane).not.toBe(0);
    expect(jump?.destinationLane).toBe(0);
  });

  it('branches off the entry timeline_id even when the departure scene is elsewhere', () => {
    // Mirrors BTTF: Old Biff departs 2015 (main) but creates a branch whose
    // trunk spawns off the 1955 timeline (the timeline that exists in 1955).
    // The branch tree parent comes from the entry's timeline_id, independent
    // of where the departure scene sits.
    const scenes: Scene[] = [
      makeScene(1, '2026-05-11T10:00:00Z[UTC]', 'main', ['2015->1955']),
      makeScene(2, '2026-05-12T10:00:00Z[UTC]', 'branch:1985->1955'),
      makeScene(3, '2026-05-13T10:00:00Z[UTC]', 'branch:2015->1955'),
    ];
    const entries: SourcebookEntry[] = [
      makeEntry(
        '2015->1955',
        '2026-05-11T10:00:00Z[UTC]',
        '2026-05-13T10:00:00Z[UTC]',
        true,
        'branch:1985->1955'
      ),
    ];

    const model = buildTimelinePanelModel(scenes, entries, buildEpochMap(scenes));
    const jump = model.events.find(
      (event: TimelineJumpEvent) => event.entryId === '2015->1955'
    );

    expect(jump).toBeDefined();
    // The branch tree parent is the 1955 line (entry.timeline_id), so the new
    // branch is placed as a child of it — not of main.
    expect(jump?.sourceLane).toBe(model.laneBySceneId.get(2));
    expect(jump?.sourceLane).not.toBe(0);
    expect(jump?.destinationLane).toBe(model.laneBySceneId.get(3));
  });

  it('anchors a no-departure-scene non-branching jump to the line it lands on', () => {
    // A future trip / return with no scene at its departure epoch still belongs
    // to the line it lands on — never to main (the backend strips timeline_id
    // from non-branching entries, so the fallback must come from the
    // destination scene).
    const scenes: Scene[] = [
      makeScene(1, '2026-05-11T10:00:00Z[UTC]', 'branch:1985 -> 1955'),
      makeScene(2, '2026-05-13T10:00:00Z[UTC]', 'branch:1985 -> 1955'),
    ];
    const entries: SourcebookEntry[] = [
      makeEntry(
        'jump',
        '2026-05-12T10:00:00Z[UTC]',
        '2026-05-13T10:00:00Z[UTC]',
        false,
        null
      ),
    ];

    const model = buildTimelinePanelModel(scenes, entries, buildEpochMap(scenes));
    const jump = model.events.find(
      (event: TimelineJumpEvent) => event.entryId === 'jump'
    );

    expect(jump).toBeDefined();
    // No departure scene: the jump is local to the line it lands on.
    expect(jump?.sourceLane).toBe(model.laneBySceneId.get(2));
    expect(jump?.sourceLane).not.toBe(0);
    expect(jump?.destinationLane).toBe(model.laneBySceneId.get(2));
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
