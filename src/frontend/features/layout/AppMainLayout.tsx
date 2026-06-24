// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the app main layout unit so this responsibility stays isolated, testable, and easy to evolve.
 * Composes AppSidebar, the story editor pane, and AppChatPanel.
 */

import React, {
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquarePlus } from 'lucide-react';

import { Editor } from '../editor/Editor';
import { AppChatPanel } from './AppChatPanel';
import { AppSidebar } from './AppSidebar';
import { useTheme } from './ThemeContext';
import {
  MainChatControls,
  MainEditorControls,
  MainSidebarControls,
  HeaderFormatControls,
  HeaderViewControls,
} from './layoutControlTypes';
import {
  useStoryLanguage,
  useStoryStore,
  StoryStoreState,
} from '../../stores/storyStore';
import { useAnnotations } from '../annotations/useAnnotations';
import { AnnotationSidebar } from '../annotations/AnnotationSidebar';
import { AnnotationDialog } from '../annotations/AnnotationDialog';
import {
  getAnnotationMarkerSpanRange,
  strippedToFullOffset,
} from '../editor/internalTags';
import {
  annotationsToRanges,
  adjustAnnotationRangesForStrippedMarkers,
} from '../editor/annotationPlugin';
import type { Annotation } from '../../services/apiClients/annotations';

import { useWorkspaceMode } from '../../stores/uiStore';
import { EditorToolbar } from '../editor/EditorToolbar';
import { ScenesPanelContainer } from '../scenes/ScenesPanelContainer';

type AppMainLayoutProps = {
  sidebarControls: MainSidebarControls;
  editorControls: MainEditorControls;
  chatControls: MainChatControls;
  viewControls: HeaderViewControls;
  formatControls: HeaderFormatControls;
  instructionLanguages: string[];
};

interface SkeletonBarProps {
  isLight: boolean;
  widthClass?: string;
}

const SkeletonBar: React.FC<SkeletonBarProps> = ({
  isLight,
  widthClass = 'w-full',
}: SkeletonBarProps) => (
  <div
    className={`h-3 rounded ${widthClass} ${
      isLight ? 'bg-brand-gray-200' : 'bg-brand-gray-700'
    }`}
  />
);

interface ChapterLoadingSkeletonProps {
  isLight: boolean;
  t: (key: string) => string;
}

const ChapterLoadingSkeleton: React.FC<ChapterLoadingSkeletonProps> = ({
  isLight,
  t,
}: ChapterLoadingSkeletonProps) => (
  <div
    className="flex-1 p-8 space-y-4 animate-pulse"
    aria-busy="true"
    aria-label={t('Loading chapter')}
  >
    <div
      className={`h-5 w-1/3 rounded ${isLight ? 'bg-brand-gray-200' : 'bg-brand-gray-700'}`}
    />
    <SkeletonBar isLight={isLight} />
    <SkeletonBar isLight={isLight} widthClass="w-5/6" />
    <SkeletonBar isLight={isLight} />
    <SkeletonBar isLight={isLight} widthClass="w-3/4" />
    <div className="pt-2" />
    <SkeletonBar isLight={isLight} />
    <SkeletonBar isLight={isLight} widthClass="w-4/5" />
    <SkeletonBar isLight={isLight} />
    <SkeletonBar isLight={isLight} widthClass="w-2/3" />
  </div>
);

/* eslint-disable max-lines-per-function */
export const AppMainLayout: React.FC<AppMainLayoutProps> = React.memo(
  ({
    sidebarControls,
    editorControls,
    chatControls,
    viewControls,
    formatControls,
    instructionLanguages,
  }: AppMainLayoutProps) => {
    const { bgMain, isLight, currentTheme } = useTheme();
    const { t } = useTranslation();
    const workspaceMode = useWorkspaceMode();

    if (!sidebarControls || !editorControls || !chatControls) {
      console.error('AppMainLayout missing required controls', {
        sidebarControls,
        editorControls,
        chatControls,
      });
      return (
        <div className="flex-1 flex items-center justify-center p-8 text-center text-brand-red-500">
          <p className="text-lg font-semibold">
            {t('Application failed to initialize.')}
          </p>
          <p className="mt-2 text-sm text-brand-gray-400">
            {t('Please refresh the page or try again.')}
          </p>
        </div>
      );
    }

    const storyLanguage = useStoryLanguage();
    const { addChapter, isSidebarOpen, setIsSidebarOpen, onToggleSourcebook } =
      sidebarControls;

    const { editorSettings, setEditorSettings } = editorControls;
    const sidebarPrefs = editorSettings.sidebar || {};
    const sidebarRef = useRef<HTMLDivElement>(null);

    // storyId for the sidebar height initialization effect (avoids importing full story)
    const storyId = sidebarControls.currentChapterId ? 'loaded' : '';

    useEffect((): void => {
      const totalHeight = sidebarRef.current?.clientHeight || 0;
      if (
        totalHeight > 0 &&
        (!sidebarPrefs.storyHeight || !sidebarPrefs.chaptersHeight)
      ) {
        // Use static ratios; sidebar now reads from storyStore directly.
        const storyRatio = 0.33;
        const chaptersRatio = 0.33;

        const sHeight = Math.round(totalHeight * storyRatio);
        const cHeight = Math.round(totalHeight * chaptersRatio);

        setEditorSettings((prev: import('../../types').EditorSettings) => ({
          ...prev,
          sidebar: {
            ...prev.sidebar,
            storyHeight: prev.sidebar?.storyHeight || sHeight,
            chaptersHeight: prev.sidebar?.chaptersHeight || cHeight,
          },
        }));
      }
    }, [
      storyId,
      setEditorSettings,
      sidebarPrefs.storyHeight,
      sidebarPrefs.chaptersHeight,
    ]);

    // Collapse sidebar automatically when switching to split mode
    useEffect(() => {
      if (workspaceMode === 'split') {
        setIsSidebarOpen(false);
      }
    }, [workspaceMode, setIsSidebarOpen]);

    // Stable callbacks — setEditorSettings is a useState setter (always stable)
    // so these will never be recreated, preventing AppSidebar from re-rendering
    // just because AppMainLayout re-rendered (e.g. when editorControls changes).
    const toggleCollapsed = useCallback(
      (key: keyof NonNullable<typeof editorSettings.sidebar>): void => {
        setEditorSettings((prev: import('../../types').EditorSettings) => ({
          ...prev,
          sidebar: {
            ...prev.sidebar,
            [key]: !prev.sidebar?.[key],
          },
        }));
      },
      [setEditorSettings]
    );

    const updateHeight = useCallback(
      (key: keyof NonNullable<typeof editorSettings.sidebar>, height: number): void => {
        setEditorSettings((prev: import('../../types').EditorSettings) => ({
          ...prev,
          sidebar: {
            ...prev.sidebar,
            [key]: height,
          },
        }));
      },
      [setEditorSettings]
    );

    const {
      currentChapter,
      isChapterLoading,
      editorRef,
      recordHistoryEntry,
      viewMode,
      suggestionControls,
      aiControls,
      setActiveFormats,
      showWhitespace,
      setShowWhitespace,
      onOpenSearch,
    } = editorControls;

    const projectName = useStoryStore((s: StoryStoreState): string => s.story.id);
    const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
    // Tracks whether the editor ref has been populated.  The annotation
    // dispatch effect waits for this flag so that it never silently drops
    // ranges because editorRef.current is null on first render.
    const [editorReady, setEditorReady] = useState(false);

    // useLayoutEffect without deps runs on every render — this is the only
    // reliable way to detect when a ref object's .current transitions from
    // null to a value (React doesn't track ref.current changes).
    useLayoutEffect((): void => {
      const ready = !!editorRef.current;
      if (ready !== editorReady) {
        setEditorReady(ready);
      }
    });
    const [isAnnotationDialogOpen, setIsAnnotationDialogOpen] = useState(false);
    const [pendingSelection, setPendingSelection] = useState<{
      from: number;
      to: number;
    } | null>(null);
    const [annotationMenu, setAnnotationMenu] = useState<{
      open: boolean;
      x: number;
      y: number;
    }>({ open: false, x: 0, y: 0 });

    const annotationScope = useMemo(() => {
      if (!currentChapter) return null;
      if (currentChapter.scope === 'story') {
        return {
          scope_type: 'story',
          chapter_id: null,
          book_id: null,
        };
      }
      return {
        scope_type: 'chapter',
        chapter_id: currentChapter.id,
        book_id: currentChapter.book_id ?? null,
      };
    }, [currentChapter]);

    const {
      annotations,
      isLoading: isAnnotationsLoading,
      refresh: refreshAnnotations,
      createAnnotation,
      updateAnnotation,
      deleteAnnotation,
    } = useAnnotations(projectName);

    const shouldShowAnnotationPanel =
      workspaceMode !== 'scenes' && !!currentChapter && annotations.length > 0;

    // Compute and dispatch annotation ranges whenever annotations, chapter
    // content, or editor readiness changes.  Defined after useAnnotations so
    // `annotations` is in scope.
    const dispatchAnnotationsToEditor = useCallback((): void => {
      if (!currentChapter || !editorReady) return;
      const docText = currentChapter.content ?? '';
      if (!docText) return;
      const rawRanges = annotationsToRanges(docText, annotations);
      const adjustedRanges = adjustAnnotationRangesForStrippedMarkers(
        rawRanges,
        docText
      );
      editorRef.current?.setOnAnnotationClick(setActiveAnnotationId);
      editorRef.current?.setAnnotationRanges(adjustedRanges);
    }, [currentChapter, annotations, editorReady, editorRef, workspaceMode]);

    // Dispatch deferred via microtask so the editor view is guaranteed to
    // exist when the Editor remounts (e.g. workspaceMode switch unmounts the
    // old Editor instance and mounts a new one).
    const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      if (!currentChapter) {
        editorRef.current?.setAnnotationRanges([]);
        return;
      }
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        dispatchAnnotationsToEditor();
      }, 0);
      return () => {
        if (pendingTimerRef.current !== null) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
      };
    }, [dispatchAnnotationsToEditor]);

    // Safety net: retry editor-ready detection via microtask in case React
    // batches the state update that populates the ref.
    useEffect(() => {
      if (!currentChapter || editorReady) return;
      const id = setTimeout(() => {
        if (editorRef.current) {
          setEditorReady(true);
        }
      }, 0);
      return () => clearTimeout(id);
    }, [currentChapter, editorReady, editorRef]);

    useEffect((): void => {
      if (!annotationScope) {
        setActiveAnnotationId(null);
        editorRef.current?.setAnnotationRanges([]);
        return;
      }
      refreshAnnotations(annotationScope);
      setActiveAnnotationId(null);
    }, [annotationScope, refreshAnnotations, editorRef]);

    const openAnnotationDialogFromSelection = useCallback((): void => {
      if (!currentChapter || !annotationScope) return;
      const sel = editorRef.current?.getSelection();
      if (!sel) return;
      const from = Math.min(sel.anchor, sel.head);
      const to = Math.max(sel.anchor, sel.head);
      if (from === to) return;
      // Store editor-space (stripped) offsets.  Full-content conversion
      // happens at API-call time in handleCreateAnnotation.
      setPendingSelection({ from, to });
      setAnnotationMenu({ open: false, x: 0, y: 0 });
      setIsAnnotationDialogOpen(true);
    }, [annotationScope, currentChapter, editorRef]);

    useEffect((): (() => void) => {
      const handleContextMenu = (e: MouseEvent): void => {
        if (!annotationScope) return;
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.closest('#codemirror-editor')) return;

        const sel = editorRef.current?.getSelection();
        if (!sel) return;
        const from = Math.min(sel.anchor, sel.head);
        const to = Math.max(sel.anchor, sel.head);
        if (from === to) return;

        e.preventDefault();
        // Store editor-space (stripped) offsets.  Full-content conversion
        // happens at API-call time in handleCreateAnnotation.
        setPendingSelection({ from, to });
        setAnnotationMenu({ open: true, x: e.clientX, y: e.clientY });
      };

      window.addEventListener('contextmenu', handleContextMenu, true);
      return (): void => {
        window.removeEventListener('contextmenu', handleContextMenu, true);
      };
    }, [annotationScope, editorRef]);

    useEffect((): (() => void) => {
      const handleKeyDown = (e: KeyboardEvent): void => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          openAnnotationDialogFromSelection();
        }
      };
      window.addEventListener('keydown', handleKeyDown, true);
      return (): void => {
        window.removeEventListener('keydown', handleKeyDown, true);
      };
    }, [openAnnotationDialogFromSelection]);

    useEffect((): (() => void) | void => {
      if (!annotationMenu.open) return;
      const closeMenu = (): void => {
        setAnnotationMenu({ open: false, x: 0, y: 0 });
      };
      window.addEventListener('click', closeMenu, true);
      return (): void => {
        window.removeEventListener('click', closeMenu, true);
      };
    }, [annotationMenu.open]);

    const handleCreateAnnotation = useCallback(
      async (comment: string): Promise<void> => {
        if (!annotationScope || !pendingSelection || !currentChapter) return;

        // Convert editor-space (stripped) offsets to full-content offsets
        // for the backend API.  The editor strips internal marker tokens
        // from the visible document, so getSelection() returns stripped
        // positions that must be mapped back to the raw file coordinates.
        const fullContent = currentChapter.content ?? '';
        const fromFull = strippedToFullOffset(fullContent, pendingSelection.from);
        const toFull = strippedToFullOffset(fullContent, pendingSelection.to);

        const created = await createAnnotation({
          ...annotationScope,
          start_offset: fromFull,
          end_offset: toFull,
          comment,
        });
        setIsAnnotationDialogOpen(false);
        if (created) {
          // Construct the new full content with annotation markers so the
          // chapter store and annotation dispatch can pick up the change
          // immediately.  Never inject markers directly into the editor
          // document — the editor runs with hideSceneMarkers=true and
          // expects a clean document.
          const startToken = `<!--annotation:${created.id}:start-->`;
          const endToken = `<!--annotation:${created.id}:end-->`;
          const newFullContent =
            fullContent.slice(0, fromFull) +
            startToken +
            fullContent.slice(fromFull, toFull) +
            endToken +
            fullContent.slice(toFull);

          // Update the chapter in the store (sync=false because the
          // backend already persisted the markers via createAnnotation).
          await editorControls.updateChapter(
            currentChapter.id,
            { content: newFullContent },
            false,
            false,
            false
          );

          setPendingSelection(null);
          await refreshAnnotations(annotationScope);
          setActiveAnnotationId(created.id);

          // Navigate to the annotation in the editor.  Find markers in
          // the new full content and convert to visible (stripped) editor
          // positions.
          const span = getAnnotationMarkerSpanRange(newFullContent, created.id);
          if (span) {
            const adjusted = adjustAnnotationRangesForStrippedMarkers(
              [{ id: created.id, from: span.from, to: span.to, comment: '' }],
              newFullContent
            );
            if (adjusted.length > 0) {
              editorRef.current?.jumpToPosition(adjusted[0].from, adjusted[0].to);
            }
          }
        } else {
          setPendingSelection(null);
          await refreshAnnotations(annotationScope);
        }
      },
      [
        annotationScope,
        pendingSelection,
        createAnnotation,
        refreshAnnotations,
        editorRef,
        currentChapter,
        editorControls,
      ]
    );

    const handleSelectAnnotation = useCallback(
      (id: string): void => {
        setActiveAnnotationId(id);
        const view = editorRef.current?.getEditorView();
        if (!view || !currentChapter?.content) return;
        // Search for markers in the full chapter content (which has markers
        // preserved), not the editor document (which has them stripped when
        // hideSceneMarkers is true).
        const span = getAnnotationMarkerSpanRange(currentChapter.content, id);
        if (span) {
          // Adjust from full-content coordinates to visible (stripped) coordinates
          const adjusted = adjustAnnotationRangesForStrippedMarkers(
            [{ id, from: span.from, to: span.to, comment: '' }],
            currentChapter.content
          );
          if (adjusted.length > 0) {
            editorRef.current?.jumpToPosition(adjusted[0].from, adjusted[0].to);
          }
        }
      },
      [editorRef, currentChapter]
    );

    const handleUpdateAnnotation = useCallback(
      async (id: string, comment: string): Promise<void> => {
        await updateAnnotation(id, comment);
      },
      [updateAnnotation]
    );

    const handleDeleteAnnotation = useCallback(
      async (id: string): Promise<void> => {
        // Remove markers from the editor document first so the deletion
        // is reflected immediately in the UI.
        const view = editorRef.current?.getEditorView();
        if (view) {
          const docText = view.state.doc.toString();
          const startMarker = `<!--annotation:${id}:start-->`;
          const endMarker = `<!--annotation:${id}:end-->`;
          const smPos = docText.indexOf(startMarker);
          const emPos = docText.indexOf(endMarker);
          if (smPos >= 0 && emPos > smPos) {
            // Remove end marker first so its position isn't affected by
            // the start marker removal.
            view.dispatch({
              changes: {
                from: emPos,
                to: emPos + endMarker.length,
                insert: '',
              },
              annotations: [],
            });
            view.dispatch({
              changes: {
                from: smPos,
                to: smPos + startMarker.length,
                insert: '',
              },
              annotations: [],
            });
          }
        }

        await deleteAnnotation(id);
        if (activeAnnotationId === id) {
          setActiveAnnotationId(null);
        }
        if (annotationScope) {
          await refreshAnnotations(annotationScope);
        }
      },
      [
        deleteAnnotation,
        activeAnnotationId,
        annotationScope,
        refreshAnnotations,
        editorRef,
      ]
    );

    // Stable callbacks so memoized sidebar sub-components don't re-render on
    // every AppMainLayout render caused by sidebarControls reference churn.
    const handleSourcebookToggle = useCallback(
      (id: string, checked: boolean): void => onToggleSourcebook?.(id, checked),
      [onToggleSourcebook]
    );
    const handleAddChapter = useCallback(
      async (bookId?: string): Promise<void> => {
        await addChapter('New Chapter', '', bookId);
      },
      [addChapter]
    );

    return (
      <main id="aq-main-layout" className="flex-1 flex overflow-hidden relative">
        <AppSidebar
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          sidebarControls={sidebarControls}
          sidebarPrefs={
            sidebarPrefs as NonNullable<MainEditorControls['editorSettings']['sidebar']>
          }
          isLight={isLight}
          currentTheme={currentTheme}
          instructionLanguages={instructionLanguages}
          handleSourcebookToggle={handleSourcebookToggle}
          handleAddChapter={handleAddChapter}
          toggleCollapsed={toggleCollapsed}
          updateHeight={updateHeight}
          workspaceMode={workspaceMode}
        />

        <section
          id="aq-workspace"
          role="main"
          aria-label={workspaceMode === 'scenes' ? t('Scenes') : t('Story editor')}
          className={`flex-1 flex relative overflow-hidden w-full h-full ${bgMain}`}
        >
          {workspaceMode === 'split' ? (
            <>
              <div className="w-1/3 border-r dark:border-brand-gray-800 h-full overflow-hidden">
                <ScenesPanelContainer
                  editorRef={editorRef}
                  currentChapter={currentChapter}
                  editorSettings={editorSettings}
                  recordHistoryEntry={recordHistoryEntry}
                  onSelectChapter={sidebarControls.handleChapterSelect}
                />
              </div>
              <div className="flex-1 flex flex-col min-w-0 h-full relative">
                <EditorToolbar
                  viewControls={viewControls}
                  formatControls={formatControls}
                />
                <div className="flex-1 overflow-hidden h-full flex flex-col">
                  {isChapterLoading ? (
                    <ChapterLoadingSkeleton isLight={isLight} t={t} />
                  ) : currentChapter ? (
                    <>
                      <div className="h-full">
                        <Editor
                          ref={editorRef}
                          chapter={currentChapter}
                          settings={editorSettings}
                          language={editorControls.storyLanguage || 'en'}
                          viewMode={viewMode}
                          onChange={editorControls.updateChapter}
                          suggestionControls={{
                            continuations: suggestionControls.continuations,
                            suggestionMode: suggestionControls.suggestionMode,
                            setSuggestionMode: suggestionControls.setSuggestionMode,
                            isSuggesting: suggestionControls.isSuggesting,
                            onTriggerSuggestions:
                              suggestionControls.handleTriggerSuggestions,
                            onCancelSuggestion:
                              suggestionControls.handleCancelSuggestions,
                            onAcceptContinuation:
                              suggestionControls.handleAcceptContinuation,
                            isSuggestionMode: suggestionControls.isSuggestionMode,
                            onKeyboardSuggestionAction:
                              suggestionControls.handleKeyboardSuggestionAction,
                          }}
                          aiControls={{
                            onAiAction: aiControls.handleAiAction,
                            isAiLoading: aiControls.isAiActionLoading,
                            isProseStreaming: aiControls.isProseStreaming,
                            isWritingAvailable: aiControls.isWritingAvailable,
                            onCancelAiAction: aiControls.cancelAiAction,
                          }}
                          onContextChange={setActiveFormats}
                          showWhitespace={showWhitespace}
                          onToggleShowWhitespace={(): void =>
                            setShowWhitespace(!showWhitespace)
                          }
                          baselineContent={editorControls.baselineContent}
                          spellCheck={true}
                          onOpenSearch={onOpenSearch}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-brand-gray-500">
                      <img
                        src="/static/images/logo_512.png"
                        srcSet="/static/images/logo_256.png 256w, /static/images/logo_512.png 512w, /static/images/logo_1024.png 1024w, /static/images/logo_2048.png 2048w"
                        sizes="(max-width: 640px) 128px, (max-width: 1024px) 192px, 256px"
                        className="w-64 h-64 mb-8 opacity-20"
                        alt="AugmentedQuill Logo"
                        decoding="async"
                        loading="lazy"
                      />
                      <p className="text-lg font-medium">
                        {t('Select or create a chapter to start writing.')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : workspaceMode === 'scenes' ? (
            <div className="flex-1 h-full overflow-hidden">
              <ScenesPanelContainer
                editorRef={editorRef}
                currentChapter={currentChapter}
                editorSettings={editorSettings}
                recordHistoryEntry={recordHistoryEntry}
                onSelectChapter={sidebarControls.handleChapterSelect}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-w-0 h-full relative">
              <EditorToolbar
                viewControls={viewControls}
                formatControls={formatControls}
              />
              <div className="flex-1 flex flex-col min-h-0 relative">
                {isChapterLoading ? (
                  <ChapterLoadingSkeleton isLight={isLight} t={t} />
                ) : currentChapter ? (
                  <>
                    <div className="h-full">
                      <Editor
                        ref={editorRef}
                        chapter={currentChapter}
                        settings={editorSettings}
                        language={editorControls.storyLanguage || 'en'}
                        viewMode={viewMode}
                        onChange={editorControls.updateChapter}
                        suggestionControls={{
                          continuations: suggestionControls.continuations,
                          suggestionMode: suggestionControls.suggestionMode,
                          setSuggestionMode: suggestionControls.setSuggestionMode,
                          isSuggesting: suggestionControls.isSuggesting,
                          onTriggerSuggestions:
                            suggestionControls.handleTriggerSuggestions,
                          onCancelSuggestion:
                            suggestionControls.handleCancelSuggestions,
                          onAcceptContinuation:
                            suggestionControls.handleAcceptContinuation,
                          isSuggestionMode: suggestionControls.isSuggestionMode,
                          onKeyboardSuggestionAction:
                            suggestionControls.handleKeyboardSuggestionAction,
                        }}
                        aiControls={{
                          onAiAction: aiControls.handleAiAction,
                          isAiLoading: aiControls.isAiActionLoading,
                          isProseStreaming: aiControls.isProseStreaming,
                          isWritingAvailable: aiControls.isWritingAvailable,
                          onCancelAiAction: aiControls.cancelAiAction,
                        }}
                        onContextChange={setActiveFormats}
                        showWhitespace={showWhitespace}
                        onToggleShowWhitespace={(): void =>
                          setShowWhitespace(!showWhitespace)
                        }
                        baselineContent={editorControls.baselineContent}
                        spellCheck={true}
                        onOpenSearch={onOpenSearch}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-brand-gray-500">
                    <img
                      src="/static/images/logo_512.png"
                      srcSet="/static/images/logo_256.png 256w, /static/images/logo_512.png 512w, /static/images/logo_1024.png 1024w, /static/images/logo_2048.png 2048w"
                      sizes="(max-width: 640px) 128px, (max-width: 1024px) 192px, 256px"
                      className="w-64 h-64 mb-8 opacity-20"
                      alt="AugmentedQuill Logo"
                      decoding="async"
                      loading="lazy"
                    />
                    <p className="text-lg font-medium">
                      {t('Select or create a chapter to start writing.')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {shouldShowAnnotationPanel && (
            <aside
              className="absolute right-2 top-2 bottom-2 z-20 w-72 rounded-lg border border-amber-500/30 bg-black/55 backdrop-blur-sm shadow-xl flex flex-col"
              aria-label={t('annotation_panel_region_label')}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-amber-500/20">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-amber-200">
                    {t('annotation_panel_title')}
                  </span>
                  <span className="text-[10px] text-amber-100/70">
                    {t('annotation_hotkey_hint')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={openAnnotationDialogFromSelection}
                  className="rounded p-1.5 text-amber-300 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={t('annotation_add_from_selection')}
                  aria-label={t('add_annotation')}
                  disabled={isChapterLoading}
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                <AnnotationSidebar
                  annotations={annotations}
                  isLoading={isAnnotationsLoading}
                  activeAnnotationId={activeAnnotationId}
                  onSelectAnnotation={handleSelectAnnotation}
                  onUpdateAnnotation={handleUpdateAnnotation}
                  onDeleteAnnotation={handleDeleteAnnotation}
                />
              </div>
            </aside>
          )}

          {annotationMenu.open && (
            <div
              role="menu"
              aria-label={t('annotation_context_menu_label')}
              className="fixed z-40 rounded border border-amber-500/40 bg-brand-gray-900 shadow-lg"
              style={{ left: annotationMenu.x, top: annotationMenu.y }}
            >
              <button
                type="button"
                role="menuitem"
                className="px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20"
                onClick={openAnnotationDialogFromSelection}
              >
                {t('annotation_context_add')}
              </button>
            </div>
          )}

          <AnnotationDialog
            isOpen={isAnnotationDialogOpen}
            onConfirm={(comment: string): void => {
              void handleCreateAnnotation(comment);
            }}
            onCancel={(): void => {
              setIsAnnotationDialogOpen(false);
              setPendingSelection(null);
            }}
          />
        </section>

        <AppChatPanel
          chatControls={chatControls}
          currentTheme={currentTheme}
          storyLanguage={storyLanguage ?? 'en'}
        />
      </main>
    );
  }
);
/* eslint-enable max-lines-per-function */
