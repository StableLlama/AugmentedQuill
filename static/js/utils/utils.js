// AugmentedQuill frontend script bundle
// Shared utilities for consistent API interactions and error handling.

/**
 * Fetch helper with consistent error handling
 * Standardizes API calls across the application, ensuring uniform error responses
 * and simplifying error handling in components.
 */
export async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`, {cause: data.detail || data.error});
  }
  return data;
}

/**
 * Safe JSON GET helper: returns {} on error
 * Prevents application crashes from network failures by providing fallback data,
 * allowing the UI to remain functional even when backend is unavailable.
 */
export async function getJSONOrEmpty(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return {};
    return await resp.json();
  } catch (_) {
    return {};
  }
}

// Lightweight API wrappers used across components
export const API = {
  loadStory: () => getJSONOrEmpty('/api/story'),
  loadProjects: () => getJSONOrEmpty('/api/projects'),
  loadChat: () => getJSONOrEmpty('/api/chat'),
};
