// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Zustand store for all UI panel and dialog state. Eliminates the
 * trigger-counter anti-pattern (incrementing integers used to open/close
 * dialogs) and moves panel open/close state out of App.tsx so it no longer
 * participates in the story-state re-render cascade.
 *
 * Panel state is persisted to localStorage via Zustand's persist middleware.
 */

import { create, StoreApi } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { MetadataTab, SceneId, ViewMode } from '../types';

// ---------------------------------------------------------------------------
// Dialog state types
// ---------------------------------------------------------------------------

export interface MetadataDialogState {
  isOpen: boolean;
  /** increments on every open so the dialog component key-resets its state */
  version: number;
  initialTab?: MetadataTab;
}

export interface SourcebookDialogState {
  isOpen: boolean;
  version: number;
  entryId: string | null;
}

export interface ChapterMetadataDialogState {
  isOpen: boolean;
  version: number;
  chapterId: string | null;
  initialTab?: MetadataTab;
}

export interface SceneEditorDialogState {
  isOpen: boolean;
  version: number;
  sceneId: SceneId | null;
  openedViaTrigger: boolean;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface UIStoreState {
  // ── Panel visibility ──────────────────────────────────────────────────────
  isChatOpen: boolean;
  isSidebarOpen: boolean;
  isAppearanceOpen: boolean;
  isSettingsOpen: boolean;
  isImagesOpen: boolean;
  isDebugLogsOpen: boolean;

  // ── Dialog state (replaces trigger-counter pattern) ───────────────────────
  metadataDialog: MetadataDialogState;
  sourcebookDialog: SourcebookDialogState;
  chapterMetadataDialog: ChapterMetadataDialogState;
  sceneEditorDialog: SceneEditorDialogState;

  // ── Editor UI flags ───────────────────────────────────────────────────────
  viewMode: ViewMode;
  workspaceMode: 'page' | 'scenes' | 'split';
  showWhitespace: boolean;
  activeFormats: string[];
  isViewMenuOpen: boolean;
  isFormatMenuOpen: boolean;
  isMobileFormatMenuOpen: boolean;

  sceneLaneState: {
    visibleLaneEntryIds: string[];
    removedReferencedLaneIds: string[];
  };
  setSceneLaneState: (
    state:
      | {
          visibleLaneEntryIds: string[];
          removedReferencedLaneIds: string[];
        }
      | ((prev: {
          visibleLaneEntryIds: string[];
          removedReferencedLaneIds: string[];
        }) => {
          visibleLaneEntryIds: string[];
          removedReferencedLaneIds: string[];
        })
  ) => void;

  // ── Actions ───────────────────────────────────────────────────────────────
  setIsChatOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setIsSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setIsAppearanceOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setIsSettingsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setIsImagesOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setIsDebugLogsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;

  openMetadataDialog: (initialTab?: MetadataTab) => void;
  closeMetadataDialog: () => void;
  openSourcebookDialog: (entryId: string) => void;
  closeSourcebookDialog: () => void;
  openChapterMetadataDialog: (chapterId: string, initialTab?: MetadataTab) => void;
  closeChapterMetadataDialog: () => void;
  openSceneEditorDialog: (sceneId: SceneId, openedViaTrigger?: boolean) => void;
  closeSceneEditorDialog: () => void;

  setWorkspaceMode: (
    mode:
      | 'page'
      | 'scenes'
      | 'split'
      | ((prev: 'page' | 'scenes' | 'split') => 'page' | 'scenes' | 'split')
  ) => void;
  setViewMode: (mode: ViewMode | ((prev: ViewMode) => ViewMode)) => void;
  setShowWhitespace: (show: boolean | ((prev: boolean) => boolean)) => void;
  setActiveFormats: (formats: string[] | ((prev: string[]) => string[])) => void;
  setIsViewMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setIsFormatMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setIsMobileFormatMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
}

// ---------------------------------------------------------------------------
// Helper to resolve functional updaters
// ---------------------------------------------------------------------------

function resolve<T>(valueOrUpdater: T | ((prev: T) => T), prev: T): T {
  return typeof valueOrUpdater === 'function'
    ? (valueOrUpdater as (prev: T) => T)(prev)
    : valueOrUpdater;
}

// ---------------------------------------------------------------------------
// Store (panel state persisted, dialog + editor flags not persisted)
// ---------------------------------------------------------------------------

export const useUIStore = create<UIStoreState>()(
  persist(
    (
      set: StoreApi<UIStoreState>['setState'],
      _get: StoreApi<UIStoreState>['getState']
    ) => ({
      // ── Panel state (persisted) ──────────────────────────────────────────
      isChatOpen: true,
      isSidebarOpen: false,
      isAppearanceOpen: false,
      isSettingsOpen: false,
      isImagesOpen: false,
      isDebugLogsOpen: false,

      // ── Dialogs (not persisted – reset on page load) ─────────────────────
      metadataDialog: { isOpen: false, version: 0 },
      sourcebookDialog: { isOpen: false, version: 0, entryId: null },
      chapterMetadataDialog: {
        isOpen: false,
        version: 0,
        chapterId: null,
        initialTab: undefined,
      },
      sceneEditorDialog: {
        isOpen: false,
        version: 0,
        sceneId: null,
        openedViaTrigger: false,
      },

      // ── Editor UI flags (not persisted) ─────────────────────────────────
      viewMode: 'raw' as ViewMode,
      workspaceMode: 'page' as 'page' | 'scenes' | 'split',
      showWhitespace: false,
      activeFormats: [] as string[],
      isViewMenuOpen: false,
      isFormatMenuOpen: false,
      isMobileFormatMenuOpen: false,
      sceneLaneState: {
        visibleLaneEntryIds: [],
        removedReferencedLaneIds: [],
      },

      // ── Panel actions ────────────────────────────────────────────────────
      setIsChatOpen: (v: boolean | ((prev: boolean) => boolean)) =>
        set((s: UIStoreState): { isChatOpen: boolean } => ({
          isChatOpen: resolve(v, s.isChatOpen),
        })),
      setIsSidebarOpen: (v: boolean | ((prev: boolean) => boolean)) =>
        set((s: UIStoreState): { isSidebarOpen: boolean } => ({
          isSidebarOpen: resolve(v, s.isSidebarOpen),
        })),
      setIsAppearanceOpen: (v: boolean | ((prev: boolean) => boolean)) =>
        set((s: UIStoreState): { isAppearanceOpen: boolean } => ({
          isAppearanceOpen: resolve(v, s.isAppearanceOpen),
        })),
      setIsSettingsOpen: (v: boolean | ((prev: boolean) => boolean)) =>
        set((s: UIStoreState): { isSettingsOpen: boolean } => ({
          isSettingsOpen: resolve(v, s.isSettingsOpen),
        })),
      setIsImagesOpen: (v: boolean | ((prev: boolean) => boolean)) =>
        set((s: UIStoreState): { isImagesOpen: boolean } => ({
          isImagesOpen: resolve(v, s.isImagesOpen),
        })),
      setIsDebugLogsOpen: (v: boolean | ((prev: boolean) => boolean)) =>
        set((s: UIStoreState): { isDebugLogsOpen: boolean } => ({
          isDebugLogsOpen: resolve(v, s.isDebugLogsOpen),
        })),

      // ── Dialog actions ───────────────────────────────────────────────────
      openMetadataDialog: (initialTab?: MetadataTab) =>
        set(
          (
            s: UIStoreState
          ): {
            metadataDialog: {
              isOpen: boolean;
              version: number;
              initialTab: MetadataTab | undefined;
            };
          } => ({
            metadataDialog: {
              isOpen: true,
              version: s.metadataDialog.version + 1,
              initialTab,
            },
          })
        ),

      closeMetadataDialog: () =>
        set(
          (
            s: UIStoreState
          ): {
            metadataDialog: {
              isOpen: boolean;
              version: number;
              initialTab?: MetadataTab | undefined;
            };
          } => ({
            metadataDialog: { ...s.metadataDialog, isOpen: false },
          })
        ),

      openSourcebookDialog: (entryId: string) =>
        set(
          (
            s: UIStoreState
          ): {
            sourcebookDialog: { isOpen: boolean; version: number; entryId: string };
          } => ({
            sourcebookDialog: {
              isOpen: true,
              version: s.sourcebookDialog.version + 1,
              entryId,
            },
          })
        ),

      closeSourcebookDialog: () =>
        set(
          (
            s: UIStoreState
          ): {
            sourcebookDialog: {
              isOpen: boolean;
              version: number;
              entryId: string | null;
            };
          } => ({
            sourcebookDialog: { ...s.sourcebookDialog, isOpen: false },
          })
        ),
      openChapterMetadataDialog: (chapterId: string, initialTab?: MetadataTab) =>
        set((s: UIStoreState) => ({
          chapterMetadataDialog: {
            isOpen: true,
            version: s.chapterMetadataDialog.version + 1,
            chapterId,
            initialTab,
          },
        })),
      closeChapterMetadataDialog: () =>
        set((s: UIStoreState) => ({
          chapterMetadataDialog: { ...s.chapterMetadataDialog, isOpen: false },
        })),

      openSceneEditorDialog: (sceneId: SceneId, openedViaTrigger: boolean = false) =>
        set((s: UIStoreState) => ({
          sceneEditorDialog: {
            isOpen: true,
            version: s.sceneEditorDialog.version + 1,
            sceneId,
            openedViaTrigger,
          },
        })),

      closeSceneEditorDialog: () =>
        set((s: UIStoreState) => ({
          sceneEditorDialog: {
            ...s.sceneEditorDialog,
            isOpen: false,
            sceneId: null,
            openedViaTrigger: false,
          },
        })),

      // ── Editor UI actions ────────────────────────────────────────────────
      setWorkspaceMode: (
        v:
          | 'page'
          | 'scenes'
          | 'split'
          | ((prev: 'page' | 'scenes' | 'split') => 'page' | 'scenes' | 'split')
      ) =>
        set((s: UIStoreState): { workspaceMode: 'page' | 'scenes' | 'split' } => ({
          workspaceMode: resolve(v, s.workspaceMode),
        })),
      setViewMode: (v: ViewMode | ((prev: ViewMode) => ViewMode)) =>
        set((s: UIStoreState): { viewMode: ViewMode } => ({
          viewMode: resolve(v, s.viewMode),
        })),
      setShowWhitespace: (v: boolean | ((prev: boolean) => boolean)) =>
        set((s: UIStoreState): { showWhitespace: boolean } => ({
          showWhitespace: resolve(v, s.showWhitespace),
        })),
      setActiveFormats: (v: string[] | ((prev: string[]) => string[])) =>
        set((s: UIStoreState): { activeFormats: string[] } => ({
          activeFormats: resolve(v, s.activeFormats),
        })),
      setSceneLaneState: (
        state:
          | {
              visibleLaneEntryIds: string[];
              removedReferencedLaneIds: string[];
            }
          | ((prev: {
              visibleLaneEntryIds: string[];
              removedReferencedLaneIds: string[];
            }) => {
              visibleLaneEntryIds: string[];
              removedReferencedLaneIds: string[];
            })
      ) =>
        set(
          (
            s: UIStoreState
          ): {
            sceneLaneState: {
              visibleLaneEntryIds: string[];
              removedReferencedLaneIds: string[];
            };
          } => ({
            sceneLaneState: resolve(state, s.sceneLaneState),
          })
        ),
      setIsViewMenuOpen: (v: boolean | ((prev: boolean) => boolean)) =>
        set((s: UIStoreState): { isViewMenuOpen: boolean } => ({
          isViewMenuOpen: resolve(v, s.isViewMenuOpen),
        })),
      setIsFormatMenuOpen: (v: boolean | ((prev: boolean) => boolean)) =>
        set((s: UIStoreState): { isFormatMenuOpen: boolean } => ({
          isFormatMenuOpen: resolve(v, s.isFormatMenuOpen),
        })),
      setIsMobileFormatMenuOpen: (v: boolean | ((prev: boolean) => boolean)) =>
        set((s: UIStoreState): { isMobileFormatMenuOpen: boolean } => ({
          isMobileFormatMenuOpen: resolve(v, s.isMobileFormatMenuOpen),
        })),
    }),
    {
      name: 'aq_ui_panels',
      storage: createJSONStorage(() => {
        if (
          typeof localStorage !== 'undefined' &&
          typeof localStorage.setItem === 'function'
        ) {
          return localStorage;
        }

        return {
          getItem: (_name: string): string | null => null,
          setItem: (_name: string, _value: string): void => undefined,
          removeItem: (_name: string): void => undefined,
          clear: (): void => undefined,
        };
      }),
      // Only persist panel open/close state – dialogs and editor flags are
      // transient and should reset on page load.
      partialize: (
        state: UIStoreState
      ): {
        isChatOpen: boolean;
        isSidebarOpen: boolean;
        sceneLaneState: {
          visibleLaneEntryIds: string[];
          removedReferencedLaneIds: string[];
        };
      } => ({
        isChatOpen: state.isChatOpen,
        isSidebarOpen: state.isSidebarOpen,
        sceneLaneState: state.sceneLaneState,
      }),
    }
  )
);

// ---------------------------------------------------------------------------
// Convenience selector hooks
// ---------------------------------------------------------------------------

/** Subscribe to metadata dialog state only. */
export function useMetadataDialog(): MetadataDialogState {
  return useUIStore((s: UIStoreState): MetadataDialogState => s.metadataDialog);
}

/** Subscribe to sourcebook dialog state only. */
export function useSourcebookDialog(): SourcebookDialogState {
  return useUIStore((s: UIStoreState): SourcebookDialogState => s.sourcebookDialog);
}

/** Subscribe to chapter metadata dialog state only. */
export function useChapterMetadataDialog(): ChapterMetadataDialogState {
  return useUIStore(
    (s: UIStoreState): ChapterMetadataDialogState => s.chapterMetadataDialog
  );
}

/** Subscribe to scene editor dialog state only. */
export function useSceneEditorDialog(): SceneEditorDialogState {
  return useUIStore((s: UIStoreState): SceneEditorDialogState => s.sceneEditorDialog);
}

/** Subscribe to workspace mode state only. */
export function useWorkspaceMode(): 'page' | 'scenes' | 'split' {
  return useUIStore((s: UIStoreState) => s.workspaceMode);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset the UI store to its initial state. Use in beforeEach in unit tests. */
export function resetUIStore(): void {
  useUIStore.setState({
    isChatOpen: true,
    isSidebarOpen: false,
    isAppearanceOpen: false,
    isSettingsOpen: false,
    isImagesOpen: false,
    isDebugLogsOpen: false,
    metadataDialog: { isOpen: false, version: 0 },
    sourcebookDialog: { isOpen: false, version: 0, entryId: null },
    chapterMetadataDialog: {
      isOpen: false,
      version: 0,
      chapterId: null,
      initialTab: undefined,
    },
    sceneEditorDialog: {
      isOpen: false,
      version: 0,
      sceneId: null,
      openedViaTrigger: false,
    },
    viewMode: 'raw' as ViewMode,
    showWhitespace: false,
    activeFormats: [],
    isViewMenuOpen: false,
    isFormatMenuOpen: false,
    isMobileFormatMenuOpen: false,
    sceneLaneState: {
      visibleLaneEntryIds: [],
      removedReferencedLaneIds: [],
    },
  });
}

// ---------------------------------------------------------------------------
// Imperative access for use outside React components
// (e.g. search-dialog navigation callbacks in App.tsx)
// ---------------------------------------------------------------------------

export const uiStoreActions = {
  closeMetadataDialog: () => useUIStore.getState().closeMetadataDialog(),
  closeSourcebookDialog: () => useUIStore.getState().closeSourcebookDialog(),
  openMetadataDialog: (tab?: MetadataTab) =>
    useUIStore.getState().openMetadataDialog(tab),
  openSourcebookDialog: (entryId: string) =>
    useUIStore.getState().openSourcebookDialog(entryId),
  openChapterMetadataDialog: (chapterId: string, initialTab?: MetadataTab) =>
    useUIStore.getState().openChapterMetadataDialog(chapterId, initialTab),
  closeChapterMetadataDialog: () => useUIStore.getState().closeChapterMetadataDialog(),
  openSceneEditorDialog: (sceneId: SceneId, openedViaTrigger: boolean = false) =>
    useUIStore.getState().openSceneEditorDialog(sceneId, openedViaTrigger),
  closeSceneEditorDialog: () => useUIStore.getState().closeSceneEditorDialog(),
};
