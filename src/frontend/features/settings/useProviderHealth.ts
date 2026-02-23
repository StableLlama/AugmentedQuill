// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the use provider health unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { useEffect, useState } from 'react';
import { AppSettings } from '../../types';
import { api } from '../../services/api';

type ConnectionStatus = 'idle' | 'success' | 'error' | 'loading';
type ProviderCapabilities = {
  is_multimodal: boolean;
  supports_function_calling: boolean;
};

export function useProviderHealth(appSettings: AppSettings) {
  const [modelConnectionStatus, setModelConnectionStatus] = useState<
    Record<string, ConnectionStatus>
  >({});
  const [detectedCapabilities, setDetectedCapabilities] = useState<
    Record<string, ProviderCapabilities>
  >({});

  useEffect(() => {
    let cancelled = false;

    const checkProviders = async () => {
      const activeIds = new Set([
        appSettings.activeChatProviderId,
        appSettings.activeWritingProviderId,
        appSettings.activeEditingProviderId,
      ]);

      const providersToCheck = appSettings.providers.filter((provider) =>
        activeIds.has(provider.id)
      );

      for (const provider of providersToCheck) {
        if (cancelled) return;

        setModelConnectionStatus((prev) => ({ ...prev, [provider.id]: 'loading' }));

        try {
          const modelId = provider.modelId || '';
          if (!modelId) {
            setModelConnectionStatus((prev) => ({ ...prev, [provider.id]: 'idle' }));
            continue;
          }

          const result = await api.machine.testModel({
            base_url: provider.baseUrl,
            api_key: provider.apiKey,
            timeout_s: Math.round((provider.timeout || 10000) / 1000),
            model_id: modelId,
          });

          if (cancelled) return;

          if (result.model_ok && result.capabilities) {
            setDetectedCapabilities((prev) => ({
              ...prev,
              [provider.id]: result.capabilities,
            }));
          }

          setModelConnectionStatus((prev) => ({
            ...prev,
            [provider.id]: result.model_ok ? 'success' : 'error',
          }));
        } catch {
          if (cancelled) return;
          setModelConnectionStatus((prev) => ({ ...prev, [provider.id]: 'error' }));
        }
      }
    };

    checkProviders();

    return () => {
      cancelled = true;
    };
  }, [
    appSettings.providers,
    appSettings.activeChatProviderId,
    appSettings.activeEditingProviderId,
    appSettings.activeWritingProviderId,
  ]);

  return { modelConnectionStatus, detectedCapabilities };
}
