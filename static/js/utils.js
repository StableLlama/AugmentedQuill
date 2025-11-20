// AugmentedQuill frontend script bundle
// - Shared utilities

/**
 * Fetch helper with consistent error handling
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
