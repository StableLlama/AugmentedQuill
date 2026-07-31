// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the story mappers.test unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { describe, it, expect } from 'vitest';
import {
  mapSelectStoryToState,
  mapStoryBooks,
  reanchorChapterSelection,
} from './storyMappers';
import { Chapter } from '../../types';

describe('storyMappers reanchorChapterSelection', () => {
  it('should preserve selection when ID matches exactly', () => {
    const chapters: Chapter[] = [
      { id: '1', title: 'Chapter 1', summary: '', content: '' },
      { id: '2', title: 'Chapter 2', summary: '', content: '' },
    ];
    const nextChapters: Chapter[] = [
      { id: '1', title: 'Chapter 1 edited', summary: '', content: '' },
      { id: '2', title: 'Chapter 2', summary: '', content: '' },
    ];

    expect(reanchorChapterSelection('1', chapters, nextChapters)).toBe('1');
  });

  it('should fall back to filename/book_id if ID changes', () => {
    const chapters: Chapter[] = [
      {
        id: 'old-1',
        title: 'Chapter 1',
        summary: '',
        content: '',
        filename: '0001.txt',
        book_id: 'book1',
      },
    ];
    const nextChapters: Chapter[] = [
      {
        id: 'new-1',
        title: 'Chapter 1',
        summary: '',
        content: '',
        filename: '0001.txt',
        book_id: 'book1',
      },
    ];

    expect(reanchorChapterSelection('old-1', chapters, nextChapters)).toBe('new-1');
  });

  it('should return null if no match is found', () => {
    const chapters: Chapter[] = [
      { id: '1', title: 'Chapter 1', summary: '', content: '' },
    ];
    const nextChapters: Chapter[] = [
      { id: '2', title: 'Chapter 2', summary: '', content: '' },
    ];

    expect(reanchorChapterSelection('1', chapters, nextChapters)).toBe(null);
  });
});

describe('storyMappers mapSelectStoryToState', () => {
  it('maps books with stable IDs when story book id is missing', () => {
    const mapped = mapStoryBooks([
      { id: null, folder: 'book-folder-1', title: 'Book One' },
      { id: null, folder: null, title: 'Book Two' },
      { id: 'book-3', folder: null, title: 'Book Three' },
    ]);

    expect(mapped.map((book: { id: string | null }) => book.id)).toEqual([
      'book-folder-1',
      'book-2',
      'book-3',
    ]);
  });

  it('maps story-level notes and private notes from API payload', () => {
    const mapped = mapSelectStoryToState(
      'demo-project',
      {
        project_title: 'Demo',
        story_summary: 'Summary',
        notes: 'Visible notes',
        private_notes: 'Hidden notes',
      },
      [],
      null,
      []
    );

    expect(mapped.notes).toBe('Visible notes');
    expect(mapped.private_notes).toBe('Hidden notes');
  });

  it('defaults missing story-level notes/private notes to empty strings', () => {
    const mapped = mapSelectStoryToState(
      'demo-project',
      {
        project_title: 'Demo',
        story_summary: 'Summary',
      },
      [],
      null,
      []
    );

    expect(mapped.notes).toBe('');
    expect(mapped.private_notes).toBe('');
  });

  it('does not preserve chapter prose when project changes', () => {
    const previousChapters: Chapter[] = [
      {
        id: '1',
        title: 'Old chapter',
        summary: '',
        content: 'Old project prose',
      },
    ];
    const incomingChapters: Chapter[] = [
      {
        id: '1',
        title: 'New chapter',
        summary: '',
        content: '',
      },
    ];

    const mapped = mapSelectStoryToState(
      'new-project',
      {
        project_title: 'Demo',
        story_summary: 'Summary',
      },
      incomingChapters,
      '1',
      previousChapters,
      'old-project'
    );

    expect(mapped.chapters[0].content).toBe('');
  });

  it('preserves time-travel sourcebook fields from story payload', () => {
    const mapped = mapSelectStoryToState(
      'demo-project',
      {
        project_title: 'Demo',
        story_summary: 'Summary',
        sourcebook: [
          {
            id: '1985 -> 1955',
            name: '1985 -> 1955',
            category: 'Time Travel',
            description: 'Temporal jump',
            synonyms: [],
            images: [],
            origin_date: '1985-11-05T20:00:00+00:00[UTC][u-ca=gregory]',
            destination_datetime: '1955-11-05T20:00:00+00:00[UTC][u-ca=gregory]',
            destination_relative: '30 years earlier',
            creates_new_timeline: true,
            timeline_id: 'branch:16->10',
          },
        ],
      },
      [],
      null,
      []
    );

    expect(mapped.sourcebook).toHaveLength(1);
    expect(mapped.sourcebook[0].origin_date).toBe(
      '1985-11-05T20:00:00+00:00[UTC][u-ca=gregory]'
    );
    expect(mapped.sourcebook[0].destination_datetime).toBe(
      '1955-11-05T20:00:00+00:00[UTC][u-ca=gregory]'
    );
    expect(mapped.sourcebook[0].destination_relative).toBe('30 years earlier');
    expect(mapped.sourcebook[0].creates_new_timeline).toBe(true);
    expect(mapped.sourcebook[0].timeline_id).toBe('branch:16->10');
  });
});
