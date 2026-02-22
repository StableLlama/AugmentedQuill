// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the shared unit so this responsibility stays isolated, testable, and easy to evolve.

const API_BASE = '/api/v1';

function endpoint(path: string): string {
  if (path.startsWith('/')) return `${API_BASE}${path}`;
  return `${API_BASE}/${path}`;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as {
      detail?: string;
      message?: string;
      error?: string;
    };
    return data.detail || data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

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
