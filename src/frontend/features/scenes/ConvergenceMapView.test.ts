// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for the Convergence Map snake scene ordering helper.
 */

import { describe, expect, it } from 'vitest';
import type { Scene, SceneId } from '../../types';
import { compareSnakeSceneOrder } from './ConvergenceMapView';

const makeScene = (id: SceneId, sceneTime: string, timelineId: string): Scene => ({
  id,
  summary: `Scene ${id}`,
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

describe('compareSnakeSceneOrder', () => {
  it('keeps the Bob snake in lane chronology order 12 -> 16 -> 13', () => {
    const scene12 = makeScene(12, '2026-05-12T14:00:08+00:00[UTC]', 'main');
    const scene16 = makeScene(16, '2026-05-16T12:00:00+00:00[UTC]', 'main');
    const scene13 = makeScene(13, '2026-05-13T12:00:00+00:00[UTC]', 'branch:16->10');

    const laneBySceneId = new Map<SceneId, number>([
      [12, 0],
      [16, 0],
      [13, 1],
    ]);
    const epochBySceneId = new Map<SceneId, bigint>([
      [12, BigInt('1715522408000000000')],
      [16, BigInt('1715851200000000000')],
      [13, BigInt('1715616000000000000')],
    ]);

    const ordered = [scene13, scene16, scene12].sort((a: Scene, b: Scene) =>
      compareSnakeSceneOrder(a, b, laneBySceneId, epochBySceneId)
    );

    expect(ordered.map((scene: Scene) => scene.id)).toEqual([12, 16, 13]);
  });
});
