// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines app defaults so top-level app orchestration stays smaller and easier to maintain.
 */

import { AppSettings, DEFAULT_LLM_CONFIG } from '../../types';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  providers: [DEFAULT_LLM_CONFIG],
  activeChatProviderId: DEFAULT_LLM_CONFIG.id,
  activeWritingProviderId: DEFAULT_LLM_CONFIG.id,
  activeEditingProviderId: DEFAULT_LLM_CONFIG.id,
  editor: {
    fontSize: 18,
    maxWidth: 60,
    brightness: 0.95,
    contrast: 0.9,
    theme: 'mixed',
    sidebarWidth: 320,
  },
  sidebarOpen: false,
  activeTab: 'chat',
};
