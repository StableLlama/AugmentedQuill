// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Pure diff-segmentation used to decide between word-level inline diff and
 * paragraph-level "block mode" diff.
 *
 * Given a baseline and current string, this produces a flat list of segments:
 *   - `equal`   — unchanged text (rendered normally)
 *   - `insert`  — added text (rendered inline, green)
 *   - `delete`  — removed text (rendered inline, struck-through)
 *   - `block`   — a large, paragraph-level replacement.  Old and new content
 *                 are carried together so the UI can render them as clearly
 *                 separated blocks (red old / green new) instead of a noisy
 *                 wall of inline strikethrough + green marks.
 *
 * The module is intentionally free of CodeMirror/DOM concerns so it can be
 * unit-tested in isolation.
 */

import { diff_match_patch } from 'diff-match-patch';

export type DiffSegment =
  | { kind: 'equal'; text: string }
  | { kind: 'insert'; text: string }
  | { kind: 'delete'; text: string }
  | { kind: 'block'; deleted: string; inserted: string };

/** Maximum gap (equal-text chars) between changed segments that are still
 * considered part of the same rewrite zone.  Larger gaps end the zone. */
const ZONE_GAP_THRESHOLD = 20;

/** Smallest changed-run (chars) that gets consolidated into a single
 * delete/insert pair instead of many word-level fragments. */
const ZONE_MIN_CHANGED = 80;

/** Multi-line changes at least this large become block segments. */
const BLOCK_MIN_CHANGED = 30;

/** Any single change at least this large becomes a block segment, even when
 * the changed text stays on one line (e.g. a whole long sentence rewrite). */
const BLOCK_HUGE_CHANGED = 120;

/** Longest field (chars) eligible for whole-field block mode.  Longer fields
 * (e.g. a whole chapter) keep local paragraph-level blocks so the reader can
 * see context around a rewrite. */
export const FIELD_BLOCK_MAX_LEN = 600;

/** Smallest field (chars) eligible for whole-field block mode.  Tiny fields
 * (e.g. a one-word summary) stay inline — a wholesale rewrite of a very short
 * field is still readable inline. */
export const FIELD_BLOCK_MIN_LEN = 40;

/** Field similarity below this renders the whole field as stacked blocks. */
export const FIELD_BLOCK_SIMILARITY_THRESHOLD = 0.35;

const dmp = new diff_match_patch();

export interface DiffBlockModeOptions {
  /** When false, block segments are never emitted (all changes inline). */
  blockMode?: boolean;
}

/**
 * Compute the diff between `baseline` and `current` and collapse adjacent
 * changed runs into zones.  Zones that represent large paragraph-level
 * rewrites are emitted as a single `block` segment.
 */
export function buildDiffSegments(
  baseline: string,
  current: string,
  options: DiffBlockModeOptions = {}
): DiffSegment[] {
  const { blockMode = true } = options;
  const raw = dmp.diff_main(baseline, current);
  dmp.diff_cleanupSemantic(raw);
  return mergeZones(raw, blockMode);
}

interface Zone {
  deleted: string;
  inserted: string;
  /** Index just past the last diff segment absorbed into this zone. */
  end: number;
}

/** Collect a rewrite zone starting at `start` (which must be a changed
 * segment).  Absorbs adjacent changed segments and tiny equal gaps into one
 * consolidated old/new pair. */
function collectZone(diffs: import('diff-match-patch').Diff[], start: number): Zone {
  let zoneDeleted = '';
  let zoneInserted = '';
  const [firstOp, firstText] = diffs[start];
  if (firstOp === -1) zoneDeleted += firstText;
  else zoneInserted += firstText;

  let j = start + 1;
  while (j < diffs.length) {
    const [nextOp, nextText] = diffs[j];

    if (nextOp === 0 && nextText.length <= ZONE_GAP_THRESHOLD) {
      // Tiny equal gap — absorb into the zone.
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

  return { deleted: zoneDeleted, inserted: zoneInserted, end: j };
}

function mergeZones(
  diffs: import('diff-match-patch').Diff[],
  blockMode: boolean
): DiffSegment[] {
  const out: DiffSegment[] = [];
  let i = 0;

  while (i < diffs.length) {
    const [op, text] = diffs[i];

    // Unchanged text — pass through unchanged.
    if (op === 0) {
      out.push({ kind: 'equal', text });
      i++;
      continue;
    }

    const zone = collectZone(diffs, i);
    const totalChanged = zone.deleted.length + zone.inserted.length;
    const hasNewline = zone.deleted.includes('\n') || zone.inserted.includes('\n');

    // A large multi-line (paragraph-level) rewrite, or a very large rewrite
    // even on a single line, reads far better as separated blocks.
    const isBlock =
      blockMode &&
      totalChanged >= BLOCK_MIN_CHANGED &&
      (hasNewline || totalChanged >= BLOCK_HUGE_CHANGED);

    if (isBlock) {
      out.push({ kind: 'block', deleted: zone.deleted, inserted: zone.inserted });
    } else if (totalChanged >= ZONE_MIN_CHANGED) {
      // Consolidate into a single delete/insert pair (still rendered inline).
      if (zone.deleted.length > 0) out.push({ kind: 'delete', text: zone.deleted });
      if (zone.inserted.length > 0) out.push({ kind: 'insert', text: zone.inserted });
    } else {
      // Too small — keep the original word-level granularity.
      for (let k = i; k < zone.end; k++) {
        const [dop, dtext] = diffs[k];
        if (dop === 0) out.push({ kind: 'equal', text: dtext });
        else if (dop === -1) out.push({ kind: 'delete', text: dtext });
        else out.push({ kind: 'insert', text: dtext });
      }
    }

    i = zone.end;
  }

  return out;
}

/**
 * Fraction of the larger of (baseline, current) that is unchanged text.
 * 1 = identical, 0 = completely different.
 */
export function computeFieldSimilarity(
  segments: DiffSegment[],
  maxLen: number
): number {
  if (maxLen <= 0) return 1;
  let equalLen = 0;
  for (const seg of segments) {
    if (seg.kind === 'equal') equalLen += seg.text.length;
  }
  return equalLen / maxLen;
}

/**
 * Decide whether a whole field (e.g. a scene summary or a scene's linked
 * prose) should be rendered as stacked old/new blocks instead of word-level
 * inline diff.  This catches wholesale rewrites — which stay on single lines
 * or start mid-line after a common prefix — that the zone-level rule would
 * otherwise keep inline.
 *
 * `maxLenLimit` bounds the field size eligible for whole-field blocks.  The
 * default (FIELD_BLOCK_MAX_LEN) is conservative so long documents like whole
 * chapters keep local, contextual blocks; callers that render bounded fields
 * (e.g. the Edit Scene dialog's summary / linked prose) pass a larger limit.
 */
export function shouldUseFieldBlock(
  segments: DiffSegment[],
  maxLen: number,
  maxLenLimit: number = FIELD_BLOCK_MAX_LEN
): boolean {
  return (
    maxLen >= FIELD_BLOCK_MIN_LEN &&
    maxLen <= maxLenLimit &&
    computeFieldSimilarity(segments, maxLen) < FIELD_BLOCK_SIMILARITY_THRESHOLD
  );
}
