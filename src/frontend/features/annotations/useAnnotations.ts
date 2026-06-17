// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Hook for loading, caching and mutating annotations for the current
 * prose scope.  Consumers call `refresh()` after the chapter changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import type { Annotation } from '../../services/apiClients/annotations';
import { notifyError } from '../../services/errorNotifier';

export interface AnnotationState {
  annotations: Annotation[];
  isLoading: boolean;
  refresh: (params?: {
    scope_type?: string;
    chapter_id?: string | null;
    book_id?: string | null;
  }) => void;
  createAnnotation: (payload: {
    scope_type: string;
    chapter_id?: string | null;
    book_id?: string | null;
    start_offset: number;
    end_offset: number;
    comment: string;
  }) => Promise<Annotation | null>;
  updateAnnotation: (id: string, comment: string) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
}

export function useAnnotations(projectName: string): AnnotationState {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const paramsRef = useRef<{
    scope_type?: string;
    chapter_id?: string | null;
    book_id?: string | null;
  }>({});

  const refresh = useCallback(
    (params?: {
      scope_type?: string;
      chapter_id?: string | null;
      book_id?: string | null;
    }) => {
      if (params) {
        paramsRef.current = params;
      }
      if (!projectName) {
        setAnnotations([]);
        return;
      }
      setIsLoading(true);
      api.annotations
        .list(paramsRef.current)
        .then(setAnnotations)
        .catch((err: unknown) => notifyError('Load annotations', err))
        .finally(() => setIsLoading(false));
    },
    [projectName]
  );

  // Initial load when projectName becomes available.
  useEffect(() => {
    if (projectName) {
      refresh();
    }
  }, [projectName, refresh]);

  const createAnnotation = useCallback(
    async (payload: {
      scope_type: string;
      chapter_id?: string | null;
      book_id?: string | null;
      start_offset: number;
      end_offset: number;
      comment: string;
    }): Promise<Annotation | null> => {
      try {
        const created = await api.annotations.create(payload);
        setAnnotations((prev: Annotation[]): Annotation[] => [...prev, created]);
        return created;
      } catch (err) {
        notifyError('Create annotation', err);
        return null;
      }
    },
    []
  );

  const updateAnnotation = useCallback(async (id: string, comment: string) => {
    try {
      const updated = await api.annotations.update(id, comment);
      setAnnotations((prev: Annotation[]): Annotation[] =>
        prev.map((a: Annotation): Annotation => (a.id === id ? updated : a))
      );
    } catch (err) {
      notifyError('Update annotation', err);
    }
  }, []);

  const deleteAnnotation = useCallback(async (id: string) => {
    try {
      await api.annotations.remove(id);
      setAnnotations((prev: Annotation[]): Annotation[] =>
        prev.filter((a: Annotation): boolean => a.id !== id)
      );
    } catch (err) {
      notifyError('Delete annotation', err);
    }
  }, []);

  return {
    annotations,
    isLoading,
    refresh,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
  };
}
