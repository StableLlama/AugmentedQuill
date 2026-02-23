// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the api types unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { Book, Chapter, Conflict, SourcebookEntry } from '../types';

export interface MachineModelConfig {
  name: string;
  base_url: string;
  api_key?: string;
  model: string;
  timeout_s?: number;
  is_multimodal?: boolean;
  supports_function_calling?: boolean;
  prompt_overrides?: Record<string, string>;
}

export interface MachineOpenAIConfig {
  models?: MachineModelConfig[];
  selected?: string;
  selected_chat?: string;
  selected_writing?: string;
  selected_editing?: string;
}

export interface MachineConfigResponse {
  openai?: MachineOpenAIConfig;
}

export interface ProjectListItem {
  name: string;
  title?: string;
  type?: 'short-story' | 'novel' | 'series';
  path?: string;
  is_valid?: boolean;
}

export interface StoryApiPayload {
  project_title?: string;
  story_summary?: string;
  tags?: string[];
  image_style?: string;
  image_additional_info?: string;
  project_type?: 'short-story' | 'novel' | 'series';
  books?: Book[];
  sourcebook?: SourcebookEntry[];
  conflicts?: Conflict[];
  llm_prefs?: {
    prompt_overrides?: Record<string, string>;
    temperature?: number;
    max_tokens?: number;
  };
  chapters?: Array<{
    title?: string;
    summary?: string;
    filename?: string;
    book_id?: string;
    notes?: string;
    private_notes?: string;
    conflicts?: Conflict[];
  }>;
}

export interface ProjectsListResponse {
  current?: string;
  recent?: string[];
  available?: ProjectListItem[];
  projects?: ProjectListItem[];
}

export interface ProjectSelectResponse {
  ok?: boolean;
  message?: string;
  story?: StoryApiPayload | null;
  error?: 'version_outdated' | 'invalid_config' | string;
  error_message?: string;
  current_version?: number;
  required_version?: number;
}

export interface ProjectMutationResponse {
  ok: boolean;
  message?: string;
  detail?: string;
  available?: ProjectListItem[];
  story?: StoryApiPayload;
}

export interface ChapterListItem {
  id: number;
  title: string;
  summary: string;
  filename?: string;
  book_id?: string;
  notes?: string;
  private_notes?: string;
  conflicts?: Conflict[];
}

export interface ChapterListResponse {
  chapters: ChapterListItem[];
}

export interface ChapterDetailResponse {
  id: number;
  title: string;
  filename: string;
  content: string;
  summary: string;
  notes?: string;
  private_notes?: string;
  conflicts?: Conflict[];
}

export interface ChatToolFunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatApiMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface ChatToolExecutionResponse {
  ok: boolean;
  appended_messages: Array<{
    role: 'tool';
    tool_call_id: string;
    name: string;
    content: string;
  }>;
  mutations?: { story_changed?: boolean };
}

export interface ProjectImage {
  filename: string;
  title?: string;
  description?: string;
  url?: string;
  is_placeholder?: boolean;
}

export interface ListImagesResponse {
  images: ProjectImage[];
}

export interface SourcebookUpsertPayload {
  id?: string;
  name: string;
  synonyms: string[];
  category?: string;
  description: string;
  images: string[];
}

export interface DebugLogEntry {
  id: string;
  model_type?: string;
  timestamp_start: string;
  timestamp_end: string | null;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
  };
  response: {
    status_code: number | null;
    body?: unknown;
    streaming?: boolean;
    chunks?: unknown[];
    full_content?: string;
    error?: unknown;
    tool_calls?: unknown[];
  } | null;
}

export const mapChapterListItemToChapter = (item: ChapterListItem): Chapter => ({
  id: String(item.id),
  title: item.title,
  summary: item.summary,
  content: '',
  filename: item.filename,
  book_id: item.book_id,
  notes: item.notes,
  private_notes: item.private_notes,
  conflicts: item.conflicts,
});
