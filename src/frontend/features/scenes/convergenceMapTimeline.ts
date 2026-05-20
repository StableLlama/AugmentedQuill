// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Build timeline-lane placement for Convergence Map time-travel arrows.
 */

import type { Scene, SceneId } from '../../types';
import type { SourcebookEntry } from '../../types/domain';
import { parseZonedDateTime } from '../../utils/temporal';

export interface TimelineJumpEvent {
  entryId: string;
  entryName: string;
  createsNewTimeline: boolean;
  departureSceneId: SceneId | null;
  destinationSceneId: SceneId | null;
  departureEpochNs: bigint;
  destinationEpochNs: bigint | null;
  sourceLane: number;
  destinationLane: number;
}

export interface TimelinePanelModel {
  laneBySceneId: Map<SceneId, number>;
  timelineIdByLane: Map<number, string>;
  events: TimelineJumpEvent[];
  laneNumbers: number[];
}

interface CandidateTimelineEvent {
  entry: SourcebookEntry;
  departureScene: Scene | null;
  destinationScene: Scene | null;
  departureEpochNs: bigint;
  destinationEpochNs: bigint | null;
  createsNewTimeline: boolean;
  sourceTimelineId: string;
  destinationTimelineId: string;
}

interface TimelineInterval {
  startEpochNs: bigint;
  endEpochNs: bigint;
}

const MAIN_TIMELINE_ID = 'main';

const normalizeTimelineId = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === MAIN_TIMELINE_ID) return MAIN_TIMELINE_ID;
  if (trimmed.startsWith('branch:')) return trimmed;
  return `branch:${trimmed}`;
};

const getSceneTimelineId = (scene: Scene): string => {
  return normalizeTimelineId(scene.timeline_id) ?? MAIN_TIMELINE_ID;
};

const getBranchTimelineId = (entry: SourcebookEntry): string => {
  return `branch:${entry.id}`;
};

const getSourceTimelineId = (entry: SourcebookEntry): string => {
  return normalizeTimelineId(entry.timeline_id) ?? MAIN_TIMELINE_ID;
};

const resolveSourceTimelineId = (
  entry: SourcebookEntry,
  createsNewTimeline: boolean,
  departureScene: Scene | null
): string => {
  const sourceTimelineId = getSourceTimelineId(entry);
  if (!createsNewTimeline) {
    return sourceTimelineId;
  }

  const destinationTimelineId = getBranchTimelineId(entry);
  if (sourceTimelineId !== destinationTimelineId) {
    return sourceTimelineId;
  }

  if (departureScene !== null) {
    const departureSceneTimelineId = getSceneTimelineId(departureScene);
    if (departureSceneTimelineId !== destinationTimelineId) {
      return departureSceneTimelineId;
    }
  }

  return MAIN_TIMELINE_ID;
};

const getEventActivationEpochNs = (event: CandidateTimelineEvent): bigint => {
  if (event.createsNewTimeline && event.destinationEpochNs !== null) {
    return event.destinationEpochNs;
  }

  return event.departureEpochNs;
};

const parseEpochNs = (value: string | null | undefined): bigint | null => {
  const parsed = parseZonedDateTime(value);
  if (parsed === null) return null;
  return parsed.epochNanoseconds;
};

const sortCandidateEvents = (
  a: CandidateTimelineEvent,
  b: CandidateTimelineEvent
): number => {
  const aActivationEpochNs = getEventActivationEpochNs(a);
  const bActivationEpochNs = getEventActivationEpochNs(b);
  if (aActivationEpochNs < bActivationEpochNs) return -1;
  if (aActivationEpochNs > bActivationEpochNs) return 1;
  if (a.departureEpochNs < b.departureEpochNs) return -1;
  if (a.departureEpochNs > b.departureEpochNs) return 1;
  return 0;
};

const findExactSceneAtEpochInTimeline = (
  candidates: Scene[],
  targetNs: bigint,
  timelineId: string,
  sceneEpochNanosecondsById: ReadonlyMap<SceneId, bigint>
): Scene | null => {
  const matching = candidates
    .filter((scene: Scene): boolean => getSceneTimelineId(scene) === timelineId)
    .filter((scene: Scene): boolean => {
      const sceneNs = sceneEpochNanosecondsById.get(scene.id);
      return sceneNs !== undefined && sceneNs === targetNs;
    })
    .sort((a: Scene, b: Scene) => a.id - b.id);

  return matching[0] ?? null;
};

const pickDepartureSceneForEntry = (
  entry: SourcebookEntry,
  sortedScenes: Scene[],
  sceneEpochNanosecondsById: ReadonlyMap<SceneId, bigint>
): Scene | null => {
  const candidates = sortedScenes.filter((scene: Scene) =>
    (scene.sourcebook_entry_ids ?? []).includes(entry.id)
  );
  if (candidates.length === 0) return null;

  const originNs = parseEpochNs(entry.origin_date);
  if (originNs !== null) {
    const exact = candidates
      .filter((scene: Scene): boolean => {
        const sceneNs = sceneEpochNanosecondsById.get(scene.id);
        return sceneNs !== undefined && sceneNs === originNs;
      })
      .sort((a: Scene, b: Scene) => a.id - b.id);
    if (exact.length > 0) {
      return exact[0];
    }
  }

  const ordered = [...candidates].sort((a: Scene, b: Scene) => {
    const aNs = sceneEpochNanosecondsById.get(a.id);
    const bNs = sceneEpochNanosecondsById.get(b.id);
    if (aNs !== undefined && bNs !== undefined) {
      if (aNs < bNs) return -1;
      if (aNs > bNs) return 1;
    }
    return a.id - b.id;
  });

  return ordered[0] ?? null;
};

const recordTimelineEpoch = (
  intervalsByTimelineId: Map<string, TimelineInterval>,
  timelineId: string,
  epochNs: bigint
): void => {
  const existing = intervalsByTimelineId.get(timelineId);
  if (existing === undefined) {
    intervalsByTimelineId.set(timelineId, {
      startEpochNs: epochNs,
      endEpochNs: epochNs,
    });
    return;
  }

  intervalsByTimelineId.set(timelineId, {
    startEpochNs: epochNs < existing.startEpochNs ? epochNs : existing.startEpochNs,
    endEpochNs: epochNs > existing.endEpochNs ? epochNs : existing.endEpochNs,
  });
};

const buildTimelineIds = (
  sortedScenes: Scene[],
  sourcebookEntries: SourcebookEntry[]
): string[] => {
  const timelineIds: string[] = [MAIN_TIMELINE_ID];
  const seen = new Set<string>([MAIN_TIMELINE_ID]);

  sortedScenes.forEach((scene: Scene): void => {
    const timelineId = getSceneTimelineId(scene);
    if (seen.has(timelineId)) return;
    seen.add(timelineId);
    timelineIds.push(timelineId);
  });

  sourcebookEntries.forEach((entry: SourcebookEntry): void => {
    if (entry.category !== 'Time Travel') {
      return;
    }

    const sourceTimelineId = getSourceTimelineId(entry);
    if (!seen.has(sourceTimelineId)) {
      seen.add(sourceTimelineId);
      timelineIds.push(sourceTimelineId);
    }

    if (!entry.creates_new_timeline) {
      return;
    }

    const destinationTimelineId = getBranchTimelineId(entry);
    if (seen.has(destinationTimelineId)) {
      return;
    }
    seen.add(destinationTimelineId);
    timelineIds.push(destinationTimelineId);
  });

  return timelineIds;
};

const buildTimelineIntervals = (
  sortedScenes: Scene[],
  sourcebookEntries: SourcebookEntry[],
  sceneEpochNanosecondsById: ReadonlyMap<SceneId, bigint>
): ReadonlyMap<string, TimelineInterval> => {
  const intervalsByTimelineId = new Map<string, TimelineInterval>();

  sortedScenes.forEach((scene: Scene): void => {
    const epochNs = sceneEpochNanosecondsById.get(scene.id);
    if (epochNs === undefined) {
      return;
    }
    recordTimelineEpoch(intervalsByTimelineId, getSceneTimelineId(scene), epochNs);
  });

  sourcebookEntries.forEach((entry: SourcebookEntry): void => {
    if (entry.category !== 'Time Travel') {
      return;
    }

    const createsNewTimeline = !!entry.creates_new_timeline;
    const departureScene = pickDepartureSceneForEntry(
      entry,
      sortedScenes,
      sceneEpochNanosecondsById
    );
    const departureSceneEpochNs =
      departureScene !== null
        ? (sceneEpochNanosecondsById.get(departureScene.id) ?? null)
        : null;
    const departureEpochNs = parseEpochNs(entry.origin_date) ?? departureSceneEpochNs;
    const destinationEpochNs = parseEpochNs(entry.destination_datetime);

    const sourceTimelineId = resolveSourceTimelineId(
      entry,
      createsNewTimeline,
      departureScene
    );
    if (departureEpochNs !== null) {
      recordTimelineEpoch(intervalsByTimelineId, sourceTimelineId, departureEpochNs);
    }
    if (destinationEpochNs !== null) {
      recordTimelineEpoch(intervalsByTimelineId, sourceTimelineId, destinationEpochNs);
    }

    if (destinationEpochNs !== null) {
      const destinationTimelineId = createsNewTimeline
        ? getBranchTimelineId(entry)
        : getSourceTimelineId(entry);
      recordTimelineEpoch(
        intervalsByTimelineId,
        destinationTimelineId,
        destinationEpochNs
      );
    }
  });

  return intervalsByTimelineId;
};

const buildLaneByTimelineId = (
  timelineIds: string[],
  intervalsByTimelineId: ReadonlyMap<string, TimelineInterval>
): ReadonlyMap<string, number> => {
  const laneByTimelineId = new Map<string, number>();
  laneByTimelineId.set(MAIN_TIMELINE_ID, 0);

  const nonMainTimelineIds = timelineIds.filter(
    (timelineId: string): boolean => timelineId !== MAIN_TIMELINE_ID
  );

  nonMainTimelineIds.sort((a: string, b: string): number => {
    const ai = intervalsByTimelineId.get(a);
    const bi = intervalsByTimelineId.get(b);
    if (ai !== undefined && bi !== undefined) {
      if (ai.startEpochNs < bi.startEpochNs) return -1;
      if (ai.startEpochNs > bi.startEpochNs) return 1;
      if (ai.endEpochNs < bi.endEpochNs) return -1;
      if (ai.endEpochNs > bi.endEpochNs) return 1;
    } else if (ai !== undefined) {
      return -1;
    } else if (bi !== undefined) {
      return 1;
    }
    return a.localeCompare(b);
  });

  let nextLane = 1;
  nonMainTimelineIds.forEach((timelineId: string): void => {
    laneByTimelineId.set(timelineId, nextLane);
    nextLane += 1;
  });

  return laneByTimelineId;
};

export const buildTimelinePanelModel = (
  sortedScenes: Scene[],
  sourcebookEntries: SourcebookEntry[],
  sceneEpochNanosecondsById: ReadonlyMap<SceneId, bigint>
): TimelinePanelModel => {
  const timelineIds = buildTimelineIds(sortedScenes, sourcebookEntries);
  const intervalsByTimelineId = buildTimelineIntervals(
    sortedScenes,
    sourcebookEntries,
    sceneEpochNanosecondsById
  );
  const laneByTimelineId = buildLaneByTimelineId(timelineIds, intervalsByTimelineId);

  const laneBySceneId = new Map<SceneId, number>();
  sortedScenes.forEach((scene: Scene): void => {
    const timelineId = getSceneTimelineId(scene);
    laneBySceneId.set(scene.id, laneByTimelineId.get(timelineId) ?? 0);
  });

  const timelineIdByLane = new Map<number, string>();
  laneByTimelineId.forEach((lane: number, timelineId: string): void => {
    timelineIdByLane.set(lane, timelineId);
  });

  const timeTravelEntries = sourcebookEntries.filter(
    (entry: SourcebookEntry): boolean => entry.category === 'Time Travel'
  );

  // Canonical source: exactly one jump per time-travel sourcebook entry.
  const candidateEvents: CandidateTimelineEvent[] = [];

  timeTravelEntries.forEach((entry: SourcebookEntry): void => {
    const departureScene = pickDepartureSceneForEntry(
      entry,
      sortedScenes,
      sceneEpochNanosecondsById
    );
    const sceneEpochNs =
      departureScene !== null
        ? (sceneEpochNanosecondsById.get(departureScene.id) ?? null)
        : null;

    const originNs = parseEpochNs(entry.origin_date);
    const departureEpochNs = originNs ?? sceneEpochNs;
    if (departureEpochNs === null) {
      return;
    }

    const destinationEpochNs = parseEpochNs(entry.destination_datetime);
    const createsNewTimeline = !!entry.creates_new_timeline;
    const sourceTimelineId = resolveSourceTimelineId(
      entry,
      createsNewTimeline,
      departureScene
    );
    const destinationTimelineId = createsNewTimeline
      ? getBranchTimelineId(entry)
      : sourceTimelineId;
    const destinationScene =
      destinationEpochNs !== null
        ? findExactSceneAtEpochInTimeline(
            sortedScenes,
            destinationEpochNs,
            destinationTimelineId,
            sceneEpochNanosecondsById
          )
        : null;

    candidateEvents.push({
      entry,
      departureScene,
      destinationScene,
      departureEpochNs,
      destinationEpochNs,
      createsNewTimeline,
      sourceTimelineId,
      destinationTimelineId,
    });
  });

  candidateEvents.sort(sortCandidateEvents);

  const events: TimelineJumpEvent[] = [];

  candidateEvents.forEach((ev: CandidateTimelineEvent): void => {
    const sourceLane = laneByTimelineId.get(ev.sourceTimelineId) ?? 0;
    const destinationLane =
      laneByTimelineId.get(ev.destinationTimelineId) ?? sourceLane;

    events.push({
      entryId: ev.entry.id,
      entryName: ev.entry.name,
      createsNewTimeline: ev.createsNewTimeline,
      departureSceneId: ev.departureScene?.id ?? null,
      destinationSceneId: ev.destinationScene?.id ?? null,
      departureEpochNs: ev.departureEpochNs,
      destinationEpochNs: ev.destinationEpochNs,
      sourceLane,
      destinationLane,
    });
  });

  const usedLanes = new Set<number>(laneBySceneId.values());
  events.forEach((event: TimelineJumpEvent): void => {
    usedLanes.add(event.sourceLane);
    usedLanes.add(event.destinationLane);
  });

  const laneNumbers = Array.from(
    new Set<number>([...laneBySceneId.values(), ...usedLanes.values()])
  ).sort((a: number, b: number) => a - b);

  return { laneBySceneId, timelineIdByLane, events, laneNumbers };
};
