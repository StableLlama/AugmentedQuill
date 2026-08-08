// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Writing-paper surface colours, computed exactly like the main editor's paper
 * so any other surface (e.g. the Edit Scene dialog's content fields) looks and
 * feels identical:
 *   - light/mixed themes: a cream paper with dark letters, brightness scales
 *     the paper lightness and contrast scales the letter opacity;
 *   - dark theme: a dark paper with light letters.
 */

import type { AppTheme } from '../../types';

export interface PaperColors {
  /** Paper background colour. */
  backgroundColor: string;
  /** Default letter colour on the paper. */
  textColor: string;
}

/**
 * Compute the paper surface colours from the app's editor settings.  `theme`,
 * `brightness` (0.5–1.0) and `contrast` (0.5–1.0) come straight from the
 * editor settings so the paper respects the user's appearance preferences.
 */
export function getPaperColors(
  theme: AppTheme,
  brightness: number,
  contrast: number
): PaperColors {
  if (theme === 'dark') {
    const b = brightness * 20; // range 10-20% lightness
    return {
      backgroundColor: `hsl(24, 10%, ${b}%)`,
      textColor: `rgba(231, 229, 228, ${contrast})`,
    };
  }
  return {
    backgroundColor: `hsl(38, 25%, ${brightness * 100}%)`,
    textColor: `rgba(20, 15, 10, ${contrast})`,
  };
}
