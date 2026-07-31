// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the shared unit so this responsibility stays isolated, testable, and easy to evolve.
 */

const API_BASE = '/api/v1';

/** Helper for the requested value. */
function endpoint(path: string): string {
  if (path.startsWith('/')) return `${API_BASE}${path}`;
  return `${API_BASE}/${path}`;
}

/** Build a project-scoped API path. */
export function projectEndpoint(projectName: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!projectName) return normalizedPath;
  const encodedProject = encodeURIComponent(projectName);
  return `/projects/${encodedProject}${normalizedPath}`;
}

/** Read error message. */
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const detail = data.detail ?? data.message ?? data.error;
    if (typeof detail === 'string') return detail;
    if (detail !== undefined) return JSON.stringify(detail);
    return fallback;
  } catch {
    return fallback;
  }
}

/** Fetch json. */
export async function fetchJson<T>(
  path: string,
  init: RequestInit | undefined,
  fallbackError: string
): Promise<T> {
  const response = await fetch(endpoint(path), init);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackError));
  }
  return response.json() as Promise<T>;
}

/**
 * Perform a DELETE request.
 *
 * When T is void (or the server returns 204 / empty body) the response body
 * is intentionally not parsed.  When the server returns a JSON body the
 * caller must supply an explicit type parameter (e.g. `deleteJson<{ok:boolean}>`).
 */
export async function deleteJson<T = void>(
  path: string,
  fallbackError: string
): Promise<T> {
  const response = await fetch(endpoint(path), { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackError));
  }
  // 204 No Content (and any other empty body): return undefined cast to T.
  // Callers that pass a non-void T must only do so when the server actually
  // sends a JSON body on success.
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as unknown as T;
  }
  const text = await response.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

/** Fetch blob. */
export async function fetchBlob(
  path: string,
  init: RequestInit | undefined,
  fallbackError: string
): Promise<Blob> {
  const response = await fetch(endpoint(path), init);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackError));
  }
  return response.blob();
}

/** Send json. */
export async function postJson<T>(
  path: string,
  body: unknown,
  fallbackError: string
): Promise<T> {
  return fetchJson<T>(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    fallbackError
  );
}

/** Send json. */
export async function putJson<T>(
  path: string,
  body: unknown,
  fallbackError: string
): Promise<T> {
  return fetchJson<T>(
    path,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    fallbackError
  );
}

/** Send json via PATCH. */
export async function patchJson<T>(
  path: string,
  body: unknown,
  fallbackError: string
): Promise<T> {
  return fetchJson<T>(
    path,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    fallbackError
  );
}
