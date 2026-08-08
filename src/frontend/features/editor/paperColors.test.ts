// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for the shared paper-colour helper used by the main editor and the
 * Edit Scene dialog's content fields, so the "paper" inputs respect the same
 * brightness/contrast settings as the writing paper.
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { getPaperColors } from './paperColors';

describe('getPaperColors', () => {
  it('uses cream paper with dark letters in light/mixed themes', () => {
    const paper = getPaperColors('mixed', 0.8, 0.8);
    expect(paper.backgroundColor).toBe('hsl(38, 25%, 80%)');
    expect(paper.textColor).toBe('rgba(20, 15, 10, 0.8)');
  });

  it('uses a dark paper with light letters in dark theme', () => {
    const paper = getPaperColors('dark', 0.8, 0.9);
    expect(paper.backgroundColor).toBe('hsl(24, 10%, 16%)');
    expect(paper.textColor).toBe('rgba(231, 229, 228, 0.9)');
  });

  it('scales the paper lightness with the brightness setting', () => {
    const dim = getPaperColors('mixed', 0.7, 0.8);
    const bright = getPaperColors('mixed', 0.95, 0.8);
    expect(dim.backgroundColor).toBe('hsl(38, 25%, 70%)');
    expect(bright.backgroundColor).toBe('hsl(38, 25%, 95%)');
  });

  it('dark theme lightness stays in the 10-20% band', () => {
    const dark = getPaperColors('dark', 1, 1);
    expect(dark.backgroundColor).toBe('hsl(24, 10%, 20%)');
    const darkDim = getPaperColors('dark', 0.5, 1);
    expect(darkDim.backgroundColor).toBe('hsl(24, 10%, 10%)');
  });
});
