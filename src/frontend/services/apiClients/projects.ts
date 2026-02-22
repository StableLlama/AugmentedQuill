// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the projects unit so this responsibility stays isolated, testable, and easy to evolve.

import {
  ListImagesResponse,
  ProjectMutationResponse,
  ProjectsListResponse,
  ProjectSelectResponse,
} from '../apiTypes';
import { fetchBlob, fetchJson } from './shared';

export const projectsApi = {
  list: async () =>
    fetchJson<ProjectsListResponse>('/projects', undefined, 'Failed to list projects'),

  select: async (name: string) => {
    return fetchJson<ProjectSelectResponse>(
      '/projects/select',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      },
      'Failed to select project'
    );
  },

  create: async (name: string, type: 'short-story' | 'novel' | 'series') => {
    return fetchJson<ProjectMutationResponse>(
      '/projects/create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type }),
      },
      'Failed to create project'
    );
  },

  convert: async (new_type: string) => {
    return fetchJson<ProjectMutationResponse>(
      '/projects/convert',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_type }),
      },
      'Failed to convert project'
    );
  },

  delete: async (name: string) => {
    return fetchJson<ProjectMutationResponse>(
      '/projects/delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      },
      'Failed to delete project'
    );
  },

  export: async (name?: string) => {
    const path = name
      ? `/projects/export?name=${encodeURIComponent(name)}`
      : '/projects/export';
    return fetchBlob(path, undefined, 'Failed to export project');
  },

  updateConfig: async () => {
    return fetchJson<{ ok?: boolean; detail?: string }>(
      '/settings/update_story_config',
      { method: 'POST' },
      'Failed to update story config'
    );
  },

  import: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetchJson<ProjectMutationResponse>(
      '/projects/import',
      {
        method: 'POST',
        body: formData,
      },
      'Failed to import project'
    );
  },

  uploadImage: async (file: File, targetName?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    const path = targetName
      ? `/projects/images/upload?target_name=${encodeURIComponent(targetName)}`
      : '/projects/images/upload';
    return fetchJson<{ ok: boolean; filename: string; url: string }>(
      path,
      { method: 'POST', body: formData },
      'Failed to upload image'
    );
  },

  updateImage: async (filename: string, description?: string, title?: string) => {
    return fetchJson<{ ok: boolean }>(
      '/projects/images/update_description',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, description, title }),
      },
      'Failed to update image metadata'
    );
  },

  createImagePlaceholder: async (description: string, title?: string) => {
    return fetchJson<{ ok: boolean; filename: string }>(
      '/projects/images/create_placeholder',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, title }),
      },
      'Failed to create placeholder'
    );
  },

  listImages: async () => {
    return fetchJson<ListImagesResponse>(
      '/projects/images/list',
      undefined,
      'Failed to list images'
    );
  },

  deleteImage: async (filename: string) => {
    return fetchJson<{ ok: boolean }>(
      '/projects/images/delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      },
      'Failed to delete image'
    );
  },
};
