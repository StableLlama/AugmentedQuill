// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Per-paper editor highlight colour tokens (search, annotation, prose tint and
 * diff insert/delete).  Every highlight layer is tuned for the surface the
 * reader actually sees:
 *   - light surfaces (light theme paper, dialogs/forms in light theme) use
 *     subtle light-paper values;
 *   - dark surfaces (dark theme paper, dialogs/forms in dark/mixed chrome) use
 *     stronger values tuned for dark backgrounds so text stays legible without
 *     washing out the prose.
 *
 * Callers decide which surface they render on and pass the result to
 * `CodeMirrorEditor`'s `highlightColors` prop.  Keeping the tokens in one place
 * avoids drift between the writing editor and dialog editors.
 */

import type { EditorHighlightColors } from './CodeMirrorEditor';

/** Tuned highlight tokens for a dark surface (dark paper / dark dialog chrome). */
const DARK_SURFACE_COLORS: EditorHighlightColors = {
  proseHighlightBg: 'rgba(245, 158, 11, 0.10)',
  searchHighlightBg: 'rgba(245, 158, 11, 0.30)',
  annotationUnderline: 'rgba(167, 139, 250, 0.85)',
  annotationBg: 'rgba(139, 92, 246, 0.16)',
  diffInsertBg: 'rgba(34, 197, 94, 0.22)',
  diffInsertBorder: 'rgba(74, 222, 128, 0.55)',
  diffDeleteBg: 'rgba(239, 68, 68, 0.22)',
  diffDeleteBorder: 'rgba(248, 113, 113, 0.55)',
};

/** Tuned highlight tokens for a light surface (cream/white paper / light chrome). */
const LIGHT_SURFACE_COLORS: EditorHighlightColors = {
  proseHighlightBg: 'rgba(180, 110, 0, 0.06)',
  searchHighlightBg: 'rgba(245, 158, 11, 0.22)',
  annotationUnderline: 'rgba(124, 58, 237, 0.65)',
  annotationBg: 'rgba(124, 58, 237, 0.08)',
  diffInsertBg: 'rgba(34, 197, 94, 0.14)',
  diffInsertBorder: 'rgba(34, 197, 94, 0.45)',
  diffDeleteBg: 'rgba(239, 68, 68, 0.14)',
  diffDeleteBorder: 'rgba(239, 68, 68, 0.45)',
};

/**
 * Return highlight colour tokens for the given surface.  `isDarkSurface` is
 * `true` when the editor sits on a dark background (dark theme paper, or a
 * dialog/panel that uses the dark chrome in dark/mixed themes).
 */
export function getEditorHighlightColors(
  isDarkSurface: boolean
): EditorHighlightColors {
  return isDarkSurface ? DARK_SURFACE_COLORS : LIGHT_SURFACE_COLORS;
}
