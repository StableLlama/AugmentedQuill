// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Left-panel list of LLM providers in the machine settings tab.
 * Shows each provider with role badges, status indicators and actions.
 * Extracted from SettingsMachine.tsx to keep list and form concerns separate.
 */

import React from 'react';
import {
  BookOpen,
  Edit2,
  MessageSquare,
  AlertTriangle,
  Eye,
  Wand2,
  Plus,
  CopyPlus,
} from 'lucide-react';
import { LLMConfig } from '../../../types';

export interface ProviderListPanelProps {
  providers: LLMConfig[];
  editingProviderId: string | null;
  activeWritingProviderId: string;
  activeEditingProviderId: string;
  activeChatProviderId: string;
  connectionStatus: Record<string, 'idle' | 'success' | 'error' | 'loading'>;
  modelStatus: Record<string, 'idle' | 'success' | 'error' | 'loading'>;
  detectedCapabilities: Record<
    string,
    { is_multimodal: boolean; supports_function_calling: boolean }
  >;
  isLight: boolean;
  onSelectProvider: (id: string) => void;
  onAddProvider: () => void;
  onDuplicateProvider: (id: string) => void;
}

type ProviderStatus = 'idle' | 'success' | 'error' | 'loading';

/** Resolve a capability flag: explicit true/false wins; null/undefined falls back to auto-detected. */
function resolveCapability(
  manual: boolean | null | undefined,
  detected: boolean | undefined
): boolean {
  if (manual === true) return true;
  if (manual === null || manual === undefined) return detected ?? false;
  return false;
}

/** Return the Tailwind class string for a provider-status indicator dot. */
function getStatusDotClass(status: ProviderStatus, isLight: boolean): string {
  if (status === 'success') return 'bg-emerald-500 border-emerald-500';
  if (status === 'error') return 'bg-red-500 border-red-500';
  if (status === 'loading') return 'bg-brand-500 border-brand-500';
  return isLight
    ? 'bg-brand-gray-200 border-brand-gray-300'
    : 'bg-brand-gray-700 border-brand-gray-600';
}

interface ProviderListItemProps {
  provider: LLMConfig;
  isEditing: boolean;
  isWritingActive: boolean;
  isEditingActive: boolean;
  isChatActive: boolean;
  connectionStatus: ProviderStatus;
  modelStatus: ProviderStatus;
  capabilities:
    { is_multimodal: boolean; supports_function_calling: boolean } | undefined;
  isLight: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
}

const ProviderListItem: React.FC<ProviderListItemProps> = ({
  provider: p,
  isEditing,
  isWritingActive,
  isEditingActive,
  isChatActive,
  connectionStatus,
  modelStatus,
  capabilities,
  isLight,
  onSelect,
  onDuplicate,
}: ProviderListItemProps) => {
  const connDot = getStatusDotClass(connectionStatus, isLight);
  const modelDot = getStatusDotClass(modelStatus, isLight);
  const showMultimodal = resolveCapability(p.isMultimodal, capabilities?.is_multimodal);
  const showFunctionCalling = resolveCapability(
    p.supportsFunctionCalling,
    capabilities?.supports_function_calling
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`p-3 rounded-lg border cursor-pointer transition-all flex flex-col gap-2 group w-full text-left ${
        isEditing
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
          {showMultimodal && (
            <Eye
              size={12}
              className={isLight ? 'text-brand-gray-500' : 'text-brand-gray-400'}
            />
          )}
          {showFunctionCalling && (
            <Wand2
              size={12}
              className={isLight ? 'text-brand-gray-500' : 'text-brand-gray-400'}
            />
          )}
          <span
            className={`h-2.5 w-2.5 rounded-full border ${connDot}`}
            title={`Connection: ${connectionStatus}`}
          />
          <span
            className={`h-2.5 w-2.5 rounded-full border ${modelDot}`}
            title={`Model: ${modelStatus}`}
          />
        </div>
      </div>
      <div className="flex justify-between items-start">
        <div className="flex flex-wrap gap-1">
          {isWritingActive && (
            <span className="text-[9px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded border border-violet-200 flex items-center gap-1">
              <BookOpen size={10} /> Writing
              {p.writingWarning && (
                <AlertTriangle size={10} className="text-amber-500" />
              )}
            </span>
          )}
          {isEditingActive && (
            <span className="text-[9px] bg-fuchsia-100 text-fuchsia-700 px-1.5 py-0.5 rounded border border-fuchsia-200 flex items-center gap-1">
              <Edit2 size={10} /> Editing
            </span>
          )}
          {isChatActive && (
            <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200 flex items-center gap-1">
              <MessageSquare size={10} /> Chat
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e: React.MouseEvent<HTMLButtonElement, MouseEvent>): void => {
            e.stopPropagation();
            onDuplicate();
          }}
          className={`p-1 rounded transition-colors opacity-100 sm:opacity-0 group-hover:opacity-100 ${
            isLight
              ? 'text-brand-gray-400 hover:text-brand-600 hover:bg-brand-gray-200'
              : 'text-brand-gray-500 hover:text-brand-400 hover:bg-brand-gray-700'
          }`}
          title="Duplicate provider"
        >
          <CopyPlus size={12} />
        </button>
      </div>
    </div>
  );
};

export const ProviderListPanel: React.FC<ProviderListPanelProps> = ({
  providers,
  editingProviderId,
  activeWritingProviderId,
  activeEditingProviderId,
  activeChatProviderId,
  connectionStatus,
  modelStatus,
  detectedCapabilities,
  isLight,
  onSelectProvider,
  onAddProvider,
  onDuplicateProvider,
}: ProviderListPanelProps) => {
  return (
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
          aria-label="Add provider"
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
        {providers.map((p: LLMConfig) => (
          <ProviderListItem
            key={p.id}
            provider={p}
            isEditing={editingProviderId === p.id}
            isWritingActive={p.id === activeWritingProviderId}
            isEditingActive={p.id === activeEditingProviderId}
            isChatActive={p.id === activeChatProviderId}
            connectionStatus={connectionStatus[p.id] ?? 'idle'}
            modelStatus={modelStatus[p.id] ?? 'idle'}
            capabilities={detectedCapabilities[p.id]}
            isLight={isLight}
            onSelect={(): void => onSelectProvider(p.id)}
            onDuplicate={(): void => onDuplicateProvider(p.id)}
          />
        ))}
      </div>
    </div>
  );
};
