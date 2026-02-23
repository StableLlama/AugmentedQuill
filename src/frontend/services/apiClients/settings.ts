// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the settings unit so this responsibility stays isolated, testable, and easy to evolve.
 */

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
