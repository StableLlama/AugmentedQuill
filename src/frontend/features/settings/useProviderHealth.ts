// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the use provider health unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { useCallback, useEffect, useRef, useState, startTransition } from 'react';
import {
  AppSettings,
  ConnectionStatus,
  ProviderCapabilities,
  LLMConfig,
} from '../../types';
import { api } from '../../services/api';

/**
 * Construct a stable string key from provider connection fields.
 *
 * The value is used for grouping and caching; it must change only when
 * one of the inputs does.  Whitespace is trimmed to avoid accidental
 * duplicates.
 */
export function makeProviderKey(
  baseUrl: string,
  apiKey?: string,
  modelId?: string,
  apiKeyEnabled?: boolean
): string {
  const usesApiKey = apiKeyEnabled !== false;
  const b = (baseUrl || '').trim();
  const k = usesApiKey ? (apiKey || '').trim() : '';
  const m = (modelId || '').trim();
  return `${b}||${k}||${m}`;
}

/**
 * Group active providers by identical runtime configuration.
 *
 * Returns a map from key -> { ids, payload } where ``ids`` is the list of
 * provider identifiers sharing the same baseUrl/apiKey/modelId and ``payload``
 * is the body to send to ``machine.testModel``.  Empty or inactive providers
 * are skipped.
 */
export function groupProviders(
  providers: AppSettings['providers'],
  activeIds: Set<string>
): Record<
  string,
  {
    ids: string[];
    payload: {
      base_url: string;
      api_key?: string;
      timeout_s: number;
      model_id: string;
    };
  }
> {
  const groups: Record<
    string,
    {
      ids: string[];
      payload: {
        base_url: string;
        api_key?: string;
        timeout_s: number;
        model_id: string;
      };
    }
  > = {};
  providers.forEach((provider: import('../../types').LLMConfig): void => {
    if (!activeIds.has(provider.id)) return;
    const modelId = (provider.modelId || '').trim();
    if (!modelId) return;
    const apiKeyEnabled = provider.apiKeyEnabled !== false;
    const apiKey = apiKeyEnabled ? provider.apiKey : undefined;
    const key = makeProviderKey(provider.baseUrl || '', apiKey, modelId, apiKeyEnabled);
    if (!groups[key]) {
      groups[key] = {
        ids: [],
        payload: {
          base_url: provider.baseUrl,
          api_key: apiKey,
          timeout_s: Math.max(1, Math.round(provider.timeout || 10)),
          model_id: modelId,
        },
      };
    }
    groups[key].ids.push(provider.id);
  });
  return groups;
}

function getActiveProviderIds(appSettings: AppSettings): Set<string> {
  return new Set([
    appSettings.activeChatProviderId,
    appSettings.activeWritingProviderId,
    appSettings.activeEditingProviderId,
  ]);
}

function resolveProviderHealthGroup(
  appSettings: AppSettings,
  providerId: string
): {
  provider: LLMConfig;
  relatedProviderIds: string[];
  payload: {
    base_url: string;
    api_key?: string;
    timeout_s: number;
    model_id: string;
  };
} | null {
  const provider = appSettings.providers.find(
    (entry: LLMConfig): boolean => entry.id === providerId
  );
  if (!provider) return null;

  const modelId = (provider.modelId || '').trim();
  if (!modelId) return null;

  const activeIds = getActiveProviderIds(appSettings);
  const groupedProviders = groupProviders(appSettings.providers, activeIds);
  const apiKeyEnabled = provider.apiKeyEnabled !== false;
  const apiKey = apiKeyEnabled ? provider.apiKey : undefined;
  const key = makeProviderKey(provider.baseUrl || '', apiKey, modelId, apiKeyEnabled);

  return {
    provider,
    relatedProviderIds: groupedProviders[key]?.ids || [provider.id],
    payload: groupedProviders[key]?.payload || {
      base_url: provider.baseUrl,
      api_key: apiKey,
      timeout_s: Math.max(1, Math.round(provider.timeout || 10)),
      model_id: modelId,
    },
  };
}

async function runProviderChecks(
  appSettings: AppSettings,
  promiseCache: React.MutableRefObject<
    Record<
      string,
      Promise<{
        model_ok: boolean;
        capabilities?: ProviderCapabilities;
      }>
    >
  >,
  setModelConnectionStatus: React.Dispatch<
    React.SetStateAction<Record<string, ConnectionStatus>>
  >,
  setDetectedCapabilities: React.Dispatch<
    React.SetStateAction<Record<string, ProviderCapabilities>>
  >,
  markChecked: (providerIds: string[]) => void,
  isCancelled: () => boolean
): Promise<void> {
  const activeIds = getActiveProviderIds(appSettings);
  const providersToCheck = appSettings.providers.filter(
    (provider: LLMConfig): boolean => activeIds.has(provider.id)
  );
  const groups = groupProviders(appSettings.providers, activeIds);

  await Promise.all(
    Object.entries(groups).map(
      async ([key, { ids, payload }]: [
        string,
        {
          ids: string[];
          payload: {
            base_url: string;
            api_key?: string;
            timeout_s: number;
            model_id: string;
          };
        },
      ]): Promise<void> => {
        if (isCancelled()) return;

        startTransition((): void => {
          ids.forEach((pid: string): void => {
            setModelConnectionStatus(
              (
                prev: Record<string, ConnectionStatus>
              ): { [x: string]: ConnectionStatus } => ({
                ...prev,
                [pid]: 'loading',
              })
            );
          });
        });

        let promise = promiseCache.current[key];
        if (!promise) {
          promise = api.machine.testModel(payload);
          promiseCache.current[key] = promise;
        }

        try {
          const result = await promise;
          if (isCancelled()) return;

          const status: ConnectionStatus = result.model_ok ? 'success' : 'error';
          startTransition((): void => {
            ids.forEach((pid: string): void => {
              setModelConnectionStatus(
                (
                  prev: Record<string, ConnectionStatus>
                ): { [x: string]: ConnectionStatus } => ({
                  ...prev,
                  [pid]: status,
                })
              );
            });

            if (result.model_ok && result.capabilities) {
              ids.forEach((pid: string): void => {
                setDetectedCapabilities(
                  (
                    prev: Record<string, ProviderCapabilities>
                  ): { [x: string]: ProviderCapabilities } => ({
                    ...prev,
                    [pid]: result.capabilities!,
                  })
                );
              });
            }
          });
          markChecked(ids);
        } catch {
          if (isCancelled()) return;
          startTransition((): void => {
            ids.forEach((pid: string): void => {
              setModelConnectionStatus(
                (
                  prev: Record<string, ConnectionStatus>
                ): { [x: string]: ConnectionStatus } => ({
                  ...prev,
                  [pid]: 'error',
                })
              );
            });
          });
          markChecked(ids);
        }
      }
    )
  );

  startTransition((): void => {
    providersToCheck.forEach((provider: LLMConfig): void => {
      if (!provider.modelId?.trim()) {
        setModelConnectionStatus(
          (
            prev: Record<string, ConnectionStatus>
          ): { [x: string]: ConnectionStatus } => ({
            ...prev,
            [provider.id]: 'idle',
          })
        );
        markChecked([provider.id]);
      }
    });
  });
}

/** Custom React hook that manages provider health. */
export function useProviderHealth(appSettings: AppSettings): {
  modelConnectionStatus: Record<string, ConnectionStatus>;
  detectedCapabilities: Record<string, ProviderCapabilities>;
  refreshHealth: () => void;
  recheckUnavailableProviderIfStale: (
    providerId: string,
    minAgeMs?: number
  ) => Promise<void>;
} {
  const [modelConnectionStatus, setModelConnectionStatus] = useState<
    Record<string, ConnectionStatus>
  >({});
  const [detectedCapabilities, setDetectedCapabilities] = useState<
    Record<string, ProviderCapabilities>
  >({});

  // cache promises for unique baseUrl/apiKey/model combinations.  this
  // prevents duplicate network calls when several providers share the same
  // configuration.  useRef allows the cache to persist across renders.
  const promiseCache = useRef<
    Record<
      string,
      Promise<{
        model_ok: boolean;
        capabilities?: ProviderCapabilities;
      }>
    >
  >({});
  const lastCheckedAt = useRef<Record<string, number>>({});

  const setStatusForProviderIds = useCallback(
    (providerIds: string[], status: ConnectionStatus): void => {
      providerIds.forEach((providerId: string): void => {
        setModelConnectionStatus(
          (
            prev: Record<string, ConnectionStatus>
          ): { [x: string]: ConnectionStatus } => ({
            ...prev,
            [providerId]: status,
          })
        );
      });
    },
    []
  );

  const markChecked = useCallback((providerIds: string[]): void => {
    const now = Date.now();
    providerIds.forEach((providerId: string): void => {
      lastCheckedAt.current[providerId] = now;
    });
  }, []);

  const refreshHealth = (): void => {
    promiseCache.current = {};
  };

  const recheckUnavailableProviderIfStale = useCallback(
    async (providerId: string, minAgeMs: number = 5000): Promise<void> => {
      if (!providerId) return;

      const status = modelConnectionStatus[providerId] || 'idle';
      if (status !== 'error') return;

      const lastCheck = lastCheckedAt.current[providerId] || 0;
      if (Date.now() - lastCheck < minAgeMs) return;

      const resolved = resolveProviderHealthGroup(appSettings, providerId);
      if (!resolved) return;

      const { provider, relatedProviderIds, payload } = resolved;

      // Force a fresh network request for this provider key.
      const apiKeyEnabled = provider.apiKeyEnabled !== false;
      const apiKey = apiKeyEnabled ? provider.apiKey : undefined;
      const key = makeProviderKey(
        provider.baseUrl || '',
        apiKey,
        payload.model_id,
        apiKeyEnabled
      );
      delete promiseCache.current[key];
      setStatusForProviderIds(relatedProviderIds, 'loading');

      try {
        const result = await api.machine.testModel(payload);
        const nextStatus: ConnectionStatus = result.model_ok ? 'success' : 'error';
        setStatusForProviderIds(relatedProviderIds, nextStatus);

        if (result.model_ok && result.capabilities) {
          relatedProviderIds.forEach((id: string): void => {
            setDetectedCapabilities(
              (
                prev: Record<string, ProviderCapabilities>
              ): {
                [x: string]:
                  | ProviderCapabilities
                  | { is_multimodal: boolean; supports_function_calling: boolean };
              } => ({
                ...prev,
                [id]: result.capabilities!,
              })
            );
          });
        }
      } catch {
        setStatusForProviderIds(relatedProviderIds, 'error');
      } finally {
        markChecked(relatedProviderIds);
      }
    },
    [
      appSettings.activeChatProviderId,
      appSettings.activeEditingProviderId,
      appSettings.activeWritingProviderId,
      appSettings.providers,
      markChecked,
      modelConnectionStatus,
      setStatusForProviderIds,
    ]
  );

  useEffect((): (() => void) => {
    let cancelled = false;

    const timer = setTimeout((): void => {
      runProviderChecks(
        appSettings,
        promiseCache,
        setModelConnectionStatus,
        setDetectedCapabilities,
        markChecked,
        (): boolean => cancelled
      );
    }, 500);

    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    appSettings.providers,
    appSettings.activeChatProviderId,
    appSettings.activeEditingProviderId,
    appSettings.activeWritingProviderId,
    markChecked,
  ]);

  return {
    modelConnectionStatus,
    detectedCapabilities,
    refreshHealth,
    recheckUnavailableProviderIfStale,
  };
}
