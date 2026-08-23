// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for the pure diff-segmentation module used to decide between
 * word-level inline diff and paragraph-level "block mode" diff.
 *
 * Spec:
 *  - Small / word-level changes must stay inline (insert/delete segments).
 *  - Large paragraph-level changes (multi-line, or very large single-line
 *    rewrites) must become a single `block` segment so the UI can render
 *    old and new content as clearly separated blocks.
 *  - Segmentation must always faithfully reconstruct both baseline and
 *    current strings.
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import {
  buildDiffSegments,
  computeFieldSimilarity,
  shouldUseFieldBlock,
  type DiffSegment,
} from './diffBlockMode';

/** Reconstruct `current` from segments (equal + insert + block.inserted). */
function reconstructCurrent(segments: DiffSegment[]): string {
  return segments
    .filter((s: DiffSegment) => s.kind !== 'delete')
    .map((s: DiffSegment) => (s.kind === 'block' ? s.inserted : s.text))
    .join('');
}

/** Reconstruct `baseline` from segments (equal + delete + block.deleted). */
function reconstructBaseline(segments: DiffSegment[]): string {
  return segments
    .filter((s: DiffSegment) => s.kind !== 'insert')
    .map((s: DiffSegment) => (s.kind === 'block' ? s.deleted : s.text))
    .join('');
}

const WHOLE_PARA_BASELINE = 'Para one sentence here.\nPara two sentence here.\n';
const WHOLE_PARA_CURRENT =
  'Completely different paragraph.\nAnother brand new paragraph.\n';

const LONG_SINGLE_LINE_BASELINE =
  'The quick brown fox jumps over the lazy dog near the old wooden fence by the riverbank.';
const LONG_SINGLE_LINE_CURRENT =
  'A totally different very long sentence that replaced the whole thing completely okay.';

describe('buildDiffSegments', () => {
  it('keeps small word-level changes inline (no block segment)', () => {
    const segments = buildDiffSegments('The quick brown fox', 'The quick red fox');

    expect(segments.some((s: DiffSegment) => s.kind === 'block')).toBe(false);
    expect(segments.some((s: DiffSegment) => s.kind === 'insert')).toBe(true);
    expect(segments.some((s: DiffSegment) => s.kind === 'delete')).toBe(true);
    expect(segments.some((s: DiffSegment) => s.kind === 'equal')).toBe(true);
  });

  it('keeps tiny multi-line changes inline', () => {
    const segments = buildDiffSegments('a\nb', 'a\nc');

    expect(segments.some((s: DiffSegment) => s.kind === 'block')).toBe(false);
    expect(reconstructCurrent(segments)).toBe('a\nc');
    expect(reconstructBaseline(segments)).toBe('a\nb');
  });

  it('classifies a full-paragraph replacement as a single block segment', () => {
    const segments = buildDiffSegments(WHOLE_PARA_BASELINE, WHOLE_PARA_CURRENT);

    const blocks = segments.filter((s: DiffSegment) => s.kind === 'block');
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.kind).toBe('block');
    if (block.kind === 'block') {
      expect(block.deleted).toContain('Para one sentence');
      expect(block.inserted).toContain('Completely different paragraph');
    }
  });

  it('classifies a very large single-line rewrite as a block segment', () => {
    const segments = buildDiffSegments(
      LONG_SINGLE_LINE_BASELINE,
      LONG_SINGLE_LINE_CURRENT
    );

    expect(segments.some((s: DiffSegment) => s.kind === 'block')).toBe(true);
  });

  it('preserves unchanged paragraphs around a block segment', () => {
    const baseline = `Intro line.\n\n${WHOLE_PARA_BASELINE}Outro paragraph that remains completely unchanged throughout this diff.`;
    const current = `Intro line.\n\n${WHOLE_PARA_CURRENT}Outro paragraph that remains completely unchanged throughout this diff.`;

    const segments = buildDiffSegments(baseline, current);

    const equalText = segments
      .filter((s: DiffSegment) => s.kind === 'equal')
      .map((s: DiffSegment) => s.text)
      .join('');
    expect(equalText).toContain('Intro line.');
    expect(equalText).toContain('Outro paragraph that remains');
    expect(segments.some((s: DiffSegment) => s.kind === 'block')).toBe(true);
    expect(reconstructCurrent(segments)).toBe(current);
    expect(reconstructBaseline(segments)).toBe(baseline);
  });

  it('treats a whole inserted paragraph as a block segment', () => {
    const inserted = [
      'This is a long brand-new paragraph that was added wholesale.',
      'It continues onto a second line so the block spans paragraphs.',
      '',
    ].join('\n');

    const segments = buildDiffSegments('', inserted);

    const block = segments.find((s: DiffSegment) => s.kind === 'block');
    expect(block).toBeTruthy();
    expect(reconstructCurrent(segments)).toBe(inserted);
    expect(reconstructBaseline(segments)).toBe('');
  });

  it('disables block mode entirely when blockMode option is false', () => {
    const segments = buildDiffSegments(WHOLE_PARA_BASELINE, WHOLE_PARA_CURRENT, {
      blockMode: false,
    });

    expect(segments.some((s: DiffSegment) => s.kind === 'block')).toBe(false);
    expect(segments.some((s: DiffSegment) => s.kind === 'insert')).toBe(true);
    expect(segments.some((s: DiffSegment) => s.kind === 'delete')).toBe(true);
    expect(reconstructCurrent(segments)).toBe(WHOLE_PARA_CURRENT);
  });

  it('faithfully reconstructs both strings for a varied diff', () => {
    const baseline = 'Alpha one.\n\nBeta two.\n\nGamma three.';
    const current = 'Alpha one.\n\nBeta rewritten with more words now.\n\nDelta four.';

    const segments = buildDiffSegments(baseline, current);
    expect(reconstructCurrent(segments)).toBe(current);
    expect(reconstructBaseline(segments)).toBe(baseline);
  });
});

describe('whole-field block mode (short fields)', () => {
  const singleLineOld = 'A group of adventurers discovers a hidden temple.';
  const singleLineNew = 'A band of explorers stumbles upon an ancient city.';

  it('flags a short single-line whole-field rewrite as a field block', () => {
    // Even though this is one line (so the zone-level rule stays inline), the
    // field as a whole is very dissimilar — a classic scene-summary rewrite.
    const segments = buildDiffSegments(singleLineOld, singleLineNew);
    const maxLen = Math.max(singleLineOld.length, singleLineNew.length);

    expect(shouldUseFieldBlock(segments, maxLen)).toBe(true);
  });

  it('does NOT flag a small single-line edit as a field block', () => {
    const segments = buildDiffSegments('The quick brown fox', 'The quick red fox');
    const maxLen = Math.max('The quick brown fox'.length, 'The quick red fox'.length);

    expect(shouldUseFieldBlock(segments, maxLen)).toBe(false);
  });

  it('does NOT flag a long field even when heavily rewritten', () => {
    const longOld = Array(14).fill(singleLineOld).join(' ');
    const longNew = Array(14).fill(singleLineNew).join(' ');

    const segments = buildDiffSegments(longOld, longNew);
    const maxLen = Math.max(longOld.length, longNew.length);

    // Longer than FIELD_BLOCK_MAX_LEN → falls back to local/zone rendering.
    expect(maxLen).toBeGreaterThan(600);
    expect(shouldUseFieldBlock(segments, maxLen)).toBe(false);
  });

  it('does NOT flag empty content', () => {
    const segments = buildDiffSegments('', '');
    expect(shouldUseFieldBlock(segments, 0)).toBe(false);
  });

  it('computes field similarity as the unchanged fraction', () => {
    const segments = buildDiffSegments('Same prefix words', 'Same prefix words!');
    const maxLen = Math.max('Same prefix words'.length, 'Same prefix words!'.length);
    const similarity = computeFieldSimilarity(segments, maxLen);

    expect(similarity).toBeGreaterThan(0.9);
    expect(shouldUseFieldBlock(segments, maxLen)).toBe(false);
  });

  it('honours a caller-supplied max length limit for large fields', () => {
    // A scene's linked prose (thousands of chars) rewritten wholesale.  The
    // conservative default limit excludes it, but a dialog rendering a bounded
    // field can opt into whole-field blocks with a larger limit.
    const oldProse = `Old paragraph one with plenty of detail here.\n\n${'Old filler sentence repeated for context. '.repeat(20)}`;
    const newProse = `New paragraph one completely rewritten.\n\n${'New filler sentence that replaces everything. '.repeat(20)}`;

    const segments = buildDiffSegments(oldProse, newProse);
    const maxLen = Math.max(oldProse.length, newProse.length);

    expect(shouldUseFieldBlock(segments, maxLen)).toBe(false);
    expect(shouldUseFieldBlock(segments, maxLen, 20000)).toBe(true);
  });
});
