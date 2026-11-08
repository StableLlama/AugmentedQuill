// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * HTTP client for the scenes endpoints. Keeps transport concerns isolated from UI logic.
 */

import type { Scene, SceneChronologyTime, SceneId, SceneProseLink } from '../../types';
import {
  fetchJson,
  postJson,
  putJson,
  patchJson,
  deleteJson,
  postSse,
  projectEndpoint,
} from './shared';
import type { SseEvent } from './shared';

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface SceneCreatePayload {
  summary?: string;
  beats?: Array<{ id: string; text: string; prose_link?: SceneProseLink | null }>;
  active_characters?: string[];
  passive_characters?: string[];
  sourcebook_entry_ids?: string[];
  location?: string | null;
  time?: string | null;
  scene_time?: SceneChronologyTime | null;
  timeline_id?: string;
  color_tag?: string | null;
  prose_link?: SceneProseLink | null;
  causes?: SceneId[];
  order_index?: number;
  pinboard_x?: number;
  pinboard_y?: number;
  status?: string;
}

export type SceneUpdatePayload = Partial<SceneCreatePayload>;

export interface LinkProsePayload {
  scope_type: string;
  chapter_id?: string | null;
  book_id?: string | null;
  start_offset: number;
  end_offset: number;
}

export interface ReorderProsePayload {
  source_scene_id: SceneId;
  target_scene_id: SceneId;
  place_before: boolean;
}

export interface ReorderProseResponse {
  scenes: Scene[];
  scope_type: string;
  chapter_id?: string | null;
  book_id?: string | null;
  scope_start: number;
  scope_end: number;
  rebuilt_text: string;
}

export interface SceneBoundaryAssignment {
  scene_id: SceneId;
  start_offset: number;
  end_offset: number;
}

export interface BatchLinkProsePayload {
  scope_type: string;
  chapter_id?: string | null;
  book_id?: string | null;
  assignments: SceneBoundaryAssignment[];
  unlink_ids?: SceneId[];
}

export interface DetectBoundariesPayload {
  scope_type: 'story' | 'chapter' | 'unlinked';
  chapter_id?: string | null;
  book_id?: string | null;
  scene_ids: SceneId[];
  start_offset: number;
  end_offset?: number | null;
  prose_text?: string | null;
}

export interface DetectBoundariesResponse {
  assignments: SceneBoundaryAssignment[];
  scenes: Scene[];
}

export interface AutoLinkScopePayload {
  scope_type: 'story' | 'chapter' | 'unlinked';
  chapter_id?: string | null;
  book_id?: string | null;
  current_text: string;
}

export interface AutoLinkScopeResponse {
  assignments: SceneBoundaryAssignment[];
  scenes: Scene[];
}

export interface SceneWritePayload {
  scope_type?: 'story' | 'chapter' | 'unlinked';
  chapter_id?: string | null;
  book_id?: string | null;
  include_following_scenes?: number;
  detect_boundaries?: boolean;
}

export interface SceneWriteResponse {
  scene: Scene;
  generated_text: string;
  assignments: SceneBoundaryAssignment[];
  scenes: Scene[];
}

/** Derived scene field that can be regenerated from another field. */
export type SceneFieldTarget = 'summary' | 'beats';
/** Scene field used as the source material for a regeneration. */
export type SceneFieldSource = 'beats' | 'summary' | 'prose';

export interface SceneFieldGeneratePayload {
  target: SceneFieldTarget;
  source: SceneFieldSource;
  /** In-editor (unsaved) summary, when the source is the summary. */
  summary?: string;
  /** In-editor (unsaved) beats, when the source is the beats. */
  beats?: Array<{
    id: string;
    text: string;
    prose_link?: SceneProseLink | null;
  }>;
  /** In-editor (unsaved) prose, when the source is the prose. */
  prose?: string;
}

export interface SceneFieldGenerateResponse {
  target: SceneFieldTarget;
  text: string;
  beats: Array<{
    id: string;
    text: string;
    prose_link?: SceneProseLink | null;
  }>;
}

// ---------------------------------------------------------------------------
// API interface
// ---------------------------------------------------------------------------

export interface ScenesApi {
  list: () => Promise<Scene[]>;
  create: (payload: SceneCreatePayload) => Promise<Scene>;
  get: (sceneId: SceneId) => Promise<Scene>;
  update: (sceneId: SceneId, payload: SceneUpdatePayload) => Promise<Scene>;
  delete: (sceneId: SceneId) => Promise<void>;
  linkProse: (sceneId: SceneId, payload: LinkProsePayload) => Promise<Scene[]>;
  unlinkProse: (sceneId: SceneId) => Promise<Scene[]>;
  batchLinkProse: (payload: BatchLinkProsePayload) => Promise<Scene[]>;
  reorderProse: (payload: ReorderProsePayload) => Promise<ReorderProseResponse>;
  updateProseContent: (sceneId: SceneId, text: string) => Promise<Scene>;
  detectBoundaries: (
    payload: DetectBoundariesPayload
  ) => Promise<DetectBoundariesResponse>;
  autoLinkScope: (payload: AutoLinkScopePayload) => Promise<AutoLinkScopeResponse>;
  writeScene: (
    sceneId: SceneId,
    payload: SceneWritePayload
  ) => Promise<SceneWriteResponse>;
  /**
   * Stream scene prose generation.
   *
   * *onProse* receives the accumulated prose live and *onThinking* receives the
   * accumulated reasoning, which keeps the UI responsive while a thinking
   * model works before its first prose token arrives.
   */
  streamWriteScene: (
    sceneId: SceneId,
    payload: SceneWritePayload,
    onProse?: (accumulated: string) => void,
    onThinking?: (accumulated: string) => void,
    signal?: AbortSignal
  ) => Promise<SceneWriteResponse>;
  /**
   * Stream regeneration of a derived scene field (summary or beats) from
   * another field; onChunk receives the accumulated text live and onThinking
   * receives the accumulated reasoning.
   */
  streamGenerateField: (
    sceneId: SceneId,
    payload: SceneFieldGeneratePayload,
    onChunk?: (accumulated: string) => void,
    onThinking?: (accumulated: string) => void,
    signal?: AbortSignal
  ) => Promise<SceneFieldGenerateResponse>;
}

type WriteSceneStreamEvent =
  | { type: 'thinking'; accumulated?: string }
  | { type: 'prose_chunk'; accumulated?: string }
  | {
      type: 'result';
      scene: Scene;
      generated_text: string;
      assignments: SceneBoundaryAssignment[];
      scenes: Scene[];
    }
  | { type: 'error'; error?: string };

type FieldGenerateStreamEvent =
  | { type: 'thinking'; accumulated?: string }
  | { type: 'chunk'; accumulated?: string }
  | {
      type: 'result';
      target: SceneFieldTarget;
      text: string;
      beats: SceneFieldGenerateResponse['beats'];
    }
  | { type: 'error'; error?: string };

/**
 * Read the write-scene SSE stream, forwarding accumulated prose to *onProse*
 * and resolving once the final ``result`` event arrives.
 */
async function streamWriteSceneProse(
  projectName: string,
  sceneId: SceneId,
  payload: SceneWritePayload,
  onProse?: (accumulated: string) => void,
  onThinking?: (accumulated: string) => void,
  signal?: AbortSignal
): Promise<SceneWriteResponse> {
  return postSse<SceneWriteResponse>(
    projectEndpoint(projectName, `/scenes/${sceneId}/write/stream`),
    payload,
    {
      onEvent: (event: SseEvent): void => {
        const typed = event as WriteSceneStreamEvent;
        if (typed.type === 'thinking') {
          onThinking?.(typed.accumulated ?? '');
        } else if (typed.type === 'prose_chunk') {
          onProse?.(typed.accumulated ?? '');
        }
      },
      selectResult: (event: SseEvent): SceneWriteResponse | undefined => {
        const typed = event as WriteSceneStreamEvent;
        if (typed.type !== 'result') return undefined;
        return {
          scene: typed.scene,
          generated_text: typed.generated_text,
          assignments: typed.assignments,
          scenes: typed.scenes,
        };
      },
      selectError: (event: SseEvent): Error | undefined => {
        const typed = event as WriteSceneStreamEvent;
        return typed.type === 'error'
          ? new Error(typed.error || 'Write scene failed')
          : undefined;
      },
    },
    'Write scene stream failed',
    signal
  );
}

/**
 * Read the derived-field SSE stream, forwarding accumulated text to *onChunk*
 * and resolving once the final ``result`` event arrives.
 */
async function streamGenerateFieldRequest(
  projectName: string,
  sceneId: SceneId,
  payload: SceneFieldGeneratePayload,
  onChunk?: (accumulated: string) => void,
  onThinking?: (accumulated: string) => void,
  signal?: AbortSignal
): Promise<SceneFieldGenerateResponse> {
  return postSse<SceneFieldGenerateResponse>(
    projectEndpoint(projectName, `/scenes/${sceneId}/generate/stream`),
    payload,
    {
      onEvent: (event: SseEvent): void => {
        const typed = event as FieldGenerateStreamEvent;
        if (typed.type === 'thinking') {
          onThinking?.(typed.accumulated ?? '');
        } else if (typed.type === 'chunk') {
          onChunk?.(typed.accumulated ?? '');
        }
      },
      selectResult: (event: SseEvent): SceneFieldGenerateResponse | undefined => {
        const typed = event as FieldGenerateStreamEvent;
        if (typed.type !== 'result') return undefined;
        return { target: typed.target, text: typed.text, beats: typed.beats };
      },
      selectError: (event: SseEvent): Error | undefined => {
        const typed = event as FieldGenerateStreamEvent;
        return typed.type === 'error'
          ? new Error(typed.error || 'Field generation failed')
          : undefined;
      },
    },
    'Field generation stream failed',
    signal
  );
}

export const createScenesApi = (projectName: string): ScenesApi => {
  const base = projectEndpoint(projectName, '/scenes');

  return {
    list: (): Promise<Scene[]> =>
      fetchJson<Scene[]>(base, undefined, 'Failed to load scenes'),

    create: (payload: SceneCreatePayload): Promise<Scene> =>
      postJson<Scene>(base, payload, 'Failed to create scene'),

    get: (sceneId: SceneId): Promise<Scene> =>
      fetchJson<Scene>(`${base}/${sceneId}`, undefined, 'Failed to load scene'),

    update: (sceneId: SceneId, payload: SceneUpdatePayload): Promise<Scene> =>
      putJson<Scene>(`${base}/${sceneId}`, payload, 'Failed to update scene'),

    delete: (sceneId: SceneId): Promise<void> =>
      deleteJson<void>(`${base}/${sceneId}`, 'Failed to delete scene'),

    linkProse: (sceneId: SceneId, payload: LinkProsePayload): Promise<Scene[]> =>
      postJson<Scene[]>(
        `${base}/${sceneId}/link-prose`,
        payload,
        'Failed to link prose'
      ),

    unlinkProse: (sceneId: SceneId): Promise<Scene[]> =>
      postJson<Scene[]>(
        `${base}/${sceneId}/unlink-prose`,
        {},
        'Failed to unlink prose'
      ),

    batchLinkProse: (payload: BatchLinkProsePayload): Promise<Scene[]> =>
      postJson<Scene[]>(
        `${base}/batch-link-prose`,
        payload,
        'Failed to batch link prose'
      ),

    reorderProse: (payload: ReorderProsePayload): Promise<ReorderProseResponse> =>
      postJson<ReorderProseResponse>(
        `${base}/reorder-prose`,
        payload,
        'Failed to reorder prose'
      ),

    updateProseContent: (sceneId: SceneId, text: string): Promise<Scene> =>
      patchJson<Scene>(
        `${base}/${sceneId}/prose-content`,
        { text },
        'Failed to update prose content'
      ),

    detectBoundaries: (
      payload: DetectBoundariesPayload
    ): Promise<DetectBoundariesResponse> =>
      postJson<DetectBoundariesResponse>(
        `${base}/detect-boundaries`,
        payload,
        'Failed to detect scene boundaries'
      ),

    autoLinkScope: (payload: AutoLinkScopePayload): Promise<AutoLinkScopeResponse> =>
      postJson<AutoLinkScopeResponse>(
        `${base}/auto-link-scope`,
        payload,
        'Failed to auto-link chapter scenes'
      ),

    writeScene: (
      sceneId: SceneId,
      payload: SceneWritePayload
    ): Promise<SceneWriteResponse> =>
      postJson<SceneWriteResponse>(
        `${base}/${sceneId}/write`,
        payload,
        'Failed to write scene prose'
      ),

    streamWriteScene: (
      sceneId: SceneId,
      payload: SceneWritePayload,
      onProse?: (accumulated: string) => void,
      onThinking?: (accumulated: string) => void,
      signal?: AbortSignal
    ): Promise<SceneWriteResponse> =>
      streamWriteSceneProse(projectName, sceneId, payload, onProse, onThinking, signal),

    streamGenerateField: (
      sceneId: SceneId,
      payload: SceneFieldGeneratePayload,
      onChunk?: (accumulated: string) => void,
      onThinking?: (accumulated: string) => void,
      signal?: AbortSignal
    ): Promise<SceneFieldGenerateResponse> =>
      streamGenerateFieldRequest(
        projectName,
        sceneId,
        payload,
        onChunk,
        onThinking,
        signal
      ),
  };
};
