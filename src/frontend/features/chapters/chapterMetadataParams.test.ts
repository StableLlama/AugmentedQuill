// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for the Chapter/Book → MetadataParams sanitizers. These guard against
 * entity fields such as `content` / `chapters` leaking into the metadata
 * dialog data flow, which previously wiped chapter prose on metadata edits
 * (issue #264).
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { toChapterMetadataParams, toBookMetadataParams } from './chapterMetadataParams';
import type { Chapter, Book, Conflict } from '../../types';

describe('toChapterMetadataParams', () => {
  it('returns a MetadataParams literal with only metadata fields', () => {
    const conflict: Conflict = {
      id: 'c1',
      description: 'Unresolved oath',
      resolution: 'Pending trial',
    };
    const chapter: Chapter = {
      id: '12',
      title: 'The Heist',
      summary: 'A plan unfolds.',
      content: 'Long prose that must never be sent as metadata.',
      filename: 'ch12.md',
      book_id: 'b1',
      notes: 'Visible LLM notes',
      private_notes: 'Hidden notes',
      conflicts: [conflict],
    };

    const params = toChapterMetadataParams(chapter);

    expect(params).toEqual({
      title: 'The Heist',
      summary: 'A plan unfolds.',
      notes: 'Visible LLM notes',
      private_notes: 'Hidden notes',
      conflicts: [conflict],
    });
    expect(params).not.toHaveProperty('content');
    expect(params).not.toHaveProperty('filename');
    expect(params).not.toHaveProperty('book_id');
    expect(params).not.toHaveProperty('id');
  });

  it('never leaks real chapter prose into the metadata payload', () => {
    const chapter: Chapter = {
      id: '7',
      title: 'Chapter 7',
      summary: '',
      content: 'The real story text that must survive a metadata edit.',
    };

    const params = toChapterMetadataParams(chapter) as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(params, 'content')).toBe(false);
    expect(params.content).toBeUndefined();
  });

  it('keeps optional metadata fields undefined instead of inventing them', () => {
    const chapter: Chapter = {
      id: '1',
      title: 'T',
      summary: 'S',
      content: 'C',
    };

    const params = toChapterMetadataParams(chapter);

    expect(params.title).toBe('T');
    expect(params.summary).toBe('S');
    expect(params.notes).toBeUndefined();
    expect(params.private_notes).toBeUndefined();
    expect(params.conflicts).toBeUndefined();
  });

  it('returns an empty-ish literal for a blank chapter', () => {
    const chapter: Chapter = {
      id: '9',
      title: '',
      summary: '',
      content: '',
    };

    const params = toChapterMetadataParams(chapter);

    expect(params).toEqual({ title: '', summary: '' });
    expect(params).not.toHaveProperty('content');
  });
});

describe('toBookMetadataParams', () => {
  it('returns a MetadataParams literal without the chapters list', () => {
    const book: Book = {
      id: 'b1',
      title: 'The Saga',
      summary: 'A long saga.',
      notes: 'Book notes',
      private_notes: 'Book private notes',
      chapters: [
        {
          id: '1',
          title: 'Ch1',
          summary: '',
          content: 'prose',
        },
      ],
    };

    const params = toBookMetadataParams(book);

    expect(params).toEqual({
      title: 'The Saga',
      summary: 'A long saga.',
      notes: 'Book notes',
      private_notes: 'Book private notes',
    });
    expect(params).not.toHaveProperty('chapters');
    expect(params).not.toHaveProperty('id');
  });

  it('never includes the book chapters array in the metadata payload', () => {
    const book: Book = {
      id: 'b2',
      title: 'Empty',
      chapters: [],
    };

    const params = toBookMetadataParams(book) as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(params, 'chapters')).toBe(false);
    expect(params.chapters).toBeUndefined();
  });
});
