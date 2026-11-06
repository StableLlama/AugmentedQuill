// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Beat-list alignment for the scene editor's diff view.
 *
 * Chat tools (`manage_scenes` update) rewrite a scene's beat list as a whole,
 * so comparing beats by array position mislabels every beat that follows an
 * insertion and cannot show deletions at all.  This module aligns the baseline
 * beat texts with the current ones (longest common subsequence) and reports
 * every row as unchanged, added or removed, which is exactly what the dialog
 * needs to give beats the same diff treatment as the other scene fields.
 */

/** How a beat row relates to the pre-AI baseline of the scene. */
export type SceneBeatDiffKind = 'unchanged' | 'added' | 'removed';

/** One row of the aligned beat diff. */
export interface SceneBeatDiffEntry {
  /** Relationship of this row to the baseline. */
  kind: SceneBeatDiffKind;
  /** Beat text rendered by this row. */
  text: string;
  /** Index into the current beat array, or `null` for a removed beat. */
  currentIndex: number | null;
  /** Index into the baseline beat array, or `null` for an added beat. */
  baselineIndex: number | null;
}

const makeEntry = (
  kind: SceneBeatDiffKind,
  text: string,
  currentIndex: number | null,
  baselineIndex: number | null
): SceneBeatDiffEntry => ({ kind, text, currentIndex, baselineIndex });

/**
 * Longest-common-subsequence length table for the two beat-text lists.
 *
 * `table[i][j]` holds the LCS length of `baseline[i..]` and `current[j..]`, so
 * the forward walk below can decide whether keeping the baseline beat or the
 * current beat preserves more matches.
 */
const buildAlignmentTable = (
  baseline: readonly string[],
  current: readonly string[]
): number[][] => {
  const table: number[][] = Array.from({ length: baseline.length + 1 }, () =>
    new Array<number>(current.length + 1).fill(0)
  );
  for (let i = baseline.length - 1; i >= 0; i -= 1) {
    for (let j = current.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        baseline[i] === current[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
};

/**
 * Align the baseline beat texts with the current beat texts.
 *
 * Rows are emitted in reading order: a rewritten beat therefore shows its old
 * text (removed) directly above its new text (added), and unchanged beats keep
 * their exact array positions so the editable rows stay aligned with `beats`.
 */
export function diffSceneBeats(
  baselineTexts: readonly string[],
  currentTexts: readonly string[]
): SceneBeatDiffEntry[] {
  const table = buildAlignmentTable(baselineTexts, currentTexts);
  const entries: SceneBeatDiffEntry[] = [];
  let baselineIndex = 0;
  let currentIndex = 0;

  while (baselineIndex < baselineTexts.length && currentIndex < currentTexts.length) {
    if (baselineTexts[baselineIndex] === currentTexts[currentIndex]) {
      entries.push(
        makeEntry('unchanged', currentTexts[currentIndex], currentIndex, baselineIndex)
      );
      baselineIndex += 1;
      currentIndex += 1;
      continue;
    }
    if (
      table[baselineIndex + 1][currentIndex] >= table[baselineIndex][currentIndex + 1]
    ) {
      entries.push(
        makeEntry('removed', baselineTexts[baselineIndex], null, baselineIndex)
      );
      baselineIndex += 1;
      continue;
    }
    entries.push(makeEntry('added', currentTexts[currentIndex], currentIndex, null));
    currentIndex += 1;
  }

  while (baselineIndex < baselineTexts.length) {
    entries.push(
      makeEntry('removed', baselineTexts[baselineIndex], null, baselineIndex)
    );
    baselineIndex += 1;
  }
  while (currentIndex < currentTexts.length) {
    entries.push(makeEntry('added', currentTexts[currentIndex], currentIndex, null));
    currentIndex += 1;
  }

  return entries;
}
