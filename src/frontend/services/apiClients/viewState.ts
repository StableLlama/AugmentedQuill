// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * HTTP client for per-project view state endpoints.
 * View state tracks transient UI state that survives reloads:
 * last open chapter, scroll position, workspace mode, scenes view type.
 */

import { fetchJson, putJson, projectEndpoint } from './shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViewStatePayload {
  current_chapter_id: string | null;
  scroll_position: number;
  workspace_mode: 'page' | 'scenes' | 'split';
  scenes_view_type: string;
}

export interface ViewStateResponse {
  ok: boolean;
  view_state?: ViewStatePayload | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createViewStateApi(projectName: string) {
  const base = () => projectEndpoint(projectName, '/view-state');

  return {
    /** Load the persisted view state for the project. */
    get: async (): Promise<ViewStateResponse> =>
      fetchJson<ViewStateResponse>(base(), undefined, 'Failed to load view state'),

    /** Persist view state for the project. */
    put: async (payload: ViewStatePayload): Promise<ViewStateResponse> =>
      putJson<ViewStateResponse>(base(), payload, 'Failed to save view state'),
  };
}
