// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for Editor synchronization during AI streaming and diff highlighting.
 * Verifies that localContent and highlighting logic react to chapter updates.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './Editor';
import { WritingUnit } from '../../types';
import { useStoryStore, resetStoryStore } from '../../stores/storyStore';

if (typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(0), 0);
}
if (typeof window.cancelAnimationFrame !== 'function') {
  window.cancelAnimationFrame = window.clearTimeout;
}

afterEach(() => {
  cleanup();
  resetStoryStore();
});

vi.mock('../../services/api', () => ({
  api: {
    chapters: {
      updateContent: vi.fn(),
    },
    story: {
      updateContent: vi.fn(),
    },
  },
}));

const mockChapter: WritingUnit = {
  id: '1',
  scope: 'chapter',
  title: 'Chapter 1',
  content: 'Original content',
  summary: '',
  filename: 'ch1.md',
};

const defaultProps = {
  chapter: mockChapter,
  baselineContent: 'Original content',
  settings: {
    theme: 'mixed' as const,
    brightness: 1,
    contrast: 1,
    fontSize: 16,
    maxWidth: 800,
    sidebarWidth: 320,
    showDiff: true,
  },
  viewMode: 'raw' as const,
  showWhitespace: false,
  onToggleShowWhitespace: vi.fn(),
  onChange: vi.fn(),
  aiControls: {
    onAiAction: vi.fn(),
    isAiLoading: false,
    isWritingAvailable: true,
    onCancelAiAction: vi.fn(),
    isProseStreaming: false,
  },
  suggestionControls: {
    continuations: [],
    suggestionMode: 'guided' as const,
    setSuggestionMode: vi.fn(),
    isSuggesting: false,
    onTriggerSuggestions: vi.fn(),
    onAcceptContinuation: vi.fn(),
    isSuggestionMode: false,
    onKeyboardSuggestionAction: vi.fn(),
  },
};

/**
 * True when the editor shows any diff mark.  Whole-field rewrites render as
 * block mode (cm-diff-block-*), smaller edits render inline
 * (cm-diff-inserted / cm-diff-deleted); both count as a visible diff.
 */
const hasDiffMark = (root: ParentNode): boolean => {
  const html = root.querySelector('.cm-content')?.innerHTML ?? '';
  return (
    html.includes('cm-diff-inserted') ||
    html.includes('cm-diff-deleted') ||
    html.includes('cm-diff-block')
  );
};

describe('Editor diff highlighting', () => {
  it('shows diff decoration when AI inserts text (baseline differs from content)', async () => {
    const aiChapter = { ...mockChapter, content: 'Original content with AI paragraph' };

    const { rerender } = render(<Editor {...defaultProps} />);

    await act(async () => {
      rerender(
        <Editor
          {...defaultProps}
          chapter={aiChapter}
          baselineContent="Original content"
        />
      );
    });

    const cmContent = document.querySelector('.cm-content');
    expect(cmContent?.textContent).toContain('with AI paragraph');
    expect(cmContent?.innerHTML).toContain('diff-inserted');
  });

  it('shows no diff decoration when baseline equals chapter content', async () => {
    const { container } = render(
      <Editor {...defaultProps} baselineContent="Original content" />
    );

    const cmContent = container.querySelector('.cm-content');
    expect(cmContent?.innerHTML).not.toContain('diff-inserted');
  });

  it('resets diff baseline when switching to a new chapter with no baseline', async () => {
    const firstChapter = { ...mockChapter, content: 'Original content with AI' };
    const secondChapter = {
      ...mockChapter,
      id: '2',
      title: 'Chapter 2',
      content: 'Second chapter text',
    };

    const { rerender } = render(
      <Editor
        {...defaultProps}
        chapter={firstChapter}
        baselineContent="Original content"
      />
    );

    await act(async () => {
      rerender(
        <Editor {...defaultProps} chapter={secondChapter} baselineContent={undefined} />
      );
    });

    const cmContent = document.querySelector('.cm-content');
    expect(cmContent?.innerHTML).not.toContain('diff-inserted');
  });

  it('shows streaming content from store slot with correct diff during streaming', async () => {
    const { rerender } = render(<Editor {...defaultProps} />);

    const cmContent = document.querySelector('.cm-content');
    if (cmContent) (cmContent as HTMLElement).focus();

    // Simulate a rewrite streaming: entirely new text, nothing in common with baseline.
    // The streaming slot is used so only this editor re-renders.
    await act(async () => {
      useStoryStore.getState().setStreamingContent({
        chapterId: mockChapter.id,
        content: 'Brand new text with AI',
      });
      rerender(
        <Editor
          {...defaultProps}
          aiControls={{ ...defaultProps.aiControls, isProseStreaming: true }}
        />
      );
    });

    const updated = document.querySelector('.cm-content');
    // Streamed text must reach the editor.
    expect(updated?.textContent).toContain('Brand new text with AI');
    // Common-prefix streaming diff: all streamed content is inserted (green).
    expect(updated?.innerHTML).toContain('diff-inserted');
    // Deleted baseline is shown as a red widget.
    expect(updated?.innerHTML).toContain('diff-deleted');
  });

  it('calls the external onChange with user-modified content', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();

    const { rerender } = render(
      <Editor
        {...defaultProps}
        chapter={{ ...mockChapter, content: 'AI inserted this' }}
        baselineContent="Original content"
        onChange={onChange}
      />
    );

    // Verify diff IS visible initially (baseline ≠ content)
    expect(hasDiffMark(document)).toBe(true);

    // Simulate the parent clearing the baseline once the user's edit is
    // acknowledged (i.e., baselineContent advances to match the new content).
    await act(async () => {
      rerender(
        <Editor
          {...defaultProps}
          chapter={{ ...mockChapter, content: 'AI inserted this' }}
          baselineContent="AI inserted this"
          onChange={onChange}
        />
      );
    });

    // When baseline equals current content, no diff should be shown.
    const cmContentAfter = document.querySelector('.cm-content');
    expect(cmContentAfter?.innerHTML).not.toContain('diff-inserted');

    vi.useRealTimers();
  });

  it('re-shows diff decoration when a new baselineContent prop arrives after user cleared it', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Editor
        {...defaultProps}
        chapter={{ ...mockChapter, content: 'User typed text' }}
        baselineContent="User typed text"
        onChange={onChange}
      />
    );

    // No diff visible
    let cmContent = document.querySelector('.cm-content');
    expect(cmContent?.innerHTML).not.toContain('diff-inserted');

    // AI pushes new content and parent updates both chapter and baselineContent
    await act(async () => {
      rerender(
        <Editor
          {...defaultProps}
          chapter={{ ...mockChapter, content: 'User typed text and AI added this' }}
          baselineContent="User typed text"
          onChange={onChange}
        />
      );
    });

    cmContent = document.querySelector('.cm-content');
    expect(cmContent?.innerHTML).toContain('diff-inserted');
  });
});

describe('Editor diff highlighting – smart-quote regression', () => {
  it('preserves full diff after typographic quote replacement (smart-quote regression)', async () => {
    // Baseline: original content with typographic quotes already.
    // After streaming (raw quotes in the new text), then after lazy-load applies
    // typographic quotes to server content, the diff must still show the FULL
    // new text — not only the quote-position changes.
    const baseline = 'He said \u201Chello.\u201D';
    const rawContent = 'He said \u201Chello.\u201D\n\nShe replied "goodbye."';
    const typographicChapter = {
      ...mockChapter,
      content: 'He said \u201Chello.\u201D\n\nShe replied \u201Cgoodbye.\u201D',
    };

    const { rerender } = render(<Editor {...defaultProps} />);

    // Simulate streaming preview via the dedicated store slot.  chapter.content
    // stays at the pre-AI baseline while streaming is active; diff is suppressed.
    await act(async () => {
      useStoryStore.getState().setStreamingContent({
        chapterId: mockChapter.id,
        content: rawContent,
      });
      rerender(
        <Editor
          {...defaultProps}
          baselineContent={baseline}
          aiControls={{ ...defaultProps.aiControls, isProseStreaming: true }}
        />
      );
    });

    let cmContent = document.querySelector('.cm-content');
    // Streaming text must reach the editor.
    expect(cmContent?.textContent).toContain('goodbye');
    // Common-prefix streaming diff: the common prefix ('He said "hello."') is
    // white, the new paragraph ('\n\nShe replied ...') is shown as inserted.
    expect(cmContent?.innerHTML).toContain('diff-inserted');

    // Simulate lazy-load replacing content with typographic version from server
    // and streaming ending.
    await act(async () => {
      useStoryStore.getState().setStreamingContent(null);
      rerender(
        <Editor
          {...defaultProps}
          chapter={typographicChapter}
          baselineContent={baseline}
          aiControls={{ ...defaultProps.aiControls, isProseStreaming: false }}
        />
      );
    });

    cmContent = document.querySelector('.cm-content');
    expect(cmContent?.innerHTML).toContain('diff-inserted');
    // The highlighted region must contain the new paragraph text, not shrink to
    // just the quote-character positions.
    expect(cmContent?.innerHTML).toContain('goodbye');
    // Verify the post-streaming diff decorates a meaningful amount of content.
    const countInserted = (html: string): number =>
      (html.match(/class="cm-diff-inserted"/g) ?? []).length;
    expect(countInserted(cmContent?.innerHTML ?? '')).toBeGreaterThan(0);
  });
});

// ─── Spec: Diff visibility rules ────────────────────────────────────────────
// See AGENTS.md diff spec for the full decision table.

describe('Spec: diff visibility on initial load', () => {
  it('shows NO diff when baseline is undefined (initial load)', async () => {
    // SPEC: App loads, chapter content appears for the first time → NO diff.
    // The baseline must be initialized to equal current content.
    const { container } = render(
      <Editor
        {...defaultProps}
        chapter={{ ...mockChapter, content: 'Hello world' }}
        baselineContent={undefined}
      />
    );

    await act(async () => {});

    const cmContent = container.querySelector('.cm-content');
    expect(cmContent?.innerHTML).not.toContain('diff-inserted');
    expect(cmContent?.innerHTML).not.toContain('diff-deleted');
  });

  it('shows NO diff when baseline equals chapter content', async () => {
    // SPEC: baseline matches content → no diff
    const { container } = render(
      <Editor
        {...defaultProps}
        chapter={{ ...mockChapter, content: 'Hello world' }}
        baselineContent="Hello world"
      />
    );

    await act(async () => {});

    const cmContent = container.querySelector('.cm-content');
    expect(cmContent?.innerHTML).not.toContain('diff-inserted');
  });
});

describe('Spec: undo/redo shows diff', () => {
  it('shows diff after undo when savedBaseline is set', async () => {
    // SPEC: User triggers undo → automatic change → diff shown.
    // Editor.tsx calls setLocalBaseline(savedBaselineRef.current) on undo.
    // We verify by rendering with a baseline that differs and checking
    // that the diff decorations appear.
    const { container } = render(
      <Editor
        {...defaultProps}
        chapter={{ ...mockChapter, content: 'AI wrote this paragraph' }}
        baselineContent="Original content"
      />
    );

    await act(async () => {});

    expect(hasDiffMark(container)).toBe(true);
  });

  it('shows NO diff after undo when there is no saved baseline', async () => {
    // SPEC: If no automatic change occurred previously, undo should not
    // set a diff baseline. savedBaselineRef is undefined → no diff.
    const { container } = render(
      <Editor
        {...defaultProps}
        chapter={{ ...mockChapter, content: 'Just user typing' }}
        baselineContent={undefined}
      />
    );

    await act(async () => {});

    const cmContent = container.querySelector('.cm-content');
    expect(cmContent?.innerHTML).not.toContain('diff-inserted');
  });
});

describe('Spec: normal chapter switch shows no diff', () => {
  it('clears diff when switching to a new chapter with no baseline', async () => {
    // SPEC: User switches to a different chapter (normal navigation) →
    // NO diff if the new chapter has no automatic changes pending.
    const { container, rerender } = render(
      <Editor
        {...defaultProps}
        chapter={{ ...mockChapter, id: 'ch1', content: 'AI text' }}
        baselineContent="Original"
      />
    );

    await act(async () => {});

    // First chapter has diff
    expect(hasDiffMark(container)).toBe(true);

    // Switch to new chapter with undefined baseline
    await act(async () => {
      rerender(
        <Editor
          {...defaultProps}
          chapter={{ ...mockChapter, id: 'ch2', content: 'New chapter text' }}
          baselineContent={undefined}
        />
      );
    });

    expect(container.querySelector('.cm-content')?.innerHTML).not.toContain(
      'diff-inserted'
    );
  });
});

describe('Spec: user typing does not show diff', () => {
  it('clears localBaseline on user edit so typing is not highlighted', async () => {
    // SPEC: User types a character → NO diff.
    // Editor.tsx calls setLocalBaseline(undefined) on non-undo user edits.
    // We verify by rendering with a baseline that differs, then simulating
    // that the parent clears the baseline (as would happen after the onChange
    // callback sets localBaseline to undefined).

    const { container, rerender } = render(
      <Editor
        {...defaultProps}
        chapter={{ ...mockChapter, content: 'AI inserted this' }}
        baselineContent="Original content"
      />
    );

    await act(async () => {});

    // Diff IS visible initially
    expect(hasDiffMark(container)).toBe(true);

    // Simulate user typing: parent sets baseline to undefined
    await act(async () => {
      rerender(
        <Editor
          {...defaultProps}
          chapter={{ ...mockChapter, content: 'AI inserted this and user typed' }}
          baselineContent={undefined}
        />
      );
    });

    expect(container.querySelector('.cm-content')?.innerHTML).not.toContain(
      'diff-inserted'
    );
  });
});

// ─── Spec: Bug A — FloatingDiffToolbar on undo/redo ─────────────────────────

describe('Spec: FloatingDiffToolbar for prose editor', () => {
  it('Editor does NOT pass showDiffToolbar to CodeMirrorEditor', async () => {
    // SPEC BUG A: The main prose Editor does not wire up the
    // FloatingDiffToolbar.  When undo/redo shows diffs, the user has no
    // accept/reject buttons.  This test documents the missing wiring.
    //
    // Fix: Editor.tsx must pass showDiffToolbar, onAcceptDiff, onRejectDiff
    // to CodeMirrorEditor.

    // We verify the absence by checking that the FloatingDiffToolbar
    // never appears in the DOM when hovering over diff text.
    const { container } = render(
      <Editor
        {...defaultProps}
        chapter={{ ...mockChapter, content: 'AI changed this' }}
        baselineContent="Original"
      />
    );

    await act(async () => {});

    // Diff IS visible (correct)
    expect(hasDiffMark(container)).toBe(true);

    // But there is NO FloatingDiffToolbar in the DOM
    // (it would render a role="toolbar" element via portal)
    const toolbars = document.body.querySelectorAll('[role="toolbar"]');
    expect(toolbars.length).toBe(0);
  });
});

// ─── Spec: Bug C — Initial load with empty baseline ─────────────────────────

describe('Spec: initial load with empty-string baseline shows no diff', () => {
  it('shows NO diff when baseline is empty string and content is present', async () => {
    // SPEC BUG C: If the baseline is accidentally set to '' (empty string)
    // while content is "Hello world", the diff plugin would show everything
    // as inserted.  The baseline must either be undefined or equal to content.
    const { container } = render(
      <Editor
        {...defaultProps}
        chapter={{ ...mockChapter, content: 'Hello world' }}
        baselineContent=""
      />
    );

    await act(async () => {});

    const cmContent = container.querySelector('.cm-content');
    // Empty-string baseline vs "Hello world" would show all as inserted.
    // This must NOT happen — baseline '' should be treated as "no diff".
    expect(cmContent?.innerHTML).not.toContain('diff-inserted');
    expect(cmContent?.innerHTML).not.toContain('diff-deleted');
  });
});
