// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Regression tests for ChapterList metadata editing. Guards against issue
 * #264: editing a chapter's metadata (summary, notes, etc.) must never leak
 * the entity's `content` field into the update payload, which previously
 * wiped the chapter's prose both in the editor and on the backend.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider } from '../layout/ThemeContext';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import i18n from '../app/i18n';
import { ChapterList } from './ChapterList';
import type { Chapter } from '../../types';

const { updateMetadataMock, updateTitleMock, updateBookMetadataMock } = vi.hoisted(
  () => ({
    updateMetadataMock: vi.fn(async () => ({ ok: true })),
    updateTitleMock: vi.fn(async () => ({ ok: true })),
    updateBookMetadataMock: vi.fn(async () => ({ ok: true })),
  })
);

vi.mock('../../services/api', () => ({
  api: {
    chapters: {
      updateMetadata: updateMetadataMock,
      updateTitle: updateTitleMock,
    },
    books: {
      updateBookMetadata: updateBookMetadataMock,
    },
  },
}));

function renderChapterList(chapters: Chapter[]): {
  onUpdateChapter: ReturnType<typeof vi.fn>;
  onSelect: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onCreate: ReturnType<typeof vi.fn>;
} {
  const onUpdateChapter = vi.fn();
  const onSelect = vi.fn();
  const onDelete = vi.fn();
  const onCreate = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider currentTheme="light">
        <ChapterList
          chapters={chapters}
          projectType="novel"
          currentChapterId={null}
          onSelect={onSelect}
          onDelete={onDelete}
          onUpdateChapter={onUpdateChapter}
          onCreate={onCreate}
        />
      </ThemeProvider>
    </I18nextProvider>
  );
  return { onUpdateChapter, onSelect, onDelete, onCreate };
}

function mkChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: overrides.id ?? '1',
    title: overrides.title ?? 'Chapter 1',
    summary: overrides.summary ?? 'Initial summary',
    content: overrides.content ?? '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ChapterList metadata editing', () => {
  it('does not include chapter content in the metadata update payload (issue #264)', async () => {
    vi.useFakeTimers();
    const chapter = mkChapter({
      content: 'The real prose that must survive metadata edits.',
      notes: 'Visible notes',
      private_notes: 'Hidden notes',
    });
    const { onUpdateChapter } = renderChapterList([chapter]);

    // Step 1: open the metadata dialog for the chapter.
    fireEvent.click(screen.getByTitle('Edit Metadata'));
    expect(screen.getByLabelText('Title')).toBeTruthy();

    // Step 2: edit a metadata field (title) which triggers the autosave.
    const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Chapter 1 (renamed)' } });

    // Step 3: advance past the autosave debounce.
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });

    expect(updateMetadataMock).toHaveBeenCalled();
    expect(onUpdateChapter).toHaveBeenCalled();

    // Step 4 (the regression): no update payload may ever carry `content`.
    for (const call of onUpdateChapter.mock.calls) {
      const payload = call[1] as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(payload, 'content')).toBe(false);
      expect(payload.content).toBeUndefined();
    }
  });

  it('keeps only the edited metadata fields in the update payload', async () => {
    vi.useFakeTimers();
    const chapter = mkChapter({
      content: 'Some prose.',
      summary: 'Old summary',
    });
    const { onUpdateChapter } = renderChapterList([chapter]);

    fireEvent.click(screen.getByTitle('Edit Metadata'));

    const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Renamed' } });

    await act(async () => {
      vi.advanceTimersByTime(1100);
    });

    expect(onUpdateChapter).toHaveBeenCalled();
    const payload = onUpdateChapter.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.title).toBe('Renamed');
    expect(payload.summary).toBe('Old summary');
    expect(payload.content).toBeUndefined();
    expect(payload.id).toBeUndefined();
  });
});
