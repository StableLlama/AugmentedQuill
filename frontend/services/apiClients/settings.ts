import { fetchJson } from './shared';

export const settingsApi = {
  getPrompts: async (modelName?: string) => {
    const path = modelName
      ? `/prompts?model_name=${encodeURIComponent(modelName)}`
      : '/prompts';
    return fetchJson<{
      ok: boolean;
      system_messages: Record<string, string>;
      user_prompts: Record<string, string>;
    }>(path, undefined, 'Failed to fetch prompts');
  },
};
