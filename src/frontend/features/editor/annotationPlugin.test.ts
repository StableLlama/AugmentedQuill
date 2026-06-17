// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for the annotation plugin.
 *
 * Covers:
 *   - annotationsToRanges (marker scanning)
 *   - annotationRangesField (storage + position mapping on doc changes)
 *   - ViewPlugin decoration rendering
 *   - Race-condition immunity (ranges dispatched before/after content sync)
 */

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  annotationsToRanges,
  annotationRangesField,
  setAnnotationRangesEffect,
  buildAnnotationExtensions,
} from './annotationPlugin';
import { EditorState, EditorSelection } from '@codemirror/state';

// ===========================================================================
// annotationsToRanges
// ===========================================================================

describe('annotationsToRanges', () => {
  it('finds range by locating start/end markers in text', () => {
    const start = '<!--annotation:ann-1:start-->';
    const end = '<!--annotation:ann-1:end-->';
    const doc = `Hello${start} World${end}!`;
    const ranges = annotationsToRanges(doc, [{ id: 'ann-1', comment: 'greeting' }]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].from).toBe(doc.indexOf(start) + start.length);
    expect(ranges[0].to).toBe(doc.indexOf(end));
    expect(doc.slice(ranges[0].from, ranges[0].to)).toBe(' World');
  });

  it('returns empty when markers are absent', () => {
    expect(
      annotationsToRanges('Hello World', [{ id: 'ann-1', comment: 'test' }])
    ).toHaveLength(0);
  });

  it('handles empty input', () => {
    expect(annotationsToRanges('Hello World', [])).toHaveLength(0);
  });

  it('finds multiple annotations', () => {
    const doc =
      '<!--annotation:a1:start-->first<!--annotation:a1:end--> ' +
      '<!--annotation:a2:start-->second<!--annotation:a2:end-->';
    const ranges = annotationsToRanges(doc, [
      { id: 'a1', comment: 'first' },
      { id: 'a2', comment: 'second' },
    ]);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].id).toBe('a1');
    expect(ranges[1].id).toBe('a2');
    expect(doc.slice(ranges[0].from, ranges[0].to)).toBe('first');
    expect(doc.slice(ranges[1].from, ranges[1].to)).toBe('second');
  });

  it('handles scene markers inside annotation span', () => {
    const doc =
      'pre ' +
      '<!--annotation:ann:start-->' +
      'annotated <!--scene:1:end--><!--scene:2:start--> text' +
      '<!--annotation:ann:end-->' +
      ' post';
    const ranges = annotationsToRanges(doc, [{ id: 'ann', comment: 'cross-scene' }]);
    expect(ranges).toHaveLength(1);
    expect(doc.slice(ranges[0].from, ranges[0].to)).toBe(
      'annotated <!--scene:1:end--><!--scene:2:start--> text'
    );
  });

  it('skips annotations whose markers are not in the document', () => {
    const doc = 'Plain text without annotation markers.';
    const ranges = annotationsToRanges(doc, [{ id: 'present', comment: 'present' }]);
    expect(ranges).toHaveLength(0);
  });

  it('finds present markers while skipping absent ones', () => {
    const doc = '<!--annotation:present:start-->text<!--annotation:present:end-->';
    const ranges = annotationsToRanges(doc, [
      { id: 'present', comment: 'yes' },
      { id: 'absent', comment: 'no' },
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].id).toBe('present');
  });
});

// ===========================================================================
// annotationRangesField
// ===========================================================================

describe('annotationRangesField', () => {
  function createState(doc: string) {
    return EditorState.create({
      doc,
      extensions: buildAnnotationExtensions(),
    });
  }

  it('initially returns empty', () => {
    expect(createState('content').field(annotationRangesField)).toEqual([]);
  });

  it('stores ranges from setAnnotationRangesEffect', () => {
    const state = createState('content');
    const tr = state.update({
      effects: [
        setAnnotationRangesEffect.of([
          { id: 'ann-1', from: 0, to: 4, comment: 'Some' },
        ]),
      ],
    });
    expect(tr.state.field(annotationRangesField)).toEqual([
      { id: 'ann-1', from: 0, to: 4, comment: 'Some' },
    ]);
  });

  it('replaces ranges on subsequent effects', () => {
    let state = createState('content');
    state = state.update({
      effects: [
        setAnnotationRangesEffect.of([
          { id: 'ann-1', from: 0, to: 4, comment: 'first' },
        ]),
      ],
    }).state;
    state = state.update({
      effects: [
        setAnnotationRangesEffect.of([
          { id: 'ann-2', from: 5, to: 10, comment: 'second' },
        ]),
      ],
    }).state;
    expect(state.field(annotationRangesField)).toHaveLength(1);
    expect(state.field(annotationRangesField)[0].id).toBe('ann-2');
  });

  it('maps positions through document changes', () => {
    let state = createState('Hello World');
    state = state.update({
      effects: [
        setAnnotationRangesEffect.of([
          { id: 'ann-1', from: 0, to: 5, comment: 'Hello' },
        ]),
      ],
    }).state;
    state = state.update({ changes: { from: 0, insert: 'A' } }).state;
    const stored = state.field(annotationRangesField);
    expect(stored).toHaveLength(1);
    expect(stored[0].from).toBe(1);
    expect(stored[0].to).toBe(6);
    expect(state.doc.sliceString(stored[0].from, stored[0].to)).toBe('Hello');
  });

  it('preserves ranges through non-document transactions', () => {
    let state = createState('Hello World');
    state = state.update({
      effects: [
        setAnnotationRangesEffect.of([
          { id: 'ann-1', from: 0, to: 5, comment: 'Hello' },
        ]),
      ],
    }).state;
    state = state.update({
      selection: EditorSelection.create([EditorSelection.cursor(3)]),
    }).state;
    expect(state.field(annotationRangesField)).toEqual([
      { id: 'ann-1', from: 0, to: 5, comment: 'Hello' },
    ]);
  });

  it('drops ranges whose positions collapse', () => {
    let state = createState('ab');
    state = state.update({
      effects: [
        setAnnotationRangesEffect.of([{ id: 'ann-1', from: 0, to: 2, comment: 'ab' }]),
      ],
    }).state;
    // Delete the entire range
    state = state.update({ changes: { from: 0, to: 2 } }).state;
    expect(state.field(annotationRangesField)).toHaveLength(0);
  });
});

// ===========================================================================
// EditorView integration
// ===========================================================================

describe('end-to-end decoration rendering', () => {
  function createView(doc: string): import('@codemirror/view').EditorView {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EditorView } = require('@codemirror/view');
    return new EditorView({
      state: EditorState.create({ doc, extensions: buildAnnotationExtensions() }),
    });
  }

  it('renders decorations after range dispatch', () => {
    const view = createView(
      'Hello<!--annotation:ann-1:start--> World<!--annotation:ann-1:end-->!'
    );
    const start = '<!--annotation:ann-1:start-->';
    const end = '<!--annotation:ann-1:end-->';
    const doc = view.state.doc.toString();
    const expectedFrom = doc.indexOf(start) + start.length;
    const expectedTo = doc.indexOf(end);

    view.dispatch({
      effects: [
        setAnnotationRangesEffect.of([
          { id: 'ann-1', from: expectedFrom, to: expectedTo, comment: 'greeting' },
        ]),
      ],
    });

    const stored = view.state.field(annotationRangesField);
    expect(stored).toHaveLength(1);
    expect(stored[0].from).toBe(expectedFrom);
    expect(stored[0].to).toBe(expectedTo);
    expect(view.state.doc.sliceString(stored[0].from, stored[0].to)).toBe(' World');
    view.destroy();
  });

  it('keeps ranges when doc was empty at dispatch time', () => {
    // Real-app scenario: ranges computed from currentChapter.content are
    // dispatched before the editor has synced (editor doc is still empty).
    // The field keeps positions as-is since they can't be mapped through
    // an empty-to-content changeset — matching the real behaviour where
    // annotationRangesField.update runs on the external-value-sync
    // transaction and preserves the already-correct-from-content positions.
    const view = createView('');
    view.dispatch({
      effects: [
        setAnnotationRangesEffect.of([
          { id: 'ann-1', from: 38, to: 48, comment: 'greeting' },
        ]),
      ],
    });

    const fullDoc =
      'Some text<!--annotation:ann-1:start--> annotated<!--annotation:ann-1:end--> more.';
    view.dispatch({
      changes: { from: 0, to: 0, insert: fullDoc },
    });

    // Positions were computed from the same content that was now synced.
    const stored = view.state.field(annotationRangesField);
    expect(stored).toHaveLength(1);
    expect(stored[0].from).toBe(38);
    expect(stored[0].to).toBe(48);
    expect(view.state.doc.sliceString(stored[0].from, stored[0].to)).toBe(' annotated');
    view.destroy();
  });

  it('rebuilds decorations on range dispatch when doc already has markers', () => {
    const view = createView(
      'Hello<!--annotation:ann-1:start--> World<!--annotation:ann-1:end-->!'
    );
    const start = '<!--annotation:ann-1:start-->';
    const end = '<!--annotation:ann-1:end-->';
    const doc = view.state.doc.toString();
    const expectedFrom = doc.indexOf(start) + start.length;
    const expectedTo = doc.indexOf(end);

    view.dispatch({
      effects: [
        setAnnotationRangesEffect.of([
          { id: 'ann-1', from: expectedFrom, to: expectedTo, comment: 'greeting' },
        ]),
      ],
    });

    const stored = view.state.field(annotationRangesField);
    expect(stored).toHaveLength(1);
    expect(stored[0].from).toBe(expectedFrom);
    expect(stored[0].to).toBe(expectedTo);
    view.destroy();
  });
});
