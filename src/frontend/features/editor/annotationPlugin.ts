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
    // If a stored position lies beyond the start document, it was computed
    // from external content (e.g. currentChapter.content) that matches the
    // target document — keep it unchanged.
    if (tr.docChanged) {
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
  return [annotationRangesField, buildPlugin(), theme];
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
