import React, { useState } from 'react';
import {
  MessageSquare,
  BookOpen,
  Edit2,
  Trash2,
  Terminal,
  Key,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { AppTheme, AppSettings, LLMConfig } from '../../types';
import { Button } from '../Button';
import { SettingsPrompts } from './SettingsPrompts';

interface SettingsMachineProps {
  localSettings: AppSettings;
  setLocalSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  editingProviderId: string | null;
  setEditingProviderId: React.Dispatch<React.SetStateAction<string | null>>;
  connectionStatus: { [key: string]: 'idle' | 'success' | 'error' | 'loading' };
  modelStatus: { [key: string]: 'idle' | 'success' | 'error' | 'loading' };
  modelLists: Record<string, string[]>;
  theme: AppTheme;
  defaultPrompts: {
    system_messages: Record<string, string>;
    user_prompts: Record<string, string>;
  };
  onAddProvider: () => void;
  onUpdateProvider: (id: string, updates: Partial<LLMConfig>) => void;
  onRemoveProvider: (id: string) => void;
}

export const SettingsMachine: React.FC<SettingsMachineProps> = ({
  localSettings,
  setLocalSettings,
  editingProviderId,
  setEditingProviderId,
  connectionStatus,
  modelStatus,
  modelLists,
  theme,
  defaultPrompts,
  onAddProvider,
  onUpdateProvider,
  onRemoveProvider,
}) => {
  const [modelPickerOpenFor, setModelPickerOpenFor] = useState<string | null>(null);

  const isLight = theme === 'light';

  const activeProvider = localSettings.providers.find(
    (p) => p.id === editingProviderId
  );

  return (
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
            onClick={onAddProvider}
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
                </div>
                <div className="flex items-center space-x-1">
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
                    title={`Connection: ${connectionStatus[p.id] || 'idle'}`}
                  />
                  <span
                    className={`h-2.5 w-2.5 rounded-full border ${
                      modelStatus[p.id] === 'success'
                        ? 'bg-emerald-500 border-emerald-500'
                        : modelStatus[p.id] === 'error'
                          ? 'bg-red-500 border-red-500'
                          : modelStatus[p.id] === 'loading'
                            ? 'bg-brand-500 border-brand-500'
                            : isLight
                              ? 'bg-brand-gray-200 border-brand-gray-300'
                              : 'bg-brand-gray-700 border-brand-gray-600'
                    }`}
                    title={`Model: ${modelStatus[p.id] || 'idle'}`}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {p.id === localSettings.activeChatProviderId && (
                  <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200 flex items-center gap-1">
                    <MessageSquare size={10} /> Chat
                  </span>
                )}
                {p.id === localSettings.activeWritingProviderId && (
                  <span className="text-[9px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded border border-violet-200 flex items-center gap-1">
                    <BookOpen size={10} /> Writing
                  </span>
                )}
                {p.id === localSettings.activeEditingProviderId && (
                  <span className="text-[9px] bg-fuchsia-100 text-fuchsia-700 px-1.5 py-0.5 rounded border border-fuchsia-200 flex items-center gap-1">
                    <Edit2 size={10} /> Editing
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
                  onClick={() => onRemoveProvider(activeProvider.id)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>

            {/* Role Selection Buttons */}
            <div
              className={`grid grid-cols-3 gap-3 p-3 rounded-lg border ${
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
                className={`flex items-center justify-center gap-2 py-2 rounded text-[10px] font-bold uppercase transition-all ${
                  localSettings.activeChatProviderId === activeProvider.id
                    ? isLight
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-blue-900/40 text-blue-300 border border-blue-800/50'
                    : isLight
                      ? 'bg-brand-gray-100 text-brand-gray-600 hover:bg-brand-gray-200'
                      : 'bg-brand-gray-800 text-brand-gray-400 hover:bg-brand-gray-700'
                }`}
              >
                <MessageSquare size={14} />
                Chat
              </button>
              <button
                onClick={() =>
                  setLocalSettings((s) => ({
                    ...s,
                    activeWritingProviderId: activeProvider.id,
                  }))
                }
                className={`flex items-center justify-center gap-2 py-2 rounded text-[10px] font-bold uppercase transition-all ${
                  localSettings.activeWritingProviderId === activeProvider.id
                    ? isLight
                      ? 'bg-violet-600 text-white shadow-md'
                      : 'bg-violet-900/40 text-violet-300 border border-violet-800/50'
                    : isLight
                      ? 'bg-brand-gray-100 text-brand-gray-600 hover:bg-brand-gray-200'
                      : 'bg-brand-gray-800 text-brand-gray-400 hover:bg-brand-gray-700'
                }`}
              >
                <BookOpen size={14} />
                Writing
              </button>
              <button
                onClick={() =>
                  setLocalSettings((s) => ({
                    ...s,
                    activeEditingProviderId: activeProvider.id,
                  }))
                }
                className={`flex items-center justify-center gap-2 py-2 rounded text-[10px] font-bold uppercase transition-all ${
                  localSettings.activeEditingProviderId === activeProvider.id
                    ? isLight
                      ? 'bg-fuchsia-600 text-white shadow-md'
                      : 'bg-fuchsia-900/40 text-fuchsia-300 border border-fuchsia-800/50'
                    : isLight
                      ? 'bg-brand-gray-100 text-brand-gray-600 hover:bg-brand-gray-200'
                      : 'bg-brand-gray-800 text-brand-gray-400 hover:bg-brand-gray-700'
                }`}
              >
                <Edit2 size={14} />
                Editing
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
                      onUpdateProvider(activeProvider.id, {
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
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-brand-gray-500 uppercase flex items-center gap-2">
                  <Terminal size={12} /> Base URL
                </label>
                <input
                  value={activeProvider.baseUrl}
                  onChange={(e) =>
                    onUpdateProvider(activeProvider.id, {
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
                      onUpdateProvider(activeProvider.id, {
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
                        onUpdateProvider(activeProvider.id, {
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
                      disabled={(modelLists[activeProvider.id] || []).length === 0}
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
                          {(modelLists[activeProvider.id] || []).map((m: string) => {
                            const isSelected = m === activeProvider.modelId;
                            return (
                              <button
                                type="button"
                                key={m}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  onUpdateProvider(activeProvider.id, {
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
                          })}
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
                      onUpdateProvider(activeProvider.id, {
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
                        isLight ? 'text-brand-gray-600' : 'text-brand-gray-400'
                      }`}
                    >
                      <span>Temperature</span> <span>{activeProvider.temperature}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={activeProvider.temperature}
                      onChange={(e) =>
                        onUpdateProvider(activeProvider.id, {
                          temperature: Number(e.target.value),
                        })
                      }
                      className="w-full accent-brand-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <div
                      className={`flex justify-between text-xs ${
                        isLight ? 'text-brand-gray-600' : 'text-brand-gray-400'
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
                        onUpdateProvider(activeProvider.id, {
                          topP: Number(e.target.value),
                        })
                      }
                      className="w-full accent-brand-500"
                    />
                  </div>
                </div>
              </div>

              <SettingsPrompts
                activeProvider={activeProvider}
                defaultPrompts={defaultPrompts}
                onUpdateProvider={onUpdateProvider}
                theme={theme}
              />
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-brand-gray-600">
            <p>Select a provider to configure</p>
          </div>
        )}
      </div>
    </div>
  );
};
