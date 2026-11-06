// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Canonical scene prose-link coordinate mapping for visible editor ranges.
 *
 * All original-content ↔ visible-content offset conversion here delegates to
 * the exact, marker-walking primitives in `../editor/internalTags`
 * (`toVisibleOffset` / `toOriginalOffset`). There is intentionally no
 * separate approximate/heuristic offset math in this file: whenever the raw
 * content with markers is available, the exact walk is used; stale
 * `prose_link` offsets can never cause a different (wrong) answer than the
 * live document.
 */

import type { Scene, SceneId, SceneProseLink } from '../../types';
import type { WritingUnit } from '../../types/domain';
import {
  getSceneMarkerSpanRange,
  hasInlineInternalMarkers,
  hasInlineSceneMarkers,
  sceneMarkerTokenLength,
  stripInlineInternalMarkers,
  toOriginalOffset as toOriginalOffsetCore,
  toVisibleOffset,
} from '../editor/internalTags';
import { normalizeChapterId } from './sceneSortUtils';

function linkMatchesUnit(link: SceneProseLink, unit: WritingUnit): boolean {
  return link.scope_type === 'story'
    ? unit.scope === 'story'
    : link.scope_type === 'chapter' &&
        normalizeChapterId(link.chapter_id) === normalizeChapterId(unit.id);
}

/**
 * Canonical predicate: does this link point at real project prose?
 *
 * Brand-new scenes are created by the backend with a zero-width internal
 * `unlinked` scope link (in `unlinked.txt`), so a plain truthiness check
 * (`scene.prose_link != null`) reports them as linked.  Every "is this scene
 * linked?" decision in the frontend must use this predicate — mirroring the
 * backend's `scene_prose_is_linked()`.
 */
export function isLinkedProseLink(
  link: SceneProseLink | null | undefined
): link is SceneProseLink {
  return link != null && link.scope_type !== 'unlinked';
}

function shouldAdjustOffsets(unit: WritingUnit, scenes: readonly Scene[]): boolean {
  const scoped = scenes
    .map((scene: Scene) => ({ sceneId: scene.id, link: scene.prose_link }))
    .filter(
      (item: {
        sceneId: SceneId;
        link: SceneProseLink | null | undefined;
      }): item is { sceneId: SceneId; link: SceneProseLink } =>
        item.link != null && linkMatchesUnit(item.link, unit)
    );

  if (scoped.length === 0) {
    return false;
  }

  if (hasInlineSceneMarkers(unit.content)) {
    return false;
  }

  if (
    scoped.some(
      ({ link }: { sceneId: SceneId; link: SceneProseLink }) => link.start_offset === 0
    )
  ) {
    return false;
  }

  return scoped.every(
    ({ sceneId, link }: { sceneId: SceneId; link: SceneProseLink }) =>
      link.start_offset >= sceneMarkerTokenLength(sceneId, 'start')
  );
}

/**
 * Convert an original-content offset to the visible-content offset.
 *
 * `unit`/`scenes` are only used (via `shouldAdjustOffsets`) to decide whether
 * an adjustment is needed at all when `loose` is false. The conversion
 * itself picks exactly one of two unambiguous methods, based on what
 * *actually* describes the offset's coordinate space — never a blended
 * "approximation":
 *
 *   1. `fullContent` contains real internal markers -> it is the live,
 *      authoritative source of truth, so the offset is converted with the
 *      exact marker walk (`toVisibleOffset`). This is what prevents drift
 *      when a scene's stored `prose_link` offsets go stale relative to the
 *      live document (e.g. after the user edits text between markers).
 *   2. `fullContent` has no markers (already-stripped representation, or
 *      unavailable) -> the only remaining information is each scene's own
 *      marker-inclusive `prose_link` boundaries, so the (fixed, known)
 *      marker token lengths are subtracted for every scene whose boundary
 *      lies at-or-before `offset`. This is exact for that representation,
 *      not an approximation — there is nothing else to walk.
 */
export function toVisibleLinkedOffset(
  offset: number,
  unit: WritingUnit,
  scenes: readonly Scene[],
  loose: boolean = false,
  fullContent?: string
): number {
  if (!loose && !shouldAdjustOffsets(unit, scenes)) {
    return offset;
  }

  if (fullContent !== undefined && hasInlineInternalMarkers(fullContent)) {
    return toVisibleOffset(fullContent, offset);
  }

  let removed = 0;
  for (const scene of scenes) {
    const link = scene.prose_link;
    if (!link || !linkMatchesUnit(link, unit)) {
      continue;
    }
    if (link.start_offset <= offset) {
      removed += sceneMarkerTokenLength(scene.id, 'start');
    }
    if (link.end_offset != null && link.end_offset < offset) {
      removed += sceneMarkerTokenLength(scene.id, 'end');
    }
  }
  return Math.max(0, offset - removed);
}

/**
 * Inverse of `toVisibleLinkedOffset`: given a visible (post-stripping) offset
 * and the original full content (with markers), return the corresponding
 * position in the original content.  Thin re-export (with the historical
 * argument order used across this codebase) of the canonical exact
 * implementation in `internalTags.ts`.
 */
export function toOriginalOffset(visibleOffset: number, fullContent: string): number {
  return toOriginalOffsetCore(fullContent, visibleOffset);
}

/**
 * Look up a scene's live marker span and convert it to visible coordinates.
 * Returns null when *content* has no scene markers or the scene's span is
 * absent/collapsed.
 */
function markerSpanRangeToVisible(
  content: string,
  sceneId: SceneId,
  convertToVisible: boolean
): { from: number; to: number } | null {
  if (!hasInlineSceneMarkers(content)) {
    return null;
  }
  const markerRange = getSceneMarkerSpanRange(content, sceneId);
  if (!markerRange) {
    return null;
  }
  if (convertToVisible) {
    const from = toVisibleOffset(content, markerRange.from);
    const to = toVisibleOffset(content, markerRange.to);
    return from < to ? { from, to } : null;
  }
  return markerRange.from < markerRange.to ? markerRange : null;
}

export function toVisibleRange(
  scene: Scene,
  unit: WritingUnit,
  scenes: readonly Scene[],
  fullContent?: string
): { from: number; to: number } | null {
  const link = scene.prose_link;
  if (!link || link.end_offset == null) {
    return null;
  }
  if (!linkMatchesUnit(link, unit)) {
    return null;
  }

  // Prefer the live marker spans whenever the current full content contains
  // scene markers: after the user inserts an annotation (or edits prose)
  // inside a scene, the stored prose_link offsets go stale relative to the
  // real marker positions, so the marker span is the only accurate source.
  // The editor document strips markers, so convert the raw span to visible
  // offsets when we are reading from fullContent.
  const fullMarker = fullContent
    ? markerSpanRangeToVisible(fullContent, scene.id, true)
    : null;
  if (fullMarker) {
    return fullMarker;
  }

  // Some callers pass a marker-inclusive unit content; the span is then
  // already in the editor's coordinate space (markers visible).
  const unitMarker = markerSpanRangeToVisible(unit.content, scene.id, false);
  if (unitMarker) {
    return unitMarker;
  }

  const rawFrom = Math.max(Number(link.start_offset ?? 0), 0);
  const rawTo = Math.max(Number(link.end_offset ?? rawFrom), rawFrom);

  const hasFullContent = fullContent !== undefined && fullContent.length > 0;

  const identity = { from: rawFrom, to: rawTo };
  const adjusted = {
    from: toVisibleLinkedOffset(rawFrom, unit, scenes, true, fullContent),
    to: toVisibleLinkedOffset(rawTo, unit, scenes, true, fullContent),
  };

  const identityValid = identity.from < identity.to;
  const adjustedValid = adjusted.from < adjusted.to;
  const mustAdjust =
    shouldAdjustOffsets(unit, scenes) ||
    hasFullContent ||
    (link.scope_type === 'chapter' &&
      (rawFrom > unit.content.length || rawTo > unit.content.length));

  if (mustAdjust) {
    if (adjustedValid) {
      return adjusted;
    }
    if (identityValid) {
      return identity;
    }
    return null;
  }

  if (identityValid) {
    return identity;
  }
  if (adjustedValid) {
    return adjusted;
  }
  return null;
}

export function getLinkedProseFromTextSource(
  sourceText: string,
  link: SceneProseLink,
  unit: WritingUnit,
  scenes: readonly Scene[]
): string {
  const rawFrom = Math.max(Number(link.start_offset ?? 0), 0);
  const rawEnd = Math.max(Number(link.end_offset ?? rawFrom), rawFrom);

  const sliceAt = (from: number, to: number): string =>
    sourceText.slice(
      Math.min(Math.max(from, 0), sourceText.length),
      Math.min(Math.max(to, 0), sourceText.length)
    );

  // If sourceText itself has inline scene markers, the raw offsets are in the
  // same coordinate space — slice directly without adjustment.
  if (hasInlineSceneMarkers(sourceText)) {
    return sliceAt(rawFrom, rawEnd);
  }

  // sourceText is stripped of markers.  When unit.content has markers it is
  // the full-content reference: convert the marker-inclusive offsets with the
  // exact marker walk.
  if (hasInlineInternalMarkers(unit.content)) {
    return sliceAt(
      toVisibleOffset(unit.content, rawFrom),
      toVisibleOffset(unit.content, rawEnd)
    );
  }

  // Both sourceText and unit.content are marker-free.  The offsets are either
  // visible-space (the chapter genuinely has no markers) or marker-inclusive
  // (the chapter HAS markers but unit.content was stripped — e.g. the
  // container synced the marker-free editor doc back into the store via
  // updateCurrentChapterContent after a Write Scene, while the scene's
  // prose_link offsets remain marker-inclusive).  Only return the raw slice
  // when the offsets are NOT marker-inclusive; shouldAdjustOffsets is the
  // heuristic that distinguishes the two cases.
  if (!shouldAdjustOffsets(unit, scenes)) {
    return sliceAt(rawFrom, rawEnd);
  }

  // Offsets are marker-inclusive against a stripped representation — subtract
  // the fixed marker-token lengths to derive the visible offsets.
  return sliceAt(
    toVisibleLinkedOffset(rawFrom, unit, scenes, true, undefined),
    toVisibleLinkedOffset(rawEnd, unit, scenes, true, undefined)
  );
}

/**
 * Return the *visible* prose a scene owned in a full content snapshot.
 *
 * This is the baseline counterpart of `getLinkedProseFromTextSource`: the
 * scene editor diffs its linked prose against the value this function returns
 * for the baseline snapshot.  Two properties matter and both were violated
 * before:
 *
 * 1. The scene's own markers in *fullContent* are authoritative.  Stored
 *    `prose_link` offsets go stale as soon as the document is edited (or after
 *    a delete-all), and slicing with them returned marker tokens or text from
 *    a different scene.
 * 2. The returned value is marker-free, matching the editor document.  Leaking
 *    `<!--scene:…-->` tokens into the diff baseline turned an "everything is
 *    new" comparison into a bogus whole-block rewrite.
 *
 * Returns ``null`` when the scene has no prose in that snapshot *and* the
 * offsets cannot be resolved, so callers can distinguish "no baseline" from
 * "empty baseline".
 */
export function getSceneProseFromContent(
  fullContent: string,
  sceneId: SceneId,
  link: SceneProseLink | null | undefined
): string | null {
  if (hasInlineSceneMarkers(fullContent)) {
    const span = getSceneMarkerSpanRange(fullContent, sceneId);
    if (span) {
      return stripInlineInternalMarkers(fullContent.slice(span.from, span.to));
    }
    // The content is marker-managed but this scene has no span in it: the
    // scene owned no prose in this snapshot.
    if (link == null) return null;
  }

  if (link == null) return null;

  const rawFrom = Math.max(Number(link.start_offset ?? 0), 0);
  const rawEnd = Math.max(Number(link.end_offset ?? rawFrom), rawFrom);
  const boundedFrom = Math.min(rawFrom, fullContent.length);
  const boundedEnd = Math.min(rawEnd, fullContent.length);
  if (boundedFrom >= boundedEnd) return '';
  return stripInlineInternalMarkers(fullContent.slice(boundedFrom, boundedEnd));
}

/**
 * Canonical, fail-closed resolver for a scene's range **in the document that is
 * actually being rendered** (the marker-free editor document).
 *
 * Scene ranges are rendered as CodeMirror decorations, drive cursor→card
 * selection and seed the boundary-drag handles.  A range that was computed
 * against a different version of the text than the one on screen highlights the
 * wrong prose (e.g. "the highlight ends before the real text") and can write
 * wrong offsets back.  This is the exact off-by-N class of bug we must make
 * impossible, so the resolver only answers when every layer agrees:
 *
 *   1. the live document is exactly the marker-free projection of
 *      *fullContent* (same version — no streaming/lagging document);
 *   2. *fullContent* actually contains this scene's markers (offsets are never
 *      guessed from stale `prose_link` values);
 *   3. the resolved range slices exactly the text between those markers.
 *
 * Returns ``null`` otherwise: callers must render *no* highlight rather than a
 * wrong one.  All range-rendering callers must use this instead of
 * `toVisibleRange`.
 */
export function resolveVerifiedSceneRange(
  docText: string,
  unit: WritingUnit,
  scenes: readonly Scene[],
  fullContent: string,
  scene: Scene
): { from: number; to: number } | null {
  if (!isLinkedProseLink(scene.prose_link)) return null;

  // 1. Version check: the rendered document must be the same text the offsets
  //    were derived from.  Any extra/missing character means we cannot trust
  //    any range derived from *fullContent*.
  const strippedFull = stripInlineInternalMarkers(fullContent);
  if (docText !== strippedFull) return null;

  // 2. Authoritative source: the scene's own markers.  Never fall back to
  //    `prose_link` offsets here — they are a snapshot of a past version.
  if (!hasInlineSceneMarkers(fullContent)) return null;
  const markerSpan = getSceneMarkerSpanRange(fullContent, scene.id);
  if (!markerSpan) return null;

  const range = toVisibleRange(
    scene,
    { ...unit, content: strippedFull },
    scenes,
    fullContent
  );
  if (!range) return null;

  // 3. Post-condition: the range must correspond exactly to the marker span.
  const expected = stripInlineInternalMarkers(
    fullContent.slice(markerSpan.from, markerSpan.to)
  );
  if (docText.slice(range.from, range.to) !== expected) return null;

  return range;
}
