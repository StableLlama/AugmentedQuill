// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for prose link coordinate mapping functions.
 */

import { describe, it, expect } from 'vitest';
import {
  toOriginalOffset,
  toVisibleLinkedOffset,
  toVisibleRange,
} from './proseLinkCoordinates';
import {
  stripInlineInternalMarkers,
  INLINE_INTERNAL_MARKER_REGEX,
} from '../editor/internalTags';

describe('toVisibleLinkedOffset', () => {
  it('converts original offset to visible offset using fullContent', () => {
    // <!--scene:a:start--> = 20 chars, <!--scene:a:end--> = 18 chars
    // Full: AAA(0-2) <!--scene:a:start-->(3-22) BBB(23-25) <!--scene:a:end-->(26-43) CCC(44-46)
    const fullContent = 'AAA<!--scene:a:start-->BBB<!--scene:a:end-->CCC';
    // Visible: AAABBBCCC  (positions 0..8)
    // Use loose=true to bypass shouldAdjustOffsets and test the fullContent path directly
    expect(
      toVisibleLinkedOffset(0, null as unknown as never, [], true, fullContent)
    ).toBe(0);
    expect(
      toVisibleLinkedOffset(2, null as unknown as never, [], true, fullContent)
    ).toBe(2);
    expect(
      toVisibleLinkedOffset(23, null as unknown as never, [], true, fullContent)
    ).toBe(3);
    expect(
      toVisibleLinkedOffset(25, null as unknown as never, [], true, fullContent)
    ).toBe(5);
    expect(
      toVisibleLinkedOffset(44, null as unknown as never, [], true, fullContent)
    ).toBe(6);
  });

  it('handles offset before any markers', () => {
    const fullContent = 'Pre<!--scene:a:start-->Body<!--scene:a:end-->Post';
    expect(
      toVisibleLinkedOffset(0, null as unknown as never, [], true, fullContent)
    ).toBe(0);
    expect(
      toVisibleLinkedOffset(2, null as unknown as never, [], true, fullContent)
    ).toBe(2);
  });

  it('maps offsets inside a marker to the visible position at marker start', () => {
    // <!--scene:a:start--> = 20 chars, <!--scene:a:end--> = 18 chars
    // Content: <!--scene:a:start-->Hello<!--scene:a:end-->
    // Positions: start(0-19) H(20)e(21)l(22)l(23)o(24) end(25-42)
    // Offset 26 is inside the end marker — should map to visible 5 (right after Hello)
    const fullContent = '<!--scene:a:start-->Hello<!--scene:a:end-->';
    expect(
      toVisibleLinkedOffset(20, null as unknown as never, [], true, fullContent)
    ).toBe(0);
    expect(
      toVisibleLinkedOffset(26, null as unknown as never, [], true, fullContent)
    ).toBe(5);
    expect(
      toVisibleLinkedOffset(41, null as unknown as never, [], true, fullContent)
    ).toBe(5);
  });

  it('round-trips correctly: toVisibleLinkedOffset matches stripped prefix length', () => {
    // Verify that for any original position, stripping markers from the prefix
    // gives the same length as toVisibleLinkedOffset.  A valid prose_link
    // offset always falls at a marker boundary (right after start or right
    // before end), so we only test those positions.
    const fullContent = 'AB<!--scene:a:start-->Hello<!--scene:a:end-->CD';
    const positions = [
      0,
      1,
      2, // before a-start
      22,
      23,
      24,
      25,
      26, // inside Hello (after a-start)
      27, // at a-end boundary
      45,
      46, // after a-end (CD)
    ];
    for (const origPos of positions) {
      const vis = toVisibleLinkedOffset(
        origPos,
        null as unknown as never,
        [],
        true,
        fullContent
      );
      const prefix = fullContent.slice(0, origPos);
      const visiblePrefix = stripInlineInternalMarkers(prefix);
      expect(vis, `origPos=${origPos}`).toBe(visiblePrefix.length);
    }
  });

  it('handles multi-scene content correctly', () => {
    // Two scenes with newlines between them
    const fullContent =
      '<!--scene:1:start-->Hello<!--scene:1:end-->\n\n<!--scene:3:start-->World<!--scene:3:end-->';
    //  1-start(0-19) H(20)e(21)l(22)l(23)o(24) 1-end(25-42) \n(43)\n(44)
    //  3-start(45-64) W(65)o(66)r(67)l(68)d(69) 3-end(70-87)
    // Visible: Hello\n\nWorld (12 chars)
    expect(
      toVisibleLinkedOffset(20, null as unknown as never, [], true, fullContent)
    ).toBe(0); // H
    expect(
      toVisibleLinkedOffset(24, null as unknown as never, [], true, fullContent)
    ).toBe(4); // o
    expect(
      toVisibleLinkedOffset(25, null as unknown as never, [], true, fullContent)
    ).toBe(5); // end marker → visible 5
    expect(
      toVisibleLinkedOffset(43, null as unknown as never, [], true, fullContent)
    ).toBe(5); // \n
    expect(
      toVisibleLinkedOffset(65, null as unknown as never, [], true, fullContent)
    ).toBe(7); // W
    expect(
      toVisibleLinkedOffset(70, null as unknown as never, [], true, fullContent)
    ).toBe(12); // end marker → visible 12
  });

  it('every prose_link offset maps to correct visible text (adjacent markers)', () => {
    // Three adjacent scenes — end marker immediately followed by next start.
    const a = '<!--scene:a:start-->';
    const aEnd = '<!--scene:a:end-->';
    const b = '<!--scene:b:start-->';
    const bEnd = '<!--scene:b:end-->';
    const c = '<!--scene:c:start-->';
    const cEnd = '<!--scene:c:end-->';

    const fullContent = a + 'AAA' + aEnd + b + 'BBB' + bEnd + c + 'CCC' + cEnd;
    const stripped = stripInlineInternalMarkers(fullContent);

    const offsets = [
      { label: 'a', start: a.length, end: fullContent.indexOf(aEnd) },
      {
        label: 'b',
        start: fullContent.indexOf(b) + b.length,
        end: fullContent.indexOf(bEnd),
      },
      {
        label: 'c',
        start: fullContent.indexOf(c) + c.length,
        end: fullContent.indexOf(cEnd),
      },
    ];

    for (const { label, start, end } of offsets) {
      const vStart = toVisibleLinkedOffset(
        start,
        null as unknown as never,
        [],
        true,
        fullContent
      );
      const vEnd = toVisibleLinkedOffset(
        end,
        null as unknown as never,
        [],
        true,
        fullContent
      );
      const visibleText = stripped.slice(vStart, vEnd);
      const origText = fullContent.slice(start, end);
      expect(
        visibleText,
        `${label}: visible="${visibleText}" !== orig="${origText}"`
      ).toBe(origText);
    }
  });
});

describe('toOriginalOffset', () => {
  it('converts visible offset back to the original content position', () => {
    // <!--scene:a:start--> = 20 chars, <!--scene:a:end--> = 18 chars
    // Full: AAA(0-2) <!--scene:a:start-->(3-22) BBB(23-25) <!--scene:a:end-->(26-43) CCC(44-46)
    const fullContent = 'AAA<!--scene:a:start-->BBB<!--scene:a:end-->CCC';
    // stripped: AAABBBCCC  (9 chars)
    expect(toOriginalOffset(0, fullContent)).toBe(0);
    expect(toOriginalOffset(1, fullContent)).toBe(1);
    expect(toOriginalOffset(2, fullContent)).toBe(2);
    expect(toOriginalOffset(3, fullContent)).toBe(3); // at start marker boundary
    expect(toOriginalOffset(4, fullContent)).toBe(24);
    expect(toOriginalOffset(5, fullContent)).toBe(25); // last B
    expect(toOriginalOffset(6, fullContent)).toBe(26); // at end marker boundary
    expect(toOriginalOffset(7, fullContent)).toBe(45);
    expect(toOriginalOffset(8, fullContent)).toBe(46); // last C
  });

  it('round-trips correctly: stripping markers from prefix matches visible offset', () => {
    const fullContent = 'Prefix<!--scene:a:start-->MIDDLE<!--scene:a:end-->Suffix';
    const stripped = stripInlineInternalMarkers(fullContent);
    for (let visiblePos = 0; visiblePos < stripped.length; visiblePos++) {
      const originalPos = toOriginalOffset(visiblePos, fullContent);
      const prefix = fullContent.slice(0, originalPos);
      const visiblePrefix = stripInlineInternalMarkers(prefix);
      expect(visiblePrefix.length).toBe(visiblePos);
    }
  });

  it('handles zero-length markers content (no markers)', () => {
    const fullContent = 'Hello world, no markers here!';
    expect(toOriginalOffset(0, fullContent)).toBe(0);
    expect(toOriginalOffset(5, fullContent)).toBe(5);
    expect(toOriginalOffset(10, fullContent)).toBe(10);
  });

  it('handles visible offset of 0', () => {
    const fullContent = '<!--scene:a:start-->Body<!--scene:a:end-->';
    expect(toOriginalOffset(0, fullContent)).toBe(0);
  });

  it('handles visible offset at the end of content (right before trailing end marker)', () => {
    const fullContent = '<!--scene:a:start-->Body<!--scene:a:end-->';
    const stripped = stripInlineInternalMarkers(fullContent); // 'Body' (4 chars)
    // The visible end of text is at position 24 in original (right before the end marker)
    expect(toOriginalOffset(stripped.length, fullContent)).toBe(24);
  });

  it('handles visible offset beyond stripped length (clamps to end)', () => {
    const fullContent = '<!--scene:a:start-->Hi<!--scene:a:end-->';
    expect(toOriginalOffset(999, fullContent)).toBe(fullContent.length);
  });

  it('handles negative visible offset (clamps to 0)', () => {
    const fullContent = '<!--scene:a:start-->Hi<!--scene:a:end-->';
    expect(toOriginalOffset(-1, fullContent)).toBe(0);
  });

  it('works with multiple scene markers', () => {
    // <!--scene:a:start--> = 20 chars, <!--scene:a:end--> = 18 chars
    // <!--scene:b:start--> = 20 chars, <!--scene:b:end--> = 18 chars
    // Pre(0-2) <!--a:start-->(3-22) A(23) <!--a:end-->(24-41) Mid(42-44) <!--b:start-->(45-64) B(65) <!--b:end-->(66-83) Post(84-87)
    const fullContent =
      'Pre<!--scene:a:start-->A<!--scene:a:end-->Mid<!--scene:b:start-->B<!--scene:b:end-->Post';
    // stripped: PreAMidBPost  (11 chars)
    expect(toOriginalOffset(0, fullContent)).toBe(0); // P
    expect(toOriginalOffset(2, fullContent)).toBe(2); // e
    expect(toOriginalOffset(3, fullContent)).toBe(3); // at a:start marker
    expect(toOriginalOffset(4, fullContent)).toBe(24); // at a:end marker
    expect(toOriginalOffset(6, fullContent)).toBe(44); // d (in Mid)
    expect(toOriginalOffset(7, fullContent)).toBe(45); // at b:start marker
    expect(toOriginalOffset(8, fullContent)).toBe(66); // at b:end marker
    expect(toOriginalOffset(10, fullContent)).toBe(86); // t (in Post) — 11 chars
  });

  // ---------------------------------------------------------------------------
  // Bug regression: dragging end handle left on trailing-marker content
  // ---------------------------------------------------------------------------

  it('returns position before trailing end marker when visible offset equals end of visible text', () => {
    // <!--scene:s1:start--> = 21 chars, <!--scene:s1:end--> = 19 chars
    // Full: <!--scene:s1:start-->Hello world<!--scene:s1:end-->
    //       0-20                  21-31      32-50
    // Visible: "Hello world" (11 chars)
    // Dragging end handle to visible offset 11 should map to original
    // position 32 (right before the end marker), NOT 51 (past it).
    const fullContent = '<!--scene:s1:start-->Hello world<!--scene:s1:end-->';
    expect(toOriginalOffset(11, fullContent)).toBe(32);
  });

  it('returns position before end marker when visible offset equals body length', () => {
    // <!--scene:a:start-->Body<!--scene:a:end--> = 42 chars
    //  0-19               20-23 24-41
    // stripped: "Body" (4 chars)
    // Visible offset 4 → original position 24 (before end marker), not 42
    const fullContent = '<!--scene:a:start-->Body<!--scene:a:end-->';
    expect(toOriginalOffset(4, fullContent)).toBe(24);
  });

  it('returns position before end marker when visible offset is in the middle', () => {
    // <!--scene:x:start-->ABCDE<!--scene:x:end-->
    //  0-19                20-24   25-42
    // stripped: "ABCDE" (5 chars)
    // Drag end handle to visible offset 3 → original position 23 (char "C")
    const fullContent = '<!--scene:x:start-->ABCDE<!--scene:x:end-->';
    expect(toOriginalOffset(3, fullContent)).toBe(23);
  });

  it('handles multiple markers that contain the same scene id', () => {
    // <!--scene:a:start--> = 20 chars, <!--scene:a:end--> = 18 chars
    // <!--scene:b:start--> = 20 chars, <!--scene:b:end--> = 18 chars
    // X(0) <!--a:start-->(1-20) Y(21) <!--a:end-->(22-39) Z(40) <!--b:start-->(41-60) W(61) <!--b:end-->(62-79)
    const fullContent =
      'X<!--scene:a:start-->Y<!--scene:a:end-->Z<!--scene:b:start-->W<!--scene:b:end-->';
    // stripped: XYZW  (4 chars)
    expect(toOriginalOffset(0, fullContent)).toBe(0);
    expect(toOriginalOffset(1, fullContent)).toBe(1); // at a:start marker
    expect(toOriginalOffset(2, fullContent)).toBe(22); // at a:end marker
    expect(toOriginalOffset(3, fullContent)).toBe(41); // at b:start marker
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Round-trip property: toOriginalOffset ↔ toVisibleLinkedOffset
// ═══════════════════════════════════════════════════════════════════════

describe('round-trip: toOriginalOffset ↔ toVisibleLinkedOffset', () => {
  // For every visible position in a content with markers,
  // converting to original and back should return the same visible position.
  // This is the fundamental invariant that prevents markers from
  // appearing at wrong positions after backend round-trips.

  const marker = (id: string, edge: 'start' | 'end'): string =>
    `<!--scene:${id}:${edge}-->`;

  function buildContent(scenes: Array<{ id: string; text: string }>): string {
    let result = '';
    for (const s of scenes) {
      result += marker(s.id, 'start') + s.text + marker(s.id, 'end');
    }
    return result;
  }

  const allContentCases = [
    {
      label: 'single scene',
      content: buildContent([{ id: 'a', text: 'Hello world' }]),
    },
    {
      label: 'two adjacent scenes',
      content: buildContent([
        { id: 'a', text: 'AAA' },
        { id: 'b', text: 'BBB' },
      ]),
    },
    {
      label: 'three adjacent scenes',
      content: buildContent([
        { id: 'a', text: 'Once ' },
        { id: 'b', text: 'upon' },
        { id: 'c', text: ' a time' },
      ]),
    },
    {
      label: 'text before and after markers',
      content: 'Prefix' + buildContent([{ id: 'a', text: 'MIDDLE' }]) + 'Suffix',
    },
    {
      label: 'markers-only content (zero-width scenes)',
      content:
        marker('a', 'start') +
        marker('a', 'end') +
        marker('b', 'start') +
        marker('b', 'end'),
    },
    {
      label: 'text between start and end markers of different scenes',
      content:
        marker('a', 'start') +
        'AAA' +
        marker('a', 'end') +
        'between' +
        marker('b', 'start') +
        'BBB' +
        marker('b', 'end'),
    },
    {
      label: 'many markers (5 scenes)',
      content: buildContent([
        { id: 'a', text: 'A' },
        { id: 'b', text: 'BB' },
        { id: 'c', text: 'CCC' },
        { id: 'd', text: 'DDDD' },
        { id: 'e', text: 'EEEEE' },
      ]),
    },
  ];

  for (const { label, content } of allContentCases) {
    it(`round-trips every visible position: ${label}`, () => {
      const stripped = stripInlineInternalMarkers(content);

      // Test EVERY visible position from 0 to stripped.length (inclusive —
      // the position at stripped.length represents the end handle).
      for (let v = 0; v <= stripped.length; v++) {
        const original = toOriginalOffset(v, content);
        const backToVisible = toVisibleLinkedOffset(
          original,
          null as unknown as never,
          [],
          true,
          content
        );
        expect(
          backToVisible,
          `${label}: visible ${v} → original ${original} → visible ${backToVisible} (content: ${content.slice(0, 60)}...)`
        ).toBe(v);
      }
    });

    it(`round-trips all marker-boundary positions: ${label}`, () => {
      // For each scene's prose_link offsets (start = right after start marker,
      // end = right before end marker), verify that converting to visible
      // and back preserves the exact visible range.
      const markerRe = new RegExp(INLINE_INTERNAL_MARKER_REGEX.source, 'g');
      const scenes = new Map<number, { start: number; end: number }>();
      let match: RegExpExecArray | null;
      while ((match = markerRe.exec(content)) !== null) {
        const id = parseInt(match[1], 10);
        const edge = match[2] as 'start' | 'end';
        const entry = scenes.get(id) || { start: -1, end: -1 };
        if (edge === 'start') {
          entry.start = match.index + match[0].length;
        } else {
          entry.end = match.index;
        }
        scenes.set(id, entry);
      }

      for (const [id, { start, end }] of scenes) {
        if (start < 0 || end < 0 || start >= end) continue;
        const visStart = toVisibleLinkedOffset(
          start,
          null as unknown as never,
          [],
          true,
          content
        );
        const visEnd = toVisibleLinkedOffset(
          end,
          null as unknown as never,
          [],
          true,
          content
        );
        const origStartAgain = toOriginalOffset(visStart, content);
        const origEndAgain = toOriginalOffset(visEnd, content);

        expect(
          origStartAgain,
          `${label} scene ${id}: visible start ${visStart} → original should be ${start}`
        ).toBe(start);
        expect(
          origEndAgain,
          `${label} scene ${id}: visible end ${visEnd} → original should be ${end}`
        ).toBe(end);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// toVisibleRange — the function that decides identity vs adjusted
// ---------------------------------------------------------------------------

interface TestScene {
  id: number;
  prose_link?: {
    scope_type: string;
    chapter_id?: string | null;
    start_offset: number;
    end_offset?: number | null;
  } | null;
}

interface TestUnit {
  scope: string;
  id: string;
  content: string;
}

function makeTestScene(
  id: number,
  start: number,
  end: number,
  scopeType: string = 'chapter',
  chapterId: string = '1'
): TestScene {
  return {
    id,
    prose_link: {
      scope_type: scopeType,
      chapter_id: chapterId,
      start_offset: start,
      end_offset: end,
    },
  };
}

describe('toVisibleRange', () => {
  it('returns adjusted visible range for two adjacent chapter-scope scenes', () => {
    // After boundary drag: scene 1 shrunk, scene 2 expanded
    const newContent =
      '<!--scene:1:start-->Alp<!--scene:1:end-->' +
      '<!--scene:2:start-->ha Bravo<!--scene:2:end-->';
    // Positions in new content:
    // scene1:start at 0-19, "Alp" at 20-22, scene1:end at 23-40,
    // scene2:start at 41-60, "ha Bravo" at 61-68, scene2:end at 69-86

    const unit: TestUnit = {
      scope: 'chapter',
      id: '1',
      content: stripInlineInternalMarkers(newContent), // "Alpha Bravo"
    };

    const scenes: TestScene[] = [
      makeTestScene(1, 20, 23), // "Alp" in original
      makeTestScene(2, 61, 69), // "ha Bravo" in original
    ];

    const s1 = toVisibleRange(
      scenes[0] as Parameters<typeof toVisibleRange>[0],
      unit as Parameters<typeof toVisibleRange>[1],
      scenes as Parameters<typeof toVisibleRange>[2],
      newContent
    );
    const s2 = toVisibleRange(
      scenes[1] as Parameters<typeof toVisibleRange>[0],
      unit as Parameters<typeof toVisibleRange>[1],
      scenes as Parameters<typeof toVisibleRange>[2],
      newContent
    );

    // Expected: scene 1 → visible [0, 3) = "Alp", scene 2 → visible [3, 11) = "ha Bravo"
    expect(s1).toEqual({ from: 0, to: 3 });
    expect(s2).toEqual({ from: 3, to: 11 });
  });

  it('returns adjusted range after dragging start marker of scene 2 left into scene 1', () => {
    // Simulates: drag scene 2's start from "Bravo" to overlapping "Alpha"
    const newContent =
      '<!--scene:1:start-->A<!--scene:1:end-->' +
      '<!--scene:2:start-->AABBB<!--scene:2:end-->';
    // scene1:start at 0-19, "A" at 20, scene1:end at 21-38,
    // scene2:start at 39-58, "AABBB" at 59-63, scene2:end at 64-81

    const unit: TestUnit = {
      scope: 'chapter',
      id: '1',
      content: stripInlineInternalMarkers(newContent), // "AAABBB"
    };

    const scenes: TestScene[] = [
      makeTestScene(1, 20, 21), // "A"
      makeTestScene(2, 59, 64), // "AABBB"
    ];

    const s1 = toVisibleRange(
      scenes[0] as Parameters<typeof toVisibleRange>[0],
      unit as Parameters<typeof toVisibleRange>[1],
      scenes as Parameters<typeof toVisibleRange>[2],
      newContent
    );
    const s2 = toVisibleRange(
      scenes[1] as Parameters<typeof toVisibleRange>[0],
      unit as Parameters<typeof toVisibleRange>[1],
      scenes as Parameters<typeof toVisibleRange>[2],
      newContent
    );

    // Visible content: "AAABBB" (A(0) A(1) A(2) B(3) B(4) B(5))
    // Scene 1: [0, 1) = "A"
    // Scene 2: [1, 6) = "AABBB"
    expect(s1).toEqual({ from: 0, to: 1 });
    expect(s2).toEqual({ from: 1, to: 6 });
  });

  it('returns adjusted range for story-scope scenes after boundary drag', () => {
    // Two story-scope scenes, adjacent
    const newContent =
      '<!--scene:1:start-->Hello<!--scene:1:end-->' +
      '<!--scene:2:start-->World<!--scene:2:end-->';
    // scene1:start at 0-19, "Hello" at 20-24, scene1:end at 25-42,
    // scene2:start at 43-62, "World" at 63-67, scene2:end at 68-85

    const unit: TestUnit = {
      scope: 'story',
      id: '', // story scope doesn't use id
      content: stripInlineInternalMarkers(newContent), // "HelloWorld"
    };

    const scenes: TestScene[] = [
      makeTestScene(1, 20, 25, 'story', null), // "Hello"
      makeTestScene(2, 63, 68, 'story', null), // "World"
    ];

    const s1 = toVisibleRange(
      scenes[0] as Parameters<typeof toVisibleRange>[0],
      unit as Parameters<typeof toVisibleRange>[1],
      scenes as Parameters<typeof toVisibleRange>[2],
      newContent
    );
    const s2 = toVisibleRange(
      scenes[1] as Parameters<typeof toVisibleRange>[0],
      unit as Parameters<typeof toVisibleRange>[1],
      scenes as Parameters<typeof toVisibleRange>[2],
      newContent
    );

    // Visible: "HelloWorld" → scene1 [0,5), scene2 [5,10)
    expect(s1).toEqual({ from: 0, to: 5 });
    expect(s2).toEqual({ from: 5, to: 10 });
  });

  it('BUG REGRESSION: returns adjusted not identity when a scene has start_offset that looks like 0', () => {
    // The critical scenario: if any scene in the scope has start_offset === 0,
    // shouldAdjustOffsets returns false and ALL scenes get identity (raw offsets).
    // This test verifies that normal scenes get adjusted positions.

    const content = '<!--scene:1:start-->Hello<!--scene:1:end-->';
    // scene1:start at 0-19, "Hello" at 20-24, scene1:end at 25-42

    const unit: TestUnit = {
      scope: 'chapter',
      id: '1',
      content: stripInlineInternalMarkers(content), // "Hello"
    };

    // Scene with start_offset at position 0 — this is abnormal but tests the condition
    const scenes: TestScene[] = [
      {
        id: 1,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          start_offset: 0,
          end_offset: 5,
        },
      },
    ];

    const result = toVisibleRange(
      scenes[0] as Parameters<typeof toVisibleRange>[0],
      unit as Parameters<typeof toVisibleRange>[1],
      scenes as Parameters<typeof toVisibleRange>[2],
      content
    );

    // When start_offset=0 and shouldAdjustOffsets returns false (due to start_offset===0),
    // mustAdjust for chapter scope also checks rawFrom > unit.content.length.
    // rawFrom=0, unit.content.length=5 → 0>5 is false.
    // So mustAdjust=false and identity is returned: {from:0, to:5}.
    // This happens to be correct since there are no markers before position 0.
    expect(result).toEqual({ from: 0, to: 5 });
  });

  it('IDENTITY BUG: returns identity instead of adjusted when shouldAdjustOffsets returns false', () => {
    // This test MUST FAIL with the current bug.
    // It simulates the EXACT scenario where shouldAdjustOffsets returns false
    // because one scene has start_offset===0 (which can happen in practice).

    const content =
      '<!--scene:1:start-->A<!--scene:1:end-->' +
      '<!--scene:2:start-->BBB<!--scene:2:end-->';

    const unit: TestUnit = {
      scope: 'chapter',
      id: '1',
      content: stripInlineInternalMarkers(content),
    };

    // Scene 1 has start_offset===0 — the poison pill that makes
    // shouldAdjustOffsets return false for ALL scenes.
    const scenes: TestScene[] = [
      {
        id: 1,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          start_offset: 0,
          end_offset: 1,
        },
      },
      {
        id: 2,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          start_offset: 59,
          end_offset: 62,
        },
      },
    ];

    const s2 = toVisibleRange(
      scenes[1] as Parameters<typeof toVisibleRange>[0],
      unit as Parameters<typeof toVisibleRange>[1],
      scenes as Parameters<typeof toVisibleRange>[2],
      content
    );

    // With the bug: identity is {from:59, to:62} — original offsets
    // With the fix: adjusted should be {from:1, to:4} — visible positions
    // The difference (59-1=58) matches "the same size as the scene end and start tags"
    expect(s2).toEqual({ from: 1, to: 4 });
  });

  it('TDD: toVisibleRange correctly adjusts offsets when fullContent has matching markers', () => {
    // With the fix (loose=true and hasFullContent), toVisibleRange correctly
    // adjusts original offsets to visible using fullContent marker walking.

    const content =
      '<!--scene:13:start-->AAA<!--scene:13:end-->' +
      '<!--scene:14:start-->BBB<!--scene:14:end-->';

    const unit: TestUnit = {
      scope: 'chapter',
      id: '3',
      content: stripInlineInternalMarkers(content),
    };

    const scenes: TestScene[] = [
      {
        id: 13,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '3',
          start_offset: 21,
          end_offset: 24,
        },
      },
      {
        id: 14,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '3',
          start_offset: 63,
          end_offset: 66,
        },
      },
    ];

    const result = toVisibleRange(
      scenes[0] as Parameters<typeof toVisibleRange>[0],
      unit as Parameters<typeof toVisibleRange>[1],
      scenes as Parameters<typeof toVisibleRange>[2],
      content
    );

    // Scene 13: start=21, end=24. Marker at 0-20, "AAA" at 21-23, marker at 24-42.
    // Visible: 21-21=0, 24-21=3. Range: {from:0, to:3} = "AAA" ✓
    expect(result).toEqual({ from: 0, to: 3 });
  });

  it('returns null for scene with missing prose_link', () => {
    const unit: TestUnit = { scope: 'chapter', id: '1', content: 'Hello' };
    const scene: TestScene = { id: 1, prose_link: null };

    const result = toVisibleRange(
      scene as Parameters<typeof toVisibleRange>[0],
      unit as Parameters<typeof toVisibleRange>[1],
      [scene] as Parameters<typeof toVisibleRange>[2]
    );
    expect(result).toBeNull();
  });

  it('returns null when scope_type does not match unit', () => {
    const unit: TestUnit = { scope: 'story', id: '', content: 'Hello' };
    const scene = makeTestScene(1, 20, 25, 'chapter', '1');

    const result = toVisibleRange(
      scene as Parameters<typeof toVisibleRange>[0],
      unit as Parameters<typeof toVisibleRange>[1],
      [scene] as Parameters<typeof toVisibleRange>[2],
      '<!--scene:1:start-->Hello<!--scene:1:end-->'
    );
    // chapter scope vs story unit → doesn't match
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regression: content/offset mismatch after boundary drag roundtrip
// ---------------------------------------------------------------------------

describe('prose boundary drag roundtrip (old content with new offsets)', () => {
  /** Simulates the frontend drag handler: visible → original → visible */
  function simulateDragConversion(
    visibleDragOffset: number,
    fullContent: string
  ): number {
    const orig = toOriginalOffset(visibleDragOffset, fullContent);
    return toVisibleLinkedOffset(orig, null as unknown as never, [], true, fullContent);
  }

  /** Simulates the render path: original offsets from backend, rendered with
   *  fullContent (which might be old/stale). */
  function simulateRenderConversion(
    originalStart: number,
    originalEnd: number,
    fullContent: string
  ): { from: number; to: number } {
    return {
      from: toVisibleLinkedOffset(
        originalStart,
        null as unknown as never,
        [],
        true,
        fullContent
      ),
      to: toVisibleLinkedOffset(
        originalEnd,
        null as unknown as never,
        [],
        true,
        fullContent
      ),
    };
  }

  it('drag conversion is identity (visible → original → visible = same)', () => {
    // Two adjacent scenes
    const oldContent =
      '<!--scene:1:start-->Alpha<!--scene:1:end--> ' +
      '<!--scene:2:start-->Bravo<!--scene:2:end--> Charlie Delta';
    // Visible: "Alpha Bravo Charlie Delta"

    const stripped = stripInlineInternalMarkers(oldContent);
    for (let vis = 0; vis <= stripped.length; vis++) {
      const roundtrip = simulateDragConversion(vis, oldContent);
      expect(roundtrip, `visible offset ${vis}`).toBe(vis);
    }
  });

  it('render with old content and new offsets produces wrong visible range', () => {
    // Simulate: scene 2's start was dragged left, backend returned new offsets.
    // The new offsets are in original coords relative to NEW content, but we
    // render with OLD content (the bug: chapter content not refreshed).

    const oldContent =
      '<!--scene:1:start-->Alpha<!--scene:1:end--> ' +
      '<!--scene:2:start-->Bravo<!--scene:2:end--> Charlie Delta';

    const newContent =
      '<!--scene:1:start-->Alp<!--scene:1:end-->' +
      '<!--scene:2:start-->ha Bravo<!--scene:2:end--> Charlie Delta';

    // New offsets (from backend, relative to new content)
    // Scene 1: start after its start marker, end at its end marker
    const newS1Start =
      newContent.indexOf('<!--scene:1:start-->') + '<!--scene:1:start-->'.length;
    const newS1End = newContent.indexOf('<!--scene:1:end-->');

    // Scene 2: similarly
    const newS2Start =
      newContent.indexOf('<!--scene:2:start-->') + '<!--scene:2:start-->'.length;
    const newS2End = newContent.indexOf('<!--scene:2:end-->');

    // Render with NEW content → correct
    const correctS1 = simulateRenderConversion(newS1Start, newS1End, newContent);
    const correctS2 = simulateRenderConversion(newS2Start, newS2End, newContent);

    expect(correctS1).toEqual({ from: 0, to: 3 }); // "Alp"
    expect(correctS2).toEqual({ from: 3, to: 11 }); // "ha Bravo" (8 chars)

    // Render with OLD content → BUG: wrong positions!
    const wrongS1 = simulateRenderConversion(newS1Start, newS1End, oldContent);
    const wrongS2 = simulateRenderConversion(newS2Start, newS2End, oldContent);

    // When old content is used, at least one scene's position is DIFFERENT
    const s1Mismatch = wrongS1.from !== correctS1.from || wrongS1.to !== correctS1.to;
    const s2Mismatch = wrongS2.from !== correctS2.from || wrongS2.to !== correctS2.to;
    expect(
      s1Mismatch || s2Mismatch,
      'BUG: rendering new offsets with old content should produce wrong visible ranges'
    ).toBe(true);
  });

  it('story-scope drag: old content gives wrong render while new content gives correct', () => {
    // This test mirrors the actual bug: handleProseBoundaryChange updates
    // scene offsets via patchScene but does NOT refresh story content.
    // useSceneProseSync then renders new offsets with old content.

    const oldContent =
      '<!--scene:1:start-->Hello<!--scene:1:end--> ' +
      '<!--scene:2:start-->World<!--scene:2:end-->';

    // After dragging scene 2's start left by 2 visible chars:
    // Scene 1: "Hel" (shrunk), Scene 2: "lo World" (expanded)
    const newContent =
      '<!--scene:1:start-->Hel<!--scene:1:end-->' +
      '<!--scene:2:start-->lo World<!--scene:2:end-->';

    // Backend returns new offsets (original coords in new content)
    const s1TagLen = '<!--scene:1:start-->'.length;
    const s1EndTagLen = '<!--scene:1:end-->'.length;
    const s2TagLen = '<!--scene:2:start-->'.length;
    const _s2EndTagLen = '<!--scene:2:end-->'.length;

    const newS1Start = s1TagLen; // right after <!--scene:1:start-->
    const newS1End = newContent.indexOf('<!--scene:1:end-->');
    const newS2Start = newS1End + s1EndTagLen + s2TagLen; // after s1 end + s2 start
    const newS2End = newContent.indexOf('<!--scene:2:end-->');

    // Correct render: toVisibleLinkedOffset with new content
    const correctS1From = toVisibleLinkedOffset(
      newS1Start,
      null as never,
      [],
      true,
      newContent
    );
    const correctS1To = toVisibleLinkedOffset(
      newS1End,
      null as never,
      [],
      true,
      newContent
    );
    const correctS2From = toVisibleLinkedOffset(
      newS2Start,
      null as never,
      [],
      true,
      newContent
    );
    const correctS2To = toVisibleLinkedOffset(
      newS2End,
      null as never,
      [],
      true,
      newContent
    );

    expect(correctS1From).toBe(0);
    expect(correctS1To).toBe(3); // "Hel" (3 chars)
    expect(correctS2From).toBe(3);
    expect(correctS2To).toBe(11); // "lo World" (8 chars)

    // Buggy render: toVisibleLinkedOffset with OLD content
    const wrongS1From = toVisibleLinkedOffset(
      newS1Start,
      null as never,
      [],
      true,
      oldContent
    );
    const wrongS1To = toVisibleLinkedOffset(
      newS1End,
      null as never,
      [],
      true,
      oldContent
    );
    const wrongS2From = toVisibleLinkedOffset(
      newS2Start,
      null as never,
      [],
      true,
      oldContent
    );
    const wrongS2To = toVisibleLinkedOffset(
      newS2End,
      null as never,
      [],
      true,
      oldContent
    );

    // These WILL differ from correct values
    const mismatchS1 = wrongS1From !== correctS1From || wrongS1To !== correctS1To;
    const mismatchS2 = wrongS2From !== correctS2From || wrongS2To !== correctS2To;

    expect(
      mismatchS1 || mismatchS2,
      'BUG: rendering new offsets with old content should produce wrong visible ranges'
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TDD: approximation path must match exact path for reconstruction
// ---------------------------------------------------------------------------

describe('toVisibleLinkedOffset approximation vs exact', () => {
  // The approximation path (no fullContent) is used by reconstructContentFromOffsets
  // to convert backend-returned original offsets to visible.  It MUST give the
  // same result as the exact walk on a well-formed marker-inclusive content
  // string for every prose_link boundary offset.

  function makeMarker(id: number | string, edge: 'start' | 'end'): string {
    return `<!--scene:${id}:${edge}-->`;
  }

  function buildContent(scenes: Array<{ id: number; text: string }>): string {
    let result = '';
    for (const s of scenes) {
      result += makeMarker(s.id, 'start') + s.text + makeMarker(s.id, 'end');
    }
    return result;
  }

  function extractOffsets(
    content: string
  ): Array<{ id: number; start: number; end: number }> {
    const result: Array<{ id: number; start: number; end: number }> = [];
    const regex = /<!--scene:(\d+):(start|end)-->/g;
    const openStarts = new Map<number, number>();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const id = parseInt(match[1], 10);
      const edge = match[2];
      if (edge === 'start') {
        openStarts.set(id, match.index + match[0].length);
      } else {
        const start = openStarts.get(id);
        if (start !== undefined) {
          result.push({ id, start, end: match.index });
          openStarts.delete(id);
        }
      }
    }
    return result.sort(
      (
        a: { id: number; start: number; end: number },
        b: { id: number; start: number; end: number }
      ) => a.start - b.start
    );
  }

  const testCases = [
    {
      label: 'two adjacent scenes with same-length IDs',
      content: buildContent([
        { id: 1, text: 'AAA' },
        { id: 2, text: 'BBB' },
      ]),
    },
    {
      label: 'two adjacent scenes with different-length IDs (1-digit vs 2-digit)',
      content: buildContent([
        { id: 1, text: 'Hello' },
        { id: 13, text: 'World' },
      ]),
    },
    {
      label: 'three adjacent scenes with mixed ID lengths',
      content: buildContent([
        { id: 9, text: 'A' },
        { id: 10, text: 'BB' },
        { id: 99, text: 'CCC' },
      ]),
    },
    {
      label: 'two scenes with text between markers (gap)',
      content:
        makeMarker(1, 'start') +
        'Alpha' +
        makeMarker(1, 'end') +
        '  gap  ' +
        makeMarker(2, 'start') +
        'Beta' +
        makeMarker(2, 'end'),
    },
    {
      label: 'single scene with text on both sides',
      content:
        'PREFIX' + makeMarker(5, 'start') + 'MIDDLE' + makeMarker(5, 'end') + 'SUFFIX',
    },
    {
      label: 'five sequential scenes',
      content: buildContent([
        { id: 1, text: 'A' },
        { id: 2, text: 'BB' },
        { id: 3, text: 'CCC' },
        { id: 4, text: 'DDDD' },
        { id: 5, text: 'EEEEE' },
      ]),
    },
  ];

  for (const { label, content } of testCases) {
    it(`approximation matches exact for all prose_link offsets: ${label}`, () => {
      const offsets = extractOffsets(content);

      // Build a mock scenes array for the approximation path
      const mockScenes = offsets.map(
        (o: { id: number; start: number; end: number }) => ({
          id: o.id,
          prose_link: {
            scope_type: 'chapter' as const,
            chapter_id: '1',
            start_offset: o.start,
            end_offset: o.end,
          },
        })
      );

      const mockChapter = {
        id: '1',
        scope: 'chapter' as const,
        title: 'Ch1',
        content,
      };

      for (const { id, start, end } of offsets) {
        // Exact path: use fullContent with markers
        const exactStart = toVisibleLinkedOffset(
          start,
          null as unknown as never,
          [],
          true,
          content
        );
        const exactEnd = toVisibleLinkedOffset(
          end,
          null as unknown as never,
          [],
          true,
          content
        );

        // Approximation path: no fullContent, use scenes + unit
        const approxStart = toVisibleLinkedOffset(
          start,
          mockChapter as Parameters<typeof toVisibleLinkedOffset>[1],
          mockScenes as Parameters<typeof toVisibleLinkedOffset>[2],
          true
        );
        const approxEnd = toVisibleLinkedOffset(
          end,
          mockChapter as Parameters<typeof toVisibleLinkedOffset>[1],
          mockScenes as Parameters<typeof toVisibleLinkedOffset>[2],
          true
        );

        expect(
          approxStart,
          `${label} scene ${id}: start — exact=${exactStart} approx=${approxStart}`
        ).toBe(exactStart);
        expect(
          approxEnd,
          `${label} scene ${id}: end — exact=${exactEnd} approx=${approxEnd}`
        ).toBe(exactEnd);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// TDD: multi-scene partial overlap — drag start of scene n+1 into scene n
// ---------------------------------------------------------------------------

describe('multi-scene boundary drag (real-world two-digit IDs)', () => {
  function marker(id: number, edge: 'start' | 'end'): string {
    return `<!--scene:${id}:${edge}-->`;
  }

  function extractOffsets(
    content: string
  ): Map<number, { start: number; end: number }> {
    const result = new Map<number, { start: number; end: number }>();
    const regex = /<!--scene:(\d+):(start|end)-->/g;
    const openStarts = new Map<number, number>();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const id = parseInt(match[1], 10);
      if (match[2] === 'start') {
        openStarts.set(id, match.index + match[0].length);
      } else {
        const start = openStarts.get(id);
        if (start !== undefined) result.set(id, { start, end: match.index });
      }
    }
    return result;
  }

  // Realistic scene IDs from actual user content: 13, 14, 16, 20, 21
  const sceneDefs = [
    { id: 13, text: 'Para1_' },
    { id: 14, text: 'Para2_' },
    { id: 16, text: 'Para3_' },
    { id: 20, text: 'Para4_' },
    { id: 21, text: 'Para5_' },
  ];

  const oldContent = sceneDefs
    .map(
      (s: { id: number; text: string }) =>
        marker(s.id, 'start') + s.text + marker(s.id, 'end')
    )
    .join('');

  const oldOffsets = extractOffsets(oldContent);

  it('old content has correct visible text for each scene', () => {
    const stripped = stripInlineInternalMarkers(oldContent);
    expect(stripped).toBe(
      sceneDefs.map((s: { id: number; text: string }) => s.text).join('')
    );

    for (const s of sceneDefs as Array<{ id: number; text: string }>) {
      const off = oldOffsets.get(s.id)!;
      const visStart = toVisibleLinkedOffset(
        off.start,
        null as unknown as never,
        [],
        true,
        oldContent
      );
      const visEnd = toVisibleLinkedOffset(
        off.end,
        null as unknown as never,
        [],
        true,
        oldContent
      );
      expect(stripped.slice(visStart, visEnd), `scene ${s.id}`).toBe(s.text);
    }
  });

  it('dragging scene 16 start into scene 14 computes correct visible offset for API', () => {
    // Scene 14 starts at visible position 6 (after "Para1_")
    const scene14Off = oldOffsets.get(14)!;
    const scene14VisStart = toVisibleLinkedOffset(
      scene14Off.start,
      null as unknown as never,
      [],
      true,
      oldContent
    );
    expect(scene14VisStart).toBe(6);

    // Drag scene 16's start to visible position 6 (engulfing scene 14).
    // toOriginalOffset must return the position of scene 13's end marker
    // (the boundary between scene 13 and scene 14), NOT past it.
    const dragOrig = toOriginalOffset(6, oldContent);

    // After the fix, dragOrig is at scene 13's end marker position.
    const scene13End = oldOffsets.get(13)!.end;
    expect(dragOrig).toBe(scene13End);

    // Round-trip back to visible
    const apiVisible = toVisibleLinkedOffset(
      dragOrig,
      null as unknown as never,
      [],
      true,
      oldContent
    );
    expect(apiVisible).toBe(6);
  });

  it('after roundtrip with scene 14 unlinked, all remaining scenes have correct visible ranges', () => {
    // After dragging scene 16 start to engulf scene 14:
    // scene 13: "Para1_" (unchanged)
    // scene 14: UNLINKED
    // scene 16: "Para2_Para3_" (expanded to include scene 14's old text)
    // scene 20: "Para4_" (unchanged)
    // scene 21: "Para5_" (unchanged)
    const newContent =
      marker(13, 'start') +
      'Para1_' +
      marker(13, 'end') +
      marker(16, 'start') +
      'Para2_Para3_' +
      marker(16, 'end') +
      marker(20, 'start') +
      'Para4_' +
      marker(20, 'end') +
      marker(21, 'start') +
      'Para5_' +
      marker(21, 'end');

    const newOffsets = extractOffsets(newContent);
    const stripped = stripInlineInternalMarkers(newContent);

    // Build mock for approximation path (used by reconstructContentFromOffsets)
    const mockScenes: Array<{
      id: number;
      prose_link: {
        scope_type: 'chapter';
        chapter_id: string;
        start_offset: number;
        end_offset: number;
      };
    }> = [];
    for (const [id, off] of newOffsets) {
      mockScenes.push({
        id,
        prose_link: {
          scope_type: 'chapter',
          chapter_id: '1',
          start_offset: off.start,
          end_offset: off.end,
        },
      });
    }
    const mockChapter = {
      id: '1',
      scope: 'chapter' as const,
      title: 'Ch1',
      content: newContent,
    };

    // Verify each scene's visible range via BOTH paths
    for (const [id, off] of newOffsets) {
      const approxStart = toVisibleLinkedOffset(
        off.start,
        mockChapter as never,
        mockScenes as never,
        true
      );
      const approxEnd = toVisibleLinkedOffset(
        off.end,
        mockChapter as never,
        mockScenes as never,
        true
      );
      const exactStart = toVisibleLinkedOffset(
        off.start,
        null as unknown as never,
        [],
        true,
        newContent
      );
      const exactEnd = toVisibleLinkedOffset(
        off.end,
        null as unknown as never,
        [],
        true,
        newContent
      );

      expect(approxStart, `scene ${id} start: approx vs exact`).toBe(exactStart);
      expect(approxEnd, `scene ${id} end: approx vs exact`).toBe(exactEnd);

      const visText = stripped.slice(exactStart, exactEnd);
      const origText = newContent.slice(off.start, off.end);
      expect(visText, `scene ${id} visible text`).toBe(origText);
    }

    // Verify scene 14 is NOT in the new content
    expect(newContent).not.toContain('<!--scene:14:');
  });
});
