// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for internal-tag grammar helpers.
 *
 * Covers:
 *   - toVisibleOffset / toOriginalOffset — the single canonical, exact
 *     marker-walking coordinate conversion pair (replaces the former
 *     duplicate `strippedToFullOffset`, which disagreed with
 *     `proseLinkCoordinates.ts`'s `toOriginalOffset` on trailing-marker
 *     semantics because nothing called it in production).
 *   - validateMarkerIntegrity — the fail-safe gate for the generalized
 *     scene/annotation marker system.
 */

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  MarkerIntegrityError,
  stripInlineInternalMarkers,
  toOriginalOffset,
  toVisibleOffset,
  validateMarkerIntegrity,
} from './internalTags';

describe('toOriginalOffset', () => {
  it('returns same offset when content has no markers', () => {
    const content = 'Hello World!';
    expect(toOriginalOffset(content, 0)).toBe(0);
    expect(toOriginalOffset(content, 6)).toBe(6);
    expect(toOriginalOffset(content, 11)).toBe(11);
  });

  it('returns position before a trailing scene end marker, not after it', () => {
    // Regression: a naive stripped->full walk previously landed AFTER the
    // trailing marker (content.length) instead of right before it. Landing
    // after it would place a dragged boundary handle past the marker, into
    // the next scene's territory.
    const content = '<!--scene:1:start-->Hello<!--scene:1:end-->';
    const sceneStartLen = '<!--scene:1:start-->'.length;
    expect(toOriginalOffset(content, 5)).toBe(sceneStartLen + 5);
  });

  it('returns position before a trailing annotation end marker, not after it', () => {
    const content = '<!--annotation:ann-1:start-->annotated<!--annotation:ann-1:end-->';
    const annStartLen = '<!--annotation:ann-1:start-->'.length;
    expect(toOriginalOffset(content, 9)).toBe(annStartLen + 9);
  });

  it('returns end of content when real prose follows the last marker', () => {
    const content =
      '<!--scene:1:start-->Hello<!--scene:1:end--> ' +
      '<!--annotation:a1:start-->World<!--annotation:a1:end-->!';
    // Stripped: "Hello World!" (12 chars) — the trailing "!" is real prose
    // after the last marker, so offset 12 genuinely is end-of-content.
    expect(toOriginalOffset(content, 12)).toBe(content.length);
  });

  it('handles empty content', () => {
    expect(toOriginalOffset('', 0)).toBe(0);
  });

  it('maps to position 0 for marker-only (zero-prose) content', () => {
    // With no visible prose at all, offset 0 is the only valid visible
    // offset, and it must map back to position 0 (the start of content),
    // matching toVisibleOffset's inverse for this same content.
    const content = '<!--scene:1:start--><!--scene:1:end-->';
    expect(toOriginalOffset(content, 0)).toBe(0);
  });

  it('round-trips through toVisibleOffset for every visible position', () => {
    const content =
      '<!--scene:1:start-->' +
      'Hello <!--annotation:a1:start-->World<!--annotation:a1:end-->' +
      '<!--scene:1:end-->';
    const stripped = stripInlineInternalMarkers(content);
    for (let v = 0; v <= stripped.length; v++) {
      const original = toOriginalOffset(content, v);
      expect(toVisibleOffset(content, original), `visible ${v}`).toBe(v);
    }
  });
});

describe('toVisibleOffset', () => {
  it('returns same offset when content has no markers', () => {
    const content = 'Hello World!';
    expect(toVisibleOffset(content, 0)).toBe(0);
    expect(toVisibleOffset(content, 6)).toBe(6);
  });

  it('skips scene and annotation markers before the offset', () => {
    const content =
      '<!--scene:1:start-->The scent of jasmine filled the air<!--scene:1:end-->' +
      '<!--scene:2:start-->She walked through the garden<!--scene:2:end-->';
    const scene1StartLen = '<!--scene:1:start-->'.length;
    // "jasmine" starts 14 prose chars into scene 1.
    expect(toVisibleOffset(content, scene1StartLen + 14)).toBe(14);
  });

  it('returns identity when fullContent is empty', () => {
    expect(toVisibleOffset('', 5)).toBe(5);
  });
});

describe('validateMarkerIntegrity', () => {
  it('accepts well-formed scene and annotation markers together', () => {
    const content =
      '<!--scene:1:start-->Hello <!--annotation:a1:start-->World' +
      '<!--annotation:a1:end--><!--scene:1:end-->';
    expect(() => validateMarkerIntegrity(content)).not.toThrow();
  });

  it('accepts any number of overlapping annotations (non-exclusive layer)', () => {
    const content =
      '<!--annotation:a1:start-->Hello ' +
      '<!--annotation:a2:start-->World<!--annotation:a1:end-->' +
      '<!--annotation:a2:end-->';
    expect(() => validateMarkerIntegrity(content)).not.toThrow();
  });

  it('accepts an annotation that straddles a scene boundary', () => {
    const content =
      '<!--scene:1:start-->' +
      '<!--annotation:a1:start-->Hello <!--scene:1:end-->' +
      '<!--scene:2:start-->World<!--annotation:a1:end-->' +
      '<!--scene:2:end-->';
    expect(() => validateMarkerIntegrity(content)).not.toThrow();
  });

  it('rejects two overlapping scene spans (exclusive layer)', () => {
    // scene:2 opens before scene:1 closes -> overlapping scene ownership.
    const content =
      '<!--scene:1:start-->Alpha<!--scene:2:start-->Bravo' +
      '<!--scene:1:end-->Charlie<!--scene:2:end-->';
    expect(() => validateMarkerIntegrity(content)).toThrow(MarkerIntegrityError);
  });

  it('rejects an unclosed scene start marker', () => {
    const content = '<!--scene:1:start-->Hello';
    expect(() => validateMarkerIntegrity(content)).toThrow(MarkerIntegrityError);
  });

  it('rejects an orphaned scene end marker', () => {
    const content = 'Hello<!--scene:1:end-->';
    expect(() => validateMarkerIntegrity(content)).toThrow(MarkerIntegrityError);
  });

  it('rejects two unmatched start markers for the same scene id', () => {
    const content = '<!--scene:1:start--><!--scene:1:start-->Hello<!--scene:1:end-->';
    expect(() => validateMarkerIntegrity(content)).toThrow(MarkerIntegrityError);
  });

  it('allows two scenes that only touch at a shared boundary', () => {
    // Adjacent, non-overlapping scenes (end of one = start of next) are fine.
    const content =
      '<!--scene:1:start-->Alpha<!--scene:1:end-->' +
      '<!--scene:2:start-->Bravo<!--scene:2:end-->';
    expect(() => validateMarkerIntegrity(content)).not.toThrow();
  });
});
