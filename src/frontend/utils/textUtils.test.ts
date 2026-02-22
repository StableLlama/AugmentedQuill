// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Tests for text utilities.

import { describe, it, expect } from 'vitest';
import { computeContentWithSeparator } from './textUtils';

describe('computeContentWithSeparator', () => {
  it('should handle empty prefix', () => {
    const { separator, newContent } = computeContentWithSeparator(
      '',
      'Hello',
      '',
      'raw'
    );
    expect(separator).toBe('');
    expect(newContent).toBe('Hello');
  });

  it('should add space for token boundary in raw mode', () => {
    const { separator, newContent } = computeContentWithSeparator(
      'Hello',
      'World',
      '',
      'raw'
    );
    expect(separator).toBe(' ');
    expect(newContent).toBe('Hello World');
  });

  it('should NOT add space if suffix starts with whitespace in raw mode', () => {
    const { separator } = computeContentWithSeparator('Hello', ' World', '', 'raw');
    expect(separator).toBe('');
  });

  it('should add space for token boundary in formatted mode if no newlines', () => {
    const { separator, newContent } = computeContentWithSeparator(
      'Hello',
      'World',
      '',
      'markdown'
    );
    expect(separator).toBe(' ');
    expect(newContent).toBe('Hello World');
  });

  it('should add double newline if prefix ends with space and we are in formatted mode', () => {
    // This is the quirky behavior of the current implementation:
    // if endsWithWhitespace is true, needsTokenBoundary is false, so it uses \n\n
    const { separator } = computeContentWithSeparator(
      'Hello ',
      'World',
      '',
      'markdown'
    );
    expect(separator).toBe('\n\n');
  });

  it('should complement existing newlines to total 2 in formatted mode', () => {
    const { separator } = computeContentWithSeparator(
      'Hello\n',
      'World',
      '',
      'markdown'
    );
    expect(separator).toBe('\n');

    const { separator: sep2 } = computeContentWithSeparator(
      'Hello',
      '\nWorld',
      '',
      'markdown'
    );
    expect(sep2).toBe('\n');

    const { separator: sep3 } = computeContentWithSeparator(
      'Hello\n\n',
      'World',
      '',
      'markdown'
    );
    expect(sep3).toBe('');
  });

  it('should use single space if it matches token boundary even in formatted mode if no newlines are involved?', () => {
    // Checking the logic: separator = needsTokenBoundary ? ' ' : '\n\n';
    // If I have "Hello" and I'm adding "World" (no whitespace), it should be \n\n if no newlines.
    // If I have "Hello " and I'm adding "World", needsTokenBoundary is false, so it should be \n\n?
    // Wait, the logic says:
    // else { separator = needsTokenBoundary ? ' ' : '\n\n'; }

    const { separator } = computeContentWithSeparator(
      'Hello ',
      'World',
      '',
      'markdown'
    );
    expect(separator).toBe('\n\n');
  });
});
