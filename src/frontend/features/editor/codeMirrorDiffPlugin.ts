// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * CodeMirror diff highlight plugin: decorates inserted text and injects
 * deleted-text widgets by diffing the current document against a baseline.
 * Also exports the shared externalValueSyncAnnotation used to distinguish
 * programmatic value syncs from user edits.
 */

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { Annotation } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import { diff_match_patch } from 'diff-match-patch';
import { createWhitespaceMarkerElement } from './codeMirrorWhitespacePlugin';
import { stripInlineInternalMarkers } from './internalTags';

// Marks transactions that mirror external prop updates so the updateListener
// can skip emitting onChange for programmatic document replacements.
export const externalValueSyncAnnotation = Annotation.define<boolean>();

const dmp = new diff_match_patch();

const diffMark = Decoration.mark({
  class: 'cm-diff-inserted',
});

type DeletedWsKind = 'space' | 'tab' | 'newline';

/** Represents plain deleted text widget. */
class DeletedTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  /** Convert dom. */
  toDOM(): HTMLSpanElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-diff-deleted';
    wrap.textContent = this.text;
    return wrap;
  }
}

/** Represents explicit widget buffer to mirror green diff DOM shape. */
class DeletedBufferWidget extends WidgetType {
  /** Convert dom. */
  toDOM(): HTMLImageElement {
    const img = document.createElement('img');
    img.className = 'cm-widgetBuffer';
    img.setAttribute('aria-hidden', 'true');
    return img;
  }
}

/** Represents deleted whitespace marker widget. */
class DeletedWhitespaceWidget extends WidgetType {
  constructor(readonly kind: DeletedWsKind) {
    super();
  }
  /** Convert dom. */
  toDOM(): HTMLSpanElement {
    const marker = createWhitespaceMarkerElement(this.kind, '1');
    marker.classList.add('cm-diff-deleted');
    return marker;
  }
}

/** Represents line break effect for deleted newlines. */
class DeletedLineBreakWidget extends WidgetType {
  /** Convert dom. */
  toDOM(): HTMLBRElement {
    const br = document.createElement('br');
    br.className = 'cm-diff-deleted-break';
    return br;
  }
}

function addDeletedDecorations(
  decs: Range<Decoration>[],
  atPos: number,
  text: string,
  showWhitespace: boolean
): void {
  const visibleText = stripInlineInternalMarkers(text);
  if (visibleText.length === 0) {
    return;
  }

  if (!showWhitespace) {
    decs.push(
      Decoration.widget({
        widget: new DeletedTextWidget(visibleText),
        side: 0,
      }).range(atPos)
    );
    return;
  }

  let textBuffer = '';
  let side = 0;

  const startsWithVisibleWhitespace =
    visibleText.startsWith(' ') ||
    visibleText.startsWith('\t') ||
    visibleText.startsWith('\n');
  if (startsWithVisibleWhitespace) {
    decs.push(
      Decoration.widget({
        widget: new DeletedBufferWidget(),
        side,
      }).range(atPos)
    );
    side += 1;
  }

  const pushTextBuffer = (): void => {
    if (textBuffer.length === 0) {
      return;
    }
    decs.push(
      Decoration.widget({
        widget: new DeletedBufferWidget(),
        side,
      }).range(atPos)
    );
    side += 1;

    decs.push(
      Decoration.widget({
        widget: new DeletedTextWidget(textBuffer),
        side,
      }).range(atPos)
    );
    side += 1;

    decs.push(
      Decoration.widget({
        widget: new DeletedBufferWidget(),
        side,
      }).range(atPos)
    );
    side += 1;

    textBuffer = '';
  };

  const pushWs = (kind: DeletedWsKind): void => {
    decs.push(
      Decoration.widget({
        widget: new DeletedWhitespaceWidget(kind),
        side,
      }).range(atPos)
    );
    side += 1;
  };

  for (const ch of visibleText) {
    if (ch === ' ') {
      pushTextBuffer();
      pushWs('space');
      continue;
    }
    if (ch === '\t') {
      pushTextBuffer();
      pushWs('tab');
      continue;
    }
    if (ch === '\n') {
      pushTextBuffer();
      pushWs('newline');
      decs.push(
        Decoration.widget({
          widget: new DeletedLineBreakWidget(),
          side,
        }).range(atPos)
      );
      side += 1;
      continue;
    }
    textBuffer += ch;
  }

  pushTextBuffer();
}

/**
 * Maximum gap (equal-text chars) between changed segments that are still
 * considered part of the same rewrite zone.  Gaps larger than this break
 * the zone and are rendered as normal unchanged text.
 */
const ZONE_GAP_THRESHOLD = 20;

/**
 * Minimum total changed characters (inserted + deleted) required for a
 * zone to be rendered as a block replacement instead of word-level inline.
 */
const ZONE_MIN_CHANGED = 80;

/**
 * Merge adjacent diff segments that belong to the same local rewrite
 * zone into consolidated delete/insert pairs.  A zone is a run of
 * changed segments separated only by tiny equal gaps (≤ gapThreshold).
 * Zones with total changed text ≥ minZoneChars are rendered as block
 * replacements (deleted-old + inserted-new); everything else stays as
 * word-level inline diff.
 *
 * This is a LOCAL decision — a single-scene rewrite inside a long
 * chapter produces one block-mode zone while the rest of the chapter
 * renders as normal inline diff.
 */
function mergeDiffZones(
  diffs: import('diff-match-patch').Diff[],
  gapThreshold: number,
  minZoneChars: number
): import('diff-match-patch').Diff[] {
  const merged: import('diff-match-patch').Diff[] = [];
  let i = 0;

  while (i < diffs.length) {
    const [op, text] = diffs[i];

    // Unchanged text — pass through unchanged.
    if (op === 0) {
      merged.push([op, text]);
      i++;
      continue;
    }

    // Start of a changed run — scan ahead to find the zone boundary.
    let zoneDeleted = '';
    let zoneInserted = '';
    if (op === -1) zoneDeleted += text;
    else zoneInserted += text;
    let j = i + 1;

    while (j < diffs.length) {
      const [nextOp, nextText] = diffs[j];

      if (nextOp === 0 && nextText.length <= gapThreshold) {
        // Tiny equal gap — absorb into the zone (will be rendered as
        // part of the deleted+inserted block).
        zoneDeleted += nextText;
        zoneInserted += nextText;
        j++;
      } else if (nextOp === -1 || nextOp === 1) {
        // Adjacent changed segment — extend the zone.
        if (nextOp === -1) zoneDeleted += nextText;
        else zoneInserted += nextText;
        j++;
      } else {
        // Large equal gap — end of zone.
        break;
      }
    }

    const totalChanged = zoneDeleted.length + zoneInserted.length;
    if (totalChanged >= minZoneChars) {
      // Large enough for block mode — emit as a single delete/insert pair.
      if (zoneDeleted.length > 0) merged.push([-1, zoneDeleted]);
      if (zoneInserted.length > 0) merged.push([1, zoneInserted]);
    } else {
      // Too small — keep the original segments for word-level inline diff.
      for (let k = i; k < j; k++) merged.push(diffs[k]);
    }

    i = j;
  }

  return merged;
}

/** Debounce delay before recomputing full diff decorations (ms). */
const DIFF_DEBOUNCE_MS = 500;
/** Documents smaller than this threshold are diffed immediately. */
const DIFF_IMMEDIATE_THRESHOLD = 5000;

/**
 * Return the number of leading characters that are identical in both strings.
 * Used for the streaming diff strategy which avoids LCS on partial content.
 */
function commonPrefixLength(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return len;
}

export const buildDiffPlugin = (
  baseline: string,
  streamingMode: boolean = false,
  showWhitespace: boolean = false
): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private pending: ReturnType<typeof setTimeout> | null = null;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      /** Update the requested value. */
      update(u: ViewUpdate): void {
        if (!u.docChanged) return;

        // External value syncs (undo/redo, AI insertion, chapter switch)
        // are single atomic replacements — compute immediately so the
        // user sees the diff result without delay.
        const isExternalSync = u.transactions.some(
          (tr: import('@codemirror/state').Transaction) =>
            tr.annotation(externalValueSyncAnnotation)
        );

        // For small documents or external syncs, compute immediately.
        if (u.state.doc.length < DIFF_IMMEDIATE_THRESHOLD || isExternalSync) {
          this.cancelPending();
          this.decorations = this.build(u.view);
          return;
        }

        // For large documents during normal typing, remap existing
        // decorations immediately so positions stay correct, then
        // schedule a full diff rebuild after the user pauses typing.
        this.decorations = this.decorations.map(u.changes);
        this.scheduleBuild(u.view);
      }
      /** Helper for the requested value. */
      destroy(): void {
        this.cancelPending();
      }
      /** Helper for pending. */
      private cancelPending(): void {
        if (this.pending !== null) {
          clearTimeout(this.pending);
          this.pending = null;
        }
      }
      /** Schedule build. */
      private scheduleBuild(view: EditorView): void {
        this.cancelPending();
        this.pending = setTimeout((): void => {
          this.pending = null;
          this.decorations = this.build(view);
          view.dispatch(); // trigger decoration update
        }, DIFF_DEBOUNCE_MS);
      }
      /** Build the requested value. */
      build(view: EditorView): DecorationSet {
        const currentText = view.state.doc.toString();
        // The editor document is always stripped of internal markers
        // (hideSceneMarkers=true).  Strip the baseline too so that
        // marker-only differences (e.g. after creating an annotation)
        // don't produce a spurious diff.
        const strippedBaseline = stripInlineInternalMarkers(baseline);
        if (strippedBaseline === currentText) return Decoration.none;

        if (streamingMode) {
          // During streaming we use a common-prefix strategy instead of LCS:
          //   – Find the longest shared prefix between baseline and the partial
          //     streamed text (handles both rewrite and extend correctly).
          //   – Show baseline[prefix:] as a deleted widget at the prefix position.
          //   – Mark currentText[prefix:] as inserted (green).
          // This avoids flickering caused by diff_match_patch finding accidental
          // common subsequences inside a partially-written rewrite, which made
          // earlier chunks look "equal" and only the latest chunk look new.
          const prefixLen = commonPrefixLength(strippedBaseline, currentText);
          const deletedSuffix = strippedBaseline.slice(prefixLen);
          const insertedEnd = currentText.length;
          const decs: Range<Decoration>[] = [];
          if (deletedSuffix.length > 0) {
            addDeletedDecorations(decs, prefixLen, deletedSuffix, showWhitespace);
          }
          if (insertedEnd > prefixLen) {
            decs.push(diffMark.range(prefixLen, insertedEnd));
          }
          return decs.length > 0 ? Decoration.set(decs, true) : Decoration.none;
        }

        const rawDiffs = dmp.diff_main(strippedBaseline, currentText);
        dmp.diff_cleanupSemantic(rawDiffs);

        // Merge adjacent changed segments into block-mode zones when the
        // change is locally substantial.  This is a local decision — a
        // single-scene rewrite inside a long chapter produces one block
        // zone while the rest of the chapter stays inline.
        const diffs = mergeDiffZones(rawDiffs, ZONE_GAP_THRESHOLD, ZONE_MIN_CHANGED);

        const decs: Range<Decoration>[] = [];
        let pos = 0;

        for (const [op, text] of diffs) {
          if (op === 0) {
            // UNCHANGED
            pos += text.length;
          } else if (op === 1) {
            // INSERTED — decorate the added range in the current document.
            decs.push(diffMark.range(pos, pos + text.length));
            pos += text.length;
          } else if (op === -1) {
            // DELETED — exists in baseline only, inject as a widget in the current doc.
            addDeletedDecorations(decs, pos, text, showWhitespace);
          }
        }

        return Decoration.set(decs, true);
      }
    },
    { decorations: (v: { decorations: DecorationSet }): DecorationSet => v.decorations }
  );
