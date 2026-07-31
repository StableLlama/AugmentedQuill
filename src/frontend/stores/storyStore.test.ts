// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Regression tests for sourcebook patch behavior in the story store.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { SourcebookEntry } from '../types';
import { INITIAL_STORY, resetStoryStore, useStoryStore } from './storyStore';

function makeEntry(
  overrides: Partial<SourcebookEntry> & Pick<SourcebookEntry, 'id' | 'name'>
): SourcebookEntry {
  return {
    id: overrides.id,
    name: overrides.name,
    description: overrides.description ?? '',
    synonyms: overrides.synonyms ?? [],
    images: overrides.images ?? [],
    category: overrides.category,
    relations: overrides.relations,
    origin_date: overrides.origin_date,
    destination_datetime: overrides.destination_datetime,
    destination_relative: overrides.destination_relative,
    creates_new_timeline: overrides.creates_new_timeline,
    timeline_id: overrides.timeline_id,
  };
}

describe('storyStore.patchSourcebookEntry', () => {
  beforeEach((): void => {
    resetStoryStore();
  });

  it('updates time-travel fields and returns true when value changes', () => {
    const entry = makeEntry({
      id: 'tt-1',
      name: '1985 -> 1955',
      category: 'Time Travel',
      destination_datetime: '1955-11-05T20:00:00+00:00[UTC][u-ca=gregory]',
      destination_relative: '30 years earlier',
      creates_new_timeline: false,
    });

    useStoryStore.getState().setStory({
      ...INITIAL_STORY,
      sourcebook: [entry],
    });

    const changed = useStoryStore.getState().patchSourcebookEntry({
      ...entry,
      destination_datetime: '2015-10-21T16:29:00+00:00[UTC][u-ca=gregory]',
      creates_new_timeline: true,
    });

    expect(changed).toBe(true);
    const updated = useStoryStore.getState().story.sourcebook?.[0];
    expect(updated?.destination_datetime).toBe(
      '2015-10-21T16:29:00+00:00[UTC][u-ca=gregory]'
    );
    expect(updated?.creates_new_timeline).toBe(true);
  });

  it('replaces by previous id when an entry is renamed', () => {
    const original = makeEntry({
      id: 'old-tt-id',
      name: 'Old Jump Name',
      category: 'Time Travel',
      destination_datetime: '1955-11-05T20:00:00+00:00[UTC][u-ca=gregory]',
    });

    useStoryStore.getState().setStory({
      ...INITIAL_STORY,
      sourcebook: [original],
    });

    const changed = useStoryStore.getState().patchSourcebookEntry(
      {
        ...original,
        id: 'new-tt-id',
        name: 'New Jump Name',
      },
      'old-tt-id'
    );

    expect(changed).toBe(true);

    const entries = useStoryStore.getState().story.sourcebook ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('new-tt-id');
    expect(entries[0].name).toBe('New Jump Name');
  });

  it('returns false for unchanged payload including TT fields', () => {
    const entry = makeEntry({
      id: 'tt-2',
      name: 'Static Jump',
      category: 'Time Travel',
      origin_date: '1985-11-05T20:00:00+00:00[UTC][u-ca=gregory]',
      destination_datetime: '1955-11-05T20:00:00+00:00[UTC][u-ca=gregory]',
      destination_relative: '30 years earlier',
      creates_new_timeline: true,
    });

    useStoryStore.getState().setStory({
      ...INITIAL_STORY,
      sourcebook: [entry],
    });

    const changed = useStoryStore.getState().patchSourcebookEntry({ ...entry });
    expect(changed).toBe(false);
  });

  it('updates when only timeline_id changes', () => {
    const entry = makeEntry({
      id: 'tt-3',
      name: 'Branch lineage change',
      category: 'Time Travel',
      creates_new_timeline: true,
      timeline_id: 'main',
    });

    useStoryStore.getState().setStory({
      ...INITIAL_STORY,
      sourcebook: [entry],
    });

    const changed = useStoryStore.getState().patchSourcebookEntry({
      ...entry,
      timeline_id: 'branch:16->10',
    });

    expect(changed).toBe(true);
    const updated = useStoryStore.getState().story.sourcebook?.[0];
    expect(updated?.timeline_id).toBe('branch:16->10');
  });
});
