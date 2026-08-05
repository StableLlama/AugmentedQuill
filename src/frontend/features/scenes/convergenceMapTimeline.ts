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
  /** Column (swimlane) of the timeline the jump departs from. */
  sourceLane: number;
  /**
   * Column (swimlane) of the timeline the jump lands on — the new branch for a
   * branch-creating jump, or the timeline it joins for a non-branching jump.
   */
  destinationLane: number;
  /**
   * The jump's OWN swimlane column.  Universal rule: every swimlane holds at
   * most one thing — either one timeline OR one time jump.  A jump is never
   * drawn over the timeline it travels along, and two jumps never share a
   * column.  Because every jump reserves its own swimlane, the timeline after a
   * run of jumps may land on an even swimlane instead of an odd one.
   */
  lane: number;
}

export interface TimelinePanelModel {
  laneBySceneId: Map<SceneId, number>;
  timelineIdByLane: Map<number, string>;
  events: TimelineJumpEvent[];
  /** Every occupied swimlane (timelines AND jumps), sorted ascending. */
  laneNumbers: number[];
  /** Swimlanes occupied by timelines only (vertical lines + spawns). */
  timelineLaneNumbers: number[];
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

interface ColumnLayout {
  colByTimeline: Map<string, number>;
  colByEvent: Map<string, number>;
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

/**
 * For a non-branching jump, find the scene the jump lands on.  The destination
 * is the timeline being joined: a scene at the exact arrival epoch on the
 * source timeline when one exists, otherwise the first scene anywhere at that
 * epoch (so a jump to another existing timeline anchors to that timeline).
 */
const findDestinationSceneAtEpoch = (
  candidates: Scene[],
  targetNs: bigint,
  sceneEpochNanosecondsById: ReadonlyMap<SceneId, bigint>,
  preferTimelineId: string
): Scene | null => {
  const matching = candidates.filter((scene: Scene): boolean => {
    const sceneNs = sceneEpochNanosecondsById.get(scene.id);
    return sceneNs !== undefined && sceneNs === targetNs;
  });
  if (matching.length === 0) return null;
  const preferred = matching.find(
    (scene: Scene): boolean => getSceneTimelineId(scene) === preferTimelineId
  );
  return preferred ?? matching[0] ?? null;
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

/**
 * Order a timeline's outgoing jumps for swimlane placement: non-branching jumps
 * (which simply join a timeline) come first — each reserving its own swimlane
 * next to the timeline — then branch-creating jumps ordered by destination
 * epoch DESCENDING so the branch that arrives latest sits closest to its parent
 * (its spawn line stays short, earlier-arriving siblings run further right).
 */
const sortOutgoingEvents = (events: CandidateTimelineEvent[]): void => {
  events.sort((a: CandidateTimelineEvent, b: CandidateTimelineEvent): number => {
    const aBranch = a.createsNewTimeline ? 1 : 0;
    const bBranch = b.createsNewTimeline ? 1 : 0;
    if (aBranch !== bBranch) return aBranch - bBranch;
    if (aBranch === 1) {
      const aEpoch = a.destinationEpochNs;
      const bEpoch = b.destinationEpochNs;
      if (aEpoch !== null && bEpoch !== null) {
        if (aEpoch > bEpoch) return -1;
        if (aEpoch < bEpoch) return 1;
      }
      return a.entry.id.localeCompare(b.entry.id);
    }
    if (a.departureEpochNs < b.departureEpochNs) return -1;
    if (a.departureEpochNs > b.departureEpochNs) return 1;
    return a.entry.id.localeCompare(b.entry.id);
  });
};

/**
 * Swimlane (column) layout for the whole panel.
 *
 * Universal rule: every swimlane holds at most ONE thing — either one timeline
 * or one time jump — so no two timelines or jumps are ever drawn over each
 * other.  Every timeline occupies a column; every jump reserves its own column
 * in its source timeline's group (a branch-creating jump is immediately
 * followed by the column of the timeline it creates).  Because jumps consume
 * columns, a timeline may land on an even swimlane when several jumps sit to
 * its left.
 */
const buildColumnLayout = (
  candidateEvents: CandidateTimelineEvent[],
  timelineIds: string[]
): ColumnLayout => {
  const colByTimeline = new Map<string, number>();
  const colByEvent = new Map<string, number>();

  const eventsBySource = new Map<string, CandidateTimelineEvent[]>();
  candidateEvents.forEach((ev: CandidateTimelineEvent): void => {
    const list = eventsBySource.get(ev.sourceTimelineId) ?? [];
    list.push(ev);
    eventsBySource.set(ev.sourceTimelineId, list);
  });
  eventsBySource.forEach(sortOutgoingEvents);

  let nextColumn = 0;
  const place = (timelineId: string): void => {
    if (colByTimeline.has(timelineId)) return;
    colByTimeline.set(timelineId, nextColumn);
    nextColumn += 1;
    const events = eventsBySource.get(timelineId) ?? [];
    events.forEach((ev: CandidateTimelineEvent): void => {
      colByEvent.set(ev.entry.id, nextColumn);
      nextColumn += 1;
      if (ev.createsNewTimeline) {
        place(ev.destinationTimelineId);
      }
    });
  };
  place(MAIN_TIMELINE_ID);

  // Timelines not reachable through a branch-creating jump are appended after
  // the jump tree.
  const remaining = timelineIds.filter(
    (timelineId: string): boolean => !colByTimeline.has(timelineId)
  );
  remaining.forEach((timelineId: string): void => {
    colByTimeline.set(timelineId, nextColumn);
    nextColumn += 1;
  });
  remaining.forEach((timelineId: string): void => {
    const events = eventsBySource.get(timelineId) ?? [];
    events.forEach((ev: CandidateTimelineEvent): void => {
      if (colByEvent.has(ev.entry.id)) return;
      colByEvent.set(ev.entry.id, nextColumn);
      nextColumn += 1;
      if (ev.createsNewTimeline) {
        place(ev.destinationTimelineId);
      }
    });
  });

  return { colByTimeline, colByEvent };
};

export const buildTimelinePanelModel = (
  sortedScenes: Scene[],
  sourcebookEntries: SourcebookEntry[],
  sceneEpochNanosecondsById: ReadonlyMap<SceneId, bigint>
): TimelinePanelModel => {
  const timelineIds = buildTimelineIds(sortedScenes, sourcebookEntries);
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

    // A time-travel entry with incomplete data (no destination) cannot draw an
    // arrow: both endpoints must be known.  Such entries are kept in the
    // sourcebook but produce no timeline-panel event.
    const destinationEpochNs = parseEpochNs(entry.destination_datetime);
    if (destinationEpochNs === null) {
      return;
    }

    const createsNewTimeline = !!entry.creates_new_timeline;

    // Resolve the timelines a jump departs from and lands on.
    let sourceTimelineId: string;
    let destinationTimelineId: string;
    let destinationScene: Scene | null = null;
    if (createsNewTimeline) {
      // A branch's parent is the timeline it starts off (entry.timeline_id with
      // the "common ancestor" fallback); this drives the tree layout.
      sourceTimelineId = resolveSourceTimelineId(entry, true, departureScene);
      destinationTimelineId = getBranchTimelineId(entry);
      destinationScene = findExactSceneAtEpochInTimeline(
        sortedScenes,
        destinationEpochNs,
        destinationTimelineId,
        sceneEpochNanosecondsById
      );
    } else {
      // A non-branching jump JOINS a timeline.  The arrow departs from the
      // departure scene's OWN timeline — the line its marker dot sits on —
      // and joins the destination timeline, so an arrow is never drawn on one
      // timeline while its scene marker is elsewhere.  A return with no scene
      // at the arrival epoch loops back to the line it left (its future).
      // When there is no departure scene at all (the backend does not store
      // `timeline_id` for non-branching entries), the jump is local to the
      // line it lands on — its destination scene's line.
      destinationScene = findDestinationSceneAtEpoch(
        sortedScenes,
        destinationEpochNs,
        sceneEpochNanosecondsById,
        MAIN_TIMELINE_ID
      );
      const destinationTimelineIdFromScene =
        destinationScene !== null ? getSceneTimelineId(destinationScene) : null;
      sourceTimelineId =
        departureScene !== null
          ? getSceneTimelineId(departureScene)
          : (destinationTimelineIdFromScene ?? getSourceTimelineId(entry));
      destinationTimelineId = destinationTimelineIdFromScene ?? sourceTimelineId;
    }

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

  // Swimlane layout: every timeline AND every time jump owns exactly one
  // swimlane (column).  A timeline's outgoing jumps each reserve the next
  // column, and a branch-creating jump is immediately followed by the column
  // of the timeline it creates — so a timeline can land on an even swimlane
  // when several jumps sit to its left.
  const { colByTimeline, colByEvent } = buildColumnLayout(candidateEvents, timelineIds);

  const laneBySceneId = new Map<SceneId, number>();
  sortedScenes.forEach((scene: Scene): void => {
    const timelineId = getSceneTimelineId(scene);
    laneBySceneId.set(scene.id, colByTimeline.get(timelineId) ?? 0);
  });

  const timelineIdByLane = new Map<number, string>();
  colByTimeline.forEach((lane: number, timelineId: string): void => {
    timelineIdByLane.set(lane, timelineId);
  });

  const events: TimelineJumpEvent[] = [];

  candidateEvents.forEach((ev: CandidateTimelineEvent): void => {
    const sourceLane = colByTimeline.get(ev.sourceTimelineId) ?? 0;
    const destinationLane = colByTimeline.get(ev.destinationTimelineId) ?? sourceLane;
    const lane = colByEvent.get(ev.entry.id) ?? sourceLane;

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
      lane,
    });
  });

  const laneNumbers = Array.from(
    new Set<number>([...colByTimeline.values(), ...colByEvent.values()])
  ).sort((a: number, b: number) => a - b);
  const timelineLaneNumbers = Array.from(colByTimeline.values()).sort(
    (a: number, b: number) => a - b
  );

  return {
    laneBySceneId,
    timelineIdByLane,
    events,
    laneNumbers,
    timelineLaneNumbers,
  };
};
