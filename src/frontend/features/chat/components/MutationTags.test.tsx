// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Verify scene mutation tag labels are rendered with readable numbering.
 */

// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../app/i18n';
import { MutationTags, type SessionMutation } from './MutationTags';
import { resetStoryStore, useStoryStore } from '../../../stores/storyStore';
import type { StoryState } from '../../../types';

function renderWithI18n(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('MutationTags', () => {
  beforeEach(() => {
    resetStoryStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders scene tags as Book/Chapter/Scene numbers when chapter link exists', () => {
    const baseStory = useStoryStore.getState().story;
    const story: StoryState = {
      ...baseStory,
      books: [
        {
          id: 'book-1',
          title: 'Book One',
          chapters: [
            {
              id: 'ch-1',
              title: 'Chapter 1',
              summary: '',
              content: '',
              book_id: 'book-1',
            },
            {
              id: 'ch-2',
              title: 'Chapter 2',
              summary: '',
              content: '',
              book_id: 'book-1',
            },
          ],
        },
      ],
      chapters: [
        {
          id: 'ch-1',
          title: 'Chapter 1',
          summary: '',
          content: '',
          book_id: 'book-1',
        },
        {
          id: 'ch-2',
          title: 'Chapter 2',
          summary: '',
          content: '',
          book_id: 'book-1',
        },
      ],
      scenes: [
        {
          id: 1,
          summary: 'A',
          beats: [],
          active_characters: [],
          passive_characters: [],
          causes: [],
          pinboard_x: 0,
          pinboard_y: 0,
          status: 'active',
          prose_link: null,
        },
        {
          id: 2,
          summary: 'B',
          beats: [],
          active_characters: [],
          passive_characters: [],
          causes: [],
          pinboard_x: 1,
          pinboard_y: 1,
          status: 'active',
          prose_link: {
            scope_type: 'chapter',
            chapter_id: 'ch-2',
            book_id: 'book-1',
            start_offset: 0,
            end_offset: 10,
            content_hash: '',
          },
        },
      ],
    };
    useStoryStore.setState({ story });

    const onMutationClick = vi.fn();
    const mutations: SessionMutation[] = [
      {
        id: 'm-scene',
        type: 'scene',
        label: 'Scene',
        targetId: '2',
      },
    ];

    renderWithI18n(
      <MutationTags mutations={mutations} onMutationClick={onMutationClick} />
    );

    const button = screen.getByRole('button', {
      name: /Book 1 \/ Chapter 2 \/ Scene 2/i,
    });
    fireEvent.click(button);

    expect(onMutationClick).toHaveBeenCalledWith(mutations[0]);
  });

  it('falls back to provided scene label when scene is not in store', () => {
    const onMutationClick = vi.fn();
    const mutations: SessionMutation[] = [
      {
        id: 'm-scene',
        type: 'scene',
        label: 'Scene',
        targetId: 'missing-scene',
      },
    ];

    renderWithI18n(
      <MutationTags mutations={mutations} onMutationClick={onMutationClick} />
    );

    expect(screen.getByRole('button', { name: /^Scene$/i })).toBeTruthy();
  });

  it('shows scene ID on hover title for scene mutation tags', () => {
    const onMutationClick = vi.fn();
    const mutations: SessionMutation[] = [
      {
        id: 'm-scene',
        type: 'scene',
        label: 'Scene',
        targetId: '123',
      },
    ];

    renderWithI18n(
      <MutationTags mutations={mutations} onMutationClick={onMutationClick} />
    );

    const button = screen.getByRole('button', { name: /^Scene$/i });
    expect(button.getAttribute('title')).toBe('ID: 123');
  });
});
