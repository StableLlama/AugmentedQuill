// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Validate session mutation click routing in the app chat runtime.
 */

import { describe, expect, it, vi } from 'vitest';

import { handleSessionMutationClick } from './useAppChatRuntime';

type CallbackSet = {
  handleChapterSelect: ReturnType<typeof vi.fn>;
  openAndExpandStory: ReturnType<typeof vi.fn>;
  openSceneEditorDialog: ReturnType<typeof vi.fn>;
  openSourcebookEntryDialog: ReturnType<typeof vi.fn>;
  openStoryMetadataDialog: ReturnType<typeof vi.fn>;
  openChapterMetadataDialog: ReturnType<typeof vi.fn>;
};

function createCallbacks(): CallbackSet {
  return {
    handleChapterSelect: vi.fn(),
    openAndExpandStory: vi.fn(),
    openSceneEditorDialog: vi.fn(),
    openSourcebookEntryDialog: vi.fn(),
    openStoryMetadataDialog: vi.fn(),
    openChapterMetadataDialog: vi.fn(),
  };
}

describe('handleSessionMutationClick', () => {
  it('routes chapter mutations to chapter selection', () => {
    const callbacks = createCallbacks();

    handleSessionMutationClick(
      {
        id: 'm1',
        type: 'chapter',
        label: 'Chapter 2',
        targetId: '2',
      },
      callbacks
    );

    expect(callbacks.openAndExpandStory).toHaveBeenCalledTimes(1);
    expect(callbacks.handleChapterSelect).toHaveBeenCalledWith('2');
  });

  it('routes chapter mutations without target to no chapter selection', () => {
    const callbacks = createCallbacks();

    handleSessionMutationClick(
      {
        id: 'm1',
        type: 'chapter',
        label: 'Chapter changed',
      },
      callbacks
    );

    expect(callbacks.openAndExpandStory).toHaveBeenCalledTimes(1);
    expect(callbacks.handleChapterSelect).toHaveBeenCalledWith(null);
  });

  it('routes scene mutations to scene editor without chapter selection', () => {
    const callbacks = createCallbacks();

    handleSessionMutationClick(
      {
        id: 'm1',
        type: 'scene',
        label: 'Scene 7',
        targetId: '7',
      },
      callbacks
    );

    expect(callbacks.openAndExpandStory).toHaveBeenCalledTimes(1);
    expect(callbacks.handleChapterSelect).toHaveBeenCalledWith(null);
    expect(callbacks.openSceneEditorDialog).toHaveBeenCalledWith(7, true, null);
    expect(callbacks.openSourcebookEntryDialog).not.toHaveBeenCalled();
    expect(callbacks.openStoryMetadataDialog).not.toHaveBeenCalled();
    expect(callbacks.openChapterMetadataDialog).not.toHaveBeenCalled();
  });

  it('does not open scene editor when scene mutation has no target id', () => {
    const callbacks = createCallbacks();

    handleSessionMutationClick(
      {
        id: 'm1',
        type: 'scene',
        label: 'Scene changed',
      },
      callbacks
    );

    expect(callbacks.openAndExpandStory).toHaveBeenCalledTimes(1);
    expect(callbacks.handleChapterSelect).toHaveBeenCalledWith(null);
    expect(callbacks.openSceneEditorDialog).not.toHaveBeenCalled();
  });

  it('routes story mutations to story area', () => {
    const callbacks = createCallbacks();

    handleSessionMutationClick(
      {
        id: 'm1',
        type: 'story',
        label: 'Story prose',
      },
      callbacks
    );

    expect(callbacks.openAndExpandStory).toHaveBeenCalledTimes(1);
    expect(callbacks.handleChapterSelect).toHaveBeenCalledWith(null);
  });

  it('routes story metadata mutations to story metadata dialog', () => {
    const callbacks = createCallbacks();

    handleSessionMutationClick(
      {
        id: 'm1',
        type: 'metadata',
        label: 'Story summary',
        targetId: 'story',
        subType: 'summary',
      },
      callbacks
    );

    expect(callbacks.openAndExpandStory).toHaveBeenCalledTimes(1);
    expect(callbacks.openStoryMetadataDialog).toHaveBeenCalledWith('summary');
    expect(callbacks.openChapterMetadataDialog).not.toHaveBeenCalled();
  });

  it('routes chapter metadata mutations to chapter metadata dialog', () => {
    const callbacks = createCallbacks();

    handleSessionMutationClick(
      {
        id: 'm1',
        type: 'metadata',
        label: 'Chapter 3 Notes',
        targetId: '3',
        subType: 'notes',
      },
      callbacks
    );

    expect(callbacks.openAndExpandStory).toHaveBeenCalledTimes(1);
    expect(callbacks.handleChapterSelect).toHaveBeenCalledWith('3');
    expect(callbacks.openChapterMetadataDialog).toHaveBeenCalledWith('3', 'notes');
    expect(callbacks.openStoryMetadataDialog).not.toHaveBeenCalled();
  });

  it('routes sourcebook mutations with target id to sourcebook dialog', () => {
    const callbacks = createCallbacks();

    handleSessionMutationClick(
      {
        id: 'm1',
        type: 'sourcebook',
        label: 'SB: people',
        targetId: 'people',
      },
      callbacks
    );

    expect(callbacks.openSourcebookEntryDialog).toHaveBeenCalledWith('people');
    expect(callbacks.openAndExpandStory).not.toHaveBeenCalled();
  });

  it('ignores sourcebook mutations without target id', () => {
    const callbacks = createCallbacks();

    handleSessionMutationClick(
      {
        id: 'm1',
        type: 'sourcebook',
        label: 'Sourcebook',
      },
      callbacks
    );

    expect(callbacks.openSourcebookEntryDialog).not.toHaveBeenCalled();
    expect(callbacks.openAndExpandStory).not.toHaveBeenCalled();
  });

  it('ignores book mutations for now', () => {
    const callbacks = createCallbacks();

    handleSessionMutationClick(
      {
        id: 'm1',
        type: 'book',
        label: 'Book',
      },
      callbacks
    );

    expect(callbacks.openAndExpandStory).not.toHaveBeenCalled();
    expect(callbacks.handleChapterSelect).not.toHaveBeenCalled();
    expect(callbacks.openSourcebookEntryDialog).not.toHaveBeenCalled();
    expect(callbacks.openStoryMetadataDialog).not.toHaveBeenCalled();
    expect(callbacks.openChapterMetadataDialog).not.toHaveBeenCalled();
  });

  it('treats metadata without target id as story metadata', () => {
    const callbacks = createCallbacks();

    handleSessionMutationClick(
      {
        id: 'm1',
        type: 'metadata',
        label: 'Story notes',
        subType: 'notes',
      },
      callbacks
    );

    expect(callbacks.openAndExpandStory).toHaveBeenCalledTimes(1);
    expect(callbacks.openStoryMetadataDialog).toHaveBeenCalledWith('notes');
    expect(callbacks.openChapterMetadataDialog).not.toHaveBeenCalled();
  });
});
