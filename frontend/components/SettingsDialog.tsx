// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  X,
  HardDrive,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Save,
} from 'lucide-react';
import { LLMConfig, ProjectMetadata, AppSettings, AppTheme } from '../types';
import { api } from '../services/api';
import { Button } from './Button';
import { SettingsProjects } from './settings/SettingsProjects';
import { SettingsMachine } from './settings/SettingsMachine';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  projects: ProjectMetadata[];
  activeProjectId: string;
  onLoadProject: (id: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
  onConvertProject: (newType: string) => void;
  onImportProject: (file: File) => Promise<void>;
  activeProjectType?: 'small' | 'medium' | 'large';
  activeProjectStats?: {
    chapterCount: number;
    bookCount: number;
  };
  theme: AppTheme;
  defaultPrompts?: {
    system_messages: Record<string, string>;
    user_prompts: Record<string, string>;
  };
}

const DEFAULT_CONFIG: LLMConfig = {
  id: 'default-openai',
  name: 'Default OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  timeout: 30000,
  modelId: 'gpt-4o',
  temperature: 0.7,
  topP: 0.95,
  prompts: {
    system: '',
    continuation: '',
    summary: '',
  },
};

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  projects,
  activeProjectId,
  onLoadProject,
  onCreateProject,
  onDeleteProject,
  onRenameProject,
  onConvertProject,
  onImportProject,
  activeProjectType,
  activeProjectStats = { chapterCount: 0, bookCount: 0 },
  theme,
  defaultPrompts = { system_messages: {}, user_prompts: {} },
}) => {
  const [activeTab, setActiveTab] = useState<'projects' | 'machine'>('projects');
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{
    [key: string]: 'idle' | 'success' | 'error' | 'loading';
  }>({});
  const [modelStatus, setModelStatus] = useState<{
    [key: string]: 'idle' | 'success' | 'error' | 'loading';
  }>({});
  const [modelLists, setModelLists] = useState<Record<string, string[]>>({});
  const [detectedCapabilities, setDetectedCapabilities] = useState<
    Record<string, { is_multimodal: boolean; supports_function_calling: boolean }>
  >({});
  const [saveError, setSaveError] = useState<string>('');
  const [saveLoading, setSaveLoading] = useState<boolean>(false);

  const lastConnTestKeyRef = useRef<Record<string, string>>({});
  const prevModelIdRef = useRef<Record<string, string | undefined>>({});

  const isLight = theme === 'light';

  // Reset local state when opening + load machine config from backend
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
      setEditingProviderId(settings.activeChatProviderId); // Default to editing current chat provider
      setSaveError('');
      setModelLists({});

      // Reset "already tested" caches so opening the dialog triggers one test.
      lastConnTestKeyRef.current = {};
      prevModelIdRef.current = {};

      let cancelled = false;
      (async () => {
        try {
          const machine = await api.machine.get();
          const openai = machine?.openai || {};
          const models = Array.isArray(openai?.models) ? openai.models : [];
          const selectedName = (openai?.selected || '') as string;

          const providers: LLMConfig[] = models
            .filter((m: any) => m && typeof m === 'object')
            .map((m: any) => {
              const name = String(m.name || '').trim() || 'Unnamed';
              const timeoutS = Number(m.timeout_s ?? 60);
              return {
                ...DEFAULT_CONFIG,
                id: name,
                name,
                baseUrl: String(m.base_url || '').trim(),
                apiKey: String(m.api_key || ''),
                timeout: Number.isFinite(timeoutS)
                  ? Math.max(1, timeoutS) * 1000
                  : 60000,
                modelId: String(m.model || '').trim(),
                isMultimodal: m.is_multimodal,
                supportsFunctionCalling: m.supports_function_calling,
                prompts: m.prompt_overrides || {},
              };
            });

          if (cancelled) return;

          if (providers.length > 0) {
            const fallbackId =
              providers.find((p) => p.id === selectedName)?.id || providers[0].id;

            const getValidId = (
              currentId: string | undefined,
              specificSaved: string | undefined
            ) => {
              // 1. Prefer current in-memory value if valid
              if (currentId && providers.some((p) => p.id === currentId)) {
                return currentId;
              }
              // 2. Prefer specific saved value (selected_chat, etc) if valid
              if (specificSaved && providers.some((p) => p.id === specificSaved)) {
                return specificSaved;
              }
              // 3. Fallback to generic selected or first
              return fallbackId;
            };

            setLocalSettings((prev) => {
              const newChatId = getValidId(
                prev.activeChatProviderId,
                (openai as any).selected_chat
              );
              // Update editing provider to match chat if untracked, or keep if valid
              setEditingProviderId((currEdit) => {
                if (currEdit && providers.some((p) => p.id === currEdit))
                  return currEdit;
                return newChatId;
              });

              return {
                ...prev,
                providers,
                activeChatProviderId: newChatId,
                activeWritingProviderId: getValidId(
                  prev.activeWritingProviderId,
                  (openai as any).selected_writing
                ),
                activeEditingProviderId: getValidId(
                  prev.activeEditingProviderId,
                  (openai as any).selected_editing
                ),
              };
            });
          }
        } catch (e) {
          console.error('Failed to load machine config', e);
        }
      })();

      return () => {
        cancelled = true;
      };
    }
  }, [isOpen, settings]);

  // Auto-test connection and fetch models for all providers.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    localSettings.providers.forEach((provider) => {
      const providerId = provider.id;
      const baseUrl = (provider.baseUrl || '').trim();
      const apiKey = (provider.apiKey || '').trim();
      const timeoutS = Math.max(1, Math.round((provider.timeout || 10000) / 1000));
      const testKey = `${baseUrl}|${apiKey}|${timeoutS}`;

      // Only attempt if baseUrl and apiKey are present
      if (!baseUrl || !apiKey) {
        setConnectionStatus((s) => ({ ...s, [providerId]: 'idle' }));
        setModelStatus((s) => ({ ...s, [providerId]: 'idle' }));
        setModelLists((prev) => ({ ...prev, [providerId]: [] }));
        return;
      }

      // Avoid re-testing unless the relevant inputs changed or dialog just opened.
      if (lastConnTestKeyRef.current[providerId] === testKey) {
        return;
      }

      const run = async () => {
        if (cancelled) return;
        setConnectionStatus((s) => ({ ...s, [providerId]: 'loading' }));
        try {
          const res = await api.machine.test({
            base_url: baseUrl,
            api_key: apiKey,
            timeout_s: timeoutS,
          });
          if (cancelled) return;
          lastConnTestKeyRef.current[providerId] = testKey;
          setConnectionStatus((s) => ({
            ...s,
            [providerId]: res?.ok ? 'success' : 'error',
          }));
          if (res?.ok) {
            setModelLists((prev) => ({
              ...prev,
              [providerId]: res.models || [],
            }));
          } else {
            setModelLists((prev) => ({ ...prev, [providerId]: [] }));
          }
        } catch (e) {
          if (cancelled) return;
          lastConnTestKeyRef.current[providerId] = testKey;
          setConnectionStatus((s) => ({ ...s, [providerId]: 'error' }));
          setModelLists((prev) => ({ ...prev, [providerId]: [] }));
        }
      };

      timeouts.push(setTimeout(run, 600));
    });

    return () => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
    };
  }, [isOpen, localSettings.providers]);

  // Test model availability for all providers.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    localSettings.providers.forEach((provider) => {
      const providerId = provider.id;
      const modelId = (provider.modelId || '').trim();
      const prevId = prevModelIdRef.current[providerId];

      // If nothing changed and we already have a status, skip.
      if (
        prevId === modelId &&
        modelStatus[providerId] &&
        modelStatus[providerId] !== 'idle'
      ) {
        return;
      }

      // If no modelId, it's idle.
      if (!modelId) {
        prevModelIdRef.current[providerId] = modelId;
        setModelStatus((s) => ({ ...s, [providerId]: 'idle' }));
        return;
      }

      // Only test if connection is OK.
      if (connectionStatus[providerId] !== 'success') {
        return;
      }

      const baseUrl = (provider.baseUrl || '').trim();
      const apiKey = (provider.apiKey || '').trim();
      const timeoutS = Math.max(1, Math.round((provider.timeout || 10000) / 1000));

      const run = async () => {
        if (cancelled) return;
        setModelStatus((s) => ({ ...s, [providerId]: 'loading' }));
        try {
          const res = await api.machine.testModel({
            base_url: baseUrl,
            api_key: apiKey,
            timeout_s: timeoutS,
            model_id: modelId,
          });
          if (cancelled) return;
          prevModelIdRef.current[providerId] = modelId;
          if (Array.isArray(res?.models)) {
            setModelLists((prev) => ({ ...prev, [providerId]: res.models }));
          }
          if (res?.capabilities) {
            setDetectedCapabilities((prev) => ({
              ...prev,
              [providerId]: res.capabilities!,
            }));
          }
          setModelStatus((s) => ({
            ...s,
            [providerId]: res?.ok && res?.model_ok ? 'success' : 'error',
          }));
        } catch (e) {
          if (cancelled) return;
          prevModelIdRef.current[providerId] = modelId;
          setModelStatus((s) => ({ ...s, [providerId]: 'error' }));
        }
      };

      timeouts.push(setTimeout(run, 500));
    });

    return () => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
    };
  }, [isOpen, localSettings.providers, connectionStatus]);

  // Close model dropdown when switching providers
  useEffect(() => {
    //  setModelPickerOpenFor(null); // This was missing or causing issues in orig? No, just logic fix
  }, [editingProviderId]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaveError('');
    setSaveLoading(true);
    try {
      const providers = localSettings.providers || [];
      const activeChat =
        providers.find((p) => p.id === localSettings.activeChatProviderId) ||
        providers[0];
      const activeWriting =
        providers.find((p) => p.id === localSettings.activeWritingProviderId) ||
        providers[0];
      const activeEditing =
        providers.find((p) => p.id === localSettings.activeEditingProviderId) ||
        providers[0];

      const machinePayload = {
        openai: {
          selected: activeChat?.name || '',
          selected_chat: activeChat?.name || '',
          selected_writing: activeWriting?.name || '',
          selected_editing: activeEditing?.name || '',
          models: providers.map((p) => ({
            name: (p.name || '').trim(),
            base_url: (p.baseUrl || '').trim(),
            api_key: p.apiKey || '',
            timeout_s: Math.max(1, Math.round((p.timeout || 10000) / 1000)),
            model: (p.modelId || '').trim(),
            is_multimodal: p.isMultimodal,
            supports_function_calling: p.supportsFunctionCalling,
            prompt_overrides: p.prompts || {},
          })),
        },
      };

      await api.machine.save(machinePayload);
      onSaveSettings(localSettings);
      onClose();
    } catch (e: any) {
      console.error('Failed to save machine settings', e);
      setSaveError(String(e?.message || e || 'Failed to save'));
    } finally {
      setSaveLoading(false);
    }
  };

  const addProvider = () => {
    const newProvider: LLMConfig = {
      ...DEFAULT_CONFIG,
      id: Date.now().toString(),
      name: 'New Provider',
    };
    setLocalSettings((prev) => ({
      ...prev,
      providers: [...prev.providers, newProvider],
      activeChatProviderId: prev.activeChatProviderId || newProvider.id,
      activeWritingProviderId: prev.activeWritingProviderId || newProvider.id,
      activeEditingProviderId: prev.activeEditingProviderId || newProvider.id,
    }));
    setEditingProviderId(newProvider.id);
  };

  const updateProvider = (id: string, updates: Partial<LLMConfig>) => {
    setLocalSettings((prev) => ({
      ...prev,
      providers: prev.providers.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
  };

  const removeProvider = (id: string) => {
    setLocalSettings((prev) => {
      const remaining = prev.providers.filter((p) => p.id !== id);
      const fallbackId = remaining[0]?.id || '';
      return {
        ...prev,
        providers: remaining,
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
    if (editingProviderId === id) setEditingProviderId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-gray-950/70 backdrop-blur-sm p-2 md:p-4">
      <div
        className={`w-full max-w-5xl h-[95vh] md:h-[85vh] rounded-xl border shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${
          isLight
            ? 'bg-brand-gray-50 border-brand-gray-200'
            : 'bg-brand-gray-900 border-brand-gray-700'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between p-4 border-b shrink-0 ${
            isLight
              ? 'border-brand-gray-200 bg-brand-gray-50'
              : 'border-brand-gray-800 bg-brand-gray-900'
          }`}
        >
          <div className="flex items-center space-x-3">
            <div
              className={`p-2 rounded-lg ${
                isLight ? 'bg-brand-600' : 'bg-brand-900/40 border border-brand-800/50'
              }`}
            >
              <Settings
                className={isLight ? 'text-white' : 'text-brand-300'}
                size={20}
              />
            </div>
            <h2
              className={`text-xl font-bold ${
                isLight ? 'text-brand-gray-800' : 'text-brand-gray-300'
              }`}
            >
              Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            className={`transition-colors ${
              isLight
                ? 'text-brand-gray-500 hover:text-brand-gray-700'
                : 'text-brand-gray-500 hover:text-brand-gray-300'
            }`}
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Sidebar / Navigation Tabs */}
          <div
            className={`w-full md:w-64 border-b md:border-b-0 md:border-r p-2 md:p-4 flex flex-row md:flex-col gap-2 shrink-0 overflow-x-auto ${
              isLight
                ? 'border-brand-gray-200 bg-brand-gray-50'
                : 'border-brand-gray-800 bg-brand-gray-950'
            }`}
          >
            <button
              onClick={() => setActiveTab('projects')}
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-1 md:flex-none ${
                activeTab === 'projects'
                  ? isLight
                    ? 'bg-brand-600 text-white border border-brand-500'
                    : 'bg-brand-gray-800 text-brand-gray-200 border border-brand-gray-700'
                  : isLight
                    ? 'text-brand-gray-600 hover:text-brand-gray-900 hover:bg-brand-gray-100'
                    : 'text-brand-gray-400 hover:text-brand-gray-300 hover:bg-brand-gray-900'
              }`}
            >
              <HardDrive size={18} />
              <span>Projects</span>
            </button>
            <button
              onClick={() => setActiveTab('machine')}
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-1 md:flex-none ${
                activeTab === 'machine'
                  ? isLight
                    ? 'bg-brand-600 text-white border border-brand-500'
                    : 'bg-brand-gray-800 text-brand-gray-200 border border-brand-gray-700'
                  : isLight
                    ? 'text-brand-gray-600 hover:text-brand-gray-900 hover:bg-brand-gray-100'
                    : 'text-brand-gray-400 hover:text-brand-gray-300 hover:bg-brand-gray-900'
              }`}
            >
              <Cpu size={18} />
              <span>Machine Settings</span>
            </button>
          </div>

          {/* Tab Content */}
          <div
            className={`flex-1 overflow-y-auto p-4 md:p-8 ${
              isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-900'
            }`}
          >
            {activeTab === 'projects' && (
              <SettingsProjects
                projects={projects}
                activeProjectId={activeProjectId}
                onLoadProject={onLoadProject}
                onCreateProject={onCreateProject}
                onDeleteProject={onDeleteProject}
                onRenameProject={onRenameProject}
                onConvertProject={onConvertProject}
                onImportProject={onImportProject}
                onCloseDialog={onClose}
                activeProjectType={activeProjectType}
                activeProjectStats={activeProjectStats}
                theme={theme}
              />
            )}

            {activeTab === 'machine' && (
              <SettingsMachine
                localSettings={localSettings}
                setLocalSettings={setLocalSettings}
                editingProviderId={editingProviderId}
                setEditingProviderId={setEditingProviderId}
                connectionStatus={connectionStatus}
                modelStatus={modelStatus}
                detectedCapabilities={detectedCapabilities}
                modelLists={modelLists}
                theme={theme}
                defaultPrompts={defaultPrompts}
                onAddProvider={addProvider}
                onUpdateProvider={updateProvider}
                onRemoveProvider={removeProvider}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className={`p-4 border-t shrink-0 flex justify-end ${
            isLight
              ? 'border-brand-gray-200 bg-brand-gray-50'
              : 'border-brand-gray-800 bg-brand-gray-900'
          }`}
        >
          <div className="flex items-center gap-3">
            {saveError && (
              <div className="flex items-center gap-1 text-xs text-red-500">
                <AlertCircle size={14} />
                <span>{saveError}</span>
              </div>
            )}
            <Button
              theme={theme}
              onClick={handleSave}
              icon={saveLoading ? <CheckCircle2 size={16} /> : <Save size={16} />}
              disabled={saveLoading}
            >
              Save & Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
