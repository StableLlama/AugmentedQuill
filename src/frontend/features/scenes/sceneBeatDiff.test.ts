// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for the scene beat diff alignment used by the scene editor dialog.
 */

import { describe, it, expect } from 'vitest';
import { diffSceneBeats } from './sceneBeatDiff';
import type { SceneBeatDiffEntry } from './sceneBeatDiff';

const summarize = (
  entries: readonly SceneBeatDiffEntry[]
): Array<[string, string, number | null, number | null]> =>
  entries.map((entry: SceneBeatDiffEntry) => [
    entry.kind,
    entry.text,
    entry.currentIndex,
    entry.baselineIndex,
  ]);

describe('diffSceneBeats', () => {
  it('reports every current beat as unchanged when the lists match', () => {
    const entries = diffSceneBeats(['a', 'b'], ['a', 'b']);
    expect(summarize(entries)).toEqual([
      ['unchanged', 'a', 0, 0],
      ['unchanged', 'b', 1, 1],
    ]);
  });

  it('reports beats appended by the chat as added', () => {
    const entries = diffSceneBeats(['a', 'b'], ['a', 'b', 'c', 'd']);
    expect(summarize(entries)).toEqual([
      ['unchanged', 'a', 0, 0],
      ['unchanged', 'b', 1, 1],
      ['added', 'c', 2, null],
      ['added', 'd', 3, null],
    ]);
  });

  it('reports every beat as added when the baseline had no beats', () => {
    const entries = diffSceneBeats([], ['a', 'b']);
    expect(summarize(entries)).toEqual([
      ['added', 'a', 0, null],
      ['added', 'b', 1, null],
    ]);
  });

  it('keeps the following beats unchanged when a beat is inserted mid-list', () => {
    // Positional comparison reported 'b' and 'c' as changed; alignment must not.
    const entries = diffSceneBeats(['a', 'b', 'c'], ['a', 'x', 'b', 'c']);
    expect(summarize(entries)).toEqual([
      ['unchanged', 'a', 0, 0],
      ['added', 'x', 1, null],
      ['unchanged', 'b', 2, 1],
      ['unchanged', 'c', 3, 2],
    ]);
  });

  it('shows a rewritten beat as removed old text followed by added new text', () => {
    const entries = diffSceneBeats(['a', 'old'], ['a', 'new']);
    expect(summarize(entries)).toEqual([
      ['unchanged', 'a', 0, 0],
      ['removed', 'old', null, 1],
      ['added', 'new', 1, null],
    ]);
  });

  it('reports beats dropped by the chat as removed', () => {
    const entries = diffSceneBeats(['a', 'b', 'c'], ['a']);
    expect(summarize(entries)).toEqual([
      ['unchanged', 'a', 0, 0],
      ['removed', 'b', null, 1],
      ['removed', 'c', null, 2],
    ]);
  });

  it('never loses rows when the whole list is replaced', () => {
    const entries = diffSceneBeats(['a', 'b'], ['c', 'd']);
    const currentTexts = entries
      .filter((entry: SceneBeatDiffEntry) => entry.currentIndex !== null)
      .map((entry: SceneBeatDiffEntry) => entry.text);
    const removedTexts = entries
      .filter((entry: SceneBeatDiffEntry) => entry.kind === 'removed')
      .map((entry: SceneBeatDiffEntry) => entry.text);
    expect(currentTexts).toEqual(['c', 'd']);
    expect(removedTexts).toEqual(['a', 'b']);
  });

  it('keeps current indexes valid against the current beat array', () => {
    const current = ['a', 'inserted', 'b'];
    const entries = diffSceneBeats(['a', 'b'], current);
    entries
      .filter((entry: SceneBeatDiffEntry) => entry.currentIndex !== null)
      .forEach((entry: SceneBeatDiffEntry) => {
        expect(current[entry.currentIndex as number]).toBe(entry.text);
      });
  });
});
