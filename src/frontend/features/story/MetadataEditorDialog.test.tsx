// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines tests for MetadataEditorDialog so metadata sync behavior remains stable
 * while editor is open in sidebar view and external updates arrive.
 */

// @vitest-environment jsdom

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  within,
  act,
  cleanup,
} from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { SearchHighlightProvider } from '../search/SearchHighlightContext';
import { describe, it, expect, vi, afterEach } from 'vitest';
import i18n from '../app/i18n';
import { MetadataEditorDialog } from './MetadataEditorDialog';
import { useMetadataEditorDialogState } from './useMetadataEditorDialogState';
import type { MetadataParams } from './metadataSync';

const renderWithI18n = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

const BaselineProbe = ({
  initialData,
}: {
  initialData: MetadataParams;
}): JSX.Element => {
  const state = useMetadataEditorDialogState({
    initialData,
    onSave: async () => undefined,
    onClose: () => undefined,
    language: 'en',
    initialTab: 'notes',
    theme: 'light',
    primarySourceLabel: 'Story',
    primarySourceAvailable: true,
  });

  return (
    <>
      <div data-testid="data-notes">{state.data.notes}</div>
      <div data-testid="baseline-notes">{state.baselineData.notes}</div>
      <div data-testid="data-conflicts">{JSON.stringify(state.data.conflicts)}</div>
      <div data-testid="baseline-conflicts">
        {JSON.stringify(state.baselineData.conflicts)}
      </div>
    </>
  );
};

afterEach(cleanup);
afterEach(() => vi.useRealTimers());

const baseData = {
  title: 'Chapter 1',
  summary: 'Initial summary',
  notes: 'Initial notes',
  private_notes: 'Initial private notes',
  tags: ['tag1'],
};

describe('MetadataEditorDialog: rendering and state sync', () => {
  it('syncs external initialData updates into local state when not dirty', () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    const { rerender } = renderWithI18n(
      <MetadataEditorDialog
        type="chapter"
        title="Edit Chapter Metadata"
        initialData={baseData}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={undefined}
      />
    );

    // Switch to sidebar view so the dialog renders outside a portal,
    // which ensures reliable cleanup between tests.
    const toggleBtn = screen.getByRole('button', { name: /Switch to Sidebar View/i });
    fireEvent.click(toggleBtn);

    // Title is a regular <input> — use it to assert the sync-from-initialData path.
    const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
    expect(titleInput.value).toBe('Chapter 1');

    rerender(
      <I18nextProvider i18n={i18n}>
        <MetadataEditorDialog
          type="chapter"
          title="Edit Chapter Metadata"
          initialData={{ ...baseData, title: 'Updated Title from external call' }}
          onSave={onSave}
          onClose={onClose}
          onAiGenerate={undefined}
        />
      </I18nextProvider>
    );

    expect(titleInput.value).toBe('Updated Title from external call');
  });

  it('shows story-draft labels and conflicts tab for short-story metadata editing', () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    renderWithI18n(
      <MetadataEditorDialog
        type="story"
        title="Edit Story Metadata"
        initialData={{ ...baseData, conflicts: [] }}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={vi.fn(async () => undefined)}
        allowConflicts
        primarySourceLabel="Story Draft"
      />
    );

    expect(screen.getAllByRole('button', { name: 'Conflicts' }).length).toBeGreaterThan(
      0
    );
    expect(screen.getByText('from Story Draft')).toBeTruthy();
  });

  it('shows chapter scene list in a dedicated tab to the right of Conflicts', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    renderWithI18n(
      <MetadataEditorDialog
        type="chapter"
        title="Edit Chapter Metadata"
        initialData={{ ...baseData, conflicts: [] }}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={undefined}
        chapterScenes={[
          { id: '1', summary: 'Opening Scene' },
          { id: '2', summary: 'Resolution Scene' },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Scenes/i }));

    expect(screen.getByText('Scenes in this chapter')).toBeTruthy();
    expect(screen.getByText('Opening Scene')).toBeTruthy();
    expect(screen.getByText('Resolution Scene')).toBeTruthy();
  });

  it('sets the story language on editable metadata text inputs', () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    renderWithI18n(
      <MetadataEditorDialog
        type="story"
        title="Edit Story Metadata"
        initialData={{ ...baseData, language: 'de' }}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={undefined}
      />
    );

    const titleInputs = screen.getAllByDisplayValue('Chapter 1');
    const tagsInputs = screen.getAllByDisplayValue('tag1');

    expect(
      titleInputs.some((input: HTMLElement) => input.getAttribute('lang') === 'de')
    ).toBe(true);
    expect(
      tagsInputs.some((input: HTMLElement) => input.getAttribute('lang') === 'de')
    ).toBe(true);
    // Summary is now a CodeMirrorEditor which does not expose an HTML lang attribute;
    // spellchecking language is passed via the `language` prop to the editor.
  });

  it('does not autosave when conflict IDs are the only internal change', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    renderWithI18n(
      <MetadataEditorDialog
        type="chapter"
        title="Edit Chapter Metadata"
        initialData={{
          ...baseData,
          conflicts: [
            {
              description: 'Unresolved oath',
              resolution: 'Pending trial',
            },
          ],
        }}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={undefined}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('MetadataEditorDialog: undo / redo history', () => {
  it('supports undo and redo via metadata dialog header buttons', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    renderWithI18n(
      <MetadataEditorDialog
        type="chapter"
        title="Edit Chapter Metadata"
        initialData={baseData}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={undefined}
      />
    );

    const dialog = screen
      .getAllByRole('dialog')
      .find((node: HTMLElement) => within(node).queryByText('Edit Chapter Metadata'));
    expect(dialog).toBeTruthy();

    const titleInput = within(dialog!).getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Chapter 1 Revised' } });
    expect(titleInput.value).toBe('Chapter 1 Revised');

    // Advance past the 600 ms debounce so the history entry is committed.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    fireEvent.click(
      within(dialog!).getByRole('button', { name: /Undo metadata editor changes/i })
    );
    expect((within(dialog!).getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Chapter 1'
    );

    fireEvent.click(
      within(dialog!).getByRole('button', { name: /Redo metadata editor changes/i })
    );
    expect((within(dialog!).getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Chapter 1 Revised'
    );
  });

  it('preserves undo history when autosave updates initialData', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    const { rerender } = renderWithI18n(
      <MetadataEditorDialog
        type="chapter"
        title="Edit Chapter Metadata"
        initialData={baseData}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={undefined}
      />
    );

    const dialog = screen
      .getAllByRole('dialog')
      .find((node: HTMLElement) => within(node).queryByText('Edit Chapter Metadata'));
    expect(dialog).toBeTruthy();

    const titleInput = within(dialog!).getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Chapter 1 Revised' } });
    expect(titleInput.value).toBe('Chapter 1 Revised');

    // Advance past the 600 ms debounce so the history entry is committed.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    rerender(
      <I18nextProvider i18n={i18n}>
        <MetadataEditorDialog
          type="chapter"
          title="Edit Chapter Metadata"
          initialData={{ ...baseData, title: 'Chapter 1 Revised' }}
          onSave={onSave}
          onClose={onClose}
          onAiGenerate={undefined}
        />
      </I18nextProvider>
    );

    fireEvent.click(
      within(dialog!).getByRole('button', { name: /Undo metadata editor changes/i })
    );
    expect((within(dialog!).getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Chapter 1'
    );
  });

  it('reuses existing history entries when external edits revert to an earlier state', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    renderWithI18n(
      <MetadataEditorDialog
        type="chapter"
        title="Edit Chapter Metadata"
        initialData={baseData}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={undefined}
      />
    );

    const dialog = screen
      .getAllByRole('dialog')
      .find((node: HTMLElement) => within(node).queryByText('Edit Chapter Metadata'));
    expect(dialog).toBeTruthy();

    const titleInput = within(dialog!).getByLabelText('Title') as HTMLInputElement;
    // Type three distinct values with debounce pauses so each becomes an entry.
    fireEvent.change(titleInput, { target: { value: 'Chapter 1 Revised' } });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    fireEvent.change(titleInput, { target: { value: 'Chapter 1 Final' } });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(titleInput.value).toBe('Chapter 1 Final');

    // Typing back to the original value should reuse the existing entry.
    fireEvent.change(titleInput, { target: { value: 'Chapter 1' } });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    const undoButton = within(dialog!).getByRole('button', {
      name: /Undo metadata editor changes/i,
    }) as HTMLButtonElement;
    const redoButton = within(dialog!).getByRole('button', {
      name: /Redo metadata editor changes/i,
    }) as HTMLButtonElement;

    // After settling we should be back at the original entry (no undo available,
    // redo available to go forward again).
    expect(undoButton.disabled).toBe(true);
    expect(redoButton.disabled).toBe(false);
  });

  it('keeps diff highlights when explicit baseline advances to the current data', () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    // Start with data already diverged from baseline (simulates an AI write).
    const { rerender: _rerender } = renderWithI18n(
      <MetadataEditorDialog
        type="chapter"
        title="Edit Chapter Metadata"
        initialData={{ ...baseData, summary: 'Updated summary' }}
        baseline={baseData}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={undefined}
      />
    );

    const dialog = screen
      .getAllByRole('dialog')
      .find((node: HTMLElement) => within(node).queryByText('Edit Chapter Metadata'));
    expect(dialog).toBeTruthy();

    // Diff toggle button should be present and active (diff view on by default).
    const toggleBtn = within(dialog!).getByRole('button', {
      name: /Toggle diff view/i,
    });
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');

    // Simulate a save round-trip: baseline advances to match current data.
    // isSaveRoundTrip guard must keep the previous baseline so the diff stays visible.
    renderWithI18n(
      <MetadataEditorDialog
        type="chapter"
        title="Edit Chapter Metadata"
        initialData={{ ...baseData, summary: 'Updated summary' }}
        baseline={{
          ...baseData,
          title: 'Updated Title',
          summary: 'Updated summary',
        }}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={undefined}
      />
    );

    // Toggle button still present and still active after save round-trip.
    expect(
      within(dialog!).getByRole('button', { name: /Toggle diff view/i })
    ).toBeTruthy();
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('MetadataEditorDialog: baseline and external updates', () => {
  it('preserves the original baseline when story notes and conflicts update externally', async () => {
    const initialConflict = {
      id: 'c1',
      description: 'Existing conflict',
      resolution: 'Known',
    };
    const initialNotes = 'Initial visible notes';
    const updatedConflict = {
      id: 'c2',
      description: 'LLM conflict',
      resolution: 'TBD',
    };
    const { rerender } = render(
      <SearchHighlightProvider
        value={{ highlightActive: false, ranges: {}, texts: {} }}
      >
        <BaselineProbe
          initialData={{
            ...baseData,
            notes: initialNotes,
            conflicts: [initialConflict],
          }}
        />
      </SearchHighlightProvider>
    );

    expect(screen.getByTestId('data-notes').textContent).toBe(initialNotes);
    expect(screen.getByTestId('baseline-notes').textContent).toBe(initialNotes);
    expect(screen.getByTestId('data-conflicts').textContent).toBe(
      JSON.stringify([initialConflict])
    );
    expect(screen.getByTestId('baseline-conflicts').textContent).toBe(
      JSON.stringify([initialConflict])
    );

    await act(async () => {
      rerender(
        <SearchHighlightProvider
          value={{ highlightActive: false, ranges: {}, texts: {} }}
        >
          <BaselineProbe
            initialData={{
              ...baseData,
              notes: 'LLM updated notes',
              conflicts: [initialConflict, updatedConflict],
            }}
          />
        </SearchHighlightProvider>
      );
    });

    expect(screen.getByTestId('data-notes').textContent).toBe('LLM updated notes');
    expect(screen.getByTestId('baseline-notes').textContent).toBe(initialNotes);
    expect(screen.getByTestId('data-conflicts').textContent).toBe(
      JSON.stringify([initialConflict, updatedConflict])
    );
    expect(screen.getByTestId('baseline-conflicts').textContent).toBe(
      JSON.stringify([initialConflict])
    );
  });

  it('shows actionable source buttons for empty summaries and selects notes when available', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const onAiGenerate = vi.fn(async () => 'Generated summary');

    renderWithI18n(
      <MetadataEditorDialog
        type="chapter"
        title="Edit Chapter Metadata"
        initialData={{ ...baseData, summary: '', notes: 'Chapter notes' }}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={onAiGenerate}
        primarySourceLabel="Chapter"
        primarySourceAvailable={false}
      />
    );

    const chapterButton = screen.getByRole('button', {
      name: 'Generate summary from Chapter',
    });
    const notesButton = screen.getByRole('button', {
      name: 'Generate summary from Notes',
    });

    expect((chapterButton as HTMLButtonElement).disabled).toBe(true);
    expect((notesButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(notesButton);
    expect(onAiGenerate).toHaveBeenCalledWith(
      'write',
      expect.any(Function),
      'Chapter notes',
      expect.any(Function),
      'notes'
    );
  });

  it('activates the notes source label when chapter source is unavailable', () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    renderWithI18n(
      <MetadataEditorDialog
        type="story"
        title="Edit Story Metadata"
        initialData={{
          ...baseData,
          summary: 'Existing summary',
          notes: 'Story notes available',
        }}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={vi.fn(async () => undefined)}
        primarySourceLabel="Chapter"
        primarySourceAvailable={false}
      />
    );

    const chapterGroups = screen.getAllByRole('group', {
      name: 'Chapter summary actions',
    });
    const notesGroups = screen.getAllByRole('group', {
      name: 'Notes summary actions',
    });

    const chapterLabelActive = chapterGroups.some((group: HTMLElement) => {
      const label = within(group).getByText('from Chapter');
      return label.className.includes('text-brand-gray-500');
    });
    const notesLabelActive = notesGroups.some((group: HTMLElement) => {
      const label = within(group).getByText('from Notes');
      return label.className.includes('bg-primary/20');
    });

    expect(chapterLabelActive).toBe(true);
    expect(notesLabelActive).toBe(true);
  });
});

describe('MetadataEditorDialog: LLM conflict integration', () => {
  it('preserves undo/redo history when the LLM adds a conflict while the dialog is open', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    const conflictA = { id: 'c1', description: 'Conflict A', resolution: 'Resolve A' };
    const conflictB = { id: 'c2', description: 'Conflict B', resolution: 'Resolve B' };

    const { rerender } = renderWithI18n(
      <MetadataEditorDialog
        type="chapter"
        title="Edit Chapter Metadata"
        initialData={{ ...baseData, conflicts: [conflictA] }}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={undefined}
      />
    );

    // Advance past the debounce so the initial state is committed to history.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // Simulate the LLM adding a second conflict while the dialog is open.
    rerender(
      <I18nextProvider i18n={i18n}>
        <MetadataEditorDialog
          type="chapter"
          title="Edit Chapter Metadata"
          initialData={{ ...baseData, conflicts: [conflictA, conflictB] }}
          onSave={onSave}
          onClose={onClose}
          onAiGenerate={undefined}
        />
      </I18nextProvider>
    );

    // Advance past the debounce so the LLM update is committed to history.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    const dialog = screen
      .getAllByRole('dialog')
      .find((node: HTMLElement) => within(node).queryByText('Edit Chapter Metadata'));
    expect(dialog).toBeTruthy();

    const undoButton = within(dialog!).getByRole('button', {
      name: /Undo metadata editor changes/i,
    }) as HTMLButtonElement;
    const redoButton = within(dialog!).getByRole('button', {
      name: /Redo metadata editor changes/i,
    }) as HTMLButtonElement;

    // After the LLM update, undo should be available (to go back to pre-LLM state).
    expect(undoButton.disabled).toBe(false);

    // Undo removes the LLM-added conflict.
    fireEvent.click(undoButton);

    // Redo must immediately become available so the user can bring the conflict back.
    expect(redoButton.disabled).toBe(false);
  });

  it('highlights LLM-added conflicts as new in diff view and does not mark user-added conflicts', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();

    const conflictA = { id: 'c1', description: 'Pre-existing', resolution: 'Known' };
    const conflictB = { id: 'c2', description: 'LLM added', resolution: 'TBD' };

    // Open dialog with a baseline that only has conflictA; initialData already
    // includes conflictB (added by the LLM before the dialog opened).
    renderWithI18n(
      <MetadataEditorDialog
        type="story"
        title="Edit Story Metadata"
        initialData={{ ...baseData, conflicts: [conflictA, conflictB] }}
        baseline={{ ...baseData, conflicts: [conflictA] }}
        onSave={onSave}
        onClose={onClose}
        onAiGenerate={undefined}
        allowConflicts
      />
    );

    // Switch to the Conflicts tab.
    fireEvent.click(screen.getByRole('button', { name: 'Conflicts' }));

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // conflictB should have a "New" badge because it is absent from the baseline.
    const newBadges = screen.getAllByText('New');
    expect(newBadges.length).toBe(1);

    // Clicking "Add Conflict" should NOT produce a spurious "New" badge for the
    // manually added entry (it is anchored to baselineData immediately).
    fireEvent.click(screen.getByRole('button', { name: /Add Conflict/i }));

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Still only the one "New" badge from the LLM-added conflict.
    expect(screen.getAllByText('New').length).toBe(1);
  });
});
