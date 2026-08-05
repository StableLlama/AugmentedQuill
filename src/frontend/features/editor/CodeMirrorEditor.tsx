// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Provides a CodeMirror 6-based editable surface for Raw and Markdown
 * modes, replacing the old contenteditable-based PlainTextEditable.  All
 * selection, caret, and DOM concerns are delegated to CodeMirror; callers
 * interact with the document exclusively through EditorView's state API.
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
  Decoration,
  ViewPlugin,
  ViewUpdate,
  DecorationSet,
  drawSelection,
  WidgetType,
} from '@codemirror/view';
import {
  EditorState,
  Compartment,
  Prec,
  Range,
  Transaction,
  StateEffect,
  StateField,
} from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { SceneId } from '../../types';
import {
  buildMarkdownDecorationPlugin,
  markdownDecorationTheme,
  type DecorationViewMode,
} from './markdownDecorations';
import { buildClipboardExtension } from './clipboardExtension';
import { buildDiffPlugin, externalValueSyncAnnotation } from './codeMirrorDiffPlugin';
import { buildWhitespacePlugin } from './codeMirrorWhitespacePlugin';
import { buildEnterExtension, buildTabExtension } from './codeMirrorKeymap';
import { stripInlineInternalMarkers } from './internalTags';
import { buildAnnotationExtensions } from './annotationPlugin';
import { FloatingDiffToolbar } from './FloatingDiffToolbar';

// ─── Prose-link highlight StateEffect / StateField ───────────────────────────
// Exported so that EditorHandle.setProseHighlight can dispatch it directly on
// the EditorView without going through a React prop.

export interface ProseHighlightRange {
  /** Owning scene identifier – used to route boundary-drag callbacks. */
  sceneId: SceneId;
  from: number;
  to: number;
}

/**
 * Per-paper highlight colour tokens.  The editor lives on a cream/white
 * "paper" page in light and mixed themes and on a dark page with light
 * letters in dark theme; supplying tuned values per paper keeps every
 * highlight legible without washing out the prose the user reads through.
 * All fields are optional — omitted tokens fall back to theme defaults.
 */
export interface EditorHighlightColors {
  /** Subtle grouping tint behind scene-linked prose (must stay easy to read through). */
  proseHighlightBg?: string;
  /** Search-hit background. */
  searchHighlightBg?: string;
  /** Annotation dotted-underline colour and its very subtle background. */
  annotationUnderline?: string;
  annotationBg?: string;
  /** Diff inserted background and bottom border. */
  diffInsertBg?: string;
  diffInsertBorder?: string;
  /** Diff deleted background and bottom border. */
  diffDeleteBg?: string;
  diffDeleteBorder?: string;
}

/** Callback type for prose-link boundary drag events. */
export type ProseBoundaryCallback = (
  sceneId: SceneId,
  edge: 'start' | 'end',
  offset: number
) => void;

export const setProseHighlightEffect = StateEffect.define<ProseHighlightRange[]>();

export const proseHighlightField = StateField.define<ProseHighlightRange[]>({
  create: () => [],
  update(value: ProseHighlightRange[], tr: Transaction) {
    for (const e of tr.effects) {
      if (e.is(setProseHighlightEffect)) return e.value;
    }
    return value;
  },
});

// ─── Prose-link boundary drag handles ────────────────────────────────────────

/**
 * Inline widget rendered at the start and end of each prose-link highlight.
 *
 * Visual marker is a thin vertical bar rendered via an absolutely-positioned
 * ::before pseudo-element — zero width in text flow, no reflow, no character
 * overlap.  The widget itself is 2 px wide to provide a clickable drag area.
 * Only mousedown events are intercepted; all other events pass through to the
 * editor so cursor navigation, selection, and clicks feel natural.
 */
class ProseHandleWidget extends WidgetType {
  constructor(
    private readonly sceneId: SceneId,
    private readonly edge: 'start' | 'end',
    private readonly offset: number,
    private readonly callbackRef: React.MutableRefObject<ProseBoundaryCallback | null>,
    private readonly view: EditorView
  ) {
    super();
  }

  eq(other: ProseHandleWidget): boolean {
    return (
      this.sceneId === other.sceneId &&
      this.edge === other.edge &&
      this.offset === other.offset
    );
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `cm-prose-handle cm-prose-handle-${this.edge}`;
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('data-testid', `handle-${this.edge}-${this.sceneId}`);
    el.title =
      this.edge === 'start' ? 'Drag to move scene start' : 'Drag to move scene end';
    const { view, sceneId, edge, callbackRef } = this;
    el.addEventListener('mousedown', (downEv: MouseEvent): void => {
      downEv.preventDefault();
      downEv.stopPropagation();
      let currentOffset = this.offset;
      const onMove = (moveEv: MouseEvent): void => {
        const pos = view.posAtCoords({ x: moveEv.clientX, y: moveEv.clientY }, false);
        if (pos == null) return;
        currentOffset = pos;
        const current = view.state.field(proseHighlightField);
        const draggedEntry = current.find(
          (r: ProseHighlightRange): boolean => r.sceneId === sceneId
        );
        if (!draggedEntry) return;
        const draggedFrom = edge === 'start' ? pos : draggedEntry.from;
        const draggedTo = edge === 'end' ? pos : draggedEntry.to;
        const updated = current.map((r: ProseHighlightRange): ProseHighlightRange => {
          if (r.sceneId === sceneId) {
            return edge === 'start' ? { ...r, from: pos } : { ...r, to: pos };
          }
          // When the new dragged range is valid, push any range that it now overlaps
          // so no two scenes share the same text during live preview.
          if (draggedFrom >= draggedTo) return r;
          if (r.to <= draggedFrom || r.from >= draggedTo) return r;
          if (edge === 'end') {
            // Right boundary moved right: push the other scene's start.
            return draggedTo < r.to ? { ...r, from: draggedTo } : r;
          } else {
            // Left boundary moved left: push the other scene's end.
            return r.from < draggedFrom ? { ...r, to: draggedFrom } : r;
          }
        });
        view.dispatch({ effects: setProseHighlightEffect.of(updated) });
      };
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (typeof window !== 'undefined' && window.__AQ_DEBUG_RANGES) {
          console.log(
            `[AQ:ProseHandleWidget] mouseup, sceneId=${sceneId} edge=${edge} currentOffset=${currentOffset}`
          );
        }
        callbackRef.current?.(sceneId, edge, currentOffset);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    return el;
  }

  /** Let the editor handle all events except mousedown (drag affordance). */
  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown';
  }
}

/**
 * Factory that builds a ViewPlugin rendering mark decorations plus draggable
 * boundary widgets for all active prose-link highlights.  Accepts a stable
 * MutableRefObject so the plugin can be constructed once at mount time while
 * always reading the latest callback.
 */
function buildProseHighlightPlugin(
  callbackRef: React.MutableRefObject<ProseBoundaryCallback | null>
): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate): void {
        if (
          u.state.field(proseHighlightField) !==
            u.startState.field(proseHighlightField) ||
          u.docChanged
        ) {
          this.decorations = this.build(u.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const ranges = view.state.field(proseHighlightField);
        if (ranges.length === 0) return Decoration.none;
        const docLen = view.state.doc.length;
        const decos: Range<Decoration>[] = [];
        const sorted = [...ranges].sort(
          (a: ProseHighlightRange, b: ProseHighlightRange): number => a.from - b.from
        );
        for (const entry of sorted) {
          const from = Math.max(0, Math.min(entry.from, docLen));
          const to = Math.max(0, Math.min(entry.to, docLen));
          if (from >= to) continue;
          // side:-1 on the end widget and side:1 on the start widget ensure that
          // when two scenes share a boundary position the end bracket ']' sorts
          // before the start bracket '[', giving the correct visual '][' order.
          decos.push(
            Decoration.widget({
              widget: new ProseHandleWidget(
                entry.sceneId,
                'end',
                to,
                callbackRef,
                view
              ),
              side: -1,
            }).range(to)
          );
          decos.push(
            Decoration.mark({ class: 'cm-prose-link-highlight' }).range(from, to)
          );
          decos.push(
            Decoration.widget({
              widget: new ProseHandleWidget(
                entry.sceneId,
                'start',
                from,
                callbackRef,
                view
              ),
              side: 1,
            }).range(from)
          );
        }
        return Decoration.set(decos, true);
      }
    },
    {
      decorations: (v: { decorations: DecorationSet }): DecorationSet => v.decorations,
    }
  );
}

// ─── Markdown syntax highlight style ────────────────────────────────────────
// Maps Lezer markdown tokens to CSS properties so prose writers see inline
// formatting cues without colour noise.

const mdHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: 'bold', fontSize: '1.2em' },
  { tag: tags.heading2, fontWeight: 'bold', fontSize: '1.15em' },
  { tag: tags.heading3, fontWeight: '600', fontSize: '1.1em' },
  { tag: tags.heading4, fontWeight: '600' },
  { tag: tags.heading5, fontWeight: '600' },
  { tag: tags.heading6, fontWeight: '600' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, fontFamily: 'monospace', fontSize: '0.9em' },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.url, opacity: '0.55' },
  { tag: tags.quote, fontStyle: 'italic', opacity: '0.75' },
  { tag: tags.meta, opacity: '0.5' },
  { tag: tags.punctuation, opacity: '0.5' },
  { tag: tags.processingInstruction, opacity: '0.5' },
  { tag: tags.contentSeparator, opacity: '0.5' },
  { tag: tags.labelName, opacity: '0.55' },
]);

const buildSceneMarkerHideExtension = (): Extension => [];

// ─── Base theme ──────────────────────────────────────────────────────────────
// Makes CodeMirror transparent so the host element's styles (font, colour, bg)
// bleed through.  The scroller uses overflow:visible so the parent container
// is responsible for scrolling — this matches how the rest of the editor page
// is laid out.

const baseTheme = EditorView.theme({
  '&': {
    color: 'inherit',
    backgroundColor: 'transparent',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    height: 'auto',
    // Fallback selection colours used when the selectionBg prop is not set.
    // The selectionBgCompartment overrides these at runtime.
    '--aq-selection-bg': 'rgba(99,102,241,0.25)',
    '--aq-selection-bg-focused': 'rgba(99,102,241,0.35)',
    // Default highlight tokens tuned for the light/cream paper.  The
    // highlight-colours compartment overrides these per paper (light/mixed
    // cream vs dark), keeping every layer comfortable to read through.
    '--aq-prose-highlight-bg': 'rgba(180, 110, 0, 0.06)',
    '--aq-search-bg': 'rgba(245, 158, 11, 0.22)',
    '--aq-annotation-underline': 'rgba(124, 58, 237, 0.60)',
    '--aq-annotation-bg': 'rgba(124, 58, 237, 0.07)',
    '--aq-diff-insert-bg': 'rgba(34, 197, 94, 0.14)',
    '--aq-diff-insert-border': 'rgba(34, 197, 94, 0.45)',
    '--aq-diff-delete-bg': 'rgba(239, 68, 68, 0.14)',
    '--aq-diff-delete-border': 'rgba(239, 68, 68, 0.45)',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    overflow: 'visible',
  },
  '.cm-content': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    color: 'inherit',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
    padding: '0',
    caretColor: 'inherit',
  },
  '.cm-line': {
    padding: '0',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'inherit',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent !important',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--aq-selection-bg) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--aq-selection-bg-focused) !important',
  },
  '.cm-ws-marker': {
    opacity: '1',
    pointerEvents: 'auto',
    userSelect: 'text',
    fontStyle: 'normal',
    fontWeight: 'normal',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    verticalAlign: 'baseline',
    boxSizing: 'border-box',
  },
  '.cm-ws-marker.cm-ws-space': {
    color: 'color-mix(in srgb, currentColor 35%, transparent)',
    whiteSpace: 'break-spaces',
    backgroundImage: 'radial-gradient(circle, currentColor 35%, transparent 36%)',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '0.35em 0.35em',
  },
  '.cm-ws-marker .cm-ws-glyph': {
    opacity: '1',
    color: 'color-mix(in srgb, currentColor 35%, transparent)',
  },
  // Selected WS markers: let the drawSelection semi-transparent background
  // show through (transparent) while keeping the glyph at its normal dim
  // colour — no text inversion because the selection bg is never opaque.
  ".cm-ws-marker[data-ws-selected='1']": {
    backgroundColor: 'transparent !important',
    borderBottomColor: 'transparent !important',
  },
  "&.cm-focused .cm-ws-marker[data-ws-selected='1']": {
    backgroundColor: 'transparent !important',
    borderBottomColor: 'transparent !important',
  },
  ".cm-ws-marker[data-ws-diff='1'][data-ws-selected='1']": {
    backgroundColor: 'var(--aq-diff-insert-bg) !important',
    borderBottomColor: 'var(--aq-diff-insert-border) !important',
  },
  ".cm-diff-deleted .cm-ws-marker[data-ws-diff='1'][data-ws-selected='1'], .cm-ws-marker.cm-diff-deleted[data-ws-diff='1'][data-ws-selected='1']":
    {
      backgroundColor: 'var(--aq-diff-delete-bg) !important',
      borderBottomColor: 'var(--aq-diff-delete-border) !important',
    },
  ".cm-ws-marker[data-ws-diff='1']": {
    opacity: '1',
    backgroundColor: 'var(--aq-diff-insert-bg)',
    borderBottomStyle: 'solid',
    borderBottomWidth: '1px',
    borderBottomColor: 'var(--aq-diff-insert-border)',
    borderRadius: '0',
  },
  ".cm-ws-marker[data-ws-diff='1'] .cm-ws-glyph": {
    opacity: '1',
    color: 'color-mix(in srgb, currentColor 35%, transparent)',
  },
  ".cm-ws-marker[data-ws-diff='1'][data-ws-tab='1']": {
    backgroundColor: 'var(--aq-diff-insert-bg)',
    borderBottomStyle: 'solid',
    borderBottomWidth: '1px',
    borderBottomColor: 'var(--aq-diff-insert-border)',
    borderRadius: '0',
    padding: '0',
    margin: '0',
  },
  ".cm-diff-deleted .cm-ws-marker[data-ws-diff='1']": {
    backgroundColor: 'var(--aq-diff-delete-bg)',
    borderBottomStyle: 'solid',
    borderBottomWidth: '1px',
    borderBottomColor: 'var(--aq-diff-delete-border)',
    textDecorationLine: 'line-through',
    textDecorationColor: 'currentColor',
    textDecorationSkipInk: 'none',
  },
  ".cm-ws-marker.cm-diff-deleted[data-ws-diff='1']": {
    backgroundColor: 'var(--aq-diff-delete-bg)',
    borderBottomStyle: 'solid',
    borderBottomWidth: '1px',
    borderBottomColor: 'var(--aq-diff-delete-border)',
    textDecorationLine: 'line-through',
    textDecorationColor: 'currentColor',
    textDecorationSkipInk: 'none',
  },
  ".cm-ws-marker.cm-diff-deleted[data-ws-diff='1'] .cm-ws-glyph": {
    textDecorationLine: 'line-through',
    textDecorationColor: 'currentColor',
    textDecorationSkipInk: 'none',
  },
  '.diff-inserted': {
    backgroundColor: 'var(--aq-diff-insert-bg) !important',
    borderBottomStyle: 'dashed',
    borderBottomWidth: '1px',
    borderBottomColor: 'var(--aq-diff-insert-border)',
    borderRadius: '2px',
    transition: 'background-color 0.2s ease',
  },
  '.cm-search-highlight': {
    backgroundColor: 'var(--aq-search-bg)',
    borderRadius: '2px',
  },
  // Prose-link highlight: a deliberately subtle tint so the reader can keep
  // reading through the whole scene without distraction.  The primary cues are
  // the draggable boundary handles and the scene-title pill; the tint is only a
  // soft grouping assist.  The exact colour is overridden per-paper via the
  // highlight-colours compartment.
  '.cm-prose-link-highlight': {
    backgroundColor: 'var(--aq-prose-highlight-bg, rgba(180, 110, 0, 0.06))',
    borderRadius: '2px',
  },
  // Draggable boundary handles rendered at the start/end of each prose-link
  // highlight.  The marker is an absolutely-positioned ::before pill — zero
  // width in text flow so the text never reflows, but 6 px wide visually so
  // it can be grabbed with the mouse.  Mousedown on the ::before area bubbles
  // to the widget for drag-to-resize; all other events pass through.
  '.cm-prose-handle': {
    display: 'inline-block',
    position: 'relative',
    width: '0px',
    verticalAlign: 'baseline',
    cursor: 'ew-resize',
    userSelect: 'none',
    pointerEvents: 'all',
  },
  '.cm-prose-handle::before': {
    content: '""',
    position: 'absolute',
    left: '-3px',
    top: '-0.35em',
    height: '0.7em',
    width: '6px',
    background: 'rgba(180, 100, 0, 0.50)',
    borderRadius: '3px',
  },
  // Placeholder styling
  '.cm-placeholder': {
    color: 'inherit',
    opacity: '0.4',
    fontStyle: 'normal',
  },
  '.cm-diff-inserted': {
    backgroundColor: 'var(--aq-diff-insert-bg)',
    borderBottomStyle: 'solid',
    borderBottomWidth: '1px',
    borderBottomColor: 'var(--aq-diff-insert-border)',
  },
  // Provisional in-progress insertions (LLM streaming): same green family but
  // with a dashed rule so the user can tell "still being written" apart from a
  // committed diff until they accept it.
  '.cm-diff-inserted.cm-diff-streaming': {
    borderBottomStyle: 'dashed',
  },
  '.cm-diff-deleted': {
    backgroundColor: 'var(--aq-diff-delete-bg)',
    textDecoration: 'line-through',
    borderBottomStyle: 'solid',
    borderBottomWidth: '1px',
    borderBottomColor: 'var(--aq-diff-delete-border)',
  },
  '.cm-diff-deleted.cm-widget': {
    display: 'inline',
    whiteSpace: 'inherit',
    overflowWrap: 'inherit',
    wordBreak: 'inherit',
    verticalAlign: 'baseline',
  },
});

// ─── Public API ──────────────────────────────────────────────────────────────

export interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string, isUndoRedo?: boolean) => void;
  /**
   * Editor display mode:
   * 'raw'      — plain text, no syntax highlighting, monospace
   * 'markdown' — Lezer-based markdown highlighting, inline widgets, softbreak Enter
   * 'visual'   — markdown syntax hidden, WYSIWYG-like rendering, softbreak Enter
   *
   * Legacy alias: 'plain' maps to 'raw'.
   */
  viewMode?: 'raw' | 'markdown' | 'visual' | 'plain';
  /**
   * @deprecated Use viewMode instead. Kept for backward compatibility.
   */
  mode?: 'plain' | 'markdown';
  /** Show spaces / tabs / newlines as visible glyphs */
  showWhitespace?: boolean;
  /**
   * Override for Enter key behavior.  When not set, derived from viewMode:
   *   raw → 'newline', markdown/visual → 'softbreak'
   *
   * 'newline'   — Enter inserts a plain newline
   * 'softbreak' — Enter inserts the markdown soft-break '  \n'; a second
   *               Enter on a line already ending with '  ' removes those
   *               spaces and inserts '\n\n' (paragraph break)
   * 'ignore'    — Enter does nothing (useful for single-line title fields)
   */
  enterBehavior?: 'newline' | 'softbreak' | 'ignore';
  /** Placeholder text shown when the document is empty */
  placeholder?: string;
  /** Applied to the outer wrapper <div> */
  className?: string;
  /** Applied to the outer wrapper <div> */
  style?: React.CSSProperties;
  /** Called on every selection / cursor change */
  onSelectionChange?: (anchor: number, head: number) => void;
  /** Text state to compare against for change highlighting (AI additions) */
  baselineValue?: string;
  /** Enable inline diff highlighting in the editor */
  showDiff?: boolean;
  /**
   * When true the diff plugin uses a common-prefix strategy instead of LCS so
   * that partial streamed text does not flicker between equal/inserted as new
   * chunks arrive.  Set this while an LLM is actively writing to the editor.
   */
  streamingMode?: boolean;
  /** Active search highlights in document text offset coordinates */
  searchHighlightRanges?: Array<{ start: number; end: number }>;
  /** BCP 47 language tag for spellcheck and hyphenation */
  language?: string;
  /** Whether to enable browser-native spellcheck */
  spellCheck?: boolean;
  /** Called when the user presses Ctrl+F / Cmd+F inside the editor */
  onOpenSearch?: () => void;
  /**
   * CSS colour value used as the selection background (both focused and
   * unfocused, via --aq-selection-bg / --aq-selection-bg-focused).
   * Should be a semi-transparent colour so text remains readable without
   * inversion.  Defaults to indigo-500 @ 25 / 35 %.
   *
   * Pass a theme-appropriate value from the parent so Light, Mixed, and Dark
   * modes each get the right contrast level.
   */
  selectionBg?: string;
  /**
   * Per-paper highlight colour tokens.  Every layer (scene prose-link, its
   * title pill, search, annotation, and diff insert/delete) is driven by CSS
   * variables that this object overrides.  Supply tuned values for the cream/
   * white paper (light + mixed themes) and the dark paper (dark theme) so
   * highlights stay legible yet comfortable to read through.  Omitted tokens
   * fall back to theme defaults.
   */
  highlightColors?: EditorHighlightColors;
  /** Called when a drag starts from inside the editor. Use to set custom dataTransfer data. */
  onDragStart?: (event: DragEvent, view: EditorView) => void;
  /**
   * Called when the user drags a prose-link boundary handle to a new position.
   * Fires on mouse-up with the scene id, which edge was moved, and the new
   * character offset.  Use this to persist updated start_offset / end_offset.
   */
  onProseBoundaryChange?: ProseBoundaryCallback;
  /** When true, scene marker comments are hidden in the rendered editor view. */
  hideSceneMarkers?: boolean;
  /**
   * Called when the user accepts a diff via the floating toolbar.
   * The parent should update the baseline to match the current content.
   */
  onAcceptDiff?: () => void;
  /**
   * Called when the user rejects a diff via the floating toolbar.
   * The parent should revert content to the baseline.
   */
  onRejectDiff?: () => void;
  /** Whether to show the floating diff accept/reject toolbar on hover. */
  showDiffToolbar?: boolean;
  /** Whether the current theme is light (used for diff toolbar styling). */
  isLight?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const CodeMirrorEditor = React.forwardRef<
  EditorView | null,
  CodeMirrorEditorProps
>(
  (
    {
      value,
      onChange,
      viewMode: viewModeProp,
      mode: legacyMode,
      showWhitespace = false,
      enterBehavior: enterBehaviorProp,
      placeholder,
      className,
      style,
      onSelectionChange,
      baselineValue,
      showDiff = true,
      streamingMode = false,
      searchHighlightRanges,
      language = 'en',
      spellCheck = false,
      onOpenSearch,
      selectionBg,
      highlightColors,
      onDragStart,
      onProseBoundaryChange,
      hideSceneMarkers = false,
      onAcceptDiff,
      onRejectDiff,
      showDiffToolbar = false,
      isLight = true,
    }: CodeMirrorEditorProps,
    ref: React.ForwardedRef<EditorView | null>
  ) => {
    // Resolve viewMode: new prop takes precedence, then legacy mode, then default
    const viewMode: DecorationViewMode =
      viewModeProp === 'plain'
        ? 'raw'
        : (viewModeProp ?? (legacyMode === 'markdown' ? 'markdown' : 'raw'));

    // Derive enter behavior from viewMode unless explicitly overridden
    const enterBehavior = enterBehaviorProp ?? 'softbreak';

    // Derive CodeMirror language mode from viewMode
    const mode: 'plain' | 'markdown' = viewMode === 'raw' ? 'plain' : 'markdown';
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    // Stable callback refs so the CodeMirror updateListener closure always
    // calls the latest version without needing the view to be recreated.
    const onChangeRef = useRef(onChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onOpenSearchRef = useRef(onOpenSearch);
    const onDragStartRef = useRef(onDragStart);
    const proseBoundaryCallbackRef = useRef<ProseBoundaryCallback | null>(null);
    onChangeRef.current = onChange;
    onSelectionChangeRef.current = onSelectionChange;
    onOpenSearchRef.current = onOpenSearch;
    onDragStartRef.current = onDragStart;
    proseBoundaryCallbackRef.current = onProseBoundaryChange ?? null;

    // Track the last value emitted by our own onChange so we can distinguish
    // externally-driven value changes from the echo of our own edits.
    const lastEmittedRef = useRef(value);

    // Compartments allow dynamic extension switching without recreating the view
    const languageCompartment = useRef(new Compartment());
    const wsCompartment = useRef(new Compartment());
    const diffCompartment = useRef(new Compartment());
    const searchHighlightCompartment = useRef(new Compartment());
    const enterCompartment = useRef(new Compartment());
    const placeholderCompartment = useRef(new Compartment());
    const attributesCompartment = useRef(new Compartment());
    const mdDecorationCompartment = useRef(new Compartment());
    const markerHideCompartment = useRef(new Compartment());
    const selectionBgCompartment = useRef(new Compartment());
    const highlightColorsCompartment = useRef(new Compartment());
    // ── Extension builders ──────────────────────────────────────────────────

    const buildAttributesExtension = (
      la: string | undefined,
      sc: boolean,
      ph: string | undefined
    ): Extension => {
      const editorAriaLabel = ph ?? 'Story content';
      return EditorView.contentAttributes.of({
        lang: la || 'en',
        spellcheck: sc ? 'true' : 'false',
        autocomplete: 'off',
        autocorrect: sc ? 'on' : 'off',
        autocapitalize: sc ? 'sentences' : 'off',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': editorAriaLabel,
      });
    };

    const buildLanguageExtension = (m: typeof mode): Extension =>
      m === 'markdown'
        ? [markdown({ addKeymap: false }), syntaxHighlighting(mdHighlightStyle)]
        : [];

    const buildWsExtension = (
      ws: boolean,
      bv: string | undefined,
      showDiffEnabled: boolean,
      streamMode: boolean
    ): Extension => (ws ? buildWhitespacePlugin(bv, showDiffEnabled, streamMode) : []);

    const buildSearchHighlightPlugin = (
      ranges: Array<{ start: number; end: number }>
    ): Extension =>
      ViewPlugin.fromClass(
        class {
          decorations: DecorationSet;
          constructor(view: EditorView) {
            this.decorations = this.build(view);
          }
          /** Update the requested value. */
          update(u: ViewUpdate): void {
            if (u.viewportChanged || u.geometryChanged) {
              this.decorations = this.build(u.view);
            } else if (u.docChanged) {
              let safeInsert = true;
              u.changes.iterChanges(
                (
                  fromA: number,
                  toA: number,
                  _fB: number,
                  _tB: number,
                  ins: import('@codemirror/state').Text
                ): void => {
                  if (toA !== fromA || ins.length !== 1) {
                    safeInsert = false;
                    return;
                  }
                  const c = ins.sliceString(0, 1);
                  if (c === ' ' || c === '\t' || c === '\n') safeInsert = false;
                }
              );
              this.decorations = safeInsert
                ? this.decorations.map(u.changes)
                : this.build(u.view);
            }
          }
          /** Build the requested value. */
          build(view: EditorView): DecorationSet {
            const decs: Range<Decoration>[] = [];
            const length = view.state.doc.length;
            for (const range of ranges) {
              const from = Math.max(0, Math.min(range.start, length));
              const to = Math.max(0, Math.min(range.end, length));
              if (from < to) {
                decs.push(
                  Decoration.mark({ class: 'cm-search-highlight' }).range(from, to)
                );
              }
            }
            return Decoration.set(decs, true);
          }
        },
        {
          decorations: (v: { decorations: DecorationSet }): DecorationSet =>
            v.decorations,
        }
      );

    const buildSearchHighlightExtension = (
      ranges: Array<{ start: number; end: number }> | undefined
    ): Extension =>
      ranges && ranges.length > 0 ? buildSearchHighlightPlugin(ranges) : [];

    const buildDiffExtension = (
      bv: string | undefined,
      enabled: boolean,
      sm: boolean,
      ws: boolean
    ): Extension => (enabled && bv != null ? buildDiffPlugin(bv, sm, ws) : []);

    const buildPlaceholderExtension = (ph: string | undefined): Extension =>
      ph ? cmPlaceholder(ph) : [];

    const buildMdDecorationExtension = (vm: DecorationViewMode): Extension =>
      buildMarkdownDecorationPlugin(vm);

    // Builds a per-instance EditorView.theme() that overrides the selection
    // background directly on .cm-selectionBackground.  Registered after
    // baseTheme, so its stylesheet wins the CSS cascade.
    const buildSelectionBgExtension = (bg: string | undefined): Extension => {
      if (!bg) return [];
      return EditorView.theme({
        '.cm-selectionBackground': {
          backgroundColor: `${bg} !important`,
        },
        '&.cm-focused .cm-selectionBackground': {
          backgroundColor: `${bg} !important`,
        },
      });
    };

    // Overrides the highlight colour tokens on the editor root (CSS variables
    // consumed by .cm-prose-link-highlight, .cm-search-highlight,
    // .cm-annotation-range and the diff marks).  The parent Editor component
    // computes values for the cream/white paper (light + mixed themes) and the
    // dark paper, so every layer stays legible yet comfortable to read through.
    const buildHighlightColorsExtension = (
      colors: EditorHighlightColors | undefined
    ): Extension => {
      if (!colors) return [];
      const setVar = (
        name: string,
        value: string | undefined
      ): Record<string, string> | undefined => (value ? { [name]: value } : undefined);
      return EditorView.theme({
        '&': {
          ...setVar('--aq-prose-highlight-bg', colors.proseHighlightBg),
          ...setVar('--aq-search-bg', colors.searchHighlightBg),
          ...setVar('--aq-annotation-underline', colors.annotationUnderline),
          ...setVar('--aq-annotation-bg', colors.annotationBg),
          ...setVar('--aq-diff-insert-bg', colors.diffInsertBg),
          ...setVar('--aq-diff-insert-border', colors.diffInsertBorder),
          ...setVar('--aq-diff-delete-bg', colors.diffDeleteBg),
          ...setVar('--aq-diff-delete-border', colors.diffDeleteBorder),
        },
      });
    };

    // ── Mount / unmount ─────────────────────────────────────────────────────
    // ── Mount / unmount ─────────────────────────────────────────────────────

    useEffect((): (() => void) | undefined => {
      if (!containerRef.current) return undefined;

      const extensions: Extension[] = [
        baseTheme,
        markdownDecorationTheme,
        // drawSelection takes control of selection rendering via
        // .cm-selectionBackground divs so that WS marker widgets and plain
        // text receive identical selection colours (Highlight / HighlightText).
        drawSelection(),
        EditorView.lineWrapping,
        buildClipboardExtension(),
        // Spellcheck / autocorrect / platform-native behavior in its own compartment
        attributesCompartment.current.of(
          buildAttributesExtension(language, spellCheck, placeholder)
        ),
        history(),
        // Ctrl+F / Cmd+F opens the app search dialog instead of CodeMirror's built-in search
        Prec.highest(
          keymap.of([
            {
              key: 'Ctrl-f',
              mac: 'Cmd-f',
              run: (): boolean => {
                onOpenSearchRef.current?.();
                return true;
              },
            },
          ])
        ),
        // Enter/history keymaps take precedence over defaultKeymap
        Prec.high(keymap.of(historyKeymap)),
        // Enter-behavior keymap in its own compartment
        enterCompartment.current.of(buildEnterExtension(enterBehavior)),
        // Tab keymap for Raw/Markdown modes
        Prec.high(buildTabExtension()),
        // Diff highlights for AI changes
        diffCompartment.current.of(
          buildDiffExtension(baselineValue, showDiff, streamingMode, showWhitespace)
        ),
        searchHighlightCompartment.current.of(
          buildSearchHighlightExtension(searchHighlightRanges)
        ),
        keymap.of(defaultKeymap),
        languageCompartment.current.of(buildLanguageExtension(mode)),
        wsCompartment.current.of(
          buildWsExtension(showWhitespace, baselineValue, showDiff, streamingMode)
        ),
        placeholderCompartment.current.of(buildPlaceholderExtension(placeholder)),
        mdDecorationCompartment.current.of(buildMdDecorationExtension(viewMode)),
        markerHideCompartment.current.of(buildSceneMarkerHideExtension()),
        selectionBgCompartment.current.of(buildSelectionBgExtension(selectionBg)),
        highlightColorsCompartment.current.of(
          buildHighlightColorsExtension(highlightColors)
        ),
        // Prose-link highlight: StateField persists the ranges, ViewPlugin renders them.
        proseHighlightField,
        buildProseHighlightPlugin(proseBoundaryCallbackRef),
        // Annotation highlights.
        ...buildAnnotationExtensions(),
        EditorView.updateListener.of((update: ViewUpdate): void => {
          if (update.docChanged) {
            const isExternalSync = update.transactions.some((tx: Transaction) =>
              tx.annotation(externalValueSyncAnnotation)
            );
            if (isExternalSync) {
              return;
            }
            const val = update.state.doc.toString();
            lastEmittedRef.current = val;
            const isUndoRedo = update.transactions.some(
              (tx: Transaction) => tx.isUserEvent('undo') || tx.isUserEvent('redo')
            );
            onChangeRef.current(val, isUndoRedo);
          }
          if (update.selectionSet) {
            const { anchor, head } = update.state.selection.main;
            onSelectionChangeRef.current?.(anchor, head);
          }
        }),
      ];

      const state = EditorState.create({
        doc: hideSceneMarkers ? stripInlineInternalMarkers(value) : value,
        extensions,
      });
      const view = new EditorView({ state, parent: containerRef.current });
      viewRef.current = view;
      lastEmittedRef.current = hideSceneMarkers
        ? stripInlineInternalMarkers(value)
        : value;

      // Expose the EditorView via forwardRef
      if (typeof ref === 'function') {
        ref(view);
      } else if (ref) {
        (ref as React.MutableRefObject<EditorView | null>).current = view;
      }

      // Expose the EditorView on window for E2E automation so tests can
      // dispatch cursor selections deterministically (mirrors the pattern
      // used by the test fixture in tests/e2e/fixture/main.ts).
      if (typeof window !== 'undefined') {
        (window as unknown as { __aqEditorView?: EditorView }).__aqEditorView = view;
      }

      return (): void => {
        view.destroy();
        viewRef.current = null;
        if (typeof window !== 'undefined') {
          delete (window as unknown as { __aqEditorView?: EditorView }).__aqEditorView;
        }
        if (typeof ref === 'function') {
          ref(null);
        } else if (ref) {
          (ref as React.MutableRefObject<EditorView | null>).current = null;
        }
      };
    }, []); // only on mount / unmount

    // ── Dynamic prop updates via Compartment.reconfigure ────────────────────

    useEffect((): void => {
      viewRef.current?.dispatch({
        effects: languageCompartment.current.reconfigure(buildLanguageExtension(mode)),
        annotations: Transaction.addToHistory.of(false),
      });
    }, [mode]);

    useEffect((): void => {
      viewRef.current?.dispatch({
        effects: mdDecorationCompartment.current.reconfigure(
          buildMdDecorationExtension(viewMode)
        ),
        annotations: Transaction.addToHistory.of(false),
      });
    }, [viewMode]);

    useEffect((): void => {
      viewRef.current?.dispatch({
        effects: markerHideCompartment.current.reconfigure(
          buildSceneMarkerHideExtension()
        ),
        annotations: Transaction.addToHistory.of(false),
      });
    }, [hideSceneMarkers]);

    useEffect((): void => {
      viewRef.current?.dispatch({
        effects: wsCompartment.current.reconfigure(
          buildWsExtension(showWhitespace, baselineValue, showDiff, streamingMode)
        ),
        annotations: Transaction.addToHistory.of(false),
      });
    }, [showWhitespace, baselineValue, showDiff, streamingMode]);

    useEffect((): void => {
      viewRef.current?.dispatch({
        effects: enterCompartment.current.reconfigure(
          buildEnterExtension(enterBehavior)
        ),
        annotations: Transaction.addToHistory.of(false),
      });
    }, [enterBehavior]);

    useEffect((): void => {
      viewRef.current?.dispatch({
        effects: selectionBgCompartment.current.reconfigure(
          buildSelectionBgExtension(selectionBg)
        ),
        annotations: Transaction.addToHistory.of(false),
      });
    }, [selectionBg]);

    useEffect((): void => {
      viewRef.current?.dispatch({
        effects: highlightColorsCompartment.current.reconfigure(
          buildHighlightColorsExtension(highlightColors)
        ),
        annotations: Transaction.addToHistory.of(false),
      });
    }, [highlightColors]);

    useEffect((): void => {
      viewRef.current?.dispatch({
        effects: placeholderCompartment.current.reconfigure(
          buildPlaceholderExtension(placeholder)
        ),
        annotations: Transaction.addToHistory.of(false),
      });
    }, [placeholder]);

    useEffect((): void => {
      viewRef.current?.dispatch({
        effects: attributesCompartment.current.reconfigure(
          buildAttributesExtension(language, spellCheck, placeholder)
        ),
        annotations: Transaction.addToHistory.of(false),
      });
    }, [language, spellCheck, placeholder]);

    // useLayoutEffect (not useEffect) keeps this in the same frame as the
    // external value sync below.  Both are declared in order (baseline first,
    // value second) so that when a new baseline and new content land in the
    // same render the plugin is reconfigured with the correct baseline BEFORE
    // the content dispatch fires — ensuring the first painted frame already
    // shows the correct diff decorations rather than missing them.
    useLayoutEffect((): void => {
      viewRef.current?.dispatch({
        effects: diffCompartment.current.reconfigure(
          buildDiffExtension(baselineValue, showDiff, streamingMode, showWhitespace)
        ),
        annotations: Transaction.addToHistory.of(false),
      });
    }, [baselineValue, showDiff, streamingMode, showWhitespace]);

    useEffect((): void => {
      viewRef.current?.dispatch({
        effects: searchHighlightCompartment.current.reconfigure(
          buildSearchHighlightExtension(searchHighlightRanges)
        ),
        annotations: Transaction.addToHistory.of(false),
      });
    }, [searchHighlightRanges]);

    // ── External value sync ─────────────────────────────────────────────────
    // Update the CodeMirror document when the value prop changes due to an
    // external cause (chapter switch, AI insertion) — not when the change
    // originated from our own onChange callback.
    // useLayoutEffect (not useEffect) ensures CodeMirror's DOM is updated
    // synchronously in the same commit phase as the React render, so that any
    // sibling layout effects that measure scrollHeight see the new content
    // height immediately — eliminating one-frame flicker during LLM streaming.
    useLayoutEffect((): void => {
      const view = viewRef.current;
      if (!view) return;
      const docStr = view.state.doc.toString();
      // When hideSceneMarkers is true, the editor document is stripped of
      // internal markers while the value prop carries the full content with
      // markers (injected by Editor.tsx via transferInternalMarkers).  Compare
      // the stripped forms so the sync is skipped when the document already
      // matches the intended visible content.
      const stripped = hideSceneMarkers ? stripInlineInternalMarkers(value) : value;
      if (docStr === stripped || lastEmittedRef.current === stripped) return;

      const { anchor, head } = view.state.selection.main;
      const maxPos = stripped.length;

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: stripped },
        annotations: [
          externalValueSyncAnnotation.of(true),
          Transaction.addToHistory.of(false),
        ],
        selection: {
          anchor: Math.min(anchor, maxPos),
          head: Math.min(head, maxPos),
        },
      });
      lastEmittedRef.current = stripped;
    }, [value]);

    useEffect((): (() => void) | void => {
      const container = containerRef.current;
      if (!container) return;

      const handleContainerDragStart = (e: DragEvent): void => {
        const view = viewRef.current;
        if (view) {
          onDragStartRef.current?.(e, view);
        }
      };

      container.addEventListener('dragstart', handleContainerDragStart);
      return () => {
        container.removeEventListener('dragstart', handleContainerDragStart);
      };
    }, []);

    // Intercept dragstart as it bubbles up from CM's contentDOM.
    // By the time the event reaches this wrapper div, CM6's own dragstart
    // handler on contentDOM has already run and set
    // `effectAllowed = "copyMove"`.  We can override that here because we
    // are still within the same dragstart event dispatch cycle.

    // Ref for the FloatingDiffToolbar container — wraps the CM editor so
    // the toolbar can detect hover over CM's diff decorations.
    const toolbarContainerRef = useRef<HTMLDivElement>(null);

    const toolbarEnabled =
      showDiffToolbar &&
      showDiff &&
      !!baselineValue &&
      !!onAcceptDiff &&
      !!onRejectDiff;

    return (
      <div ref={toolbarContainerRef} className="relative">
        <div ref={containerRef} className={className} style={style} />
        {toolbarEnabled && (
          <FloatingDiffToolbar
            containerRef={toolbarContainerRef}
            enabled={true}
            isLight={isLight}
            onAccept={(): void => onAcceptDiff?.()}
            onReject={(): void => onRejectDiff?.()}
          />
        )}
      </div>
    );
  }
);

CodeMirrorEditor.displayName = 'CodeMirrorEditor';
