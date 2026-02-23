// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the debug unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { DebugLogEntry } from '../apiTypes';
import { fetchJson } from './shared';

export const debugApi = {
  getLogs: async () => {
    return fetchJson<DebugLogEntry[]>(
      '/debug/llm_logs',
      undefined,
      'Failed to fetch debug logs'
    );
  },

  clearLogs: async () => {
    return fetchJson<{ status: string }>(
      '/debug/llm_logs',
      { method: 'DELETE' },
      'Failed to clear debug logs'
    );
  },
};
