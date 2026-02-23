// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines app selectors so App component orchestration stays focused and testable.
 */

import { AppSettings, LLMConfig } from '../../types';

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function resolveActiveProviderConfigs(appSettings: AppSettings): {
  activeChatConfig: LLMConfig;
  activeWritingConfig: LLMConfig;
  activeEditingConfig: LLMConfig;
} {
  const fallback = appSettings.providers[0];
  return {
    activeChatConfig:
      appSettings.providers.find((p) => p.id === appSettings.activeChatProviderId) ||
      fallback,
    activeWritingConfig:
      appSettings.providers.find((p) => p.id === appSettings.activeWritingProviderId) ||
      fallback,
    activeEditingConfig:
      appSettings.providers.find((p) => p.id === appSettings.activeEditingProviderId) ||
      fallback,
  };
}
