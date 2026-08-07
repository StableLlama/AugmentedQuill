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
  transferInternalMarkers,
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

describe('toOriginalOffset — snapPastMarkers (annotation creation path)', () => {
  // The annotation creation flow (AppMainLayout.handleCreateAnnotation)
  // converts editor-space visible offsets to full-content offsets using
  // toOriginalOffset(..., { snapPastMarkers: true }).  Scene boundary drags
  // use the default (false).  These tests pin the exact difference so a
  // change to either path is caught.

  it('snaps a visible offset at an end-marker boundary to the prose after the marker', () => {
    const content = '<!--scene:1:start-->Hello<!--scene:1:end-->World';
    // stripped: "HelloWorld"; visible 5 = end of "Hello" = boundary before
    // the scene end marker.
    // default (scene drags): keep the marker start position.
    expect(toOriginalOffset(content, 5)).toBe('<!--scene:1:start-->Hello'.length);
    // snapPastMarkers (annotation creation): skip the marker to "World".
    expect(toOriginalOffset(content, 5, { snapPastMarkers: true })).toBe(
      '<!--scene:1:start-->Hello<!--scene:1:end-->'.length
    );
  });

  it('snaps a visible offset at a start-marker boundary to the first prose char after it', () => {
    const content = 'Before<!--scene:1:start-->Hello<!--scene:1:end-->';
    // stripped: "BeforeHello"; visible 6 = start of "Hello" = boundary at the
    // scene start marker.
    expect(toOriginalOffset(content, 6, { snapPastMarkers: true })).toBe(
      'Before<!--scene:1:start-->'.length
    );
  });

  it('snaps correctly with multiple interleaved scene and annotation markers', () => {
    const content =
      '<!--scene:1:start-->A<!--annotation:a1:start-->B<!--annotation:a1:end-->C' +
      '<!--scene:1:end--><!--scene:2:start-->D<!--scene:2:end-->E';
    // stripped: "ABCDE"; visible 2 = after "B" = boundary at the annotation
    // end marker.  snapPastMarkers must skip past that marker to "C".
    expect(toOriginalOffset(content, 2, { snapPastMarkers: true })).toBe(
      '<!--scene:1:start-->A<!--annotation:a1:start-->B<!--annotation:a1:end-->'.length
    );
  });

  it('clamps to content end when the visible offset is beyond the stripped text', () => {
    const content = '<!--scene:1:start-->Hello<!--scene:1:end-->';
    expect(toOriginalOffset(content, 100, { snapPastMarkers: true })).toBe(
      content.length
    );
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

describe('coordinate round-trip — scenes and annotations interleaved', () => {
  it('round-trips every visible position with multiple scenes and interleaved annotations', () => {
    // Real-world document shape: several scenes with annotations nested
    // inside and between them.  The accumulated marker lengths before a
    // position must be accounted for exactly in both directions.
    const content =
      '<!--scene:1:start-->AAA<!--annotation:a1:start-->B<!--annotation:a1:end-->BBB' +
      '<!--scene:1:end-->CC' +
      '<!--scene:2:start-->D<!--annotation:a2:start-->E<!--annotation:a2:end-->FF' +
      '<!--scene:2:end-->G';
    const stripped = stripInlineInternalMarkers(content);
    for (let v = 0; v <= stripped.length; v++) {
      const original = toOriginalOffset(content, v);
      expect(
        toVisibleOffset(content, original),
        `visible ${v} of ${stripped.length}`
      ).toBe(v);
    }
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

describe('transferInternalMarkers', () => {
  const scene1 = '<!--scene:1:start-->';
  const scene1e = '<!--scene:1:end-->';
  const anno = '<!--annotation:a1:start-->';
  const annoe = '<!--annotation:a1:end-->';

  it('returns the stripped content unchanged when there are no markers', () => {
    expect(transferInternalMarkers('plain text', 'plain text')).toBe('plain text');
  });

  it('preserves a scene span when text is inserted INSIDE it', () => {
    const oldContent = `${scene1}Alpha Bravo Charlie${scene1e} Delta`;
    // Insert "X" right after "Alpha" inside scene 1.
    const newStripped = 'AlphaX Bravo Charlie Delta';
    const result = transferInternalMarkers(oldContent, newStripped);
    expect(result).toBe(`${scene1}AlphaX Bravo Charlie${scene1e} Delta`);
  });

  it('preserves a scene span when text is deleted INSIDE it', () => {
    const oldContent = `${scene1}Alpha Bravo Charlie${scene1e} Delta`;
    // Delete " Bravo" inside scene 1.
    const newStripped = 'Alpha Charlie Delta';
    const result = transferInternalMarkers(oldContent, newStripped);
    expect(result).toBe(`${scene1}Alpha Charlie${scene1e} Delta`);
  });

  it('shifts a scene span right when text is inserted BEFORE it', () => {
    const oldContent = `Intro ${scene1}Alpha${scene1e}`;
    const newStripped = 'Long intro Alpha';
    const result = transferInternalMarkers(oldContent, newStripped);
    expect(result).toBe(`Long intro ${scene1}Alpha${scene1e}`);
  });

  it('keeps the span empty (not dropped) when all its prose is deleted', () => {
    const oldContent = `${scene1}Alpha${scene1e} Bravo`;
    const newStripped = ' Bravo';
    const result = transferInternalMarkers(oldContent, newStripped);
    expect(result).toBe(`${scene1}${scene1e} Bravo`);
  });

  it('preserves multiple adjacent scene spans after an edit', () => {
    const oldContent = `${scene1}Alpha${scene1e} ${'<!--scene:2:start-->'}Bravo${'<!--scene:2:end-->'}`;
    // Insert "X" INSIDE scene 1 (mid-word, unambiguous; the space between
    // the scenes is unmarked prose).
    const newStripped = 'AlphaX Bravo';
    const result = transferInternalMarkers(oldContent, newStripped);
    expect(result).toBe(
      `${scene1}AlphaX${scene1e} ${'<!--scene:2:start-->'}Bravo${'<!--scene:2:end-->'}`
    );
  });

  it('preserves an annotation span nested inside a scene span after an edit', () => {
    const oldContent = `${scene1}${anno}Alpha${annoe} Bravo${scene1e}`;
    // Insert "X" inside the annotation's prose.
    const newStripped = 'AlphaX Bravo';
    const result = transferInternalMarkers(oldContent, newStripped);
    expect(result).toBe(`${scene1}${anno}AlphaX${annoe} Bravo${scene1e}`);
  });

  it('re-injected content is valid per validateMarkerIntegrity', () => {
    const oldContent = `${scene1}${anno}Alpha${annoe} Bravo${scene1e}${'<!--scene:2:start-->'}Delta${'<!--scene:2:end-->'}`;
    const newStripped = 'Alpha! Bravo! Delta!';
    const result = transferInternalMarkers(oldContent, newStripped);
    expect(() => validateMarkerIntegrity(result)).not.toThrow();
    expect(stripInlineInternalMarkers(result)).toBe(newStripped);
  });
});
