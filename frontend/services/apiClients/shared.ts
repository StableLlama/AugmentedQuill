const API_BASE = '/api';

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
