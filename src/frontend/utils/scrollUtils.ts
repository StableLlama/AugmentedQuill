// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Shared scroll geometry utilities.
 */

/**
 * Returns the pixel distance between the current scroll position and the
 * maximum scroll position (bottom of content). Clamped to 0 to guard against
 * sub-pixel rounding that can produce tiny negatives.
 */
export function scrollDistanceFromBottom(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

/**
 * Represents a range of document positions, matching CodeMirror's
 * `EditorView.visibleRanges` shape.
 */
export interface VisibleRange {
  from: number;
  to: number;
}

/**
 * Returns true when at least part of the range [rangeFrom, rangeTo) overlaps
 * with any of the given visibleRanges.
 *
 * This is used to decide whether to auto-scroll the editor when a scene is
 * selected: if any portion is already visible we skip scrolling.
 */
export function isRangeVisible(
  rangeFrom: number,
  rangeTo: number,
  visibleRanges: readonly VisibleRange[]
): boolean {
  return visibleRanges.some(
    (vr: VisibleRange) => rangeFrom < vr.to && rangeTo > vr.from
  );
}
