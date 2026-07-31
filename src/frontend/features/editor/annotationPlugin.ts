// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: CodeMirror 6 plugin for rendering inline annotation highlights.
 *
 * Ranges are computed externally by `annotationsToRanges` (scanning the
 * content for `<!--annotation:ID:start/end-->` markers) and pushed into the
 * plugin via `setAnnotationRangesEffect`.  The `annotationRangesField` maps
 * positions through document changes automatically, and the ViewPlugin
 * rebuilds decorations whenever ranges or the document change.
 */

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { StateEffect, StateField, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import { getAnnotationMarkerSpanRange } from './internalTags';
import { INLINE_INTERNAL_MARKER_REGEX } from './internalTags';
import { externalValueSyncAnnotation } from './codeMirrorDiffPlugin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnnotationRange {
  id: string;
  from: number;
  to: number;
  comment: string;
}

// ---------------------------------------------------------------------------
// State effect + field
// ---------------------------------------------------------------------------

export const setAnnotationRangesEffect = StateEffect.define<AnnotationRange[]>();

export const annotationRangesField = StateField.define<AnnotationRange[]>({
  create: () => [],
  update(value: AnnotationRange[], tr: Transaction): AnnotationRange[] {
    for (const e of tr.effects) {
      if (e.is(setAnnotationRangesEffect)) {
        return e.value;
      }
    }
    // Map positions through document changes so stored ranges always match
    // the current editor content, even when ranges were dispatched while
    // the CodeMirror document was still stale (e.g. before content sync).
    //   - `from`: assoc=1  → inserted text at boundary stays outside
    //   - `to`:   assoc=-1 → inserted text at boundary stays outside
    //
    // Skip position mapping on external value syncs: a full-document
    // replacement collapses all positions to 0 via mapPos.  The annotation
    // dispatch effect will recompute and re-dispatch correct ranges after
    // the sync completes.
    //
    // If a stored position lies beyond the start document, it was computed
    // from external content (e.g. currentChapter.content) that matches the
    // target document — keep it unchanged.
    if (tr.docChanged && !tr.annotation(externalValueSyncAnnotation)) {
      const startLen = tr.startState.doc.length;
      return value
        .map(
          (r: AnnotationRange): AnnotationRange => ({
            ...r,
            from: r.from <= startLen ? tr.changes.mapPos(r.from, 1) : r.from,
            to: r.to <= startLen ? tr.changes.mapPos(r.to, -1) : r.to,
          })
        )
        .filter((r: AnnotationRange): boolean => r.from < r.to);
    }
    return value;
  },
});

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

const annotationMark = Decoration.mark({ class: 'cm-annotation-range' });

function buildDecorations(ranges: AnnotationRange[], docLength: number): DecorationSet {
  const decs: Range<Decoration>[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const from = Math.max(0, Math.min(r.from, docLength));
    const to = Math.max(from, Math.min(r.to, docLength));
    if (from < to) {
      decs.push(annotationMark.range(from, to));
    }
  }
  return Decoration.set(decs, true);
}

// ---------------------------------------------------------------------------
// ViewPlugin
// ---------------------------------------------------------------------------

/** Callback invoked when the user clicks on an annotation decoration. */
let onAnnotationClickCallback: ((annotationId: string | null) => void) | null = null;

export function setAnnotationClickCallback(
  cb: ((annotationId: string | null) => void) | null
): void {
  onAnnotationClickCallback = cb;
}

/** Callback invoked when the editor cursor moves into/out of annotated text. */
let onAnnotationCursorCallback: ((annotationId: string | null) => void) | null = null;

export function setAnnotationCursorCallback(
  cb: ((annotationId: string | null) => void) | null
): void {
  onAnnotationCursorCallback = cb;
}

/** Reset cycling state (used in tests to ensure clean state). */
export function resetAnnotationClickCycle(): void {
  lastClickPos = null;
  lastCycledIndex = 0;
}

/**
 * Click-position cycling state so that when multiple annotations overlap
 * at the same position, repeated clicks cycle through them instead of
 * always selecting the first match.
 */
let lastClickPos: number | null = null;
let lastCycledIndex = 0;

function buildPlugin(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(
          view.state.field(annotationRangesField),
          view.state.doc.length
        );
      }

      update(update: ViewUpdate): void {
        const rangesChanged = update.transactions.some((tr: Transaction) =>
          tr.effects.some((e: StateEffect<unknown>): boolean =>
            e.is(setAnnotationRangesEffect)
          )
        );
        // Rebuild on range update OR document change.  The field maps
        // positions on doc changes, so reading it always gives positions
        // aligned with the current document.
        if (rangesChanged || update.docChanged) {
          this.decorations = buildDecorations(
            update.state.field(annotationRangesField),
            update.state.doc.length
          );
        }
      }
    },
    {
      decorations: (v: { decorations: DecorationSet }) => v.decorations,
    }
  );
}

/**
 * Extension that listens for clicks on annotation decorations and fires
 * the registered callback with the clicked annotation's ID.
 */
const annotationClickHandler = EditorView.domEventHandlers({
  click: (event: MouseEvent, view: EditorView): boolean => {
    if (!onAnnotationClickCallback) return false;
    // Try posAtCoords first (real browser with layout), fall back to
    // posAtDOM (works in jsdom test environment without layout).
    let pos: number | null = view.posAtCoords({
      x: event.clientX,
      y: event.clientY,
    });
    if (pos == null && event.target instanceof Node) {
      pos = view.posAtDOM(event.target, 0);
    }
    if (pos == null) return false;
    const ranges = view.state.field(annotationRangesField);

    // Collect ALL annotation ranges that cover the click position so
    // overlapping annotations can be cycled through.
    const matching: AnnotationRange[] = [];
    for (const r of ranges) {
      if (pos >= r.from && pos <= r.to) {
        matching.push(r);
      }
    }

    if (matching.length > 0) {
      if (pos === lastClickPos && matching.length > 1) {
        // Cycle to the next overlapping annotation on repeated clicks
        // at the same position.
        lastCycledIndex = (lastCycledIndex + 1) % matching.length;
      } else {
        lastCycledIndex = 0;
      }
      lastClickPos = pos;
      onAnnotationClickCallback(matching[lastCycledIndex].id);
      return true;
    }

    // Click landed on unannotated text — clear the active annotation.
    lastClickPos = null;
    lastCycledIndex = 0;
    onAnnotationClickCallback(null);
    return false;
  },
});

/**
 * Return the first annotation range that covers `pos`, or null when the
 * position is not inside any annotation.  Matches the containment semantics
 * used by the click handler so cursor and click selection stay consistent.
 */
function annotationAtPos(
  ranges: AnnotationRange[],
  pos: number
): AnnotationRange | null {
  for (const r of ranges) {
    if (pos >= r.from && pos <= r.to) {
      return r;
    }
  }
  return null;
}

/**
 * Fires the cursor callback with the annotation under the cursor whenever
 * the selection moves, so the annotation sidebar follows the editor caret.
 * When the cursor is outside every annotation the callback fires with null
 * (clearing the sidebar selection).  Clicking an annotation decoration is
 * handled by `annotationClickHandler` and does not move the cursor, so the
 * two callbacks never conflict.
 */
const annotationCursorHandler = EditorView.updateListener.of(
  (update: ViewUpdate): void => {
    if (!update.selectionSet || !onAnnotationCursorCallback) return;
    const head = update.state.selection.main.head;
    const match = annotationAtPos(update.state.field(annotationRangesField), head);
    onAnnotationCursorCallback(match?.id ?? null);
  }
);

// ---------------------------------------------------------------------------
// CSS theme
// ---------------------------------------------------------------------------

const theme = EditorView.baseTheme({
  '.cm-annotation-range': {
    textDecoration:
      'underline wavy var(--aq-annotation-underline, rgba(251, 191, 36, 0.85))',
    textDecorationSkipInk: 'none',
    backgroundColor: 'var(--aq-annotation-bg, rgba(254, 243, 199, 0.2))',
    cursor: 'pointer',
  },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildAnnotationExtensions(): Extension[] {
  return [
    annotationRangesField,
    buildPlugin(),
    annotationClickHandler,
    annotationCursorHandler,
    theme,
  ];
}

/**
 * Convert annotation metadata from the API into CodeMirror ranges by
 * searching for inline marker tokens in the document text.  Markers not
 * present in the text are silently skipped (e.g. annotation not yet
 * committed to the editor content).
 */
export function annotationsToRanges(
  docText: string,
  annotations: ReadonlyArray<{
    id: string;
    comment: string;
  }>
): AnnotationRange[] {
  const result: AnnotationRange[] = [];
  for (let i = 0; i < annotations.length; i++) {
    const ann = annotations[i];
    if (ann.id == null) continue;
    const span = getAnnotationMarkerSpanRange(docText, ann.id);
    if (span == null) continue;
    result.push({
      id: ann.id,
      from: span.from,
      to: span.to,
      comment: ann.comment,
    });
  }
  return result;
}

/**
 * Adjust annotation ranges from full-content coordinate space to stripped
 * coordinate space.  When the editor has ``hideSceneMarkers`` enabled, the
 * document no longer contains the ``<!--scene:...-->`` and
 * ``<!--annotation:...-->`` marker tokens.  The ranges computed by
 * :func:`annotationsToRanges` are in the full-content space (markers present),
 * so they must be shifted left by the cumulative length of all internal
 * markers that appear before each position.
 *
 * Returns a new array of ranges with adjusted ``from`` and ``to`` values.
 * Ranges whose adjusted span collapses (from >= to) are dropped.
 */
export function adjustAnnotationRangesForStrippedMarkers(
  ranges: AnnotationRange[],
  fullContent: string
): AnnotationRange[] {
  // Collect all internal marker positions and their lengths
  const markerPositions: Array<{ pos: number; len: number }> = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(INLINE_INTERNAL_MARKER_REGEX.source, 'g');
  while ((match = regex.exec(fullContent)) !== null) {
    markerPositions.push({ pos: match.index, len: match[0].length });
  }

  // Precompute cumulative stripped length up to each marker position
  // Using a sorted array for binary search
  markerPositions.sort(
    (a: { pos: number; len: number }, b: { pos: number; len: number }): number =>
      a.pos - b.pos
  );

  const adjustOffset = (offset: number): number => {
    let removed = 0;
    for (const mp of markerPositions) {
      if (mp.pos < offset) {
        removed += mp.len;
      } else {
        break;
      }
    }
    return Math.max(0, offset - removed);
  };

  const result: AnnotationRange[] = [];
  for (const range of ranges) {
    const adjustedFrom = adjustOffset(range.from);
    const adjustedTo = adjustOffset(range.to);
    if (adjustedFrom < adjustedTo) {
      result.push({ ...range, from: adjustedFrom, to: adjustedTo });
    }
  }
  return result;
}
