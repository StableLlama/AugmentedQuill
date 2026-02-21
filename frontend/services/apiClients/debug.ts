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
