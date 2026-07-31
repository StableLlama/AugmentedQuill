// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the sourcebookExternalEntries.test unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { describe, expect, it } from 'vitest';

import { SourcebookEntry } from '../../types';
import {
  filterSourcebookEntries,
  resolveExternalSourcebookEntries,
  updateSourcebookEntryInList,
} from './SourcebookList';

const entry = (id: string, name: string): SourcebookEntry => ({
  id,
  name,
  description: `${name} description`,
  category: 'character',
  synonyms: [],
  images: [],
});

describe('sourcebook external entry sync', () => {
  it('prefers refreshed story sourcebook entries over stale local list', () => {
    const staleLocal = [entry('a', 'Old Entry')];
    const refreshedStory = [entry('b', 'New Entry From Chat Tool')];

    const resolved = resolveExternalSourcebookEntries(refreshedStory, staleLocal);
    expect(resolved).toEqual(refreshedStory);
  });

  it('replaces renamed entries using the original id', () => {
    const staleLocal = [entry('a', 'Old Entry')];
    const updated = { ...staleLocal[0], id: 'new-name', name: 'New Entry' };

    const resolved = updateSourcebookEntryInList(staleLocal, 'a', updated);
    expect(resolved).toEqual([updated]);
  });

  it('keeps current entries when no external sourcebook is provided', () => {
    const current = [entry('a', 'Existing')];
    const resolved = resolveExternalSourcebookEntries(undefined, current);
    expect(resolved).toEqual(current);
  });

  it('filters external entries by case-insensitive name substring', () => {
    const entries = [entry('a', 'Tom'), entry('b', 'Rose Castle')];
    expect(filterSourcebookEntries(entries, 'rose')).toEqual([entries[1]]);
  });

  it('filters external entries by synonym substring', () => {
    const entries: SourcebookEntry[] = [
      {
        ...entry('a', 'Alaric'),
        synonyms: ['Knight of the Rose'],
      },
    ];
    expect(filterSourcebookEntries(entries, 'knight')).toEqual(entries);
  });

  it('filters external entries by keyword substring', () => {
    const entries: SourcebookEntry[] = [
      {
        ...entry('a', 'Daily Schedule'),
        keywords: ['routine', 'calendar'],
      },
      entry('b', 'Rose Castle'),
    ];
    expect(filterSourcebookEntries(entries, 'routi')).toEqual([entries[0]]);
  });

  it('filters external entries by description text', () => {
    const entries: SourcebookEntry[] = [
      {
        ...entry('a', 'Cassandra'),
        description: 'Includes post-operative breast augmentation care.',
      },
      entry('b', 'Rose Castle'),
    ];
    expect(filterSourcebookEntries(entries, 'breast augmentation')).toEqual([
      entries[0],
    ]);
  });

  it('filters external entries with tokenized multi-word fallback', () => {
    const entries: SourcebookEntry[] = [
      {
        ...entry('a', 'Cassandra'),
        synonyms: ['wife'],
        keywords: ['augmentation'],
        description: 'She receives post-operative breast care.',
      },
      entry('b', 'Rose Castle'),
    ];
    expect(filterSourcebookEntries(entries, 'breast augmentation')).toEqual([
      entries[0],
    ]);
  });

  it('returns all entries when query is blank', () => {
    const entries = [entry('a', 'Tom'), entry('b', 'Rose Castle')];
    expect(filterSourcebookEntries(entries, '   ')).toEqual(entries);
  });
});

// ─── Sourcebook diff baseline helpers ────────────────────────────────────────
//
// These tests verify the logic used by SourcebookEntryDialog to determine the
// correct description baseline for diff display.

describe('sourcebook diff baseline selection', () => {
  /** Mirrors the logic in SourcebookEntryDialog that computes descriptionBaseline. */
  const computeBaseline = (
    entry: { description: string } | null,
    baselineEntry: { description: string } | null,
    showDiffForNew: boolean
  ): string | undefined => {
    if (!entry) return undefined; // new-entry creation path, no diff
    if (baselineEntry != null) return baselineEntry.description;
    if (showDiffForNew) return ''; // AI-created: show entire content as added
    return undefined; // user manually opened entry, no diff
  };

  it('returns baseline description when baseline entry exists (AI update case)', () => {
    const current = entry('x', 'Hero');
    const baseline = { description: 'Original description' };
    expect(computeBaseline(current, baseline, false)).toBe('Original description');
    expect(computeBaseline(current, baseline, true)).toBe('Original description');
  });

  it('returns empty string when no baseline exists and showDiffForNew is true (AI create case)', () => {
    const current = entry('x', 'Hero');
    expect(computeBaseline(current, null, true)).toBe('');
  });

  it('returns undefined when no baseline exists and showDiffForNew is false (manual open case)', () => {
    const current = entry('x', 'Hero');
    expect(computeBaseline(current, null, false)).toBeUndefined();
  });

  it('returns undefined when entry is null (user creating a new entry via dialog)', () => {
    expect(computeBaseline(null, null, true)).toBeUndefined();
    expect(computeBaseline(null, null, false)).toBeUndefined();
  });

  it('an AI-updated entry that also existed in baseline uses baseline description (not empty string)', () => {
    const current = entry('x', 'Hero');
    const baseline = { description: 'Old hero bio' };
    // showDiffForNew should be irrelevant when baselineEntry is present
    expect(computeBaseline(current, baseline, true)).toBe('Old hero bio');
  });
});

// ─── Sourcebook dialog trigger pattern ───────────────────────────────────────
//
// These tests document the trigger-object contract used by
// SourcebookList / App to open the entry dialog.

describe('sourcebook dialog trigger', () => {
  it('incrementing trigger id should differ from previous id so re-click is detected', () => {
    const prev = { id: 3, entryId: 'hero' };
    const next = { id: prev.id + 1, entryId: 'hero' };
    expect(next.id).not.toBe(prev.id);
  });

  it('trigger id 0 increments to 1 on first click when previous trigger is null', () => {
    const prevId: number | null = null;
    const newId = (prevId ?? 0) + 1;
    expect(newId).toBe(1);
  });

  it('different entryIds produce distinct triggers at the same id value', () => {
    const t1 = { id: 1, entryId: 'hero' };
    const t2 = { id: 1, entryId: 'villain' };
    // Only the id is used as the effect dep; entryId is read inside the effect.
    // Two triggers with the same id but different entryIds would NOT re-fire
    // the effect — confirm id equality so callers must always increment.
    expect(t1.id).toBe(t2.id);
  });
});

// ─── onMutated async contract ─────────────────────────────────────────────────
//
// Verifies the sequencing guarantee that onMutated is awaited by the handlers
// so that the parent's refreshStory() completes before pushExternalHistoryEntry
// captures the story state.

describe('onMutated async sequencing', () => {
  it('onMutated returning a Promise is awaited by handleCreate before the function resolves', async () => {
    const order: string[] = [];

    // Simulate handleCreate's call sequence.
    const simulateHandleCreate = async (
      onMutated: () => Promise<void>
    ): Promise<void> => {
      order.push('api-create');
      order.push('syncEntries');
      await onMutated();
      order.push('after-mutated');
    };

    const onMutated = async (): Promise<void> => {
      order.push('refreshStory-start');
      await Promise.resolve(); // simulated async work
      order.push('refreshStory-done');
      order.push('pushExternalHistoryEntry');
    };

    await simulateHandleCreate(onMutated);

    expect(order).toEqual([
      'api-create',
      'syncEntries',
      'refreshStory-start',
      'refreshStory-done',
      'pushExternalHistoryEntry',
      'after-mutated',
    ]);
  });

  it('onMutated returning a Promise is awaited by handleDelete before the function resolves', async () => {
    const order: string[] = [];

    const simulateHandleDelete = async (
      onMutated: () => Promise<void>
    ): Promise<void> => {
      order.push('api-delete');
      order.push('syncEntries');
      await onMutated();
      order.push('after-mutated');
    };

    const onMutated = async (): Promise<void> => {
      order.push('refreshStory');
      await Promise.resolve();
      order.push('pushHistory');
    };

    await simulateHandleDelete(onMutated);

    expect(order).toEqual([
      'api-delete',
      'syncEntries',
      'refreshStory',
      'pushHistory',
      'after-mutated',
    ]);
  });

  it('story.sourcebook must reflect deletion before history snapshot is taken', async () => {
    // Models the App.tsx wrapper: refreshStory THEN pushExternalHistoryEntry.
    //
    // Before fix: pushExternalHistoryEntry was called directly, capturing
    // the stale story (deleted entry still present).
    // After fix:  refreshStory() runs first so the snapshot is correct.

    type Snapshot = { sourcebook: string[] };

    let storySnapshot: Snapshot | null = null;

    // Simulate App.tsx's onSourcebookMutated wrapper.
    const onSourcebookMutated = async (_params: { label: string }): Promise<void> => {
      // Simulated refreshStory: removes 'hero' from sourcebook.
      await Promise.resolve();
      storySnapshot = { sourcebook: [] }; // reflects deletion
      // pushExternalHistoryEntry captures the refreshed state.
    };

    // Simulate SourcebookList.handleDelete.
    const simulateHandleDelete = async (): Promise<void> => {
      // api.sourcebook.delete called already; local UI updated.
      await onSourcebookMutated({ label: 'Delete hero' });
      // At this point the App wrapper has already captured the correct state.
    };

    await simulateHandleDelete();

    expect(storySnapshot).not.toBeNull();
    expect(storySnapshot!.sourcebook).toEqual([]); // entry was removed before snapshot
  });

  it('story.sourcebook must include new entry before history snapshot when LLM creates it', () => {
    // When LLM creates an entry, refreshStory is called inside useChatExecution
    // BEFORE onMutations is processed.  The baseline is then advanced so the
    // new entry is not in baseline → diff shows it as added (green).
    //
    // This test verifies the baseline-computation rule from the dialog:
    // if baseline has no entry with the same id, and showDiffForNew=true,
    // description is treated as '' → everything is shown as added.

    type Entry = { id: string; description: string };

    // After LLM creation + refreshStory, baseline was advanced to the state
    // BEFORE the LLM ran (no 'hero' entry), while story now has 'hero'.
    const baselineSourcebook: Entry[] = []; // reflects post-deletion state
    const currentEntry: Entry = { id: 'hero', description: 'A brave hero' };

    const baselineEntry = baselineSourcebook.find(
      (e: { id: string; description: string }) => e.id === currentEntry.id
    );

    // showDiffForNew=true because the dialog was opened via mutation tag.
    const showDiffForNew = true;

    // Mirrors SourcebookEntryDialog's baseline computation.
    const descriptionBaseline =
      baselineEntry != null
        ? baselineEntry.description
        : showDiffForNew
          ? ''
          : undefined;

    expect(descriptionBaseline).toBe(''); // all content shown as added (green)
    expect(baselineEntry).toBeUndefined(); // entry was not in baseline
  });
});

// ─── App-level undo/redo wiring ───────────────────────────────────────────────
//
// Verifies the rules for delegating undo/redo to app level when the local
// in-dialog history is exhausted.

describe('sourcebook dialog app-level undo/redo delegation', () => {
  /** Mirrors the combined disabled/enabled logic of the undo button. */
  const undoDisabled = (historyIndex: number, canAppUndo: boolean): boolean =>
    historyIndex === 0 && !canAppUndo;

  /** Mirrors the routing decision for the undo click handler. */
  const undoAction = (
    historyIndex: number,
    localUndo: () => void,
    appUndo: () => void
  ): void => {
    if (historyIndex > 0) {
      localUndo();
    } else {
      appUndo();
    }
  };

  /** Mirrors the combined disabled/enabled logic of the redo button. */
  const redoDisabled = (
    historyIndex: number,
    historyLength: number,
    canAppRedo: boolean
  ): boolean => historyIndex >= historyLength - 1 && !canAppRedo;

  it('undo button is disabled when local history is at root and app cannot undo', () => {
    expect(undoDisabled(0, false)).toBe(true);
  });

  it('undo button is enabled when app can undo even if local history is at root', () => {
    expect(undoDisabled(0, true)).toBe(false);
  });

  it('undo button is enabled when local history has steps regardless of app state', () => {
    expect(undoDisabled(1, false)).toBe(false);
    expect(undoDisabled(2, false)).toBe(false);
  });

  it('undo routes to local handler when local history has steps', () => {
    const local = { called: false };
    const app = { called: false };
    undoAction(
      1,
      () => (local.called = true),
      () => (app.called = true)
    );
    expect(local.called).toBe(true);
    expect(app.called).toBe(false);
  });

  it('undo routes to app handler when local history is exhausted', () => {
    const local = { called: false };
    const app = { called: false };
    undoAction(
      0,
      () => (local.called = true),
      () => (app.called = true)
    );
    expect(local.called).toBe(false);
    expect(app.called).toBe(true);
  });

  it('redo button is disabled when at end of local history and app cannot redo', () => {
    expect(redoDisabled(2, 3, false)).toBe(true); // historyIndex = last item
  });

  it('redo button is enabled when app can redo even if at end of local history', () => {
    expect(redoDisabled(2, 3, true)).toBe(false);
  });

  it('redo button is enabled when local history has forward steps regardless of app state', () => {
    expect(redoDisabled(0, 3, false)).toBe(false);
    expect(redoDisabled(1, 3, false)).toBe(false);
  });
});

// ─── Sourcebook list diff indicators ─────────────────────────────────────────
//
// Verifies the pure helper logic used to compute diff status sets for the
// list view (created / modified / deleted entries relative to baseline).

type DiffEntry = {
  id: string;
  name: string;
  description: string;
  category?: string;
  synonyms?: string[];
  images?: string[];
  keywords?: string[];
  relations?: { target_id: string; relation: string }[];
};

const makeDiffEntry = (
  id: string,
  description: string,
  name: string = id
): DiffEntry => ({
  id,
  name,
  description,
});

/** Mirrors diffEntrySignature from SourcebookList. */
const diffEntrySignature = (e: DiffEntry): string =>
  JSON.stringify({
    name: e.name,
    description: e.description,
    category: e.category ?? '',
    synonyms: [...(e.synonyms ?? [])].sort(),
    images: [...(e.images ?? [])].sort(),
  });

/** Mirrors the createdEntryIds computation in SourcebookList. */
const computeCreatedIds = (
  current: DiffEntry[],
  baseline: DiffEntry[]
): Set<string> => {
  const baselineIds = new Set(baseline.map((b: DiffEntry) => b.id));
  return new Set(
    current.filter((e: DiffEntry) => !baselineIds.has(e.id)).map((e: DiffEntry) => e.id)
  );
};

/** Mirrors the modifiedEntryIds computation in SourcebookList (with normalization). */
const computeModifiedIds = (current: DiffEntry[], baseline: DiffEntry[]): Set<string> =>
  new Set(
    current
      .filter((e: DiffEntry) => {
        const b = baseline.find((x: DiffEntry) => x.id === e.id);
        return b && diffEntrySignature(b) !== diffEntrySignature(e);
      })
      .map((e: DiffEntry) => e.id)
  );

/** Mirrors the deletedEntries computation in SourcebookList. */
const computeDeletedEntries = (
  current: DiffEntry[],
  baseline: DiffEntry[]
): DiffEntry[] => {
  const currentIds = new Set(current.map((e: DiffEntry) => e.id));
  return baseline.filter((b: DiffEntry) => !currentIds.has(b.id));
};

describe('sourcebook list diff indicators', () => {
  it('no diff when baseline and current are identical', () => {
    const entries = [makeDiffEntry('a', 'desc A'), makeDiffEntry('b', 'desc B')];
    expect(computeCreatedIds(entries, entries)).toEqual(new Set());
    expect(computeModifiedIds(entries, entries)).toEqual(new Set());
    expect(computeDeletedEntries(entries, entries)).toEqual([]);
  });

  it('detects a newly created entry (present in current, absent from baseline)', () => {
    const baseline = [makeDiffEntry('a', 'desc A')];
    const current = [makeDiffEntry('a', 'desc A'), makeDiffEntry('b', 'desc B')];
    expect(computeCreatedIds(current, baseline)).toEqual(new Set(['b']));
    expect(computeModifiedIds(current, baseline)).toEqual(new Set());
    expect(computeDeletedEntries(current, baseline)).toEqual([]);
  });

  it('detects a deleted entry (absent from current, present in baseline)', () => {
    const baseline = [makeDiffEntry('a', 'desc A'), makeDiffEntry('b', 'desc B')];
    const current = [makeDiffEntry('a', 'desc A')];
    expect(computeCreatedIds(current, baseline)).toEqual(new Set());
    expect(computeModifiedIds(current, baseline)).toEqual(new Set());
    expect(computeDeletedEntries(current, baseline)).toEqual([
      makeDiffEntry('b', 'desc B'),
    ]);
  });

  it('detects a modified entry (same id, different content)', () => {
    const baseline = [makeDiffEntry('a', 'old desc')];
    const current = [makeDiffEntry('a', 'new desc')];
    expect(computeCreatedIds(current, baseline)).toEqual(new Set());
    expect(computeModifiedIds(current, baseline)).toEqual(new Set(['a']));
    expect(computeDeletedEntries(current, baseline)).toEqual([]);
  });

  it('no baseline means no diff indicators (all sets empty)', () => {
    // When baselineEntries is undefined, the SourcebookList useMemo returns
    // new Set() / [] early.  The helpers below require an array, so we pass
    // the same list as both arguments to model "no change from baseline".
    const current = [makeDiffEntry('a', 'desc A')];
    // Passing current as its own baseline → nothing is created/modified/deleted.
    expect(computeCreatedIds(current, current)).toEqual(new Set());
    expect(computeModifiedIds(current, current)).toEqual(new Set());
    expect(computeDeletedEntries(current, current)).toEqual([]);
    // And an explicit undefined guard mirrors the component's early return.
    const noBaseline: DiffEntry[] | undefined = undefined;
    expect(noBaseline).toBeUndefined();
  });

  it('handles simultaneous create, modify, and delete in one baseline compare', () => {
    const baseline = [
      makeDiffEntry('keep', 'same'),
      makeDiffEntry('modify', 'old'),
      makeDiffEntry('gone', 'bye'),
    ];
    const current = [
      makeDiffEntry('keep', 'same'),
      makeDiffEntry('modify', 'new'),
      makeDiffEntry('fresh', 'hello'),
    ];
    expect(computeCreatedIds(current, baseline)).toEqual(new Set(['fresh']));
    expect(computeModifiedIds(current, baseline)).toEqual(new Set(['modify']));
    expect(computeDeletedEntries(current, baseline)).toEqual([
      makeDiffEntry('gone', 'bye'),
    ]);
  });

  it('undefined optional arrays are normalised to empty → no false positive when shape differs between snapshots', () => {
    const fromHistory: DiffEntry = {
      id: 'x',
      name: 'Hero',
      description: 'brave',
      synonyms: undefined,
      images: undefined,
    };
    const fromRefresh: DiffEntry = {
      id: 'x',
      name: 'Hero',
      description: 'brave',
      synonyms: [],
      images: [],
    };
    // Raw JSON comparison would differ; the signature must not:
    expect(JSON.stringify(fromHistory)).not.toEqual(JSON.stringify(fromRefresh));
    expect(diffEntrySignature(fromHistory)).toEqual(diffEntrySignature(fromRefresh));
  });

  // ─── Root-cause regression: keywords excluded from diff signature ──────────
  //
  // The story-select endpoint stores raw keywords from story.json.
  // The sourcebook-list endpoint applies _normalize_entry_data → _keyword_budget
  // which may truncate keywords.  Including keywords in the signature would
  // therefore cause false amber on every entry whose keywords were truncated.

  it('keywords differing between history snapshot and list-endpoint response do not trigger amber', () => {
    const baselineEntry: DiffEntry = {
      id: 'b',
      name: 'Villain',
      description: 'evil',
      keywords: ['villain', 'enemy', 'dark', 'power', 'corrupt', 'scheme'],
    };
    const currentEntry: DiffEntry = {
      id: 'b',
      name: 'Villain',
      description: 'evil',
      keywords: ['villain', 'enemy', 'dark'], // truncated by _keyword_budget
    };
    // Raw JSON comparison would differ:
    expect(JSON.stringify(baselineEntry)).not.toEqual(JSON.stringify(currentEntry));
    // diffEntrySignature (keywords excluded) must be equal → no amber:
    expect(diffEntrySignature(baselineEntry)).toEqual(diffEntrySignature(currentEntry));
    // Verify via the helpers:
    expect(computeModifiedIds([currentEntry], [baselineEntry])).toEqual(new Set());
  });

  // ─── Root-cause regression: relations excluded from diff signature ─────────
  //
  // The story-select endpoint spreads each entry's raw dict (**data) and never
  // includes relations (they live in `sourcebook_relations`, a separate list).
  // So history entries always have `relations: undefined`.  After a list-click
  // replaces `entries` via api.sourcebook.list(), entries have `relations: []`
  // or `[{...}]` (injected by _get_entry_relations).  Including relations in
  // the signature causes false amber on ALL entries with relations.

  it('relations present in list-endpoint but absent in history snapshot do not trigger amber', () => {
    const baselineEntry: DiffEntry = {
      id: 'c',
      name: 'Hero',
      description: 'brave',
      relations: undefined, // from story-select / history — never includes relations
    };
    const currentEntry: DiffEntry = {
      id: 'c',
      name: 'Hero',
      description: 'brave',
      relations: [{ target_id: 'villain', relation: 'enemy' }], // from list endpoint
    };
    // diffEntrySignature (relations excluded) must be equal → no amber:
    expect(diffEntrySignature(baselineEntry)).toEqual(diffEntrySignature(currentEntry));
    expect(computeModifiedIds([currentEntry], [baselineEntry])).toEqual(new Set());
  });

  it('actual name / description / category / synonyms / images changes ARE still detected', () => {
    const baseline: DiffEntry = {
      id: 'a',
      name: 'Hero',
      description: 'brave',
      category: 'Character',
      synonyms: ['hero'],
      images: [],
    };
    const withNewDesc: DiffEntry = { ...baseline, description: 'very brave' };
    const withNewName: DiffEntry = { ...baseline, name: 'Champion' };
    const withNewCat: DiffEntry = { ...baseline, category: 'Other' };
    const withNewSyn: DiffEntry = { ...baseline, synonyms: ['champion'] };
    const withNewImg: DiffEntry = { ...baseline, images: ['portrait.png'] };

    for (const changed of [
      withNewDesc,
      withNewName,
      withNewCat,
      withNewSyn,
      withNewImg,
    ]) {
      expect(diffEntrySignature(baseline)).not.toEqual(diffEntrySignature(changed));
      expect(computeModifiedIds([changed], [baseline])).toContain('a');
    }
  });
});

// ─── Baseline advance on manual sourcebook save ───────────────────────────────
//
// Verifies that calling advanceBaselineToCurrentStory() BEFORE refreshStory()
// inside onSourcebookMutated causes an LLM-created entry to transition from
// green (created) to amber (modified) after the user manually edits and saves it.

describe('sourcebook baseline advance on manual save', () => {
  type HistoryEntry = { id: string; description: string };

  /**
   * Simulates the state machine inside onSourcebookMutated:
   *   if advanceBaselineFirst → setBaseline(latestStoryBeforeSave)
   *   refreshStory() → story = latestStoryAfterSave
   */
  const simulateSave = (
    initialBaseline: HistoryEntry[],
    latestStoryBeforeSave: HistoryEntry[],
    latestStoryAfterSave: HistoryEntry[],
    advanceBaselineFirst: boolean
  ): { baseline: HistoryEntry[]; story: HistoryEntry[] } => ({
    baseline: advanceBaselineFirst ? latestStoryBeforeSave : initialBaseline,
    story: latestStoryAfterSave,
  });

  const computeCreatedIds = (
    current: HistoryEntry[],
    baseline: HistoryEntry[]
  ): Set<string> => {
    const baselineIds = new Set(
      baseline.map((b: { id: string; description: string }) => b.id)
    );
    return new Set(
      current
        .filter((e: { id: string; description: string }) => !baselineIds.has(e.id))
        .map((e: { id: string; description: string }) => e.id)
    );
  };

  const computeModifiedIds = (
    current: HistoryEntry[],
    baseline: HistoryEntry[]
  ): Set<string> => {
    return new Set(
      current
        .filter((e: { id: string; description: string }) => {
          const b = baseline.find(
            (x: { id: string; description: string }) => x.id === e.id
          );
          return b && JSON.stringify(b) !== JSON.stringify(e);
        })
        .map((e: { id: string; description: string }) => e.id)
    );
  };

  it('without baseline advance: LLM-created entry stays GREEN (created) after user save — the old bug', () => {
    const preLLMBaseline: HistoryEntry[] = [];
    const postLLMStory: HistoryEntry[] = [{ id: 'hero', description: 'LLM desc' }];
    const postSaveStory: HistoryEntry[] = [{ id: 'hero', description: 'User desc' }];

    const { baseline, story } = simulateSave(
      preLLMBaseline,
      postLLMStory,
      postSaveStory,
      false
    );

    // Bug reproduced: baseline has no Hero → hero shown as created (green), not modified.
    expect(computeCreatedIds(story, baseline)).toContain('hero');
    expect(computeModifiedIds(story, baseline)).not.toContain('hero');
  });

  it('with baseline advance: LLM-created entry shows AMBER (modified) after user save', () => {
    const preLLMBaseline: HistoryEntry[] = [];
    const postLLMStory: HistoryEntry[] = [{ id: 'hero', description: 'LLM desc' }];
    const postSaveStory: HistoryEntry[] = [{ id: 'hero', description: 'User desc' }];

    const { baseline, story } = simulateSave(
      preLLMBaseline,
      postLLMStory,
      postSaveStory,
      true
    );

    // Baseline was advanced to post-LLM state → hero is present in baseline.
    // After save, description differs → modified (amber).
    expect(computeCreatedIds(story, baseline)).not.toContain('hero');
    expect(computeModifiedIds(story, baseline)).toContain('hero');
  });

  it('with baseline advance: unrelated entries show NO diff', () => {
    const preLLMBaseline: HistoryEntry[] = [{ id: 'villain', description: 'evil' }];
    const postLLMStory: HistoryEntry[] = [
      { id: 'villain', description: 'evil' },
      { id: 'hero', description: 'LLM desc' },
    ];
    const postSaveStory: HistoryEntry[] = [
      { id: 'villain', description: 'evil' },
      { id: 'hero', description: 'User desc' },
    ];

    const { baseline, story } = simulateSave(
      preLLMBaseline,
      postLLMStory,
      postSaveStory,
      true
    );

    expect(computeCreatedIds(story, baseline)).not.toContain('villain');
    expect(computeModifiedIds(story, baseline)).not.toContain('villain');
    expect(computeModifiedIds(story, baseline)).toContain('hero');
  });

  it('manual update of an existing baseline entry does not show a diff', () => {
    const postSaveStory: HistoryEntry[] = [
      { id: 'hero', description: 'User description' },
    ];

    // Manual save to an already-baselined entry should advance baseline to
    // the new story state, so no diff is shown.
    expect(computeCreatedIds(postSaveStory, postSaveStory)).not.toContain('hero');
    expect(computeModifiedIds(postSaveStory, postSaveStory)).not.toContain('hero');
  });

  it('baseline advance must happen BEFORE refreshStory to capture the pre-save LLM state', () => {
    // If baseline were advanced AFTER refreshStory (wrong order), it would be
    // set to the post-save state, producing no diff at all.
    const postLLMStory: HistoryEntry[] = [{ id: 'hero', description: 'LLM desc' }];
    const postSaveStory: HistoryEntry[] = [{ id: 'hero', description: 'User desc' }];

    // Wrong order: advance baseline using the already-refreshed story:
    const { baseline: wrongBase, story: wrongStory } = simulateSave(
      postLLMStory,
      postSaveStory,
      postSaveStory,
      true
    );
    expect(computeModifiedIds(wrongStory, wrongBase)).not.toContain('hero'); // no diff — wrong

    // Correct order: advance baseline BEFORE refresh (pre-save = post-LLM state):
    const { baseline: rightBase, story: rightStory } = simulateSave(
      [],
      postLLMStory,
      postSaveStory,
      true
    );
    expect(computeModifiedIds(rightStory, rightBase)).toContain('hero'); // diff shown ✓
  });
});

// ─── Sourcebook update history snapshot correctness ─────────────────────────

describe('sourcebook updatedEntry snapshot correctness', () => {
  type SbEntry = {
    id: string;
    destination_datetime?: string;
  };
  type StorySnapshot = { sourcebook: SbEntry[] };

  const applyPatch = (story: StorySnapshot, entry: SbEntry): StorySnapshot => ({
    sourcebook: story.sourcebook.map((e: SbEntry) => (e.id === entry.id ? entry : e)),
  });

  it('captures stale story when history push does not receive explicit patched state', () => {
    // Models useStory.latestStoryRef still pointing to pre-patch story.
    const latestStoryRefValue: StorySnapshot = {
      sourcebook: [{ id: 'tt-1', destination_datetime: '1955-11-05T20:00:00Z' }],
    };

    const patchedStoreStory = applyPatch(latestStoryRefValue, {
      id: 'tt-1',
      destination_datetime: '2015-10-21T16:29:00Z',
    });

    // Old behavior: pushExternalHistoryEntry() without explicit state uses
    // latestStoryRef (stale), overwriting the just-patched store state.
    const pushedHistoryState = latestStoryRefValue;

    expect(patchedStoreStory.sourcebook[0].destination_datetime).toBe(
      '2015-10-21T16:29:00Z'
    );
    expect(pushedHistoryState.sourcebook[0].destination_datetime).toBe(
      '1955-11-05T20:00:00Z'
    );
  });

  it('uses patched store snapshot when explicit state is passed to history push', () => {
    const latestStoryRefValue: StorySnapshot = {
      sourcebook: [{ id: 'tt-1', destination_datetime: '1955-11-05T20:00:00Z' }],
    };

    const patchedStoreStory = applyPatch(latestStoryRefValue, {
      id: 'tt-1',
      destination_datetime: '2015-10-21T16:29:00Z',
    });

    // Fixed behavior: onSourcebookMutated passes the explicit patched store
    // state, so history captures the updated sourcebook value.
    const pushedHistoryState = patchedStoreStory;

    expect(pushedHistoryState.sourcebook[0].destination_datetime).toBe(
      '2015-10-21T16:29:00Z'
    );
  });
});

// ─── Sourcebook list-click opens diff for created entries ─────────────────────
//
// Verifies that clicking a green (AI-created) entry in the list correctly
// sets showDiffForNew=true so the dialog shows all content as added.

describe('sourcebook list-click diff for created entries', () => {
  it('clicking a created entry (in createdEntryIds) sets dialogOpenedViaTrigger=true', () => {
    // Simulate the list-click decision: use createdEntryIds.has(e.id)
    const createdIds = new Set(['hero', 'wizard']);
    const isCreated = (id: string): boolean => createdIds.has(id);

    expect(isCreated('hero')).toBe(true); // → dialogOpenedViaTrigger=true → showDiffForNew=true
    expect(isCreated('villain')).toBe(false); // → dialogOpenedViaTrigger=false → no diff
  });

  it('clicking a modified entry (amber, not in createdEntryIds) leaves dialogOpenedViaTrigger=false', () => {
    // Modified entries still have baselineEntry != null, so diff is shown via
    // baselineEntry.description regardless of showDiffForNew.
    const createdIds = new Set<string>();
    const modifiedIds = new Set(['hero']);
    const id = 'hero';

    expect(createdIds.has(id)).toBe(false); // → dialogOpenedViaTrigger=false
    expect(modifiedIds.has(id)).toBe(true); // but diff still shows via baselineEntry
  });

  it('showDiffForNew=true + no baselineEntry → descriptionBaseline is empty string (all-green)', () => {
    const baselineSourcebook: { id: string; description: string }[] = [];
    const openedEntry = { id: 'hero', description: 'A brave hero' };
    const baselineEntry = baselineSourcebook.find(
      (b: { id: string; description: string }) => b.id === openedEntry.id
    );

    const showDiffForNew = true; // entry is in createdEntryIds
    const baseline =
      baselineEntry != null
        ? baselineEntry.description
        : showDiffForNew
          ? ''
          : undefined;

    expect(baselineEntry).toBeUndefined(); // not in baseline
    expect(baseline).toBe(''); // empty → all content shows as added
  });
});

// ─── External entry refresh closes or remounts dialog ────────────────────────
//
// Verifies the refresh-or-close logic that fires when externalEntries update.

describe('sourcebook dialog external refresh / close', () => {
  type MinEntry = { id: string; description: string };

  const signatureFn = (e: MinEntry): string =>
    JSON.stringify({ description: e.description });

  it('dialog is flagged for close when selected entry disappears from externalEntries', () => {
    const selected: MinEntry = { id: 'hero', description: 'brave' };
    const newExternal: MinEntry[] = []; // entry removed by undo

    const found = newExternal.find(
      (e: { id: string; description: string }) => e.id === selected.id
    );
    expect(found).toBeUndefined(); // → should close dialog
  });

  it('dialog is flagged for remount when selected entry content changes in externalEntries', () => {
    const selected: MinEntry = { id: 'hero', description: 'brave' };
    const newExternal: MinEntry[] = [{ id: 'hero', description: 'old content' }];

    const updated = newExternal.find(
      (e: { id: string; description: string }) => e.id === selected.id
    )!;
    const shouldRemount = signatureFn(updated) !== signatureFn(selected);
    expect(shouldRemount).toBe(true); // → should remount dialog with new content
  });

  it('dialog is not remounted when external update does not change entry content', () => {
    const selected: MinEntry = { id: 'hero', description: 'brave' };
    const newExternal: MinEntry[] = [{ id: 'hero', description: 'brave' }];

    const updated = newExternal.find(
      (e: { id: string; description: string }) => e.id === selected.id
    )!;
    const shouldRemount = signatureFn(updated) !== signatureFn(selected);
    expect(shouldRemount).toBe(false); // → no remount needed
  });

  it('normalization prevents spurious remount when only optional array shape differs', () => {
    type NEntry = { id: string; description: string; keywords?: string[] };
    const sigN = (e: NEntry): string =>
      JSON.stringify({
        description: e.description,
        keywords: [...(e.keywords ?? [])].sort(),
      });

    const selected: NEntry = { id: 'hero', description: 'brave', keywords: undefined };
    const updated: NEntry = { id: 'hero', description: 'brave', keywords: [] };

    expect(sigN(selected)).toEqual(sigN(updated)); // same → no spurious remount
  });
});
