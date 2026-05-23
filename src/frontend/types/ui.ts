// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: UI/settings types – themes, editor preferences, LLM configuration, and app settings.
 */

export type ViewMode = 'raw' | 'markdown' | 'wysiwyg';

export type SuggestionGenerationMode = 'guided' | 'instructed' | 'pure';

export type AppTheme = 'light' | 'mixed' | 'dark';

export interface SidebarSettings {
  storyHeight?: number;
  chaptersHeight?: number;
  sourcebookHeight?: number;
  isStoryCollapsed?: boolean;
  isChaptersCollapsed?: boolean;
  isSourcebookCollapsed?: boolean;
}

export interface EditorSettings {
  fontSize: number;
  maxWidth: number;
  brightness: number; // 0.5 - 1.0
  contrast: number; // 0.5 - 1.0
  theme: AppTheme;
  sidebarWidth: number;
  showDiff: boolean;
  sidebar?: SidebarSettings;
}

export interface LLMConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKeyEnabled?: boolean;
  timeout: number; // timeout in seconds
  modelId: string;
  contextWindowTokens?: number;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
  seed?: number;
  topK?: number;
  minP?: number;
  extraBody?: string;
  presetId?: string | null;
  writingWarning?: string | null;
  isMultimodal?: boolean | null;
  supportsFunctionCalling?: boolean | null;
  suggestLoopGuardEnabled?: boolean;
  suggestLoopGuardNgram?: 3 | 4;
  suggestLoopGuardMinRepeats?: number;
  suggestLoopGuardMaxRegens?: number;
  prompts: {
    system: string;
    continuation: string;
    summary: string;
    [key: string]: string;
  };
}

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  id: 'default',
  name: 'OpenAI (Default)',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  apiKeyEnabled: false,
  timeout: 30,
  modelId: 'gpt-4o',
  temperature: 0.7,
  topP: 0.95,
  maxTokens: 16384,
  presencePenalty: 0,
  frequencyPenalty: 0,
  stop: [],
  seed: undefined,
  topK: undefined,
  minP: undefined,
  extraBody: '',
  presetId: null,
  suggestLoopGuardEnabled: true,
  suggestLoopGuardNgram: 3,
  suggestLoopGuardMinRepeats: 3,
  suggestLoopGuardMaxRegens: 1,
  prompts: { system: '', continuation: '', summary: '' },
};

export interface AppSettings {
  guiLanguage?: string;
  providers: LLMConfig[];
  activeWritingProviderId: string;
  activeChatProviderId: string;
  activeEditingProviderId: string;
  editor: EditorSettings;
  sidebarOpen: boolean;
  activeTab: string;
}

export interface ProjectMetadata {
  id: string;
  title: string;
  type: 'short-story' | 'novel' | 'series';
  updatedAt: number;
  language?: string;
}

export type ConnectionStatus = 'idle' | 'success' | 'error' | 'loading';

export interface ProviderCapabilities {
  is_multimodal: boolean;
  supports_function_calling: boolean;
}

export type MetadataTab = 'summary' | 'notes' | 'private' | 'conflicts' | 'scenes';
