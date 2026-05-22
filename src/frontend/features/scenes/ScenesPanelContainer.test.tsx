// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for ScenesPanelContainer handler logic.
 *
 * Strategy: the PinboardView and SceneEditorDialog are replaced with spy
 * stubs that write their props into the shared `captured` object. Tests
 * call handler callbacks directly (e.g. captured.dialog.onSave(...)) to
 * exercise the real implementation in the container without rendering any
 * real child-component DOM. The dialog is opened by calling
 * captured.pinboard.onEditScene(id) which triggers setEditingSceneId.
 *
 * Covers:
 *   handleAddScene, handleMoveScene, handleSaveScene, handleDeleteScene,
 *   handleCreateConstraint, handleDropProse, handleSaveProseContent,
 *   getLinkedProseText
 */

// @vitest-environment jsdom

import React from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import i18n from '../app/i18n';
import { ScenesPanelContainer } from './ScenesPanelContainer';
import { resetUIStore, useUIStore } from '../../stores/uiStore';
import type { Scene, SceneProseLink, SceneId } from '../../types';
import type { WritingUnit } from '../../types/domain';
import type { EditorHandle } from '../editor/Editor';
import type { ProseBoundaryCallback } from '../editor/CodeMirrorEditor';

type SceneLaneCaptureProps = {
  initialVisibleLaneEntryIds: string[];
  onVisibleLaneEntryIdsChange?: (ids: string[]) => void;
};

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  patchSceneMock,
  recordHistoryEntryMock,
  useScenesMock,
  apiMock,
  captured,
  proseSyncState,
  useSceneProseSyncMock,
} = vi.hoisted(() => {
  const patchSceneMock = vi.fn();
  const recordHistoryEntryMock = vi.fn();
  const useScenesMock = vi.fn(() => [] as Scene[]);
  const apiMock = {
    scenes: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      linkProse: vi.fn(),
      reorderProse: vi.fn(),
      refreshHash: vi.fn(),
      updateProseContent: vi.fn(),
      writeScene: vi.fn(),
    },
  };
  // Mutable holder — spy stubs close over this object; tests read from it.
  const captured: {
    pinboard: unknown;
    dialog: unknown;
    narrative: SceneLaneCaptureProps | null;
    convergence: SceneLaneCaptureProps | null;
  } = {
    pinboard: null,
    dialog: null,
    narrative: null,
    convergence: null,
  };

  const proseSyncState = {
    selectedSceneId: null as string | null,
    handleSelectScene: vi.fn(),
    handleMultipleSelectScenes: vi.fn(),
  };
  const useSceneProseSyncMock = vi.fn(() => proseSyncState);

  return {
    patchSceneMock,
    recordHistoryEntryMock,
    useScenesMock,
    apiMock,
    captured,
    proseSyncState,
    useSceneProseSyncMock,
  };
});

vi.mock('../../stores/storyStore', () => ({
  useScenes: () => useScenesMock(),
  useStoryStore: () => patchSceneMock,
  useStoryMeta: () => ({ projectType: 'novel' }),
  useStoryChaptersListMeta: () => [],
  useStoryBooks: () => [],
}));

vi.mock('../layout/ThemeContext', () => ({
  useThemeClasses: vi.fn(() => ({
    bg: '',
    text: '',
    border: '',
    muted: '',
    input: '',
  })),
  useTheme: vi.fn(() => ({ isLight: true })),
}));

vi.mock('./PinboardView', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PinboardView: (props: any) => {
    captured.pinboard = props;
    return null;
  },
}));

vi.mock('./NarrativeView', () => ({
  NarrativeView: (props: Record<string, unknown>) => {
    captured.narrative = props as SceneLaneCaptureProps;
    return null;
  },
}));

vi.mock('./ConvergenceMapView', () => ({
  ConvergenceMapView: (props: Record<string, unknown>) => {
    captured.convergence = props as SceneLaneCaptureProps;
    return null;
  },
}));

vi.mock('./SceneEditorDialog', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SceneEditorDialog: (props: any) => {
    captured.dialog = props.isOpen ? props : null;
    return null;
  },
}));

vi.mock('./useSceneProseSync', () => ({
  useSceneProseSync: () => useSceneProseSyncMock(),
}));

vi.mock('../../services/errorNotifier', () => ({ notifyError: vi.fn() }));

vi.mock('../../services/api', () => ({ api: apiMock }));

// ---------------------------------------------------------------------------
// Typed accessors for captured props
// ---------------------------------------------------------------------------

interface PinboardHandlers {
  onMoveScene: (id: SceneId, x: number, y: number) => Promise<void>;
  onEditScene: (id: SceneId) => void;
  onCreateCause: (fromId: SceneId, toId: SceneId) => Promise<void>;
  onDropProse: (
    sceneId: SceneId,
    data: {
      scopeType: string;
      startOffset: number;
      endOffset: number;
      chapterId?: string | null;
      bookId?: string | null;
    }
  ) => Promise<void>;
}

interface DialogHandlers {
  onSave: (updates: Partial<Omit<Scene, 'id'>>) => Promise<void>;
  onDelete: () => Promise<void>;
  onSaveProseContent: ((text: string) => Promise<void>) | undefined;
  onWriteScene: (() => Promise<void>) | undefined;
  getLinkedProseText: ((link: SceneProseLink) => string | null) | undefined;
}

interface NarrativeHandlers {
  sortMode?: 'narrative' | 'chronological';
  onReorderScene?: (
    sourceSceneId: SceneId,
    targetSceneId: SceneId,
    placeBefore: boolean
  ) => Promise<void>;
}

function pb(): PinboardHandlers {
  if (!captured.pinboard) throw new Error('PinboardView not rendered yet');
  return captured.pinboard as PinboardHandlers;
}

function dlg(): DialogHandlers {
  if (!captured.dialog) throw new Error('SceneEditorDialog not open yet');
  return captured.dialog as DialogHandlers;
}

function nv(): NarrativeHandlers {
  if (!captured.narrative) throw new Error('NarrativeView not rendered yet');
  return captured.narrative as NarrativeHandlers;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    summary: 'Test scene',
    beats: [],
    prose_link: null,
    active_characters: [],
    passive_characters: [],
    location: null,
    time: null,
    color_tag: null,
    status: 'active',
    pinboard_x: 0,
    pinboard_y: 0,
    order_before: [],
    order_after: [],
    ...overrides,
  };
}

function makeProseLink(overrides: Partial<SceneProseLink> = {}): SceneProseLink {
  return {
    scope_type: 'story',
    start_offset: 10,
    end_offset: 30,
    content_hash: 'abc',
    chapter_id: null,
    book_id: null,
    is_stale: false,
    ...overrides,
  };
}

function makeEditorRef(docText: string = 'Hello world, some prose here.'): {
  ref: React.RefObject<EditorHandle | null>;
  view: {
    state: { doc: { length: number; sliceString: ReturnType<typeof vi.fn> } };
    dispatch: ReturnType<typeof vi.fn>;
  };
  dispatch: ReturnType<typeof vi.fn>;
  doc: { length: number; sliceString: ReturnType<typeof vi.fn> };
} {
  const dispatch = vi.fn();
  const doc = {
    length: docText.length,
    sliceString: vi.fn((from: number, to: number) => docText.slice(from, to)),
  };
  const view = { state: { doc }, dispatch };
  const ref: React.RefObject<EditorHandle | null> = {
    current: {
      setOnCursorChange: vi.fn(),
      setProseHighlights: vi.fn(),
      clearProseHighlight: vi.fn(),
      setOnProseBoundaryChange: vi.fn(),
      getEditorView: vi.fn(() => view),
    },
  };
  return { ref, view, dispatch, doc };
}

/**
 * Like makeEditorRef, but the setOnProseBoundaryChange spy actually captures
 * the callback registered by the container's useEffect so tests can invoke it
 * directly after rendering.
 */
function makeEditorRefWithBoundary(docText: string = 'Hello world'): {
  ref: React.RefObject<EditorHandle | null>;
  getBoundaryCallback: () =>
    | ((sceneId: string, edge: 'start' | 'end', offset: number) => Promise<void>)
    | null;
  dispatch: ReturnType<typeof vi.fn>;
} {
  const dispatch = vi.fn();
  const doc = {
    length: docText.length,
    sliceString: vi.fn((from: number, to: number) => docText.slice(from, to)),
  };
  const view = { state: { doc }, dispatch };
  let capturedCb:
    | ((sceneId: string, edge: 'start' | 'end', offset: number) => void)
    | null = null;
  const ref: React.RefObject<EditorHandle | null> = {
    current: {
      setOnCursorChange: vi.fn(),
      setProseHighlights: vi.fn(),
      clearProseHighlight: vi.fn(),
      setOnProseBoundaryChange: vi.fn((cb: ProseBoundaryCallback | null) => {
        capturedCb = cb;
      }),
      getEditorView: vi.fn(() => view),
    },
  };
  return {
    ref,
    dispatch,
    getBoundaryCallback: () =>
      capturedCb as
        | ((sceneId: string, edge: 'start' | 'end', offset: number) => Promise<void>)
        | null,
  };
}

const STORY_UNIT: WritingUnit = { id: 'story', scope: 'story', title: 'Story' };
const CHAPTER: WritingUnit = { id: 'ch-1', scope: 'chapter', title: 'Chapter 1' };

function wrap(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

/**
 * Render the container with the given scenes in the store,
 * then open the dialog for the first scene by calling onEditScene.
 */
async function renderAndOpenDialog(
  scenes: Scene[],
  props: Partial<React.ComponentProps<typeof ScenesPanelContainer>> = {}
): Promise<void> {
  useScenesMock.mockReturnValue(scenes);
  wrap(<ScenesPanelContainer {...props} />);
  await act(async () => {
    // Trigger dialog open via pinboard callback — no API call needed
    pb().onEditScene(scenes[0].id);
  });
}

afterEach(() => {
  cleanup();
  captured.pinboard = null;
  captured.dialog = null;
  captured.narrative = null;
  captured.convergence = null;
  proseSyncState.selectedSceneId = null;
  vi.clearAllMocks();
  useScenesMock.mockReturnValue([]);
  recordHistoryEntryMock.mockReset();
  resetUIStore();
});

// ---------------------------------------------------------------------------
// handleAddScene
// ---------------------------------------------------------------------------

describe('handleAddScene', () => {
  it('calls api.scenes.create and patches the store', async () => {
    const created = makeScene({ id: 'new-1', summary: '' });
    apiMock.scenes.create.mockResolvedValueOnce(created);
    useScenesMock.mockReturnValue([created]);

    const { container } = wrap(<ScenesPanelContainer />);

    // Find and click the Add Scene button
    const addBtn = container.querySelector('button[aria-label]');
    // Use the pinboard handler to simulate what the toolbar button does —
    // but let's click the real button to test the full path.
    expect(addBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(addBtn!);
    });

    expect(apiMock.scenes.create).toHaveBeenCalledOnce();
    expect(patchSceneMock).toHaveBeenCalledWith(created);
  });
});

// ---------------------------------------------------------------------------
// handleMoveScene
// ---------------------------------------------------------------------------

describe('handleMoveScene', () => {
  it('applies an optimistic update then confirms with the API response', async () => {
    const original = makeScene({ id: 's1', pinboard_x: 0, pinboard_y: 0 });
    const confirmed = makeScene({ id: 's1', pinboard_x: 100, pinboard_y: 200 });
    useScenesMock.mockReturnValue([original]);
    apiMock.scenes.update.mockResolvedValueOnce(confirmed);

    wrap(<ScenesPanelContainer />);

    await act(async () => {
      await pb().onMoveScene('s1', 100, 200);
    });

    // Optimistic patch with new coords applied first
    expect(patchSceneMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', pinboard_x: 100, pinboard_y: 200 })
    );
    // Confirmed patch with API response applied second
    expect(patchSceneMock).toHaveBeenCalledWith(confirmed);
  });

  it('reverts the optimistic update on API failure', async () => {
    const original = makeScene({ id: 's1', pinboard_x: 5, pinboard_y: 5 });
    useScenesMock.mockReturnValue([original]);
    apiMock.scenes.update.mockRejectedValueOnce(new Error('network'));

    wrap(<ScenesPanelContainer />);

    await act(async () => {
      await pb().onMoveScene('s1', 999, 999);
    });

    const calls = patchSceneMock.mock.calls as Array<[Scene]>;
    // Last call must restore the original scene
    expect(calls[calls.length - 1][0]).toEqual(original);
  });

  it('does nothing when the scene id is not found in the store', async () => {
    useScenesMock.mockReturnValue([]);
    wrap(<ScenesPanelContainer />);

    await act(async () => {
      await pb().onMoveScene('ghost', 10, 10);
    });

    expect(apiMock.scenes.update).not.toHaveBeenCalled();
    expect(patchSceneMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleSaveScene (via dialog's onSave)
// ---------------------------------------------------------------------------

describe('handleSaveScene', () => {
  it('calls update API and patches the store with the response', async () => {
    const scene = makeScene({ id: 'edit-1' });
    const updatedScene = makeScene({ id: 'edit-1', summary: 'Updated' });
    apiMock.scenes.update.mockResolvedValueOnce(updatedScene);

    await renderAndOpenDialog([scene]);

    await act(async () => {
      await dlg().onSave({ summary: 'Updated' });
    });

    expect(apiMock.scenes.update).toHaveBeenCalledWith('edit-1', {
      summary: 'Updated',
    });
    expect(patchSceneMock).toHaveBeenCalledWith(updatedScene);
  });
});

// ---------------------------------------------------------------------------
// handleDeleteScene (via dialog's onDelete)
// ---------------------------------------------------------------------------

describe('handleDeleteScene', () => {
  it('calls delete API, removes scene from store, and closes dialog', async () => {
    const scene = makeScene({ id: 'del-1' });
    apiMock.scenes.delete.mockResolvedValueOnce(undefined);

    await renderAndOpenDialog([scene]);
    expect(captured.dialog).not.toBeNull();

    await act(async () => {
      await dlg().onDelete();
    });

    expect(apiMock.scenes.delete).toHaveBeenCalledWith('del-1');
    // Store is updated to remove the scene
    expect(patchSceneMock).toHaveBeenCalledWith(null, 'del-1');
    // editingSceneId is reset — the dialog closes because editingScene becomes null.
    // Verify by checking that the dialog mock sees isOpen=false or the component
    // conditionally unmounts. With our spy, captured.dialog reflects the LAST render.
    // Since the container removes the Dialog element entirely (conditional render),
    // our mock won't run again, so we verify the observable store update instead.
    expect(patchSceneMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// handleCreateCause (via pinboard's onCreateCause)
// ---------------------------------------------------------------------------

describe('handleCreateConstraint', () => {
  it('patches both scenes optimistically and then with API responses', async () => {
    const a = makeScene({ id: 'a', order_before: [], order_after: [] });
    const b = makeScene({ id: 'b', order_before: [], order_after: [] });
    const updatedA = makeScene({ id: 'a', order_before: ['b'] });
    const updatedB = makeScene({ id: 'b', order_after: ['a'] });
    useScenesMock.mockReturnValue([a, b]);
    apiMock.scenes.update
      .mockResolvedValueOnce(updatedA)
      .mockResolvedValueOnce(updatedB);

    wrap(<ScenesPanelContainer />);

    await act(async () => {
      await pb().onCreateCause('a', 'b');
    });

    expect(apiMock.scenes.update).toHaveBeenCalledTimes(2);
    expect(patchSceneMock).toHaveBeenCalledWith(updatedA);
    expect(patchSceneMock).toHaveBeenCalledWith(updatedB);
  });

  it('skips the API call when the constraint already exists', async () => {
    const a = makeScene({ id: 'a', order_before: ['b'], order_after: [] });
    const b = makeScene({ id: 'b', order_before: [], order_after: [] });
    useScenesMock.mockReturnValue([a, b]);

    wrap(<ScenesPanelContainer />);

    await act(async () => {
      await pb().onCreateCause('a', 'b');
    });

    expect(apiMock.scenes.update).not.toHaveBeenCalled();
  });

  it('reverts both scenes on API failure', async () => {
    const a = makeScene({ id: 'a', order_before: [], order_after: [] });
    const b = makeScene({ id: 'b', order_before: [], order_after: [] });
    useScenesMock.mockReturnValue([a, b]);
    apiMock.scenes.update.mockRejectedValueOnce(new Error('fail'));

    wrap(<ScenesPanelContainer />);

    await act(async () => {
      await pb().onCreateCause('a', 'b');
    });

    const calls = patchSceneMock.mock.calls as Array<[Scene]>;
    const lastTwo = calls.slice(-2).map((c: [Scene]) => c[0]);
    expect(lastTwo).toContainEqual(a);
    expect(lastTwo).toContainEqual(b);
  });
});

// ---------------------------------------------------------------------------
// handleDropProse (via pinboard's onDropProse)
// ---------------------------------------------------------------------------

describe('handleDropProse', () => {
  it('calls linkProse and patches every returned scene', async () => {
    const a = makeScene({ id: 'a' });
    const b = makeScene({ id: 'b' });
    useScenesMock.mockReturnValue([a, b]);
    apiMock.scenes.linkProse.mockResolvedValueOnce([a, b]);

    wrap(<ScenesPanelContainer />);

    await act(async () => {
      await pb().onDropProse('a', {
        scopeType: 'story',
        startOffset: 0,
        endOffset: 50,
        chapterId: null,
        bookId: null,
      });
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('a', {
      scope_type: 'story',
      chapter_id: null,
      book_id: null,
      start_offset: 0,
      end_offset: 50,
    });
    expect(patchSceneMock).toHaveBeenCalledWith(a);
    expect(patchSceneMock).toHaveBeenCalledWith(b);
  });
});

// ---------------------------------------------------------------------------
// handleSaveProseContent — the critical round-trip test
// ---------------------------------------------------------------------------

describe('handleSaveProseContent', () => {
  it('calls updateProseContent and patches the store with the returned scene', async () => {
    const proseLink = makeProseLink({ start_offset: 0, end_offset: 5 });
    const scene = makeScene({ id: 'ps', prose_link: proseLink });
    const updatedScene = makeScene({
      id: 'ps',
      prose_link: { ...proseLink, end_offset: 9, content_hash: 'new' },
    });
    apiMock.scenes.updateProseContent.mockResolvedValueOnce(updatedScene);
    const { ref } = makeEditorRef('Hello');

    await renderAndOpenDialog([scene], { editorRef: ref });
    expect(dlg().onSaveProseContent).toBeDefined();

    await act(async () => {
      await dlg().onSaveProseContent!('Goodbye');
    });

    expect(apiMock.scenes.updateProseContent).toHaveBeenCalledWith('ps', 'Goodbye');
    expect(patchSceneMock).toHaveBeenCalledWith(updatedScene);
  });

  it('dispatches a CodeMirror replace transaction so the editor reflects the new text', async () => {
    const proseLink = makeProseLink({ start_offset: 6, end_offset: 11 });
    const scene = makeScene({ id: 'ps', prose_link: proseLink });
    const updatedScene = makeScene({
      id: 'ps',
      prose_link: { ...proseLink, end_offset: 9 },
    });
    apiMock.scenes.updateProseContent.mockResolvedValueOnce(updatedScene);
    const { ref, dispatch } = makeEditorRef('Hello world!');

    await renderAndOpenDialog([scene], { editorRef: ref });

    await act(async () => {
      await dlg().onSaveProseContent!('earth');
    });

    expect(dispatch).toHaveBeenCalledWith({
      changes: { from: 6, to: 11, insert: 'earth' },
    });
  });

  it('does NOT dispatch an editor transaction when the scene has no prose link', async () => {
    const scene = makeScene({ id: 'ps', prose_link: null });
    const updatedScene = makeScene({ id: 'ps', prose_link: null });
    apiMock.scenes.updateProseContent.mockResolvedValueOnce(updatedScene);
    const { ref, dispatch } = makeEditorRef();

    await renderAndOpenDialog([scene], { editorRef: ref });

    await act(async () => {
      await dlg().onSaveProseContent!('anything');
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does NOT dispatch when the editor view is unavailable (getEditorView returns null)', async () => {
    const proseLink = makeProseLink();
    const scene = makeScene({ id: 'ps', prose_link: proseLink });
    const updatedScene = makeScene({ id: 'ps', prose_link: proseLink });
    apiMock.scenes.updateProseContent.mockResolvedValueOnce(updatedScene);
    const nullViewRef: React.RefObject<EditorHandle | null> = {
      current: {
        setOnCursorChange: vi.fn(),
        setProseHighlights: vi.fn(),
        clearProseHighlight: vi.fn(),
        setOnProseBoundaryChange: vi.fn(),
        getEditorView: vi.fn(() => null),
      },
    };

    await renderAndOpenDialog([scene], { editorRef: nullViewRef });

    await act(async () => {
      await dlg().onSaveProseContent!('text');
    });

    // Must still patch the store even without a view
    expect(patchSceneMock).toHaveBeenCalledWith(updatedScene);
  });

  it('clamps the replacement range to the document length', async () => {
    const proseLink = makeProseLink({ start_offset: 0, end_offset: 99999 });
    const scene = makeScene({ id: 'ps', prose_link: proseLink });
    const updatedScene = makeScene({ id: 'ps', prose_link: proseLink });
    apiMock.scenes.updateProseContent.mockResolvedValueOnce(updatedScene);
    const shortDoc = 'Short.';
    const { ref, dispatch } = makeEditorRef(shortDoc);

    await renderAndOpenDialog([scene], { editorRef: ref });

    await act(async () => {
      await dlg().onSaveProseContent!('replaced');
    });

    expect(dispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: shortDoc.length, insert: 'replaced' },
    });
  });
});

// ---------------------------------------------------------------------------
// handleWriteScene (via dialog's onWriteScene)
// ---------------------------------------------------------------------------

describe('handleWriteScene', () => {
  it('calls writeScene API and patches returned scenes', async () => {
    const scene = makeScene({ id: 'write-1', prose_link: null });
    const updatedScene = makeScene({
      id: 'write-1',
      summary: 'Generated prose linked',
    });
    const sideEffectScene = makeScene({ id: 'write-2' });
    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text: 'Generated text',
      assignments: [{ scene_id: 'write-1', start_offset: 0, end_offset: 14 }],
      scenes: [sideEffectScene],
    });

    await renderAndOpenDialog([scene], { currentChapter: CHAPTER });
    expect(dlg().onWriteScene).toBeDefined();

    await act(async () => {
      await dlg().onWriteScene!();
    });

    expect(apiMock.scenes.writeScene).toHaveBeenCalledWith('write-1', {
      scope_type: 'chapter',
      chapter_id: 'ch-1',
      book_id: null,
      include_following_scenes: 1,
      detect_boundaries: true,
    });
    expect(patchSceneMock).toHaveBeenCalledWith(updatedScene);
    expect(patchSceneMock).toHaveBeenCalledWith(sideEffectScene);
  });
});

// ---------------------------------------------------------------------------
// getLinkedProseText (exposed as dialog's getLinkedProseText)
// ---------------------------------------------------------------------------

describe('getLinkedProseText', () => {
  it('returns the editor text slice for a story-scoped link when scope matches', async () => {
    const docText = 'Hello world, some prose.';
    const scene = makeScene({ id: 's1' });
    const { ref } = makeEditorRef(docText);

    await renderAndOpenDialog([scene], { editorRef: ref, currentChapter: STORY_UNIT });

    const link: SceneProseLink = makeProseLink({
      scope_type: 'story',
      start_offset: 6,
      end_offset: 11,
    });

    expect(dlg().getLinkedProseText!(link)).toBe('world');
  });

  it('returns the text for a chapter-scoped link when chapter id matches', async () => {
    const docText = 'Chapter text here.';
    const scene = makeScene({ id: 's1' });
    const { ref } = makeEditorRef(docText);

    await renderAndOpenDialog([scene], { editorRef: ref, currentChapter: CHAPTER });

    const link: SceneProseLink = makeProseLink({
      scope_type: 'chapter',
      chapter_id: 'ch-1',
      start_offset: 0,
      end_offset: 7,
    });

    expect(dlg().getLinkedProseText!(link)).toBe('Chapter');
  });

  it('returns null when scope_type is story but current chapter is not story scope', async () => {
    const { ref } = makeEditorRef('Content.');
    const scene = makeScene({ id: 's1' });

    await renderAndOpenDialog([scene], { editorRef: ref, currentChapter: CHAPTER });

    const link: SceneProseLink = makeProseLink({ scope_type: 'story' });
    expect(dlg().getLinkedProseText!(link)).toBeNull();
  });

  it('returns null when chapter_id does not match the current chapter', async () => {
    const { ref } = makeEditorRef('Content.');
    const scene = makeScene({ id: 's1' });

    await renderAndOpenDialog([scene], { editorRef: ref, currentChapter: CHAPTER });

    const link: SceneProseLink = makeProseLink({
      scope_type: 'chapter',
      chapter_id: 'other-chapter',
    });

    expect(dlg().getLinkedProseText!(link)).toBeNull();
  });

  it('returns null when currentChapter is null', async () => {
    const { ref } = makeEditorRef('Content.');
    const scene = makeScene({ id: 's1' });

    await renderAndOpenDialog([scene], { editorRef: ref, currentChapter: null });

    const link: SceneProseLink = makeProseLink({ scope_type: 'story' });
    expect(dlg().getLinkedProseText!(link)).toBeNull();
  });

  it('returns null when the editor view is not available', async () => {
    const nullViewRef: React.RefObject<EditorHandle | null> = {
      current: {
        setOnCursorChange: vi.fn(),
        setProseHighlights: vi.fn(),
        clearProseHighlight: vi.fn(),
        setOnProseBoundaryChange: vi.fn(),
        getEditorView: vi.fn(() => null),
      },
    };
    const scene = makeScene({ id: 's1' });

    await renderAndOpenDialog([scene], {
      editorRef: nullViewRef,
      currentChapter: STORY_UNIT,
    });

    const link: SceneProseLink = makeProseLink({ scope_type: 'story' });
    expect(dlg().getLinkedProseText!(link)).toBeNull();
  });

  it('returns undefined/null when no editorRef is passed (prop omitted)', async () => {
    const scene = makeScene({ id: 's1' });
    // No editorRef prop → getLinkedProseText should be undefined
    await renderAndOpenDialog([scene]);

    expect(dlg().getLinkedProseText).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleProseBoundaryChange (registered via editorRef.setOnProseBoundaryChange)
// ---------------------------------------------------------------------------

describe('handleProseBoundaryChange', () => {
  /**
   * Render the container, wait for effects to flush so the useEffect that calls
   * setOnProseBoundaryChange has run, then return the captured callback.
   */
  async function renderWithBoundary(
    scenes: Scene[],
    props: Partial<React.ComponentProps<typeof ScenesPanelContainer>> = {}
  ): Promise<
    (sceneId: string, edge: 'start' | 'end', offset: number) => Promise<void>
  > {
    useScenesMock.mockReturnValue(scenes);
    await act(async () => {
      wrap(<ScenesPanelContainer {...props} />);
    });
    const cb = (props.editorRef?.current as EditorHandle | null)
      ?.setOnProseBoundaryChange as ReturnType<typeof vi.fn> | undefined;
    if (!cb) throw new Error('editorRef not provided');
    // The last call argument is the registered handler
    const registered = cb.mock.calls[cb.mock.calls.length - 1]?.[0] as
      | ((sceneId: string, edge: 'start' | 'end', offset: number) => Promise<void>)
      | null;
    if (!registered)
      throw new Error('setOnProseBoundaryChange was not called with a handler');
    return registered;
  }

  it('calls linkProse with updated end_offset when the end handle is dragged', async () => {
    const proseLink = makeProseLink({ start_offset: 0, end_offset: 50 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    const result = makeScene({
      id: 's1',
      prose_link: { ...proseLink, end_offset: 70 },
    });
    apiMock.scenes.linkProse.mockResolvedValueOnce([result]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], { editorRef: ref });

    await act(async () => {
      await cb('s1', 'end', 70);
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('s1', {
      scope_type: 'story',
      chapter_id: null,
      book_id: null,
      start_offset: 0,
      end_offset: 70,
    });
    expect(patchSceneMock).toHaveBeenCalledWith(result);
  });

  it('calls linkProse with updated start_offset when the start handle is dragged', async () => {
    const proseLink = makeProseLink({ start_offset: 10, end_offset: 50 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    const result = makeScene({
      id: 's1',
      prose_link: { ...proseLink, start_offset: 20 },
    });
    apiMock.scenes.linkProse.mockResolvedValueOnce([result]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], { editorRef: ref });

    await act(async () => {
      await cb('s1', 'start', 20);
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('s1', {
      scope_type: 'story',
      chapter_id: null,
      book_id: null,
      start_offset: 20,
      end_offset: 50,
    });
    expect(patchSceneMock).toHaveBeenCalledWith(result);
  });

  it('does nothing when the scene is not found', async () => {
    useScenesMock.mockReturnValue([]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([], { editorRef: ref });

    await act(async () => {
      await cb('ghost', 'end', 30);
    });

    expect(apiMock.scenes.linkProse).not.toHaveBeenCalled();
    expect(patchSceneMock).not.toHaveBeenCalled();
  });

  it('does nothing when the scene has no prose_link', async () => {
    const scene = makeScene({ id: 's1', prose_link: null });
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], { editorRef: ref });

    await act(async () => {
      await cb('s1', 'end', 30);
    });

    expect(apiMock.scenes.linkProse).not.toHaveBeenCalled();
  });

  it('does nothing when dragging end before the current start (invalid range)', async () => {
    const proseLink = makeProseLink({ start_offset: 40, end_offset: 80 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], { editorRef: ref });

    await act(async () => {
      await cb('s1', 'end', 30); // 30 < start_offset=40 → invalid
    });

    expect(apiMock.scenes.linkProse).not.toHaveBeenCalled();
  });

  it('does nothing when dragging start past the current end (invalid range)', async () => {
    const proseLink = makeProseLink({ start_offset: 10, end_offset: 50 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], { editorRef: ref });

    await act(async () => {
      await cb('s1', 'start', 60); // 60 > end_offset=50 → invalid
    });

    expect(apiMock.scenes.linkProse).not.toHaveBeenCalled();
  });

  it('patches all scenes returned by linkProse (server may touch multiple scenes)', async () => {
    const proseLink = makeProseLink({ start_offset: 0, end_offset: 50 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    const r1 = makeScene({ id: 's1', prose_link: { ...proseLink, end_offset: 60 } });
    const r2 = makeScene({ id: 'other' });
    apiMock.scenes.linkProse.mockResolvedValueOnce([r1, r2]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], { editorRef: ref });

    await act(async () => {
      await cb('s1', 'end', 60);
    });

    expect(patchSceneMock).toHaveBeenCalledWith(r1);
    expect(patchSceneMock).toHaveBeenCalledWith(r2);
  });

  it('calls notifyError and does not patch store on API failure', async () => {
    const { notifyError } = await import('../../services/errorNotifier');
    const proseLink = makeProseLink({ start_offset: 0, end_offset: 50 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    apiMock.scenes.linkProse.mockRejectedValueOnce(new Error('network'));
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], { editorRef: ref });

    await act(async () => {
      await cb('s1', 'end', 30);
    });

    expect(patchSceneMock).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalled();
  });

  // ---- Overlap prevention ----

  it('pushes adjacent scene start when dragging end handle into its range', async () => {
    // Scene A: [0, 50), Scene B: [50, 100)
    // Drag A's end to 70 → A becomes [0, 70), B should be pushed to [70, 100).
    const linkA = makeProseLink({ start_offset: 0, end_offset: 50 });
    const linkB = makeProseLink({ start_offset: 50, end_offset: 100 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });
    const updatedA = makeScene({ id: 'a', prose_link: { ...linkA, end_offset: 70 } });
    const updatedB = makeScene({ id: 'b', prose_link: { ...linkB, start_offset: 70 } });
    // First call adjusts B, second call updates A
    apiMock.scenes.linkProse
      .mockResolvedValueOnce([updatedB])
      .mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'end', 70);
    });

    // B's start is pushed to 70 first
    expect(apiMock.scenes.linkProse).toHaveBeenNthCalledWith(1, 'b', {
      scope_type: 'story',
      chapter_id: null,
      book_id: null,
      start_offset: 70,
      end_offset: 100,
    });
    // Then A is updated
    expect(apiMock.scenes.linkProse).toHaveBeenNthCalledWith(2, 'a', {
      scope_type: 'story',
      chapter_id: null,
      book_id: null,
      start_offset: 0,
      end_offset: 70,
    });
    expect(patchSceneMock).toHaveBeenCalledWith(updatedB);
    expect(patchSceneMock).toHaveBeenCalledWith(updatedA);
  });

  it('pushes adjacent scene end when dragging start handle into its range', async () => {
    // Scene A: [50, 100), Scene B: [0, 50)
    // Drag A's start to 30 → A becomes [30, 100), B should be pushed to [0, 30).
    const linkA = makeProseLink({ start_offset: 50, end_offset: 100 });
    const linkB = makeProseLink({ start_offset: 0, end_offset: 50 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });
    const updatedA = makeScene({ id: 'a', prose_link: { ...linkA, start_offset: 30 } });
    const updatedB = makeScene({ id: 'b', prose_link: { ...linkB, end_offset: 30 } });
    apiMock.scenes.linkProse
      .mockResolvedValueOnce([updatedB])
      .mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'start', 30);
    });

    expect(apiMock.scenes.linkProse).toHaveBeenNthCalledWith(1, 'b', {
      scope_type: 'story',
      chapter_id: null,
      book_id: null,
      start_offset: 0,
      end_offset: 30,
    });
    expect(apiMock.scenes.linkProse).toHaveBeenNthCalledWith(2, 'a', {
      scope_type: 'story',
      chapter_id: null,
      book_id: null,
      start_offset: 30,
      end_offset: 100,
    });
  });

  it('does not adjust a scene in a different scope when overlap is detected', async () => {
    // Scene A is story-scoped, Scene B is chapter-scoped — they should not interfere.
    const linkA = makeProseLink({
      scope_type: 'story',
      start_offset: 0,
      end_offset: 50,
    });
    const linkB = makeProseLink({
      scope_type: 'chapter',
      chapter_id: 'ch1',
      start_offset: 30,
      end_offset: 80,
    });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });
    const updatedA = makeScene({ id: 'a', prose_link: { ...linkA, end_offset: 60 } });
    apiMock.scenes.linkProse.mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'end', 60);
    });

    // Only one linkProse call — for scene A; scene B is untouched because it's a different scope.
    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(1);
    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('a', expect.anything());
  });

  it('does not adjust a chapter scene that belongs to a different chapter', async () => {
    const linkA = makeProseLink({
      scope_type: 'chapter',
      chapter_id: 'ch1',
      start_offset: 0,
      end_offset: 50,
    });
    const linkB = makeProseLink({
      scope_type: 'chapter',
      chapter_id: 'ch2', // different chapter
      start_offset: 30,
      end_offset: 80,
    });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });
    const updatedA = makeScene({ id: 'a', prose_link: { ...linkA, end_offset: 60 } });
    apiMock.scenes.linkProse.mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'end', 60);
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(1);
  });

  it('skips overlap adjustment when dragging to exactly the adjacent scene boundary (touching, not overlapping)', async () => {
    // Scene A: [0, 50), Scene B: [50, 100)
    // Drag A's end to exactly 50 — they now share a boundary but do not overlap.
    // The condition `otherStart (50) >= endOffset (50)` is TRUE so no adjustment.
    const linkA = makeProseLink({ start_offset: 0, end_offset: 40 });
    const linkB = makeProseLink({ start_offset: 50, end_offset: 100 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });
    const updatedA = makeScene({ id: 'a', prose_link: { ...linkA, end_offset: 50 } });
    apiMock.scenes.linkProse.mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'end', 50);
    });

    // Only one linkProse call — for A only; B is NOT adjusted because touching ≠ overlapping.
    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(1);
    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('a', {
      scope_type: 'story',
      chapter_id: null,
      book_id: null,
      start_offset: 0,
      end_offset: 50,
    });
  });

  it('skips overlap adjustment when dragging start to exactly the adjacent scene end (touching)', async () => {
    // Scene A: [50, 100), Scene B: [0, 50)
    // Drag A's start to 50 — touching B's end, not overlapping.
    const linkA = makeProseLink({ start_offset: 60, end_offset: 100 });
    const linkB = makeProseLink({ start_offset: 0, end_offset: 50 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });
    const updatedA = makeScene({ id: 'a', prose_link: { ...linkA, start_offset: 50 } });
    apiMock.scenes.linkProse.mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'start', 50);
    });

    // Only one call — for A; B end at 50 == A's new start → touching, not overlapping.
    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(1);
    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({
        start_offset: 50,
        end_offset: 100,
      })
    );
  });

  it('skips overlap adjustment when the engulfed scene would shrink to zero width', async () => {
    // Scene A: [0, 100), Scene B: [10, 20) — B would be engulfed entirely if A's end=100 is moved
    // to 80. B's new start would be 80 which is > B's end (20) → no adjustment for B.
    const linkA = makeProseLink({ start_offset: 0, end_offset: 40 });
    const linkB = makeProseLink({ start_offset: 10, end_offset: 20 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });
    const updatedA = makeScene({ id: 'a', prose_link: { ...linkA, end_offset: 80 } });
    apiMock.scenes.linkProse.mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'end', 80);
    });

    // B.end=20 < 80 (new end), so B.newStart=80 >= B.newEnd=20 → skip.
    // Only the main linkProse for A is called.
    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(1);
    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('a', expect.anything());
  });
});

// ============================================================================
// Narrative view reorder tests
// ============================================================================

describe('scene view mode wiring', () => {
  it('passes chronological sort mode and disables prose reorder callback in Chronological view', async () => {
    useScenesMock.mockReturnValue([makeScene({ id: 'scene-a' })]);
    const utils = wrap(<ScenesPanelContainer />);

    await act(async () => {
      fireEvent.click(utils.getByRole('button', { name: 'Chronological' }));
    });

    expect(nv().sortMode).toBe('chronological');
    expect(nv().onReorderScene).toBeUndefined();
  });
});

describe('scene lane persistence', () => {
  it('keeps lane order across Narrative and Convergence Map views', async () => {
    useScenesMock.mockReturnValue([makeScene({ id: 'scene-a' })]);
    useUIStore.setState({
      sceneLaneState: {
        visibleLaneEntryIds: ['Alice', 'Aether'],
        removedReferencedLaneIds: [],
      },
    });

    const utils = wrap(<ScenesPanelContainer />);

    await act(async () => {
      fireEvent.click(utils.getByRole('button', { name: 'Narrative' }));
    });

    expect(captured.narrative?.initialVisibleLaneEntryIds).toEqual(['Alice', 'Aether']);

    captured.narrative?.onVisibleLaneEntryIdsChange?.(['Alice', 'Aether', 'Bob']);

    await act(async () => {
      fireEvent.click(utils.getByRole('button', { name: 'Convergence Map' }));
    });

    expect(captured.convergence?.initialVisibleLaneEntryIds).toEqual([
      'Alice',
      'Aether',
      'Bob',
    ]);
  });
});

describe('handleNarrativeReorder (drag-reorder user interaction)', () => {
  async function renderNarrative(
    scenes: Scene[],
    props: Partial<React.ComponentProps<typeof ScenesPanelContainer>> = {}
  ): Promise<void> {
    useScenesMock.mockReturnValue(scenes);
    const utils = wrap(<ScenesPanelContainer {...props} />);
    await act(async () => {
      fireEvent.click(utils.getByRole('button', { name: 'Narrative' }));
    });
  }

  it.each([
    { label: 'none selected and no active scene', selectedSceneId: null },
    { label: 'source scene active', selectedSceneId: 'b' },
    { label: 'target scene active', selectedSceneId: 'a' },
  ])(
    '[VALID] forwards reorder intent to backend with $label',
    async ({ selectedSceneId }: { label: string; selectedSceneId: string | null }) => {
      proseSyncState.selectedSceneId = selectedSceneId;

      const sceneA = makeScene({
        id: 'a',
        prose_link: makeProseLink({ start_offset: 0, end_offset: 8, is_stale: false }),
      });
      const sceneB = makeScene({
        id: 'b',
        prose_link: makeProseLink({ start_offset: 9, end_offset: 17, is_stale: false }),
      });

      apiMock.scenes.reorderProse.mockResolvedValueOnce({
        scenes: [
          makeScene({
            id: 'b',
            prose_link: makeProseLink({ start_offset: 0, end_offset: 8 }),
          }),
          makeScene({
            id: 'a',
            prose_link: makeProseLink({ start_offset: 9, end_offset: 17 }),
          }),
        ],
        scope_type: 'story',
        chapter_id: null,
        book_id: null,
        scope_start: 0,
        scope_end: 17,
        rebuilt_text: 'Scene B. Scene A.',
      });

      const { ref, dispatch } = makeEditorRef('Scene A. Scene B.');
      await renderNarrative([sceneA, sceneB], {
        editorRef: ref,
        currentChapter: STORY_UNIT,
      });

      await act(async () => {
        await nv().onReorderScene?.('b', 'a', true);
      });

      expect(apiMock.scenes.reorderProse).toHaveBeenCalledTimes(1);
      expect(apiMock.scenes.reorderProse).toHaveBeenCalledWith({
        source_scene_id: 'b',
        target_scene_id: 'a',
        place_before: true,
      });
      expect(patchSceneMock).toHaveBeenCalledTimes(2);
      expect(dispatch).toHaveBeenCalledWith({
        changes: { from: 0, to: 17, insert: 'Scene B. Scene A.' },
      });
    }
  );

  it('[INVALID] no-op when source and target are same', async () => {
    const sceneA = makeScene({ id: 'a', prose_link: makeProseLink() });
    await renderNarrative([sceneA]);

    await act(async () => {
      await nv().onReorderScene?.('a', 'a', true);
    });

    expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
  });

  it('[INVALID] no-op when source has no prose_link', async () => {
    const sceneA = makeScene({ id: 'a', prose_link: null });
    const sceneB = makeScene({ id: 'b', prose_link: makeProseLink() });
    await renderNarrative([sceneA, sceneB]);

    await act(async () => {
      await nv().onReorderScene?.('a', 'b', true);
    });

    expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
  });

  it('[INVALID] no-op when target has no prose_link', async () => {
    const sceneA = makeScene({ id: 'a', prose_link: makeProseLink() });
    const sceneB = makeScene({ id: 'b', prose_link: null });
    await renderNarrative([sceneA, sceneB]);

    await act(async () => {
      await nv().onReorderScene?.('a', 'b', true);
    });

    expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
  });

  it('[VALID] persists unlinked scene reorder using order_index updates', async () => {
    const sceneA = makeScene({ id: 'a', prose_link: null, order_index: 1 });
    const sceneB = makeScene({ id: 'b', prose_link: null, order_index: 2 });

    apiMock.scenes.update
      .mockResolvedValueOnce({ ...sceneB, order_index: 1 })
      .mockResolvedValueOnce({ ...sceneA, order_index: 2 });

    await renderNarrative([sceneA, sceneB]);

    await act(async () => {
      await nv().onReorderScene?.('b', 'a', true);
    });

    expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
    expect(apiMock.scenes.update).toHaveBeenNthCalledWith(
      1,
      'b',
      expect.objectContaining({ order_index: 0 })
    );
    expect(apiMock.scenes.update).toHaveBeenCalledTimes(1);
  });

  it('[VALID] forwards reorder intent for different prose scopes', async () => {
    const sceneA = makeScene({
      id: 'a',
      prose_link: makeProseLink({ scope_type: 'story', chapter_id: null }),
    });
    const sceneB = makeScene({
      id: 'b',
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
    });
    apiMock.scenes.reorderProse.mockResolvedValueOnce({
      scenes: [sceneA, sceneB],
      scope_type: 'chapter',
      chapter_id: 'ch-1',
      book_id: null,
      scope_start: 0,
      scope_end: 10,
      rebuilt_text: 'moved',
    });
    await renderNarrative([sceneA, sceneB]);

    await act(async () => {
      await nv().onReorderScene?.('a', 'b', true);
    });

    expect(apiMock.scenes.reorderProse).toHaveBeenCalledWith({
      source_scene_id: 'a',
      target_scene_id: 'b',
      place_before: true,
    });
  });

  it('[VALID] forwards reorder intent for different chapters', async () => {
    const sceneA = makeScene({
      id: 'a',
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
    });
    const sceneB = makeScene({
      id: 'b',
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-2' }),
    });
    apiMock.scenes.reorderProse.mockResolvedValueOnce({
      scenes: [sceneA, sceneB],
      scope_type: 'chapter',
      chapter_id: 'ch-2',
      book_id: null,
      scope_start: 0,
      scope_end: 10,
      rebuilt_text: 'moved',
    });
    await renderNarrative([sceneA, sceneB]);

    await act(async () => {
      await nv().onReorderScene?.('a', 'b', true);
    });

    expect(apiMock.scenes.reorderProse).toHaveBeenCalledWith({
      source_scene_id: 'a',
      target_scene_id: 'b',
      place_before: true,
    });
  });

  it('[ERROR] reports backend reorder failures without patching store', async () => {
    const { notifyError } = await import('../../services/errorNotifier');
    const sceneA = makeScene({
      id: 'a',
      prose_link: makeProseLink({ start_offset: 0, end_offset: 8 }),
    });
    const sceneB = makeScene({
      id: 'b',
      prose_link: makeProseLink({ start_offset: 9, end_offset: 17 }),
    });
    apiMock.scenes.reorderProse.mockRejectedValueOnce(new Error('Network error'));

    await renderNarrative([sceneA, sceneB]);

    await act(async () => {
      await nv().onReorderScene?.('b', 'a', true);
    });

    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(apiMock.scenes.reorderProse).toHaveBeenCalledTimes(1);
    expect(patchSceneMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Undo/redo history recording coverage
// ============================================================================

describe('scene mutations record history entries', () => {
  it('records history for add, move, save, and delete scene', async () => {
    const created = makeScene({ id: 'new-1', summary: '' });
    const moved = makeScene({ id: 'new-1', pinboard_x: 10, pinboard_y: 20 });
    const saved = makeScene({ id: 'new-1', summary: 'Saved summary' });

    apiMock.scenes.create.mockResolvedValueOnce(created);
    apiMock.scenes.update.mockResolvedValueOnce(moved).mockResolvedValueOnce(saved);
    apiMock.scenes.delete.mockResolvedValueOnce(undefined);

    useScenesMock.mockReturnValue([created]);
    const { container } = wrap(
      <ScenesPanelContainer recordHistoryEntry={recordHistoryEntryMock} />
    );

    await act(async () => {
      fireEvent.click(container.querySelector('button[aria-label]')!);
    });

    await act(async () => {
      await pb().onMoveScene('new-1', 10, 20);
    });

    await act(async () => {
      pb().onEditScene('new-1');
    });

    await act(async () => {
      await dlg().onSave({ summary: 'Saved summary' });
      await dlg().onDelete();
    });

    const labels = recordHistoryEntryMock.mock.calls.map(
      (call: [{ label: string }]) => call[0].label
    );
    expect(labels).toContain('Add scene');
    expect(labels).toContain('Move scene');
    expect(labels).toContain('Update scene');
    expect(labels).toContain('Delete scene');
  });

  it('records history for dependency and prose-link mutations', async () => {
    const sceneA = makeScene({ id: 'a', order_before: [], order_after: [] });
    const sceneB = makeScene({ id: 'b', order_before: [], order_after: [] });
    const withConstraintA = makeScene({ id: 'a', order_before: ['b'] });
    const withConstraintB = makeScene({ id: 'b', order_after: ['a'] });
    const proseLinkedA = makeScene({
      id: 'a',
      prose_link: makeProseLink({ start_offset: 0, end_offset: 15 }),
    });

    apiMock.scenes.update
      .mockResolvedValueOnce(withConstraintA)
      .mockResolvedValueOnce(withConstraintB);
    apiMock.scenes.linkProse.mockResolvedValueOnce([proseLinkedA]);

    useScenesMock.mockReturnValue([sceneA, sceneB]);
    await act(async () => {
      wrap(<ScenesPanelContainer recordHistoryEntry={recordHistoryEntryMock} />);
    });

    await act(async () => {
      await pb().onCreateCause('a', 'b');
      await pb().onDropProse('a', {
        scopeType: 'story',
        startOffset: 0,
        endOffset: 15,
        chapterId: null,
        bookId: null,
      });
    });

    const labels = recordHistoryEntryMock.mock.calls.map(
      (call: [{ label: string }]) => call[0].label
    );
    expect(labels).toContain('Add scene dependency');
    expect(labels).toContain('Link scene prose');
  });

  it('records history for removing a dependency', async () => {
    const sceneA = makeScene({ id: 'a', order_before: ['b'], order_after: [] });
    const sceneB = makeScene({ id: 'b', order_before: [], order_after: ['a'] });
    const withoutConstraintA = makeScene({ id: 'a', order_before: [] });
    const withoutConstraintB = makeScene({ id: 'b', order_after: [] });

    apiMock.scenes.update
      .mockResolvedValueOnce(withoutConstraintA)
      .mockResolvedValueOnce(withoutConstraintB);

    await renderAndOpenDialog([sceneA, sceneB], {
      recordHistoryEntry: recordHistoryEntryMock,
    });

    await act(async () => {
      await (
        captured.dialog as { onDeleteCause: (x: string, y: string) => Promise<void> }
      ).onDeleteCause('a', 'b');
    });

    const labels = recordHistoryEntryMock.mock.calls.map(
      (call: [{ label: string }]) => call[0].label
    );
    expect(labels).toContain('Remove scene dependency');
  });

  it('records history for narrative reorder and prose content edit', async () => {
    const linkA = makeProseLink({ start_offset: 0, end_offset: 8 });
    const linkB = makeProseLink({ start_offset: 9, end_offset: 17 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });

    apiMock.scenes.reorderProse.mockResolvedValueOnce({
      scenes: [
        makeScene({ id: 'a', prose_link: linkA }),
        makeScene({ id: 'b', prose_link: linkB }),
      ],
      scope_type: 'story',
      chapter_id: null,
      book_id: null,
      scope_start: 0,
      scope_end: 17,
      rebuilt_text: 'Scene B. Scene A.',
    });
    apiMock.scenes.linkProse.mockResolvedValueOnce([
      makeScene({
        id: 'a',
        prose_link: makeProseLink({ start_offset: 0, end_offset: 10 }),
      }),
    ]);
    apiMock.scenes.updateProseContent.mockResolvedValueOnce(
      makeScene({
        id: 'a',
        prose_link: makeProseLink({ start_offset: 0, end_offset: 10 }),
      })
    );

    const { ref } = makeEditorRefWithBoundary('Scene A. Scene B.');
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const narrativeRender = wrap(
      <ScenesPanelContainer
        editorRef={ref}
        currentChapter={STORY_UNIT}
        recordHistoryEntry={recordHistoryEntryMock}
      />
    );

    await act(async () => {
      fireEvent.click(narrativeRender.getByRole('button', { name: 'Narrative' }));
    });

    await act(async () => {
      await nv().onReorderScene?.('b', 'a', true);
    });

    await renderAndOpenDialog([sceneA, sceneB], {
      editorRef: ref,
      currentChapter: STORY_UNIT,
      recordHistoryEntry: recordHistoryEntryMock,
    });

    await act(async () => {
      await dlg().onSaveProseContent?.('Scene B. Scene A.');
    });

    const boundaryCb = (
      ref.current?.setOnProseBoundaryChange as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[0] as
      | ((sceneId: string, edge: 'start' | 'end', offset: number) => Promise<void>)
      | undefined;
    expect(boundaryCb).toBeTypeOf('function');

    const labels = recordHistoryEntryMock.mock.calls.map(
      (call: [{ label: string }]) => call[0].label
    );
    expect(labels).toContain('Reorder scene prose');
    expect(labels).toContain('Edit scene linked prose');
  });

  it('records history for prose boundary adjustments', async () => {
    const linkA = makeProseLink({ start_offset: 0, end_offset: 8 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    apiMock.scenes.linkProse.mockResolvedValueOnce([
      makeScene({
        id: 'a',
        prose_link: makeProseLink({ start_offset: 0, end_offset: 10 }),
      }),
    ]);

    const { ref } = makeEditorRefWithBoundary('Scene A.');
    useScenesMock.mockReturnValue([sceneA]);
    await act(async () => {
      wrap(
        <ScenesPanelContainer
          editorRef={ref}
          recordHistoryEntry={recordHistoryEntryMock}
        />
      );
    });

    const cb = (
      ref.current?.setOnProseBoundaryChange as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[0] as
      | ((sceneId: string, edge: 'start' | 'end', offset: number) => Promise<void>)
      | undefined;
    expect(cb).toBeTypeOf('function');

    await act(async () => {
      await cb?.('a', 'end', 10);
    });

    const labels = recordHistoryEntryMock.mock.calls.map(
      (call: [{ label: string }]) => call[0].label
    );
    expect(labels).toContain('Adjust scene prose boundary');
  });
});
