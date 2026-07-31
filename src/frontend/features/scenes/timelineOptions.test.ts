// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Verify timeline option generation filters future branches for scenes
 * and preserves explicit timeline choices for sourcebook editors.
 */

import { describe, expect, it } from 'vitest';
import type { Scene } from '../../types';
import type { SourcebookEntry } from '../../types/domain';
import { parseZonedDateTime } from '../../utils/temporal';
import {
  buildSceneTimelineOptions,
  buildSourcebookTimelineOptions,
} from './timelineOptions';

const makeScene: (id: number, iso: string, timelineId?: string) => Scene = (
  id: number,
  iso: string,
  timelineId: string = 'main'
): Scene => ({
  id,
  summary: `Scene ${id}`,
  beats: [],
  active_characters: [],
  passive_characters: [],
  sourcebook_entry_ids: [],
  location: null,
  time: null,
  scene_time: { temporal_zoned_datetime: iso },
  timeline_id: timelineId,
  color_tag: null,
  prose_link: null,
  causes: [],
  pinboard_x: 0,
  pinboard_y: 0,
  status: 'active',
});

const makeEntry: (
  id: string,
  destinationDatetime: string,
  createsNewTimeline: boolean,
  timelineId?: string | null
) => SourcebookEntry = (
  id: string,
  destinationDatetime: string,
  createsNewTimeline: boolean,
  timelineId?: string | null
): SourcebookEntry => ({
  id,
  name: id,
  synonyms: [],
  description: id,
  images: [],
  category: 'Time Travel',
  origin_date: destinationDatetime,
  destination_datetime: destinationDatetime,
  destination_relative: null,
  creates_new_timeline: createsNewTimeline,
  timeline_id: timelineId ?? null,
});

const buildEpochMap: (scenes: Scene[]) => Map<number, bigint> = (
  scenes: Scene[]
): Map<number, bigint> => {
  const epochMap = new Map<number, bigint>();
  scenes.forEach((scene: Scene): void => {
    const parsed = parseZonedDateTime(scene.scene_time.temporal_zoned_datetime);
    if (parsed !== null) {
      epochMap.set(scene.id, parsed.epochNanoseconds);
    }
  });
  return epochMap;
};

describe('timeline option generation', () => {
  it('hides future branch timelines from scene timeline options', () => {
    const scenes: Scene[] = [makeScene(1, '2026-05-10T10:00:00Z[UTC]')];
    const entries: SourcebookEntry[] = [
      makeEntry('ready', '2026-05-09T10:00:00Z[UTC]', true, 'main'),
      makeEntry('future', '2026-05-11T10:00:00Z[UTC]', true, 'main'),
    ];

    const options = buildSceneTimelineOptions(
      scenes[0],
      entries,
      buildEpochMap(scenes)
    );

    expect(
      options.map((option: { id: string; label: string }): string => option.id)
    ).toEqual(['main', 'branch:ready']);
  });

  it('keeps the current scene timeline even if it is not yet available by time', () => {
    const scene = makeScene(1, '2026-05-10T10:00:00Z[UTC]', 'branch:future');
    const entries: SourcebookEntry[] = [
      makeEntry('future', '2026-05-11T10:00:00Z[UTC]', true, 'main'),
    ];

    const options = buildSceneTimelineOptions(scene, entries, buildEpochMap([scene]));

    expect(
      options.map((option: { id: string; label: string }): string => option.id)
    ).toEqual(['main', 'branch:future']);
  });

  it('includes all known branch timelines for sourcebook selection plus the current id', () => {
    const entries: SourcebookEntry[] = [
      makeEntry('ready', '2026-05-09T10:00:00Z[UTC]', true, 'main'),
      makeEntry('branch-main', '2026-05-09T10:00:00Z[UTC]', false, 'main'),
    ];

    const options = buildSourcebookTimelineOptions(entries, 'branch:custom');

    expect(
      options.map((option: { id: string; label: string }): string => option.id)
    ).toEqual(['main', 'branch:ready', 'branch:custom']);
  });
});
