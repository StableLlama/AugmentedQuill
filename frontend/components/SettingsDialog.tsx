import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Plus,
  Trash2,
  Save,
  X,
  Edit2,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Cpu,
  Terminal,
  Key,
  MessageSquare,
  BookOpen,
  ChevronDown,
} from 'lucide-react';
import { LLMConfig, ProjectMetadata, AppSettings, AppTheme } from '../types';
import { api } from '../services/api';
import { Button } from './Button';

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
  theme: AppTheme;
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
  theme,
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
  const [saveError, setSaveError] = useState<string>('');
  const [saveLoading, setSaveLoading] = useState<boolean>(false);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [modelPickerOpenFor, setModelPickerOpenFor] = useState<string | null>(null);

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
              };
            });

          if (cancelled) return;

          if (providers.length > 0) {
            const selectedId =
              providers.find((p) => p.id === selectedName)?.id || providers[0].id;
            setLocalSettings((prev) => ({
              ...prev,
              providers,
              activeChatProviderId: selectedId,
              activeStoryProviderId: selectedId,
            }));
            setEditingProviderId(selectedId);

            // Treat backend-loaded values as initial (do not auto-trigger model test)
            prevModelIdRef.current[selectedId] = providers.find(
              (p) => p.id === selectedId
            )?.modelId;
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

  // Auto-test connection and fetch models only when:
  // - dialog opens
  // - active provider changes (user selects another provider)
  // - baseUrl/apiKey/timeout for active provider changes
  useEffect(() => {
    const provider = localSettings.providers.find((p) => p.id === editingProviderId);
    if (!provider) return;

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
    lastConnTestKeyRef.current[providerId] = testKey;

    let cancelled = false;

    const run = async () => {
      setConnectionStatus((s) => ({ ...s, [providerId]: 'loading' }));
      try {
        const res = await api.machine.test({
          base_url: baseUrl,
          api_key: apiKey,
          timeout_s: timeoutS,
        });
        if (cancelled) return;
        setConnectionStatus((s) => ({
          ...s,
          [providerId]: res?.ok ? 'success' : 'error',
        }));
        if (res?.ok) {
          setModelLists((prev) => ({ ...prev, [providerId]: res.models || [] }));
        } else {
          setModelLists((prev) => ({ ...prev, [providerId]: [] }));
        }
      } catch (e) {
        if (cancelled) return;
        setConnectionStatus((s) => ({ ...s, [providerId]: 'error' }));
        setModelLists((prev) => ({ ...prev, [providerId]: [] }));
      }
    };

    const t = setTimeout(run, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isOpen, editingProviderId, localSettings.providers]);

  // Test model availability only when the user changes Model ID (no polling).
  useEffect(() => {
    const provider = localSettings.providers.find((p) => p.id === editingProviderId);
    if (!provider) return;

    const providerId = provider.id;
    const modelId = (provider.modelId || '').trim();
    const prevModelId = prevModelIdRef.current[providerId];

    // Track changes; skip initial load.
    if (prevModelId === undefined) {
      prevModelIdRef.current[providerId] = modelId;
      setModelStatus((s) => ({ ...s, [providerId]: 'idle' }));
      return;
    }

    if (prevModelId === modelId) {
      return;
    }
    prevModelIdRef.current[providerId] = modelId;

    // Only test if connection is OK.
    if (connectionStatus[providerId] !== 'success' || !modelId) {
      setModelStatus((s) => ({ ...s, [providerId]: 'idle' }));
      return;
    }

    const baseUrl = (provider.baseUrl || '').trim();
    const apiKey = (provider.apiKey || '').trim();
    const timeoutS = Math.max(1, Math.round((provider.timeout || 10000) / 1000));

    let cancelled = false;

    const run = async () => {
      setModelStatus((s) => ({ ...s, [providerId]: 'loading' }));
      try {
        const res = await api.machine.testModel({
          base_url: baseUrl,
          api_key: apiKey,
          timeout_s: timeoutS,
          model_id: modelId,
        });
        if (cancelled) return;
        if (Array.isArray(res?.models)) {
          setModelLists((prev) => ({ ...prev, [providerId]: res.models }));
        }
        setModelStatus((s) => ({
          ...s,
          [providerId]: res?.ok && res?.model_ok ? 'success' : 'error',
        }));
      } catch (e) {
        if (cancelled) return;
        setModelStatus((s) => ({ ...s, [providerId]: 'error' }));
      }
    };

    const t = setTimeout(run, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isOpen, editingProviderId, localSettings.providers, connectionStatus]);

  // Close model dropdown when switching providers
  useEffect(() => {
    setModelPickerOpenFor(null);
  }, [editingProviderId]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaveError('');
    setSaveLoading(true);
    try {
      const providers = localSettings.providers || [];
      const active =
        providers.find((p) => p.id === localSettings.activeChatProviderId) ||
        providers[0];

      const machinePayload = {
        openai: {
          selected: active?.name || '',
          models: providers.map((p) => ({
            name: (p.name || '').trim(),
            base_url: (p.baseUrl || '').trim(),
            api_key: p.apiKey || '',
            timeout_s: Math.max(1, Math.round((p.timeout || 10000) / 1000)),
            model: (p.modelId || '').trim(),
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
      activeStoryProviderId: prev.activeStoryProviderId || newProvider.id,
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
        activeStoryProviderId:
          prev.activeStoryProviderId === id ? fallbackId : prev.activeStoryProviderId,
      };
    });
    if (editingProviderId === id) setEditingProviderId(null);
  };

  const activeProvider = localSettings.providers.find(
    (p) => p.id === editingProviderId
  );

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
              <div className="space-y-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3
                      className={`text-lg md:text-2xl font-bold mb-1 ${
                        isLight ? 'text-brand-gray-800' : 'text-brand-gray-300'
                      }`}
                    >
                      Your Projects
                    </h3>
                    <p
                      className={`text-sm ${
                        isLight ? 'text-brand-gray-500' : 'text-brand-gray-500'
                      }`}
                    >
                      Manage your stories and creative works.
                    </p>
                  </div>
                  <Button
                    theme={theme}
                    onClick={onCreateProject}
                    icon={<Plus size={16} />}
                  >
                    New Project
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {projects.map((proj) => (
                    <div
                      key={proj.id}
                      className={`group flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border transition-all gap-3 ${
                        proj.id === activeProjectId
                          ? 'bg-brand-50 border-brand-500/50'
                          : isLight
                          ? 'bg-brand-gray-50 border-brand-gray-200 hover:border-brand-gray-300'
                          : 'bg-brand-gray-800 border-brand-gray-700 hover:border-brand-gray-600'
                      }`}
                    >
                      <div className="flex items-center space-x-4">
                        <div
                          className={`hidden sm:block w-2 h-12 rounded-full ${
                            proj.id === activeProjectId
                              ? 'bg-brand-500'
                              : isLight
                              ? 'bg-brand-gray-300'
                              : 'bg-brand-gray-600'
                          }`}
                        ></div>
                        <div className="flex-1">
                          {editingNameId === proj.id ? (
                            <div className="flex items-center space-x-2">
                              <input
                                value={tempName}
                                onChange={(e) => setTempName(e.target.value)}
                                className={`border rounded px-2 py-1 text-sm focus:outline-none focus:border-brand-500 w-full ${
                                  isLight
                                    ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-800'
                                    : 'bg-brand-gray-950 border-brand-gray-600 text-brand-gray-300'
                                }`}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    onRenameProject(proj.id, tempName);
                                    setEditingNameId(null);
                                  }
                                }}
                              />
                              <button
                                onClick={() => {
                                  onRenameProject(proj.id, tempName);
                                  setEditingNameId(null);
                                }}
                                className="text-brand-600 hover:text-brand-700"
                              >
                                <Save size={16} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center space-x-2 group/title">
                              <h4
                                className={`font-bold ${
                                  isLight
                                    ? 'text-brand-gray-800'
                                    : 'text-brand-gray-300'
                                }`}
                              >
                                {proj.title}
                              </h4>
                              <button
                                onClick={() => {
                                  setEditingNameId(proj.id);
                                  setTempName(proj.title);
                                }}
                                className={`opacity-0 group-hover/title:opacity-100 transition-opacity ${
                                  isLight
                                    ? 'text-brand-gray-500 hover:text-brand-gray-700'
                                    : 'text-brand-gray-500 hover:text-brand-gray-300'
                                }`}
                              >
                                <Edit2 size={12} />
                              </button>
                            </div>
                          )}
                          <p className="text-xs text-brand-gray-500 mt-1">
                            Last edited: {new Date(proj.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3 justify-end">
                        {proj.id !== activeProjectId && (
                          <Button
                            theme={theme}
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              onLoadProject(proj.id);
                              onClose();
                            }}
                          >
                            Open
                          </Button>
                        )}
                        {proj.id === activeProjectId && (
                          <span className="text-xs font-medium text-brand-700 bg-brand-100 px-2 py-1 rounded">
                            Active
                          </span>
                        )}
                        <button
                          onClick={() => onDeleteProject(proj.id)}
                          className={`p-2 rounded transition-colors ${
                            isLight
                              ? 'text-brand-gray-600 hover:text-red-600 hover:bg-red-50'
                              : 'text-brand-gray-500 hover:text-red-400 hover:bg-red-950/30'
                          }`}
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'machine' && (
              <div className="flex flex-col md:flex-row h-full gap-4 md:gap-6">
                {/* Provider List */}
                <div
                  className={`w-full md:w-1/3 h-48 md:h-full border-b md:border-b-0 md:border-r md:pr-6 overflow-y-auto shrink-0 ${
                    isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
                  }`}
                >
                  <div className="flex justify-between items-center mb-4">
                    <h3
                      className={`font-bold ${
                        isLight ? 'text-brand-gray-700' : 'text-brand-gray-300'
                      }`}
                    >
                      Providers
                    </h3>
                    <button
                      onClick={addProvider}
                      className={`p-1 rounded transition-colors ${
                        isLight
                          ? 'bg-brand-gray-100 text-brand-gray-600 hover:text-brand-600'
                          : 'bg-brand-gray-800 text-brand-gray-400 hover:text-brand-400'
                      }`}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {localSettings.providers.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => setEditingProviderId(p.id)}
                        className={`p-3 rounded-lg border cursor-pointer transition-all flex flex-col gap-2 ${
                          editingProviderId === p.id
                            ? 'bg-brand-50 border-brand-500/50'
                            : isLight
                            ? 'bg-brand-gray-50 border-brand-gray-200 hover:bg-brand-gray-100'
                            : 'bg-brand-gray-800 border-brand-gray-700 hover:bg-brand-gray-750'
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <div className="truncate flex-1">
                            <div
                              className={`font-medium text-sm ${
                                isLight ? 'text-brand-gray-800' : 'text-brand-gray-300'
                              }`}
                            >
                              {p.name}
                            </div>
                            <div className="text-xs text-brand-gray-500" />
                          </div>
                          <div className="flex items-center space-x-2">
                            <span
                              className={`h-2.5 w-2.5 rounded-full border ${
                                connectionStatus[p.id] === 'success'
                                  ? 'bg-emerald-500 border-emerald-500'
                                  : connectionStatus[p.id] === 'error'
                                  ? 'bg-red-500 border-red-500'
                                  : connectionStatus[p.id] === 'loading'
                                  ? 'bg-brand-500 border-brand-500'
                                  : isLight
                                  ? 'bg-brand-gray-200 border-brand-gray-300'
                                  : 'bg-brand-gray-700 border-brand-gray-600'
                              }`}
                              title={connectionStatus[p.id] || 'idle'}
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {p.id === localSettings.activeChatProviderId && (
                            <span className="text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded border border-brand-200 flex items-center gap-1">
                              <MessageSquare size={10} /> Chat
                            </span>
                          )}
                          {p.id === localSettings.activeStoryProviderId && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                              <BookOpen size={10} /> Story
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Config Form */}
                <div className="flex-1 overflow-y-auto pl-0 md:pl-2 md:pr-2">
                  {activeProvider ? (
                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3
                            className={`text-xl font-bold ${
                              isLight ? 'text-brand-gray-800' : 'text-brand-gray-300'
                            }`}
                          >
                            {activeProvider.name}
                          </h3>
                          <p className="text-xs text-brand-gray-500 mt-1">
                            ID: {activeProvider.id}
                          </p>
                        </div>
                        <div className="flex space-x-2">
                          <Button
                            theme={theme}
                            size="sm"
                            variant="danger"
                            onClick={() => removeProvider(activeProvider.id)}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </div>

                      {/* Role Selection Buttons */}
                      <div
                        className={`grid grid-cols-2 gap-3 p-3 rounded-lg border ${
                          isLight
                            ? 'bg-brand-gray-50 border-brand-gray-200'
                            : 'bg-brand-gray-950 border-brand-gray-800'
                        }`}
                      >
                        <button
                          onClick={() =>
                            setLocalSettings((s) => ({
                              ...s,
                              activeChatProviderId: activeProvider.id,
                            }))
                          }
                          className={`flex items-center justify-center gap-2 py-2 rounded text-xs font-bold uppercase transition-all ${
                            localSettings.activeChatProviderId === activeProvider.id
                              ? isLight
                                ? 'bg-brand-600 text-white shadow-md'
                                : 'bg-brand-gray-800 text-brand-gray-200 border border-brand-gray-700'
                              : isLight
                              ? 'bg-brand-gray-100 text-brand-gray-600 hover:bg-brand-gray-200'
                              : 'bg-brand-gray-800 text-brand-gray-400 hover:bg-brand-gray-700'
                          }`}
                        >
                          <MessageSquare size={14} />
                          Use for Chat
                        </button>
                        <button
                          onClick={() =>
                            setLocalSettings((s) => ({
                              ...s,
                              activeStoryProviderId: activeProvider.id,
                            }))
                          }
                          className={`flex items-center justify-center gap-2 py-2 rounded text-xs font-bold uppercase transition-all ${
                            localSettings.activeStoryProviderId === activeProvider.id
                              ? isLight
                                ? 'bg-emerald-600 text-white shadow-md'
                                : 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/50'
                              : isLight
                              ? 'bg-brand-gray-100 text-brand-gray-600 hover:bg-brand-gray-200'
                              : 'bg-brand-gray-800 text-brand-gray-400 hover:bg-brand-gray-700'
                          }`}
                        >
                          <BookOpen size={14} />
                          Use for Story
                        </button>
                      </div>

                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-brand-gray-500 uppercase">
                              Name
                            </label>
                            <input
                              value={activeProvider.name}
                              onChange={(e) =>
                                updateProvider(activeProvider.id, {
                                  name: e.target.value,
                                })
                              }
                              className={`w-full border rounded p-2 text-sm focus:border-brand-500 focus:outline-none ${
                                isLight
                                  ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-800'
                                  : 'bg-brand-gray-950 border-brand-gray-700 text-brand-gray-300'
                              }`}
                            />
                          </div>
                          {/* PROVIDER removed (OpenAI-compatible only) */}
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-medium text-brand-gray-500 uppercase flex items-center gap-2">
                            <Terminal size={12} /> Base URL
                          </label>
                          <input
                            value={activeProvider.baseUrl}
                            onChange={(e) =>
                              updateProvider(activeProvider.id, {
                                baseUrl: e.target.value,
                              })
                            }
                            placeholder={'https://api.openai.com/v1'}
                            className={`w-full border rounded p-2 text-sm focus:border-brand-500 focus:outline-none disabled:opacity-50 ${
                              isLight
                                ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-800'
                                : 'bg-brand-gray-950 border-brand-gray-700 text-brand-gray-300'
                            }`}
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-medium text-brand-gray-500 uppercase flex items-center gap-2">
                            <Key size={12} /> API Key
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              value={activeProvider.apiKey}
                              onChange={(e) =>
                                updateProvider(activeProvider.id, {
                                  apiKey: e.target.value,
                                })
                              }
                              placeholder="sk... (visible)"
                              className={`w-full border rounded p-2 text-sm focus:border-brand-500 focus:outline-none ${
                                isLight
                                  ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-800'
                                  : 'bg-brand-gray-950 border-brand-gray-700 text-brand-gray-300'
                              }`}
                            />
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                connectionStatus[activeProvider.id] === 'success'
                                  ? 'bg-emerald-500'
                                  : connectionStatus[activeProvider.id] === 'error'
                                  ? 'bg-red-500'
                                  : connectionStatus[activeProvider.id] === 'loading'
                                  ? 'bg-brand-500'
                                  : isLight
                                  ? 'bg-brand-gray-300'
                                  : 'bg-brand-gray-600'
                              }`}
                            />
                            {connectionStatus[activeProvider.id] === 'success' && (
                              <span className="text-emerald-600">Connected</span>
                            )}
                            {connectionStatus[activeProvider.id] === 'error' && (
                              <span className="text-red-500">Connection failed</span>
                            )}
                            {connectionStatus[activeProvider.id] === 'loading' && (
                              <span className="text-brand-600">Testing…</span>
                            )}
                            {(!connectionStatus[activeProvider.id] ||
                              connectionStatus[activeProvider.id] === 'idle') && (
                              <span className="text-brand-gray-500">Idle</span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-brand-gray-500 uppercase flex items-center justify-between">
                              <span>Model ID</span>
                              <span className="text-xs text-brand-gray-400">
                                You can type a custom model id
                              </span>
                            </label>
                            <div className="relative">
                              <input
                                value={activeProvider.modelId}
                                onFocus={() => setModelPickerOpenFor(activeProvider.id)}
                                onBlur={() => {
                                  // allow click selection to run first
                                  setTimeout(() => setModelPickerOpenFor(null), 120);
                                }}
                                onChange={(e) => {
                                  updateProvider(activeProvider.id, {
                                    modelId: e.target.value,
                                  });
                                }}
                                placeholder="Select or type a model id"
                                className={`w-full border rounded p-2 pr-9 text-sm focus:border-brand-500 focus:outline-none ${
                                  isLight
                                    ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-800'
                                    : 'bg-brand-gray-950 border-brand-gray-700 text-brand-gray-300'
                                }`}
                              />
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  const models = modelLists[activeProvider.id] || [];
                                  if (models.length === 0) return;
                                  setModelPickerOpenFor((cur) =>
                                    cur === activeProvider.id ? null : activeProvider.id
                                  );
                                }}
                                disabled={
                                  (modelLists[activeProvider.id] || []).length === 0
                                }
                                className={`absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded border text-xs transition-colors disabled:opacity-50 ${
                                  isLight
                                    ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-500 hover:bg-brand-gray-50'
                                    : 'bg-brand-gray-950 border-brand-gray-700 text-brand-gray-400 hover:bg-brand-gray-900'
                                }`}
                                title={
                                  (modelLists[activeProvider.id] || []).length === 0
                                    ? 'No models loaded'
                                    : 'Show available models'
                                }
                              >
                                <ChevronDown size={14} />
                              </button>

                              {modelPickerOpenFor === activeProvider.id &&
                                (modelLists[activeProvider.id] || []).length > 0 && (
                                  <div
                                    className={`absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded border shadow-lg ${
                                      isLight
                                        ? 'bg-brand-gray-50 border-brand-gray-200'
                                        : 'bg-brand-gray-950 border-brand-gray-800'
                                    }`}
                                  >
                                    {(modelLists[activeProvider.id] || []).map(
                                      (m: string) => {
                                        const isSelected = m === activeProvider.modelId;
                                        return (
                                          <button
                                            type="button"
                                            key={m}
                                            onMouseDown={(e) => {
                                              e.preventDefault();
                                              updateProvider(activeProvider.id, {
                                                modelId: m,
                                              });
                                              setModelPickerOpenFor(null);
                                            }}
                                            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                              isSelected
                                                ? isLight
                                                  ? 'bg-brand-50 text-brand-gray-900'
                                                  : 'bg-brand-gray-900 text-brand-gray-300'
                                                : isLight
                                                ? 'text-brand-gray-800 hover:bg-brand-gray-50'
                                                : 'text-brand-gray-300 hover:bg-brand-gray-900'
                                            }`}
                                          >
                                            {m}
                                          </button>
                                        );
                                      }
                                    )}
                                  </div>
                                )}
                            </div>
                            {/* Model availability indicator */}
                            <div className="mt-1 flex items-center gap-2 text-xs">
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  modelStatus[activeProvider.id] === 'success'
                                    ? 'bg-emerald-500'
                                    : modelStatus[activeProvider.id] === 'error'
                                    ? 'bg-red-500'
                                    : modelStatus[activeProvider.id] === 'loading'
                                    ? 'bg-brand-500'
                                    : isLight
                                    ? 'bg-brand-gray-300'
                                    : 'bg-brand-gray-600'
                                }`}
                              />
                              {modelStatus[activeProvider.id] === 'success' && (
                                <span className="text-emerald-600">Model OK</span>
                              )}
                              {modelStatus[activeProvider.id] === 'error' && (
                                <span className="text-red-500">Model unavailable</span>
                              )}
                              {modelStatus[activeProvider.id] === 'loading' && (
                                <span className="text-brand-600">Checking…</span>
                              )}
                              {(!modelStatus[activeProvider.id] ||
                                modelStatus[activeProvider.id] === 'idle') && (
                                <span className="text-brand-gray-500">Idle</span>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-brand-gray-500 uppercase">
                              Timeout (ms)
                            </label>
                            <input
                              type="number"
                              value={activeProvider.timeout}
                              onChange={(e) =>
                                updateProvider(activeProvider.id, {
                                  timeout: Number(e.target.value),
                                })
                              }
                              className={`w-full border rounded p-2 text-sm focus:border-brand-500 focus:outline-none ${
                                isLight
                                  ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-800'
                                  : 'bg-brand-gray-950 border-brand-gray-700 text-brand-gray-300'
                              }`}
                            />
                          </div>
                        </div>

                        <div
                          className={`pt-4 border-t ${
                            isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
                          }`}
                        >
                          <h4
                            className={`text-sm font-bold mb-3 uppercase tracking-wider ${
                              isLight ? 'text-brand-gray-600' : 'text-brand-gray-400'
                            }`}
                          >
                            Parameters
                          </h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <div
                                className={`flex justify-between text-xs ${
                                  isLight
                                    ? 'text-brand-gray-600'
                                    : 'text-brand-gray-400'
                                }`}
                              >
                                <span>Temperature</span>{' '}
                                <span>{activeProvider.temperature}</span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="2"
                                step="0.1"
                                value={activeProvider.temperature}
                                onChange={(e) =>
                                  updateProvider(activeProvider.id, {
                                    temperature: Number(e.target.value),
                                  })
                                }
                                className="w-full accent-brand-500"
                              />
                            </div>
                            <div className="space-y-2">
                              <div
                                className={`flex justify-between text-xs ${
                                  isLight
                                    ? 'text-brand-gray-600'
                                    : 'text-brand-gray-400'
                                }`}
                              >
                                <span>Top P</span> <span>{activeProvider.topP}</span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={activeProvider.topP}
                                onChange={(e) =>
                                  updateProvider(activeProvider.id, {
                                    topP: Number(e.target.value),
                                  })
                                }
                                className="w-full accent-brand-500"
                              />
                            </div>
                          </div>
                        </div>

                        <div
                          className={`pt-4 border-t ${
                            isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
                          }`}
                        >
                          <h4
                            className={`text-sm font-bold mb-3 uppercase tracking-wider ${
                              isLight ? 'text-brand-gray-600' : 'text-brand-gray-400'
                            }`}
                          >
                            Expert: Prompt Overrides
                          </h4>
                          <div className="space-y-4">
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-brand-gray-500">
                                System Instruction (Chat Persona)
                              </label>
                              <textarea
                                rows={3}
                                value={activeProvider.prompts?.system || ''}
                                onChange={(e) =>
                                  updateProvider(activeProvider.id, {
                                    prompts: {
                                      ...activeProvider.prompts,
                                      system: e.target.value,
                                    },
                                  })
                                }
                                placeholder="Default persona..."
                                className={`w-full border rounded p-2 text-xs focus:border-brand-500 focus:outline-none ${
                                  isLight
                                    ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-800'
                                    : 'bg-brand-gray-950 border-brand-gray-700 text-brand-gray-300'
                                }`}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-brand-gray-500">
                                Continuation Prompt
                              </label>
                              <textarea
                                rows={2}
                                value={activeProvider.prompts?.continuation || ''}
                                onChange={(e) =>
                                  updateProvider(activeProvider.id, {
                                    prompts: {
                                      ...activeProvider.prompts,
                                      continuation: e.target.value,
                                    },
                                  })
                                }
                                placeholder="Instruction for generating next paragraphs..."
                                className={`w-full border rounded p-2 text-xs focus:border-brand-500 focus:outline-none ${
                                  isLight
                                    ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-800'
                                    : 'bg-brand-gray-950 border-brand-gray-700 text-brand-gray-300'
                                }`}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-brand-gray-600">
                      <p>Select a provider to configure</p>
                    </div>
                  )}
                </div>
              </div>
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
