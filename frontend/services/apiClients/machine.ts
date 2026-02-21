import { MachineConfigResponse } from '../apiTypes';
import { fetchJson } from './shared';

export const machineApi = {
  get: async () => {
    return fetchJson<MachineConfigResponse>(
      '/machine',
      undefined,
      'Failed to load machine config'
    );
  },
  save: async (machine: MachineConfigResponse) => {
    return fetchJson<{ ok: boolean; detail?: string }>(
      '/machine',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(machine),
      },
      'Failed to save machine config'
    );
  },
  test: async (payload: { base_url: string; api_key?: string; timeout_s?: number }) => {
    return fetchJson<{ ok: boolean; models: string[]; detail?: string }>(
      '/machine/test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'Failed to test connection'
    );
  },
  testModel: async (payload: {
    base_url: string;
    api_key?: string;
    timeout_s?: number;
    model_id: string;
  }) => {
    return fetchJson<{
      ok: boolean;
      model_ok: boolean;
      models: string[];
      detail?: string;
      capabilities?: {
        is_multimodal: boolean;
        supports_function_calling: boolean;
      };
    }>(
      '/machine/test_model',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'Failed to test model'
    );
  },
};
