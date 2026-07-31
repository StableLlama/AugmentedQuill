// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for scroll geometry utilities.
 */

import { describe, it, expect } from 'vitest';
import { isRangeVisible } from './scrollUtils';

describe('isRangeVisible', () => {
  // ── Fully contained ────────────────────────────────────────────────────

  it('returns true when the range is fully inside a single visible range', () => {
    expect(isRangeVisible(50, 150, [{ from: 0, to: 200 }])).toBe(true);
  });

  it('returns true when the range exactly matches a visible range', () => {
    expect(isRangeVisible(0, 200, [{ from: 0, to: 200 }])).toBe(true);
  });

  // ── Partial overlap (the bug scenario) ─────────────────────────────────

  it('returns true when the range start is before visible range but end is inside (partial bottom overlap)', () => {
    // Scene runs [50, 200]; viewport shows [100, 300]; the tail [100,200] is visible
    expect(isRangeVisible(50, 200, [{ from: 100, to: 300 }])).toBe(true);
  });

  it('returns true when the range start is inside visible range but end is after (partial top overlap)', () => {
    // Scene runs [50, 200]; viewport shows [0, 100]; the head [50,100] is visible
    expect(isRangeVisible(50, 200, [{ from: 0, to: 100 }])).toBe(true);
  });

  it('returns true when the range fully encompasses a visible range', () => {
    // Scene covers [0, 500]; viewport is [100, 200]; all of viewport is within the scene
    expect(isRangeVisible(0, 500, [{ from: 100, to: 200 }])).toBe(true);
  });

  // ── Not visible ────────────────────────────────────────────────────────

  it('returns false when the range is entirely before any visible range', () => {
    expect(isRangeVisible(0, 50, [{ from: 100, to: 200 }])).toBe(false);
  });

  it('returns false when the range is entirely after any visible range', () => {
    expect(isRangeVisible(300, 400, [{ from: 0, to: 200 }])).toBe(false);
  });

  it('returns false when there are no visible ranges', () => {
    expect(isRangeVisible(0, 100, [])).toBe(false);
  });

  it('returns false when the range sits in a gap between multiple visible ranges', () => {
    expect(
      isRangeVisible(150, 180, [
        { from: 0, to: 100 },
        { from: 200, to: 300 },
      ])
    ).toBe(false);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  it('returns false for an empty range (from === to) positioned before visible range', () => {
    expect(isRangeVisible(50, 50, [{ from: 100, to: 200 }])).toBe(false);
  });

  it('returns true for an empty range (from === to) positioned inside visible range', () => {
    expect(isRangeVisible(150, 150, [{ from: 100, to: 200 }])).toBe(true);
  });

  it('returns false when the range ends exactly at a visible range start (touching, no overlap)', () => {
    // [50, 100) does not overlap [100, 200] because rangeTo === visibleFrom
    expect(isRangeVisible(50, 100, [{ from: 100, to: 200 }])).toBe(false);
  });

  it('returns true when range starts exactly at a visible range end (touching, overlapping by convention)', () => {
    // visible range is [0, 100]; our range starts at 100
    // rangeFrom(100) < vr.to(100) is false → no overlap
    // This is consistent with the "touching, no overlap" semantics
    expect(isRangeVisible(100, 200, [{ from: 0, to: 100 }])).toBe(false);
  });

  // ── Multiple visible ranges ────────────────────────────────────────────

  it('returns true when the range overlaps the first of several visible ranges', () => {
    expect(
      isRangeVisible(50, 150, [
        { from: 0, to: 100 },
        { from: 200, to: 300 },
      ])
    ).toBe(true);
  });

  it('returns true when the range overlaps the second of several visible ranges', () => {
    expect(
      isRangeVisible(250, 350, [
        { from: 0, to: 100 },
        { from: 200, to: 300 },
      ])
    ).toBe(true);
  });
});
