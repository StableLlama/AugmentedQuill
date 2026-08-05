// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the settings provider state unit so machine-config sync and provider CRUD stay isolated.
 */

import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { MachineModelConfig, ModelPresetEntry } from '../../services/apiTypes';
import { AppSettings, DEFAULT_LLM_CONFIG, LLMConfig } from '../../types';
import { machineModelToProvider } from './providerAdapter';

interface UseSettingsDialogProviderStateParams {
  isOpen: boolean;
  settings: AppSettings;
}

const resolveProviderId = (
  providers: LLMConfig[],
  fallbackId: string,
  currentId: string | undefined,
  selectedId: string | undefined
): string => {
  if (
    currentId &&
    providers.some((provider: LLMConfig): boolean => provider.id === currentId)
  ) {
    return currentId;
  }
  if (
    selectedId &&
    providers.some((provider: LLMConfig): boolean => provider.id === selectedId)
  ) {
    return selectedId;
  }
  return fallbackId;
};

/** Custom React hook that manages settings dialog provider state. */
export function useSettingsDialogProviderState({
  isOpen,
  settings,
}: UseSettingsDialogProviderStateParams): {
  localSettings: AppSettings;
  setLocalSettings: import('react').Dispatch<
    import('react').SetStateAction<AppSettings>
  >;
  editingProviderId: string | null;
  setEditingProviderId: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  modelPresets: ModelPresetEntry[];
  addProvider: () => void;
  duplicateProvider: (id: string) => void;
  updateProvider: (id: string, updates: Partial<LLMConfig>) => void;
  removeProvider: (id: string) => void;
} {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [modelPresets, setModelPresets] = useState<ModelPresetEntry[]>([]);

  useEffect((): (() => void) | undefined => {
    if (!isOpen) return undefined;

    setLocalSettings(settings);
    setEditingProviderId(settings.activeChatProviderId);

    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const [machine, presetsResponse] = await Promise.all([
          api.machine.get(),
          api.machine.getPresets(),
        ]);
        const openai = machine?.openai || {};
        setModelPresets(
          Array.isArray(presetsResponse?.presets) ? presetsResponse.presets : []
        );

        const models = Array.isArray(openai?.models) ? openai.models : [];
        const selectedName = (openai?.selected || '') as string;
        const providers: LLMConfig[] = models
          .filter((model: MachineModelConfig): model is MachineModelConfig =>
            Boolean(model && typeof model === 'object')
          )
          .map((model: MachineModelConfig): LLMConfig =>
            machineModelToProvider(model, DEFAULT_LLM_CONFIG)
          );

        if (cancelled || providers.length === 0) return;

        const fallbackId =
          providers.find((provider: LLMConfig): boolean => provider.id === selectedName)
            ?.id || providers[0].id;

        setLocalSettings((prev: AppSettings) => {
          const selectedChat = openai.selected_chat ?? undefined;
          const selectedWriting = openai.selected_writing ?? undefined;
          const selectedEditing = openai.selected_editing ?? undefined;

          const nextChatId = resolveProviderId(
            providers,
            fallbackId,
            prev.activeChatProviderId,
            selectedChat ?? undefined
          );

          setEditingProviderId((currentEditId: string | null): string => {
            if (
              currentEditId &&
              providers.some(
                (provider: LLMConfig): boolean => provider.id === currentEditId
              )
            ) {
              return currentEditId;
            }
            return nextChatId;
          });

          return {
            ...prev,
            providers,
            activeChatProviderId: nextChatId,
            activeWritingProviderId: resolveProviderId(
              providers,
              fallbackId,
              prev.activeWritingProviderId,
              selectedWriting ?? undefined
            ),
            activeEditingProviderId: resolveProviderId(
              providers,
              fallbackId,
              prev.activeEditingProviderId,
              selectedEditing ?? undefined
            ),
          };
        });
      } catch (error) {
        console.error('Failed to load machine config', error);
      }
    })();

    return (): void => {
      cancelled = true;
    };
  }, [isOpen, settings]);

  const addProvider = (): void => {
    const newProvider: LLMConfig = {
      ...DEFAULT_LLM_CONFIG,
      id: Date.now().toString(),
      name: 'New Provider',
    };

    setLocalSettings((prev: AppSettings) => ({
      ...prev,
      providers: [...prev.providers, newProvider],
      activeChatProviderId: prev.activeChatProviderId || newProvider.id,
      activeWritingProviderId: prev.activeWritingProviderId || newProvider.id,
      activeEditingProviderId: prev.activeEditingProviderId || newProvider.id,
    }));
    setEditingProviderId(newProvider.id);
  };

  const duplicateProvider = (id: string): void => {
    setLocalSettings((prev: AppSettings): AppSettings => {
      const source = prev.providers.find(
        (provider: LLMConfig): boolean => provider.id === id
      );
      if (!source) return prev;

      const newProvider: LLMConfig = {
        ...source,
        id: Date.now().toString(),
        name: `${source.name} (Copy)`,
      };
      setEditingProviderId(newProvider.id);
      return {
        ...prev,
        providers: [...prev.providers, newProvider],
      };
    });
  };

  const updateProvider = (id: string, updates: Partial<LLMConfig>): void => {
    setLocalSettings((prev: AppSettings) => ({
      ...prev,
      providers: prev.providers.map((provider: LLMConfig): LLMConfig =>
        provider.id === id ? { ...provider, ...updates } : provider
      ),
    }));
  };

  const removeProvider = (id: string): void => {
    setLocalSettings((prev: AppSettings) => {
      const remainingProviders = prev.providers.filter(
        (provider: LLMConfig): boolean => provider.id !== id
      );
      const fallbackId = remainingProviders[0]?.id || '';

      return {
        ...prev,
        providers: remainingProviders,
        activeChatProviderId:
          prev.activeChatProviderId === id ? fallbackId : prev.activeChatProviderId,
        activeWritingProviderId:
          prev.activeWritingProviderId === id
            ? fallbackId
            : prev.activeWritingProviderId,
        activeEditingProviderId:
          prev.activeEditingProviderId === id
            ? fallbackId
            : prev.activeEditingProviderId,
      };
    });
    setEditingProviderId((current: string | null): string | null =>
      current === id ? null : current
    );
  };

  return {
    localSettings,
    setLocalSettings,
    editingProviderId,
    setEditingProviderId,
    modelPresets,
    addProvider,
    duplicateProvider,
    updateProvider,
    removeProvider,
  };
}
