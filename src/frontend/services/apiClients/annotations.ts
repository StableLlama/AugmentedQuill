// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: HTTP client for the annotations endpoints.
 */

import { fetchJson, postJson, putJson, deleteJson, projectEndpoint } from './shared';

export interface Annotation {
  id: string;
  comment: string;
  scope_type: 'story' | 'chapter' | 'unlinked';
  chapter_id?: string | null;
  book_id?: string | null;
  start_offset?: number | null;
  end_offset?: number | null;
}

export interface CreateAnnotationPayload {
  scope_type: string;
  chapter_id?: string | null;
  book_id?: string | null;
  start_offset: number;
  end_offset: number;
  comment: string;
}

export interface AnnotationsApi {
  list: (params?: {
    scope_type?: string;
    chapter_id?: string | null;
    book_id?: string | null;
  }) => Promise<Annotation[]>;
  create: (payload: CreateAnnotationPayload) => Promise<Annotation>;
  update: (id: string, comment: string) => Promise<Annotation>;
  remove: (id: string) => Promise<void>;
}

export const createAnnotationsApi = (projectName: string): AnnotationsApi => ({
  list: async (params?: {
    scope_type?: string;
    chapter_id?: string | null;
    book_id?: string | null;
  }) => {
    if (params && (params.scope_type || params.chapter_id || params.book_id)) {
      const qs = new URLSearchParams();
      if (params.scope_type) qs.set('scope_type', params.scope_type);
      if (params.chapter_id) qs.set('chapter_id', params.chapter_id);
      if (params.book_id) qs.set('book_id', params.book_id);
      return fetchJson<Annotation[]>(
        projectEndpoint(projectName, `/annotations/scope?${qs.toString()}`),
        undefined,
        'Failed to list annotations'
      );
    }
    return fetchJson<Annotation[]>(
      projectEndpoint(projectName, '/annotations'),
      undefined,
      'Failed to list annotations'
    );
  },

  create: (payload: CreateAnnotationPayload) =>
    postJson<Annotation>(
      projectEndpoint(projectName, '/annotations'),
      payload,
      'Failed to create annotation'
    ),

  update: (id: string, comment: string) =>
    putJson<Annotation>(
      projectEndpoint(projectName, `/annotations/${encodeURIComponent(id)}`),
      { comment },
      'Failed to update annotation'
    ),

  remove: (id: string) =>
    deleteJson<void>(
      projectEndpoint(projectName, `/annotations/${encodeURIComponent(id)}`),
      'Failed to delete annotation'
    ),
});
