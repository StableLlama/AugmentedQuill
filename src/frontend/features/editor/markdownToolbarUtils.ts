// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines markdown toolbar utility helpers so mode-aware formatting behavior stays reusable and testable.
 */

export type MarkdownBlockType = 'h1' | 'h2' | 'h3' | 'quote' | 'ul' | 'ol';
export type InlineFormatType =
  'bold' | 'italic' | 'strikethrough' | 'subscript' | 'superscript';
export type TextSelectionRange = { start: number; end: number };

export const getLineAtOffset = (text: string, offset: number): string => {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const lineStart = text.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1;
  const lineEndRaw = text.indexOf('\n', safeOffset);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  return text.slice(lineStart, lineEnd);
};

export const getLineBoundsAtOffset = (
  text: string,
  offset: number
): { lineStart: number; lineEnd: number } => {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const lineStart = text.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1;
  const lineEndRaw = text.indexOf('\n', safeOffset);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  return { lineStart, lineEnd };
};

export const getBlockType = (line: string): MarkdownBlockType | null => {
  if (/^\s*###\s+/.test(line)) return 'h3';
  if (/^\s*##\s+/.test(line)) return 'h2';
  if (/^\s*#\s+/.test(line)) return 'h1';
  if (/^\s*>\s+/.test(line)) return 'quote';
  if (/^\s*[-*+]\s+/.test(line)) return 'ul';
  if (/^\s*\d+\.\s+/.test(line)) return 'ol';
  return null;
};

export const getBlockPrefix = (type: MarkdownBlockType): string => {
  switch (type) {
    case 'h1':
      return '# ';
    case 'h2':
      return '## ';
    case 'h3':
      return '### ';
    case 'quote':
      return '> ';
    case 'ul':
      return '- ';
    case 'ol':
      return '1. ';
  }
};

export const toggleBlockAtOffset = (
  rawText: string,
  rawCaret: number,
  type: MarkdownBlockType
): { nextRawText: string; nextRawCaret: number } => {
  const { lineStart, lineEnd } = getLineBoundsAtOffset(rawText, rawCaret);
  const line = rawText.slice(lineStart, lineEnd);
  const currentType = getBlockType(line);
  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '';
  const body = line.replace(/^(\s*)(#{1,3}\s+|>\s+|[-*+]\s+|\d+\.\s+)/, '$1');

  const nextLine =
    currentType === type
      ? `${indent}${body}`
      : `${indent}${getBlockPrefix(type)}${body}`;
  const nextRawText = rawText.slice(0, lineStart) + nextLine + rawText.slice(lineEnd);

  const delta = nextLine.length - line.length;
  const nextRawCaret = Math.max(lineStart, rawCaret + delta);
  return { nextRawText, nextRawCaret };
};

const isWordChar = (ch: string | undefined): boolean =>
  !!ch && /[\p{L}\p{N}]/u.test(ch);

const getInlineMarkers = (type: InlineFormatType): { open: string; close: string } => {
  if (type === 'bold') return { open: '**', close: '**' };
  if (type === 'strikethrough') return { open: '~~', close: '~~' };
  if (type === 'subscript') return { open: '~', close: '~' };
  if (type === 'superscript') return { open: '^', close: '^' };
  return { open: '_', close: '_' };
};

const findWordBoundsAtOffset = (
  rawText: string,
  offset: number
): { start: number; end: number } | null => {
  const safeOffset = Math.max(0, Math.min(offset, rawText.length));
  if (!isWordChar(rawText[safeOffset])) return null;

  let start = safeOffset;
  let end = safeOffset;

  while (start > 0 && isWordChar(rawText[start - 1])) {
    start -= 1;
  }
  while (end < rawText.length && isWordChar(rawText[end])) {
    end += 1;
  }

  if (start >= end) return null;
  return { start, end };
};

const resolveInlineTarget = (
  rawText: string,
  selectionStart: number,
  selectionEnd: number
): { start: number; end: number } => {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd));
  const end = Math.max(0, Math.max(selectionStart, selectionEnd));

  if (start !== end) {
    return { start, end };
  }

  const word = findWordBoundsAtOffset(rawText, start);
  if (word) return word;
  return { start, end };
};

const countChar = (s: string, c: string): number => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === c) n++;
  }
  return n;
};

const getLeftFormat = (str: string, start: number): string => {
  let L = start;
  while (L > 0 && (str[L - 1] === '*' || str[L - 1] === '_')) L--;
  return str.slice(L, start);
};

const getRightFormat = (str: string, end: number): string => {
  let R = end;
  while (R < str.length && (str[R] === '*' || str[R] === '_')) R++;
  return str.slice(end, R);
};

const replaceLast = (str: string, find: string): string => {
  const idx = str.lastIndexOf(find);
  if (idx === -1) return str;
  return str.slice(0, idx) + str.slice(idx + find.length);
};

const replaceFirst = (str: string, find: string): string => {
  const idx = str.indexOf(find);
  if (idx === -1) return str;
  return str.slice(0, idx) + str.slice(idx + find.length);
};

// Check whether the resolved target is wrapped in exactly the given open/close markers.
const isWrappedInSimpleMarkers = (
  rawText: string,
  start: number,
  end: number,
  open: string,
  close: string
): boolean => {
  const before = rawText.slice(Math.max(0, start - open.length), start);
  const after = rawText.slice(end, Math.min(rawText.length, end + close.length));
  return before === open && after === close;
};

export const isInlineFormatActiveAtSelection = (
  rawText: string,
  selectionStart: number,
  selectionEnd: number,
  type: InlineFormatType
): boolean => {
  const target = resolveInlineTarget(rawText, selectionStart, selectionEnd);
  if (target.start === target.end) return false;

  // Simple single-pair marker types use a direct prefix/suffix check.
  if (type === 'strikethrough') {
    return isWrappedInSimpleMarkers(rawText, target.start, target.end, '~~', '~~');
  }
  if (type === 'subscript') {
    // Single ~ — must not be inside ~~ (strikethrough)
    if (!isWrappedInSimpleMarkers(rawText, target.start, target.end, '~', '~'))
      return false;
    const before2 = rawText.slice(Math.max(0, target.start - 2), target.start);
    return before2 !== '~~';
  }
  if (type === 'superscript') {
    return isWrappedInSimpleMarkers(rawText, target.start, target.end, '^', '^');
  }

  // Bold / italic use the existing character-count approach.
  const left = getLeftFormat(rawText, target.start);
  const right = getRightFormat(rawText, target.end);

  const sl = countChar(left, '*');
  const sr = countChar(right, '*');
  const ul = countChar(left, '_');
  const ur = countChar(right, '_');

  if (type === 'bold') {
    return (sl >= 2 && sr >= 2) || (ul >= 2 && ur >= 2);
  } else if (type === 'italic') {
    const starItalic = (sl === 1 || sl >= 3) && (sr === 1 || sr >= 3);
    const underItalic = (ul === 1 || ul >= 3) && (ur === 1 || ur >= 3);
    return starItalic || underItalic;
  }
  return false;
};

export const applyInlineFormatAtSelection = (
  rawText: string,
  selectionStart: number,
  selectionEnd: number,
  type: InlineFormatType
): { nextRawText: string; nextStart: number; nextEnd: number } => {
  const { open, close } = getInlineMarkers(type);
  const { start, end } = resolveInlineTarget(rawText, selectionStart, selectionEnd);

  if (start !== end) {
    const selected = rawText.slice(start, end);
    const nextRawText =
      rawText.slice(0, start) + open + selected + close + rawText.slice(end);
    return {
      nextRawText,
      nextStart: start + open.length,
      nextEnd: end + open.length,
    };
  }

  const word = findWordBoundsAtOffset(rawText, start);
  if (word) {
    const segment = rawText.slice(word.start, word.end);
    const nextRawText =
      rawText.slice(0, word.start) + open + segment + close + rawText.slice(word.end);
    return {
      nextRawText,
      nextStart: word.start + open.length,
      nextEnd: word.end + open.length,
    };
  }

  const nextRawText = rawText.slice(0, start) + open + close + rawText.slice(start);
  const caret = start + open.length;
  return { nextRawText, nextStart: caret, nextEnd: caret };
};

// Toggle a simple open/close marker pair on/off around the resolved selection.
const toggleSimpleInlineFormat = (
  rawText: string,
  selectionStart: number,
  selectionEnd: number,
  open: string,
  close: string
): { nextRawText: string; nextStart: number; nextEnd: number } => {
  const target = resolveInlineTarget(rawText, selectionStart, selectionEnd);
  const { start, end } = target;

  if (start === end) {
    // No selection — insert markers and place caret between them.
    const nextRawText = rawText.slice(0, start) + open + close + rawText.slice(start);
    const caret = start + open.length;
    return { nextRawText, nextStart: caret, nextEnd: caret };
  }

  const active = isWrappedInSimpleMarkers(rawText, start, end, open, close);
  if (active) {
    const openStart = start - open.length;
    const closeEnd = end + close.length;
    const nextRawText =
      rawText.slice(0, openStart) + rawText.slice(start, end) + rawText.slice(closeEnd);
    return {
      nextRawText,
      nextStart: openStart,
      nextEnd: openStart + (end - start),
    };
  }

  const selected = rawText.slice(start, end);
  const nextRawText =
    rawText.slice(0, start) + open + selected + close + rawText.slice(end);
  return {
    nextRawText,
    nextStart: start + open.length,
    nextEnd: end + open.length,
  };
};

export const toggleInlineFormatAtSelection = (
  rawText: string,
  selectionStart: number,
  selectionEnd: number,
  type: InlineFormatType
): { nextRawText: string; nextStart: number; nextEnd: number } => {
  // Simple marker types bypass the bold/italic complexity entirely.
  if (type === 'strikethrough' || type === 'subscript' || type === 'superscript') {
    const { open, close } = getInlineMarkers(type);

    // subscript (~) and superscript (^) are mutually exclusive: if the
    // opposite marker is currently active at the same target, strip it first.
    if (type === 'subscript' || type === 'superscript') {
      const opposite = type === 'subscript' ? 'superscript' : 'subscript';
      const { open: oppOpen, close: oppClose } = getInlineMarkers(opposite);
      const target = resolveInlineTarget(rawText, selectionStart, selectionEnd);
      if (
        target.start !== target.end &&
        isWrappedInSimpleMarkers(rawText, target.start, target.end, oppOpen, oppClose)
      ) {
        const openStart = target.start - oppOpen.length;
        const closeEnd = target.end + oppClose.length;
        const stripped =
          rawText.slice(0, openStart) +
          rawText.slice(target.start, target.end) +
          rawText.slice(closeEnd);
        return toggleSimpleInlineFormat(
          stripped,
          openStart,
          openStart + (target.end - target.start),
          open,
          close
        );
      }
    }

    return toggleSimpleInlineFormat(rawText, selectionStart, selectionEnd, open, close);
  }

  const target = resolveInlineTarget(rawText, selectionStart, selectionEnd);

  if (target.start === target.end) {
    return applyInlineFormatAtSelection(rawText, selectionStart, selectionEnd, type);
  }

  const active = isInlineFormatActiveAtSelection(
    rawText,
    selectionStart,
    selectionEnd,
    type
  );
  const left = getLeftFormat(rawText, target.start);
  const right = getRightFormat(rawText, target.end);

  if (active) {
    const sl = countChar(left, '*');
    const sr = countChar(right, '*');

    let markerToRemove = '';
    if (type === 'bold') {
      if (sl >= 2 && sr >= 2) markerToRemove = '**';
      else markerToRemove = '__';
    } else {
      if ((sl === 1 || sl >= 3) && (sr === 1 || sr >= 3)) markerToRemove = '*';
      else markerToRemove = '_';
    }

    const newLeft = replaceLast(left, markerToRemove);
    const newRight = replaceFirst(right, markerToRemove);

    const openStart = target.start - left.length;
    const closeEnd = target.end + right.length;

    const nextRawText =
      rawText.slice(0, openStart) +
      newLeft +
      rawText.slice(target.start, target.end) +
      newRight +
      rawText.slice(closeEnd);

    return {
      nextRawText,
      nextStart: openStart + newLeft.length,
      nextEnd: openStart + newLeft.length + (target.end - target.start),
    };
  }

  return applyInlineFormatAtSelection(rawText, selectionStart, selectionEnd, type);
};
// ─── Fenced Code Block ───────────────────────────────────────────────────────

export const insertFencedCodeBlock = (
  rawText: string,
  selectionStart: number,
  selectionEnd: number
): { nextRawText: string; nextStart: number; nextEnd: number } => {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const selected = rawText.slice(start, end);
  const open = '```\n';
  const close = '\n```';
  const insert = open + selected + close;
  const nextRawText = rawText.slice(0, start) + insert + rawText.slice(end);
  return {
    nextRawText,
    nextStart: start + open.length,
    nextEnd: start + open.length + selected.length,
  };
};

// ─── Footnote ────────────────────────────────────────────────────────────────

export const insertFootnote = (
  rawText: string,
  selectionStart: number
): { nextRawText: string; nextCaret: number } => {
  // Find the next available footnote number.
  const existing = rawText.match(/\[\^(\d+)\]/g) ?? [];
  const maxNum = existing.reduce((max: number, m: string): number => {
    const n = parseInt(m.replace(/\[\^|\]/g, ''), 10);
    return n > max ? n : max;
  }, 0);
  const n = maxNum + 1;
  const ref = `[^${n}]`;
  const withRef =
    rawText.slice(0, selectionStart) + ref + rawText.slice(selectionStart);
  // Append the definition at the very end (after a separator if needed).
  const trailingNl = withRef.endsWith('\n\n')
    ? ''
    : withRef.endsWith('\n')
      ? '\n'
      : '\n\n';
  const nextRawText = withRef + trailingNl + `[^${n}]: `;
  return { nextRawText, nextCaret: selectionStart + ref.length };
};

// ─────────────────────────────────────────────────────────────────────────────

export const resolveInlineSelection = (
  currentSelection: TextSelectionRange | null,
  lastSelection: TextSelectionRange | null,
  textLength: number
): TextSelectionRange => {
  const currentCollapsed =
    !!currentSelection && currentSelection.start === currentSelection.end;
  const lastExpanded = !!lastSelection && lastSelection.start !== lastSelection.end;

  const selected =
    currentCollapsed && lastExpanded
      ? lastSelection
      : currentSelection || lastSelection;
  if (!selected) {
    return { start: textLength, end: textLength };
  }

  const start = Math.max(0, Math.min(selected.start, selected.end));
  const end = Math.max(0, Math.max(selected.start, selected.end));
  return {
    start: Math.min(start, textLength),
    end: Math.min(end, textLength),
  };
};
