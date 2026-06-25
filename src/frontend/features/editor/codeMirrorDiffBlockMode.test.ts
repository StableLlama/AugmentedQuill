// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Unit tests for the local zone-based diff merging logic.
 * Verifies that only locally substantial rewrites are merged into block
 * replacements — the rest of the document stays as word-level inline diff.
 */

import { describe, expect, it } from 'vitest';
import { diff_match_patch } from 'diff-match-patch';

const dmp = new diff_match_patch();

/** Maximum equal-text gap that doesn't break a rewrite zone. */
const ZONE_GAP_THRESHOLD = 20;
/** Minimum total changed chars for a zone to become block mode. */
const ZONE_MIN_CHANGED = 80;

/**
 * Merge adjacent diff segments into block-mode zones.
 * (Duplicated from codeMirrorDiffPlugin.ts for unit testing.)
 */
function mergeDiffZones(
  diffs: import('diff-match-patch').Diff[],
  gapThreshold: number,
  minZoneChars: number
): import('diff-match-patch').Diff[] {
  const merged: import('diff-match-patch').Diff[] = [];
  let i = 0;

  while (i < diffs.length) {
    const [op, text] = diffs[i];

    if (op === 0) {
      merged.push([op, text]);
      i++;
      continue;
    }

    let zoneDeleted = '';
    let zoneInserted = '';
    if (op === -1) zoneDeleted += text;
    else zoneInserted += text;
    let j = i + 1;

    while (j < diffs.length) {
      const [nextOp, nextText] = diffs[j];

      if (nextOp === 0 && nextText.length <= gapThreshold) {
        zoneDeleted += nextText;
        zoneInserted += nextText;
        j++;
      } else if (nextOp === -1 || nextOp === 1) {
        if (nextOp === -1) zoneDeleted += nextText;
        else zoneInserted += nextText;
        j++;
      } else {
        break;
      }
    }

    const totalChanged = zoneDeleted.length + zoneInserted.length;
    if (totalChanged >= minZoneChars) {
      if (zoneDeleted.length > 0) merged.push([-1, zoneDeleted]);
      if (zoneInserted.length > 0) merged.push([1, zoneInserted]);
    } else {
      for (let k = i; k < j; k++) merged.push(diffs[k]);
    }

    i = j;
  }

  return merged;
}

function computeDiffs(
  oldText: string,
  newText: string
): import('diff-match-patch').Diff[] {
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);
  return diffs;
}

/** Count how many diff segments are block-mode (large changed segment). */
function countBlockSegments(diffs: import('diff-match-patch').Diff[]): number {
  return diffs.filter(
    (d: import('diff-match-patch').Diff) =>
      d[0] !== 0 && d[1].length >= ZONE_MIN_CHANGED
  ).length;
}

// ---------------------------------------------------------------------------

describe('mergeDiffZones (local zone-based block merging)', () => {
  it('keeps small word-level changes as inline diff', () => {
    const oldText = 'The quick brown fox jumped over the lazy dog.';
    const newText = 'The quick red fox jumped over the lazy dog.';
    const diffs = computeDiffs(oldText, newText);
    const merged = mergeDiffZones(diffs, ZONE_GAP_THRESHOLD, ZONE_MIN_CHANGED);

    expect(countBlockSegments(merged)).toBe(0);
    expect(merged.length).toBeGreaterThan(0);
  });

  it('merges a full sentence rewrite into a block zone', () => {
    const oldText = 'The quick brown fox jumped over the lazy dog.';
    const newText = 'A sleek silver vixen leaped across the sleepy old hound.';
    const diffs = computeDiffs(oldText, newText);
    const merged = mergeDiffZones(diffs, ZONE_GAP_THRESHOLD, ZONE_MIN_CHANGED);

    expect(merged.length).toBe(2);
    expect(merged[0][0]).toBe(-1);
    expect(merged[1][0]).toBe(1);
  });

  it('merges a replaced scene inside a longer chapter into a single block zone', () => {
    const beforeScene =
      'It was a dark and stormy night. The wind howled through the ancient trees that lined the cobblestone path. Rain hammered against the manor windows like an army of tiny fists demanding entry.';
    const oldScene =
      'John walked into the room. He looked around and saw the dusty furniture. Mary sat by the window reading a thick novel. She did not notice him enter.';
    const afterScene =
      'The clock struck midnight. A cold draft swept through the hallway. Somewhere in the distance a dog barked twice and fell silent. The old house groaned.';
    const newScene =
      'John entered the chamber quietly. His eyes scanned the dim space until they found Mary near the arched window. She sat with a heavy book in her lap, her gaze fixed on the pages as though she resented any interruption.';

    const oldText = [beforeScene, '', oldScene, '', afterScene].join('\n');
    const newText = [beforeScene, '', newScene, '', afterScene].join('\n');

    const diffs = computeDiffs(oldText, newText);
    const merged = mergeDiffZones(diffs, ZONE_GAP_THRESHOLD, ZONE_MIN_CHANGED);

    // The rewritten scene should be one block (delete + insert pair).
    expect(countBlockSegments(merged)).toBe(2);

    // The before/after scenes should be unchanged.
    const equalSegments = merged.filter(
      (d: import('diff-match-patch').Diff) => d[0] === 0
    );
    expect(equalSegments.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT merge changes separated by large equal gaps', () => {
    const unchangedBlock =
      'This long paragraph stays exactly the same in both versions. It has enough words and characters to clearly exceed the gap threshold between the two small edits we are testing. Filler text filler text filler text.';

    const oldFull =
      'The cat sat on the mat. ' + unchangedBlock + ' The dog lay by the fire.';
    const newFull =
      'The cat rested on the rug. ' + unchangedBlock + ' The dog slept by the hearth.';

    const diffs = computeDiffs(oldFull, newFull);
    const merged = mergeDiffZones(diffs, ZONE_GAP_THRESHOLD, ZONE_MIN_CHANGED);

    // Two small edits far apart — neither large enough for block mode.
    expect(countBlockSegments(merged)).toBe(0);
  });

  it('handles identical texts with no zones', () => {
    const text = 'Hello world';
    const diffs = computeDiffs(text, text);
    const merged = mergeDiffZones(diffs, ZONE_GAP_THRESHOLD, ZONE_MIN_CHANGED);
    expect(merged.length).toBe(1);
    expect(merged[0][0]).toBe(0);
  });
});
