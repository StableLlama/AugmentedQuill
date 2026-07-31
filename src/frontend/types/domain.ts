// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Core domain types – story, chapter, book, and sourcebook entities.
 */

export interface Conflict {
  id: string;
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

export interface WritingUnit {
  id: string;
  scope: 'story' | 'chapter';
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

export interface SourcebookRelation {
  target_id: string;
  direction?: 'forward' | 'reverse';
  relation: string;
  start_scene?: number;
  start_chapter?: string;
  start_book?: string;
  end_scene?: number;
  end_chapter?: string;
  end_book?: string;
}

export interface SourcebookEntry {
  id: string;
  name: string;
  synonyms: string[];
  category?: string;
  description: string;
  images: string[];
  keywords?: string[];
  relations?: SourcebookRelation[];
  origin_date?: string | null;
  destination_datetime?: string | null;
  destination_relative?: string | null;
  creates_new_timeline?: boolean;
  timeline_id?: string | null;
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
  draft: WritingUnit | null;
  projectType: 'short-story' | 'novel' | 'series';
  language?: string;
  books?: Book[];
  sourcebook?: SourcebookEntry[];
  llm_prefs?: {
    prompt_overrides?: Record<string, string>;
  };
}

export interface StoryState extends Story {
  id: string;
  currentChapterId: string | null;
  lastUpdated?: number;
  conflicts?: Conflict[];
  scenes?: Scene[];
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export type SceneId = number;
export type SceneStatus = 'active' | 'inactive' | 'draft';
export type SceneScopeType = 'story' | 'chapter' | 'unlinked';

/** A link between a scene/beat and a prose scope file.

Offsets are computed from inline scene markers at read time and are not
persisted in story.json.
 */
export interface SceneProseLink {
  scope_type: SceneScopeType;
  chapter_id?: string | null;
  book_id?: string | null;
  start_offset: number;
  end_offset?: number | null;
}

export interface SceneBeat {
  id: string;
  text: string;
  prose_link?: SceneProseLink | null;
}

export interface SceneChronologyTime {
  /** RFC9557/Temporal ZonedDateTime string including time zone + calendar. */
  temporal_zoned_datetime: string;
}

export interface Scene {
  id: SceneId;
  summary: string;
  beats: SceneBeat[];
  active_characters: string[];
  passive_characters: string[];
  sourcebook_entry_ids?: string[];
  location?: string | null;
  time?: string | null;
  scene_time?: SceneChronologyTime | null;
  timeline_id?: string;
  color_tag?: string | null;
  prose_link?: SceneProseLink | null;
  causes: SceneId[];
  order_index?: number;
  pinboard_x: number;
  pinboard_y: number;
  status: SceneStatus;
  tag_personal_datetimes?: SceneTagPersonalDatetime[];
}

export interface SceneTagPersonalDatetime {
  role: 'active' | 'passive' | 'sourcebook';
  ref: string;
  index: number;
  personal_age: string;
}
