// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Builds explicit `MetadataParams` literals from `Chapter` / `Book` domain
 * objects so the metadata dialog only ever receives (and returns) metadata
 * fields.
 *
 * Passing the raw entity into the dialog leaks entity fields (`content`,
 * `chapters`) into the dialog's local state and therefore into the save
 * payload. `chaptersStructuralEqual` intentionally leaves `content` empty on
 * sidebar copies, so an empty `content` was spread back into the chapter and
 * wiped its prose whenever the user edited chapter metadata (issue #264).
 */

import type { Chapter, Book } from '../../types';
import type { MetadataParams } from '../story/metadataSync';

/** Extract only the metadata-editable fields from a `Chapter`. */
export function toChapterMetadataParams(chapter: Chapter): MetadataParams {
  return {
    title: chapter.title,
    summary: chapter.summary,
    notes: chapter.notes,
    private_notes: chapter.private_notes,
    conflicts: chapter.conflicts,
  };
}

/** Extract only the metadata-editable fields from a `Book`. */
export function toBookMetadataParams(book: Book): MetadataParams {
  return {
    title: book.title,
    summary: book.summary,
    notes: book.notes,
    private_notes: book.private_notes,
  };
}
