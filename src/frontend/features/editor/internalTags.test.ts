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
 *   - strippedToFullOffset (stripped -> full-content coordinate conversion)
 *   - Other helpers as needed.
 */

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { strippedToFullOffset } from './internalTags';

describe('strippedToFullOffset', () => {
  it('returns same offset when content has no markers', () => {
    const content = 'Hello World!';
    expect(strippedToFullOffset(content, 0)).toBe(0);
    expect(strippedToFullOffset(content, 6)).toBe(6);
    expect(strippedToFullOffset(content, 11)).toBe(11);
  });

  it('skips scene markers before the stripped offset', () => {
    const content = '<!--scene:1:start-->Hello<!--scene:1:end-->';
    // Stripped content: "Hello" (5 chars)
    // Stripped offset 0 -> after start marker (length of start token)
    // Stripped offset 5 -> end of stripped content -> end of full content
    expect(strippedToFullOffset(content, 0)).toBe('<!--scene:1:start-->'.length);
    expect(strippedToFullOffset(content, 5)).toBe(content.length);
  });

  it('skips annotation markers before the stripped offset', () => {
    const content = '<!--annotation:ann-1:start-->annotated<!--annotation:ann-1:end-->';
    // Stripped: "annotated" (9 chars)
    expect(strippedToFullOffset(content, 0)).toBe(
      '<!--annotation:ann-1:start-->'.length
    );
    // Offset 9 is end of stripped content → end of full content
    expect(strippedToFullOffset(content, 9)).toBe(content.length);
  });

  it('skips multiple markers scattered in content', () => {
    const content =
      '<!--scene:1:start-->Hello<!--scene:1:end--> ' +
      '<!--annotation:a1:start-->World<!--annotation:a1:end-->!';
    // Stripped: "Hello World!" (12 chars)
    // stripped offset 12 = end of stripped content = end of full content
    expect(strippedToFullOffset(content, 12)).toBe(content.length);
  });

  it('handles offset at stripped position 0 with leading markers', () => {
    const content = '<!--scene:1:start-->Text';
    expect(strippedToFullOffset(content, 0)).toBe('<!--scene:1:start-->'.length);
  });

  it('handles offset at stripped end-of-content', () => {
    const content = '<!--scene:1:start-->Hello<!--scene:1:end-->';
    const fullLen = content.length;
    expect(strippedToFullOffset(content, 5)).toBe(fullLen);
  });

  it('handles empty content', () => {
    expect(strippedToFullOffset('', 0)).toBe(0);
  });

  it('handles content with only markers and no prose', () => {
    const content = '<!--scene:1:start--><!--scene:1:end-->';
    // Stripped is empty. Any stripped offset maps to the end of content.
    expect(strippedToFullOffset(content, 0)).toBe(content.length);
  });

  it('preserves offset when prose precedes any markers', () => {
    const content = 'Preamble text<!--scene:1:start-->Body';
    // Stripped: "Preamble textBody" (17 chars)
    expect(strippedToFullOffset(content, 0)).toBe(0);
    expect(strippedToFullOffset(content, 5)).toBe(5);
    // Stripped offset 13 = character 'B' of 'Body'
    // In full content: 13 prose chars + 20 marker chars → position 33
    expect(strippedToFullOffset(content, 13)).toBe(13 + '<!--scene:1:start-->'.length);
    // Stripped offset 17 = end of stripped content = end of full content
    expect(strippedToFullOffset(content, 17)).toBe(content.length);
  });

  it('converts correctly with mixed scene and annotation markers', () => {
    const content =
      '<!--scene:1:start-->' +
      'Hello <!--annotation:a1:start-->World<!--annotation:a1:end-->' +
      '<!--scene:1:end-->';
    // Stripped: "Hello World" (11 chars)
    // stripped offset 0 = after scene:1:start
    const sceneStartLen = '<!--scene:1:start-->'.length;
    expect(strippedToFullOffset(content, 0)).toBe(sceneStartLen);

    // stripped offset 6 = 'W' of 'World'
    // After scene:1:start (20) + "Hello " (6) + annotation:a1:start (26) = 52
    const annStartLen = '<!--annotation:a1:start-->'.length;
    expect(strippedToFullOffset(content, 6)).toBe(sceneStartLen + 6 + annStartLen);

    // stripped offset 11 (end of stripped content) = end of full content
    expect(strippedToFullOffset(content, 11)).toBe(content.length);
  });

  it('converts correctly for real-world scene-marked prose', () => {
    // Simulates: a chapter file with two scene markers and prose in between.
    // The editor strips markers, user selects "jasmine".
    const content =
      '<!--scene:1:start-->The scent of jasmine filled the air' +
      '<!--scene:1:end-->' +
      '<!--scene:2:start-->She walked through the garden' +
      '<!--scene:2:end-->';
    // Stripped: "The scent of jasmine filled the airShe walked through the garden"
    // "jasmine" is at stripped positions 14-20

    const scene1StartLen = '<!--scene:1:start-->'.length; // 20
    const scene1EndLen = '<!--scene:1:end-->'.length; // 18
    const scene2StartLen = '<!--scene:2:start-->'.length; // 20

    // stripped 14 = 'j' (14 chars after stripping scene1 start)
    // full: scene1Start (20) + 14 = 34
    expect(strippedToFullOffset(content, 14)).toBe(scene1StartLen + 14);

    // stripped 21 = 'a' of "air" (end of "jasmine" + 1)
    // full: scene1Start (20) + 21 = 41
    expect(strippedToFullOffset(content, 21)).toBe(scene1StartLen + 21);

    // stripped 37 = 'S' of "She" (after scene1 prose + scene1:end + scene2:start)
    // The first prose segment ends at position 37 in stripped space.
    // Full: scene1Start (20) + 37 + scene1End (18) + scene2Start (20) = 95
    expect(strippedToFullOffset(content, 37)).toBe(
      scene1StartLen + 37 + scene1EndLen + scene2StartLen
    );
  });
});
