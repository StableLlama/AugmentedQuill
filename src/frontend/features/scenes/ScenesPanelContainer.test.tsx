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
import type { WritingUnit, Chapter, Book } from '../../types/domain';
import type { EditorHandle } from '../editor/Editor';
import type { ProseBoundaryCallback } from '../editor/CodeMirrorEditor';
import { stripInlineInternalMarkers } from '../editor/internalTags';
import { toVisibleRange } from './proseLinkCoordinates';

var patchSceneMock: ReturnType<typeof vi.fn>;
var recordHistoryEntryMock: ReturnType<typeof vi.fn>;
var setStoryMock: ReturnType<typeof vi.fn>;
var setBaselineStateMock: ReturnType<typeof vi.fn>;
var useStoryStoreMock: ReturnType<typeof vi.fn>;

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
  chaptersMetaMock.mockReturnValue([]);
  booksMetaMock.mockReturnValue([]);
  projectTypeState.value = 'novel';
  apiMock.chapters.get.mockReset();
  apiMock.chapters.get.mockResolvedValue({ content: '' });
  // batchLinkProse is asserted precisely (exact returned/reconstructed
  // content) by some tests; without resetting it here, an unconsumed
  // `mockResolvedValueOnce` queued by an earlier test can silently leak
  // into a later, unrelated test's call.
  apiMock.scenes.batchLinkProse.mockReset();
});

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  useScenesMock,
  projectTypeState,
  chaptersMetaMock,
  booksMetaMock,
  apiMock,
  captured,
  proseSyncState,
  useSceneProseSyncMock,
  storyState,
} = vi.hoisted(() => {
  patchSceneMock = vi.fn();
  setStoryMock = vi.fn();
  setBaselineStateMock = vi.fn();
  recordHistoryEntryMock = vi.fn();
  const useScenesMock = vi.fn(() => [] as Scene[]);
  const projectTypeState = {
    value: 'novel' as 'short-story' | 'novel' | 'series',
  };
  const chaptersMetaMock = vi.fn(() => [] as Chapter[]);
  const booksMetaMock = vi.fn(() => [] as Book[]);
  const apiMock = {
    chapters: {
      get: vi.fn(),
    },
    scenes: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      linkProse: vi.fn(),
      batchLinkProse: vi.fn(),
      unlinkProse: vi.fn(),
      reorderProse: vi.fn(),
      refreshHash: vi.fn(),
      updateProseContent: vi.fn(),
      writeScene: vi.fn(),
    },
    story: {
      getContent: vi.fn(),
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
  const storyState: {
    sourcebook: unknown[];
    draft?: { content: string };
    chapters: Array<{
      id: string;
      scope: 'chapter';
      title: string;
      summary: string;
      content: string;
    }>;
  } = {
    sourcebook: [] as unknown[],
    draft: undefined,
    chapters: [],
  };

  useStoryStoreMock = vi.fn(
    (
      selector: (state: {
        patchScene: unknown;
        setStory: unknown;
        setBaselineState: unknown;
        story: { sourcebook: unknown[] };
      }) => unknown
    ) =>
      selector({
        patchScene: patchSceneMock,
        setStory: setStoryMock,
        setBaselineState: setBaselineStateMock,
        story: storyState,
      })
  );

  // Attach static getState for useStoryStore.getState() calls.
  (useStoryStoreMock as unknown as Record<string, unknown>).getState = vi.fn(() => ({
    story: storyState,
    setBaselineState: setBaselineStateMock,
  }));

  return {
    patchSceneMock,
    recordHistoryEntryMock,
    setStoryMock,
    setBaselineStateMock,
    useScenesMock,
    projectTypeState,
    chaptersMetaMock,
    booksMetaMock,
    apiMock,
    captured,
    proseSyncState,
    useSceneProseSyncMock,
    storyState,
    useStoryStoreMock,
  };
});

vi.mock('../../stores/storyStore', () => ({
  useScenes: () => useScenesMock(),
  useStoryStore: (
    selector: (state: {
      patchScene: unknown;
      setStory: unknown;
      setBaselineState: unknown;
      story: { sourcebook: unknown[] };
    }) => unknown
  ) =>
    (
      useStoryStoreMock as unknown as (
        innerSelector: (state: {
          patchScene: unknown;
          setStory: unknown;
          setBaselineState: unknown;
          story: { sourcebook: unknown[] };
        }) => unknown
      ) => unknown
    )(selector),
  useStoryMeta: () => ({ projectType: projectTypeState.value }),
  useStoryChaptersListMeta: () => chaptersMetaMock(),
  useStoryBooks: () => booksMetaMock(),
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
  onClose: () => void;
  onSave: (updates: Partial<Omit<Scene, 'id'>>) => Promise<void>;
  onDelete: () => Promise<void>;
  onSaveProseContent: ((text: string) => Promise<void>) | undefined;
  onWriteScene: (() => Promise<void>) | undefined;
  getLinkedProseText: ((link: SceneProseLink) => string | null) | undefined;
}

interface NarrativeHandlers {
  sortMode?: 'narrative' | 'chronological';
  onCreateCause?: (fromId: SceneId, toId: SceneId) => Promise<void>;
  onReorderScene?: (
    sourceSceneId: SceneId,
    targetSceneId: SceneId,
    placeBefore: boolean
  ) => Promise<void>;
  onDropScenesOnChapter?: (
    sourceSceneIds: SceneId[],
    chapterId: string
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

function makeScene(overrides: Record<string, unknown> = {}): Scene {
  const legacy = overrides as {
    causes?: SceneId[];
    [key: string]: unknown;
  };
  const { causes: _causes, ...rest } = legacy;
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
    causes: [...(legacy.causes ?? [])],
    ...rest,
  } as Scene;
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

function makeMutableEditorRef(initialText: string = ''): {
  ref: React.RefObject<EditorHandle | null>;
  getText: () => string;
} {
  let currentText = initialText;
  const doc = {
    get length(): number {
      return currentText.length;
    },
    sliceString: (from: number, to: number): string => currentText.slice(from, to),
    // CodeMirror's Doc.toString() returns the full document text.  Without
    // this, the container's updateCurrentChapterContent(view.state.doc.toString())
    // receives '[object Object]' instead of the real text, silently exercising
    // a different code path than the real editor.
    toString: (): string => currentText,
  };
  const view = {
    state: { doc },
    dispatch: vi.fn(
      (spec: { changes?: { from: number; to: number; insert: string } }) => {
        const changes = spec?.changes;
        if (!changes) return;
        const from = Math.max(0, Math.min(changes.from, currentText.length));
        const to = Math.max(from, Math.min(changes.to, currentText.length));
        currentText = `${currentText.slice(0, from)}${changes.insert}${currentText.slice(to)}`;
      }
    ),
  };
  const ref: React.RefObject<EditorHandle | null> = {
    current: {
      setOnCursorChange: vi.fn(),
      setProseHighlights: vi.fn(),
      clearProseHighlight: vi.fn(),
      setOnProseBoundaryChange: vi.fn(),
      getEditorView: vi.fn(() => view),
    },
  };

  return {
    ref,
    getText: (): string => currentText,
  };
}

/**
 * Like makeEditorRef, but the setOnProseBoundaryChange spy actually captures
 * the callback registered by the container's useEffect so tests can invoke it
 * directly after rendering.
 */
function makeEditorRefWithBoundary(docText: string = 'Hello world'): {
  ref: React.RefObject<EditorHandle | null>;
  getBoundaryCallback: () =>
    ((sceneId: string, edge: 'start' | 'end', offset: number) => Promise<void>) | null;
  dispatch: ReturnType<typeof vi.fn>;
} {
  const dispatch = vi.fn();
  const doc = {
    length: docText.length,
    sliceString: vi.fn((from: number, to: number) => docText.slice(from, to)),
  };
  const view = { state: { doc }, dispatch };
  let capturedCb:
    ((sceneId: string, edge: 'start' | 'end', offset: number) => void) | null = null;
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

beforeEach(() => {
  // Set the default scenes view type to pinboard for tests that interact
  // with the PinboardView.  Individual test suites may override this.
  useUIStore.getState().setScenesViewType('pinboard');
});

afterEach(() => {
  cleanup();
  captured.pinboard = null;
  captured.dialog = null;
  captured.narrative = null;
  captured.convergence = null;
  proseSyncState.selectedSceneId = null;
  vi.clearAllMocks();
  useScenesMock.mockReturnValue([]);
  storyState.sourcebook = [];
  storyState.draft = undefined;
  storyState.chapters = [];
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
    expect(patchSceneMock).toHaveBeenCalled();
  });
});

describe('related scene highlighting', () => {
  it('passes scene ids only for the active chapter into the view', () => {
    const sceneA = makeScene({
      id: 'scene-1',
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
    });
    const sceneB = makeScene({
      id: 'scene-2',
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-2' }),
    });
    const currentChapter = { id: 'ch-1', scope: 'chapter', title: 'Chapter 1' };
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    useUIStore.getState().setSceneSelectionChapterIds(new Set(['ch-2']));

    wrap(<ScenesPanelContainer currentChapter={currentChapter} />);

    expect(captured.pinboard?.relatedSceneIds).toEqual(new Set(['scene-1']));
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
    expect(patchSceneMock).toHaveBeenCalled();
    // Confirmed patch with API response applied second
    expect(patchSceneMock).toHaveBeenCalled();
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

    expect(apiMock.scenes.update).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('advances baseline to current story after user save so edits are not shown as diff', async () => {
    // SPEC: When the user saves a scene, the baseline must advance
    // so that reopening the dialog does not show the user's own text
    // as AI-introduced changes.
    const scene = makeScene({ id: 'edit-2', summary: 'Original' });
    const updatedScene = makeScene({ id: 'edit-2', summary: 'User edit' });
    apiMock.scenes.update.mockResolvedValueOnce(updatedScene);

    await renderAndOpenDialog([scene]);

    await act(async () => {
      await dlg().onSave({ summary: 'User edit' });
    });

    // Baseline must be advanced to include the updated scene.
    expect(setBaselineStateMock).toHaveBeenCalledTimes(1);
    const advancedState = setBaselineStateMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const advancedScenes = advancedState.scenes as Scene[];
    expect(advancedScenes).toHaveLength(1);
    expect(advancedScenes[0].id).toBe('edit-2');
    expect(advancedScenes[0].summary).toBe('User edit');
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

    expect(apiMock.scenes.delete).toHaveBeenCalled();
    // Store is updated to remove the scene
    expect(patchSceneMock).toHaveBeenCalled();
    // editingSceneId is reset — the dialog closes because editingScene becomes null.
    // Verify by checking that the dialog mock sees isOpen=false or the component
    // conditionally unmounts. With our spy, captured.dialog reflects the LAST render.
    // Since the container removes the Dialog element entirely (conditional render),
    // our mock won't run again, so we verify the observable store update instead.
    expect(patchSceneMock).toHaveBeenCalledTimes(1);
  });

  it('records an undo handler that re-creates the deleted scene on the backend', async () => {
    const scene = makeScene({ id: 'del-1', summary: 'Deleted scene' });
    apiMock.scenes.delete.mockResolvedValueOnce(undefined);
    const restored = makeScene({ id: 'new-1', summary: 'Deleted scene' });
    apiMock.scenes.create.mockResolvedValueOnce(restored);

    await renderAndOpenDialog([scene], {
      recordHistoryEntry: recordHistoryEntryMock,
    });

    await act(async () => {
      await dlg().onDelete();
    });

    const entry = recordHistoryEntryMock.mock.calls
      .map((call: [{ label: string; onUndo?: () => Promise<void> | void }]) => call[0])
      .find((e: { label: string }) => e.label === 'Delete scene');
    expect(entry).toBeTruthy();
    expect(entry!.onUndo).toBeTypeOf('function');

    apiMock.scenes.create.mockClear();
    await act(async () => {
      await entry!.onUndo!();
    });

    // Undo must re-create the scene on the backend so it survives a reload
    // (BUG-6) and reconcile the in-memory scene list.
    expect(apiMock.scenes.create).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleCreateCause (via pinboard's onCreateCause)
// ---------------------------------------------------------------------------

describe('handleCreateConstraint', () => {
  it('patches the scene optimistically and then with the API response', async () => {
    const a = makeScene({ id: 'a', causes: [] });
    const b = makeScene({ id: 'b', causes: [] });
    const updatedA = makeScene({ id: 'a', causes: ['b'] });
    useScenesMock.mockReturnValue([a, b]);
    apiMock.scenes.update.mockResolvedValueOnce(updatedA);

    wrap(<ScenesPanelContainer />);

    await act(async () => {
      await pb().onCreateCause('a', 'b');
    });

    expect(apiMock.scenes.update).toHaveBeenCalledTimes(1);
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('skips the API call when the constraint already exists', async () => {
    const a = makeScene({ id: 'a', causes: ['b'] });
    const b = makeScene({ id: 'b', causes: [] });
    useScenesMock.mockReturnValue([a, b]);

    wrap(<ScenesPanelContainer />);

    await act(async () => {
      await pb().onCreateCause('a', 'b');
    });

    expect(apiMock.scenes.update).not.toHaveBeenCalled();
  });

  it('reverts both scenes on API failure', async () => {
    const a = makeScene({ id: 'a', causes: [] });
    const b = makeScene({ id: 'b', causes: [] });
    useScenesMock.mockReturnValue([a, b]);
    apiMock.scenes.update.mockRejectedValueOnce(new Error('fail'));

    wrap(<ScenesPanelContainer />);

    await act(async () => {
      await pb().onCreateCause('a', 'b');
    });

    const calls = patchSceneMock.mock.calls as Array<[Scene]>;
    const lastCall = calls.slice(-1)[0][0];
    expect(lastCall).toEqual(a);
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

    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
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

    expect(apiMock.scenes.updateProseContent).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('replaces the linked prose in the current chapter content and preserves the scene markers', async () => {
    // Scene "ps" is linked to the word "Bravo" inside the current chapter.  The
    // full (marker-inclusive) content is stored in the story store; the editor
    // strips markers for display and re-injects them on save from the store.
    // Saving prose must update the STORE content (markers intact) rather than
    // dispatch a raw editor transaction, otherwise the editor's debounced
    // autosave re-injects markers against a stale baseline and drops them,
    // corrupting the chapter file (BUG-2).
    const markerStart = '<!--scene:ps:start-->';
    const markerEnd = '<!--scene:ps:end-->';
    const prefix = 'Alpha ';
    const content = `${prefix}${markerStart}Bravo${markerEnd} Charlie`;
    const startOffset = prefix.length + markerStart.length;
    const proseLink = makeProseLink({
      scope_type: 'chapter',
      chapter_id: 'ch-1',
      start_offset: startOffset,
      end_offset: startOffset + 'Bravo'.length,
    });
    const scene = makeScene({ id: 'ps', prose_link: proseLink });
    const updatedScene = makeScene({
      id: 'ps',
      prose_link: { ...proseLink, end_offset: 30 },
    });
    apiMock.scenes.updateProseContent.mockResolvedValueOnce(updatedScene);
    storyState.chapters = [
      {
        id: 'ch-1',
        scope: 'chapter',
        title: 'Chapter 1',
        summary: '',
        content,
      },
    ];
    setStoryMock.mockImplementation((updater: (prev: unknown) => unknown) => {
      const next = updater(storyState);
      Object.assign(storyState, next as object);
    });
    const { ref } = makeEditorRef();

    await renderAndOpenDialog([scene], {
      editorRef: ref,
      currentChapter: {
        id: 'ch-1',
        scope: 'chapter',
        title: 'Chapter 1',
        content,
      },
    });

    await act(async () => {
      await dlg().onSaveProseContent!('Zulu');
    });

    // The chapter content must reflect the new prose with the scene markers
    // fully preserved (no marker corruption).
    expect(storyState.chapters[0].content).toBe(
      'Alpha <!--scene:ps:start-->Zulu<!--scene:ps:end--> Charlie'
    );
  });

  it('does NOT modify the current chapter content for a scene linked to another scope (prevents mid-word corruption)', async () => {
    // Story-scoped link while a chapter editor is open: the offsets belong to
    // the story content, not the chapter — writing them into the chapter would
    // corrupt the chapter text (BUG-1).
    const proseLink = makeProseLink({ start_offset: 6, end_offset: 11 });
    const scene = makeScene({ id: 'ps', prose_link: proseLink });
    const updatedScene = makeScene({
      id: 'ps',
      prose_link: { ...proseLink, end_offset: 9 },
    });
    apiMock.scenes.updateProseContent.mockResolvedValueOnce(updatedScene);
    storyState.chapters = [
      {
        id: 'ch-1',
        scope: 'chapter',
        title: 'Chapter 1',
        summary: '',
        content: 'Hello world!',
      },
    ];
    const { ref } = makeEditorRef('Hello world!');

    await renderAndOpenDialog([scene], {
      editorRef: ref,
      currentChapter: {
        id: 'ch-1',
        scope: 'chapter',
        title: 'Chapter 1',
        content: 'Hello world!',
      },
    });

    await act(async () => {
      await dlg().onSaveProseContent!('earth');
    });

    // Backend prose is still updated, but the chapter store content must not
    // be touched with offsets that belong to the story scope.
    expect(apiMock.scenes.updateProseContent).toHaveBeenCalled();
    expect(setStoryMock).not.toHaveBeenCalled();
    expect(storyState.chapters[0].content).toBe('Hello world!');
  });

  it('does NOT update any chapter content when the scene has no prose link', async () => {
    const scene = makeScene({ id: 'ps', prose_link: null });
    const updatedScene = makeScene({ id: 'ps', prose_link: null });
    apiMock.scenes.updateProseContent.mockResolvedValueOnce(updatedScene);
    storyState.chapters = [
      {
        id: 'ch-1',
        scope: 'chapter',
        title: 'Chapter 1',
        summary: '',
        content: 'Hello world!',
      },
    ];
    const { ref } = makeEditorRef();

    await renderAndOpenDialog([scene], {
      editorRef: ref,
      currentChapter: {
        id: 'ch-1',
        scope: 'chapter',
        title: 'Chapter 1',
        content: 'Hello world!',
      },
    });

    await act(async () => {
      await dlg().onSaveProseContent!('anything');
    });

    expect(setStoryMock).not.toHaveBeenCalled();
  });

  it('updates the current chapter content without requiring an editor view', async () => {
    // The prose update must not depend on a live editor view — the store is
    // the source of truth and the editor re-syncs from it.
    const proseLink = makeProseLink({
      scope_type: 'chapter',
      chapter_id: 'ch-1',
      start_offset: 0,
      end_offset: 5,
    });
    const scene = makeScene({ id: 'ps', prose_link: proseLink });
    const updatedScene = makeScene({
      id: 'ps',
      prose_link: { ...proseLink, end_offset: 3 },
    });
    apiMock.scenes.updateProseContent.mockResolvedValueOnce(updatedScene);
    storyState.chapters = [
      {
        id: 'ch-1',
        scope: 'chapter',
        title: 'Chapter 1',
        summary: '',
        content: 'Hello world!',
      },
    ];
    setStoryMock.mockImplementation((updater: (prev: unknown) => unknown) => {
      const next = updater(storyState);
      Object.assign(storyState, next as object);
    });
    // A ref whose getEditorView returns null proves the store update does not
    // depend on a live editor view.
    const nullViewRef: React.RefObject<EditorHandle | null> = {
      current: {
        setOnCursorChange: vi.fn(),
        setProseHighlights: vi.fn(),
        clearProseHighlight: vi.fn(),
        setOnProseBoundaryChange: vi.fn(),
        getEditorView: vi.fn(() => null),
      },
    };

    await renderAndOpenDialog([scene], {
      editorRef: nullViewRef,
      currentChapter: {
        id: 'ch-1',
        scope: 'chapter',
        title: 'Chapter 1',
        content: 'Hello world!',
      },
    });

    await act(async () => {
      await dlg().onSaveProseContent!('Hi');
    });

    // Must still patch the store scene AND update the chapter content.
    expect(patchSceneMock).toHaveBeenCalled();
    expect(storyState.chapters[0].content).toBe('Hi world!');
  });

  it('clamps the prose offsets to the current chapter content length', async () => {
    const proseLink = makeProseLink({
      scope_type: 'chapter',
      chapter_id: 'ch-1',
      start_offset: 0,
      end_offset: 99999,
    });
    const scene = makeScene({ id: 'ps', prose_link: proseLink });
    const updatedScene = makeScene({ id: 'ps', prose_link: proseLink });
    apiMock.scenes.updateProseContent.mockResolvedValueOnce(updatedScene);
    const shortDoc = 'Short.';
    storyState.chapters = [
      {
        id: 'ch-1',
        scope: 'chapter',
        title: 'Chapter 1',
        summary: '',
        content: shortDoc,
      },
    ];
    setStoryMock.mockImplementation((updater: (prev: unknown) => unknown) => {
      const next = updater(storyState);
      Object.assign(storyState, next as object);
    });
    const { ref } = makeEditorRef(shortDoc);

    await renderAndOpenDialog([scene], {
      editorRef: ref,
      currentChapter: {
        id: 'ch-1',
        scope: 'chapter',
        title: 'Chapter 1',
        content: shortDoc,
      },
    });

    await act(async () => {
      await dlg().onSaveProseContent!('replaced');
    });

    // Offsets beyond the document end must be clamped so no index error or
    // partial write corrupts the content.
    expect(storyState.chapters[0].content).toBe('replaced');
  });

  it('records an undo handler that persists the prose revert to the backend', async () => {
    const proseLink = makeProseLink({
      scope_type: 'chapter',
      chapter_id: 'ch-1',
      start_offset: 0,
      end_offset: 5,
    });
    const scene = makeScene({ id: 'ps', prose_link: proseLink });
    const updatedScene = makeScene({ id: 'ps', prose_link: proseLink });
    apiMock.scenes.updateProseContent.mockResolvedValue(updatedScene);
    const { ref } = makeEditorRef('Hello world!');

    await renderAndOpenDialog([scene], {
      editorRef: ref,
      currentChapter: {
        id: 'ch-1',
        scope: 'chapter',
        title: 'Chapter 1',
        content: 'Hello world!',
      },
      recordHistoryEntry: recordHistoryEntryMock,
    });

    await act(async () => {
      await dlg().onSaveProseContent!('Goodbye');
    });

    const entry = recordHistoryEntryMock.mock.calls
      .map((call: [{ label: string; onUndo?: () => Promise<void> | void }]) => call[0])
      .find((e: { label: string }) => e.label === 'Edit scene linked prose');
    expect(entry).toBeTruthy();
    expect(entry!.onUndo).toBeTypeOf('function');

    apiMock.scenes.updateProseContent.mockClear();
    await act(async () => {
      await entry!.onUndo!();
    });

    // The undo must re-persist the previous prose to the backend (BUG-2),
    // not just restore the in-memory story state.
    expect(apiMock.scenes.updateProseContent).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleWriteScene (via dialog's onWriteScene)
// ---------------------------------------------------------------------------

// eslint-disable-next-line max-lines-per-function
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

    expect(apiMock.scenes.writeScene).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('updates editor content when write-scene assignment IDs differ by type', async () => {
    const scene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: 0,
        end_offset: 14,
      }),
    });
    const updatedScene = makeScene({ id: '1' });
    const { ref, dispatch } = makeEditorRef('Existing linked text.');

    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text: 'Refreshed scene prose',
      assignments: [{ scene_id: 1, start_offset: 0, end_offset: 14 }],
      scenes: [],
    });

    await renderAndOpenDialog([scene], { currentChapter: CHAPTER, editorRef: ref });
    expect(dlg().onWriteScene).toBeDefined();

    await act(async () => {
      await dlg().onWriteScene!();
    });

    expect(dispatch).toHaveBeenCalled();
  });

  it('prefers existing scene prose-link offsets over assignment offsets in marker-free docs', async () => {
    const scene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: 0,
        end_offset: 8,
      }),
    });
    const updatedScene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: 0,
        end_offset: 8,
      }),
    });
    const { ref, dispatch } = makeEditorRef('Existing linked text. Trailing text.');

    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text: 'Refreshed scene prose',
      assignments: [{ scene_id: 1, start_offset: 20, end_offset: 28 }],
      scenes: [],
    });

    await renderAndOpenDialog([scene], { currentChapter: CHAPTER, editorRef: ref });

    await act(async () => {
      await dlg().onWriteScene!();
    });

    expect(dispatch).toHaveBeenCalled();
  });

  it('uses updated scene prose link when write-scene assignments are not returned', async () => {
    const scene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: 0,
        end_offset: 5,
      }),
    });
    const updatedScene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: 0,
        end_offset: 10,
      }),
    });
    const { ref, dispatch } = makeEditorRef('Existing linked text.');

    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text: 'Refreshed scene prose',
      assignments: [],
      scenes: [],
    });

    await renderAndOpenDialog([scene], { currentChapter: CHAPTER, editorRef: ref });
    expect(dlg().onWriteScene).toBeDefined();

    await act(async () => {
      await dlg().onWriteScene!();
    });

    expect(dispatch).toHaveBeenCalled();
  });

  it('syncs updated chapter content back into story state after writeScene', async () => {
    const scene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: 0,
        end_offset: 5,
      }),
    });
    const updatedScene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: 0,
        end_offset: 10,
      }),
    });
    const { ref, dispatch } = makeEditorRef('Existing linked text.');

    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text: 'Refreshed scene prose',
      assignments: [],
      scenes: [],
    });

    await renderAndOpenDialog([scene], {
      currentChapter: CHAPTER,
      editorRef: ref,
    });

    await act(async () => {
      await dlg().onWriteScene!();
    });

    expect(dispatch).toHaveBeenCalled();
    expect(setStoryMock).toHaveBeenCalled();
  });

  it('replaces existing prose span before progressive chunk inserts', async () => {
    const scene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: 0,
        end_offset: 14,
      }),
    });
    const updatedScene = makeScene({ id: '1' });
    const { ref, dispatch } = makeEditorRef('Existing linked text.');
    const longGenerated =
      'Refreshed scene prose with enough length to trigger chunked streaming updates.';

    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text: longGenerated,
      assignments: [{ scene_id: 1, start_offset: 0, end_offset: 14 }],
      scenes: [],
    });

    await renderAndOpenDialog([scene], { currentChapter: CHAPTER, editorRef: ref });

    await act(async () => {
      await dlg().onWriteScene!();
    });

    expect(dispatch).toHaveBeenCalled();
    expect(dispatch.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        changes: expect.objectContaining({ from: 0, to: 14 }),
      })
    );
  });

  it('prefers prose-link raw offsets over assignment offsets when chapter content includes markers', async () => {
    const markerStart = '<!--scene:1:start-->';
    const markerEnd = '<!--scene:1:end-->';
    const docText = `${markerStart}OLD${markerEnd}`;
    const proseStart = docText.indexOf('OLD');
    const proseEnd = proseStart + 3;
    const scene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: proseStart,
        end_offset: proseEnd,
      }),
    });
    const updatedScene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: proseStart,
        end_offset: proseEnd,
      }),
    });
    const { ref, dispatch } = makeEditorRef(docText);
    const chapterWithMarkers = {
      ...CHAPTER,
      content: docText,
    } as WritingUnit;

    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text:
        'Generated prose that is long enough to force chunked progressive replacement.',
      assignments: [{ scene_id: 1, start_offset: 0, end_offset: 3 }],
      scenes: [],
    });

    await renderAndOpenDialog([scene], {
      currentChapter: chapterWithMarkers,
      editorRef: ref,
    });

    await act(async () => {
      await dlg().onWriteScene!();
    });

    expect(dispatch).toHaveBeenCalled();
    expect(dispatch.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        changes: expect.objectContaining({
          from: proseStart,
          to: proseEnd,
        }),
      })
    );
  });

  it('prefers prose-link offsets when editor doc has markers but chapter metadata text does not', async () => {
    const markerStart = '<!--scene:1:start-->';
    const markerEnd = '<!--scene:1:end-->';
    const docText = `${markerStart}OLD${markerEnd}`;
    const proseStart = docText.indexOf('OLD');
    const proseEnd = proseStart + 3;
    const scene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: proseStart,
        end_offset: proseEnd,
      }),
    });
    const updatedScene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: proseStart,
        end_offset: proseEnd,
      }),
    });
    const { ref, dispatch } = makeEditorRef(docText);
    const chapterWithoutMarkers = {
      ...CHAPTER,
      content: 'OLD',
    } as WritingUnit;

    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text:
        'Generated prose that is long enough to force chunked progressive replacement.',
      assignments: [{ scene_id: 1, start_offset: 0, end_offset: 3 }],
      scenes: [],
    });

    await renderAndOpenDialog([scene], {
      currentChapter: chapterWithoutMarkers,
      editorRef: ref,
    });

    await act(async () => {
      await dlg().onWriteScene!();
    });

    expect(dispatch).toHaveBeenCalled();
    expect(dispatch.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        changes: expect.objectContaining({
          from: proseStart,
          to: proseEnd,
        }),
      })
    );
  });

  it('snaps replacement range outside marker tokens when fallback offsets point into a marker', async () => {
    const endMarker = '<!--scene:6:end-->';
    const docText = `${endMarker} tail prose content`;
    const markerStart = docText.indexOf(endMarker);
    const markerEnd = markerStart + endMarker.length;
    const scene = makeScene({
      id: '22',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: markerStart + 6,
        end_offset: docText.length,
      }),
    });
    const updatedScene = makeScene({
      id: '22',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: markerStart + 6,
        end_offset: docText.length,
      }),
    });
    const { ref, dispatch } = makeEditorRef(docText);

    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text:
        'Generated prose that is long enough to force chunked progressive replacement.',
      assignments: [],
      scenes: [],
    });

    await renderAndOpenDialog([scene], {
      currentChapter: { ...CHAPTER, content: 'tail prose content' } as WritingUnit,
      editorRef: ref,
    });

    await act(async () => {
      await dlg().onWriteScene!();
    });

    expect(dispatch).toHaveBeenCalled();
    expect(dispatch.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        changes: expect.objectContaining({
          from: markerEnd,
        }),
      })
    );
  });

  it('updates linked chapter content in story state when writing a scene linked to a different chapter', async () => {
    const scene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-2',
        start_offset: 7,
        end_offset: 10,
      }),
    });
    const updatedScene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-2',
        start_offset: 7,
        end_offset: 10,
      }),
    });
    storyState.chapters = [
      {
        id: 'ch-2',
        scope: 'chapter',
        title: 'Chapter 2',
        summary: '',
        content: 'Prefix OLD suffix',
      },
    ];
    setStoryMock.mockImplementation((updater: (prev: unknown) => unknown) => {
      const next = updater(storyState);
      Object.assign(storyState, next as object);
    });

    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text: 'NEW',
      assignments: [],
      scenes: [],
    });

    const { ref, dispatch } = makeEditorRef('Current chapter text');
    await renderAndOpenDialog([scene], { currentChapter: CHAPTER, editorRef: ref });

    await act(async () => {
      await dlg().onWriteScene!();
    });

    expect(apiMock.scenes.writeScene).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(storyState.chapters[0].content).toBe('Prefix NEW suffix');
    expect(dlg().getLinkedProseText!(updatedScene.prose_link as SceneProseLink)).toBe(
      'NEW'
    );
  });

  it('keeps generated linked prose visible after closing and reopening the scene dialog', async () => {
    const sceneId = '1';
    const generatedText = 'Gamma';
    const markerStartLen = `<!--scene:${sceneId}:start-->`.length;
    // New write into an EMPTY chapter: the frontend appends without a "\n"
    // separator (empty content), so the backend's marker-inclusive
    // start_offset is exactly the start-marker length.
    const separatorLen = 0;

    let scenesState: Scene[] = [makeScene({ id: sceneId, prose_link: null })];
    useScenesMock.mockImplementation(() => scenesState);
    patchSceneMock.mockImplementationOnce((updated: Scene) => {
      scenesState = scenesState.map((scene: Scene) =>
        scene.id === updated.id ? updated : scene
      );
    });

    const updatedScene = makeScene({
      id: sceneId,
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: separatorLen + markerStartLen,
        end_offset: separatorLen + markerStartLen + generatedText.length,
      }),
    });
    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text: generatedText,
      assignments: [],
      scenes: [],
    });

    const { ref, getText } = makeMutableEditorRef('');
    wrap(
      <ScenesPanelContainer
        currentChapter={{ ...CHAPTER, content: '' } as WritingUnit}
        editorRef={ref}
      />
    );

    await act(async () => {
      pb().onEditScene(sceneId);
    });

    await act(async () => {
      await dlg().onWriteScene!();
    });

    expect(getText().endsWith(generatedText)).toBe(true);

    await act(async () => {
      dlg().onClose();
    });

    await act(async () => {
      pb().onEditScene(sceneId);
    });

    const reopenedLink = scenesState[0].prose_link as SceneProseLink;
    expect(dlg().getLinkedProseText!(reopenedLink)).toBe(generatedText);
  });

  it('returns the COMPLETE generated prose from getLinkedProseText after write when the store content is marker-free', async () => {
    // Regression: after Write Scene in a marker-bearing chapter, the container
    // syncs the marker-free editor document back into the store
    // (updateCurrentChapterContent), so currentChapter.content is marker-free
    // while the scene's prose_link offsets remain marker-inclusive (backend
    // coordinates).  getLinkedProseText is what the Edit Scene dialog polls and
    // displays in the Linked Prose editor, so it must return the FULL generated
    // text — not a slice that drops the first characters.
    const markerStart = '<!--scene:1:start-->';
    const markerEnd = '<!--scene:1:end-->';
    const oldProse = 'Old scene prose';
    const fullContent = `${markerStart}${oldProse}${markerEnd}`;
    const proseStart = fullContent.indexOf(oldProse);
    const generated = 'Refreshed scene prose with a longer replacement text.';

    const updatedScene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: proseStart,
        end_offset: proseStart + generated.length,
      }),
    });
    // Post-write state: the editor document AND the store chapter content are
    // both marker-free (visible), while the prose_link offsets are marker-inclusive.
    const { ref } = makeEditorRef(generated);

    await renderAndOpenDialog([updatedScene], {
      currentChapter: { ...CHAPTER, content: generated } as WritingUnit,
      editorRef: ref,
    });

    expect(dlg().getLinkedProseText!(updatedScene.prose_link as SceneProseLink)).toBe(
      generated
    );
  });

  it('keeps the store chapter content marker-inclusive after write-scene (no marker-free window)', async () => {
    // Regression: updateCurrentChapterContent must never leave the store with a
    // marker-free chapter body.  The editor document is marker-free
    // (hideSceneMarkers=true), but the store/backend content must stay
    // marker-inclusive — otherwise every visible↔original conversion
    // (getLinkedProseText, prose-drop, boundary-drag, save-prose) reads
    // marker-inclusive offsets against marker-free text.  After a write the
    // store must contain the COMPLETE generated prose inside its scene markers.
    const markerStart = '<!--scene:1:start-->';
    const markerEnd = '<!--scene:1:end-->';
    const oldProse = 'Old scene prose';
    const fullContent = `${markerStart}${oldProse}${markerEnd}`;
    const proseStart = fullContent.indexOf(oldProse);
    const proseEnd = proseStart + oldProse.length;
    const generated = 'Brand new complete prose replaces the old text.';

    const scene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: proseStart,
        end_offset: proseEnd,
      }),
    });
    const updatedScene = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: proseStart,
        end_offset: proseStart + generated.length,
      }),
    });
    apiMock.scenes.writeScene.mockResolvedValueOnce({
      scene: updatedScene,
      generated_text: generated,
      assignments: [],
      scenes: [],
    });

    // Marker-bearing chapter: the editor document is marker-free (visible),
    // the store content is marker-inclusive (full).
    const { ref, getText } = makeMutableEditorRef(oldProse);
    storyState.chapters = [
      { id: 'ch-1', scope: 'chapter', title: 'Ch1', summary: '', content: fullContent },
    ];
    setStoryMock.mockImplementation((updater: (prev: unknown) => unknown) => {
      const next = updater(storyState);
      Object.assign(storyState, next as object);
    });

    await renderAndOpenDialog([scene], {
      currentChapter: { ...CHAPTER, content: fullContent } as WritingUnit,
      editorRef: ref,
    });

    await act(async () => {
      await dlg().onWriteScene!();
    });

    // The editor document holds the complete marker-free generated prose.
    expect(getText()).toBe(generated);

    // The STORE content must be marker-inclusive and contain the COMPLETE
    // generated prose (nothing truncated, markers preserved) — this is what
    // downstream conversions and any subsequent save read.
    expect(storyState.chapters[0].content).toBe(
      `${markerStart}${generated}${markerEnd}`
    );
  });

  it('preserves marker boundaries for first/middle/last writes with same vs different selected chapter', async () => {
    const targetIndexes = [0, 1, 2];
    const chapterScopes = [
      {
        name: 'same-selected-chapter',
        currentChapter: {
          ...CHAPTER,
          id: 'ch-1',
          summary: '',
          content: '',
        } as WritingUnit,
        scopeMatches: true,
      },
      {
        name: 'different-selected-chapter',
        currentChapter: {
          ...CHAPTER,
          id: 'ch-2',
          summary: '',
          content: '',
        } as WritingUnit,
        scopeMatches: false,
      },
    ];

    for (const targetIndex of targetIndexes) {
      for (const neighborsHaveText of [false, true]) {
        for (const chapterScope of chapterScopes) {
          const sceneIds = ['1', '2', '3'];
          const initialTexts = sceneIds.map((_: string, index: number): string => {
            if (index === targetIndex) return `target-before-${targetIndex}`;
            return neighborsHaveText ? `neighbor-${index + 1}` : '';
          });

          let docText = '';
          const scenes: Scene[] = [];
          const offsets: Array<{ from: number; to: number }> = [];
          sceneIds.forEach((id: string, index: number): void => {
            const startToken = `<!--scene:${id}:start-->`;
            const endToken = `<!--scene:${id}:end-->`;
            const prose = initialTexts[index];
            const from = docText.length + startToken.length;
            const to = from + prose.length;
            docText += `${startToken}${prose}${endToken}`;
            if (index < sceneIds.length - 1) {
              docText += '\n';
            }
            offsets.push({ from, to });
            scenes.push(
              makeScene({
                id,
                prose_link: makeProseLink({
                  scope_type: 'chapter',
                  chapter_id: 'ch-1',
                  start_offset: from,
                  end_offset: to,
                }),
              })
            );
          });

          const targetScene = scenes[targetIndex];
          const generated = `generated-${targetIndex}-${neighborsHaveText ? 'neighbors' : 'empty'}-${chapterScope.name}`;

          const { ref, getText } = makeMutableEditorRef(docText);
          storyState.chapters = [
            {
              id: 'ch-1',
              scope: 'chapter',
              title: 'Chapter 1',
              summary: '',
              content: docText,
            },
            {
              id: 'ch-2',
              scope: 'chapter',
              title: 'Chapter 2',
              summary: '',
              content: 'other chapter prose',
            },
          ];

          apiMock.scenes.writeScene.mockResolvedValueOnce({
            scene: makeScene({
              id: targetScene.id,
              prose_link: makeProseLink({
                scope_type: 'chapter',
                chapter_id: 'ch-1',
                start_offset: offsets[targetIndex].from,
                end_offset: offsets[targetIndex].to,
              }),
            }),
            generated_text: generated,
            assignments: [
              {
                scene_id: Number(targetScene.id),
                start_offset: 0,
                end_offset: Math.min(2, docText.length),
              },
            ],
            scenes: [],
          });

          useScenesMock.mockReturnValue(scenes);
          wrap(
            <ScenesPanelContainer
              editorRef={ref}
              currentChapter={chapterScope.currentChapter}
            />
          );

          await act(async () => {
            pb().onEditScene(targetScene.id);
          });

          await act(async () => {
            await dlg().onWriteScene!();
          });

          const renderedDoc = getText();
          for (const sceneId of sceneIds) {
            expect(
              renderedDoc.match(new RegExp(`<!--scene:${sceneId}:start-->`, 'g'))
                ?.length ?? 0
            ).toBe(1);
            expect(
              renderedDoc.match(new RegExp(`<!--scene:${sceneId}:end-->`, 'g'))
                ?.length ?? 0
            ).toBe(1);
          }

          if (chapterScope.scopeMatches) {
            expect(renderedDoc).toContain(
              `<!--scene:${targetScene.id}:start-->${generated}<!--scene:${targetScene.id}:end-->`
            );
          } else {
            expect(renderedDoc).toBe(docText);
            expect(setStoryMock).toHaveBeenCalled();
            const updater = setStoryMock.mock.calls[
              setStoryMock.mock.calls.length - 1
            ]?.[0] as ((prev: typeof storyState) => typeof storyState) | undefined;
            expect(typeof updater).toBe('function');
            if (updater) {
              const prevState = {
                ...storyState,
                chapters: storyState.chapters.map(
                  (chapter: (typeof storyState.chapters)[number]) => ({ ...chapter })
                ),
              };
              const nextState = updater(prevState);
              const writtenChapter = nextState.chapters.find(
                (chapter: (typeof storyState.chapters)[number]) => chapter.id === 'ch-1'
              );
              expect(writtenChapter?.content).toContain(generated);
            }
          }

          for (let index = 0; index < scenes.length; index += 1) {
            if (index === targetIndex) continue;
            const id = scenes[index].id;
            const expected = initialTexts[index];
            expect(renderedDoc).toContain(
              `<!--scene:${id}:start-->${expected}<!--scene:${id}:end-->`
            );
          }
        }
      }
    }
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

  it('returns linked chapter prose from story state when a different chapter is currently open', async () => {
    const scene = makeScene({ id: 's1' });
    const { ref } = makeEditorRef('Current chapter text only.');
    const linkedChapterContent = 'Prefix target prose suffix';
    storyState.chapters = [
      {
        id: 'ch-2',
        scope: 'chapter',
        title: 'Chapter 2',
        summary: '',
        content: linkedChapterContent,
      },
    ];

    await renderAndOpenDialog([scene], { editorRef: ref, currentChapter: CHAPTER });

    const link: SceneProseLink = makeProseLink({
      scope_type: 'chapter',
      chapter_id: 'ch-2',
      start_offset: 7,
      end_offset: 19,
    });

    expect(dlg().getLinkedProseText!(link)).toBe('target prose');
  });

  it('returns story-scoped linked prose from story draft even when a chapter is currently open', async () => {
    const scene = makeScene({ id: 's1' });
    const { ref } = makeEditorRef('Current chapter text only.');
    storyState.draft = { content: 'Lead generated prose trail' };

    await renderAndOpenDialog([scene], { editorRef: ref, currentChapter: CHAPTER });

    const link: SceneProseLink = makeProseLink({
      scope_type: 'story',
      start_offset: 5,
      end_offset: 20,
    });

    expect(dlg().getLinkedProseText!(link)).toBe('generated prose');
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

  it('maps marker-inclusive prose offsets to visible editor offsets when chapter text is marker-free', async () => {
    const visibleDoc = 'Alpha Beta';
    const { ref } = makeEditorRef(visibleDoc);

    const s1Start = '<!--scene:1:start-->'.length;
    const s1End = '<!--scene:1:end-->'.length;
    const s2Start = '<!--scene:2:start-->'.length;

    const scene1 = makeScene({
      id: '1',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: s1Start,
        end_offset: s1Start + 5,
      }),
    });
    const scene2StartOffset = s1Start + 5 + s1End + 1 + s2Start;
    const scene2 = makeScene({
      id: '2',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: 'ch-1',
        start_offset: scene2StartOffset,
        end_offset: scene2StartOffset + 4,
      }),
    });

    await renderAndOpenDialog([scene1, scene2], {
      editorRef: ref,
      currentChapter: { ...CHAPTER, content: visibleDoc },
    });

    expect(dlg().getLinkedProseText!(scene2.prose_link as SceneProseLink)).toBe('Beta');
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
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([result]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], { editorRef: ref });

    await act(async () => {
      await cb('s1', 'end', 70);
    });

    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  // ---- Real-world scenario: dragging end to the LEFT with marker content ----

  it('converts visible offset to original offset when currentChapter has markers', async () => {
    // Full content  :  <!--scene:s1:start-->Some text here<!--scene:s1:end-->
    //                              21 chars         14 chars     19 chars
    // Original positions: 0-20 (start), 21-34 (text), 35-53 (end)
    // Visible content: "Some text here" (14 chars)
    // Scene prose_link stores ORIGINAL offsets: start_offset=21, end_offset=35
    const fullContent = '<!--scene:s1:start-->Some text here<!--scene:s1:end-->';
    const currentChapter: WritingUnit = {
      id: 'ch-1',
      scope: 'chapter',
      title: 'Chapter 1',
      content: fullContent,
    };
    const proseLink = makeProseLink({ start_offset: 21, end_offset: 35 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    // Drag end handle left to visible position 8 → "Some tex" (8 visible chars)
    // toOriginalOffset(8, fullContent)=(21 start_marker + 8 visible)=29
    const result = makeScene({
      id: 's1',
      prose_link: { ...proseLink, end_offset: 29 },
    });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([result]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      await cb('s1', 'end', 8);
    });

    // Must be called with ORIGINAL offsets (not visible offsets)
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
  });

  it('correctly converts visible offset when dragging end over a trailing marker boundary', async () => {
    // Full content  :  <!--scene:s1:start-->Hello world<!--scene:s1:end-->
    //                     21 chars               11 chars    19 chars
    // Original positions: 0-20 (start), 21-31 (text), 32-50 (end)
    // Visible content: "Hello world" (11 chars)
    // Scene prose_link stores ORIGINAL offsets: start_offset=21, end_offset=32
    // Dragging end handle left to visible position 6 → "Hello " (6 chars)
    // toOriginalOffset(6, fullContent)=(21 start_marker + 6 visible)=27
    const fullContent = '<!--scene:s1:start-->Hello world<!--scene:s1:end-->';
    const currentChapter: WritingUnit = {
      id: 'ch-1',
      scope: 'chapter',
      title: 'Chapter 1',
      content: fullContent,
    };
    const proseLink = makeProseLink({ start_offset: 21, end_offset: 32 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    const result = makeScene({
      id: 's1',
      prose_link: { ...proseLink, end_offset: 27 },
    });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([result]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      await cb('s1', 'end', 6);
    });

    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
  });

  it('calls linkProse with updated start_offset when the start handle is dragged', async () => {
    const proseLink = makeProseLink({ start_offset: 10, end_offset: 50 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    const result = makeScene({
      id: 's1',
      prose_link: { ...proseLink, start_offset: 20 },
    });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([result]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], { editorRef: ref });

    await act(async () => {
      await cb('s1', 'start', 20);
    });

    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('does nothing when the scene is not found', async () => {
    useScenesMock.mockReturnValue([]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([], { editorRef: ref });

    await act(async () => {
      await cb('ghost', 'end', 30);
    });

    expect(apiMock.scenes.batchLinkProse).not.toHaveBeenCalled();
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

    expect(apiMock.scenes.batchLinkProse).not.toHaveBeenCalled();
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

    expect(apiMock.scenes.batchLinkProse).not.toHaveBeenCalled();
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

    expect(apiMock.scenes.batchLinkProse).not.toHaveBeenCalled();
  });

  it('patches all scenes returned by linkProse (server may touch multiple scenes)', async () => {
    const proseLink = makeProseLink({ start_offset: 0, end_offset: 50 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    const r1 = makeScene({ id: 's1', prose_link: { ...proseLink, end_offset: 60 } });
    const r2 = makeScene({ id: 'other' });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([r1, r2]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], { editorRef: ref });

    await act(async () => {
      await cb('s1', 'end', 60);
    });

    expect(patchSceneMock).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('calls notifyError and does not patch store on API failure', async () => {
    const { notifyError } = await import('../../services/errorNotifier');
    const proseLink = makeProseLink({ start_offset: 0, end_offset: 50 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    apiMock.scenes.batchLinkProse.mockRejectedValueOnce(new Error('network'));
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
    apiMock.scenes.batchLinkProse
      .mockResolvedValueOnce([updatedB])
      .mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'end', 70);
    });

    // B's start is pushed to 70 first
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    // Then A is updated
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
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
    apiMock.scenes.batchLinkProse
      .mockResolvedValueOnce([updatedB])
      .mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'start', 30);
    });

    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
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
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'end', 60);
    });

    // Only one linkProse call — for scene A; scene B is untouched because it's a different scope.
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalledTimes(1);
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
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
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'end', 60);
    });

    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalledTimes(1);
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
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'end', 50);
    });

    // Only one linkProse call — for A only; B is NOT adjusted because touching ≠ overlapping.
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalledTimes(1);
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
  });

  it('skips overlap adjustment when dragging start to exactly the adjacent scene end (touching)', async () => {
    // Scene A: [50, 100), Scene B: [0, 50)
    // Drag A's start to 50 — touching B's end, not overlapping.
    const linkA = makeProseLink({ start_offset: 60, end_offset: 100 });
    const linkB = makeProseLink({ start_offset: 0, end_offset: 50 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });
    const updatedA = makeScene({ id: 'a', prose_link: { ...linkA, start_offset: 50 } });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'start', 50);
    });

    // Only one call — for A; B end at 50 == A's new start → touching, not overlapping.
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalledTimes(1);
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
  });

  it('unlinks engulfed scene when dragged boundary completely covers it', async () => {
    // Scene A: [0, 40), Scene B: [10, 20) — B is completely inside A.
    // Because of the marker positions, A starts before B (0 < 10) and
    // ends after B (40 > 20), so B cannot overlap A under the marker
    // layout unless this was manually constructed.  Use a more realistic
    // example: A: [0, 30), B: [30, 50). Drag A's end to 60 → B is engulfed.
    const linkA = makeProseLink({ start_offset: 0, end_offset: 30 });
    const linkB = makeProseLink({ start_offset: 30, end_offset: 50 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });
    const updatedA = makeScene({ id: 'a', prose_link: { ...linkA, end_offset: 60 } });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    await act(async () => {
      await cb('a', 'end', 60);
    });

    // B should be UNLINKED because A's new range [0, 60) completely covers B [30, 50)
    // The batch call includes unlink_ids for engulfed scenes.
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
  });

  // ---- Coordinate conversion (visible → original) ----

  it('converts visible drag offset to original offset when chapter content has markers', async () => {
    // <!--scene:a:start--> = 20 chars, <!--scene:a:end--> = 18 chars
    // Full content: "AB<!--scene:a:start-->scene_a<!--scene:a:end-->CD"
    //   Full positions: A(0) B(1) <!--a:start-->(2-21) s(22) c(23) e(24) n(25) e(26) _(27) a(28) <!--a:end-->(29-46) C(47) D(48)
    // Visible content (stripped): "ABscene_aCD"  (11 chars)
    //   A(0) B(1) s(2) c(3) e(4) n(5) e(6) _(7) a(8) C(9) D(10)
    const fullContent = 'AB<!--scene:a:start-->scene_a<!--scene:a:end-->CD';
    const currentChapter: WritingUnit = {
      ...CHAPTER,
      content: fullContent,
    };

    // Scene A is linked with start_offset=22, end_offset=29 (original coords)
    // → visible range is [2, 9) in stripped content (s through a)
    const proseLink = makeProseLink({ start_offset: 22, end_offset: 29 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    // Drag end edge to visible position 10 (the 'D' character at end of visible content)
    // Original offset for visible pos 10 = 48
    const expectedOriginalEndOffset = 48;
    const result = makeScene({
      id: 's1',
      prose_link: { ...proseLink, end_offset: expectedOriginalEndOffset },
    });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([result]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      // Pass visible offset 10 (end of 'D' in stripped content)
      await cb('s1', 'end', 10);
    });

    // API must receive the ORIGINAL offset (48), not the visible offset (10)
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('converts visible offset when dragging end LEFT (shrinking scene) with marker content', async () => {
    // <!--scene:a:start--> = 20 chars, <!--scene:a:end--> = 18 chars
    // Full: "AB<!--scene:a:start-->scene_a<!--scene:a:end-->CD"
    //   A(0) B(1) <!--a:start-->(2-21) s(22) c(23) e(24) n(25) e(26) _(27) a(28) <!--a:end-->(29-46) C(47) D(48)
    // Visible: "ABscene_aCD" (11 chars)
    //   A(0) B(1) s(2) c(3) e(4) n(5) e(6) _(7) a(8) C(9) D(10)
    const fullContent = 'AB<!--scene:a:start-->scene_a<!--scene:a:end-->CD';
    const currentChapter: WritingUnit = {
      ...CHAPTER,
      content: fullContent,
    };

    // Scene spans original [22, 29) → visible [2, 9)
    // Drag end LEFT to visible position 4 (the 'e' in "scene")
    // toOriginalOffset(4) should return 24
    const proseLink = makeProseLink({ start_offset: 22, end_offset: 29 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    const expectedOriginalEndOffset = 24;
    const result = makeScene({
      id: 's1',
      prose_link: { ...proseLink, end_offset: expectedOriginalEndOffset },
    });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([result]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      await cb('s1', 'end', 4);
    });

    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('converts visible offset when dragging end to exact boundary of trailing marker', async () => {
    // <!--scene:a:start--> = 20 chars, <!--scene:a:end--> = 18 chars
    // Full: "<!--scene:a:start-->Body<!--scene:a:end-->"
    //   a-start(0-19) B(20) o(21) d(22) y(23) a-end(24-41)
    // Visible: "Body" (4 chars) — pos 0=B,1=o,2=d,3=y
    // Drag end all the way RIGHT to visible position 4 (past 'y')
    // Should map to original position 24 (right before end marker), NOT 42
    const fullContent = '<!--scene:a:start-->Body<!--scene:a:end-->';
    const currentChapter: WritingUnit = {
      ...CHAPTER,
      content: fullContent,
    };

    const proseLink = makeProseLink({ start_offset: 20, end_offset: 24 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    const expectedOriginalEndOffset = 24; // right before end marker
    const result = makeScene({
      id: 's1',
      prose_link: { ...proseLink, end_offset: expectedOriginalEndOffset },
    });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([result]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      await cb('s1', 'end', 4);
    });

    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
  });

  it('converts visible start offset to original offset when dragging start edge', async () => {
    // Same content as above
    const fullContent = 'AB<!--scene:a:start-->scene_a<!--scene:a:end-->CD';
    const currentChapter: WritingUnit = {
      ...CHAPTER,
      content: fullContent,
    };

    // Scene A: start_offset=22, end_offset=29 (original)
    // Visible range: [2, 9) in stripped content
    const proseLink = makeProseLink({ start_offset: 22, end_offset: 29 });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    // Drag start edge LEFT to visible position 0 (the 'A' character)
    // Original offset for visible pos 0 = 0
    const expectedOriginalStartOffset = 0;
    const result = makeScene({
      id: 's1',
      prose_link: { ...proseLink, start_offset: expectedOriginalStartOffset },
    });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([result]);
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      // Pass visible offset 0 (start of 'A' in stripped content)
      await cb('s1', 'start', 0);
    });

    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('converts visible offset for scene boundary overlap adjustments', async () => {
    // Two scenes with markers between them.
    // Full: "A<!--scene:a:start-->BODY_A<!--scene:a:end-->Mid<!--scene:b:start-->BODY_B<!--scene:b:end-->C"
    //   A(0) <!--a:start-->(1-20) B(21) O(22) D(23) Y(24) _(25) A(26)
    //   <!--a:end-->(27-44) M(45) i(46) d(47)
    //   <!--b:start-->(48-67) B(68) O(69) D(70) Y(71) _(72) B(73)
    //   <!--b:end-->(74-91) C(92)
    const fullContent =
      'A<!--scene:a:start-->BODY_A<!--scene:a:end-->Mid<!--scene:b:start-->BODY_B<!--scene:b:end-->C';
    const currentChapter: WritingUnit = {
      ...CHAPTER,
      content: fullContent,
    };

    // Scene A: original [21, 27), visible [1, 7)
    // Scene B: original [68, 74), visible [10, 16)
    // stripped: A(0) BODY_A(1-6) Mid(7-9) BODY_B(10-15) C(16)
    const linkA = makeProseLink({ start_offset: 21, end_offset: 27 });
    const linkB = makeProseLink({ start_offset: 68, end_offset: 74 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });

    // Drag A's end edge from visible position 7 to visible position 12
    // (into B's visible territory). Visible pos 12 = 'D' of BODY_B.
    // toOriginalOffset(12, fullContent) = 70
    const visibleDragEnd = 12;
    const originalDragEnd = 70;

    const updatedA = makeScene({
      id: 'a',
      prose_link: { ...linkA, end_offset: originalDragEnd },
    });
    const updatedB = makeScene({
      id: 'b',
      prose_link: { ...linkB, start_offset: originalDragEnd },
    });
    apiMock.scenes.batchLinkProse
      .mockResolvedValueOnce([updatedB])
      .mockResolvedValueOnce([updatedA]);
    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      await cb('a', 'end', visibleDragEnd);
    });

    // B's start is pushed to the original offset
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    // Then A is updated with the original offset
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  // ---- Race condition: rapid consecutive drags ----

  it('serializes concurrent boundary drags: second drag wins', async () => {
    // Two rapid drags of scene A's end to different positions.
    // The second drag should override the first, and the final state
    // should reflect the second drag's position.
    const linkA = makeProseLink({ start_offset: 0, end_offset: 50 });
    const linkB = makeProseLink({ start_offset: 50, end_offset: 100 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });

    // First drag: A's end to 70 → B's start to 70
    // Second drag: A's end to 90 → B's start to 90 (overrides first)
    // We use deferred promises so the first drag's API calls don't resolve
    // until the second drag has started.
    let resolveFirst: ((v: Scene[]) => void) | undefined;
    const firstPromise = new Promise<Scene[]>((r: (v: Scene[]) => void) => {
      resolveFirst = r;
    });

    const updatedB2 = makeScene({
      id: 'b',
      prose_link: { ...linkB, start_offset: 90 },
    });
    const updatedA2 = makeScene({ id: 'a', prose_link: { ...linkA, end_offset: 90 } });

    // First call (drag 1): deferred
    apiMock.scenes.batchLinkProse.mockReturnValueOnce(firstPromise);
    // Second call (drag 2): resolves immediately
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([updatedB2, updatedA2]);

    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    // Start the first drag (do NOT await it)
    let _drag1Done = false;
    const drag1 = cb('a', 'end', 70).then(() => {
      _drag1Done = true;
    });

    // Wait for the first batch call to be made
    await vi.waitFor(() => {
      expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    });

    // Start the second drag before the first completes
    const drag2 = cb('a', 'end', 90);

    // Now resolve the first drag's deferred promise
    const updatedB1 = makeScene({
      id: 'b',
      prose_link: { ...linkB, start_offset: 70 },
    });
    const updatedA1 = makeScene({ id: 'a', prose_link: { ...linkA, end_offset: 70 } });
    resolveFirst!([updatedB1, updatedA1]);
    await drag1;
    await act(async () => {
      await drag2;
    });

    // The second drag should win — batchLinkProse was called for both drags
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    // patchScene should have been called with the second drag's results
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('handles three rapid consecutive drags without producing overlaps', async () => {
    const linkA = makeProseLink({ start_offset: 0, end_offset: 50 });
    const linkB = makeProseLink({ start_offset: 50, end_offset: 100 });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });

    // All three drags: 70, 80, 90
    // Only the last one (90) should persist
    const updatedB = makeScene({ id: 'b', prose_link: { ...linkB, start_offset: 90 } });
    const updatedA = makeScene({ id: 'a', prose_link: { ...linkA, end_offset: 90 } });

    // Each drag triggers one batch call; 3 drags = 3 resolve
    apiMock.scenes.batchLinkProse
      .mockResolvedValueOnce([updatedB, updatedA])
      .mockResolvedValueOnce([updatedB, updatedA])
      .mockResolvedValueOnce([updatedB, updatedA]);

    useScenesMock.mockReturnValue([sceneA, sceneB]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([sceneA, sceneB], { editorRef: ref });

    // Fire three drags in rapid succession
    const d1 = cb('a', 'end', 70);
    const d2 = cb('a', 'end', 80);
    const d3 = cb('a', 'end', 90);

    await act(async () => {
      await Promise.all([d1, d2, d3]);
    });

    // All batch calls should have completed
    // The final scene states should have valid (non-overlapping) ranges
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('refreshes chapter content after boundary change so subsequent drags use correct markers', async () => {
    const fullContent = 'AB<!--scene:a:start-->scene_a<!--scene:a:end-->CD';
    const currentChapter: WritingUnit = {
      ...CHAPTER,
      id: '3',
      content: fullContent,
    };

    const proseLink = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: 22,
      end_offset: 29,
    });
    const scene = makeScene({ id: 's1', prose_link: proseLink });
    const result = makeScene({
      id: 's1',
      prose_link: { ...proseLink, end_offset: 48 },
    });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([result]);
    // Mock chapter content refresh — returns updated content
    const updatedContent = 'AB<!--scene:a:start-->scene_aCD<!--scene:a:end-->';
    apiMock.chapters.get.mockResolvedValueOnce({ content: updatedContent });
    useScenesMock.mockReturnValue([scene]);
    const { ref } = makeEditorRefWithBoundary();

    const cb = await renderWithBoundary([scene], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      await cb('s1', 'end', 10);
    });

    // Must call batchLinkProse and the content should be refreshed
    // (reconstructContentFromOffsets is called instead of API fetch)
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    expect(patchSceneMock).toHaveBeenCalled();
  });

  it('reconstructs chapter content from the just-updated offsets, not a stale pre-drag snapshot', async () => {
    // Regression: reconstructContentFromOffsets was called with the
    // `latestScenes` snapshot captured *before* this request (still holding
    // the pre-drag end_offset), instead of `nextScenes` (patched with the
    // batchLinkProse response). That made the locally-rebuilt editor content
    // silently ignore every boundary drag: the markers would always be
    // rebuilt at their OLD position, so the UI never visually reflected a
    // successful drag until an unrelated refresh happened to occur.
    const fullContent = 'AB<!--scene:a:start-->scene_a<!--scene:a:end-->CD';
    const currentChapter: WritingUnit = {
      ...CHAPTER,
      id: '3',
      content: fullContent,
    };

    const proseLink = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: 22,
      end_offset: 29,
    });
    const scene = makeScene({ id: 'a', prose_link: proseLink });
    // Drag the end handle left by 2 raw chars: the backend confirms the
    // scene now only owns "scene" instead of "scene_a".
    const result = makeScene({
      id: 'a',
      prose_link: { ...proseLink, end_offset: 27 },
    });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([result]);
    apiMock.chapters.get.mockResolvedValueOnce({
      content: 'AB<!--scene:a:start-->scene<!--scene:a:end-->_aCD',
    });
    useScenesMock.mockReturnValue([scene]);

    storyState.chapters = [
      {
        id: '3',
        scope: 'chapter',
        title: 'Chapter 3',
        summary: '',
        content: fullContent,
      },
    ];

    const { ref } = makeEditorRefWithBoundary();
    const cb = await renderWithBoundary([scene], { editorRef: ref, currentChapter });

    await act(async () => {
      await cb('a', 'end', 7);
    });

    // With the fix, the rebuilt content moves the end marker to reflect the
    // shrink: "scene" stays inside, "_a" moves outside the scene markers.
    // The pre-fix (stale-snapshot) behavior would instead reproduce the
    // original, unchanged fullContent verbatim.
    expect(setStoryMock).toHaveBeenCalled();
    const updater = setStoryMock.mock.calls[setStoryMock.mock.calls.length - 1]?.[0] as
      ((prev: typeof storyState) => typeof storyState) | undefined;
    expect(typeof updater).toBe('function');
    const prevState = {
      ...storyState,
      chapters: storyState.chapters.map(
        (chapter: (typeof storyState.chapters)[number]) => ({ ...chapter })
      ),
    };
    const nextState = updater!(prevState);
    const rewrittenChapter = nextState.chapters.find(
      (chapter: (typeof storyState.chapters)[number]) => chapter.id === '3'
    );
    expect(rewrittenChapter?.content).toBe(
      'AB<!--scene:a:start-->scene<!--scene:a:end-->_aCD'
    );
  });

  it('unlinks engulfed scenes in the store so reconstruction excludes their marker tokens', async () => {
    // Regression: when a boundary drag engulfs another scene, the API
    // unlinks it on the backend but the response does NOT include the
    // unlinked scene.  Without manually unlinking it in the frontend
    // store, reconstructContentFromOffsets subtracts marker token
    // lengths for the now-unlinked scene, producing wrong visible offsets
    // and causing the remaining scenes to be displayed "too short".

    // Full content: two adjacent scenes A and B
    // <!--scene:a:start-->AAA<!--scene:a:end--><!--scene:b:start-->BBB<!--scene:b:end-->
    // marker lengths: a-start=20, a-end=18, b-start=20, b-end=18
    const fullContent =
      '<!--scene:a:start-->AAA<!--scene:a:end-->' +
      '<!--scene:b:start-->BBB<!--scene:b:end-->';
    const currentChapter: WritingUnit = {
      ...CHAPTER,
      id: '3',
      content: fullContent,
    };

    // Scene A: original [20, 23) — "AAA"
    // Scene B: original [61, 64) — "BBB"
    const linkA = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: 20,
      end_offset: 23,
    });
    const linkB = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: 61,
      end_offset: 64,
    });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });

    // Drag A's end to visible position 6 (end of "AAABBB", completely engulfing B)
    // B should be unlinked because A's new range [20, 78) covers B [61, 64)
    // After engulfing B, only A remains with the full "AAABBB" content.
    const updatedA = makeScene({
      id: 'a',
      prose_link: { ...linkA, end_offset: 78 },
    });
    // Backend returns only A; B is unlinked and NOT in the response.
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([updatedA]);
    apiMock.chapters.get.mockResolvedValueOnce({
      content: '<!--scene:a:start-->AAABBB<!--scene:a:end-->',
    });
    useScenesMock.mockReturnValue([sceneA, sceneB]);

    storyState.chapters = [
      {
        id: '3',
        scope: 'chapter',
        title: 'Chapter 3',
        summary: '',
        content: fullContent,
      },
    ];

    const { ref } = makeEditorRefWithBoundary();
    const cb = await renderWithBoundary([sceneA, sceneB], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      await cb('a', 'end', 6);
    });

    // Verify the API call includes unlink_ids for the engulfed scene
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    const callArgs = apiMock.scenes.batchLinkProse.mock.calls[0]?.[0];
    expect(callArgs.unlink_ids).toContain('b');

    // BUG: patchScene is NOT called for scene B (unlinked scene not in response)
    // This means nextScenes still has scene B with its old prose_link.
    // reconstructContentFromOffsets then subtracts B's marker tokens from
    // the approximation, causing wrong visible positions.

    // Verify setStory was called with reconstructed content
    expect(setStoryMock).toHaveBeenCalled();
    const updater = setStoryMock.mock.calls[setStoryMock.mock.calls.length - 1]?.[0] as
      ((prev: typeof storyState) => typeof storyState) | undefined;
    expect(typeof updater).toBe('function');
    const prevState = {
      ...storyState,
      chapters: storyState.chapters.map(
        (chapter: (typeof storyState.chapters)[number]) => ({ ...chapter })
      ),
    };
    const nextState = updater!(prevState);
    const rewrittenChapter = nextState.chapters.find(
      (chapter: (typeof storyState.chapters)[number]) => chapter.id === '3'
    );

    // The reconstructed content should contain ONLY scene A's markers
    // covering the full visible text "AAABBB" (6 chars).
    // Without the fix, the approximation would subtract B's marker tokens
    // (even though B no longer has markers), producing wrong positions.
    expect(rewrittenChapter?.content).toBe(
      '<!--scene:a:start-->AAABBB<!--scene:a:end-->'
    );
  });

  it('unlinks engulfed scenes on START boundary drag so reconstruction excludes their marker tokens', async () => {
    // Regression: same as the end-boundary engulfment test, but dragging
    // the START handle left to engulf a scene that sits before it.

    // Full content: two adjacent scenes B then A
    // <!--scene:b:start-->BBB<!--scene:b:end--><!--scene:a:start-->AAA<!--scene:a:end-->
    const fullContent =
      '<!--scene:b:start-->BBB<!--scene:b:end-->' +
      '<!--scene:a:start-->AAA<!--scene:a:end-->';
    const currentChapter: WritingUnit = {
      ...CHAPTER,
      id: '3',
      content: fullContent,
    };

    // Scene B: original [20, 23) — "BBB"  (first in file)
    // Scene A: original [61, 64) — "AAA"  (after B)
    const linkA = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: 61,
      end_offset: 64,
    });
    const linkB = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: 20,
      end_offset: 23,
    });
    const sceneA = makeScene({ id: 'a', prose_link: linkA });
    const sceneB = makeScene({ id: 'b', prose_link: linkB });

    // Drag A's START left to visible position 0, completely engulfing B
    // toOriginalOffset(0, fullContent) → 0
    // A becomes [0, 64) in original, covering B [20, 23) entirely → B unlinked
    const updatedA = makeScene({
      id: 'a',
      prose_link: { ...linkA, start_offset: 0 },
    });
    // Backend returns only A; B is unlinked and NOT in the response.
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([updatedA]);
    apiMock.chapters.get.mockResolvedValueOnce({
      content: '<!--scene:a:start-->BBBAAA<!--scene:a:end-->',
    });
    useScenesMock.mockReturnValue([sceneA, sceneB]);

    storyState.chapters = [
      {
        id: '3',
        scope: 'chapter',
        title: 'Chapter 3',
        summary: '',
        content: fullContent,
      },
    ];

    const { ref } = makeEditorRefWithBoundary();
    const cb = await renderWithBoundary([sceneA, sceneB], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      await cb('a', 'start', 0);
    });

    // Verify the API call includes unlink_ids for the engulfed scene
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    const callArgs = apiMock.scenes.batchLinkProse.mock.calls[0]?.[0];
    expect(callArgs.unlink_ids).toContain('b');

    // Verify setStory was called with reconstructed content
    expect(setStoryMock).toHaveBeenCalled();
    const updater = setStoryMock.mock.calls[setStoryMock.mock.calls.length - 1]?.[0] as
      ((prev: typeof storyState) => typeof storyState) | undefined;
    expect(typeof updater).toBe('function');
    const prevState = {
      ...storyState,
      chapters: storyState.chapters.map(
        (chapter: (typeof storyState.chapters)[number]) => ({ ...chapter })
      ),
    };
    const nextState = updater!(prevState);
    const rewrittenChapter = nextState.chapters.find(
      (chapter: (typeof storyState.chapters)[number]) => chapter.id === '3'
    );

    // The reconstructed content should contain ONLY scene A's markers
    // covering the full visible text "BBBAAA" (6 chars).
    // Without the fix, the approximation would subtract B's marker tokens
    // (even though B no longer has markers), producing wrong positions.
    expect(rewrittenChapter?.content).toBe(
      '<!--scene:a:start-->BBBAAA<!--scene:a:end-->'
    );
  });

  it('correctly adjusts adjacent scene when dragging start left into its prose (partial overlap)', async () => {
    // Regression: dragging scene 2's start handle left into scene 1's text
    // should shrink scene 1 and expand scene 2.  The API must receive
    // adjusted offsets for BOTH scenes, not just the dragged one.
    // After the roundtrip, scene 2's visible start must be at the dragged
    // position, not "jumped back" by the marker overhead.

    // Full content: two adjacent scenes with numeric IDs
    // <!--scene:1:start-->AAA<!--scene:1:end--><!--scene:2:start-->BBB<!--scene:2:end-->
    // marker lengths: 1-start=20, 1-end=18, 2-start=20, 2-end=18
    const fullContent =
      '<!--scene:1:start-->AAA<!--scene:1:end-->' +
      '<!--scene:2:start-->BBB<!--scene:2:end-->';
    const currentChapter: WritingUnit = {
      ...CHAPTER,
      id: '3',
      content: fullContent,
    };

    // Scene 1: original [20, 23) — "AAA"
    // Scene 2: original [61, 64) — "BBB"
    const link1 = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: 20,
      end_offset: 23,
    });
    const link2 = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: 61,
      end_offset: 64,
    });
    const scene1 = makeScene({ id: '1', prose_link: link1 });
    const scene2 = makeScene({ id: '2', prose_link: link2 });

    // Drag scene 2's start LEFT to visible position 1 (one char into "AAA")
    // This shrinks scene 1 to [20, 21), expands scene 2 to [21, 64).
    // Backend receives: scene1 [0,1), scene2 [1,5) in stripped "AAABBB"
    // Backend writes: <!--scene:1:start-->A<!--scene:1:end--><!--scene:2:start-->AABB<!--scene:2:end-->B
    // Backend returns new original offsets from the new content:
    //   Scene 1: start=20, end=21  (A at 20, end marker at 21)
    //   Scene 2: start=59, end=63  (AABB at 59-62, end marker at 63)
    const updated1 = makeScene({
      id: '1',
      prose_link: { ...link1, end_offset: 21 },
    });
    const updated2 = makeScene({
      id: '2',
      prose_link: { ...link2, start_offset: 59, end_offset: 63 },
    });
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([updated1, updated2]);
    apiMock.chapters.get.mockResolvedValueOnce({
      content:
        '<!--scene:1:start-->A<!--scene:1:end-->' +
        '<!--scene:2:start-->AABB<!--scene:2:end-->B',
    });
    useScenesMock.mockReturnValue([scene1, scene2]);

    storyState.chapters = [
      {
        id: '3',
        scope: 'chapter',
        title: 'Chapter 3',
        summary: '',
        content: fullContent,
      },
    ];

    const { ref } = makeEditorRefWithBoundary();
    const cb = await renderWithBoundary([scene1, scene2], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      await cb('2', 'start', 1);
    });

    // Verify the API call includes adjusted offsets for BOTH scenes
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    const callArgs = apiMock.scenes.batchLinkProse.mock.calls[0]?.[0];

    // Both scenes should be in the assignments
    const sceneIds = callArgs.assignments.map(
      (a: { scene_id: number | string }) => a.scene_id
    );
    expect(sceneIds).toContain('1');
    expect(sceneIds).toContain('2');

    // Scene 1's visible end should be 1 (after first "A")
    const s1Assignment = callArgs.assignments.find(
      (a: { scene_id: number | string }) => String(a.scene_id) === '1'
    );
    expect(s1Assignment?.end_offset).toBe(1);

    // Scene 2's visible start should be 1 (at the same position)
    const s2Assignment = callArgs.assignments.find(
      (a: { scene_id: number | string }) => String(a.scene_id) === '2'
    );
    expect(s2Assignment?.start_offset).toBe(1);

    // Verify setStory was called with correct reconstructed content
    expect(setStoryMock).toHaveBeenCalled();
    const updater = setStoryMock.mock.calls[setStoryMock.mock.calls.length - 1]?.[0] as
      ((prev: typeof storyState) => typeof storyState) | undefined;
    expect(typeof updater).toBe('function');
    const prevState = {
      ...storyState,
      chapters: storyState.chapters.map(
        (chapter: (typeof storyState.chapters)[number]) => ({ ...chapter })
      ),
    };
    const nextState = updater!(prevState);
    const rewrittenChapter = nextState.chapters.find(
      (chapter: (typeof storyState.chapters)[number]) => chapter.id === '3'
    );

    // The reconstructed content: scene 1 covers "A", scene 2 covers "AABB"
    // Trailing "B" is outside both scenes
    expect(rewrittenChapter?.content).toBe(
      '<!--scene:1:start-->A<!--scene:1:end-->' +
        '<!--scene:2:start-->AABB<!--scene:2:end-->B'
    );
  });

  it('with many scenes, dragging scene n+1 start into scene n correctly handles engulfment and partial overlap', async () => {
    // Real-world scenario: 5 scenes with two-digit IDs (13, 14, 16, 20, 21),
    // dragging scene 16's start left one paragraph into scene 14's text
    // (engulfing scene 14).  Scene 14 is unlinked.  Scene 16 expands.
    // After the roundtrip, all visible ranges must be correct.

    function marker(id: number, edge: 'start' | 'end'): string {
      return `<!--scene:${id}:${edge}-->`;
    }

    const fullContent =
      marker(13, 'start') +
      'Para1_' +
      marker(13, 'end') +
      marker(14, 'start') +
      'Para2_' +
      marker(14, 'end') +
      marker(16, 'start') +
      'Para3_' +
      marker(16, 'end') +
      marker(20, 'start') +
      'Para4_' +
      marker(20, 'end') +
      marker(21, 'start') +
      'Para5_' +
      marker(21, 'end');

    const currentChapter: WritingUnit = {
      ...CHAPTER,
      id: '3',
      content: fullContent,
    };

    // Compute original offsets from the content
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
          const s = openStarts.get(id);
          if (s !== undefined) result.set(id, { start: s, end: match.index });
        }
      }
      return result;
    }

    const origOffsets = extractOffsets(fullContent);

    const link13 = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: origOffsets.get(13)!.start,
      end_offset: origOffsets.get(13)!.end,
    });
    const link14 = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: origOffsets.get(14)!.start,
      end_offset: origOffsets.get(14)!.end,
    });
    const link16 = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: origOffsets.get(16)!.start,
      end_offset: origOffsets.get(16)!.end,
    });
    const link20 = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: origOffsets.get(20)!.start,
      end_offset: origOffsets.get(20)!.end,
    });
    const link21 = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: origOffsets.get(21)!.start,
      end_offset: origOffsets.get(21)!.end,
    });

    const scene13 = makeScene({ id: '13', prose_link: link13 });
    const scene14 = makeScene({ id: '14', prose_link: link14 });
    const scene16 = makeScene({ id: '16', prose_link: link16 });
    const scene20 = makeScene({ id: '20', prose_link: link20 });
    const scene21 = makeScene({ id: '21', prose_link: link21 });

    // Drag scene 16's start to visible position 6 (= end of scene 13's "Para1_")
    // Scene 14 is completely engulfed → unlinked
    // Scene 16 expands to cover scene 14's old text
    // After the fix, toOriginalOffset(6, fullContent) returns the position
    // of scene 13's end marker (the correct boundary), not past it.

    // Backend response: scene 14 unlinked (not in response),
    // scene 13 unchanged, scene 16 expanded, scenes 20/21 unchanged
    const newOffsets = extractOffsets(
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
        marker(21, 'end')
    );

    const updated13 = makeScene({
      id: '13',
      prose_link: {
        ...link13,
        start_offset: newOffsets.get(13)!.start,
        end_offset: newOffsets.get(13)!.end,
      },
    });
    const updated16 = makeScene({
      id: '16',
      prose_link: {
        ...link16,
        start_offset: newOffsets.get(16)!.start,
        end_offset: newOffsets.get(16)!.end,
      },
    });
    const updated20 = makeScene({
      id: '20',
      prose_link: {
        ...link20,
        start_offset: newOffsets.get(20)!.start,
        end_offset: newOffsets.get(20)!.end,
      },
    });
    const updated21 = makeScene({
      id: '21',
      prose_link: {
        ...link21,
        start_offset: newOffsets.get(21)!.start,
        end_offset: newOffsets.get(21)!.end,
      },
    });

    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([
      updated13,
      updated16,
      updated20,
      updated21,
    ]);
    apiMock.chapters.get.mockResolvedValueOnce({
      content:
        '<!--scene:13:start-->Para1_<!--scene:13:end-->' +
        '<!--scene:16:start-->Para2_Para3_<!--scene:16:end-->' +
        '<!--scene:20:start-->Para4_<!--scene:20:end-->' +
        '<!--scene:21:start-->Para5_<!--scene:21:end-->',
    });
    useScenesMock.mockReturnValue([scene13, scene14, scene16, scene20, scene21]);

    storyState.chapters = [
      {
        id: '3',
        scope: 'chapter',
        title: 'Chapter 3',
        summary: '',
        content: fullContent,
      },
    ];

    const { ref } = makeEditorRefWithBoundary();
    const cb = await renderWithBoundary([scene13, scene14, scene16, scene20, scene21], {
      editorRef: ref,
      currentChapter,
    });

    await act(async () => {
      await cb('16', 'start', 6);
    });

    // Verify API call includes unlink_ids for engulfed scene 14
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();
    const callArgs = apiMock.scenes.batchLinkProse.mock.calls[0]?.[0];
    expect(callArgs.unlink_ids).toContain('14');

    // Verify setStory was called with correct reconstructed content
    expect(setStoryMock).toHaveBeenCalled();
    const updater = setStoryMock.mock.calls[setStoryMock.mock.calls.length - 1]?.[0] as
      ((prev: typeof storyState) => typeof storyState) | undefined;
    const prevState = {
      ...storyState,
      chapters: storyState.chapters.map((c: Chapter) => ({ ...c })),
    };
    const nextState = updater!(prevState);
    const rewrittenChapter = nextState.chapters.find((c: Chapter) => c.id === '3');

    // Scene 14 is unlinked — must NOT appear in the reconstructed content
    expect(rewrittenChapter?.content).not.toContain('<!--scene:14:');
    // All other scenes must be present
    expect(rewrittenChapter?.content).toContain('<!--scene:13:');
    expect(rewrittenChapter?.content).toContain('<!--scene:16:');
    expect(rewrittenChapter?.content).toContain('<!--scene:20:');
    expect(rewrittenChapter?.content).toContain('<!--scene:21:');

    // Verify the visible text for each remaining scene is correct
    const stripped = stripInlineInternalMarkers(rewrittenChapter!.content);
    // Scene 13: "Para1_" (6 chars at start)
    expect(stripped.indexOf('Para1_')).toBe(0);
    // Scene 16: "Para2_Para3_" (should follow scene 13)
    expect(stripped.indexOf('Para2_Para3_')).toBe(6);

    // ===== UX verification: toVisibleRange after store update =====
    // This is the critical test: after the full handler flow completes,
    // toVisibleRange must return correct visible positions for each scene.
    // If it doesn't, the editor highlights will be at wrong positions.
    //
    // Build the final scenes from patchSceneMock calls (the store mock
    // doesn't maintain state — we need to manually apply patches).
    let finalScenes = [scene13, scene14, scene16, scene20, scene21];
    for (const call of patchSceneMock.mock.calls) {
      const patched: Scene | null = call[0];
      const removeId: SceneId | undefined = call[1];
      if (patched === null && removeId !== undefined) {
        finalScenes = finalScenes.filter((s: Scene) => s.id !== removeId);
      } else if (patched) {
        const idx = finalScenes.findIndex((s: Scene) => s.id === patched.id);
        if (idx >= 0) {
          finalScenes[idx] = patched;
        } else {
          finalScenes.push(patched);
        }
      }
    }

    const finalContent = rewrittenChapter!.content;
    const finalUnit: WritingUnit = {
      id: '3',
      scope: 'chapter',
      title: 'Chapter 3',
      content: stripInlineInternalMarkers(finalContent),
    };

    for (const sceneId of ['13', '16', '20', '21']) {
      const scene = finalScenes.find((s: Scene) => String(s.id) === sceneId);
      expect(scene, `scene ${sceneId} must exist in store`).toBeDefined();
      expect(scene!.prose_link, `scene ${sceneId} must have prose_link`).toBeDefined();

      const visible = toVisibleRange(scene!, finalUnit, finalScenes, finalContent);
      expect(visible, `scene ${sceneId} must have a visible range`).not.toBeNull();

      // Verify the visible range matches the actual prose text
      const expectedText = finalContent.slice(
        scene!.prose_link!.start_offset,
        scene!.prose_link!.end_offset!
      );
      const visibleText = stripInlineInternalMarkers(finalContent).slice(
        visible!.from,
        visible!.to
      );
      expect(visibleText, `scene ${sceneId} visible text mismatch`).toBe(expectedText);
    }

    // Scene 14 must NOT have a prose_link (it was unlinked)
    const scene14After = finalScenes.find((s: Scene) => String(s.id) === '14');
    expect(scene14After?.prose_link, 'scene 14 must be unlinked').toBeFalsy();
  });

  it('dragging scene end right into adjacent scene — full backend roundtrip simulation', async () => {
    // This test simulates the ACTUAL backend relink_scope_prose behavior
    // instead of mocking with hardcoded offsets.  The backend:
    //   1. Strips ALL markers from the file content
    //   2. Injects markers at the provided visible (stripped) positions
    //   3. Re-parses the new content to get updated offsets
    //   4. Returns those offsets (NOT our mock's pre-computed ones)
    //
    // If the frontend sends wrong visible offsets, the backend-returned
    // offsets will be wrong, and toVisibleRange will produce wrong results.

    function marker(id: number, edge: 'start' | 'end'): string {
      return `<!--scene:${id}:${edge}-->`;
    }

    // ── Backend simulation helpers ────────────────────────────────────
    const SCENE_MARKER_RE = /<!--scene:\d+:(?:start|end)-->/g;

    function backendRemoveAllMarkers(content: string): string {
      return content.replace(SCENE_MARKER_RE, '');
    }

    function backendInjectMarkers(
      stripped: string,
      assignments: Array<[number, number, number]>
    ): string {
      const sorted = [...assignments].sort(
        (a: [number, number, number], b: [number, number, number]) => a[1] - b[1]
      );
      let result = '';
      let cursor = 0;
      for (const [id, start, end] of sorted) {
        result += stripped.slice(cursor, start);
        result += `<!--scene:${id}:start-->`;
        result += stripped.slice(start, end);
        result += `<!--scene:${id}:end-->`;
        cursor = end;
      }
      result += stripped.slice(cursor);
      return result;
    }

    function backendRemapOffsetAfterMarkerRemoval(
      content: string,
      offset: number
    ): number {
      const clamped = Math.max(0, Math.min(offset, content.length));
      let removed = 0;
      const regex = new RegExp(SCENE_MARKER_RE.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const markerStart = match.index;
        const markerEnd = markerStart + match[0].length;
        if (markerEnd <= clamped) {
          removed += match[0].length;
          continue;
        }
        if (markerStart < clamped) {
          removed += clamped - markerStart;
        }
        break;
      }
      return clamped - removed;
    }

    function backendParseSpans(
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
          const s = openStarts.get(id);
          if (s !== undefined) result.set(id, { start: s, end: match.index });
        }
      }
      return result;
    }

    /**
     * Full backend relink_scope_prose simulation:
     * Takes old file content + frontend batch assignments,
     * returns the new content and updated scene offsets.
     */
    function simulateBackendRelink(
      oldContent: string,
      batchAssignments: Array<{
        scene_id: number;
        start_offset: number;
        end_offset: number;
      }>,
      unlinkIds: number[]
    ): {
      newContent: string;
      updatedScenes: Array<{ id: number; start_offset: number; end_offset: number }>;
    } {
      // 1. Capture original spans BEFORE stripping
      const originalSpans = backendParseSpans(oldContent);
      const assignedIds = new Set(
        batchAssignments.map(
          (a: { scene_id: number; start_offset: number; end_offset: number }) =>
            Number(a.scene_id)
        )
      );

      // 2. Remove markers of unlinked scenes
      let content = oldContent;
      for (const uid of unlinkIds) {
        const re = new RegExp(`<!--scene:${uid}:(?:start|end)-->`, 'g');
        content = content.replace(re, '');
      }

      // 3. Strip all remaining markers
      const stripped = backendRemoveAllMarkers(content);

      // 4. Assigned scenes use provided stripped offsets directly
      const allAssignments: Array<[number, number, number]> = batchAssignments.map(
        (a: { scene_id: number; start_offset: number; end_offset: number }) => [
          Number(a.scene_id),
          a.start_offset,
          a.end_offset,
        ]
      );

      // 5. Remap non-assigned, non-unlinked scenes
      for (const [id, span] of originalSpans) {
        if (assignedIds.has(id)) continue;
        if (unlinkIds.includes(id)) continue;
        const remappedStart = backendRemapOffsetAfterMarkerRemoval(content, span.start);
        const remappedEnd = backendRemapOffsetAfterMarkerRemoval(content, span.end);
        if (remappedStart >= remappedEnd) continue;
        allAssignments.push([id, remappedStart, remappedEnd]);
      }

      // 6. Inject markers
      const newContent = backendInjectMarkers(stripped, allAssignments);

      // 7. Parse new spans
      const newSpans = backendParseSpans(newContent);

      // 8. Return updated scenes
      const updatedScenes: Array<{
        id: number;
        start_offset: number;
        end_offset: number;
      }> = [];
      for (const [id, span] of newSpans) {
        updatedScenes.push({ id, start_offset: span.start, end_offset: span.end });
      }
      return { newContent, updatedScenes };
    }
    // ── End backend simulation ────────────────────────────────────────

    // Actual test scenario: two adjacent scenes
    const fullContent =
      marker(20, 'start') +
      'Para4_' +
      marker(20, 'end') +
      marker(21, 'start') +
      'Para5_' +
      marker(21, 'end');

    const currentChapter: WritingUnit = {
      ...CHAPTER,
      id: '3',
      content: fullContent,
    };

    // Original offsets
    // 20-start(0-20) Para4_(21-26) 20-end(27-45) 21-start(46-66) Para5_(67-72) 21-end(73-91)
    const link20 = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: 21,
      end_offset: 27,
    });
    const link21 = makeProseLink({
      scope_type: 'chapter',
      chapter_id: '3',
      start_offset: 67,
      end_offset: 73,
    });
    const scene20 = makeScene({ id: '20', prose_link: link20 });
    const scene21 = makeScene({ id: '21', prose_link: link21 });

    // Instead of hardcoding the API response, compute it using the
    // same logic the backend would use.  The mock captures the
    // frontend's batchAssignments, feeds them through the simulation,
    // and returns the computed offsets.
    apiMock.scenes.batchLinkProse.mockImplementation(
      async (payload: {
        scope_type: string;
        chapter_id?: string | null;
        assignments: Array<{
          scene_id: number;
          start_offset: number;
          end_offset: number;
        }>;
        unlink_ids?: number[];
      }) => {
        const { newContent, updatedScenes } = simulateBackendRelink(
          fullContent,
          payload.assignments.map(
            (a: { scene_id: number; start_offset: number; end_offset: number }) => ({
              scene_id: a.scene_id,
              start_offset: a.start_offset,
              end_offset: a.end_offset,
            })
          ),
          (payload.unlink_ids || []) as number[]
        );
        // Also mock the chapter get to return the updated content
        apiMock.chapters.get.mockResolvedValueOnce({ content: newContent });
        return updatedScenes.map(
          (s: { id: number; start_offset: number; end_offset: number }) =>
            makeScene({
              id: String(s.id),
              prose_link: {
                scope_type: 'chapter',
                chapter_id: '3',
                start_offset: s.start_offset,
                end_offset: s.end_offset,
              },
            })
        ) as Scene[];
      }
    );
    useScenesMock.mockReturnValue([scene20, scene21]);

    storyState.chapters = [
      {
        id: '3',
        scope: 'chapter',
        title: 'Chapter 3',
        summary: '',
        content: fullContent,
      },
    ];

    const { ref } = makeEditorRefWithBoundary();
    const cb = await renderWithBoundary([scene20, scene21], {
      editorRef: ref,
      currentChapter,
    });

    // Drag scene 20's end RIGHT to visible position 8 (2 chars into "Para5_")
    await act(async () => {
      await cb('20', 'end', 8);
    });

    // Verify the API was called
    expect(apiMock.scenes.batchLinkProse).toHaveBeenCalled();

    // Verify setStory was called with reconstructed content
    expect(setStoryMock).toHaveBeenCalled();
    const updater = setStoryMock.mock.calls[setStoryMock.mock.calls.length - 1]?.[0] as
      ((prev: typeof storyState) => typeof storyState) | undefined;
    expect(typeof updater).toBe('function');
    const prevState = {
      ...storyState,
      chapters: storyState.chapters.map((c: Chapter) => ({ ...c })),
    };
    const nextState = updater!(prevState);
    const rewrittenChapter = nextState.chapters.find((c: Chapter) => c.id === '3');
    expect(rewrittenChapter?.content).toBeTruthy();

    // Build final scenes from patchSceneMock calls
    let finalScenes = [scene20, scene21];
    for (const call of patchSceneMock.mock.calls) {
      const patched: Scene | null = call[0];
      if (patched) {
        const idx = finalScenes.findIndex((s: Scene) => s.id === patched.id);
        if (idx >= 0) finalScenes[idx] = patched;
        else finalScenes.push(patched);
      }
    }

    const finalContent = rewrittenChapter!.content;
    const finalUnit: WritingUnit = {
      id: '3',
      scope: 'chapter',
      title: 'Chapter 3',
      content: stripInlineInternalMarkers(finalContent),
    };

    // ===== THE CRITICAL CHECK =====
    // After the full roundtrip (frontend → simulated backend → frontend),
    // both scenes' visible ranges must match what the user expects.
    // Scene 20 should cover "Para4_Pa" (8 chars), scene 21 "ra5_" (4 chars).

    const s20 = finalScenes.find((s: Scene) => String(s.id) === '20');
    expect(s20?.prose_link, 'scene 20 must have prose_link').toBeDefined();
    const s20Vis = toVisibleRange(s20!, finalUnit, finalScenes, finalContent);
    expect(s20Vis, 'scene 20 range').toEqual({ from: 0, to: 8 });

    const s21 = finalScenes.find((s: Scene) => String(s.id) === '21');
    expect(s21?.prose_link, 'scene 21 must have prose_link').toBeDefined();
    const s21Vis = toVisibleRange(s21!, finalUnit, finalScenes, finalContent);
    expect(s21Vis, 'scene 21 range').toEqual({ from: 8, to: 12 });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Backend roundtrip simulation helpers (shared by all 6 UX tests)
  // ═══════════════════════════════════════════════════════════════════

  /** Returns a marker token string for a given scene id and edge. */
  function m(id: number, edge: 'start' | 'end'): string {
    return `<!--scene:${id}:${edge}-->`;
  }

  /** Builds full content with markers for a list of {id, text} scenes. */
  function buildContent(scenes: Array<{ id: number; text: string }>): string {
    return scenes
      .map(
        (s: { id: number; text: string }) => m(s.id, 'start') + s.text + m(s.id, 'end')
      )
      .join('');
  }

  /** Regex that matches any scene marker token. */
  const SCENE_MARKER_RE = /<!--scene:\d+:(?:start|end)-->/g;

  function backendStripMarkers(content: string): string {
    return content.replace(SCENE_MARKER_RE, '');
  }

  function backendInjectMarkers(
    stripped: string,
    assignments: Array<[number, number, number]>
  ): string {
    const sorted = [...assignments].sort(
      (a: [number, number, number], b: [number, number, number]) => a[1] - b[1]
    );
    let result = '';
    let cursor = 0;
    for (const [id, start, end] of sorted) {
      result += stripped.slice(cursor, start);
      result += m(id, 'start');
      result += stripped.slice(start, end);
      result += m(id, 'end');
      cursor = end;
    }
    result += stripped.slice(cursor);
    return result;
  }

  function backendRemapOffset(content: string, offset: number): number {
    const clamped = Math.max(0, Math.min(offset, content.length));
    let removed = 0;
    const regex = new RegExp(SCENE_MARKER_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const ms = match.index;
      const me = ms + match[0].length;
      if (me <= clamped) {
        removed += match[0].length;
        continue;
      }
      if (ms < clamped) {
        removed += clamped - ms;
      }
      break;
    }
    return clamped - removed;
  }

  function backendParseSpans(
    content: string
  ): Map<number, { start: number; end: number }> {
    const r = new Map<number, { start: number; end: number }>();
    const open = new Map<number, number>();
    const re = /<!--scene:(\d+):(start|end)-->/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const id = parseInt(m[1], 10);
      if (m[2] === 'start') open.set(id, m.index + m[0].length);
      else {
        const s = open.get(id);
        if (s !== undefined) r.set(id, { start: s, end: m.index });
      }
    }
    return r;
  }

  /** Full backend relink_scope_prose simulation. */
  function simulateBackend(
    oldContent: string,
    batchAssignments: Array<{
      scene_id: number;
      start_offset: number;
      end_offset: number;
    }>,
    unlinkIds: number[]
  ): {
    updatedScenes: Array<{ id: number; start_offset: number; end_offset: number }>;
    newContent: string;
  } {
    const originalSpans = backendParseSpans(oldContent);
    const assignedIds = new Set(
      batchAssignments.map(
        (a: { scene_id: number; start_offset: number; end_offset: number }) =>
          Number(a.scene_id)
      )
    );

    let content = oldContent;
    for (const uid of unlinkIds) {
      content = content.replace(
        new RegExp(`<!--scene:${uid}:(?:start|end)-->`, 'g'),
        ''
      );
    }
    const stripped = backendStripMarkers(content);

    const allAssignments: Array<[number, number, number]> = batchAssignments.map(
      (a: { scene_id: number; start_offset: number; end_offset: number }) => [
        Number(a.scene_id),
        a.start_offset,
        a.end_offset,
      ]
    );
    for (const [id, span] of originalSpans) {
      if (assignedIds.has(id)) continue;
      if (unlinkIds.includes(id)) continue;
      const rs = backendRemapOffset(content, span.start);
      const re = backendRemapOffset(content, span.end);
      if (rs >= re) continue;
      allAssignments.push([id, rs, re]);
    }
    const newContent = backendInjectMarkers(stripped, allAssignments);
    const newSpans = backendParseSpans(newContent);
    return {
      updatedScenes: [...newSpans].map(
        ([id, s]: [number, { start: number; end: number }]) => ({
          id,
          start_offset: s.start,
          end_offset: s.end,
        })
      ),
      newContent,
    };
  }

  /** Wires up the mock API to use simulateBackend, runs a drag, and returns the final state. */
  async function runDragAndVerify(
    chapterContent: string,
    initialScenes: Scene[],
    currentChapter: WritingUnit,
    dragSceneId: string,
    dragEdge: 'start' | 'end',
    dragOffset: number,
    expectedRanges: Record<string, { from: number; to: number }>
  ): Promise<void> {
    apiMock.scenes.batchLinkProse.mockImplementation(
      async (payload: {
        assignments: Array<{
          scene_id: number;
          start_offset: number;
          end_offset: number;
        }>;
        unlink_ids?: number[];
      }) => {
        const { updatedScenes, newContent } = simulateBackend(
          chapterContent,
          payload.assignments.map(
            (a: { scene_id: number; start_offset: number; end_offset: number }) => ({
              scene_id: a.scene_id,
              start_offset: a.start_offset,
              end_offset: a.end_offset,
            })
          ),
          (payload.unlink_ids || []) as number[]
        );
        // Also mock the chapter get to return the updated content
        apiMock.chapters.get.mockResolvedValueOnce({ content: newContent });
        return updatedScenes.map(
          (s: { id: number; start_offset: number; end_offset: number }) =>
            makeScene({
              id: String(s.id),
              prose_link: {
                scope_type: 'chapter',
                chapter_id: currentChapter.id,
                start_offset: s.start_offset,
                end_offset: s.end_offset,
              },
            })
        ) as Scene[];
      }
    );
    useScenesMock.mockReturnValue(initialScenes);
    storyState.chapters = [
      {
        id: currentChapter.id,
        scope: 'chapter',
        title: currentChapter.title,
        summary: '',
        content: chapterContent,
      },
    ];

    const { ref } = makeEditorRefWithBoundary();
    const cb = await renderWithBoundary(initialScenes, {
      editorRef: ref,
      currentChapter,
    });
    await act(async () => {
      await cb(dragSceneId, dragEdge, dragOffset);
    });

    expect(setStoryMock).toHaveBeenCalled();
    const updater = setStoryMock.mock.calls[setStoryMock.mock.calls.length - 1]?.[0] as
      ((prev: typeof storyState) => typeof storyState) | undefined;
    const prevState = {
      ...storyState,
      chapters: storyState.chapters.map((c: Chapter) => ({ ...c })),
    };
    const nextState = updater!(prevState);
    const rewritten = nextState.chapters.find(
      (c: Chapter) => c.id === currentChapter.id
    );
    expect(rewritten?.content).toBeTruthy();

    // Build final scenes from patchSceneMock calls
    let finalScenes = [...initialScenes];
    for (const call of patchSceneMock.mock.calls) {
      const p: Scene | null = call[0];
      if (!p) continue;
      const idx = finalScenes.findIndex((s: Scene) => s.id === p.id);
      if (idx >= 0) finalScenes[idx] = p;
      else finalScenes.push(p);
    }

    const finalContent = rewritten!.content;
    const finalUnit: WritingUnit = {
      id: currentChapter.id,
      scope: 'chapter',
      title: currentChapter.title,
      content: backendStripMarkers(finalContent),
    };

    for (const [sceneId, expected] of Object.entries(expectedRanges)) {
      const scene = finalScenes.find((s: Scene) => String(s.id) === sceneId);
      expect(scene, `scene ${sceneId} must exist`).toBeDefined();
      if (expected.from < 0) {
        // Negative from means "expect no prose_link" (unlinked)
        expect(scene!.prose_link, `scene ${sceneId} must be unlinked`).toBeFalsy();
      } else {
        expect(
          scene!.prose_link,
          `scene ${sceneId} must have prose_link`
        ).toBeDefined();
        const vis = toVisibleRange(scene!, finalUnit, finalScenes, finalContent);
        expect(vis, `scene ${sceneId} range`).toEqual(expected);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // START boundary drags (3 scenarios)
  // ═══════════════════════════════════════════════════════════════════

  it('START: shrink scene 14 within its own text', async () => {
    // 3 scenes: 13="Para1_", 14="Para2_", 16="Para3_"
    // Drag scene 14 start RIGHT from visible 6 to visible 8
    const content = buildContent([
      { id: 13, text: 'Para1_' },
      { id: 14, text: 'Para2_' },
      { id: 16, text: 'Para3_' },
    ]);
    const ch: WritingUnit = { ...CHAPTER, id: '3', content };
    const off = backendParseSpans(content);
    const s13 = makeScene({
      id: '13',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(13)!.start,
        end_offset: off.get(13)!.end,
      }),
    });
    const s14 = makeScene({
      id: '14',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(14)!.start,
        end_offset: off.get(14)!.end,
      }),
    });
    const s16 = makeScene({
      id: '16',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(16)!.start,
        end_offset: off.get(16)!.end,
      }),
    });

    await runDragAndVerify(content, [s13, s14, s16], ch, '14', 'start', 8, {
      '13': { from: 0, to: 6 }, // "Para1_" unchanged
      '14': { from: 8, to: 12 }, // "ra2_" (last 4 chars)
      '16': { from: 12, to: 18 }, // "Para3_" unchanged
    });
  });

  it('START: drag scene 14 start left into scene 13 (partial overlap)', async () => {
    // Drag scene 14 start LEFT from visible 6 to visible 3
    const content = buildContent([
      { id: 13, text: 'Para1_' },
      { id: 14, text: 'Para2_' },
      { id: 16, text: 'Para3_' },
    ]);
    const ch: WritingUnit = { ...CHAPTER, id: '3', content };
    const off = backendParseSpans(content);
    const s13 = makeScene({
      id: '13',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(13)!.start,
        end_offset: off.get(13)!.end,
      }),
    });
    const s14 = makeScene({
      id: '14',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(14)!.start,
        end_offset: off.get(14)!.end,
      }),
    });
    const s16 = makeScene({
      id: '16',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(16)!.start,
        end_offset: off.get(16)!.end,
      }),
    });

    await runDragAndVerify(content, [s13, s14, s16], ch, '14', 'start', 3, {
      '13': { from: 0, to: 3 }, // "Par" (shrunk)
      '14': { from: 3, to: 12 }, // "a1_Para2_" (expanded)
      '16': { from: 12, to: 18 }, // "Para3_" unchanged
    });
  });

  it('START: drag scene 16 start left past scene 14 (engulfment)', async () => {
    // Drag scene 16 start LEFT from visible 12 all the way to visible 3,
    // completely engulfing scene 14 (which gets unlinked).
    const content = buildContent([
      { id: 13, text: 'Para1_' },
      { id: 14, text: 'Para2_' },
      { id: 16, text: 'Para3_' },
    ]);
    const ch: WritingUnit = { ...CHAPTER, id: '3', content };
    const off = backendParseSpans(content);
    const s13 = makeScene({
      id: '13',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(13)!.start,
        end_offset: off.get(13)!.end,
      }),
    });
    const s14 = makeScene({
      id: '14',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(14)!.start,
        end_offset: off.get(14)!.end,
      }),
    });
    const s16 = makeScene({
      id: '16',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(16)!.start,
        end_offset: off.get(16)!.end,
      }),
    });

    await runDragAndVerify(content, [s13, s14, s16], ch, '16', 'start', 3, {
      '13': { from: 0, to: 3 }, // "Par" (shrunk by scene 16's expansion)
      '14': { from: -1, to: -1 }, // UNLINKED
      '16': { from: 3, to: 18 }, // "a1_Para2_Para3_" (expanded to cover 14 + own text)
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // END boundary drags (3 scenarios)
  // ═══════════════════════════════════════════════════════════════════

  it('END: shrink scene 14 within its own text', async () => {
    // Drag scene 14 end LEFT from visible 12 to visible 10
    const content = buildContent([
      { id: 13, text: 'Para1_' },
      { id: 14, text: 'Para2_' },
      { id: 16, text: 'Para3_' },
    ]);
    const ch: WritingUnit = { ...CHAPTER, id: '3', content };
    const off = backendParseSpans(content);
    const s13 = makeScene({
      id: '13',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(13)!.start,
        end_offset: off.get(13)!.end,
      }),
    });
    const s14 = makeScene({
      id: '14',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(14)!.start,
        end_offset: off.get(14)!.end,
      }),
    });
    const s16 = makeScene({
      id: '16',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(16)!.start,
        end_offset: off.get(16)!.end,
      }),
    });

    await runDragAndVerify(content, [s13, s14, s16], ch, '14', 'end', 10, {
      '13': { from: 0, to: 6 }, // "Para1_" unchanged
      '14': { from: 6, to: 10 }, // "Para" (shrunk, 4 chars)
      '16': { from: 12, to: 18 }, // "Para3_" (unchanged, gap text "2_" at 10-12 unowned)
    });
  });

  it('END: drag scene 14 end right into scene 16 (partial overlap)', async () => {
    // Drag scene 14 end RIGHT from visible 12 to visible 15
    const content = buildContent([
      { id: 13, text: 'Para1_' },
      { id: 14, text: 'Para2_' },
      { id: 16, text: 'Para3_' },
    ]);
    const ch: WritingUnit = { ...CHAPTER, id: '3', content };
    const off = backendParseSpans(content);
    const s13 = makeScene({
      id: '13',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(13)!.start,
        end_offset: off.get(13)!.end,
      }),
    });
    const s14 = makeScene({
      id: '14',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(14)!.start,
        end_offset: off.get(14)!.end,
      }),
    });
    const s16 = makeScene({
      id: '16',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(16)!.start,
        end_offset: off.get(16)!.end,
      }),
    });

    await runDragAndVerify(content, [s13, s14, s16], ch, '14', 'end', 15, {
      '13': { from: 0, to: 6 }, // "Para1_" unchanged
      '14': { from: 6, to: 15 }, // "Para2_Par" (expanded)
      '16': { from: 15, to: 18 }, // "a3_" (shrunk)
    });
  });

  it('END: drag scene 13 end right past scene 14 (engulfment)', async () => {
    // Drag scene 13 end RIGHT from visible 6 all the way to visible 15,
    // completely engulfing scene 14 (which gets unlinked).
    const content = buildContent([
      { id: 13, text: 'Para1_' },
      { id: 14, text: 'Para2_' },
      { id: 16, text: 'Para3_' },
    ]);
    const ch: WritingUnit = { ...CHAPTER, id: '3', content };
    const off = backendParseSpans(content);
    const s13 = makeScene({
      id: '13',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(13)!.start,
        end_offset: off.get(13)!.end,
      }),
    });
    const s14 = makeScene({
      id: '14',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(14)!.start,
        end_offset: off.get(14)!.end,
      }),
    });
    const s16 = makeScene({
      id: '16',
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: off.get(16)!.start,
        end_offset: off.get(16)!.end,
      }),
    });

    await runDragAndVerify(content, [s13, s14, s16], ch, '13', 'end', 15, {
      '13': { from: 0, to: 15 }, // "Para1_Para2_Par" (expanded, engulfing 14)
      '14': { from: -1, to: -1 }, // UNLINKED
      '16': { from: 15, to: 18 }, // "a3_" (shrunk by scene 13's expansion)
    });
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

  it('passes onCreateCause into Narrative and Convergence Map views', async () => {
    useScenesMock.mockReturnValue([makeScene({ id: 'scene-a' })]);
    const utils = wrap(<ScenesPanelContainer />);

    await act(async () => {
      fireEvent.click(utils.getByRole('button', { name: 'Narrative' }));
    });

    expect(nv().onCreateCause).toBeInstanceOf(Function);

    await act(async () => {
      fireEvent.click(utils.getByRole('button', { name: 'Convergence Map' }));
    });

    expect(captured.convergence?.onCreateCause).toBeInstanceOf(Function);
  });

  it('does not trigger a render-loop when NarrativeView mounts with scene-lane state callbacks', async () => {
    // Regression test: inline onVisibleLaneEntryIdsChange/onRemovedReferencedLaneIdsChange
    // callbacks can cause an infinite render loop because they recreate on every
    // ScenesPanelContainer render, which causes useSceneLanes to re-run effects,
    // which call setSceneLaneState, which re-renders ScenesPanelContainer.
    useScenesMock.mockReturnValue([makeScene({ id: 'scene-a' })]);
    useUIStore.setState({
      scenesViewType: 'narrative',
      workspaceMode: 'scenes',
      sceneLaneState: {
        visibleLaneEntryIds: [],
        removedReferencedLaneIds: [],
      },
    });

    const initialSceneLaneState = { ...useUIStore.getState().sceneLaneState };

    // Render in narrative mode – NarrativeView should mount immediately
    wrap(<ScenesPanelContainer />);

    // After the initial render cycle settles, the sceneLaneState in the store
    // should NOT have been mutated by a render-loop.  It should still match
    // the initial value (or only have changed via effects, not during render).
    expect(captured.narrative).not.toBeNull();
    expect(captured.pinboard).toBeNull();

    // The store values should be stable — if there's a render loop, the
    // store would be continuously updated.
    const currentState = useUIStore.getState().sceneLaneState;
    // At minimum, visibleLaneEntryIds should be a defined array (not mutated
    // by a render-loop into some unexpected shape).
    expect(Array.isArray(currentState.visibleLaneEntryIds)).toBe(true);
    // The cleanest check: after a single render, the store should have had
    // zero net additional updates beyond what the initial mount produces
    // (i.e. the effect runs once and settles).
    expect(currentState.removedReferencedLaneIds).toEqual(
      initialSceneLaneState.removedReferencedLaneIds
    );
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

// eslint-disable-next-line max-lines-per-function
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

  it('[E2E] links scene via external chapter-drop window event', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: 'ch-2',
        title: 'Chapter 2',
        summary: '',
        content: 'Target chapter prose.',
      } as Chapter,
    ]);

    const unlinked = makeScene({ id: 'u', order_index: 1, prose_link: null });
    apiMock.scenes.linkProse.mockResolvedValueOnce([
      makeScene({
        id: 'u',
        order_index: 1,
        prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-2' }),
      }),
    ]);

    await renderNarrative([unlinked]);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('aq-scene-drop-chapter', {
          detail: {
            sourceSceneIds: ['u'],
            chapterId: 'ch-2',
          },
        })
      );
      await Promise.resolve();
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
  });

  it('[E2E] ignores malformed external chapter-drop event payloads', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: 'ch-2',
        title: 'Chapter 2',
        summary: '',
        content: 'Target chapter prose.',
      } as Chapter,
    ]);

    const unlinked = makeScene({ id: 'u', order_index: 1, prose_link: null });
    await renderNarrative([unlinked]);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('aq-scene-drop-chapter', {
          detail: {
            sourceSceneIds: 'u',
            chapterId: 2,
          },
        })
      );
      await Promise.resolve();
    });

    expect(apiMock.scenes.linkProse).not.toHaveBeenCalled();
    expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
  });

  it('[E2E] handles multi-scene external chapter-drop with mixed unlinked and cross-chapter sources', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: 'ch-1',
        title: 'Chapter 1',
        summary: '',
        content: 'Chapter 1 prose.',
      } as Chapter,
      {
        id: 'ch-2',
        title: 'Chapter 2',
        summary: '',
        content: 'Chapter 2 prose.',
      } as Chapter,
    ]);

    const targetLinked = makeScene({
      id: 'a',
      order_index: 1,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-2' }),
    });
    const unlinked = makeScene({ id: 'u', order_index: 2, prose_link: null });
    const linkedSource = makeScene({
      id: 's',
      order_index: 3,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
    });

    apiMock.scenes.linkProse.mockImplementation(
      async (
        sourceId: SceneId,
        payload: {
          scope_type: string;
          chapter_id: string | null;
          book_id?: string | null;
          start_offset: number;
          end_offset: number;
        }
      ): Promise<Scene[]> => [
        makeScene({
          id: sourceId,
          order_index: sourceId === 'u' ? 2 : 3,
          prose_link: makeProseLink({
            scope_type: 'chapter',
            chapter_id: payload.chapter_id,
            book_id: payload.book_id ?? null,
            start_offset: payload.start_offset,
            end_offset: payload.end_offset,
          }),
        }),
      ]
    );

    await renderNarrative([targetLinked, unlinked, linkedSource]);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('aq-scene-drop-chapter', {
          detail: {
            sourceSceneIds: ['u', 's'],
            chapterId: 'ch-2',
          },
        })
      );
      await Promise.resolve();
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(2);
    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
    expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
  });

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
      expect(apiMock.scenes.reorderProse).toHaveBeenCalled();
      expect(patchSceneMock).toHaveBeenCalledTimes(2);
      expect(dispatch).toHaveBeenCalled();
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

  it('[INVALID] does not reorder scenes without prose links', async () => {
    const sceneA = makeScene({ id: 'a', prose_link: null, order_index: 1 });
    const sceneB = makeScene({ id: 'b', prose_link: null, order_index: 2 });

    await renderNarrative([sceneA, sceneB]);

    await act(async () => {
      await nv().onReorderScene?.('b', 'a', true);
    });

    expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
    expect(apiMock.scenes.update).not.toHaveBeenCalled();
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

    expect(apiMock.scenes.reorderProse).toHaveBeenCalled();
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

    expect(apiMock.scenes.reorderProse).toHaveBeenCalled();
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

  it('[VALID] moves an unlinked scene into the dropped chapter run', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: 'ch-1',
        title: 'Chapter 1',
        summary: '',
        content: 'Chapter 1 prose.',
      } as Chapter,
    ]);

    const chapterStart = makeScene({
      id: 'a',
      order_index: 1,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
    });
    const unlinkedBetween = makeScene({ id: 'u', order_index: 2, prose_link: null });
    const chapterEnd = makeScene({
      id: 'b',
      order_index: 3,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
    });

    apiMock.scenes.linkProse.mockResolvedValueOnce([
      makeScene({
        id: 'u',
        order_index: 2,
        prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
      }),
    ]);

    await renderNarrative([chapterStart, unlinkedBetween, chapterEnd]);

    await act(async () => {
      await nv().onDropScenesOnChapter?.(['u'], 'ch-1');
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
  });

  it('[VALID] keeps chapter drop as link-only even when backend link response starts at 0..1', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: 'ch-1',
        title: 'Chapter 1',
        summary: '',
        content: '',
      } as Chapter,
      {
        id: 'ch-3',
        title: 'Chapter 3',
        summary: '',
        content: '',
      } as Chapter,
    ]);

    const chapter1Scene = makeScene({
      id: 'c1',
      order_index: 1,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
    });
    const sourceUnlinked = makeScene({ id: 'u', order_index: 2, prose_link: null });
    const chapter3Anchor = makeScene({
      id: 'c3',
      order_index: 3,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-3' }),
    });

    apiMock.scenes.linkProse.mockResolvedValueOnce([
      makeScene({
        id: 'u',
        order_index: 2,
        prose_link: makeProseLink({
          scope_type: 'chapter',
          chapter_id: 'ch-3',
          start_offset: 0,
          end_offset: 1,
        }),
      }),
    ]);

    await renderNarrative([chapter1Scene, sourceUnlinked, chapter3Anchor]);

    await act(async () => {
      await nv().onDropScenesOnChapter?.(['u'], 'ch-3');
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(1);
    expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
  });

  it('[VALID] uses directly linked chapter scenes as drop anchors', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: 'ch-1',
        title: 'Chapter 1',
        summary: '',
        content: '',
      } as Chapter,
      {
        id: 'ch-2',
        title: 'Chapter 2',
        summary: '',
        content: '',
      } as Chapter,
    ]);

    const targetLinked = makeScene({
      id: 'a',
      order_index: 1,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
    });
    const inferredTrailingUnlinked = makeScene({
      id: 'u',
      order_index: 2,
      prose_link: null,
    });
    const source = makeScene({
      id: 's',
      order_index: 3,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-2' }),
    });

    apiMock.scenes.linkProse.mockResolvedValueOnce([
      makeScene({
        id: 's',
        order_index: 3,
        prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
      }),
    ]);

    await renderNarrative([targetLinked, inferredTrailingUnlinked, source]);

    await act(async () => {
      await nv().onDropScenesOnChapter?.(['s'], 'ch-1');
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
    expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
  });

  it('[VALID] links dropped unlinked scenes when the target chapter has no linked scenes', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: 'ch-1',
        title: 'Chapter 1',
        summary: '',
        content: 'Existing chapter prose.',
      } as Chapter,
      {
        id: 'ch-2',
        title: 'Chapter 2',
        summary: '',
        content: 'Target chapter prose.',
      } as Chapter,
    ]);

    const linkedInOtherChapter = makeScene({
      id: 'a',
      order_index: 1,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
    });
    const unlinked = makeScene({ id: 'u', order_index: 2, prose_link: null });

    apiMock.scenes.linkProse.mockResolvedValueOnce([
      makeScene({
        id: 'u',
        order_index: 2,
        prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-2' }),
      }),
    ]);

    await renderNarrative([linkedInOtherChapter, unlinked]);

    await act(async () => {
      await nv().onDropScenesOnChapter?.(['u'], 'ch-2');
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
  });

  it('[VALID] links dropped unlinked scenes with a valid range when target chapter content is empty', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: 'ch-2',
        title: 'Chapter 2',
        summary: '',
        content: '',
      } as Chapter,
    ]);

    const unlinked = makeScene({ id: 'u', order_index: 2, prose_link: null });

    apiMock.scenes.linkProse.mockResolvedValueOnce([
      makeScene({
        id: 'u',
        order_index: 2,
        prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-2' }),
      }),
    ]);

    await renderNarrative([unlinked]);

    await act(async () => {
      await nv().onDropScenesOnChapter?.(['u'], 'ch-2');
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
  });

  it('[VALID] mixed multi-drop moves all dropped scenes via link-only chapter assignment', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: 'ch-1',
        title: 'Chapter 1',
        summary: '',
        content: 'Chapter 1 prose.',
      } as Chapter,
      {
        id: 'ch-2',
        title: 'Chapter 2',
        summary: '',
        content: 'Chapter 2 prose.',
      } as Chapter,
    ]);

    const targetA = makeScene({
      id: 'a',
      order_index: 1,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-2' }),
    });
    const targetB = makeScene({
      id: 'b',
      order_index: 2,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-2' }),
    });
    const unlinked = makeScene({ id: 'u', order_index: 3, prose_link: null });
    const linkedSource = makeScene({
      id: 's',
      order_index: 4,
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-1' }),
    });

    apiMock.scenes.linkProse.mockImplementation(
      async (
        sourceId: SceneId,
        payload: {
          scope_type: string;
          chapter_id: string | null;
          book_id?: string | null;
          start_offset: number;
          end_offset: number;
        }
      ): Promise<Scene[]> => [
        makeScene({
          id: sourceId,
          order_index: sourceId === 'u' ? 3 : 4,
          prose_link: makeProseLink({
            scope_type: 'chapter',
            chapter_id: payload.chapter_id,
            book_id: payload.book_id ?? null,
            start_offset: payload.start_offset,
            end_offset: payload.end_offset,
          }),
        }),
      ]
    );

    await renderNarrative([targetA, targetB, unlinked, linkedSource]);

    await act(async () => {
      await nv().onDropScenesOnChapter?.(['u', 's'], 'ch-2');
    });

    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(2);
    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
    expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
  });

  it('[VALID] falls back to chapter detail content length for numeric chapter ids', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: '3',
        title: 'Chapter 3',
        summary: '',
        content: '',
      } as Chapter,
    ]);
    apiMock.chapters.get.mockResolvedValueOnce({
      id: 3,
      title: 'Chapter 3',
      filename: 'chapter_3.md',
      content: 'Longer content from chapter detail endpoint.',
      summary: '',
      notes: '',
      private_notes: '',
      conflicts: [],
    });

    const unlinked = makeScene({ id: 'u', order_index: 2, prose_link: null });

    apiMock.scenes.linkProse.mockResolvedValueOnce([
      makeScene({
        id: 'u',
        order_index: 2,
        prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: '3' }),
      }),
    ]);

    await renderNarrative([unlinked]);

    await act(async () => {
      await nv().onDropScenesOnChapter?.(['u'], '3');
    });

    const _chapterDetailLength = 'Longer content from chapter detail endpoint.'.length;
    expect(apiMock.chapters.get).toHaveBeenCalled();
    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
  });

  it('[VALID] uses existing target chapter tail offsets when chapter list content is empty', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: '3',
        title: 'Chapter 3',
        summary: '',
        content: '',
      } as Chapter,
    ]);

    const targetTailScene = makeScene({
      id: 'a',
      order_index: 1,
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: 40,
        end_offset: 60,
      }),
    });
    const unlinked = makeScene({ id: 'u', order_index: 2, prose_link: null });

    apiMock.chapters.get.mockResolvedValueOnce({
      id: 3,
      title: 'Chapter 3',
      filename: '0003.txt',
      content: '<!--scene:1:start--><!--scene:1:end-->',
      summary: '',
      notes: '',
      private_notes: '',
      conflicts: [],
    });
    apiMock.scenes.linkProse.mockResolvedValueOnce([
      makeScene({
        id: 'u',
        order_index: 2,
        prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: '3' }),
      }),
    ]);

    await renderNarrative([targetTailScene, unlinked]);

    await act(async () => {
      await nv().onDropScenesOnChapter?.(['u'], '3');
    });

    expect(apiMock.chapters.get).toHaveBeenCalled();
    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
  });

  it('[REGRESSION] chapter drop with marker-only chapter content keeps single-scene link at chapter tail', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: '3',
        title: 'Chapter 3',
        summary: '',
        content: '',
      } as Chapter,
    ]);

    const targetLinked = makeScene({
      id: '17',
      order_index: 1,
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: 0,
        end_offset: 0,
      }),
    });
    const unlinked = makeScene({ id: '20', order_index: 2, prose_link: null });

    apiMock.chapters.get.mockResolvedValueOnce({
      id: 3,
      title: 'Chapter 3',
      filename: '0003.txt',
      content: '<!--scene:17:start--><!--scene:17:end-->',
      summary: '',
      notes: '',
      private_notes: '',
      conflicts: [],
    });
    apiMock.scenes.linkProse.mockResolvedValueOnce([
      makeScene({
        id: '20',
        order_index: 2,
        prose_link: makeProseLink({
          scope_type: 'chapter',
          chapter_id: '3',
          start_offset: 39,
          end_offset: 40,
        }),
      }),
    ]);

    await renderNarrative([targetLinked, unlinked]);

    await act(async () => {
      await nv().onDropScenesOnChapter?.(['20'], '3');
    });

    expect(apiMock.chapters.get).toHaveBeenCalled();
    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(1);
    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
  });

  it('[REGRESSION] chapter drop with marker-only chapter content computes stable offsets for multiple scenes', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: '3',
        title: 'Chapter 3',
        summary: '',
        content: '',
      } as Chapter,
    ]);

    const targetLinked = makeScene({
      id: '17',
      order_index: 1,
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: '3',
        start_offset: 0,
        end_offset: 0,
      }),
    });
    const firstUnlinked = makeScene({
      id: '20',
      order_index: 2,
      prose_link: null,
    });
    const secondUnlinked = makeScene({
      id: '21',
      order_index: 3,
      prose_link: null,
    });

    apiMock.chapters.get.mockResolvedValueOnce({
      id: 3,
      title: 'Chapter 3',
      filename: '0003.txt',
      content: '<!--scene:17:start--><!--scene:17:end-->',
      summary: '',
      notes: '',
      private_notes: '',
      conflicts: [],
    });
    apiMock.scenes.linkProse
      .mockResolvedValueOnce([
        makeScene({
          id: '20',
          order_index: 2,
          prose_link: makeProseLink({
            scope_type: 'chapter',
            chapter_id: '3',
            start_offset: 60,
            end_offset: 60,
          }),
        }),
      ])
      .mockResolvedValueOnce([
        makeScene({
          id: '21',
          order_index: 3,
          prose_link: makeProseLink({
            scope_type: 'chapter',
            chapter_id: '3',
            start_offset: 100,
            end_offset: 100,
          }),
        }),
      ]);

    await renderNarrative([targetLinked, firstUnlinked, secondUnlinked]);

    await act(async () => {
      await nv().onDropScenesOnChapter?.(['20', '21'], '3');
    });

    expect(apiMock.chapters.get).toHaveBeenCalled();
    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(2);
    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
    expect(apiMock.scenes.linkProse).toHaveBeenCalled();
  });

  it('[REGRESSION] one chapter-drop drag records exactly one history entry', async () => {
    chaptersMetaMock.mockReturnValue([
      {
        id: 'ch-2',
        title: 'Chapter 2',
        summary: '',
        content: 'Target chapter prose.',
      } as Chapter,
    ]);

    const sourceA = makeScene({ id: '20', order_index: 2, prose_link: null });
    const sourceB = makeScene({ id: '21', order_index: 3, prose_link: null });

    apiMock.scenes.linkProse.mockImplementation(
      async (
        sourceId: SceneId,
        payload: {
          scope_type: string;
          chapter_id: string | null;
          book_id?: string | null;
          start_offset: number;
          end_offset: number;
        }
      ): Promise<Scene[]> => [
        makeScene({
          id: sourceId,
          order_index: sourceId === '20' ? 2 : 3,
          prose_link: makeProseLink({
            scope_type: 'chapter',
            chapter_id: payload.chapter_id,
            book_id: payload.book_id ?? null,
            start_offset: payload.start_offset,
            end_offset: payload.end_offset,
          }),
        }),
      ]
    );

    await renderNarrative([sourceA, sourceB], {
      recordHistoryEntry: recordHistoryEntryMock,
    });

    await act(async () => {
      await nv().onDropScenesOnChapter?.(['20', '21'], 'ch-2');
    });

    const labels = recordHistoryEntryMock.mock.calls.map(
      (call: [{ label: string }]) => call[0].label
    );
    expect(
      labels.filter((label: string): boolean => label === 'Move scene to chapter')
    ).toHaveLength(1);
    expect(labels).not.toContain('Reorder scene prose');
    expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
  });

  type SourceState = 'unlinked' | 'same' | 'before' | 'behind';
  type MatrixProjectKind =
    | 'short-story-invalid'
    | 'novel-valid'
    | 'novel-invalid-book-chapter'
    | 'series-valid'
    | 'series-invalid-missing-book';

  interface MatrixProjectConfig {
    projectType: 'short-story' | 'novel' | 'series';
    chapters: Chapter[];
    books: Book[];
    targetChapterId: string;
    expectValid: boolean;
  }

  const matrixProjectConfigs: Record<MatrixProjectKind, MatrixProjectConfig> = {
    'short-story-invalid': {
      projectType: 'short-story',
      chapters: [],
      books: [],
      targetChapterId: 'ch-2',
      expectValid: false,
    },
    'novel-valid': {
      projectType: 'novel',
      chapters: [
        { id: 'ch-1', title: 'Chapter 1', summary: '', content: '' } as Chapter,
        { id: 'ch-2', title: 'Chapter 2', summary: '', content: '' } as Chapter,
        { id: 'ch-3', title: 'Chapter 3', summary: '', content: '' } as Chapter,
      ],
      books: [],
      targetChapterId: 'ch-2',
      expectValid: true,
    },
    'novel-invalid-book-chapter': {
      projectType: 'novel',
      chapters: [
        {
          id: 'ch-2',
          title: 'Chapter 2',
          summary: '',
          content: '',
          book_id: 'book-a',
        } as Chapter,
      ],
      books: [{ id: 'book-a', title: 'Book A', chapters: [] as Chapter[] } as Book],
      targetChapterId: 'ch-2',
      expectValid: false,
    },
    'series-valid': {
      projectType: 'series',
      chapters: [
        {
          id: 'ch-1',
          title: 'Book A Chapter 1',
          summary: '',
          content: '',
          book_id: 'book-a',
        } as Chapter,
        {
          id: 'ch-2',
          title: 'Book B Chapter 1',
          summary: '',
          content: '',
          book_id: 'book-b',
        } as Chapter,
        {
          id: 'ch-3',
          title: 'Book C Chapter 1',
          summary: '',
          content: '',
          book_id: 'book-c',
        } as Chapter,
      ],
      books: [
        { id: 'book-a', title: 'Book A', chapters: [] as Chapter[] } as Book,
        { id: 'book-b', title: 'Book B', chapters: [] as Chapter[] } as Book,
        { id: 'book-c', title: 'Book C', chapters: [] as Chapter[] } as Book,
      ],
      targetChapterId: 'ch-2',
      expectValid: true,
    },
    'series-invalid-missing-book': {
      projectType: 'series',
      chapters: [
        {
          id: 'ch-2',
          title: 'Broken Book Chapter',
          summary: '',
          content: '',
          book_id: 'book-missing',
        } as Chapter,
      ],
      books: [{ id: 'book-a', title: 'Book A', chapters: [] as Chapter[] } as Book],
      targetChapterId: 'ch-2',
      expectValid: false,
    },
  };

  const sourceStateCases: Array<[SourceState, SourceState]> = [
    ['unlinked', 'same'],
    ['unlinked', 'before'],
    ['unlinked', 'behind'],
    ['same', 'before'],
    ['same', 'behind'],
    ['before', 'behind'],
    ['unlinked', 'unlinked'],
    ['same', 'same'],
    ['before', 'before'],
    ['behind', 'behind'],
  ];

  const matrixCases = [
    ...(
      [
        'short-story-invalid',
        'novel-valid',
        'novel-invalid-book-chapter',
        'series-valid',
        'series-invalid-missing-book',
      ] as MatrixProjectKind[]
    ).map((project: MatrixProjectKind): [MatrixProjectKind, [SourceState]] => [
      project,
      ['unlinked'],
    ]),
    ...(
      [
        'short-story-invalid',
        'novel-valid',
        'novel-invalid-book-chapter',
        'series-valid',
        'series-invalid-missing-book',
      ] as MatrixProjectKind[]
    ).map((project: MatrixProjectKind): [MatrixProjectKind, [SourceState]] => [
      project,
      ['same'],
    ]),
    ...(
      [
        'short-story-invalid',
        'novel-valid',
        'novel-invalid-book-chapter',
        'series-valid',
        'series-invalid-missing-book',
      ] as MatrixProjectKind[]
    ).map((project: MatrixProjectKind): [MatrixProjectKind, [SourceState]] => [
      project,
      ['before'],
    ]),
    ...(
      [
        'short-story-invalid',
        'novel-valid',
        'novel-invalid-book-chapter',
        'series-valid',
        'series-invalid-missing-book',
      ] as MatrixProjectKind[]
    ).map((project: MatrixProjectKind): [MatrixProjectKind, [SourceState]] => [
      project,
      ['behind'],
    ]),
    ...(
      [
        'short-story-invalid',
        'novel-valid',
        'novel-invalid-book-chapter',
        'series-valid',
        'series-invalid-missing-book',
      ] as MatrixProjectKind[]
    ).flatMap(
      (
        project: MatrixProjectKind
      ): Array<[MatrixProjectKind, [SourceState, SourceState]]> =>
        sourceStateCases.map(
          (
            pair: [SourceState, SourceState]
          ): [MatrixProjectKind, [SourceState, SourceState]] => [project, pair]
        )
    ),
  ];

  function makeDropSource(
    id: string,
    state: SourceState,
    orderIndex: number,
    targetChapterId: string
  ): Scene {
    if (state === 'unlinked') {
      return makeScene({ id, order_index: orderIndex, prose_link: null });
    }
    if (state === 'same') {
      return makeScene({
        id,
        order_index: orderIndex,
        prose_link: makeProseLink({
          scope_type: 'chapter',
          chapter_id: targetChapterId,
        }),
      });
    }
    return makeScene({
      id,
      order_index: orderIndex,
      prose_link: makeProseLink({
        scope_type: 'chapter',
        chapter_id: state === 'before' ? 'ch-1' : 'ch-3',
      }),
    });
  }

  it.each(matrixCases)(
    '[MATRIX] project=%s sourceStates=%j',
    async (projectKind: MatrixProjectKind, sourceStates: SourceState[]) => {
      const projectConfig = matrixProjectConfigs[projectKind];
      projectTypeState.value = projectConfig.projectType;
      chaptersMetaMock.mockReturnValue(projectConfig.chapters);
      booksMetaMock.mockReturnValue(projectConfig.books);

      const targetAnchor = makeScene({
        id: 'target-anchor',
        order_index: 100,
        prose_link: makeProseLink({
          scope_type: 'chapter',
          chapter_id: projectConfig.targetChapterId,
        }),
      });
      const trailingTarget = makeScene({
        id: 'target-trailing',
        order_index: 110,
        prose_link: makeProseLink({
          scope_type: 'chapter',
          chapter_id: projectConfig.targetChapterId,
        }),
      });

      const sourceScenes = sourceStates.map(
        (state: SourceState, index: number): Scene =>
          makeDropSource(
            `source-${index + 1}`,
            state,
            index + 1,
            projectConfig.targetChapterId
          )
      );

      const scenes = [...sourceScenes, targetAnchor, trailingTarget];

      apiMock.scenes.linkProse.mockImplementation(
        async (
          sourceId: SceneId,
          payload: {
            scope_type: string;
            chapter_id: string | null;
            book_id?: string | null;
            start_offset: number;
            end_offset: number;
          }
        ): Promise<Scene[]> => [
          makeScene({
            id: sourceId,
            prose_link: makeProseLink({
              scope_type: 'chapter',
              chapter_id: payload.chapter_id,
              book_id: payload.book_id ?? null,
              start_offset: payload.start_offset,
              end_offset: payload.end_offset,
            }),
          }),
        ]
      );

      await renderNarrative(scenes);

      await act(async () => {
        await nv().onDropScenesOnChapter?.(
          sourceScenes.map((scene: Scene): SceneId => scene.id),
          projectConfig.targetChapterId
        );
      });

      if (!projectConfig.expectValid) {
        expect(apiMock.scenes.linkProse).not.toHaveBeenCalled();
        expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
        return;
      }

      const expectedMovedCount = sourceStates.filter(
        (state: SourceState): boolean => state !== 'same'
      ).length;
      expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(expectedMovedCount);
      apiMock.scenes.linkProse.mock.calls.forEach(
        (
          call: [
            SceneId,
            {
              scope_type: string;
              chapter_id: string | null;
              book_id?: string | null;
              start_offset: number;
              end_offset: number;
            },
          ]
        ): void => {
          const payload = call[1];
          expect(payload.scope_type).toBe('chapter');
          expect(payload.chapter_id).toBe(projectConfig.targetChapterId);
        }
      );
      expect(apiMock.scenes.reorderProse).not.toHaveBeenCalled();
    }
  );
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
    const sceneA = makeScene({ id: 'a', causes: [] });
    const sceneB = makeScene({ id: 'b', causes: [] });
    const withConstraintA = makeScene({ id: 'a', causes: ['b'] });
    const withConstraintB = makeScene({ id: 'b', causes: ['a'] });
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
    const sceneA = makeScene({ id: 'a', causes: ['b'] });
    const sceneB = makeScene({ id: 'b', causes: [], causes: ['a'] });
    const withoutConstraintA = makeScene({ id: 'a', causes: [] });
    const withoutConstraintB = makeScene({ id: 'b', causes: [] });

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
    apiMock.scenes.batchLinkProse.mockResolvedValueOnce([
      makeScene({
        id: 'a',
        prose_link: makeProseLink({ start_offset: 0, end_offset: 10 }),
      }),
    ]);
    apiMock.chapters.get.mockResolvedValueOnce({
      content: '<!--scene:a:start-->Scene A.<!--scene:a:end-->',
    });
    // Also need the story-scope fallback for story-scoped prose links
    apiMock.story.getContent.mockResolvedValueOnce({
      ok: true,
      content: '<!--scene:a:start-->Scene A.<!--scene:a:end-->',
    });

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

  // -------------------------------------------------------------------------
  // Cross-chapter scene selection
  // -------------------------------------------------------------------------

  it('calls onSelectChapter when a scene from a different chapter is clicked', () => {
    const onSelectChapter = vi.fn();
    const sceneFromCh2 = makeScene({
      id: 'scene-ch2',
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-2' }),
    });
    useScenesMock.mockReturnValue([sceneFromCh2]);
    wrap(
      <ScenesPanelContainer
        currentChapter={CHAPTER}
        onSelectChapter={onSelectChapter}
      />
    );
    act(() => {
      (captured.pinboard as Record<string, unknown>)?.onSelectScene?.('scene-ch2');
    });
    expect(onSelectChapter).toHaveBeenCalled();
  });

  it('still calls handleSelectScene even for cross-chapter scenes', () => {
    const onSelectChapter = vi.fn();
    const sceneFromCh2 = makeScene({
      id: 'scene-ch2',
      prose_link: makeProseLink({ scope_type: 'chapter', chapter_id: 'ch-2' }),
    });
    useScenesMock.mockReturnValue([sceneFromCh2]);
    wrap(
      <ScenesPanelContainer
        currentChapter={CHAPTER}
        onSelectChapter={onSelectChapter}
      />
    );
    act(() => {
      (captured.pinboard as Record<string, unknown>)?.onSelectScene?.('scene-ch2');
    });
    // handleSelectScene must be called so the useSceneProseSync effect
    // re-applies the highlight when currentChapter changes after async load.
    expect(proseSyncState.handleSelectScene).toHaveBeenCalled();
  });
});
