// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the useStory.test unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Scene, StoryState, Chapter, Book } from '../../types';

import { api } from '../../services/api';
import { resetStoryStore, useStoryStore } from '../../stores/storyStore';
import { useChatStore } from '../../stores/chatStore';
import {
  buildInitialStoryState,
  resolveExternalHistorySourceState,
  useStory,
} from './useStory';

vi.mock('../../services/api', () => {
  const scenesListMock = vi.fn();
  const chaptersListMock = vi.fn();
  const storyGetContentMock = vi.fn();
  const forProjectMock = vi.fn(() => ({
    chapters: { list: chaptersListMock },
    story: { getContent: storyGetContentMock },
    scenes: { list: scenesListMock },
  }));

  return {
    api: {
      projects: {
        list: vi.fn(),
        select: vi.fn(),
      },
      forProject: forProjectMock,
      chapters: {
        list: chaptersListMock,
        get: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
        updateContent: vi.fn(),
        updateTitle: vi.fn(),
        updateSummary: vi.fn(),
        updateMetadata: vi.fn(),
      },
      story: {
        updateMetadata: vi.fn(),
        updateContent: vi.fn(),
        getContent: storyGetContentMock,
      },
    },
  };
});

const buildStory = (summary: string): StoryState => ({
  id: 'demo',
  title: 'Demo',
  summary,
  styleTags: [],
  image_style: '',
  image_additional_info: '',
  chapters: [],
  projectType: 'novel',
  books: [],
  sourcebook: [],
  conflicts: [],
  currentChapterId: null,
  lastUpdated: 1,
  draft: null,
});

type StoryTestChapter = {
  id: string;
  title: string;
  summary: string;
  content: string;
  filename: string;
  book_id: string | undefined;
  notes: string;
  private_notes: string;
  conflicts: Array<{ id: string; description: string; resolution: string }>;
};

const buildChapter = (id: string, content: string): StoryTestChapter => ({
  id,
  title: `Chapter ${id}`,
  summary: '',
  content,
  filename: `ch${id}.md`,
  book_id: undefined,
  notes: '',
  private_notes: '',
  conflicts: [],
});

const baseHook = (): ReturnType<typeof useStory> =>
  useStory({ confirm: async () => true, alert: () => {} });

/** Render the hook and perform the initial loadStory so history starts clean. */
const hookWithStory = async (
  summary: string = 'initial',
  chapters: ReturnType<typeof buildChapter>[] = []
): Promise<ReturnType<typeof renderHook>> => {
  // The lazy-load useEffect inside useStory calls api.chapters.get whenever
  // currentChapterId changes.  A previous test in this file may have left a
  // mock that returns {content: ''}, which would silently overwrite the
  // content we just loaded.  Wire the mock to return the real content so the
  // overwrite is a no-op and baseline tests stay deterministic.
  const hook = renderHook(() => baseHook());
  vi.mocked(api.chapters.get).mockImplementation(async (id: number) => {
    const ch = chapters.find(
      (c: {
        id: string;
        title: string;
        summary: string;
        content: string;
        filename: string;
        book_id: string | undefined;
        notes: string;
        private_notes: string;
        conflicts: { id: string; description: string; resolution: string }[];
      }) => c.id === String(id)
    );
    return {
      content: ch?.content ?? '',
      notes: ch?.notes ?? '',
      private_notes: ch?.private_notes ?? '',
      conflicts: ch?.conflicts ?? [],
      title: ch?.title ?? '',
      summary: ch?.summary ?? '',
    } as unknown as Awaited<ReturnType<typeof api.chapters.get>>;
  });
  await act(async () => {
    hook.result.current.loadStory({
      ...buildStory(summary),
      id: '',
      chapters,
      currentChapterId: chapters[0]?.id ?? null,
    });
  });
  return hook;
};

// Reset Zustand store between tests to prevent state leaking across test cases.
beforeEach(() => {
  resetStoryStore();
  useChatStore.setState({
    sessionMutations: [],
  });
});

describe('resolveExternalHistorySourceState', () => {
  it('prefers latest in-memory story when explicit state is omitted', () => {
    const staleClosureState = buildStory('old summary');
    const latestLoadedState = buildStory('new summary from tool mutation');

    const selected = resolveExternalHistorySourceState(
      undefined,
      latestLoadedState,
      staleClosureState
    );

    expect(selected.summary).toBe('new summary from tool mutation');
  });

  it('uses explicit provided state when available', () => {
    const staleClosureState = buildStory('old summary');
    const latestLoadedState = buildStory('new summary');
    const explicitState = buildStory('explicit summary snapshot');

    const selected = resolveExternalHistorySourceState(
      explicitState,
      latestLoadedState,
      staleClosureState
    );

    expect(selected.summary).toBe('explicit summary snapshot');
  });
});

it('patchSourcebook updates the reactive story store immediately', async () => {
  vi.mocked(api.projects.list).mockResolvedValue({
    available: [],
    current: null,
  } as Awaited<ReturnType<typeof api.projects.list>>);
  vi.mocked(api.projects.select).mockResolvedValue({ ok: false } as Awaited<
    ReturnType<typeof api.projects.select>
  >);

  const hook = await hookWithStory('initial', [buildChapter('1', 'Hello')]);

  act(() => {
    useStoryStore.getState().setStory(
      (prev: StoryState): StoryState => ({
        ...prev,
        sourcebook: [
          {
            id: 'tt-1',
            name: '1985 -> 1955',
            description: 'Temporal jump',
            category: 'Time Travel',
            synonyms: [],
            images: [],
            destination_datetime: '1955-11-05T20:00:00Z',
            creates_new_timeline: false,
          },
        ],
      })
    );
  });

  act(() => {
    const changed = hook.result.current.patchSourcebook({
      id: 'tt-1',
      name: '1985 -> 1955',
      description: 'Temporal jump',
      category: 'Time Travel',
      synonyms: [],
      images: [],
      destination_datetime: '2015-10-21T16:29:00Z',
      creates_new_timeline: true,
    });
    expect(changed).toBe(true);
  });

  const updated = useStoryStore
    .getState()
    .story.sourcebook?.find((entry: SourcebookEntry): boolean => entry.id === 'tt-1');
  expect(updated?.destination_datetime).toBe('2015-10-21T16:29:00Z');
  expect(updated?.creates_new_timeline).toBe(true);
});

it('clears chat session mutation tags when undo is used', async () => {
  vi.mocked(api.projects.list).mockResolvedValue({
    available: [],
    current: null,
  } as Awaited<ReturnType<typeof api.projects.list>>);
  vi.mocked(api.projects.select).mockResolvedValue({ ok: false } as Awaited<
    ReturnType<typeof api.projects.select>
  >);

  const hook = await hookWithStory('initial', [buildChapter('1', 'Hello')]);
  useChatStore.setState({
    sessionMutations: [{ type: 'chapter', label: 'Updated chapter', targetId: '1' }],
  });

  await act(async () => {
    hook.result.current.pushExternalHistoryEntry({
      label: 'Manual history entry',
      forceNewHistory: true,
    });
  });

  await act(async () => {
    await hook.result.current.undo();
  });

  expect(useChatStore.getState().sessionMutations).toEqual([]);
});

// eslint-disable-next-line max-lines-per-function
describe('buildInitialStoryState', () => {
  it('hydrates story-level notes fields from selected project payload', () => {
    const state = buildInitialStoryState(
      'demo',
      {
        project_title: 'Demo',
        story_summary: 'Summary',
        notes: 'Story notes',
        private_notes: 'Private story notes',
      },
      []
    );

    expect(state.notes).toBe('Story notes');
    expect(state.private_notes).toBe('Private story notes');
  });

  it('defaults missing story-level notes fields to empty strings', () => {
    const state = buildInitialStoryState(
      'demo',
      {
        project_title: 'Demo',
        story_summary: 'Summary',
      },
      []
    );

    expect(state.notes).toBe('');
    expect(state.private_notes).toBe('');
  });

  it('supports multi-step undo/redo from external history entries', async () => {
    vi.mocked(api.projects.list).mockResolvedValue({
      available: [],
      current: null,
    } as unknown as Awaited<ReturnType<typeof api.projects.list>>);
    vi.mocked(api.projects.select).mockResolvedValue({
      ok: false,
    } as unknown as Awaited<ReturnType<typeof api.projects.select>>);
    vi.mocked(api.chapters.list).mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof api.chapters.list>>
    );
    vi.mocked(api.chapters.get).mockResolvedValue({
      content: '',
      notes: '',
      private_notes: '',
      conflicts: [],
      title: 'Intro',
      summary: 'initial',
    } as unknown as Awaited<ReturnType<typeof api.chapters.get>>);

    const { result } = renderHook(() =>
      useStory({
        confirm: async () => true,
        alert: () => {},
      })
    );

    act(() => {
      result.current.loadStory({
        ...buildStory('original'),
        id: 'demo',
        title: 'Demo',
      });
    });

    const onUndo1 = vi.fn(async () => {});
    const onRedo1 = vi.fn(async () => {});
    const onUndo2 = vi.fn(async () => {});
    const onRedo2 = vi.fn(async () => {});

    act(() => {
      result.current.pushExternalHistoryEntry({
        label: 'LLM change 1',
        state: { ...buildStory('first'), id: 'demo', title: 'Demo' },
        onUndo: onUndo1,
        onRedo: onRedo1,
      });
    });

    act(() => {
      result.current.pushExternalHistoryEntry({
        label: 'LLM change 2',
        state: { ...buildStory('second'), id: 'demo', title: 'Demo' },
        onUndo: onUndo2,
        onRedo: onRedo2,
      });
    });

    expect(result.current.story.summary).toBe('second');

    await act(async () => {
      await result.current.undoSteps(2);
    });

    expect(result.current.story.summary).toBe('original');
    expect(onUndo2).toHaveBeenCalledTimes(1);
    expect(onUndo1).toHaveBeenCalledTimes(1);
    expect(result.current.canRedo).toBe(true);

    await act(async () => {
      await result.current.redoSteps(2);
    });

    expect(result.current.story.summary).toBe('second');
    expect(onRedo1).toHaveBeenCalledTimes(1);
    expect(onRedo2).toHaveBeenCalledTimes(1);
  });

  it('supports undo/redo for scene-write style snapshots across project/scope matrices', async () => {
    vi.mocked(api.projects.list).mockResolvedValue({
      available: [],
      current: null,
    } as unknown as Awaited<ReturnType<typeof api.projects.list>>);
    vi.mocked(api.projects.select).mockResolvedValue({
      ok: false,
    } as unknown as Awaited<ReturnType<typeof api.projects.select>>);

    const buildMarkerDoc = (
      targetIndex: number,
      neighborsHaveText: boolean,
      targetText: string
    ): string => {
      const sceneIds = [1, 2, 3];
      return sceneIds
        .map((sceneId: number, index: number): string => {
          const prose =
            index === targetIndex
              ? targetText
              : neighborsHaveText
                ? `neighbor-${sceneId}`
                : '';
          return `<!--scene:${sceneId}:start-->${prose}<!--scene:${sceneId}:end-->`;
        })
        .join('\n');
    };

    const replaceScenePayload = (
      content: string,
      sceneId: number,
      nextText: string
    ): string =>
      content.replace(
        new RegExp(
          `<!--scene:${sceneId}:start-->[\\s\\S]*?<!--scene:${sceneId}:end-->`
        ),
        `<!--scene:${sceneId}:start-->${nextText}<!--scene:${sceneId}:end-->`
      );

    const withStableTimestamp = (state: StoryState): StoryState => ({
      ...state,
      // lastUpdated is managed by store mutations and can differ while content is identical.
      lastUpdated: 0,
    });

    type ProjectCase = {
      name: string;
      projectType: StoryState['projectType'];
      selectedChapterModes: Array<'same' | 'different'>;
      targetChapterId: string | null;
      targetBookId: string | null;
    };

    const projectCases: ProjectCase[] = [
      {
        name: 'short-story',
        projectType: 'short-story',
        selectedChapterModes: ['same'],
        targetChapterId: null,
        targetBookId: null,
      },
      {
        name: 'novel',
        projectType: 'novel',
        selectedChapterModes: ['same', 'different'],
        targetChapterId: '2',
        targetBookId: null,
      },
      {
        name: 'series-first-book',
        projectType: 'series',
        selectedChapterModes: ['same', 'different'],
        targetChapterId: '1',
        targetBookId: 'book-1',
      },
      {
        name: 'series-middle-book',
        projectType: 'series',
        selectedChapterModes: ['same', 'different'],
        targetChapterId: '1',
        targetBookId: 'book-2',
      },
      {
        name: 'series-last-book',
        projectType: 'series',
        selectedChapterModes: ['same', 'different'],
        targetChapterId: '1',
        targetBookId: 'book-3',
      },
    ];

    for (const projectCase of projectCases) {
      for (const targetIndex of [0, 1, 2]) {
        for (const neighborsHaveText of [false, true]) {
          for (const selectedChapterMode of projectCase.selectedChapterModes) {
            resetStoryStore();
            useChatStore.setState({ sessionMutations: [] });
            const hook = renderHook(() =>
              useStory({
                confirm: async () => true,
                alert: () => {},
              })
            );

            const targetSceneId = targetIndex + 1;
            const initialDoc = buildMarkerDoc(
              targetIndex,
              neighborsHaveText,
              `target-before-${targetSceneId}`
            );
            const generated = `generated-${projectCase.name}-${targetSceneId}-${neighborsHaveText ? 'neighbors' : 'empty'}-${selectedChapterMode}`;
            const updatedDoc = replaceScenePayload(
              initialDoc,
              targetSceneId,
              generated
            );

            const chapters =
              projectCase.projectType === 'short-story'
                ? []
                : [
                    {
                      id: '1',
                      title: 'Chapter 1',
                      summary: '',
                      content: 'chapter-1',
                      filename: '0001.txt',
                      book_id:
                        projectCase.projectType === 'series'
                          ? projectCase.targetBookId
                          : undefined,
                      notes: '',
                      private_notes: '',
                      conflicts: [],
                    },
                    {
                      id: '2',
                      title: 'Chapter 2',
                      summary: '',
                      content:
                        projectCase.targetChapterId === '2' ? initialDoc : 'chapter-2',
                      filename: '0002.txt',
                      book_id:
                        projectCase.projectType === 'series'
                          ? projectCase.targetBookId
                          : undefined,
                      notes: '',
                      private_notes: '',
                      conflicts: [],
                    },
                  ];

            const baseState: StoryState = {
              ...buildStory(`base-${projectCase.name}`),
              id: 'demo',
              title: 'Demo',
              projectType: projectCase.projectType,
              chapters,
              currentChapterId:
                projectCase.projectType === 'short-story'
                  ? null
                  : selectedChapterMode === 'same'
                    ? projectCase.targetChapterId
                    : '1',
              draft:
                projectCase.projectType === 'short-story'
                  ? {
                      id: 'story',
                      scope: 'story',
                      title: 'Demo',
                      summary: '',
                      content: initialDoc,
                      notes: '',
                      private_notes: '',
                      conflicts: [],
                      filename: 'content.md',
                    }
                  : null,
              books:
                projectCase.projectType === 'series'
                  ? [
                      {
                        id: 'book-1',
                        title: 'Book 1',
                        summary: '',
                        chapters: [
                          {
                            id: '1',
                            title: 'Book 1 Chapter 1',
                            summary: '',
                            content:
                              projectCase.targetBookId === 'book-1'
                                ? initialDoc
                                : 'book-1-chapter-1',
                            filename: '0001.txt',
                            book_id: 'book-1',
                            notes: '',
                            private_notes: '',
                            conflicts: [],
                          },
                        ],
                      },
                      {
                        id: 'book-2',
                        title: 'Book 2',
                        summary: '',
                        chapters: [
                          {
                            id: '1',
                            title: 'Book 2 Chapter 1',
                            summary: '',
                            content:
                              projectCase.targetBookId === 'book-2'
                                ? initialDoc
                                : 'book-2-chapter-1',
                            filename: '0001.txt',
                            book_id: 'book-2',
                            notes: '',
                            private_notes: '',
                            conflicts: [],
                          },
                        ],
                      },
                      {
                        id: 'book-3',
                        title: 'Book 3',
                        summary: '',
                        chapters: [
                          {
                            id: '1',
                            title: 'Book 3 Chapter 1',
                            summary: '',
                            content:
                              projectCase.targetBookId === 'book-3'
                                ? initialDoc
                                : 'book-3-chapter-1',
                            filename: '0001.txt',
                            book_id: 'book-3',
                            notes: '',
                            private_notes: '',
                            conflicts: [],
                          },
                        ],
                      },
                    ]
                  : [],
            };

            const nextState: StoryState = {
              ...baseState,
              chapters: baseState.chapters.map((chapter: Chapter) => {
                const isTargetChapter =
                  projectCase.projectType !== 'short-story' &&
                  chapter.id === projectCase.targetChapterId;
                return isTargetChapter ? { ...chapter, content: updatedDoc } : chapter;
              }),
              draft:
                projectCase.projectType === 'short-story' && baseState.draft
                  ? { ...baseState.draft, content: updatedDoc }
                  : baseState.draft,
            };

            vi.mocked(api.chapters.get).mockImplementation(async (id: number) => {
              const chapterId = String(id);
              const directChapter = baseState.chapters.find(
                (c: Chapter) => c.id === chapterId
              );
              const seriesChapter =
                directChapter ??
                baseState.books
                  .flatMap((book: Book) => book.chapters)
                  .find((chapter: Chapter) => chapter.id === chapterId);

              return {
                content: seriesChapter?.content ?? '',
                notes: seriesChapter?.notes ?? '',
                private_notes: seriesChapter?.private_notes ?? '',
                conflicts: seriesChapter?.conflicts ?? [],
                title: seriesChapter?.title ?? '',
                summary: seriesChapter?.summary ?? '',
              } as unknown as Awaited<ReturnType<typeof api.chapters.get>>;
            });

            await act(async () => {
              hook.result.current.loadStory(baseState);
            });

            act(() => {
              hook.result.current.pushExternalHistoryEntry({
                label: `scene-write-${projectCase.name}`,
                state: nextState,
                forceNewHistory: true,
              });
            });

            await act(async () => {
              await hook.result.current.undo();
            });
            expect(withStableTimestamp(hook.result.current.story)).toEqual(
              withStableTimestamp(baseState)
            );

            await act(async () => {
              await hook.result.current.redo();
            });
            expect(withStableTimestamp(hook.result.current.story)).toEqual(
              withStableTimestamp(nextState)
            );

            hook.unmount();
          }
        }
      }
    }
  });

  it('does not create history entries for repeated metadata autosaves but creates one final history entry on commit', async () => {
    const initialChapter = {
      id: '1',
      title: 'Intro',
      summary: 'initial',
      content: '',
      notes: '',
      private_notes: '',
      conflicts: [],
      path: '',
    };

    const { result } = renderHook(() =>
      useStory({
        confirm: async () => true,
        alert: () => {},
      })
    );

    act(() => {
      result.current.loadStory({
        ...buildStory('initial'),
        chapters: [initialChapter],
        currentChapterId: null,
      });
    });

    expect(result.current.historySize).toBe(1);

    // simulated autosave calls while metadata dialog is open
    await act(async () => {
      await result.current.updateChapter('1', { summary: 'interim' }, false, false);
      await result.current.updateChapter('1', { summary: 'final' }, false, false);
    });

    expect(result.current.historySize).toBe(1);
    expect(result.current.story.chapters[0].summary).toBe('final');

    // final commit on close should create one history entry, but no-op repetition should be ignored
    await act(async () => {
      await result.current.updateChapter('1', { summary: 'final' }, false, true);
    });

    expect(result.current.historySize).toBe(2);

    await act(async () => {
      await result.current.undoSteps(1);
    });

    expect(result.current.story.chapters[0].summary).toBe('initial');
    expect(result.current.canRedo).toBe(true);

    await act(async () => {
      await result.current.redoSteps(1);
    });

    expect(result.current.story.chapters[0].summary).toBe('final');
  });

  it('records a committed checkpoint when the same state is re-applied', async () => {
    const initialChapter = {
      id: '1',
      title: 'Intro',
      summary: 'a',
      content: '',
      notes: '',
      private_notes: '',
      conflicts: [],
      path: '',
    };

    const { result } = renderHook(() =>
      useStory({
        confirm: async () => true,
        alert: () => {},
      })
    );

    act(() => {
      result.current.loadStory({
        ...buildStory('a'),
        chapters: [initialChapter],
        currentChapterId: null,
      });
    });

    await act(async () => {
      await result.current.updateChapter('1', { summary: 'b' }, false, true);
    });

    expect(result.current.historySize).toBe(2);

    await act(async () => {
      await result.current.updateChapter('1', { summary: 'b' }, false, true);
    });

    expect(result.current.historySize).toBe(3);
  });

  it('preserves selected chapter when undoing after editing a later chapter', async () => {
    const first = buildChapter('1', 'First chapter');
    const second = buildChapter('2', 'Second chapter');
    const { result } = await hookWithStory('initial', [first, second]);

    act(() => {
      result.current.selectChapter('2');
    });

    await act(async () => {
      await result.current.updateChapter(
        '2',
        { content: 'Second chapter edited' },
        false,
        true,
        true
      );
    });

    expect(result.current.currentChapterId).toBe('2');

    await act(async () => {
      await result.current.undo();
    });

    expect(result.current.currentChapterId).toBe('2');
    expect(
      result.current.story.chapters.find((ch: { id: string }) => ch.id === '2')?.content
    ).toBe('Second chapter');
  });

  it('restores original chapter content when undoing a deletion', async () => {
    const chapter = buildChapter('1', 'Hello world');
    const { result } = await hookWithStory('initial', [chapter]);

    await act(async () => {
      await result.current.updateChapter('1', { content: 'Hello ' }, false, true, true);
    });

    expect(result.current.story.chapters[0]?.content).toBe('Hello ');

    await act(async () => {
      await result.current.undo();
    });

    expect(result.current.story.chapters[0]?.content).toBe('Hello world');
    expect(result.current.baselineState.chapters[0]?.content).toBe('Hello ');
  });

  it('preserves the pre-update baseline when pushing external history entries', async () => {
    const ch = buildChapter('1', 'Original content');
    const { result } = await hookWithStory('initial', [ch]);

    const updatedStory = {
      ...result.current.story,
      chapters: [{ ...ch, content: 'Original content + AI' }],
    };

    act(() => {
      result.current.pushExternalHistoryEntry({
        label: 'AI prose update',
        state: updatedStory,
      });
    });

    expect(result.current.story.chapters[0]?.content).toBe('Original content + AI');
    expect(result.current.baselineState.chapters[0]?.content).toBe('Original content');
  });

  it('syncs baselineState when the current chapter content is loaded lazily', async () => {
    const chapter = buildChapter('1', 'Loaded content');
    const { result } = await hookWithStory('initial', [chapter]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.story.chapters[0]?.content).toBe('Loaded content');
    expect(result.current.baselineState.chapters[0]?.content).toBe('Loaded content');
  });

  it('preserves the lazily loaded original chapter state in the undo stack', async () => {
    const chapter = {
      id: '1',
      title: 'Chapter 1',
      summary: '',
      content: '',
      filename: 'ch1.md',
      book_id: undefined as string | undefined,
      notes: '',
      private_notes: '',
      conflicts: [],
    };
    const hook = renderHook(() => baseHook());

    vi.mocked(api.chapters.get).mockResolvedValue({
      content: 'Hello world',
      notes: '',
      private_notes: '',
      conflicts: [],
      title: 'Chapter 1',
      summary: '',
    } as unknown as Awaited<ReturnType<typeof api.chapters.get>>);

    await act(async () => {
      hook.result.current.loadStory({
        ...buildStory('initial'),
        id: 'demo',
        title: 'Demo',
        chapters: [chapter],
        currentChapterId: '1',
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(hook.result.current.story.chapters[0]?.content).toBe('Hello world');
    expect(useStoryStore.getState().history[0].state.chapters[0]?.content).toBe(
      'Hello world'
    );

    await act(async () => {
      await hook.result.current.updateChapter(
        '1',
        { content: 'Hello ' },
        false,
        true,
        true
      );
    });

    expect(hook.result.current.story.chapters[0]?.content).toBe('Hello ');

    await act(async () => {
      await hook.result.current.undo();
    });

    expect(hook.result.current.story.chapters[0]?.content).toBe('Hello world');
    expect(useStoryStore.getState().history[0].state.chapters[0]?.content).toBe(
      'Hello world'
    );
  });

  it('merges undo/redo handlers into current history entry if state is unchanged', async () => {
    const { result } = renderHook(() =>
      useStory({
        confirm: async () => true,
        alert: () => {},
      })
    );

    act(() => {
      result.current.loadStory({
        ...buildStory('initial'),
        id: 'demo',
        title: 'Demo',
      });
    });

    expect(result.current.historySize).toBe(1);

    act(() => {
      result.current.pushExternalHistoryEntry({
        label: 'Second state',
        state: { ...buildStory('second'), id: 'demo' },
      });
    });

    expect(result.current.historySize).toBe(2);
    expect(result.current.historyIndex).toBe(1);

    const onUndo2 = vi.fn();
    // We have index 1 (second state). Now push same state with onUndo2.
    act(() => {
      result.current.pushExternalHistoryEntry({
        label: 'Third state (merged)',
        state: result.current.story,
        onUndo: onUndo2,
      });
    });

    // Verify it didn't grow
    expect(result.current.historySize).toBe(2);
    expect(result.current.historyIndex).toBe(1);

    await act(async () => {
      await result.current.undo();
    });

    // When undoing from index 1 -> 0, it calls history[1].onUndo.
    // Since we merged onUndo2 into history[1], it should be called.
    expect(onUndo2).toHaveBeenCalledTimes(1);
    expect(result.current.historyIndex).toBe(0);
  });

  it('persists short-story conflicts through story metadata updates', async () => {
    vi.mocked(api.story.updateMetadata).mockResolvedValue({
      ok: true,
    } as unknown as Awaited<ReturnType<typeof api.story.updateMetadata>>);

    const { result } = renderHook(() =>
      useStory({
        confirm: async () => true,
        alert: () => {},
      })
    );

    act(() => {
      result.current.loadStory({
        ...buildStory('Short summary'),
        id: 'shorty',
        title: 'Shorty',
        projectType: 'short-story',
        notes: 'Draft notes',
        private_notes: 'Private draft notes',
        conflicts: [],
        draft: {
          id: 'story',
          scope: 'story',
          title: 'Shorty',
          summary: 'Short summary',
          content: 'Draft body',
          notes: 'Draft notes',
          private_notes: 'Private draft notes',
          conflicts: [],
          filename: 'content.md',
        },
      });
    });

    const conflicts = [
      { id: 'conf-1', description: 'Storm hits the village', resolution: 'TBD' },
    ];

    await act(async () => {
      await result.current.updateStoryMetadata(
        'Shorty',
        'Short summary',
        [],
        'Draft notes',
        'Private draft notes',
        conflicts,
        'en'
      );
    });

    expect(result.current.story.conflicts).toEqual(conflicts);
    expect(result.current.story.draft?.conflicts).toEqual(conflicts);
    expect(api.story.updateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ conflicts })
    );
  });

  it('advances diff baseline on manual metadata updates so no diff is shown', async () => {
    vi.mocked(api.story.updateMetadata).mockResolvedValue({
      ok: true,
    } as unknown as Awaited<ReturnType<typeof api.story.updateMetadata>>);

    const { result } = await hookWithStory('Original summary');

    await act(async () => {
      await result.current.updateStoryMetadata(
        'Demo',
        'Edited summary',
        [],
        'Notes',
        'Private notes',
        [],
        'en'
      );
    });

    expect(result.current.story.summary).toBe('Edited summary');
    expect(result.current.baselineState.summary).toBe('Edited summary');
  });

  it('refreshes scenes after creating a chapter so stale prose links are cleared', async () => {
    vi.mocked(api.projects.list).mockResolvedValue({
      available: [],
      current: null,
    } as Awaited<ReturnType<typeof api.projects.list>>);
    vi.mocked(api.projects.select).mockResolvedValue({ ok: false } as Awaited<
      ReturnType<typeof api.projects.select>
    >);

    const staleScene = {
      id: 1,
      summary: 'Stale scene',
      prose_link: {
        scope_type: 'chapter',
        chapter_id: '1',
        book_id: null,
        start_offset: 0,
        end_offset: 5,
        content_hash: 'hash',
        is_stale: false,
      },
      order_index: 1,
      beats: [],
      active_characters: [],
      passive_characters: [],
      sourcebook_entry_ids: [],
      causes: [],
      causes: [],
      scene_time: null,
      timeline_id: 'main',
      tag_personal_datetimes: [],
      pinboard_x: 100,
      pinboard_y: 100,
      status: 'active',
    } as unknown as Scene;

    const unlinkedScene = {
      ...staleScene,
      prose_link: null,
    } as Scene;

    vi.mocked(api.chapters.create).mockResolvedValue({
      ok: true,
      id: 1,
      title: 'New Chapter',
    } as Awaited<ReturnType<typeof api.chapters.create>>);
    vi.mocked(api.chapters.list).mockResolvedValue({
      chapters: [
        {
          id: 1,
          title: 'New Chapter',
          summary: '',
          filename: '0001.txt',
        },
      ],
    } as Awaited<ReturnType<typeof api.chapters.list>>);
    vi.mocked(api.forProject('demo').scenes.list).mockResolvedValue([unlinkedScene]);

    const { result } = renderHook(() =>
      useStory({
        confirm: async () => true,
        alert: () => {},
      })
    );

    act(() => {
      result.current.loadStory({
        ...buildStory('initial'),
        id: 'demo',
        title: 'Demo',
        chapters: [],
        scenes: [staleScene],
      });
    });

    await act(async () => {
      await result.current.addChapter('New Chapter');
    });

    expect(result.current.story.scenes[0]?.prose_link).toBeNull();
  });

  it('refreshes scenes after deleting a chapter so stale prose links are cleared', async () => {
    vi.mocked(api.projects.list).mockResolvedValue({
      available: [],
      current: null,
    } as Awaited<ReturnType<typeof api.projects.list>>);
    vi.mocked(api.projects.select).mockResolvedValue({ ok: false } as Awaited<
      ReturnType<typeof api.projects.select>
    >);

    const staleScene = {
      id: 1,
      summary: 'Stale scene',
      prose_link: {
        scope_type: 'chapter',
        chapter_id: '1',
        book_id: null,
        start_offset: 0,
        end_offset: 5,
        content_hash: 'hash',
        is_stale: false,
      },
      order_index: 1,
      beats: [],
      active_characters: [],
      passive_characters: [],
      sourcebook_entry_ids: [],
      causes: [],
      causes: [],
      scene_time: null,
      timeline_id: 'main',
      tag_personal_datetimes: [],
      pinboard_x: 100,
      pinboard_y: 100,
      status: 'active',
    } as unknown as Scene;

    const unlinkedScene = {
      ...staleScene,
      prose_link: null,
    } as Scene;

    vi.mocked(api.chapters.delete).mockResolvedValue({
      ok: true,
    } as Awaited<ReturnType<typeof api.chapters.delete>>);
    vi.mocked(api.chapters.list).mockResolvedValue({
      chapters: [],
    } as Awaited<ReturnType<typeof api.chapters.list>>);
    vi.mocked(api.forProject('demo').scenes.list).mockResolvedValue([unlinkedScene]);

    const { result } = renderHook(() =>
      useStory({
        confirm: async () => true,
        alert: () => {},
      })
    );

    act(() => {
      result.current.loadStory({
        ...buildStory('initial'),
        id: 'demo',
        title: 'Demo',
        chapters: [buildChapter('1', 'chapter')],
        scenes: [staleScene],
        currentChapterId: '1',
      });
    });

    await act(async () => {
      await result.current.deleteChapter('1');
    });

    expect(result.current.story.scenes[0]?.prose_link).toBeNull();
  });
});

// ─── baselineState diff highlighting ─────────────────────────────────────────
//
// Rules:
//  - AI/external push  → baseline = state BEFORE the push (shows new text)
//  - User-edit push    → baseline = state AFTER  the push (no highlight)
//  - undo              → baseline = state we left (shows restored text)
//  - redo              → baseline = state we left (shows re-inserted text)
//  - loadStory         → baseline = the loaded state (no highlight)

describe('baselineState diff highlighting', () => {
  it('starts with baseline equal to current state (no highlight on load)', async () => {
    const ch = buildChapter('1', 'Hello world');
    const { result } = await hookWithStory('initial', [ch]);

    expect(result.current.baselineState.chapters[0]?.content).toBe('Hello world');
    expect(result.current.story.chapters[0]?.content).toBe('Hello world');
  });

  it('sets baseline to pre-push state when AI pushes new chapter content', async () => {
    const ch = buildChapter('1', 'Hello world');
    const { result } = await hookWithStory('initial', [ch]);

    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'Hello world with AI paragraph' },
        false, // no server sync in tests
        true, // push history
        false // NOT a user edit → AI
      );
    });

    // Baseline should still hold the pre-AI content
    expect(result.current.baselineState.chapters[0]?.content).toBe('Hello world');
    // Current story has the new content
    expect(result.current.story.chapters[0]?.content).toBe(
      'Hello world with AI paragraph'
    );
  });

  it('sets baseline to new state when user types (no highlight)', async () => {
    const ch = buildChapter('1', 'Hello world');
    const { result } = await hookWithStory('initial', [ch]);

    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'Hello world edited by user' },
        false,
        true,
        true // IS a user edit
      );
    });

    // Baseline == current state: nothing would be highlighted
    expect(result.current.baselineState.chapters[0]?.content).toBe(
      'Hello world edited by user'
    );
    expect(result.current.story.chapters[0]?.content).toBe(
      'Hello world edited by user'
    );
  });

  it('highlights only the second AI addition after two sequential AI pushes', async () => {
    const ch = buildChapter('1', 'Para 1');
    const { result } = await hookWithStory('initial', [ch]);

    // First AI push
    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'Para 1\nPara 2' },
        false,
        true,
        false
      );
    });
    // Second AI push
    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'Para 1\nPara 2\nPara 3' },
        false,
        true,
        false
      );
    });

    // Baseline should be the state after the FIRST push
    expect(result.current.baselineState.chapters[0]?.content).toBe('Para 1\nPara 2');
    expect(result.current.story.chapters[0]?.content).toBe('Para 1\nPara 2\nPara 3');
  });

  it('sets baseline to the left-behind state when undoing an AI change', async () => {
    const ch = buildChapter('1', 'Original');
    const { result } = await hookWithStory('initial', [ch]);

    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'Original + AI' },
        false,
        true,
        false
      );
    });

    // Undo — baseline should become the AI state we just left
    await act(async () => {
      await result.current.undo();
    });

    expect(result.current.story.chapters[0]?.content).toBe('Original');
    expect(result.current.baselineState.chapters[0]?.content).toBe('Original + AI');
  });

  it('sets baseline to the left-behind state when undoing a user edit', async () => {
    const ch = buildChapter('1', 'Original');
    const { result } = await hookWithStory('initial', [ch]);

    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'User typed this' },
        false,
        true,
        true
      );
    });

    await act(async () => {
      await result.current.undo();
    });

    // After undo, current = Original; baseline = what we left = user-typed text
    expect(result.current.story.chapters[0]?.content).toBe('Original');
    expect(result.current.baselineState.chapters[0]?.content).toBe('User typed this');
  });

  it('sets baseline to the left-behind state when redoing an AI change', async () => {
    const ch = buildChapter('1', 'Original');
    const { result } = await hookWithStory('initial', [ch]);

    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'Original + AI' },
        false,
        true,
        false
      );
    });
    await act(async () => {
      await result.current.undo();
    });
    // Now redo
    await act(async () => {
      await result.current.redo();
    });

    // After redo, current = 'Original + AI'; baseline = what we left = 'Original'
    expect(result.current.story.chapters[0]?.content).toBe('Original + AI');
    expect(result.current.baselineState.chapters[0]?.content).toBe('Original');
  });

  it('sets baseline to the left-behind state when redoing a user edit', async () => {
    const ch = buildChapter('1', 'Original');
    const { result } = await hookWithStory('initial', [ch]);

    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'User edit' },
        false,
        true,
        true
      );
    });
    await act(async () => {
      await result.current.undo();
    });
    await act(async () => {
      await result.current.redo();
    });

    expect(result.current.story.chapters[0]?.content).toBe('User edit');
    expect(result.current.baselineState.chapters[0]?.content).toBe('Original');
  });

  it('resets baseline to loaded state (no highlight) when loadStory is called', async () => {
    const ch = buildChapter('1', 'Before load');
    const { result } = await hookWithStory('initial', [ch]);

    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'AI change' },
        false,
        true,
        false
      );
    });

    // Load a completely fresh story
    const freshCh = buildChapter('1', 'Fresh content');
    act(() => {
      result.current.loadStory({
        ...buildStory('fresh'),
        chapters: [freshCh],
        currentChapterId: '1',
      });
    });

    expect(result.current.story.chapters[0]?.content).toBe('Fresh content');
    expect(result.current.baselineState.chapters[0]?.content).toBe('Fresh content');
  });

  it('after undo then new AI push, shows baseline relative to the undo target', async () => {
    const ch = buildChapter('1', 'v1');
    const { result } = await hookWithStory('initial', [ch]);

    // AI writes v2
    await act(async () => {
      await result.current.updateChapter('1', { content: 'v2' }, false, true, false);
    });
    // User undoes back to v1
    await act(async () => {
      await result.current.undo();
    });
    // AI writes v3 from v1
    await act(async () => {
      await result.current.updateChapter('1', { content: 'v3' }, false, true, false);
    });

    // Baseline should be v1 (state before the new AI push)
    expect(result.current.story.chapters[0]?.content).toBe('v3');
    expect(result.current.baselineState.chapters[0]?.content).toBe('v1');
  });

  it('multi-step undo highlights each intermediate state correctly', async () => {
    const ch = buildChapter('1', 'v1');
    const { result } = await hookWithStory('initial', [ch]);

    await act(async () => {
      await result.current.updateChapter('1', { content: 'v2' }, false, true, false);
    });
    await act(async () => {
      await result.current.updateChapter('1', { content: 'v3' }, false, true, false);
    });

    // Jump back 2 steps at once
    await act(async () => {
      await result.current.undoSteps(2);
    });

    // We left 'v3' (the most recent state before jumping), so baseline = v3
    expect(result.current.story.chapters[0]?.content).toBe('v1');
    expect(result.current.baselineState.chapters[0]?.content).toBe('v3');
  });

  it('user edit after AI change clears the highlight (baseline advances)', async () => {
    const ch = buildChapter('1', 'Original');
    const { result } = await hookWithStory('initial', [ch]);

    // AI adds content
    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'Original + AI' },
        false,
        true,
        false
      );
    });

    expect(result.current.baselineState.chapters[0]?.content).toBe('Original');

    // User edits: highlight should disappear (baseline = new state)
    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'Original + AI + user' },
        false,
        true,
        true
      );
    });

    expect(result.current.baselineState.chapters[0]?.content).toBe(
      'Original + AI + user'
    );
  });
});

// ─── advanceBaselineToCurrentStory ───────────────────────────────────────────

describe('advanceBaselineToCurrentStory', () => {
  it('advances the baseline to the current story state so the next AI turn diffs correctly', async () => {
    const ch = buildChapter('1', 'Hello world');
    const { result } = await hookWithStory('initial', [ch]);

    // Simulate an AI operation: add new sourcebook entry (via setStory directly,
    // mimicking what refreshStory does when called without a historyLabel).
    const storyWithSb = {
      ...result.current.story,
      sourcebook: [
        {
          id: 'hero',
          name: 'Hero',
          description: 'A brave hero',
          synonyms: [],
          images: [],
          keywords: [],
        },
      ],
    };
    act(() => {
      result.current.loadStory(storyWithSb);
    });
    // loadStory also advances baseline, so manually simulate just the
    // setStory path by calling pushExternalHistoryEntry.
    act(() => {
      result.current.pushExternalHistoryEntry({ label: 'AI: Create Hero' });
    });

    // At this point baseline should reflect the state at load, which included
    // the sourcebook entry.  Now advance baseline to simulate starting a new
    // chat turn.
    act(() => {
      result.current.advanceBaselineToCurrentStory();
    });

    // After advancing, baseline matches current story — no diff should show.
    expect(result.current.baselineState.sourcebook).toEqual(
      result.current.story.sourcebook
    );
  });

  it('after advancing baseline, a subsequent AI change shows the correct diff', async () => {
    const ch = buildChapter('1', 'Original');
    const { result } = await hookWithStory('initial', [ch]);

    // First AI turn: updates chapter content.
    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'AI turn 1' },
        false,
        true,
        false
      );
    });

    // Simulate what onChatNewMessageBegin does: advance baseline before next turn.
    act(() => {
      result.current.advanceBaselineToCurrentStory();
    });

    // Now baseline = 'AI turn 1'.
    expect(result.current.baselineState.chapters[0]?.content).toBe('AI turn 1');

    // Second AI turn: further changes.
    await act(async () => {
      await result.current.updateChapter(
        '1',
        { content: 'AI turn 2' },
        false,
        true,
        false
      );
    });

    // Diff should be between 'AI turn 1' (baseline) and 'AI turn 2' (current).
    expect(result.current.story.chapters[0]?.content).toBe('AI turn 2');
    expect(result.current.baselineState.chapters[0]?.content).toBe('AI turn 1');
  });
});

// ---------------------------------------------------------------------------
// fetchStory scene loading
// ---------------------------------------------------------------------------

describe('fetchStory: scene loading on project open', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const buildSelectResponse = () => ({
    ok: true,
    story: {
      project_type: 'novel',
      title: 'Test Project',
      summary: '',
      style_tags: [],
      image_style: '',
      image_additional_info: '',
      notes: '',
      private_notes: '',
      conflicts: [],
      books: [],
      sourcebook: [],
    },
  });

  const buildScenes = (): Scene[] => [
    {
      id: 'scene-1',
      summary: 'First scene',
      beats: [],
      prose_link: null,
      active_characters: [],
      passive_characters: [],
      pinboard_x: 0,
      pinboard_y: 0,
      causes: [],
      causes: [],
    },
    {
      id: 'scene-2',
      summary: 'Second scene',
      beats: [],
      prose_link: {
        scope_type: 'chapter',
        chapter_id: 'ch1',
        start_offset: 0,
        end_offset: 50,
        content_hash: 'abc',
      },
      active_characters: [],
      passive_characters: [],
      pinboard_x: 100,
      pinboard_y: 100,
      causes: [],
      causes: [],
    },
  ];

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const setupForFetch = (scenes: Scene[]) => {
    vi.mocked(api.projects.list).mockResolvedValue({
      available: ['my-project'],
      current: 'my-project',
    } as unknown as Awaited<ReturnType<typeof api.projects.list>>);

    vi.mocked(api.projects.select).mockResolvedValue(
      buildSelectResponse() as unknown as Awaited<
        ReturnType<typeof api.projects.select>
      >
    );

    const chaptersListMock = vi.fn().mockResolvedValue({ chapters: [] });
    const storyGetContentMock = vi.fn().mockResolvedValue({ content: '' });
    const scenesListMock = vi.fn().mockResolvedValue(scenes);

    vi.mocked(api.forProject).mockReturnValue({
      chapters: { list: chaptersListMock },
      story: { getContent: storyGetContentMock },
      scenes: { list: scenesListMock },
    } as unknown as ReturnType<typeof api.forProject>);

    return { scenesListMock };
  };

  it('populates store scenes when project is loaded for the first time (page reload)', async () => {
    const scenes = buildScenes();
    setupForFetch(scenes);

    const { result } = renderHook(() => useStory());

    // fetchStory is triggered by hasFetchedRef on mount; wait for async work.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.story.scenes).toHaveLength(2);
    expect(result.current.story.scenes[0].id).toBe('scene-1');
    expect(result.current.story.scenes[1].id).toBe('scene-2');
  });

  it('populates store with empty array when project has no scenes', async () => {
    setupForFetch([]);

    const { result } = renderHook(() => useStory());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.story.scenes).toEqual([]);
  });

  it('tolerates a scenes.list failure and stores an empty array', async () => {
    vi.mocked(api.projects.list).mockResolvedValue({
      available: ['my-project'],
      current: 'my-project',
    } as unknown as Awaited<ReturnType<typeof api.projects.list>>);

    vi.mocked(api.projects.select).mockResolvedValue(
      buildSelectResponse() as unknown as Awaited<
        ReturnType<typeof api.projects.select>
      >
    );

    vi.mocked(api.forProject).mockReturnValue({
      chapters: { list: vi.fn().mockResolvedValue({ chapters: [] }) },
      story: { getContent: vi.fn().mockResolvedValue({ content: '' }) },
      scenes: { list: vi.fn().mockRejectedValue(new Error('network error')) },
    } as unknown as ReturnType<typeof api.forProject>);

    const { result } = renderHook(() => useStory());

    await act(async () => {
      await Promise.resolve();
    });

    // A failure must not crash the app — scenes defaults to [].
    expect(result.current.story.scenes).toEqual([]);
  });

  it('calls scenes.list exactly once per project load', async () => {
    const scenes = buildScenes();
    const { scenesListMock } = setupForFetch(scenes);

    renderHook(() => useStory());

    await act(async () => {
      await Promise.resolve();
    });

    // Each project open must trigger exactly one scenes.list call.
    expect(scenesListMock).toHaveBeenCalledTimes(1);
  });

  it('keeps scenes populated after refreshStory (no full reload required)', async () => {
    const scenes = buildScenes();
    setupForFetch(scenes);

    const { result } = renderHook(() => useStory());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.story.scenes).toHaveLength(2);

    await act(async () => {
      await result.current.refreshStory();
    });

    expect(result.current.story.scenes).toHaveLength(2);
    expect(result.current.story.scenes[0].id).toBe('scene-1');
    expect(result.current.story.scenes[1].id).toBe('scene-2');
  });

  it('preserves existing scenes when refreshStory scenes.list fails', async () => {
    const scenes = buildScenes();
    const { scenesListMock } = setupForFetch(scenes);

    const { result } = renderHook(() => useStory());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.story.scenes).toHaveLength(2);

    scenesListMock.mockRejectedValueOnce(new Error('refresh failed'));

    await act(async () => {
      await result.current.refreshStory();
    });

    expect(result.current.story.scenes).toHaveLength(2);
    expect(result.current.story.scenes[0].id).toBe('scene-1');
    expect(result.current.story.scenes[1].id).toBe('scene-2');
  });
});
