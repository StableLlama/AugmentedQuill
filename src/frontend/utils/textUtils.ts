// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Text manipulation utilities.

import { ViewMode } from '../types';

export function computeContentWithSeparator(
  prefix: string,
  text: string,
  suffix: string,
  viewMode: ViewMode
): { newContent: string; separator: string } {
  const startsWithWhitespace = text.length > 0 && /^\s/.test(text);
  const endsWithWhitespace = prefix.length > 0 && /\s$/.test(prefix);

  const needsTokenBoundary =
    prefix.length > 0 && !endsWithWhitespace && !startsWithWhitespace;

  const countTrailingNewlines = (value: string) => {
    let index = value.length - 1;
    let count = 0;
    while (index >= 0 && value[index] === '\n') {
      count++;
      index--;
    }
    return count;
  };
  const countLeadingNewlines = (value: string) => {
    let index = 0;
    let count = 0;
    while (index < value.length && value[index] === '\n') {
      count++;
      index++;
    }
    return count;
  };

  let separator = '';

  if (prefix.length === 0) {
    separator = '';
  } else if (viewMode === 'raw') {
    separator = needsTokenBoundary ? ' ' : '';
  } else {
    // markdown or wysiwyg
    const preNewlines = countTrailingNewlines(prefix);
    const textNewlines = countLeadingNewlines(text);
    const totalBoundaryNewlines = preNewlines + textNewlines;

    if (totalBoundaryNewlines >= 2) {
      separator = '';
    } else if (preNewlines > 0 || textNewlines > 0) {
      separator = '\n'.repeat(Math.max(0, 2 - totalBoundaryNewlines));
    } else {
      separator = needsTokenBoundary ? ' ' : '\n\n';
    }
  }

  return {
    newContent: prefix + separator + text + suffix,
    separator,
  };
}
