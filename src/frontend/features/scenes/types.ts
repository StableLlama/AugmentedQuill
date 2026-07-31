// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Shared domain types for the Scenes feature (Pinboard view and prose linking).
 */

/** Payload carried in the 'application/aq-prose-selection' dataTransfer MIME type. */
export interface ProseDropData {
  scopeType: string;
  chapterId?: string;
  bookId?: string;
  startOffset: number;
  endOffset: number;
  text: string;
}
