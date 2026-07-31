// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Build deterministic timeline option lists for scene and sourcebook
 * editors from explicit timeline_id data.
 */

import type { Scene, SceneId } from '../../types';
import type { SourcebookEntry } from '../../types/domain';
import { parseZonedDateTime } from '../../utils/temporal';

export interface TimelineOption {
  id: string;
  label: string;
}

const MAIN_TIMELINE_ID = 'main';

const normalizeTimelineId = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseEpochNs = (value: string | null | undefined): bigint | null => {
  const parsed = parseZonedDateTime(value);
  return parsed === null ? null : parsed.epochNanoseconds;
};

export const getBranchTimelineId = (
  entry: Pick<SourcebookEntry, 'id' | 'timeline_id'>
): string => {
  return `branch:${entry.id}`;
};

export const buildSourcebookTimelineOptions = (
  sourcebookEntries: SourcebookEntry[],
  currentTimelineId: string | null | undefined = null
): TimelineOption[] => {
  const options: TimelineOption[] = [{ id: MAIN_TIMELINE_ID, label: 'Main Timeline' }];
  const seen = new Set<string>([MAIN_TIMELINE_ID]);

  sourcebookEntries.forEach((entry: SourcebookEntry): void => {
    if (entry.category !== 'Time Travel' || !entry.creates_new_timeline) {
      return;
    }

    const timelineId = getBranchTimelineId(entry);
    if (seen.has(timelineId)) return;
    seen.add(timelineId);
    options.push({ id: timelineId, label: entry.name || timelineId });
  });

  const normalizedCurrent = normalizeTimelineId(currentTimelineId);
  if (normalizedCurrent !== null && !seen.has(normalizedCurrent)) {
    options.push({ id: normalizedCurrent, label: normalizedCurrent });
  }

  return options;
};

export const buildSceneTimelineOptions = (
  scene: Scene,
  sourcebookEntries: SourcebookEntry[],
  sceneEpochNanosecondsById: ReadonlyMap<SceneId, bigint>
): TimelineOption[] => {
  const currentTimelineId = normalizeTimelineId(scene.timeline_id) ?? MAIN_TIMELINE_ID;
  const currentEpochNs = sceneEpochNanosecondsById.get(scene.id) ?? null;
  const options: TimelineOption[] = [{ id: MAIN_TIMELINE_ID, label: 'Main Timeline' }];
  const seen = new Set<string>([MAIN_TIMELINE_ID]);

  const branchOptions = sourcebookEntries
    .filter(
      (entry: SourcebookEntry): boolean =>
        entry.category === 'Time Travel' && !!entry.creates_new_timeline
    )
    .map(
      (
        entry: SourcebookEntry
      ): { id: string; label: string; createdAtEpochNs: bigint | null } => ({
        id: getBranchTimelineId(entry),
        label: entry.name || getBranchTimelineId(entry),
        createdAtEpochNs:
          parseEpochNs(entry.destination_datetime) ?? parseEpochNs(entry.origin_date),
      })
    )
    .sort(
      (
        a: { id: string; label: string; createdAtEpochNs: bigint | null },
        b: { id: string; label: string; createdAtEpochNs: bigint | null }
      ) => {
        if (a.createdAtEpochNs !== null && b.createdAtEpochNs !== null) {
          if (a.createdAtEpochNs < b.createdAtEpochNs) return -1;
          if (a.createdAtEpochNs > b.createdAtEpochNs) return 1;
        } else if (a.createdAtEpochNs !== null) {
          return -1;
        } else if (b.createdAtEpochNs !== null) {
          return 1;
        }
        return a.label.localeCompare(b.label);
      }
    );

  branchOptions.forEach(
    (option: { id: string; label: string; createdAtEpochNs: bigint | null }): void => {
      if (seen.has(option.id)) return;
      if (
        currentEpochNs !== null &&
        option.createdAtEpochNs !== null &&
        option.createdAtEpochNs > currentEpochNs &&
        option.id !== currentTimelineId
      ) {
        return;
      }

      seen.add(option.id);
      options.push({ id: option.id, label: option.label });
    }
  );

  if (!seen.has(currentTimelineId)) {
    options.push({ id: currentTimelineId, label: currentTimelineId });
  }

  return options;
};
