// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { describe, it, expect } from 'vitest';
import {
  computeCauseOrderViolations,
  computeTemporalCauseViolations,
  getSceneEpochNanoseconds,
} from './sceneSortUtils';
import type { Scene } from '../../types';

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    title: 'Scene',
    summary: 'Desc',
    pinboard_x: 0,
    pinboard_y: 0,
    order_index: 0,
    prose_link: null,
    predecessor_ids: [],
    created_at: '',
    updated_at: '',
    beats: [],
    active_characters: [],
    passive_characters: [],
    location: null,
    time: null,
    color_tag: null,
    status: 'active',
    causes: [],
    ...overrides,
  } as Scene;
}

describe('sceneSortUtils cause violation helpers', () => {
  it('marks both scenes when a chronological order violates a cause', () => {
    const scenes = [
      makeScene({ id: 'effect', causes: [] }),
      makeScene({ id: 'cause', causes: ['effect'] }),
    ];

    const violatingIds = computeCauseOrderViolations(scenes);

    expect(violatingIds).toEqual(new Set(['cause', 'effect']));
  });

  it('does not mark scenes when cause order is correct', () => {
    const scenes = [
      makeScene({ id: 'cause', causes: ['effect'] }),
      makeScene({ id: 'effect', causes: [] }),
    ];

    const violatingIds = computeCauseOrderViolations(scenes);

    expect(violatingIds.size).toBe(0);
  });

  it('marks scenes with inconsistent temporal order', () => {
    const scenes = [
      makeScene({
        id: 'cause',
        causes: ['effect'],
        scene_time: { temporal_zoned_datetime: '2025-01-02T10:00:00+00:00[UTC]' },
      }),
      makeScene({
        id: 'effect',
        scene_time: { temporal_zoned_datetime: '2024-01-02T10:00:00+00:00[UTC]' },
      }),
    ];

    const violatingIds = computeTemporalCauseViolations(scenes);

    expect(violatingIds).toEqual(new Set(['cause', 'effect']));
  });

  it('ignores scenes without valid temporal values when checking temporal violations', () => {
    const scenes = [
      makeScene({
        id: 'cause',
        causes: ['effect'],
        scene_time: { temporal_zoned_datetime: 'invalid' },
      }),
      makeScene({
        id: 'effect',
        scene_time: { temporal_zoned_datetime: '2024-01-02T10:00:00+00:00[UTC]' },
      }),
    ];

    const violatingIds = computeTemporalCauseViolations(scenes);

    expect(violatingIds.size).toBe(0);
  });

  it('returns a valid epoch nanoseconds value for a real temporal ZonedDateTime', () => {
    const scene = makeScene({
      scene_time: { temporal_zoned_datetime: '2024-01-02T10:00:00+00:00[UTC]' },
    });

    const epoch = getSceneEpochNanoseconds(scene);

    expect(typeof epoch).toBe('bigint');
    expect(epoch).toBeGreaterThan(0n);
  });
});
