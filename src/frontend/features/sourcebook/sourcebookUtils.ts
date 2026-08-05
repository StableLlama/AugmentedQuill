// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Pure utility functions for sourcebook entry management.
 *
 * Extracted from SourcebookList to keep them independently testable and
 * reusable without importing the full component tree.
 */

import type { SourcebookEntry } from '../../types';

/**
 * Computes a canonical signature of user-editable fields for diff detection.
 * Auto-generated fields (e.g. keywords) are intentionally excluded so that
 * background refreshes do not register as content changes.
 */
export const entryDiffSignature = (e: SourcebookEntry): string =>
  JSON.stringify({
    name: e.name,
    description: e.description,
    category: e.category ?? '',
    synonyms: [...(e.synonyms ?? [])].sort(),
    images: [...(e.images ?? [])].sort(),
  });

/**
 * Returns `externalEntries` when it is a non-null array, otherwise falls back
 * to `currentEntries`. Used to merge externally injected entries with local state.
 */
export const resolveExternalSourcebookEntries = (
  externalEntries: SourcebookEntry[] | undefined,
  currentEntries: SourcebookEntry[]
): SourcebookEntry[] => {
  if (Array.isArray(externalEntries)) {
    return externalEntries;
  }
  return currentEntries;
};

/**
 * Returns a new list where the entry with `previousId` is replaced by `updated`.
 */
export const updateSourcebookEntryInList = (
  entries: SourcebookEntry[],
  previousId: string,
  updated: SourcebookEntry
): SourcebookEntry[] => {
  return entries.map((value: SourcebookEntry): SourcebookEntry =>
    value.id === previousId ? updated : value
  );
};

/**
 * Filters a sourcebook entry list by a free-text query.
 * Matches against name, synonyms, keywords, and description.
 * Multi-word queries require every token to appear in at least one field.
 */
export const filterSourcebookEntries = (
  entries: SourcebookEntry[],
  query: string
): SourcebookEntry[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return entries;
  }

  return entries.filter((entry: SourcebookEntry): boolean => {
    const description = (entry.description || '').toLowerCase();
    if (entry.name.toLowerCase().includes(normalizedQuery)) {
      return true;
    }
    if (
      (entry.synonyms || []).some((syn: string): boolean =>
        syn.toLowerCase().includes(normalizedQuery)
      )
    ) {
      return true;
    }
    if (
      (entry.keywords || []).some((kw: string): boolean =>
        kw.toLowerCase().includes(normalizedQuery)
      )
    ) {
      return true;
    }
    if (description.includes(normalizedQuery)) {
      return true;
    }

    // Fallback for natural multi-word queries: require every token to appear
    // in at least one searchable field.
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      return false;
    }

    const fields = [
      entry.name,
      ...(entry.synonyms || []),
      ...(entry.keywords || []),
      entry.description || '',
    ].map((value: string): string => value.toLowerCase());

    return tokens.every((token: string): boolean =>
      fields.some((field: string): boolean => field.includes(token))
    );
  });
};
