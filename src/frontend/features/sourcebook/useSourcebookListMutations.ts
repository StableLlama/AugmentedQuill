// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Encapsulate sourcebook CRUD mutation flows and undo/redo payload construction.
 */

import React, { useCallback } from 'react';
import { SourcebookEntry } from '../../types';
import { SourcebookUpsertPayload } from '../../services/apiTypes';
import {
  createSourcebookEntry,
  deleteSourcebookEntry,
  updateSourcebookEntry,
} from './sourcebookApi';
import {
  filterSourcebookEntries,
  resolveExternalSourcebookEntries,
  updateSourcebookEntryInList,
} from './sourcebookUtils';

type MutatedPayload = {
  label: string;
  onUndo?: () => Promise<void>;
  onRedo?: () => Promise<void>;
  entryId?: string;
  entryExistsInBaseline?: boolean;
  updatedEntry?: SourcebookEntry | null;
};

interface UseSourcebookListMutationsArgs {
  entries: SourcebookEntry[];
  selectedEntry: SourcebookEntry | null;
  setEntries: React.Dispatch<React.SetStateAction<SourcebookEntry[]>>;
  setSelectedEntry: React.Dispatch<React.SetStateAction<SourcebookEntry | null>>;
  externalEntries?: SourcebookEntry[];
  search: string;
  baselineEntries?: SourcebookEntry[];
  onMutated?: (entry: MutatedPayload) => Promise<void>;
  loadEntries: (query?: string) => Promise<void>;
}

/** Custom React hook that manages sourcebook list mutations. */
export function useSourcebookListMutations({
  entries,
  selectedEntry,
  setEntries,
  setSelectedEntry,
  externalEntries,
  search,
  baselineEntries,
  onMutated,
  loadEntries,
}: UseSourcebookListMutationsArgs): {
  handleCreate: (entry: SourcebookUpsertPayload) => Promise<void>;
  handleUpdate: (entry: SourcebookUpsertPayload) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
} {
  const syncEntries = useCallback(
    async (
      updater?: (previous: SourcebookEntry[]) => SourcebookEntry[]
    ): Promise<void> => {
      if (Array.isArray(externalEntries)) {
        if (search.trim()) {
          await loadEntries(search);
          return;
        }

        if (updater) {
          setEntries((prev: SourcebookEntry[]): SourcebookEntry[] =>
            filterSourcebookEntries(updater(prev), search)
          );
        } else {
          setEntries((prev: SourcebookEntry[]): SourcebookEntry[] => {
            const resolved = resolveExternalSourcebookEntries(externalEntries, prev);
            return filterSourcebookEntries(resolved, search);
          });
        }
        return;
      }

      await loadEntries();
    },
    [externalEntries, search, loadEntries, setEntries]
  );

  const handleCreate = useCallback(
    async (entry: SourcebookUpsertPayload): Promise<void> => {
      const created = await createSourcebookEntry(entry);
      await syncEntries((prev: SourcebookEntry[]): SourcebookEntry[] => [
        ...prev,
        created,
      ]);
      let createdId = created.id;
      await onMutated?.({
        label: `Create sourcebook entry: ${entry.name}`,
        onUndo: async (): Promise<void> => {
          await deleteSourcebookEntry(createdId);
          await loadEntries();
        },
        onRedo: async (): Promise<void> => {
          const recreated = await createSourcebookEntry(entry);
          createdId = recreated.id;
          await loadEntries();
        },
        entryId: created.id,
        entryExistsInBaseline: Boolean(
          baselineEntries?.some(
            (baselineEntry: SourcebookEntry): boolean => baselineEntry.id === created.id
          )
        ),
        updatedEntry: created,
      });
    },
    [baselineEntries, loadEntries, onMutated, syncEntries]
  );

  const handleUpdate = useCallback(
    async (entry: SourcebookUpsertPayload): Promise<void> => {
      if (!entry.id) {
        return;
      }

      const previous = entries.find(
        (value: SourcebookEntry): boolean => value.id === entry.id
      );
      const previousId = entry.id;
      const updated = await updateSourcebookEntry(entry.id, entry);
      await syncEntries((prev: SourcebookEntry[]): SourcebookEntry[] =>
        updateSourcebookEntryInList(prev, previousId, updated)
      );

      if (selectedEntry?.id === previousId) {
        setSelectedEntry(updated);
      }
      if (!previous) {
        return;
      }

      const entryExistsInBaseline = Boolean(
        baselineEntries?.some(
          (baselineEntry: SourcebookEntry): boolean => baselineEntry.id === entry.id
        )
      );
      let activeId = updated.id;
      await onMutated?.({
        label: `Update sourcebook entry: ${entry.name}`,
        onUndo: async (): Promise<void> => {
          const reverted = await updateSourcebookEntry(activeId, {
            name: previous.name,
            synonyms: previous.synonyms,
            category: previous.category,
            description: previous.description,
            images: previous.images,
            relations: (previous.relations ??
              []) as SourcebookUpsertPayload['relations'],
            origin_date: previous.origin_date ?? undefined,
            destination_datetime: previous.destination_datetime ?? undefined,
            destination_relative: previous.destination_relative ?? undefined,
            creates_new_timeline: previous.creates_new_timeline ?? false,
          });
          activeId = reverted.id;
          await loadEntries();
        },
        onRedo: async (): Promise<void> => {
          const redone = await updateSourcebookEntry(activeId, {
            name: entry.name,
            synonyms: entry.synonyms,
            category: entry.category,
            description: entry.description,
            images: entry.images,
            relations: entry.relations ?? [],
            origin_date: entry.origin_date ?? undefined,
            destination_datetime: entry.destination_datetime ?? undefined,
            destination_relative: entry.destination_relative ?? undefined,
            creates_new_timeline: entry.creates_new_timeline ?? false,
          });
          activeId = redone.id;
          await loadEntries();
        },
        entryId: entry.id,
        entryExistsInBaseline,
        updatedEntry: updated,
      });
    },
    [
      baselineEntries,
      entries,
      loadEntries,
      onMutated,
      selectedEntry?.id,
      setSelectedEntry,
      syncEntries,
    ]
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      const deletedEntry = entries.find(
        (entry: SourcebookEntry): boolean => entry.id === id
      );
      await deleteSourcebookEntry(id);
      await syncEntries((prev: SourcebookEntry[]): SourcebookEntry[] =>
        prev.filter((entry: SourcebookEntry): boolean => entry.id !== id)
      );
      if (!deletedEntry) {
        return;
      }

      const entryExistsInBaseline = Boolean(
        baselineEntries?.some(
          (baselineEntry: SourcebookEntry): boolean =>
            baselineEntry.id === deletedEntry.id
        )
      );
      let activeId = deletedEntry.id;
      await onMutated?.({
        label: `Delete sourcebook entry: ${deletedEntry.name}`,
        onUndo: async (): Promise<void> => {
          const restored = await createSourcebookEntry({
            id: deletedEntry.id,
            name: deletedEntry.name,
            synonyms: deletedEntry.synonyms,
            category: deletedEntry.category,
            description: deletedEntry.description,
            images: deletedEntry.images,
            relations: (deletedEntry.relations ??
              []) as SourcebookUpsertPayload['relations'],
            creates_new_timeline: deletedEntry.creates_new_timeline ?? false,
          });
          activeId = restored.id;
          await loadEntries();
        },
        onRedo: async (): Promise<void> => {
          await deleteSourcebookEntry(activeId);
          await loadEntries();
        },
        entryId: deletedEntry.id,
        entryExistsInBaseline,
        updatedEntry: null,
      });
    },
    [baselineEntries, entries, loadEntries, onMutated, syncEntries]
  );

  return {
    handleCreate,
    handleUpdate,
    handleDelete,
  };
}
