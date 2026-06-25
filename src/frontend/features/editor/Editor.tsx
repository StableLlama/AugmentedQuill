// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the editor unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  useCallback,
  useState,
} from 'react';
import { EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';
import {
  EditorSettings,
  SuggestionGenerationMode,
  ViewMode,
  WritingUnit,
  SceneId,
} from '../../types';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { notifyError } from '../../services/errorNotifier';
import { useSearchHighlight } from '../search/SearchHighlightContext';
import { useChatStore, ChatStoreState } from '../../stores/chatStore';
import { useStoryStore } from '../../stores/storyStore';
import type { StoryStoreState } from '../../stores/storyStore';
import {
  CodeMirrorEditor,
  setProseHighlightEffect,
  type ProseHighlightRange,
  type ProseBoundaryCallback,
} from './CodeMirrorEditor';
import { setAnnotationRangesEffect, type AnnotationRange } from './annotationPlugin';
import { setAnnotationClickCallback } from './annotationPlugin';
import { transferInternalMarkers } from './internalTags';
import { EditorSuggestionPanel } from './EditorSuggestionPanel';
import { EditorMobileToolbar } from './EditorMobileToolbar';
import { EditorProvider } from './EditorContext';
import {
  insertFencedCodeBlock,
  insertFootnote,
  toggleInlineFormatAtSelection,
  InlineFormatType,
  MarkdownBlockType,
} from './markdownToolbarUtils';
import { useEditorScroll } from './hooks/useEditorScroll';
import { useEditorFormatting } from './hooks/useEditorFormatting';

const STREAM_FOLLOW_ATTACH_DISTANCE_PX = 200;

// URL sanitizer — re-exported for backward compat with Editor.url.test.ts
export { isSafeImageUrl } from './editorUtils';
import { isSafeImageUrl } from './editorUtils';
import { isRangeVisible } from '../../utils/scrollUtils';

// Pending highlights stored when editorViewRef is null during Editor
// remount (e.g. chapter loading skeleton).  Module-level so they
// survive Editor unmount/remount cycles.
let gPendingHighlights: ProseHighlightRange[] | null = null;

interface EditorProps {
  chapter: WritingUnit;
  settings: EditorSettings;
  viewMode: ViewMode;
  showWhitespace?: boolean;
  onToggleShowWhitespace?: () => void;
  onChange: (id: string, updates: Partial<WritingUnit>, isUndoRedo?: boolean) => void;
  baselineContent?: string;
  language?: string;
  spellCheck?: boolean;
  suggestionControls: {
    continuations: string[];
    suggestionMode: SuggestionGenerationMode;
    setSuggestionMode: (mode: SuggestionGenerationMode) => void;
    isSuggesting: boolean;
    onTriggerSuggestions: (cursor?: number, contentOverride?: string) => void;
    onCancelSuggestion?: () => void;
    onAcceptContinuation: (text: string, contentOverride?: string) => void;
    isSuggestionMode: boolean;
    onKeyboardSuggestionAction: (
      action: 'trigger' | 'chooseLeft' | 'chooseRight' | 'regenerate' | 'undo' | 'exit',
      cursor?: number,
      contentOverride?: string
    ) => void;
  };
  aiControls: {
    onAiAction: (
      target: 'summary' | 'chapter',
      action: 'update' | 'rewrite' | 'extend'
    ) => void;
    isAiLoading: boolean;
    isWritingAvailable?: boolean;
    onCancelAiAction?: () => void;
    /** True whenever any LLM is writing prose into the editor. */
    isProseStreaming?: boolean;
  };
  onContextChange?: (formats: string[]) => void;
  onOpenSearch?: () => void;
}

export interface EditorHandle {
  insertImage: (filename: string, url: string, altText?: string) => void;
  focus: () => void;
  format: (type: string) => void;
  openImageManager?: () => void;
  jumpToPosition: (start: number, end: number) => void;
  getEditorView: () => EditorView | null;
  /**
   * Register a callback that fires on every cursor/selection change in the
   * editor.  Pass null to unsubscribe.  Only one external subscriber is
   * supported at a time (last caller wins).
   */
  setOnCursorChange: (cb: ((anchor: number, head: number) => void) | null) => void;
  /**
   * Apply background-highlight decorations to multiple prose ranges without
   * moving the cursor or creating a text selection.  Scrolls to the first
   * range.  Replaces any previously active highlights.
   */
  setProseHighlights: (entries: ProseHighlightRange[]) => void;
  /** Remove all prose-link highlight decorations. */
  clearProseHighlight: () => void;
  /**
   * Register a callback that fires when the user drags a prose-link boundary
   * handle to a new position.  Pass null to unsubscribe.
   */
  setOnProseBoundaryChange: (cb: ProseBoundaryCallback | null) => void;
  /** Push a new set of annotation highlight ranges to the editor. */
  setAnnotationRanges: (ranges: AnnotationRange[]) => void;
  /**
   * Register a callback that fires when the user clicks on an annotation
   * decoration in the editor (annotationId) or on unannotated text (null).
   * Pass null to unsubscribe.
   */
  setOnAnnotationClick: (cb: ((annotationId: string | null) => void) | null) => void;
  /** Return current selection (anchor/head) or null when editor is unavailable. */
  getSelection: () => { anchor: number; head: number } | null;
}

/* eslint-disable complexity */
export const Editor = React.memo(
  React.forwardRef<EditorHandle, EditorProps>(
    (
      {
        chapter,
        settings,
        viewMode,
        showWhitespace,
        onChange,
        baselineContent = undefined,
        suggestionControls,
        aiControls,
        language,
        spellCheck,
        onContextChange,
        onOpenSearch,
      }: EditorProps,
      ref: React.ForwardedRef<EditorHandle>
    ) => {
      const { t } = useTranslation();
      // CodeMirror EditorView — persists across all view modes
      const editorViewRef = useRef<EditorView | null>(null);
      const paperDivRef = useRef<HTMLDivElement>(null);
      // External cursor-change subscriber (e.g. ScenesPanelContainer)
      const externalCursorCallbackRef = useRef<
        ((anchor: number, head: number) => void) | null
      >(null);
      // External prose-boundary-drag subscriber (e.g. ScenesPanelContainer)
      const proseBoundaryCallbackRef = useRef<ProseBoundaryCallback | null>(null);
      const showInlineTitle = true;
      const { getRanges } = useSearchHighlight();
      const chapterSearchHighlightRanges = getRanges(
        'chapter_content',
        String(chapter.id),
        'content'
      );
      // Debounce timers for API-level persistence so every keystroke does not
      // trigger a network request.  Display updates remain synchronous.
      const contentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
      const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
      const DEBOUNCE_MS = 300;

      // Local content/title state so the editor div always gets the latest
      // typed value immediately, while the parent onChange (API call) is debounced.
      const [localContent, setLocalContent] = useState(chapter.content);
      const deferredStreamingContentRef = useRef<string | null>(null);
      // Ref that always holds the current content without triggering re-renders.
      // Used in callbacks that need the latest value at call time (e.g. suggestion
      // hotkeys) so those callbacks don't need localContent in their deps arrays.
      const localContentRef = useRef(chapter.content);
      const [localTitle, setLocalTitle] = useState(chapter.title);

      // Track the diff baseline locally so we can clear it immediately when the
      // user types — preventing newly typed text from appearing as diff insertions.
      // Re-adopt the prop whenever a new non-undefined baseline arrives (AI write).
      // Normalize empty string to undefined: an empty baseline means "no baseline
      // to diff against", not "diff against the empty string".
      const normalizeBaseline = (raw: string | undefined): string | undefined =>
        raw && raw.length > 0 ? raw : undefined;
      const [localBaseline, setLocalBaseline] = useState<string | undefined>(
        normalizeBaseline(baselineContent)
      );
      const prevBaselineRef = useRef<string | undefined>(
        normalizeBaseline(baselineContent)
      );
      // Keep the last non-undefined baseline so undo can restore the diff view.
      const savedBaselineRef = useRef<string | undefined>(
        normalizeBaseline(baselineContent)
      );
      const lastChapterIdRef = useRef(chapter.id);
      // Tracks the last full content (with markers) that was saved to the backend.
      // Used to re-inject markers after user edits strip them from the editor doc.
      const lastSavedFullContentRef = useRef(chapter.content);

      useEffect((): void => {
        const normalized = normalizeBaseline(baselineContent);
        const isChapterSwitch = chapter.id !== lastChapterIdRef.current;
        if (isChapterSwitch) {
          lastChapterIdRef.current = chapter.id;
          prevBaselineRef.current = normalized;
          setLocalBaseline(normalized);
          if (normalized !== undefined && normalized !== chapter.content) {
            savedBaselineRef.current = normalized;
          } else if (normalized === undefined) {
            savedBaselineRef.current = undefined;
          }
          return;
        }

        if (normalized !== prevBaselineRef.current) {
          prevBaselineRef.current = normalized;
          setLocalBaseline(normalized);
          // Only preserve as the real AI baseline when baselineContent differs from
          // chapter.content. When isUserEdit=true, pushState sets baselineContent
          // equal to chapter.content (no diff), so we must not overwrite the saved
          // AI baseline with the user-edited value — otherwise Ctrl+Z would restore
          // that wrong baseline instead of the original AI-written baseline.
          if (normalized !== undefined && normalized !== chapter.content) {
            savedBaselineRef.current = normalized;
          } else if (normalized === undefined) {
            savedBaselineRef.current = undefined;
          }
        }
      }, [chapter.id, baselineContent, chapter.content]);

      const isChatStreaming = useChatStore(
        (s: ChatStoreState): boolean => s.isProseStreamingFromChat
      );
      // True after the user stops chat mid-write: streaming has ended but we
      // keep streamingMode=true so the prefix-based green highlight stays visible
      // (as it appeared during streaming) rather than switching to LCS diff.
      const isChatStreamingFrozen = useChatStore(
        (s: ChatStoreState): boolean => s.isProseStreamingFrozen
      );
      // Subscribe to the ephemeral streaming slot — only this editor instance
      // re-renders on each chunk, not the entire component tree.
      const streamingContent = useStoryStore((s: StoryStoreState): string | null =>
        s.streamingContent?.chapterId === chapter.id ? s.streamingContent.content : null
      );
      const streamingWriteMode = useStoryStore((s: StoryStoreState): string | null =>
        s.streamingContent?.chapterId === chapter.id
          ? (s.streamingContent.writeMode ?? 'append')
          : null
      );
      const proseStreamingActive =
        (aiControls.isProseStreaming ?? false) || isChatStreaming;
      const isReplaceStreaming =
        proseStreamingActive && streamingWriteMode === 'replace';
      // streamingModeActive keeps streamingMode=true even after active streaming
      // ends (frozen state) so the green prefix-diff stays visible.
      const streamingModeActive = proseStreamingActive || isChatStreamingFrozen;

      // Keep local state in sync when the chapter changes externally (chapter
      // switch, AI update, undo/redo).  Use chapter.id as the primary trigger
      // for chapter switches; also watch chapter.content so AI insertions and
      // undo/redo (which can change content without changing id) are reflected.
      useEffect((): void => {
        const isChapterSwitch = chapter.id !== lastChapterIdRef.current;
        lastChapterIdRef.current = chapter.id;

        if (isChapterSwitch) {
          deferredStreamingContentRef.current = null;
          lastSavedFullContentRef.current = chapter.content;
        }

        // During active streaming the streaming-slot effect below owns
        // localContent; skip the chapter.content sync to avoid flashing the
        // pre-AI baseline content on every chunk.
        if (proseStreamingActive && !isChapterSwitch) return;

        // On chapter switch always reset.  For in-place content changes (AI,
        // undo/redo) only sync when the editor is not focused — when it IS
        // focused CodeMirror already has the correct document state.
        const editorFocused = editorViewRef.current?.hasFocus ?? false;
        const shouldDeferStreamingSync =
          proseStreamingActive &&
          isDetachedFromBottomRef.current &&
          distanceFromBottomRef.current > STREAM_FOLLOW_ATTACH_DISTANCE_PX &&
          !isChapterSwitch;

        if (isChapterSwitch || (!editorFocused && !shouldDeferStreamingSync)) {
          localContentRef.current = chapter.content;
          setLocalContent(chapter.content);
          if (!isChapterSwitch) {
            // AI/undo/redo updated the content externally — update our marker baseline
            lastSavedFullContentRef.current = chapter.content;
          }
        }
      }, [chapter.id, chapter.content, proseStreamingActive]);

      // Push each streamed chunk directly into the editor's local state so
      // only this component re-renders — story.chapters stays untouched.
      useEffect((): void => {
        if (streamingContent !== null) {
          const container = scrollContainerRef.current;
          const liveDistanceFromBottom = container
            ? container.scrollHeight - container.scrollTop - container.clientHeight
            : Number.POSITIVE_INFINITY;
          const isLiveAtBottom = liveDistanceFromBottom <= 50;

          const shouldDeferStreamingChunk =
            proseStreamingActive &&
            isDetachedFromBottomRef.current &&
            distanceFromBottomRef.current > STREAM_FOLLOW_ATTACH_DISTANCE_PX &&
            !isLiveAtBottom;

          // While detached from the bottom, freeze chunk-by-chunk updates so
          // stream geometry changes cannot pull the viewport unexpectedly.
          if (shouldDeferStreamingChunk) {
            deferredStreamingContentRef.current = streamingContent;
            return;
          }

          deferredStreamingContentRef.current = null;
          localContentRef.current = streamingContent;
          setLocalContent(streamingContent);
        }
      }, [streamingContent, proseStreamingActive]);

      // If the stream ends while a chunk was deferred, flush the latest deferred
      // content immediately so the editor doesn't lag until a later model update.
      useEffect((): void => {
        if (proseStreamingActive) return;
        const deferred = deferredStreamingContentRef.current;
        if (deferred === null) return;

        deferredStreamingContentRef.current = null;
        localContentRef.current = deferred;
        setLocalContent(deferred);
      }, [proseStreamingActive]);

      useEffect((): void => {
        setLocalTitle(chapter.title);
      }, [chapter.id, chapter.title]);

      const {
        continuations,
        suggestionMode,
        setSuggestionMode,
        isSuggesting,
        onTriggerSuggestions,
        onAcceptContinuation,
        isSuggestionMode,
        onKeyboardSuggestionAction,
      } = suggestionControls;
      const {
        onAiAction,
        isAiLoading,
        isWritingAvailable = true,
        onCancelAiAction,
        isProseStreaming: _isProseStreaming = false,
      } = aiControls;

      const {
        scrollContainerRef,
        handleScroll,
        handleWheel,
        handleTouchStart,
        handleTouchMove,
        scrollMainContentToBottom,
        isDetachedFromBottomRef,
        distanceFromBottomRef,
      } = useEditorScroll({
        localContent,
        isProseStreaming: proseStreamingActive,
        isReplaceStreaming,
        chapterId: chapter.id,
      });

      const { checkContext, scheduleCheckContext, toggleBlockAtCaret } =
        useEditorFormatting({
          editorViewRef,
          onContextChange,
          contextDebounceMs: 150,
        });

      const writingUnavailableReason =
        'This action is unavailable because no working WRITING model is configured.';

      const handleSuggestionButtonClick = (): void => {
        if (isSuggesting || isAiLoading) {
          if (isSuggesting) {
            suggestionControls.onCancelSuggestion?.();
          } else if (isAiLoading) {
            onCancelAiAction?.();
          }
          return;
        }
        const cursor = getEditorCaretOffset() ?? localContentRef.current.length;
        onTriggerSuggestions(cursor, localContentRef.current);
      };

      const [isDragging, setIsDragging] = useState(false);

      const handleImageUpload = async (file: File): Promise<void> => {
        try {
          const res = await api.projects.uploadImage(file);
          if (res.ok) {
            insertImageMarkdown(res.filename, res.url);
          }
        } catch (e) {
          notifyError('Failed to upload image', e);
        }
      };

      const insertImageMarkdown = (
        filename: string,
        url: string,
        altText?: string
      ): void => {
        const alt = altText || filename;
        if (!isSafeImageUrl(url)) return;
        const md = `![${alt}](${url})`;
        const view = editorViewRef.current;
        if (view) {
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: md },
            selection: { anchor: from + md.length },
          });
          view.focus();
        } else {
          onChange(chapter.id, { content: chapter.content + '\n' + md });
        }
      };

      const handleDragOver = (e: React.DragEvent): void => {
        e.preventDefault();
        setIsDragging(true);
      };

      const handleDragLeave = (e: React.DragEvent): void => {
        e.preventDefault();
        setIsDragging(false);
      };

      const handleDrop = async (e: React.DragEvent): Promise<void> => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const file = e.dataTransfer.files[0];
          if (file.type.startsWith('image/')) {
            await handleImageUpload(file);
          }
        }
      };

      const getEditorCaretOffset = useCallback((): number | null => {
        return editorViewRef.current?.state.selection.main.head ?? null;
      }, []);

      const isEditorFocused = useCallback((): boolean => {
        return editorViewRef.current?.hasFocus ?? false;
      }, []);

      const stopPropagationIfAvailable = (
        e: KeyboardEvent | React.KeyboardEvent
      ): void => {
        e.stopPropagation?.();
      };

      const maybeHandleSuggestionHotkey = useCallback(
        (e: KeyboardEvent | React.KeyboardEvent): boolean => {
          const key = 'key' in e ? e.key : '';
          const ctrlKey = 'ctrlKey' in e ? e.ctrlKey : false;
          const metaKey = 'metaKey' in e ? e.metaKey : false;

          const suggestionActive =
            isSuggestionMode || continuations.length > 0 || isSuggesting;

          const editingFocus = isEditorFocused();
          const isArrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
            key
          );

          if (isArrow && editingFocus) {
            return false;
          }

          // Trigger: Ctrl+Enter / Cmd+Enter
          if (key === 'Enter' && (ctrlKey || metaKey)) {
            const cursor = getEditorCaretOffset() ?? chapter.content.length;
            e.preventDefault();
            stopPropagationIfAvailable(e);
            onKeyboardSuggestionAction('trigger', cursor, localContentRef.current);
            return true;
          }

          if (!suggestionActive) return false;

          const performSuggestionAction = (
            action: 'chooseLeft' | 'chooseRight' | 'regenerate' | 'undo' | 'exit',
            cursor?: number
          ): boolean => {
            e.preventDefault();
            stopPropagationIfAvailable(e);
            if (action === 'regenerate') {
              onKeyboardSuggestionAction(
                'regenerate',
                cursor ?? localContentRef.current.length,
                localContentRef.current
              );
            } else if (action === 'undo') {
              onKeyboardSuggestionAction('undo');
            } else if (action === 'exit') {
              onKeyboardSuggestionAction('exit', undefined, localContentRef.current);
            } else {
              onKeyboardSuggestionAction(action, undefined, localContentRef.current);
            }
            return true;
          };

          if (key === 'ArrowLeft') {
            return performSuggestionAction('chooseLeft');
          }
          if (key === 'ArrowRight') {
            return performSuggestionAction('chooseRight');
          }
          if (key === 'ArrowDown') {
            const cursor = getEditorCaretOffset();
            return performSuggestionAction('regenerate', cursor ?? undefined);
          }
          if (key === 'ArrowUp') {
            return performSuggestionAction('undo');
          }
          if (key === 'Escape') {
            return suggestionActive ? performSuggestionAction('exit') : false;
          }

          return false;
        },
        [
          isSuggestionMode,
          continuations.length,
          isSuggesting,
          onKeyboardSuggestionAction,
          getEditorCaretOffset,
          isEditorFocused,
          // localContentRef is a stable ref; reading .current inside the callback
          // always gives the latest value without requiring it in deps.
        ]
      );

      useEffect((): (() => void) => {
        // Capture shortcuts globally so suggestion controls remain reachable
        // while focus moves across editor-adjacent UI.
        const onKeyDown = (e: KeyboardEvent): void => {
          maybeHandleSuggestionHotkey(e);
        };
        window.addEventListener('keydown', onKeyDown, true);
        return (): void => window.removeEventListener('keydown', onKeyDown, true);
      }, [maybeHandleSuggestionHotkey]);

      // Provide prose-drag data so scene cards can receive dropped prose
      // selections.  onDragStart is called from CodeMirrorEditor's container
      // div as the dragstart event bubbles up from CM's contentDOM.  By that
      // point CM6's own handler has already run and set
      // effectAllowed = "copyMove"; we override it to "all" so that drop
      // targets can use any dropEffect (including "link").
      const handleCmDragStart = useCallback(
        (e: DragEvent, view: EditorView): void => {
          const sel = view.state.selection.main;
          if (sel.empty) return;
          const text = view.state.doc.sliceString(sel.from, sel.to);
          const payload = JSON.stringify({
            scopeType: chapter.scope,
            chapterId: chapter.scope === 'chapter' ? chapter.id : undefined,
            bookId: (chapter as { book_id?: string }).book_id,
            startOffset: sel.from,
            endOffset: sel.to,
            text,
          });
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', text);
            e.dataTransfer.setData('application/aq-prose-selection', payload);
            // Must be set AFTER CM6's own handler (which sets "copyMove") so
            // that our override wins.  The container-div React handler fires
            // after CM6's contentDOM handler due to event bubbling order.
            e.dataTransfer.effectAllowed = 'all';
          }
        },
        [chapter]
      );

      const format = (type: string): void => {
        const view = editorViewRef.current;
        if (!view) return;

        const rawText = view.state.doc.toString();
        const { anchor, head } = view.state.selection.main;
        const rawStart = Math.min(anchor, head);
        const rawEnd = Math.max(anchor, head);

        if (
          type === 'h1' ||
          type === 'h2' ||
          type === 'h3' ||
          type === 'quote' ||
          type === 'ul' ||
          type === 'ol'
        ) {
          toggleBlockAtCaret(type as MarkdownBlockType);
          checkContext();
          return;
        }

        if (
          type === 'bold' ||
          type === 'italic' ||
          type === 'strikethrough' ||
          type === 'subscript' ||
          type === 'superscript'
        ) {
          const { nextRawText, nextStart, nextEnd } = toggleInlineFormatAtSelection(
            rawText,
            rawStart,
            rawEnd,
            type as InlineFormatType
          );
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: nextRawText },
            selection: { anchor: nextStart, head: nextEnd },
          });
          view.focus();
          checkContext();
          return;
        }

        if (type === 'link' || type === 'image') {
          const selectedText = rawText.slice(rawStart, rawEnd);
          const prefix = type === 'image' ? '![' : '[';
          const suffix = `](${selectedText ? '' : 'url'})`;
          const insert = prefix + selectedText + suffix;
          view.dispatch({
            changes: { from: rawStart, to: rawEnd, insert },
            selection: { anchor: rawStart + insert.length },
          });
          view.focus();
          return;
        }

        if (type === 'codeblock') {
          const { nextRawText, nextStart, nextEnd } = insertFencedCodeBlock(
            rawText,
            rawStart,
            rawEnd
          );
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: nextRawText },
            selection: { anchor: nextStart, head: nextEnd },
          });
          view.focus();
          return;
        }

        if (type === 'footnote') {
          const { nextRawText, nextCaret } = insertFootnote(rawText, rawStart);
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: nextRawText },
            selection: { anchor: nextCaret },
          });
          view.focus();
          return;
        }
      };

      useImperativeHandle(ref, () => ({
        insertImage: (filename: string, url: string, altText?: string): void =>
          insertImageMarkdown(filename, url, altText),
        focus: (): void => {
          editorViewRef.current?.focus();
        },
        format: (type: string): void => format(type),
        jumpToPosition: (start: number, end: number): void => {
          const view = editorViewRef.current;
          if (!view) return;
          const docLen = view.state.doc.length;
          const safeEnd = Math.min(Math.max(start, end), docLen);
          const safeStart = Math.min(Math.max(0, start), safeEnd);
          view.dispatch({
            selection: { anchor: safeStart, head: safeEnd },
            scrollIntoView: true,
          });
          view.focus();
        },
        getEditorView: (): EditorView | null => editorViewRef.current,
        setOnCursorChange: (
          cb: ((anchor: number, head: number) => void) | null
        ): void => {
          externalCursorCallbackRef.current = cb;
        },
        setProseHighlights: (entries: ProseHighlightRange[]): void => {
          const view = editorViewRef.current;
          if (view) {
            gPendingHighlights = null;
            const effects: StateEffect<unknown>[] = [
              setProseHighlightEffect.of(entries),
            ];
            if (entries.length > 0) {
              const { from, to } = entries[0];
              if (!isRangeVisible(from, to, view.visibleRanges)) {
                effects.push(EditorView.scrollIntoView(from));
              }
            }
            view.dispatch({ effects });
          } else {
            // EditorView not created yet — store and retry after effects
            gPendingHighlights = entries;
            const capturedRef = editorViewRef;
            setTimeout((): void => {
              const rv = capturedRef.current;
              if (!rv || !gPendingHighlights) return;
              const pending = gPendingHighlights;
              gPendingHighlights = null;
              const rEffects: StateEffect<unknown>[] = [
                setProseHighlightEffect.of(pending),
              ];
              if (pending.length > 0) {
                const { from, to } = pending[0];
                if (!isRangeVisible(from, to, rv.visibleRanges)) {
                  rEffects.push(EditorView.scrollIntoView(from));
                }
              }
              rv.dispatch({ effects: rEffects });
            }, 0);
          }
        },
        clearProseHighlight: (): void => {
          editorViewRef.current?.dispatch({
            effects: setProseHighlightEffect.of([]),
          });
        },
        setOnProseBoundaryChange: (cb: ProseBoundaryCallback | null): void => {
          proseBoundaryCallbackRef.current = cb;
        },
        setAnnotationRanges: (ranges: AnnotationRange[]): void => {
          editorViewRef.current?.dispatch({
            effects: setAnnotationRangesEffect.of(ranges),
          });
        },
        setOnAnnotationClick: (
          cb: ((annotationId: string | null) => void) | null
        ): void => {
          setAnnotationClickCallback(cb);
        },
        getSelection: (): { anchor: number; head: number } | null => {
          const sel = editorViewRef.current?.state.selection.main;
          return sel ? { anchor: sel.anchor, head: sel.head } : null;
        },
      }));

      // Styles & Theme Logic
      let pageBackgroundColor: string;
      let textColor: string;
      let editorContainerBg: string;
      let selectionBg: string;

      if (settings.theme === 'dark') {
        const b = settings.brightness * 20; // range 10-20% lightness
        pageBackgroundColor = `hsl(24, 10%, ${b}%)`;
        textColor = `rgba(231, 229, 228, ${settings.contrast})`;
        editorContainerBg = 'bg-brand-gray-950';
        // Dark background: stronger selection to remain visible
        selectionBg = 'rgba(99,102,241,0.40)';
      } else {
        pageBackgroundColor = `hsl(38, 25%, ${settings.brightness * 100}%)`;
        textColor = `rgba(20, 15, 10, ${settings.contrast})`;
        editorContainerBg =
          settings.theme === 'light' ? 'bg-brand-gray-100' : 'bg-brand-gray-950';
        // Light/Mixed mode: warm editor background — use a soft semi-transparent
        // highlight so selected text stays readable without being too vivid
        selectionBg = 'rgba(99,102,241,0.22)';
      }

      // Prose-link highlight: the page warm hue pushed to high saturation and
      // consistently lower lightness so the highlighted passage stands out at
      // every brightness level.  Both formulas use a fixed lightness delta from
      // the page so the contrast is stable regardless of the slider position.
      let proseHighlightBg: string;
      if (settings.theme === 'dark') {
        // Dark page: hsl(24, 10%, b%) where b = brightness*20 (10–20%).
        // Highlight is always ~22 points brighter with rich saturation.
        const b = settings.brightness * 20;
        proseHighlightBg = `hsl(24, 65%, ${Math.min(b + 22, 44)}%)`;
      } else {
        // Light/Mixed page: hsl(38, 25%, brightness*100%).
        // Highlight is always 28 points darker with rich saturation so it
        // never blends into the background, even at low brightness settings.
        const pageL = settings.brightness * 100;
        proseHighlightBg = `hsl(38, 88%, ${Math.max(pageL - 28, 20)}%)`;
      }

      const isMonospace = viewMode === 'raw';
      const fontFamily = isMonospace
        ? '"JetBrains Mono", "Fira Code", monospace'
        : 'Merriweather, serif';
      const titleFontFamily = 'Merriweather, serif'; // Always serif for title

      const commonTextStyle: React.CSSProperties = {
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: '1.75',
        padding: '0px',
        margin: '0',
        border: 'none',
        width: '100%',
        boxSizing: 'border-box',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
      };

      const toolbarBg =
        settings.theme === 'light'
          ? 'bg-brand-gray-50 border-b border-brand-gray-200 shadow-sm'
          : 'bg-brand-gray-900 border-b border-brand-gray-800 shadow-sm';
      const textMuted =
        settings.theme === 'light' ? 'text-brand-gray-500' : 'text-brand-gray-500';
      const footerBg =
        settings.theme === 'light'
          ? 'bg-brand-gray-50 border-t border-brand-gray-200'
          : 'bg-brand-gray-900 border-t border-brand-gray-800';
      const hasContinuationOptions = continuations.some(
        (option: string): boolean | '' => option && option.trim().length > 0
      );
      const shouldShowContinuationPanel = isSuggestionMode || hasContinuationOptions;
      const displayedContinuations =
        continuations.length > 0
          ? continuations
          : Array.from({ length: 2 }, (): string => '');
      const isChapterEmpty = !chapter.content || chapter.content.trim().length === 0;

      // We need to scroll in a few scenarios:
      //   * suggestion generation is active and options are changing,
      //   * the continuation panel just became visible.
      //
      // IMPORTANT: prose streaming has its own dedicated bottom-follow logic in
      // the layout effect above. Running this effect at the same time causes two
      // competing scroll writers and can produce up/down flicker at bottom.
      //   * the continuation panel first becomes visible
      //     (`hasContinuationOptions` transitions from false to true), because
      //     its appearance can push the editor content upward and may hide the
      //     current viewport.
      //
      // We deliberately *do not* auto-scroll when the user is editing while the
      // panel is already present; the guard below prevents scrolling unless an
      // LLM action is active or the panel just opened.
      const prevHasContinuationRef = useRef<boolean>(hasContinuationOptions);
      useEffect((): (() => void) | undefined => {
        const justOpened = !prevHasContinuationRef.current && hasContinuationOptions;
        prevHasContinuationRef.current = hasContinuationOptions;

        if (proseStreamingActive) return undefined;
        if (!(isAiLoading || isSuggesting || justOpened)) return undefined;

        const raf = window.requestAnimationFrame((): void => {
          if (!isDetachedFromBottomRef.current) {
            scrollMainContentToBottom();
          }
        });
        return (): void => {
          window.cancelAnimationFrame(raf);
        };
      }, [
        continuations,
        isAiLoading,
        isSuggesting,
        proseStreamingActive,
        hasContinuationOptions,
        scrollMainContentToBottom,
      ]);

      return (
        <EditorProvider
          value={{
            theme: settings.theme,
            toolbarBg,
            footerBg,
            textMuted,
            chapterScope: chapter.scope,
            isAiLoading,
            isWritingAvailable,
            writingUnavailableReason,
            isChapterEmpty,
            onAiAction,
            shouldShowContinuationPanel,
            displayedContinuations,
            suggestionMode,
            onSuggestionModeChange: setSuggestionMode,
            isSuggesting,
            localContentRef,
            onSuggestionButtonClick: handleSuggestionButtonClick,
            onAcceptContinuation,
            onRegenerate: (cursor: number, content: string): void =>
              suggestionControls.onKeyboardSuggestionAction?.(
                'regenerate',
                cursor,
                content
              ),
          }}
        >
          <div
            className={`flex flex-col h-full w-full overflow-hidden relative ${editorContainerBg}`}
          >
            <EditorMobileToolbar />

            {/* Main Scrollable Content Area */}
            <div
              ref={scrollContainerRef}
              data-testid="editor-scroll-container"
              className="flex-1 overflow-y-auto px-4 py-6 md:py-8 flex flex-col items-center relative"
              style={{ overflowAnchor: 'none' }}
              onScroll={handleScroll}
              onWheel={handleWheel}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
            >
              {isDragging && (
                <div className="absolute inset-0 bg-blue-500/10 z-50 flex items-center justify-center border-4 border-blue-500 border-dashed m-4 rounded-xl pointer-events-none">
                  <div className="bg-white dark:bg-gray-800 p-4 rounded shadow-lg flex flex-col items-center">
                    <Upload className="w-8 h-8 mb-2 text-blue-500" />
                    <span className="font-bold text-blue-500">
                      {t('Drop image to upload')}
                    </span>
                  </div>
                </div>
              )}
              {/* The Paper - Grows infinitely */}
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
              <div
                ref={paperDivRef}
                role="group"
                aria-label={t('Editor workspace')}
                className="relative w-full shadow-2xl transition-colors duration-300 ease-in-out px-4 py-8 md:px-12 md:py-16 mx-auto flex flex-col flex-none min-h-full"
                style={{
                  maxWidth: `${settings.maxWidth}ch`,
                  backgroundColor: pageBackgroundColor,
                  color: textColor,
                  fontSize: `${settings.fontSize}px`,
                  fontFamily: fontFamily,
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {/* Toolbar - Removed Image Icon here */}
                {showInlineTitle && (
                  <div className="flex items-start gap-3 mb-8">
                    <textarea
                      value={localTitle}
                      onChange={(
                        e: React.ChangeEvent<HTMLTextAreaElement, HTMLTextAreaElement>
                      ): void => {
                        const val = e.target.value.replace(/\n/g, '');
                        setLocalTitle(val);
                        if (titleDebounceRef.current)
                          clearTimeout(titleDebounceRef.current);
                        titleDebounceRef.current = setTimeout((): void => {
                          onChange(chapter.id, { title: val });
                        }, DEBOUNCE_MS);
                      }}
                      rows={1}
                      className="flex-1 bg-transparent font-serif font-bold border-b-2 border-transparent focus:border-brand-gray-400/50 transition-colors outline-none resize-none overflow-hidden"
                      placeholder={
                        chapter.scope === 'story' ? 'Story Title' : 'Chapter Title'
                      }
                      lang={language || 'en'}
                      spellCheck={spellCheck}
                      style={{
                        ...commonTextStyle,
                        fontSize: '1.8em',
                        lineHeight: '1.3',
                        fontFamily: titleFontFamily,
                      }}
                    />
                  </div>
                )}

                {/* Editor Area */}
                <div id="editor-area" className="flex flex-col relative w-full">
                  <div id="codemirror-editor" className="relative w-full flex flex-col">
                    <CodeMirrorEditor
                      ref={editorViewRef}
                      value={localContent}
                      language={language}
                      spellCheck={spellCheck}
                      onOpenSearch={onOpenSearch}
                      onDragStart={handleCmDragStart}
                      onChange={(val: string, isUndoRedo?: boolean): void => {
                        setLocalContent(val);
                        localContentRef.current = val;
                        // Clear diff immediately on user input so typed text is
                        // never highlighted as a diff insertion. Keep the baseline
                        // active when undo/redo is used so the diff view works.
                        if (isUndoRedo) {
                          // Undo/redo: always restore the real AI baseline so the
                          // diff view activates, even if localBaseline was already
                          // set to a user-edit baseline by the debounce firing.
                          if (savedBaselineRef.current !== undefined) {
                            setLocalBaseline(savedBaselineRef.current);
                          }
                        } else if (localBaseline !== undefined) {
                          setLocalBaseline(undefined);
                        }
                        scheduleCheckContext();
                        if (contentDebounceRef.current) {
                          clearTimeout(contentDebounceRef.current);
                        }
                        contentDebounceRef.current = setTimeout((): void => {
                          // Re-inject internal markers (scene + annotation) that
                          // were stripped from the editor document when
                          // hideSceneMarkers is true.  The backend expects content
                          // with markers so markers are preserved across saves.
                          const contentWithMarkers = transferInternalMarkers(
                            lastSavedFullContentRef.current,
                            val
                          );
                          lastSavedFullContentRef.current = contentWithMarkers;
                          onChange(
                            chapter.id,
                            { content: contentWithMarkers },
                            isUndoRedo
                          );
                        }, DEBOUNCE_MS);
                      }}
                      onSelectionChange={(anchor: number, head: number): void => {
                        scheduleCheckContext();
                        externalCursorCallbackRef.current?.(anchor, head);
                      }}
                      viewMode={
                        viewMode === 'wysiwyg'
                          ? 'visual'
                          : viewMode === 'markdown'
                            ? 'markdown'
                            : 'plain'
                      }
                      showWhitespace={showWhitespace}
                      showDiff={settings.showDiff}
                      streamingMode={streamingModeActive}
                      baselineValue={localBaseline}
                      showDiffToolbar={
                        localBaseline !== undefined && localBaseline !== chapter.content
                      }
                      onAcceptDiff={(): void => {
                        setLocalBaseline(undefined);
                      }}
                      onRejectDiff={(): void => {
                        if (savedBaselineRef.current !== undefined) {
                          setLocalContent(savedBaselineRef.current);
                          localContentRef.current = savedBaselineRef.current;
                          setLocalBaseline(undefined);
                        }
                      }}
                      searchHighlightRanges={chapterSearchHighlightRanges}
                      enterBehavior="softbreak"
                      isLight={settings.theme === 'light'}
                      selectionBg={selectionBg}
                      proseHighlightBg={proseHighlightBg}
                      hideSceneMarkers={true}
                      onProseBoundaryChange={(
                        sceneId: SceneId,
                        edge: 'start' | 'end',
                        offset: number
                      ): void => {
                        proseBoundaryCallbackRef.current?.(sceneId, edge, offset);
                      }}
                      placeholder={
                        chapter.scope === 'story'
                          ? 'Start writing your story here...'
                          : 'Start writing your chapter here...'
                      }
                      className="w-full"
                      style={{
                        ...commonTextStyle,
                        caretColor: textColor,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0 h-16 w-full"></div>
            </div>

            {/* Persistent Footer */}
            <EditorSuggestionPanel />
          </div>
        </EditorProvider>
      );
    }
  )
);
/* eslint-enable complexity */

Editor.displayName = 'Editor';
