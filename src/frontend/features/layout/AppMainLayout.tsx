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

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
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
import { getAnnotationMarkerSpanRange } from '../editor/internalTags';
import { annotationsToRanges } from '../editor/annotationPlugin';
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

    useEffect((): void => {
      if (!annotationScope) {
        setActiveAnnotationId(null);
        editorRef.current?.setAnnotationRanges([]);
        return;
      }
      refreshAnnotations(annotationScope);
      setActiveAnnotationId(null);
    }, [annotationScope, refreshAnnotations, editorRef]);

    useEffect((): void => {
      if (!currentChapter) {
        editorRef.current?.setAnnotationRanges([]);
        return;
      }
      // Compute annotation ranges from the store content (which always has
      // the markers).  The annotationRangesField maps positions on document
      // changes, so even if the CodeMirror doc is stale now the positions
      // will be corrected when the editor syncs.
      const docText = currentChapter.content ?? '';
      editorRef.current?.setAnnotationRanges(annotationsToRanges(docText, annotations));
    }, [annotations, currentChapter, editorRef]);

    const openAnnotationDialogFromSelection = useCallback((): void => {
      if (!currentChapter || !annotationScope) return;
      const sel = editorRef.current?.getSelection();
      if (!sel) return;
      const from = Math.min(sel.anchor, sel.head);
      const to = Math.max(sel.anchor, sel.head);
      if (from === to) return;
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
        if (!annotationScope || !pendingSelection) return;
        const created = await createAnnotation({
          ...annotationScope,
          start_offset: pendingSelection.from,
          end_offset: pendingSelection.to,
          comment,
        });
        setIsAnnotationDialogOpen(false);
        if (created) {
          // Insert markers into the editor document so that the marker-based
          // range computation in annotationsToRanges finds them immediately.
          const view = editorRef.current?.getEditorView();
          if (view) {
            const startMarker = `<!--annotation:${created.id}:start-->`;
            const endMarker = `<!--annotation:${created.id}:end-->`;
            // Insert start marker first, then end marker (position shifted).
            view.dispatch({
              changes: {
                from: pendingSelection.from,
                to: pendingSelection.from,
                insert: startMarker,
              },
              annotations: [],
            });
            view.dispatch({
              changes: {
                from: pendingSelection.to + startMarker.length,
                to: pendingSelection.to + startMarker.length,
                insert: endMarker,
              },
              annotations: [],
            });
          }
          setPendingSelection(null);
          await refreshAnnotations(annotationScope);
          setActiveAnnotationId(created.id);
          // Navigate to the annotation in the editor.
          const span = editorRef.current?.getEditorView()?.state.doc.toString();
          if (span) {
            const smPos = span.indexOf(`<!--annotation:${created.id}:start-->`);
            const emPos = span.indexOf(`<!--annotation:${created.id}:end-->`);
            if (smPos >= 0 && emPos > smPos) {
              editorRef.current?.jumpToPosition(
                smPos + `<!--annotation:${created.id}:start-->`.length,
                emPos
              );
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
      ]
    );

    const handleSelectAnnotation = useCallback(
      (id: string): void => {
        setActiveAnnotationId(id);
        const view = editorRef.current?.getEditorView();
        if (!view) return;
        const docText = view.state.doc.toString();
        const span = getAnnotationMarkerSpanRange(docText, id);
        if (span) {
          editorRef.current?.jumpToPosition(span.from, span.to);
        }
      },
      [editorRef]
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
