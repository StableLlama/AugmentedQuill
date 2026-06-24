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

var patchSceneMock: ReturnType<typeof vi.fn>;
var recordHistoryEntryMock: ReturnType<typeof vi.fn>;
var setStoryMock: ReturnType<typeof vi.fn>;
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
        story: { sourcebook: unknown[] };
      }) => unknown
    ) =>
      selector({
        patchScene: patchSceneMock,
        setStory: setStoryMock,
        story: storyState,
      })
  );

  return {
    patchSceneMock,
    recordHistoryEntryMock,
    setStoryMock,
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
      story: { sourcebook: unknown[] };
    }) => unknown
  ) =>
    (
      useStoryStoreMock as unknown as (
        innerSelector: (state: {
          patchScene: unknown;
          setStory: unknown;
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
    expect(patchSceneMock).toHaveBeenCalledWith(created);
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
    expect(patchSceneMock).toHaveBeenCalledWith(updatedA);
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

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { from: 0, to: 14, insert: 'Refreshed scene prose' },
      })
    );
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

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ from: 0, to: 8 }),
      })
    );
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

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { from: 0, to: 10, insert: 'Refreshed scene prose' },
      })
    );
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

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { from: 0, to: 10, insert: 'Refreshed scene prose' },
      })
    );
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

    expect(apiMock.scenes.writeScene).toHaveBeenCalledWith('1', {
      scope_type: 'chapter',
      chapter_id: 'ch-2',
      book_id: null,
      include_following_scenes: 1,
      detect_boundaries: true,
    });
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
    const separatorLen = 1;

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

    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('u', {
      scope_type: 'chapter',
      chapter_id: 'ch-2',
      book_id: null,
      start_offset: 'Target chapter prose.'.length - 1,
      end_offset: 'Target chapter prose.'.length,
    });
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
    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith(
      'u',
      expect.objectContaining({
        scope_type: 'chapter',
        chapter_id: 'ch-2',
        book_id: null,
      })
    );
    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith(
      's',
      expect.objectContaining({
        scope_type: 'chapter',
        chapter_id: 'ch-2',
        book_id: null,
      })
    );
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

    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('u', {
      scope_type: 'chapter',
      chapter_id: 'ch-1',
      book_id: null,
      start_offset: 47,
      end_offset: 48,
    });
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

    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('s', {
      scope_type: 'chapter',
      chapter_id: 'ch-1',
      book_id: null,
      start_offset: 47,
      end_offset: 48,
    });
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

    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('u', {
      scope_type: 'chapter',
      chapter_id: 'ch-2',
      book_id: null,
      start_offset: 'Target chapter prose.'.length - 1,
      end_offset: 'Target chapter prose.'.length,
    });
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

    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('u', {
      scope_type: 'chapter',
      chapter_id: 'ch-2',
      book_id: null,
      start_offset: 0,
      end_offset: 1,
    });
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
    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith(
      'u',
      expect.objectContaining({
        scope_type: 'chapter',
        chapter_id: 'ch-2',
        book_id: null,
      })
    );
    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith(
      's',
      expect.objectContaining({
        scope_type: 'chapter',
        chapter_id: 'ch-2',
        book_id: null,
      })
    );
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

    const chapterDetailLength = 'Longer content from chapter detail endpoint.'.length;
    expect(apiMock.chapters.get).toHaveBeenCalledWith(3);
    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('u', {
      scope_type: 'chapter',
      chapter_id: '3',
      book_id: null,
      start_offset: chapterDetailLength - 1,
      end_offset: chapterDetailLength,
    });
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

    expect(apiMock.chapters.get).toHaveBeenCalledWith(3);
    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('u', {
      scope_type: 'chapter',
      chapter_id: '3',
      book_id: null,
      start_offset: 77,
      end_offset: 78,
    });
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

    expect(apiMock.chapters.get).toHaveBeenCalledWith(3);
    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(1);
    expect(apiMock.scenes.linkProse).toHaveBeenCalledWith('20', {
      scope_type: 'chapter',
      chapter_id: '3',
      book_id: null,
      start_offset: 39,
      end_offset: 40,
    });
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

    expect(apiMock.chapters.get).toHaveBeenCalledWith(3);
    expect(apiMock.scenes.linkProse).toHaveBeenCalledTimes(2);
    expect(apiMock.scenes.linkProse).toHaveBeenNthCalledWith(1, '20', {
      scope_type: 'chapter',
      chapter_id: '3',
      book_id: null,
      start_offset: 39,
      end_offset: 40,
    });
    expect(apiMock.scenes.linkProse).toHaveBeenNthCalledWith(2, '21', {
      scope_type: 'chapter',
      chapter_id: '3',
      book_id: null,
      start_offset: 99,
      end_offset: 100,
    });
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
    expect(onSelectChapter).toHaveBeenCalledWith('ch-2');
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
    expect(proseSyncState.handleSelectScene).toHaveBeenCalledWith('scene-ch2');
  });
});
