// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the settings provider validation unit so connectivity and model checks stay isolated.
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { LLMConfig, ProviderCapabilities } from '../../types';

type ProviderStatus = 'idle' | 'success' | 'error' | 'loading';

interface UseSettingsDialogProviderValidationParams {
  isOpen: boolean;
  providers: LLMConfig[];
}

const toConnectionTestKey = (provider: LLMConfig): string => {
  const baseUrl = (provider.baseUrl || '').trim();
  const apiKey = provider.apiKeyEnabled ? (provider.apiKey || '').trim() : '';
  const timeoutS = Math.max(1, Math.round(provider.timeout || 10));
  return `${baseUrl}|${apiKey}|${timeoutS}|${provider.apiKeyEnabled ? 'enabled' : 'disabled'}`;
};

/** Custom React hook that manages settings dialog provider validation. */
export function useSettingsDialogProviderValidation({
  isOpen,
  providers,
}: UseSettingsDialogProviderValidationParams): {
  connectionStatus: Record<string, ProviderStatus>;
  modelStatus: Record<string, ProviderStatus>;
  modelLists: Record<string, string[]>;
  detectedCapabilities: Record<string, ProviderCapabilities>;
} {
  const [connectionStatus, setConnectionStatus] = useState<
    Record<string, ProviderStatus>
  >({});
  const [modelStatus, setModelStatus] = useState<Record<string, ProviderStatus>>({});
  const [modelLists, setModelLists] = useState<Record<string, string[]>>({});
  const [detectedCapabilities, setDetectedCapabilities] = useState<
    Record<string, ProviderCapabilities>
  >({});

  const lastConnTestKeyRef = useRef<Record<string, string>>({});
  const prevModelIdRef = useRef<Record<string, string | undefined>>({});
  const modelStatusRef = useRef<Record<string, ProviderStatus>>({});
  modelStatusRef.current = modelStatus;

  useEffect((): void => {
    if (!isOpen) return;
    setModelLists({});
    lastConnTestKeyRef.current = {};
    prevModelIdRef.current = {};
  }, [isOpen]);

  // Auto-test connectivity so model selectors can rely on known-good endpoints.
  useEffect((): (() => void) | undefined => {
    if (!isOpen) return undefined;

    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    providers.forEach((provider: LLMConfig): void => {
      const providerId = provider.id;
      const baseUrl = (provider.baseUrl || '').trim();
      const apiKey = provider.apiKeyEnabled
        ? (provider.apiKey || '').trim()
        : undefined;
      const timeoutS = Math.max(1, Math.round(provider.timeout || 10));
      const testKey = toConnectionTestKey(provider);

      if (!baseUrl || (provider.apiKeyEnabled && !apiKey)) {
        setConnectionStatus(
          (state: Record<string, ProviderStatus>): { [x: string]: ProviderStatus } => ({
            ...state,
            [providerId]: 'idle',
          })
        );
        setModelStatus(
          (state: Record<string, ProviderStatus>): { [x: string]: ProviderStatus } => ({
            ...state,
            [providerId]: 'idle',
          })
        );
        setModelLists(
          (prev: Record<string, string[]>): { [x: string]: string[] | never[] } => ({
            ...prev,
            [providerId]: [],
          })
        );
        return;
      }

      if (lastConnTestKeyRef.current[providerId] === testKey) {
        return;
      }

      const run = async (): Promise<void> => {
        if (cancelled) return;
        setConnectionStatus(
          (state: Record<string, ProviderStatus>): { [x: string]: ProviderStatus } => ({
            ...state,
            [providerId]: 'loading',
          })
        );
        try {
          const response = await api.machine.test({
            base_url: baseUrl,
            api_key: apiKey,
            timeout_s: timeoutS,
          });
          if (cancelled) return;

          lastConnTestKeyRef.current[providerId] = testKey;
          setConnectionStatus(
            (
              state: Record<string, ProviderStatus>
            ): { [x: string]: ProviderStatus } => ({
              ...state,
              [providerId]: response?.ok ? 'success' : 'error',
            })
          );
          setModelLists(
            (prev: Record<string, string[]>): { [x: string]: string[] } => ({
              ...prev,
              [providerId]: response?.ok ? response.models || [] : [],
            })
          );
        } catch (error) {
          if (cancelled) return;
          console.error('Failed to test machine config', error);
          lastConnTestKeyRef.current[providerId] = testKey;
          setConnectionStatus(
            (
              state: Record<string, ProviderStatus>
            ): { [x: string]: ProviderStatus } => ({
              ...state,
              [providerId]: 'error',
            })
          );
          setModelLists(
            (prev: Record<string, string[]>): { [x: string]: string[] | never[] } => ({
              ...prev,
              [providerId]: [],
            })
          );
        }
      };

      timeouts.push(setTimeout(run, 600));
    });

    return (): void => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
    };
  }, [isOpen, providers]);

  // Validate selected model IDs only after connectivity succeeds.
  useEffect((): (() => void) | undefined => {
    if (!isOpen) return undefined;

    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    providers.forEach((provider: LLMConfig): void => {
      const providerId = provider.id;
      const modelId = (provider.modelId || '').trim();
      const previousModelId = prevModelIdRef.current[providerId];

      if (
        previousModelId === modelId &&
        modelStatusRef.current[providerId] &&
        modelStatusRef.current[providerId] !== 'idle'
      ) {
        return;
      }

      if (!modelId) {
        prevModelIdRef.current[providerId] = modelId;
        setModelStatus(
          (state: Record<string, ProviderStatus>): { [x: string]: ProviderStatus } => ({
            ...state,
            [providerId]: 'idle',
          })
        );
        return;
      }

      if (connectionStatus[providerId] !== 'success') {
        return;
      }

      const baseUrl = (provider.baseUrl || '').trim();
      const apiKey = provider.apiKeyEnabled
        ? (provider.apiKey || '').trim()
        : undefined;
      const timeoutS = Math.max(1, Math.round(provider.timeout || 10));

      const run = async (): Promise<void> => {
        if (cancelled) return;
        setModelStatus(
          (state: Record<string, ProviderStatus>): { [x: string]: ProviderStatus } => ({
            ...state,
            [providerId]: 'loading',
          })
        );
        try {
          const response = await api.machine.testModel({
            base_url: baseUrl,
            api_key: apiKey,
            timeout_s: timeoutS,
            model_id: modelId,
          });
          if (cancelled) return;

          prevModelIdRef.current[providerId] = modelId;
          if (response?.capabilities) {
            setDetectedCapabilities(
              (
                prev: Record<string, ProviderCapabilities>
              ): {
                [x: string]:
                  | ProviderCapabilities
                  | { is_multimodal: boolean; supports_function_calling: boolean };
              } => ({
                ...prev,
                [providerId]: response.capabilities!,
              })
            );
          }
          setModelStatus(
            (
              state: Record<string, ProviderStatus>
            ): { [x: string]: ProviderStatus } => ({
              ...state,
              [providerId]: response?.ok && response?.model_ok ? 'success' : 'error',
            })
          );
        } catch (error) {
          if (cancelled) return;
          console.error('Failed to test model id', error);
          prevModelIdRef.current[providerId] = modelId;
          setModelStatus(
            (
              state: Record<string, ProviderStatus>
            ): { [x: string]: ProviderStatus } => ({
              ...state,
              [providerId]: 'error',
            })
          );
        }
      };

      timeouts.push(setTimeout(run, 500));
    });

    return (): void => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
    };
  }, [isOpen, providers, connectionStatus]);

  return {
    connectionStatus,
    modelStatus,
    modelLists,
    detectedCapabilities,
  };
}
