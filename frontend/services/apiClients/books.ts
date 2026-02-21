import { ListImagesResponse } from '../apiTypes';
import { fetchJson } from './shared';

export const booksApi = {
  create: async (title: string) => {
    return fetchJson<{ ok: boolean; book_id?: string; story?: unknown }>(
      '/books/create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: title }),
      },
      'Failed to create book'
    );
  },

  delete: async (id: string) => {
    return fetchJson<{ ok: boolean; story?: unknown }>(
      '/books/delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: id }),
      },
      'Failed to delete book'
    );
  },

  uploadImage: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetchJson<{ ok: boolean; filename: string; url: string }>(
      '/projects/images/upload',
      { method: 'POST', body: formData },
      'Failed to upload image'
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

  reorder: async (bookIds: string[]) => {
    return fetchJson<{ ok: boolean }>(
      '/books/reorder',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_ids: bookIds }),
      },
      'Failed to reorder books'
    );
  },

  updateBookMetadata: async (
    bookId: string,
    data: {
      title?: string;
      summary?: string;
      notes?: string;
      private_notes?: string;
    }
  ) => {
    return fetchJson<{ ok: boolean; detail?: string }>(
      `/books/${bookId}/metadata`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      'Failed to update book metadata'
    );
  },
};
