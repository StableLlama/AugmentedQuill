// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the types unit so this responsibility stays isolated, testable, and easy to evolve.
 */

export interface Conflict {
  id: string; // or something simple
  description: string;
  resolution: string;
}

export interface Chapter {
  id: string;
  title: string;
  summary: string;
  content: string;
  filename?: string;
  book_id?: string;
  notes?: string;
  private_notes?: string;
  conflicts?: Conflict[];
}

export interface Book {
  id: string;
  title: string;
  chapters: Chapter[];
  summary?: string;
  notes?: string;
  private_notes?: string;
}

export interface SourcebookEntry {
  id: string;
  name: string;
  synonyms: string[];
  category?: string;
  description: string;
  images: string[];
}

export interface Story {
  title: string;
  summary: string;
  notes?: string;
  private_notes?: string;
  styleTags: string[];
  image_style?: string;
  image_additional_info?: string;
  chapters: Chapter[];
  projectType: 'short-story' | 'novel' | 'series';
  books?: Book[];
  sourcebook?: SourcebookEntry[];
  llm_prefs?: {
    prompt_overrides?: Record<string, string>;
  };
}

export interface StoryState extends Story {
  id: string; // Added ID for project management
  currentChapterId: string | null;
  lastUpdated?: number;
  conflicts?: Conflict[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'tool';
  text: string;
  thinking?: string;
  isError?: boolean;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
  traceback?: string;
}

export interface ChatToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  messages?: ChatMessage[];
  systemPrompt?: string;
  isIncognito?: boolean;
  allowWebSearch?: boolean;
}

export type ViewMode = 'raw' | 'markdown' | 'wysiwyg';

export type AppTheme = 'light' | 'mixed' | 'dark';

export interface EditorSettings {
  fontSize: number;
  maxWidth: number;
  brightness: number; // 0.5 - 1.0
  contrast: number; // 0.5 - 1.0
  theme: AppTheme;
  sidebarWidth: number;
}

export interface LLMConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  timeout: number;
  modelId: string;
  temperature?: number;
  topP?: number;
  isMultimodal?: boolean | null; // null/undefined = auto-detect
  supportsFunctionCalling?: boolean | null; // null/undefined = auto-detect
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
  timeout: 30000,
  modelId: 'gpt-4o',
  temperature: 0.7,
  topP: 0.95,
  prompts: { system: '', continuation: '', summary: '' },
};

export interface AppSettings {
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
}

// Tool definitions
export const TOOLS = [
  {
    name: 'update_chapter_content',
    description:
      'Update the text content of the currently selected chapter. Use this when the user asks to write, rewrite, or edit the story text.',
    parameters: {
      type: 'OBJECT',
      properties: {
        content: {
          type: 'STRING',
          description: 'The full new content for the chapter.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'create_chapter',
    description: 'Create a new chapter in the story.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'The title of the new chapter.',
        },
        summary: {
          type: 'STRING',
          description: 'A brief summary of what happens in this chapter.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_chapter_summary',
    description: 'Update the summary of the current chapter.',
    parameters: {
      type: 'OBJECT',
      properties: {
        summary: {
          type: 'STRING',
          description: 'The new summary of the chapter.',
        },
      },
      required: ['summary'],
    },
  },
];
