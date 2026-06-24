// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for useSceneProseSync — bidirectional selection sync between pinboard
 * scene cards and the editor cursor.
 *
 * Coverage goals:
 *   - Selecting a scene with no prose link does NOT call setProseHighlights
 *   - Selecting a scene with a matching prose link calls setProseHighlights
 *   - Selecting a scene whose link is for a different chapter does NOT highlight
 *   - Deselecting (null) calls clearProseHighlight
 *   - Moving the editor cursor into a linked range selects the scene
 *   - Moving the cursor outside any linked range clears the selection
 *   - Moving the cursor when no chapter is active clears the selection
 *   - The cursor callback is unregistered when the hook unmounts
 *   - handleMultipleSelectScenes highlights all matching scenes simultaneously
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import type { EditorHandle } from '../editor/Editor';
import type { Scene } from '../../types';
import type { WritingUnit } from '../../types/domain';
import type { ProseHighlightRange } from '../editor/CodeMirrorEditor';
import { useSceneProseSync } from './useSceneProseSync';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeEditorHandle = (): {
  handle: EditorHandle;
  setProseHighlights: ReturnType<typeof vi.fn>;
  clearProseHighlight: ReturnType<typeof vi.fn>;
  triggerCursorChange: (anchor: number, head: number) => void;
  getRegisteredCallback: () => ((anchor: number, head: number) => void) | null;
} => {
  let registeredCallback: ((anchor: number, head: number) => void) | null = null;
  const setProseHighlights = vi.fn();
  const clearProseHighlight = vi.fn();
  const handle: EditorHandle = {
    insertImage: vi.fn(),
    focus: vi.fn(),
    format: vi.fn(),
    jumpToPosition: vi.fn(),
    getEditorView: vi.fn(() => null),
    setOnCursorChange: vi.fn((cb: ((anchor: number, head: number) => void) | null) => {
      registeredCallback = cb;
    }),
    setProseHighlights,
    clearProseHighlight,
    setOnProseBoundaryChange: vi.fn(),
  };
  return {
    handle,
    setProseHighlights,
    clearProseHighlight,
    triggerCursorChange: (anchor: number, head: number) => {
      registeredCallback?.(anchor, head);
    },
    getRegisteredCallback: () => registeredCallback,
  };
};

const makeRef = <T>(value: T | null): React.RefObject<T | null> => ({
  current: value,
});

const chapterUnit: WritingUnit = {
  id: 'ch1',
  scope: 'chapter',
  title: 'Chapter 1',
  content: 'Hello world',
};

const storyUnit: WritingUnit = {
  id: 'story',
  scope: 'story',
  title: 'My Story',
  content: 'Once upon a time',
};

const sceneWithChapterLink: Scene = {
  id: 'scene-a',
  title: 'Scene A',
  summary: '',
  prose_link: {
    scope_type: 'chapter',
    chapter_id: 'ch1',
    start_offset: 5,
    end_offset: 10,
    content_hash: 'abc',
  },
  pinboard_x: 0,
  pinboard_y: 0,
  order_index: 0,
  predecessor_ids: [],
  created_at: '',
  updated_at: '',
};

const sceneWithStoryLink: Scene = {
  id: 'scene-b',
  title: 'Scene B',
  summary: '',
  prose_link: {
    scope_type: 'story',
    start_offset: 0,
    end_offset: 4,
    content_hash: 'def',
  },
  pinboard_x: 0,
  pinboard_y: 0,
  order_index: 1,
  predecessor_ids: [],
  created_at: '',
  updated_at: '',
};

const sceneWithNoLink: Scene = {
  id: 'scene-c',
  title: 'Scene C',
  summary: '',
  prose_link: null,
  pinboard_x: 0,
  pinboard_y: 0,
  order_index: 2,
  predecessor_ids: [],
  created_at: '',
  updated_at: '',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// eslint-disable-next-line max-lines-per-function
describe('useSceneProseSync', () => {
  let editor: ReturnType<typeof makeEditorHandle>;
  beforeEach(() => {
    editor = makeEditorHandle();
  });

  // -------------------------------------------------------------------------
  // Card → editor direction
  // -------------------------------------------------------------------------

  it('selecting a scene with no prose link does not call setProseHighlights', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithNoLink], chapterUnit, ref)
    );

    act(() => {
      result.current.handleSelectScene('scene-c');
    });

    expect(editor.setProseHighlights).not.toHaveBeenCalled();
  });

  it('selecting a scene with a matching chapter prose link calls setProseHighlights', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], chapterUnit, ref)
    );

    act(() => {
      result.current.handleSelectScene('scene-a');
    });

    expect(editor.setProseHighlights).toHaveBeenCalledWith([
      { sceneId: 'scene-a', from: 5, to: 10 },
    ] as ProseHighlightRange[]);
  });

  it('selecting a scene with a matching story prose link calls setProseHighlights', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithStoryLink], storyUnit, ref)
    );

    act(() => {
      result.current.handleSelectScene('scene-b');
    });

    expect(editor.setProseHighlights).toHaveBeenCalledWith([
      { sceneId: 'scene-b', from: 0, to: 4 },
    ] as ProseHighlightRange[]);
  });

  it('selecting a scene whose link belongs to a different chapter does not highlight', () => {
    const ref = makeRef(editor.handle);
    const otherChapter: WritingUnit = { ...chapterUnit, id: 'ch-other' };
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], otherChapter, ref)
    );

    act(() => {
      result.current.handleSelectScene('scene-a');
    });

    expect(editor.setProseHighlights).not.toHaveBeenCalled();
  });

  it('deselecting (null) calls clearProseHighlight', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], chapterUnit, ref)
    );

    act(() => {
      result.current.handleSelectScene('scene-a');
    });
    act(() => {
      result.current.handleSelectScene(null);
    });

    expect(editor.clearProseHighlight).toHaveBeenCalled();
  });

  it('selecting a scene with no editor ref does not throw', () => {
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], chapterUnit, undefined)
    );

    expect(() => {
      act(() => {
        result.current.handleSelectScene('scene-a');
      });
    }).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Editor cursor → card direction
  // -------------------------------------------------------------------------

  it('cursor moving into a linked range selects the owning scene', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink, sceneWithNoLink], chapterUnit, ref)
    );

    act(() => {
      editor.triggerCursorChange(5, 7); // inside [5, 10)
    });

    expect(result.current.selectedSceneId).toBe('scene-a');
  });

  it('cursor moving outside any linked range clears the selection', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], chapterUnit, ref)
    );

    // First move cursor inside the range
    act(() => {
      editor.triggerCursorChange(5, 7);
    });
    expect(result.current.selectedSceneId).toBe('scene-a');

    // Then move cursor outside
    act(() => {
      editor.triggerCursorChange(0, 2);
    });
    expect(result.current.selectedSceneId).toBeNull();
  });

  it('cursor position exactly at end_offset is outside the range (exclusive bound)', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], chapterUnit, ref)
    );

    act(() => {
      editor.triggerCursorChange(10, 10); // end_offset is exclusive
    });

    expect(result.current.selectedSceneId).toBeNull();
  });

  it('cursor position at start_offset is inside the range (inclusive bound)', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], chapterUnit, ref)
    );

    act(() => {
      editor.triggerCursorChange(5, 5);
    });

    expect(result.current.selectedSceneId).toBe('scene-a');
  });

  it('cursor movement when no chapter is active clears the selection', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], null, ref)
    );

    act(() => {
      editor.triggerCursorChange(5, 7);
    });

    expect(result.current.selectedSceneId).toBeNull();
  });

  it('cursor does not match a scene whose link belongs to a different chapter', () => {
    const ref = makeRef(editor.handle);
    const otherChapter: WritingUnit = { ...chapterUnit, id: 'ch-other' };
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], otherChapter, ref)
    );

    act(() => {
      editor.triggerCursorChange(5, 7);
    });

    expect(result.current.selectedSceneId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  it('unregisters the cursor callback when the hook unmounts', () => {
    const ref = makeRef(editor.handle);
    const { unmount } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], chapterUnit, ref)
    );

    unmount();

    expect(editor.handle.setOnCursorChange).toHaveBeenLastCalledWith(null);
  });

  it('does not register a cursor callback when editorRef is undefined', () => {
    renderHook(() => useSceneProseSync([sceneWithChapterLink], chapterUnit, undefined));

    // No error, and no callbacks on the mock (since there is no mock to call)
    expect(editor.handle.setOnCursorChange).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Multi-select highlights
  // -------------------------------------------------------------------------

  it('handleMultipleSelectScenes highlights all scenes with matching links', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync(
        [sceneWithChapterLink, sceneWithStoryLink, sceneWithNoLink],
        chapterUnit,
        ref
      )
    );

    act(() => {
      result.current.handleMultipleSelectScenes(
        new Set(['scene-a', 'scene-b', 'scene-c'])
      );
    });

    // Only scene-a has a chapter link matching chapterUnit; scene-b is story-scoped
    // and therefore skipped; scene-c has no link.
    expect(editor.setProseHighlights).toHaveBeenCalledWith([
      { sceneId: 'scene-a', from: 5, to: 10 },
    ] as ProseHighlightRange[]);
  });

  it('handleMultipleSelectScenes with empty set calls clearProseHighlight', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], chapterUnit, ref)
    );

    // First select something
    act(() => {
      result.current.handleMultipleSelectScenes(new Set(['scene-a']));
    });
    editor.clearProseHighlight.mockClear();

    act(() => {
      result.current.handleMultipleSelectScenes(new Set());
    });

    expect(editor.clearProseHighlight).toHaveBeenCalled();
  });

  it('handleMultipleSelectScenes highlights all scenes in the same story scope', () => {
    const scene2: Scene = {
      ...sceneWithStoryLink,
      id: 'scene-b2',
      prose_link: {
        scope_type: 'story',
        start_offset: 20,
        end_offset: 40,
        content_hash: 'b2hash',
      },
    };
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithStoryLink, scene2], storyUnit, ref)
    );

    act(() => {
      result.current.handleMultipleSelectScenes(new Set(['scene-b', 'scene-b2']));
    });

    expect(editor.setProseHighlights).toHaveBeenCalledWith(
      expect.arrayContaining([
        { sceneId: 'scene-b', from: 0, to: 4 },
        { sceneId: 'scene-b2', from: 20, to: 40 },
      ] as ProseHighlightRange[])
    );
    expect(editor.setProseHighlights.mock.calls[0][0]).toHaveLength(2);
  });

  it('handleMultipleSelectScenes skips scenes whose end_offset is null', () => {
    const sceneNullEnd: Scene = {
      ...sceneWithChapterLink,
      id: 'scene-null',
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: 5,
        end_offset: null,
        content_hash: 'nullhash',
      },
    };
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink, sceneNullEnd], chapterUnit, ref)
    );

    act(() => {
      result.current.handleMultipleSelectScenes(new Set(['scene-a', 'scene-null']));
    });

    // Only scene-a should be highlighted; scene-null has end_offset=null → skipped.
    expect(editor.setProseHighlights).toHaveBeenCalledWith([
      { sceneId: 'scene-a', from: 5, to: 10 },
    ] as ProseHighlightRange[]);
  });

  it('handleSelectScene after handleMultipleSelectScenes narrows to a single scene', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink, sceneWithNoLink], chapterUnit, ref)
    );

    act(() => {
      result.current.handleMultipleSelectScenes(new Set(['scene-a', 'scene-c']));
    });
    editor.setProseHighlights.mockClear();

    act(() => {
      result.current.handleSelectScene('scene-a');
    });

    expect(editor.setProseHighlights).toHaveBeenCalledWith([
      { sceneId: 'scene-a', from: 5, to: 10 },
    ] as ProseHighlightRange[]);
  });

  it('cursor entering a linked range while multi-selected narrows highlight to that scene', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink, sceneWithNoLink], chapterUnit, ref)
    );

    // Multi-select both scenes
    act(() => {
      result.current.handleMultipleSelectScenes(new Set(['scene-a', 'scene-c']));
    });
    editor.setProseHighlights.mockClear();

    // Cursor moves into scene-a's range
    act(() => {
      editor.triggerCursorChange(5, 7);
    });

    // Highlight should narrow to just scene-a
    expect(editor.setProseHighlights).toHaveBeenCalledWith([
      { sceneId: 'scene-a', from: 5, to: 10 },
    ] as ProseHighlightRange[]);
    expect(result.current.selectedSceneId).toBe('scene-a');
  });

  it('scene with null end_offset is not matched when cursor moves', () => {
    const sceneNullEnd: Scene = {
      ...sceneWithChapterLink,
      id: 'scene-null',
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: 5,
        end_offset: null,
        content_hash: 'nullhash',
      },
    };
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneNullEnd], chapterUnit, ref)
    );

    act(() => {
      editor.triggerCursorChange(5, 7);
    });

    // end_offset is null → cursor match condition requires end_offset != null
    expect(result.current.selectedSceneId).toBeNull();
  });

  it('handleMultipleSelectScenes called with the same set twice does not re-call setProseHighlights', () => {
    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([sceneWithChapterLink], chapterUnit, ref)
    );

    act(() => {
      result.current.handleMultipleSelectScenes(new Set(['scene-a']));
    });
    const firstCallCount = editor.setProseHighlights.mock.calls.length;

    act(() => {
      result.current.handleMultipleSelectScenes(new Set(['scene-a']));
    });

    // setsEqual guard must prevent a second state update (and thus no extra effect run).
    expect(editor.setProseHighlights.mock.calls.length).toBe(firstCallCount);
  });

  it('translates raw prose offsets to visible offsets when chapter content has no inline markers', () => {
    const markerLength = (id: string, edge: 'start' | 'end'): number =>
      `<!--scene:${id}:${edge}-->`.length;

    const visibleText = 'Alpha Beta';
    const scene1Id = '101';
    const scene2Id = '102';

    const scene1RawStart = markerLength(scene1Id, 'start');
    const scene1RawEnd = scene1RawStart + 5;

    const between = 1; // single space between "Alpha" and "Beta"
    const scene2RawStart =
      scene1RawEnd +
      markerLength(scene1Id, 'end') +
      between +
      markerLength(scene2Id, 'start');
    const scene2RawEnd = scene2RawStart + 4;

    const scene1: Scene = {
      ...sceneWithChapterLink,
      id: scene1Id,
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: scene1RawStart,
        end_offset: scene1RawEnd,
        content_hash: 'hash1',
      },
    };

    const scene2: Scene = {
      ...sceneWithChapterLink,
      id: scene2Id,
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: scene2RawStart,
        end_offset: scene2RawEnd,
        content_hash: 'hash2',
      },
    };

    const chapterWithoutMarkers: WritingUnit = {
      ...chapterUnit,
      content: visibleText,
    };

    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([scene1, scene2], chapterWithoutMarkers, ref)
    );

    act(() => {
      result.current.handleSelectScene(scene2Id);
    });

    expect(editor.setProseHighlights).toHaveBeenLastCalledWith([
      { sceneId: scene2Id, from: 6, to: 10 },
    ] as ProseHighlightRange[]);

    act(() => {
      editor.triggerCursorChange(0, 7);
    });

    expect(result.current.selectedSceneId).toBe(scene2Id);
  });

  it('uses marker-stripped offsets when chapter content contains inline markers', () => {
    const marker = (id: string, edge: 'start' | 'end'): string =>
      `<!--scene:${id}:${edge}-->`;
    const scene1Id = '101';
    const scene2Id = '102';

    const chapterWithMarkers: WritingUnit = {
      ...chapterUnit,
      content:
        `${marker(scene1Id, 'start')}Alpha${marker(scene1Id, 'end')} ` +
        `${marker(scene2Id, 'start')}Beta${marker(scene2Id, 'end')}`,
    };

    // Strip markers to compute expected offsets (matching actual behavior)
    const strippedContent = chapterWithMarkers.content.replace(
      /<!--(?:scene|annotation):[^:>]+:(?:start|end)-->/g,
      ''
    );
    const alphaStart = strippedContent.indexOf('Alpha');
    const betaStart = strippedContent.indexOf('Beta');

    const scene1: Scene = {
      ...sceneWithChapterLink,
      id: scene1Id,
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: alphaStart,
        end_offset: alphaStart + 5,
        content_hash: 'hash1',
      },
    };

    const scene2: Scene = {
      ...sceneWithChapterLink,
      id: scene2Id,
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: betaStart,
        end_offset: betaStart + 4,
        content_hash: 'hash2',
      },
    };

    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([scene1, scene2], chapterWithMarkers, ref)
    );

    act(() => {
      result.current.handleSelectScene(scene2Id);
    });

    // With markers stripped, offsets are relative to clean prose
    expect(editor.setProseHighlights).toHaveBeenLastCalledWith([
      { sceneId: scene2Id, from: betaStart, to: betaStart + 4 },
    ] as ProseHighlightRange[]);

    act(() => {
      editor.triggerCursorChange(0, betaStart + 1);
    });

    expect(result.current.selectedSceneId).toBe(scene2Id);
  });

  it('matches chapter prose links regardless of chapter ID string formatting', () => {
    const ref = makeRef(editor.handle);
    const scene = {
      ...sceneWithChapterLink,
      prose_link: {
        ...sceneWithChapterLink.prose_link!,
        chapter_id: '01',
      },
    };
    const chapterWithNormalizedId: WritingUnit = {
      ...chapterUnit,
      id: '1',
    };

    const { result } = renderHook(() =>
      useSceneProseSync([scene], chapterWithNormalizedId, ref)
    );

    act(() => {
      result.current.handleSelectScene(scene.id);
    });

    expect(editor.setProseHighlights).toHaveBeenCalledWith([
      { sceneId: scene.id, from: 5, to: 10 },
    ] as ProseHighlightRange[]);
  });

  it('uses prose_link offsets when chapter content has no markers', () => {
    const sceneId = 'drift-1';
    const chapterClean: WritingUnit = {
      ...chapterUnit,
      content: 'Alpha',
    };

    const scene: Scene = {
      ...sceneWithChapterLink,
      id: sceneId,
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: 0,
        end_offset: 5,
        content_hash: 'clean',
      },
    };

    const ref = makeRef(editor.handle);
    const { result } = renderHook(() => useSceneProseSync([scene], chapterClean, ref));

    act(() => {
      result.current.handleSelectScene(sceneId);
    });

    expect(editor.setProseHighlights).toHaveBeenLastCalledWith([
      { sceneId, from: 0, to: 5 },
    ] as ProseHighlightRange[]);
  });

  it('recomputes highlight ranges when chapter content changes', () => {
    const sceneId = 'chg-1';
    const firstChapter: WritingUnit = {
      ...chapterUnit,
      content: 'A',
    };
    const secondChapter: WritingUnit = {
      ...chapterUnit,
      content: 'BBBB',
    };
    const selectedScene: Scene = {
      ...sceneWithChapterLink,
      id: sceneId,
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: 0,
        end_offset: 4,
        content_hash: 'chg',
      },
    };
    const ref = makeRef(editor.handle);
    const { result, rerender } = renderHook(
      ({ chapter }: { chapter: WritingUnit }) =>
        useSceneProseSync([selectedScene], chapter, ref),
      {
        initialProps: { chapter: firstChapter },
      }
    );

    act(() => {
      result.current.handleSelectScene(sceneId);
    });

    rerender({ chapter: secondChapter });

    expect(editor.setProseHighlights).toHaveBeenLastCalledWith([
      { sceneId, from: 0, to: 4 },
    ] as ProseHighlightRange[]);
  });

  it('adjusts full-content prose_link offsets when chapter has inline markers', () => {
    // Simulates the real scenario: backend stores prose_link offsets in the
    // full-content coordinate space (marker-inclusive), and useSceneProseSync
    // must adjust them to match the editor's stripped content when
    // hideSceneMarkers is true.
    const marker = (id: string, edge: 'start' | 'end'): string =>
      `<!--scene:${id}:${edge}-->`;
    const scene1Id = 'sc1';
    const scene2Id = 'sc2';

    // Build content with inline markers — this is what the backend stores
    const chapterWithMarkers: WritingUnit = {
      ...chapterUnit,
      content:
        'Before ' +
        `${marker(scene1Id, 'start')}Alpha prose${marker(scene1Id, 'end')} ` +
        `${marker(scene2Id, 'start')}Beta text${marker(scene2Id, 'end')} ` +
        'After',
    };

    // Compute the backend-style offsets (positions in full content)
    // Scene 1's prose is "Alpha prose" between its markers
    const scene1StartMarker = marker(scene1Id, 'start');
    const scene1EndMarker = marker(scene1Id, 'end');
    const scene1RawStart =
      chapterWithMarkers.content.indexOf(scene1StartMarker) + scene1StartMarker.length;
    const scene1RawEnd = chapterWithMarkers.content.indexOf(
      scene1EndMarker,
      scene1RawStart
    );

    // Scene 2's prose is "Beta text" between its markers
    const scene2StartMarker = marker(scene2Id, 'start');
    const scene2EndMarker = marker(scene2Id, 'end');
    const scene2RawStart =
      chapterWithMarkers.content.indexOf(scene2StartMarker) + scene2StartMarker.length;
    const scene2RawEnd = chapterWithMarkers.content.indexOf(
      scene2EndMarker,
      scene2RawStart
    );

    const scene1: Scene = {
      ...sceneWithChapterLink,
      id: scene1Id,
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: scene1RawStart,
        end_offset: scene1RawEnd,
        content_hash: 'hash1',
      },
    };

    const scene2: Scene = {
      ...sceneWithChapterLink,
      id: scene2Id,
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: scene2RawStart,
        end_offset: scene2RawEnd,
        content_hash: 'hash2',
      },
    };

    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([scene1, scene2], chapterWithMarkers, ref)
    );

    // Select scene 2: its visible range should be adjusted for stripped markers
    act(() => {
      result.current.handleSelectScene(scene2Id);
    });

    // Compute expected visible positions
    const strippedContent = chapterWithMarkers.content.replace(
      /<!--(?:scene|annotation):[^:>]+:(?:start|end)-->/g,
      ''
    );
    const expectedBetaStart = strippedContent.indexOf('Beta text');
    const expectedBetaEnd = expectedBetaStart + 'Beta text'.length;

    expect(editor.setProseHighlights).toHaveBeenLastCalledWith([
      { sceneId: scene2Id, from: expectedBetaStart, to: expectedBetaEnd },
    ] as ProseHighlightRange[]);

    // Cursor inside the adjusted range should select scene 2
    act(() => {
      editor.triggerCursorChange(expectedBetaStart, expectedBetaStart + 2);
    });
    expect(result.current.selectedSceneId).toBe(scene2Id);
  });

  it('adjusts scene positions when content has annotation markers before scene prose', () => {
    // Annotation markers embedded in the content should also be accounted for
    // when computing visible scene positions (both scene and annotation markers
    // are stripped by hideSceneMarkers).
    const marker = (id: string, edge: 'start' | 'end'): string =>
      `<!--scene:${id}:${edge}-->`;
    const annMarker = (id: string, edge: 'start' | 'end'): string =>
      `<!--annotation:${id}:${edge}-->`;

    const chapterWithMarkers: WritingUnit = {
      ...chapterUnit,
      content:
        `${annMarker('ann1', 'start')}ann prose${annMarker('ann1', 'end')}` +
        ` before ${marker('sc1', 'start')}Scene prose${marker('sc1', 'end')} after`,
    };

    // Backend-style offsets in full-content space
    const startMarker = marker('sc1', 'start');
    const endMarker = marker('sc1', 'end');
    const rawStart =
      chapterWithMarkers.content.indexOf(startMarker) + startMarker.length;
    const rawEnd = chapterWithMarkers.content.indexOf(endMarker, rawStart);

    const scene1: Scene = {
      ...sceneWithChapterLink,
      id: 'sc1',
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: rawStart,
        end_offset: rawEnd,
        content_hash: 'h1',
      },
    };

    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([scene1], chapterWithMarkers, ref)
    );

    act(() => {
      result.current.handleSelectScene('sc1');
    });

    const strippedContent = chapterWithMarkers.content.replace(
      /<!--(?:scene|annotation):[^:>]+:(?:start|end)-->/g,
      ''
    );
    const expectedStart = strippedContent.indexOf('Scene prose');
    const expectedEnd = expectedStart + 'Scene prose'.length;

    expect(editor.setProseHighlights).toHaveBeenLastCalledWith([
      { sceneId: 'sc1', from: expectedStart, to: expectedEnd },
    ] as ProseHighlightRange[]);

    // Cursor inside range should select scene
    act(() => {
      editor.triggerCursorChange(expectedStart, expectedStart + 2);
    });
    expect(result.current.selectedSceneId).toBe('sc1');
  });

  it('adjusts scene positions when annotation markers are inside scene prose', () => {
    // Annotation inside scene prose should not affect the scene's own visible
    // range calculation — the annotation markers are stripped along with scene
    // markers, and the scene's prose is the text between its scene markers
    // (excluding the annotation markers that happen to be inside).
    const marker = (id: string, edge: 'start' | 'end'): string =>
      `<!--scene:${id}:${edge}-->`;
    const annMarker = (id: string, edge: 'start' | 'end'): string =>
      `<!--annotation:${id}:${edge}-->`;

    const chapterWithMarkers: WritingUnit = {
      ...chapterUnit,
      content:
        `${marker('sc1', 'start')}` +
        `prose ${annMarker('ann1', 'start')}with annotation${annMarker('ann1', 'end')} inside` +
        `${marker('sc1', 'end')}`,
    };

    const startMarker = marker('sc1', 'start');
    const endMarker = marker('sc1', 'end');
    const rawStart =
      chapterWithMarkers.content.indexOf(startMarker) + startMarker.length;
    const rawEnd = chapterWithMarkers.content.indexOf(endMarker, rawStart);

    const scene1: Scene = {
      ...sceneWithChapterLink,
      id: 'sc1',
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: rawStart,
        end_offset: rawEnd,
        content_hash: 'h1',
      },
    };

    const ref = makeRef(editor.handle);
    const { result } = renderHook(() =>
      useSceneProseSync([scene1], chapterWithMarkers, ref)
    );

    act(() => {
      result.current.handleSelectScene('sc1');
    });

    const strippedContent = chapterWithMarkers.content.replace(
      /<!--(?:scene|annotation):[^:>]+:(?:start|end)-->/g,
      ''
    );
    const expectedStart = strippedContent.indexOf('prose with annotation inside');
    const expectedEnd = expectedStart + 'prose with annotation inside'.length;

    expect(editor.setProseHighlights).toHaveBeenLastCalledWith([
      { sceneId: 'sc1', from: expectedStart, to: expectedEnd },
    ] as ProseHighlightRange[]);
  });
});
