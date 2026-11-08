// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Near full-screen modal for editing scene properties.
 * Includes sourcebook-aware tag inputs and Temporal-based timeline time.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MessageSquareDiff,
} from 'lucide-react';
import { FloatingDiffToolbar } from '../editor/FloatingDiffToolbar';
import type {
  Scene,
  SceneBeat,
  SceneProseLink,
  SceneTagPersonalDatetime,
  SourcebookEntry,
  SceneId,
  StoryState,
  EditorSettings,
} from '../../types';
import type { Chapter, Book } from '../../types/domain';
import { useTheme, useThemeClasses } from '../layout/ThemeContext';
import { useFocusTrap } from '../layout/useFocusTrap';
import {
  CodeMirrorEditor,
  type EditorHighlightColors,
} from '../editor/CodeMirrorEditor';
import { getEditorHighlightColors } from '../editor/highlightColors';
import { getPaperColors } from '../editor/paperColors';
import { DiffViewTabs, type DiffViewTab } from './DiffViewTabs';
import { Button } from '../../components/ui/Button';
import type { EditorView } from '@codemirror/view';
import {
  useScenes,
  useStoryLanguage,
  useStoryStore,
  useStoryMeta,
  useStoryChaptersListMeta,
  useStoryBooks,
} from '../../stores/storyStore';
import type { StoryStoreState } from '../../stores/storyStore';
import { SourcebookHoverCard } from '../sourcebook/SourcebookHoverCard';
import { listProjectImages } from '../sourcebook/sourcebookApi';
import { ProjectImage } from '../../services/apiTypes';
import { notifyError } from '../../services/errorNotifier';
import { SceneTemporalDialog } from './SceneTemporalDialog';
import {
  getSceneEpochNanoseconds,
  buildChapterOrderMap,
  proseSort,
  chronologicalSort,
  sceneIdCompare,
  normalizeChapterId,
} from './sceneSortUtils';
import { buildSceneTimelineOptions } from './timelineOptions';
import { diffSceneBeats, type SceneBeatDiffEntry } from './sceneBeatDiff';
import { getSceneProseFromContent, isLinkedProseLink } from './proseLinkCoordinates';
import {
  parseZonedDateTime,
  toDisplayString,
  toInternationalDisplayString,
} from '../../utils/temporal';

const COLOR_TAGS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
];
const COLOR_SWATCH: Record<string, string> = {
  red: 'bg-red-400',
  orange: 'bg-orange-400',
  yellow: 'bg-yellow-400',
  green: 'bg-green-400',
  teal: 'bg-teal-400',
  blue: 'bg-blue-400',
  purple: 'bg-purple-400',
  pink: 'bg-pink-400',
};
const EMPTY_SOURCEBOOK: SourcebookEntry[] = [];

type CharToken = {
  name: string;
  personal_age: string | null;
};

type AgeEditTarget =
  | { type: 'active_tag'; index: number }
  | { type: 'passive_tag'; index: number }
  | { type: 'sourcebook_tag'; entryId: string };

type PersonalStateOption = {
  value: string;
  label: string;
};

type TemporalEditTarget = { type: 'scene' };

type DirtySnapshot = {
  summary: string;
  beats: string;
  activeTokens: string;
  passiveTokens: string;
  sourcebookIds: string[];
  colorTag: string | null;
  status: Scene['status'];
  sceneTimeValue: string | null;
  timelineId: string;
};

const MAIN_TIMELINE_ID = 'main';

const normalizeTimelineId = (value: string | null | undefined): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : MAIN_TIMELINE_ID;
};

const getBranchTimelineId = (entryId: string): string => `branch:${entryId}`;

function getScopedBaselineContent(
  baselineState: StoryState,
  link: SceneProseLink | null | undefined
): string | null {
  if (!link) return null;
  if (link.scope_type === 'story') {
    return baselineState.draft?.content ?? null;
  }
  if (link.scope_type === 'chapter') {
    const targetId = normalizeChapterId(link.chapter_id);
    if (!targetId) return null;
    const chapter = baselineState.chapters.find(
      (candidate: Chapter): boolean => normalizeChapterId(candidate.id) === targetId
    );
    return chapter?.content ?? null;
  }
  return null;
}

/**
 * Baseline prose shown in the scene editor's diff view for a scene.
 *
 * Returns ``''`` when the scene had no prose at baseline time, otherwise the
 * visible prose the scene owned in the baseline snapshot.  It never returns
 * ``undefined``: without a baseline the diff decorations silently disappear
 * (the editor had nothing to diff against), so a change made in the dialog
 * looked unhighlighted even though the diff view was active.
 *
 * The slice is derived from the scene's **markers inside the baseline content**
 * (via ``getSceneProseFromContent``), not from the stored ``prose_link``
 * offsets: those go stale as soon as the document shrinks (for example after
 * the user deletes all text), and slicing with them leaked marker tokens into
 * the diff — which silently disabled the "freshly generated" highlight.
 *
 * When the baseline content is not loaded in memory (lazily loaded chapter /
 * story or an unsynced baseline), fall back to ``atOpenText``: the prose the
 * scene had when the dialog opened is exactly the pre-write baseline a
 * freshly generated passage must be diffed against.
 */
function resolveSceneProseBaseline(params: {
  baselineScene: Scene | null;
  baselineStoryState: StoryState;
  sceneId: SceneId;
  openedViaTrigger: boolean;
  atOpenText: string;
}): string {
  const { baselineScene, baselineStoryState, sceneId, openedViaTrigger, atOpenText } =
    params;
  if (!baselineScene) {
    // The scene did not exist in the baseline snapshot.  When opened from an
    // AI mutation every character of the current prose is new; on a normal open
    // keep the text captured when the dialog opened (in-dialog writes).
    return openedViaTrigger ? '' : atOpenText;
  }
  const baselineLink = baselineScene.prose_link ?? null;
  if (!isLinkedProseLink(baselineLink)) {
    // The baseline scene existed but had no linked prose yet (planning-only
    // `unlinked` scope or no link), so the current prose is entirely added.
    return '';
  }
  const scoped = getScopedBaselineContent(baselineStoryState, baselineLink);
  if (scoped === null) {
    return openedViaTrigger ? '' : atOpenText;
  }
  return getSceneProseFromContent(scoped, sceneId, baselineLink) ?? '';
}

type AgeInfo = {
  compact: string;
  detailed: string;
};

type AgeParts = {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

const addUnits = (
  parts: string[],
  values: Array<{ value: number; suffix: string }>
): void => {
  values.forEach((item: { value: number; suffix: string }): void => {
    const { value, suffix } = item;
    if (value > 0) {
      parts.push(`${value}${suffix}`);
    }
  });
};

const isAgeAtLeastTenDays = (parts: AgeParts): boolean => {
  return parts.years > 0 || parts.months > 0 || parts.days >= 10;
};

/** True when an error is the user cancelling an in-flight request. */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'AbortError'
  );
}

const isAgeMoreThanTwentyFourHours = (parts: AgeParts): boolean => {
  if (parts.years > 0 || parts.months > 0) return true;
  if (parts.days > 1) return true;
  if (parts.days === 1) {
    return parts.hours > 0 || parts.minutes > 0 || parts.seconds > 0;
  }
  return false;
};

const formatDetailedAgeLabel = (parts: AgeParts): string => {
  const values: string[] = [];
  if (isAgeAtLeastTenDays(parts)) {
    addUnits(values, [
      { value: parts.years, suffix: 'y' },
      { value: parts.months, suffix: 'm' },
      { value: parts.days, suffix: 'd' },
    ]);
    return values.length > 0 ? values.join(' ') : '0d';
  }

  if (isAgeMoreThanTwentyFourHours(parts)) {
    addUnits(values, [
      { value: parts.days, suffix: 'd' },
      { value: parts.hours, suffix: 'h' },
    ]);
    return values.length > 0 ? values.join(' ') : '0h';
  }

  addUnits(values, [
    { value: parts.hours, suffix: 'h' },
    { value: parts.minutes, suffix: 'm' },
    { value: parts.seconds, suffix: 's' },
  ]);
  return values.length > 0 ? values.join(' ') : '0s';
};

const formatCompactAgeLabel = (parts: AgeParts): string | null => {
  if (parts.years > 0) return `${parts.years}y`;
  if (parts.months > 0) return `${parts.months}m`;
  if (parts.days > 0) return `${parts.days}d`;
  if (parts.hours > 0) return `${parts.hours}h`;
  if (parts.minutes > 0) return `${parts.minutes}min`;
  if (parts.seconds > 0) return `${parts.seconds}s`;
  return null;
};

const calculateEntryAgeInfo = (
  originDate: string | null | undefined,
  sceneTime: ReturnType<typeof parseZonedDateTime>
): AgeInfo | null => {
  const origin = parseZonedDateTime(originDate);
  if (!origin || !sceneTime) return null;

  let negative = false;
  let start = origin;
  let end = sceneTime;
  if (sceneTime.epochNanoseconds < origin.epochNanoseconds) {
    negative = true;
    start = sceneTime;
    end = origin;
  }

  try {
    const startInstant = start.toInstant();
    const endInstant = end.toInstant();

    const instantDuration = startInstant.until(endInstant, {
      smallestUnit: 'seconds',
    });

    // Always compute Y/M/D on an ISO timeline from instants so long spans do not
    // degrade into raw day counts when original calendar math is incompatible.
    const isoStart = startInstant.toZonedDateTimeISO('UTC');
    const isoEnd = endInstant.toZonedDateTimeISO('UTC');
    const isoDuration = isoStart.until(isoEnd, {
      largestUnit: 'years',
      smallestUnit: 'days',
    });

    const totalSeconds = Math.abs(instantDuration.total({ unit: 'seconds' }));
    const totalDays = Math.floor(totalSeconds / 86400);
    const remainderAfterDays = totalSeconds % 86400;
    const hours = Math.floor(remainderAfterDays / 3600);
    const remainderAfterHours = remainderAfterDays % 3600;
    const minutes = Math.floor(remainderAfterHours / 60);
    const seconds = Math.floor(remainderAfterHours % 60);
    const years = Math.abs(isoDuration.years);
    const months = Math.abs(isoDuration.months);
    const calendarDays = Math.abs(isoDuration.days) + Math.abs(isoDuration.weeks) * 7;

    const compactParts: AgeParts = {
      years,
      months,
      days: totalDays,
      hours,
      minutes,
      seconds,
    };

    const detailedParts: AgeParts = {
      years,
      months,
      days: calendarDays,
      hours,
      minutes,
      seconds,
    };

    const compact = formatCompactAgeLabel(compactParts);
    if (!compact) return null;
    const detailed = formatDetailedAgeLabel(detailedParts);
    return {
      compact: negative ? `-${compact}` : compact,
      detailed: negative ? `-${detailed}` : detailed,
    };
  } catch {
    return null;
  }
};

const parseEpochNanoseconds = (value: string | null | undefined): bigint | null => {
  const parsed = parseZonedDateTime(value);
  return parsed === null ? null : parsed.epochNanoseconds;
};

const PERSONAL_STATE_PREFIX = 'state:';
const PERSONAL_STATE_ORIGINAL = 'original';

const encodePersonalStateValue = (order: number, stateId: string): string => {
  return `${PERSONAL_STATE_PREFIX}${order.toString().padStart(4, '0')}:${stateId}`;
};

const parsePersonalStateValue = (
  value: string | null | undefined
): { order: number; stateId: string } | null => {
  if (!value || !value.startsWith(PERSONAL_STATE_PREFIX)) return null;
  const payload = value.slice(PERSONAL_STATE_PREFIX.length);
  const sep = payload.indexOf(':');
  if (sep < 0) return null;
  const orderRaw = payload.slice(0, sep);
  const stateId = payload.slice(sep + 1);
  const order = Number.parseInt(orderRaw, 10);
  if (!Number.isFinite(order) || stateId.length === 0) return null;
  return { order, stateId };
};

interface SceneEditorDialogProps {
  scene: Scene;
  isOpen: boolean;
  sceneChangeHint?: {
    changedFields?: string[];
    previousValues?: Record<string, unknown>;
  } | null;
  onClose: () => void;
  onSave: (updates: Partial<Omit<Scene, 'id'>>) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Removes the causal link from fromId to toId. */
  onDeleteCause?: (fromId: SceneId, toId: SceneId) => Promise<void>;
  /** Returns the current prose text for a given link, or null if unavailable. */
  getLinkedProseText?: (link: SceneProseLink) => string | null;
  /** Saves new prose content back to the file at the link range. */
  onSaveProseContent?: (text: string) => Promise<void>;
  /**
   * Generates prose for this scene and links the result.
   *
   * *onProse* receives streamed prose live and *onThinking* receives the
   * accumulated reasoning so the dialog shows progress while a thinking model
   * is still working.
   */
  onWriteScene?: (
    onProse?: (text: string) => void,
    onThinking?: (text: string) => void,
    signal?: AbortSignal
  ) => Promise<string | null | void>;
  /**
   * Streams regeneration of a derived scene field (summary or beats) from
   * another field. ``onChunk`` receives the accumulated text live.
   */
  onGenerateSceneField?: (
    request: SceneFieldGenerateRequest
  ) => Promise<SceneFieldGenerateResult | null>;
  /** Unlinks the scene from its current prose range. */
  onUnlinkProse?: (sceneId: SceneId) => Promise<void>;
  /** Open sourcebook dialog for an entry id. */
  onOpenSourcebookEntry?: (entryId: string) => void;
  openedViaTrigger?: boolean;
  defaultShowDiff?: boolean;
  summaryEditorRef?: React.Ref<EditorView | null>;
  linkedProseEditorRef?: React.Ref<EditorView | null>;
  onNavigateScene?: (sceneId: SceneId) => void;
  viewMode?: 'pinboard' | 'narrative' | 'chronological' | 'convergence-map';
  /** Editor appearance settings (theme / brightness / contrast) used to render
   * the dialog's paper-like content fields exactly like the main paper. */
  editorSettings?: EditorSettings;
}

/** Derived scene field that can be regenerated from another field. */
export type SceneFieldGenerateTarget = 'summary' | 'beats';
/** Scene field used as the source material for a regeneration. */
export type SceneFieldGenerateSource = 'beats' | 'summary' | 'prose';

export interface SceneFieldGenerateRequest {
  target: SceneFieldGenerateTarget;
  source: SceneFieldGenerateSource;
  /** The scene's current (possibly unsaved) summary. */
  summary: string;
  /** The scene's current (possibly unsaved) beats. */
  beats: SceneBeat[];
  /** The scene's current (possibly unsaved) linked prose. */
  prose: string;
  /** Receives the accumulated generated text while streaming. */
  onChunk?: (accumulated: string) => void;
  /** Receives the accumulated reasoning while a thinking model runs. */
  onThinking?: (accumulated: string) => void;
  /** Aborts the in-flight generation when the user presses Stop. */
  signal?: AbortSignal;
}

export interface SceneFieldGenerateResult {
  target: SceneFieldGenerateTarget;
  text: string;
  beats: SceneBeat[];
}

const normalizeToken = (value: string): string => value.trim().toLowerCase();
const normalizeCategory = (value: string | null | undefined): string =>
  normalizeToken(value ?? '');
const isCharacterEntry = (entry?: SourcebookEntry): boolean =>
  Boolean(entry && normalizeCategory(entry.category) === 'character');

const mapCategoryLabel = (category: string | undefined): string => {
  if (!category) return 'OTHER';
  return category.toUpperCase();
};

const arraysEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length &&
  a.every((value: string, index: number) => value === b[index]);

const idArraysEqualAsSet = (a: SceneId[], b: SceneId[]): boolean => {
  const normalizedA = [...new Set(a)].sort((x: SceneId, y: SceneId) => x - y);
  const normalizedB = [...new Set(b)].sort((x: SceneId, y: SceneId) => x - y);
  return (
    normalizedA.length === normalizedB.length &&
    normalizedA.every((value: SceneId, index: number) => value === normalizedB[index])
  );
};

/** Beats (text, order, count) differ between the scene and its baseline. */
function sceneBeatsDiffer(scene: Scene, baselineScene: Scene): boolean {
  return !arraysEqual(
    (scene.beats ?? []).map((beat: SceneBeat) => beat.text),
    (baselineScene.beats ?? []).map((beat: SceneBeat) => beat.text)
  );
}

/** Character / sourcebook tag lists differ between the scene and its baseline. */
function sceneTagListsDiffer(scene: Scene, baselineScene: Scene): boolean {
  return (
    !arraysEqual(
      scene.active_characters ?? [],
      baselineScene.active_characters ?? []
    ) ||
    !arraysEqual(
      scene.passive_characters ?? [],
      baselineScene.passive_characters ?? []
    ) ||
    !arraysEqual(
      scene.sourcebook_entry_ids ?? [],
      baselineScene.sourcebook_entry_ids ?? []
    )
  );
}

/** Temporal / styling / status fields differ between the scene and its baseline. */
function sceneTemporalStateDiffers(scene: Scene, baselineScene: Scene): boolean {
  if (
    (scene.scene_time?.temporal_zoned_datetime ?? null) !==
    (baselineScene.scene_time?.temporal_zoned_datetime ?? null)
  ) {
    return true;
  }
  if (
    normalizeTimelineId(scene.timeline_id) !==
    normalizeTimelineId(baselineScene.timeline_id)
  ) {
    return true;
  }
  if ((scene.color_tag ?? null) !== (baselineScene.color_tag ?? null)) return true;
  // Older baseline payloads may omit `status`; only compare when present so a
  // missing field never reads as "changed".
  return baselineScene.status !== undefined && scene.status !== baselineScene.status;
}

/** Scalar / list metadata differs between the scene and its baseline. */
function sceneMetadataDiffers(scene: Scene, baselineScene: Scene): boolean {
  return (
    (scene.summary ?? '') !== (baselineScene.summary ?? '') ||
    sceneTagListsDiffer(scene, baselineScene) ||
    sceneTemporalStateDiffers(scene, baselineScene)
  );
}

/**
 * True when any scene field differs from the baseline snapshot.
 *
 * The scene editor shows diff markers for every section (summary, beats,
 * characters, temporal data, linked prose, …).  That view must switch on
 * whenever there *is* a pending change — not only for AI-triggered opens.
 * A chat tool like ``manage_scenes(action='update')`` changes beats while the
 * user later opens the dialog themselves, and those edits were invisible
 * because the diff mode was keyed on the trigger only.
 */
function sceneFieldsDiffer(params: {
  scene: Scene;
  baselineScene: Scene | null;
  baselineStoryState: StoryState;
  openedViaTrigger: boolean;
  atOpenProse: string;
}): boolean {
  const { scene, baselineScene, baselineStoryState, openedViaTrigger, atOpenProse } =
    params;
  if (!baselineScene) {
    // The scene did not exist at baseline time: everything is new, which is
    // only a meaningful diff when the dialog was opened from an AI mutation.
    return openedViaTrigger;
  }
  if (sceneBeatsDiffer(scene, baselineScene)) return true;
  if (sceneMetadataDiffers(scene, baselineScene)) return true;
  const proseBaseline = resolveSceneProseBaseline({
    baselineScene,
    baselineStoryState,
    sceneId: scene.id,
    openedViaTrigger,
    atOpenText: atOpenProse,
  });
  return proseBaseline !== atOpenProse;
}

/* eslint-disable complexity, max-lines-per-function */
export const SceneEditorDialog: React.FC<SceneEditorDialogProps> = ({
  scene,
  isOpen,
  sceneChangeHint = null,
  onClose,
  onSave,
  onDelete,
  onDeleteCause,
  getLinkedProseText,
  onSaveProseContent,
  onWriteScene,
  onGenerateSceneField,
  onUnlinkProse,
  onOpenSourcebookEntry,
  openedViaTrigger = false,
  defaultShowDiff = false,
  summaryEditorRef,
  linkedProseEditorRef,
  onNavigateScene,
  viewMode = 'narrative',
  editorSettings,
}: SceneEditorDialogProps) => {
  const { t, i18n } = useTranslation();
  const tcBase = useThemeClasses();
  const { currentTheme } = useTheme();
  // Softer typography for the dark/mixed chrome: body text uses the gentle
  // gray-300 (not the harsher gray-100) like every other dialog in the app.
  const tc = useMemo(
    () => ({
      ...tcBase,
      text: tcBase.isLight ? 'text-brand-gray-900' : 'text-brand-gray-300',
    }),
    [tcBase]
  );
  // The dialog's content fields follow the app's "paper" scheme exactly like
  // the main editor, driven by the same theme / brightness / contrast
  // settings, so the "paper" inputs behave identically to the writing paper.
  // The chrome (header, labels, borders) stays on the standard dialog surface.
  const paperTheme = editorSettings?.theme ?? currentTheme;
  const paperBrightness = editorSettings?.brightness ?? 0.85;
  const paperContrast = editorSettings?.contrast ?? 0.85;
  const contentSurface = useMemo<React.CSSProperties>(() => {
    const paper = getPaperColors(paperTheme, paperBrightness, paperContrast);
    return { backgroundColor: paper.backgroundColor, color: paper.textColor };
  }, [paperTheme, paperBrightness, paperContrast]);
  // Diff highlight tokens are tuned for the paper the content actually sits on
  // (cream vs dark), identical to how the main editor picks its tokens.
  const highlightColors = useMemo(
    (): EditorHighlightColors => getEditorHighlightColors(paperTheme === 'dark'),
    [paperTheme]
  );
  // Beat rows are tinted with the same translucent insert/delete tokens the
  // editor uses, layered over the paper colour.  Theme classes alone (the old
  // `bg-brand-gray-800/40`) were invisible against the dark dialog chrome, so
  // an AI-added beat showed no highlight at all even though the diff was active.
  const beatDiffSurface = (kind: 'added' | 'removed'): React.CSSProperties => {
    const tint =
      kind === 'added' ? highlightColors.diffInsertBg : highlightColors.diffDeleteBg;
    return {
      ...contentSurface,
      backgroundImage: `linear-gradient(${tint}, ${tint})`,
      borderLeft: `3px solid ${
        kind === 'added'
          ? highlightColors.diffInsertBorder
          : highlightColors.diffDeleteBorder
      }`,
    };
  };
  // Diff/Old/New tabs per content field (reset when the dialog opens for a
  // different scene).
  const [summaryTab, setSummaryTab] = useState<DiffViewTab>('diff');
  const [linkedProseTab, setLinkedProseTab] = useState<DiffViewTab>('diff');
  const storyLanguage = useStoryLanguage();
  const allScenes = useScenes();
  const { projectType } = useStoryMeta();
  const chapters = useStoryChaptersListMeta();
  const books = useStoryBooks();
  const sourcebookEntriesMaybe = useStoryStore(
    (s: StoryStoreState): SourcebookEntry[] => s.story.sourcebook ?? []
  );
  const sourcebookEntries = Array.isArray(sourcebookEntriesMaybe)
    ? sourcebookEntriesMaybe
    : EMPTY_SOURCEBOOK;
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(isOpen, dialogRef, onClose);

  const entryById = useMemo(
    (): Map<string, SourcebookEntry> =>
      new Map(sourcebookEntries.map((entry: SourcebookEntry) => [entry.id, entry])),
    [sourcebookEntries]
  );
  const entryByName = useMemo((): Map<string, SourcebookEntry> => {
    const map = new Map<string, SourcebookEntry>();
    sourcebookEntries.forEach((entry: SourcebookEntry): void => {
      map.set(normalizeToken(entry.name), entry);
      (entry.synonyms ?? []).forEach((synonym: string): void => {
        map.set(normalizeToken(synonym), entry);
      });
    });
    return map;
  }, [sourcebookEntries]);

  const baselineScene = useStoryStore(
    (s: StoryStoreState): Scene | null =>
      s.baselineState.scenes?.find((candidate: Scene) => candidate.id === scene.id) ??
      null
  );
  const baselineScenes = useStoryStore(
    (s: StoryStoreState): Scene[] => s.baselineState.scenes ?? []
  );
  const baselineStoryState = useStoryStore(
    (s: StoryStoreState): StoryState => s.baselineState
  );
  // Prose the scene had when the dialog opened.  Only used to seed the diff
  // decision below; the live value lives in `linkedProseBaselineAtOpen`.
  const openTimeLinkedProse = useMemo((): string => {
    const link = scene.prose_link ?? null;
    if (!isLinkedProseLink(link) || !getLinkedProseText) return '';
    return getLinkedProseText(link) ?? '';
  }, [scene.prose_link, getLinkedProseText]);
  // A pending AI diff (any scene field differs from the baseline) must open the
  // dialog in diff mode even when it was opened normally.  Previously the
  // dialog only defaulted to diff mode for AI-triggered opens, so changes made
  // by chat tools (e.g. `manage_scenes(action='update')` adding a beat) were
  // shown without any highlight.
  const hasPendingSceneDiff = useMemo((): boolean => {
    return sceneFieldsDiffer({
      scene,
      baselineScene,
      baselineStoryState,
      openedViaTrigger,
      atOpenProse: openTimeLinkedProse,
    });
  }, [baselineScene, baselineStoryState, openTimeLinkedProse, openedViaTrigger, scene]);
  const [summary, setSummary] = useState(scene.summary);
  const [beats, setBeats] = useState<SceneBeat[]>(scene.beats);
  const [showDiff, setShowDiff] = useState(
    Boolean(openedViaTrigger || defaultShowDiff || hasPendingSceneDiff)
  );
  // Turn the diff view on as soon as a pending change appears while the dialog
  // is already open (the chat writes scene fields in the background).
  useEffect((): void => {
    if (!isOpen || !hasPendingSceneDiff) return;
    setShowDiff((prev: boolean): boolean => (prev ? prev : true));
  }, [isOpen, hasPendingSceneDiff]);
  // Local baseline overrides: when the user accepts a diff section, we store
  // the accepted value here so the diff for that section clears locally without
  // needing a round-trip through the store.  On reject we revert the field.
  type AcceptedBaseline = Partial<{
    summary: string;
    beats: SceneBeat[];
    active_characters: string[];
    passive_characters: string[];
    sourcebook_entry_ids: string[];
    scene_time: string | null;
    timeline_id: string;
    color_tag: string | null;
    status: string;
    linkedProse: string;
  }>;
  const [acceptedBaseline, setAcceptedBaseline] = useState<AcceptedBaseline>({});
  // Reset accepted baseline when the dialog opens for a different scene.
  const acceptedBaselineRef = useRef(acceptedBaseline);
  acceptedBaselineRef.current = acceptedBaseline;
  const [activeTokens, setActiveTokens] = useState<CharToken[]>(
    scene.active_characters.map((name: string, i: number): CharToken => {
      const dt = scene.tag_personal_datetimes?.find(
        (t: SceneTagPersonalDatetime) =>
          t.role === 'active' && t.ref === name && t.index === i
      );
      return { name, personal_age: dt?.personal_age ?? null };
    })
  );
  const [activeInput, setActiveInput] = useState('');
  const [passiveTokens, setPassiveTokens] = useState<CharToken[]>(
    scene.passive_characters.map((name: string, i: number): CharToken => {
      const dt = scene.tag_personal_datetimes?.find(
        (t: SceneTagPersonalDatetime) =>
          t.role === 'passive' && t.ref === name && t.index === i
      );
      return { name, personal_age: dt?.personal_age ?? null };
    })
  );
  const [passiveInput, setPassiveInput] = useState('');
  const [sourcebookTags, setSourcebookTags] = useState<
    Array<{ id: string; personal_age: string | null }>
  >(
    (scene.sourcebook_entry_ids ?? [])
      .filter((id: string) => {
        const entry = entryById.get(id);
        return !isCharacterEntry(entry);
      })
      .map((id: string) => {
        const dt = scene.tag_personal_datetimes?.find(
          (t: SceneTagPersonalDatetime) => t.role === 'sourcebook' && t.ref === id
        );
        return { id, personal_age: dt?.personal_age ?? null };
      })
  );
  const [sourcebookInput, setSourcebookInput] = useState('');
  const [sceneTimeValue, setSceneTimeValue] = useState<string | null>(
    scene.scene_time?.temporal_zoned_datetime ?? null
  );
  const [timelineId, setTimelineId] = useState<string>(scene.timeline_id ?? 'main');
  const [temporalEditTarget, setTemporalEditTarget] =
    useState<TemporalEditTarget | null>(null);
  const [ageEditTarget, setAgeEditTarget] = useState<AgeEditTarget | null>(null);
  const [ageEditValue, setAgeEditValue] = useState('');
  const [pendingNavigationSceneId, setPendingNavigationSceneId] =
    useState<SceneId | null>(null);

  /**
   * Time Travel sourcebook entries that create a new timeline AND whose departure
   * (i.e. at least one scene referencing them) happens at or before this scene's time.
   * Each element represents one additional active timeline branch.
   */
  const activeBranchTimelines = useMemo((): SourcebookEntry[] => {
    const currentEpoch = getSceneEpochNanoseconds(scene);
    const currentTimelineId = normalizeTimelineId(scene.timeline_id);

    const ttEntries = sourcebookEntries.filter(
      (e: SourcebookEntry) => e.category === 'Time Travel' && e.creates_new_timeline
    );

    return ttEntries.filter((entry: SourcebookEntry) => {
      const branchTimelineId = getBranchTimelineId(entry.id);
      if (currentTimelineId === branchTimelineId) {
        return true;
      }

      const branchStartEpoch =
        parseEpochNanoseconds(entry.destination_datetime) ??
        parseEpochNanoseconds(entry.origin_date) ??
        (() => {
          const departureScene = allScenes.find((candidate: Scene): boolean =>
            (candidate.sourcebook_entry_ids ?? []).includes(entry.id)
          );
          return departureScene ? getSceneEpochNanoseconds(departureScene) : null;
        })();

      if (currentEpoch === null) {
        return branchStartEpoch !== null;
      }
      if (branchStartEpoch === null) {
        return true;
      }
      return branchStartEpoch <= currentEpoch;
    });
  }, [scene, allScenes, sourcebookEntries]);

  /** Total number of timelines active at this scene (main + branches). */
  const activeTimelinesAtScene = activeBranchTimelines.length + 1;

  const sceneEpochNanosecondsById = useMemo((): Map<SceneId, bigint> => {
    const epochMap = new Map<SceneId, bigint>();
    allScenes.forEach((sceneItem: Scene): void => {
      const epochNanoseconds = getSceneEpochNanoseconds(sceneItem);
      if (epochNanoseconds !== null) {
        epochMap.set(sceneItem.id, epochNanoseconds);
      }
    });
    return epochMap;
  }, [allScenes]);

  const timelineOptions = useMemo(
    () =>
      buildSceneTimelineOptions(scene, sourcebookEntries, sceneEpochNanosecondsById),
    [scene, sourcebookEntries, sceneEpochNanosecondsById]
  );

  const navigationOrderedScenes = useMemo((): Scene[] => {
    const chapterOrderMap = buildChapterOrderMap(projectType, chapters, books ?? []);
    const candidateScenes = [...allScenes];
    if (viewMode === 'pinboard') {
      return candidateScenes.sort((a: Scene, b: Scene) => sceneIdCompare(a.id, b.id));
    }
    if (viewMode === 'chronological' || viewMode === 'convergence-map') {
      return candidateScenes.sort((a: Scene, b: Scene) =>
        chronologicalSort(a, b, chapterOrderMap, sceneEpochNanosecondsById)
      );
    }
    return candidateScenes.sort((a: Scene, b: Scene) =>
      proseSort(a, b, chapterOrderMap)
    );
  }, [allScenes, books, chapters, projectType, sceneEpochNanosecondsById, viewMode]);

  const narrativeOrderedScenes = useMemo((): Scene[] => {
    const chapterOrderMap = buildChapterOrderMap(projectType, chapters, books ?? []);
    return [...allScenes].sort((a: Scene, b: Scene) =>
      proseSort(a, b, chapterOrderMap)
    );
  }, [allScenes, books, chapters, projectType]);

  const chapterById = useMemo(
    (): Map<string, Chapter> =>
      new Map(chapters.map((chapter: Chapter) => [chapter.id, chapter])),
    [chapters]
  );

  const bookById = useMemo(
    (): Map<string, Book> =>
      new Map((books ?? []).map((book: Book) => [book.id, book])),
    [books]
  );

  const inferredChapterBySceneId = useMemo((): Map<SceneId, string | null> => {
    const map = new Map<SceneId, string | null>();
    const chapterIds = narrativeOrderedScenes.map((candidate: Scene) => {
      const link = candidate.prose_link;
      if (!link || link.scope_type !== 'chapter') return null;
      const chapterId = normalizeChapterId(link.chapter_id);
      return chapterId.length > 0 ? chapterId : null;
    });

    narrativeOrderedScenes.forEach((candidate: Scene, index: number): void => {
      const direct = chapterIds[index];
      if (direct) {
        map.set(candidate.id, direct);
        return;
      }

      let previousChapterId: string | null = null;
      for (let i = index - 1; i >= 0; i -= 1) {
        if (chapterIds[i]) {
          previousChapterId = chapterIds[i];
          break;
        }
      }

      if (previousChapterId) {
        map.set(candidate.id, previousChapterId);
        return;
      }

      let nextChapterId: string | null = null;
      for (let i = index + 1; i < chapterIds.length; i += 1) {
        if (chapterIds[i]) {
          nextChapterId = chapterIds[i];
          break;
        }
      }

      map.set(candidate.id, nextChapterId);
    });

    return map;
  }, [narrativeOrderedScenes]);

  const sceneNarrativeIndex = narrativeOrderedScenes.findIndex(
    (candidate: Scene): boolean => candidate.id === scene.id
  );
  const sceneNavigationIndex = navigationOrderedScenes.findIndex(
    (candidate: Scene): boolean => candidate.id === scene.id
  );
  const previousNarrativeScene =
    sceneNavigationIndex > 0 ? navigationOrderedScenes[sceneNavigationIndex - 1] : null;
  const nextNarrativeScene =
    sceneNavigationIndex >= 0 &&
    sceneNavigationIndex < navigationOrderedScenes.length - 1
      ? navigationOrderedScenes[sceneNavigationIndex + 1]
      : null;

  const sceneChapterId = inferredChapterBySceneId.get(scene.id) ?? null;
  const sceneChapter = sceneChapterId
    ? (chapterById.get(sceneChapterId) ?? null)
    : null;
  const sceneBook = sceneChapter?.book_id
    ? (bookById.get(sceneChapter.book_id) ?? null)
    : null;

  const chapterNarrativeScenes = sceneChapterId
    ? narrativeOrderedScenes.filter(
        (candidate: Scene): boolean =>
          (inferredChapterBySceneId.get(candidate.id) ?? null) === sceneChapterId
      )
    : [];
  const sceneChapterIndex = chapterNarrativeScenes.findIndex(
    (candidate: Scene): boolean => candidate.id === scene.id
  );

  /**
   * Collect known personal_age values per timeline context.
   * Key format: `tl:{timelineId}::{role}::{ref}` for branch timelines,
   * `main::{role}::{ref}` for the main timeline.
   */
  const knownAgesForRef = useMemo((): Map<string, string[]> => {
    const map = new Map<string, string[]>();

    allScenes.forEach((s: Scene): void => {
      const sceneTimelineId = normalizeTimelineId(s.timeline_id);
      const tlPrefix =
        sceneTimelineId === MAIN_TIMELINE_ID
          ? MAIN_TIMELINE_ID
          : `tl:${sceneTimelineId}`;

      (s.tag_personal_datetimes ?? []).forEach(
        (tpd: SceneTagPersonalDatetime): void => {
          if (!tpd.personal_age) return;
          const key = `${tlPrefix}::${tpd.role}::${tpd.ref}`;
          const existing = map.get(key) ?? [];
          if (!existing.includes(tpd.personal_age)) {
            map.set(key, [...existing, tpd.personal_age]);
          }
        }
      );
    });
    return map;
  }, [allScenes, activeBranchTimelines]);

  const ageEditRoleAndRef = useMemo((): { role: string; ref: string } | null => {
    if (!ageEditTarget) return null;

    if (ageEditTarget.type === 'active_tag') {
      return { role: 'active', ref: activeTokens[ageEditTarget.index]?.name ?? '' };
    }
    if (ageEditTarget.type === 'passive_tag') {
      return {
        role: 'passive',
        ref: passiveTokens[ageEditTarget.index]?.name ?? '',
      };
    }
    return { role: 'sourcebook', ref: ageEditTarget.entryId };
  }, [ageEditTarget, activeTokens, passiveTokens]);

  const characterStateOptions = useMemo((): PersonalStateOption[] => {
    if (!ageEditRoleAndRef) return [];

    const { role, ref } = ageEditRoleAndRef;
    const trimmedRef = ref.trim();
    if (!trimmedRef) return [];

    let characterName: string | null = null;
    if (role === 'active' || role === 'passive') {
      characterName = trimmedRef;
    } else {
      const entry = entryById.get(trimmedRef);
      if (entry && (entry.category ?? '').toLowerCase() === 'character') {
        characterName = entry.name;
      }
    }

    const options: PersonalStateOption[] = [];

    if (characterName) {
      const stateEntries = sourcebookEntries
        .filter((entry: SourcebookEntry): boolean => entry.category === 'Time Travel')
        .filter((entry: SourcebookEntry): boolean => {
          return allScenes.some((sceneItem: Scene): boolean => {
            if (!(sceneItem.sourcebook_entry_ids ?? []).includes(entry.id)) {
              return false;
            }
            const activeMatch = (sceneItem.active_characters ?? []).includes(
              characterName as string
            );
            const passiveMatch = (sceneItem.passive_characters ?? []).includes(
              characterName as string
            );
            return activeMatch || passiveMatch;
          });
        })
        .sort((a: SourcebookEntry, b: SourcebookEntry): number => {
          return a.id.localeCompare(b.id);
        });

      options.push({
        value: encodePersonalStateValue(0, PERSONAL_STATE_ORIGINAL),
        label: t('Original (not time traveled)'),
      });

      stateEntries.forEach((entry: SourcebookEntry, index: number): void => {
        options.push({
          value: encodePersonalStateValue(index + 1, `tt:${entry.id}`),
          label: t('After time travel: {{event}}', { event: entry.name }),
        });
      });
    }

    const known = new Set<string>();
    knownAgesForRef.forEach((values: string[], key: string): void => {
      if (!key.endsWith(`::${role}::${trimmedRef}`)) return;
      values.forEach((value: string) => {
        known.add(value);
      });
    });

    const existingValues = Array.from(known).sort((a: string, b: string) =>
      a.localeCompare(b)
    );

    existingValues.forEach((value: string): void => {
      if (options.some((option: PersonalStateOption) => option.value === value)) {
        return;
      }
      options.push({ value, label: value });
    });

    return options;
  }, [ageEditRoleAndRef, entryById, sourcebookEntries, allScenes, knownAgesForRef, t]);

  const formatPersonalAgeDisplay = (value: string | null): string | null => {
    if (!value) return null;
    const parsed = parsePersonalStateValue(value);
    if (!parsed) return value;
    if (parsed.stateId === PERSONAL_STATE_ORIGINAL) {
      return t('Original (not time traveled)');
    }
    if (parsed.stateId.startsWith('tt:')) {
      const entryId = parsed.stateId.slice(3);
      const entry = entryById.get(entryId);
      return t('After time travel: {{event}}', {
        event: entry?.name ?? entryId,
      });
    }
    return value;
  };
  const [colorTag, setColorTag] = useState<string | null>(scene.color_tag ?? null);
  const [status, setStatus] = useState(scene.status);
  const [proseLink, setProseLink] = useState<SceneProseLink | null>(
    scene.prose_link ?? null
  );
  const [localProseText, setLocalProseText] = useState('');
  const [proseDirty, setProseDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isWritingScene, setIsWritingScene] = useState(false);
  // Which derived field regeneration is running, if any, as ``target:source``.
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  // Live streaming text for beat generation (beats cannot be streamed into the
  // list of textareas, so a preview is shown until generation completes).
  const [streamingBeatsText, setStreamingBeatsText] = useState('');
  // Accumulated model reasoning for the running write/field generation.  Long
  // thinking phases used to be invisible: the dialog looked frozen for minutes
  // before the first prose token arrived.
  const [streamingThinkingText, setStreamingThinkingText] = useState('');
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(true);
  // Section that owns the running generation: the reasoning preview is shown
  // next to the control the user pressed, never at the top of the dialog (which
  // was off-screen and shifted the section the user was working in).
  const [thinkingLocation, setThinkingLocation] = useState<
    'summary' | 'beats' | 'prose' | null
  >(null);
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  const [linkedProseBaselineAtOpen, setLinkedProseBaselineAtOpen] = useState<
    string | undefined
  >(undefined);
  const [pendingSourcebookEntryId, setPendingSourcebookEntryId] = useState<
    string | null
  >(null);
  const [hoveredEntry, setHoveredEntry] = useState<SourcebookEntry | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [availableImages, setAvailableImages] = useState<ProjectImage[]>([]);
  const initializedSceneIdRef = useRef<SceneId | null>(null);
  // True while write-scene prose is being streamed live into the dialog, so the
  // linked-prose polling effect does not clobber the in-flight text.
  const streamedProseRef = useRef(false);
  // Controller for the running write/field generation.  Aborting it cancels the
  // HTTP request (and with it the upstream LLM call).
  const generationAbortRef = useRef<AbortController | null>(null);
  // Last text observed from the linked prose source.  Used to react only to
  // genuinely external prose changes (e.g. the chat writing this scene) and
  // never to a stale poll that would undo in-dialog generation.
  const lastExternalProseRef = useRef<string | null>(null);

  const initialSnapshotRef = useRef<DirtySnapshot | null>(null);

  // Ref for the FloatingDiffToolbar — wraps the scrollable content area
  // so the toolbar detects hover over both section-level data-diff markers
  // and inline CodeMirror diff decorations.
  const diffContainerRef = useRef<HTMLDivElement>(null);

  useEffect((): void => {
    if (!isOpen) {
      initializedSceneIdRef.current = null;
      return;
    }

    if (initializedSceneIdRef.current === scene.id) {
      return;
    }
    initializedSceneIdRef.current = scene.id;

    setSummary(scene.summary);
    setBeats(scene.beats);
    setActiveTokens(
      scene.active_characters.map((name: string, i: number): CharToken => {
        const dt = scene.tag_personal_datetimes?.find(
          (t: SceneTagPersonalDatetime) =>
            t.role === 'active' && t.ref === name && t.index === i
        );
        return { name, personal_age: dt?.personal_age ?? null };
      })
    );
    setActiveInput('');
    setPassiveTokens(
      scene.passive_characters.map((name: string, i: number): CharToken => {
        const dt = scene.tag_personal_datetimes?.find(
          (t: SceneTagPersonalDatetime) =>
            t.role === 'passive' && t.ref === name && t.index === i
        );
        return { name, personal_age: dt?.personal_age ?? null };
      })
    );
    setPassiveInput('');
    setSourcebookTags(
      (scene.sourcebook_entry_ids ?? [])
        .filter((id: string) => {
          const entry = entryById.get(id);
          return !isCharacterEntry(entry);
        })
        .map((id: string) => {
          const dt = scene.tag_personal_datetimes?.find(
            (t: SceneTagPersonalDatetime) => t.role === 'sourcebook' && t.ref === id
          );
          return { id, personal_age: dt?.personal_age ?? null };
        })
    );
    setSourcebookInput('');
    setSceneTimeValue(scene.scene_time?.temporal_zoned_datetime ?? null);
    setTimelineId(scene.timeline_id ?? 'main');
    setTemporalEditTarget(null);
    setAgeEditTarget(null);
    setAgeEditValue('');
    setColorTag(scene.color_tag ?? null);
    setStatus(scene.status);
    const initialLinkedProseText =
      scene.prose_link && getLinkedProseText
        ? (getLinkedProseText(scene.prose_link) ?? '')
        : '';
    setProseLink(scene.prose_link ?? null);
    setLocalProseText(initialLinkedProseText);
    setLinkedProseBaselineAtOpen(initialLinkedProseText);
    lastExternalProseRef.current = initialLinkedProseText;
    setProseDirty(false);
    setConfirmDelete(false);
    setPendingSourcebookEntryId(null);
    setHoveredEntry(null);
    setShowDiff(
      Boolean(
        openedViaTrigger ||
        defaultShowDiff ||
        sceneFieldsDiffer({
          scene,
          baselineScene,
          baselineStoryState,
          openedViaTrigger,
          atOpenProse: initialLinkedProseText,
        })
      )
    );
    setAcceptedBaseline({});
    setSummaryTab('diff');
    setLinkedProseTab('diff');
    setGeneratingKey(null);
    setStreamingBeatsText('');
    setStreamingThinkingText('');
    setIsThinkingExpanded(true);
    setThinkingLocation(null);

    initialSnapshotRef.current = {
      summary: scene.summary,
      beats: JSON.stringify(scene.beats),
      activeTokens: JSON.stringify(scene.active_characters),
      passiveTokens: JSON.stringify(scene.passive_characters),
      sourcebookIds: (scene.sourcebook_entry_ids ?? []).filter((id: string) => {
        const entry = entryById.get(id);
        return !isCharacterEntry(entry);
      }),
      colorTag: scene.color_tag ?? null,
      status: scene.status,
      sceneTimeValue: scene.scene_time?.temporal_zoned_datetime ?? null,
      timelineId: scene.timeline_id ?? 'main',
    };
  }, [
    isOpen,
    scene.id,
    getLinkedProseText,
    openedViaTrigger,
    defaultShowDiff,
    baselineScene,
  ]);

  useEffect((): (() => void) | void => {
    if (!isWritingScene || !isOpen || !proseLink || !getLinkedProseText) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const syncFromLinkedProse = (): void => {
      if (cancelled) return;
      // Do not clobber prose that is being streamed live into the dialog.
      if (streamedProseRef.current) return;

      const nextText = getLinkedProseText(proseLink) ?? '';
      setLocalProseText((prev: string) => {
        // Avoid wiping streamed/generated prose if a transient stale link
        // resolves to an empty slice while write-scene updates are propagating.
        if (nextText.length === 0 && prev.length > 0) {
          return prev;
        }
        return prev === nextText ? prev : nextText;
      });

      timer = setTimeout(syncFromLinkedProse, 32);
    };

    syncFromLinkedProse();

    return (): void => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isWritingScene, isOpen, proseLink, getLinkedProseText]);

  useEffect((): void => {
    if (!isOpen) return;
    const nextLink = scene.prose_link ?? null;
    setProseLink((prev: SceneProseLink | null): SceneProseLink | null => {
      if (JSON.stringify(prev) === JSON.stringify(nextLink)) {
        return prev;
      }
      return nextLink;
    });
  }, [isOpen, scene.prose_link]);

  // Keep the linked-prose field in sync with external writes (e.g. the chat
  // writing scene prose while this dialog is open).  User edits win: once the
  // field is dirty we never overwrite it, and live write-scene streaming is
  // handled by the polling effect below.
  useEffect((): void => {
    if (!isOpen || !proseLink || !getLinkedProseText) return;
    if (isWritingScene || proseDirty || streamedProseRef.current) return;
    const nextText = getLinkedProseText(proseLink) ?? '';
    if (nextText === lastExternalProseRef.current) return;
    lastExternalProseRef.current = nextText;
    setLocalProseText((prev: string): string => (prev === nextText ? prev : nextText));
  }, [isOpen, scene.id, proseLink, getLinkedProseText, isWritingScene, proseDirty]);

  useEffect((): void => {
    if (hoveredEntry && availableImages.length === 0) {
      void listProjectImages().then((images: ProjectImage[]): void => {
        setAvailableImages(images);
      });
    }
  }, [hoveredEntry, availableImages.length]);

  // Keep the latest reasoning line in view while the model is thinking.
  useEffect((): void => {
    const el = thinkingScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streamingThinkingText]);

  if (!isOpen) return null;

  const otherScenes = allScenes.filter((s: Scene) => s.id !== scene.id);
  const baselineOtherScenes = baselineScenes.filter(
    (s: Scene): boolean => s.id !== scene.id
  );
  const incomingCauseIds = otherScenes
    .filter((other: Scene): boolean => (other.causes ?? []).includes(scene.id))
    .map((other: Scene): SceneId => other.id);
  const baselineIncomingCauseIds = baselineOtherScenes
    .filter((other: Scene): boolean => (other.causes ?? []).includes(scene.id))
    .map((other: Scene): SceneId => other.id);
  const previousSceneTimeValue = (() => {
    for (const linked of allScenes) {
      if (
        (linked.causes ?? []).includes(scene.id) &&
        linked.scene_time?.temporal_zoned_datetime
      ) {
        return linked.scene_time.temporal_zoned_datetime;
      }
    }
    const sceneIndex = allScenes.findIndex((s: Scene): boolean => s.id === scene.id);
    if (sceneIndex <= 0) return null;
    for (let idx = sceneIndex - 1; idx >= 0; idx -= 1) {
      const maybe = allScenes[idx]?.scene_time?.temporal_zoned_datetime;
      if (maybe) return maybe;
    }
    return null;
  })();
  const parsedSceneTime = parseZonedDateTime(sceneTimeValue);
  const normalizedSceneTimelineId = normalizeTimelineId(timelineId);

  const computeEntryAgeForScene = (
    entry: SourcebookEntry | undefined
  ): AgeInfo | null => {
    if (!entry || !entry.origin_date || !parsedSceneTime) return null;
    return calculateEntryAgeInfo(entry.origin_date, parsedSceneTime);
  };

  const activeComputedAgeByIndex = useMemo((): Map<number, string> => {
    const map = new Map<number, string>();
    activeTokens.forEach((token: CharToken, index: number): void => {
      const entry = entryByName.get(normalizeToken(token.name));
      const ageInfo = computeEntryAgeForScene(entry);
      if (ageInfo) {
        map.set(index, ageInfo.compact);
      }
    });
    return map;
  }, [activeTokens, entryByName, parsedSceneTime, normalizedSceneTimelineId]);

  const passiveComputedAgeByIndex = useMemo((): Map<number, string> => {
    const map = new Map<number, string>();
    passiveTokens.forEach((token: CharToken, index: number): void => {
      const entry = entryByName.get(normalizeToken(token.name));
      const ageInfo = computeEntryAgeForScene(entry);
      if (ageInfo) {
        map.set(index, ageInfo.compact);
      }
    });
    return map;
  }, [passiveTokens, entryByName, parsedSceneTime, normalizedSceneTimelineId]);

  const sourcebookComputedAgeById = useMemo((): Map<string, string> => {
    const map = new Map<string, string>();
    sourcebookTags.forEach((tag: SourcebookTag): void => {
      const entry = entryById.get(tag.id);
      const ageInfo = computeEntryAgeForScene(entry);
      if (ageInfo) {
        map.set(tag.id, ageInfo.compact);
      }
    });
    return map;
  }, [sourcebookTags, entryById, parsedSceneTime, normalizedSceneTimelineId]);

  const hoveredEntryAgeDetail = useMemo((): string | null => {
    if (!hoveredEntry) return null;
    const ageInfo = computeEntryAgeForScene(hoveredEntry);
    return ageInfo?.detailed ?? null;
  }, [hoveredEntry, parsedSceneTime, normalizedSceneTimelineId]);

  const displayLocale = storyLanguage || i18n.resolvedLanguage || i18n.language;

  // Merge store baseline with locally accepted overrides so that
  // accepting a section clears its diff without a store round-trip.
  const effectiveBaselineSummary =
    'summary' in acceptedBaseline
      ? acceptedBaseline.summary
      : (baselineScene?.summary ?? (openedViaTrigger ? '' : undefined));
  const summaryBaseline = effectiveBaselineSummary;
  const baselineBeats =
    'beats' in acceptedBaseline
      ? (acceptedBaseline.beats ?? [])
      : (baselineScene?.beats ?? []);
  const baselineActiveCharacters =
    'active_characters' in acceptedBaseline
      ? (acceptedBaseline.active_characters ?? [])
      : (baselineScene?.active_characters ?? []);
  const baselinePassiveCharacters =
    'passive_characters' in acceptedBaseline
      ? (acceptedBaseline.passive_characters ?? [])
      : (baselineScene?.passive_characters ?? []);
  const baselineSourcebookIds =
    'sourcebook_entry_ids' in acceptedBaseline
      ? (acceptedBaseline.sourcebook_entry_ids ?? [])
      : (baselineScene?.sourcebook_entry_ids ?? []);
  const baselineSceneTimeValue =
    'scene_time' in acceptedBaseline
      ? (acceptedBaseline.scene_time ?? null)
      : (baselineScene?.scene_time?.temporal_zoned_datetime ?? null);
  const baselineTimelineId =
    'timeline_id' in acceptedBaseline
      ? normalizeTimelineId(acceptedBaseline.timeline_id ?? 'main')
      : baselineScene
        ? normalizeTimelineId(baselineScene.timeline_id)
        : null;
  const baselineColorTag =
    'color_tag' in acceptedBaseline
      ? (acceptedBaseline.color_tag ?? null)
      : (baselineScene?.color_tag ?? null);
  const baselineStatus =
    'status' in acceptedBaseline
      ? (acceptedBaseline.status ?? undefined)
      : baselineScene?.status;
  const hintedFields = useMemo(
    () =>
      new Set(
        (sceneChangeHint?.changedFields ?? []).map((field: string) =>
          field.toLowerCase()
        )
      ),
    [sceneChangeHint]
  );
  const hasFieldHint = (...fields: string[]): boolean =>
    fields.some((field: string): boolean => hintedFields.has(field.toLowerCase()));
  const summaryChanged =
    showDiff &&
    ((summaryBaseline !== undefined
      ? summary !== summaryBaseline
      : summary.length > 0) ||
      hasFieldHint('summary', 'summary_patch'));
  const baselineProseLink = baselineScene?.prose_link ?? null;
  const linkedProseBaseline = useMemo((): string => {
    // Computed regardless of `showDiff`: `linkedProseChanged` and the Old tab
    // need the baseline even while diff decorations are toggled off, and
    // `showDiff` itself is now seeded from this comparison.
    return resolveSceneProseBaseline({
      baselineScene,
      baselineStoryState,
      sceneId: scene.id,
      openedViaTrigger,
      atOpenText: linkedProseBaselineAtOpen ?? '',
    });
  }, [
    baselineProseLink,
    baselineScene,
    baselineStoryState,
    linkedProseBaselineAtOpen,
    openedViaTrigger,
    scene.id,
  ]);
  const baselineOutgoingCauseIds = baselineScene?.causes ?? [];

  const beatsChanged =
    showDiff &&
    (!arraysEqual(
      beats.map((beat: SceneBeat) => beat.text),
      baselineBeats.map((beat: SceneBeat) => beat.text)
    ) ||
      hasFieldHint('beats'));
  // Aligned beat rows: unchanged beats stay editable, added beats are tinted
  // green, removed baseline beats are shown struck through in red.  Comparing
  // by array position (the previous approach) mislabelled every beat after an
  // insertion and could not show deletions at all.
  const beatDiffRows = useMemo((): SceneBeatDiffEntry[] => {
    const currentTexts = beats.map((beat: SceneBeat) => beat.text);
    if (!showDiff) {
      return currentTexts.map((text: string, index: number): SceneBeatDiffEntry => ({
        kind: 'unchanged',
        text,
        currentIndex: index,
        baselineIndex: null,
      }));
    }
    return diffSceneBeats(
      baselineBeats.map((beat: SceneBeat) => beat.text),
      currentTexts
    );
  }, [baselineBeats, beats, showDiff]);
  const activeCharactersChanged =
    showDiff &&
    (!arraysEqual(
      activeTokens.map((token: CharToken) => token.name),
      baselineActiveCharacters
    ) ||
      hasFieldHint('active_characters'));
  const passiveCharactersChanged =
    showDiff &&
    (!arraysEqual(
      passiveTokens.map((token: CharToken) => token.name),
      baselinePassiveCharacters
    ) ||
      hasFieldHint('passive_characters'));
  const sourcebookChanged =
    showDiff &&
    (!arraysEqual(
      sourcebookTags.map((tag: SourcebookTag) => tag.id),
      baselineSourcebookIds
    ) ||
      hasFieldHint('sourcebook_entry_ids'));
  const sceneTimeChanged =
    showDiff &&
    (sceneTimeValue !== baselineSceneTimeValue || hasFieldHint('scene_time'));
  const timelineChanged =
    showDiff &&
    ((baselineTimelineId === null
      ? timelineId !== MAIN_TIMELINE_ID
      : normalizeTimelineId(timelineId) !== baselineTimelineId) ||
      hasFieldHint('timeline_id'));
  const colorTagChanged =
    showDiff &&
    ((baselineScene ? colorTag !== baselineColorTag : colorTag !== null) ||
      hasFieldHint('color_tag'));
  const statusChanged =
    showDiff &&
    ((baselineScene ? status !== baselineStatus : false) || hasFieldHint('status'));
  const linkedProseChanged =
    showDiff &&
    !('linkedProse' in acceptedBaseline) &&
    (localProseText !== linkedProseBaseline ||
      JSON.stringify(proseLink ?? null) !== JSON.stringify(baselineProseLink ?? null) ||
      hasFieldHint('prose_link'));
  const causesChanged =
    showDiff &&
    (!idArraysEqualAsSet(scene.causes ?? [], baselineOutgoingCauseIds) ||
      !idArraysEqualAsSet(incomingCauseIds, baselineIncomingCauseIds) ||
      hasFieldHint('causes', 'causes_patch'));
  const removedOutgoingCauseIds = showDiff
    ? baselineOutgoingCauseIds.filter(
        (id: SceneId): boolean => !(scene.causes ?? []).includes(id)
      )
    : [];
  const hintPreviousSceneTimeValue = (() => {
    const previous = sceneChangeHint?.previousValues?.scene_time;
    if (typeof previous === 'string') {
      return previous;
    }
    if (previous && typeof previous === 'object') {
      const temporal = (previous as { temporal_zoned_datetime?: unknown })
        .temporal_zoned_datetime;
      if (typeof temporal === 'string') {
        return temporal;
      }
    }
    return null;
  })();
  const hintPreviousSceneTimeDisplay =
    hintPreviousSceneTimeValue !== null
      ? toDisplayString(hintPreviousSceneTimeValue, displayLocale)
      : null;
  const baselineSceneTimeDisplay =
    baselineSceneTimeValue !== null
      ? toDisplayString(baselineSceneTimeValue, displayLocale)
      : null;
  const previousSceneTimeValueForDiff =
    hintPreviousSceneTimeValue ?? baselineSceneTimeValue;
  const previousSceneTimeDisplayForDiff =
    hintPreviousSceneTimeDisplay ?? baselineSceneTimeDisplay;
  const showSceneTimeInlineDiff =
    showDiff &&
    sceneTimeChanged &&
    sceneTimeValue !== null &&
    previousSceneTimeValueForDiff !== null &&
    sceneTimeValue !== previousSceneTimeValueForDiff;
  const removedIncomingCauseIds = showDiff
    ? baselineIncomingCauseIds.filter(
        (id: SceneId): boolean => !incomingCauseIds.includes(id)
      )
    : [];

  const diffSectionCls = (changed: boolean): string =>
    changed
      ? `rounded-md ring-1 ring-brand-500/25 ${tc.isLight ? 'bg-brand-50' : 'bg-brand-gray-800/50'}`
      : '';
  const diffAddedItemCls = (changed: boolean): string =>
    changed
      ? `rounded-md p-2 ring-1 ring-green-500/25 ${tc.isLight ? 'bg-green-50' : 'bg-green-900/20'}`
      : '';
  const diffRemovedItemCls = (changed: boolean): string =>
    changed
      ? `rounded-md p-2 ring-1 ring-red-500/25 ${tc.isLight ? 'bg-red-50' : 'bg-red-900/20'}`
      : '';
  const diffTagCls = (changed: boolean): string =>
    changed
      ? `${tc.isLight ? 'bg-brand-100' : 'bg-brand-gray-800'} ring-1 ring-brand-500/20`
      : '';

  const inputCls = `w-full px-3 py-2 rounded-md border ${tc.border} ${tc.input} ${tc.text} text-sm focus:outline-none focus:ring-2 focus:ring-brand-500`;
  // Content fields (summary, beats, linked prose) sit on the app's "paper"
  // surface — background and text colour come from the paper style, so no
  // chrome input/text classes are applied here.
  const contentEditorCls =
    'w-full px-3 py-2 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
  const labelCls = `block text-xs font-semibold uppercase tracking-wide ${tc.muted} mb-1`;
  const sectionCls = `space-y-2 pb-4 border-b ${tc.border}`;

  const hasUnsavedChanges = (() => {
    const snapshot = initialSnapshotRef.current;
    if (!snapshot) return false;
    return (
      summary !== snapshot.summary ||
      JSON.stringify(beats) !== snapshot.beats ||
      JSON.stringify(activeTokens.map((t: CharToken) => t.name)) !==
        snapshot.activeTokens ||
      JSON.stringify(passiveTokens.map((t: CharToken) => t.name)) !==
        snapshot.passiveTokens ||
      !arraysEqual(
        sourcebookTags.map((t: { id: string; personal_age: string | null }) => t.id),
        snapshot.sourcebookIds
      ) ||
      colorTag !== snapshot.colorTag ||
      status !== snapshot.status ||
      sceneTimeValue !== snapshot.sceneTimeValue ||
      timelineId !== snapshot.timelineId ||
      proseDirty
    );
  })();

  const addActiveToken = (name: string): void => {
    const token = name.trim();
    if (!token) return;
    setActiveTokens((prev: CharToken[]) => [
      ...prev,
      { name: token, personal_age: null },
    ]);
  };

  const addPassiveToken = (name: string): void => {
    const token = name.trim();
    if (!token) return;
    setPassiveTokens((prev: CharToken[]) => [
      ...prev,
      { name: token, personal_age: null },
    ]);
  };

  type SourcebookTag = { id: string; personal_age: string | null };
  const addSourcebookTag = (id: string): void => {
    const entry = entryById.get(id);
    if (isCharacterEntry(entry)) return;
    setSourcebookTags((prev: SourcebookTag[]) =>
      prev.some((t: SourcebookTag) => t.id === id)
        ? prev
        : [...prev, { id, personal_age: null }]
    );
  };

  const activeSuggestions = sourcebookEntries.filter(
    (entry: SourcebookEntry): boolean => {
      if (!activeInput.trim()) return false;
      if (normalizeToken(entry.category ?? '') !== 'character') return false;
      const query = normalizeToken(activeInput);
      const inName = normalizeToken(entry.name).includes(query);
      const inSyn = (entry.synonyms ?? []).some((synonym: string): boolean =>
        normalizeToken(synonym).includes(query)
      );
      return inName || inSyn;
    }
  );

  const passiveSuggestions = sourcebookEntries.filter(
    (entry: SourcebookEntry): boolean => {
      if (!passiveInput.trim()) return false;
      if (normalizeToken(entry.category ?? '') !== 'character') return false;
      const query = normalizeToken(passiveInput);
      const inName = normalizeToken(entry.name).includes(query);
      const inSyn = (entry.synonyms ?? []).some((synonym: string): boolean =>
        normalizeToken(synonym).includes(query)
      );
      return inName || inSyn;
    }
  );

  const sourcebookSuggestions = sourcebookEntries.filter(
    (entry: SourcebookEntry): boolean => {
      if (!sourcebookInput.trim()) return false;
      if (isCharacterEntry(entry)) return false;
      const query = normalizeToken(sourcebookInput);
      const inName = normalizeToken(entry.name).includes(query);
      const inSyn = (entry.synonyms ?? []).some((synonym: string): boolean =>
        normalizeToken(synonym).includes(query)
      );
      return (
        (inName || inSyn) &&
        !sourcebookTags.some((t: SourcebookTag) => t.id === entry.id)
      );
    }
  );

  const openHoverForEntry = (
    event: React.MouseEvent<HTMLElement>,
    entry: SourcebookEntry
  ): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverPos({ x: rect.right + 8, y: Math.max(8, rect.top) });
    setHoveredEntry(entry);
  };

  const closeHoverCard = (): void => {
    setHoveredEntry(null);
  };

  const doOpenSourcebookEntry = (entryId: string): void => {
    if (!onOpenSourcebookEntry) return;
    onOpenSourcebookEntry(entryId);
  };

  const handleTagDoubleClick = (entryId: string): void => {
    if (!onOpenSourcebookEntry) return;
    if (!hasUnsavedChanges) {
      doOpenSourcebookEntry(entryId);
      onClose();
      return;
    }
    setPendingSourcebookEntryId(entryId);
  };

  const requestNavigateScene = (sceneId: SceneId): void => {
    if (!onNavigateScene) return;
    if (!hasUnsavedChanges) {
      onNavigateScene(sceneId);
      return;
    }
    setPendingNavigationSceneId(sceneId);
  };

  /**
   * Prose that must be written before the scene fields are saved, or null.
   *
   * Two cases write prose:
   *  1. the user edited the field (`proseDirty`), and
   *  2. the field shows prose the scope does not hold yet — e.g. right after
   *     "Write Scene" when the post-write content refresh did not land.
   *
   * Case 2 is not optional: `proseDirty` stays false for streamed prose
   * because it was never typed, so Save used to persist scene metadata only and
   * silently discarded the freshly written prose from the page and from the
   * reopened dialog.  Whatever the dialog displays must reach the scope.
   */
  const proseToPersistOnSave = (): string | null => {
    if (!getLinkedProseText || !onSaveProseContent) return null;
    if (!isLinkedProseLink(proseLink)) return null;
    if (proseDirty) return localProseText;
    const storedProse = getLinkedProseText(proseLink) ?? '';
    if (localProseText.trim().length > 0 && storedProse.length === 0) {
      return localProseText;
    }
    return null;
  };

  const performSave = async (): Promise<void> => {
    setIsSaving(true);
    try {
      const proseToPersist = proseToPersistOnSave();
      if (proseToPersist !== null && onSaveProseContent) {
        await onSaveProseContent(proseToPersist);
      }
      const tagPersonalDatetimes: SceneTagPersonalDatetime[] = [
        ...activeTokens.flatMap(
          (t: CharToken, i: number): SceneTagPersonalDatetime[] =>
            t.personal_age
              ? [
                  {
                    role: 'active',
                    ref: t.name,
                    index: i,
                    personal_age: t.personal_age,
                  },
                ]
              : []
        ),
        ...passiveTokens.flatMap(
          (t: CharToken, i: number): SceneTagPersonalDatetime[] =>
            t.personal_age
              ? [
                  {
                    role: 'passive',
                    ref: t.name,
                    index: i,
                    personal_age: t.personal_age,
                  },
                ]
              : []
        ),
        ...sourcebookTags.flatMap((t: SourcebookTag): SceneTagPersonalDatetime[] =>
          t.personal_age
            ? [
                {
                  role: 'sourcebook',
                  ref: t.id,
                  index: 0,
                  personal_age: t.personal_age,
                },
              ]
            : []
        ),
      ];
      await onSave({
        summary,
        beats,
        active_characters: activeTokens.map((t: CharToken) => t.name),
        passive_characters: passiveTokens.map((t: CharToken) => t.name),
        sourcebook_entry_ids: sourcebookTags.map((t: SourcebookTag) => t.id),
        scene_time: sceneTimeValue ? { temporal_zoned_datetime: sceneTimeValue } : null,
        timeline_id: timelineId,
        color_tag: colorTag,
        status,
        tag_personal_datetimes: tagPersonalDatetimes,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getTemporalDialogCurrentValue = (): string | null => {
    if (!temporalEditTarget) return null;
    return sceneTimeValue;
  };

  const applyTemporalDialogValue = (value: string | null): void => {
    if (!temporalEditTarget) return;
    setSceneTimeValue(value);
    setTemporalEditTarget(null);
  };

  const openAgeEdit = (target: AgeEditTarget): void => {
    let currentAge: string | null = null;
    if (target.type === 'active_tag')
      currentAge = activeTokens[target.index]?.personal_age ?? null;
    else if (target.type === 'passive_tag')
      currentAge = passiveTokens[target.index]?.personal_age ?? null;
    else if (target.type === 'sourcebook_tag') {
      const found = sourcebookTags.find((t: SourcebookTag) => t.id === target.entryId);
      currentAge = found?.personal_age ?? null;
    }
    setAgeEditValue(currentAge ?? '');
    setAgeEditTarget(target);
  };

  const applyAgeEdit = (explicitValue?: string): void => {
    if (!ageEditTarget) return;
    const trimmed =
      (explicitValue !== undefined ? explicitValue : ageEditValue).trim() || null;
    if (ageEditTarget.type === 'active_tag') {
      const { index } = ageEditTarget;
      setActiveTokens((prev: CharToken[]) => {
        const next = [...prev];
        next[index] = { ...next[index], personal_age: trimmed };
        return next;
      });
    } else if (ageEditTarget.type === 'passive_tag') {
      const { index } = ageEditTarget;
      setPassiveTokens((prev: CharToken[]) => {
        const next = [...prev];
        next[index] = { ...next[index], personal_age: trimmed };
        return next;
      });
    } else if (ageEditTarget.type === 'sourcebook_tag') {
      const { entryId } = ageEditTarget;
      setSourcebookTags((prev: SourcebookTag[]) =>
        prev.map((t: SourcebookTag) =>
          t.id === entryId ? { ...t, personal_age: trimmed } : t
        )
      );
    }
    setAgeEditTarget(null);
    setAgeEditValue('');
  };

  const handleSave = async (): Promise<void> => {
    await performSave();
    onClose();
  };

  /** Cancel the running write / derived-field generation. */
  const stopGeneration = (): void => {
    generationAbortRef.current?.abort();
  };

  const handleWriteScene = async (): Promise<void> => {
    if (!onWriteScene) return;
    setShowDiff(true);
    setIsWritingScene(true);
    setStreamingThinkingText('');
    setIsThinkingExpanded(true);
    setThinkingLocation('prose');
    streamedProseRef.current = false;
    const controller = new AbortController();
    generationAbortRef.current = controller;
    try {
      const generatedText = await onWriteScene(
        (text: string): void => {
          if (text) {
            streamedProseRef.current = true;
            setLocalProseText(text);
          }
        },
        (thinking: string): void => setStreamingThinkingText(thinking),
        controller.signal
      );
      const generated = typeof generatedText === 'string' ? generatedText : '';
      if (streamedProseRef.current) {
        // Text was already streamed live; reconcile to the exact final value.
        if (generated.length > 0) {
          setLocalProseText(generated);
        }
        streamedProseRef.current = false;
      } else if (generated.length > 0) {
        const chunkSize = 48;
        for (let end = chunkSize; end < generated.length; end += chunkSize) {
          setLocalProseText(generated.slice(0, end));
          await new Promise<void>((resolve: () => void) => {
            if (typeof window !== 'undefined' && window.requestAnimationFrame) {
              window.requestAnimationFrame(() => resolve());
            } else {
              setTimeout(resolve, 8);
            }
          });
        }
        setLocalProseText(generated);
      }
    } catch (err) {
      if (isAbortError(err)) {
        // The user stopped the generation: discard the partial preview and
        // show the prose that is actually persisted for this scene.
        streamedProseRef.current = false;
        const storedProse = isLinkedProseLink(proseLink)
          ? getLinkedProseText?.(proseLink)
          : null;
        setLocalProseText(storedProse ?? linkedProseBaselineAtOpen ?? '');
        setStreamingThinkingText('');
        setThinkingLocation(null);
        return;
      }
      notifyError(t('Write Scene'), err);
    } finally {
      if (generationAbortRef.current === controller) {
        generationAbortRef.current = null;
      }
      setIsWritingScene(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    await onDelete();
    onClose();
  };

  // ─── Derived scene-field regeneration ─────────────────────────────────
  // True when at least one beat carries text; used for both the
  // summary-from-beats and prose-from-beats buttons.
  const hasBeatText = beats.some(
    (beat: SceneBeat): boolean => beat.text.trim().length > 0
  );
  const isGeneratingField = generatingKey !== null;
  // True while a write/generation call is running and may still push thinking.
  const thinkingActive = isWritingScene || isGeneratingField;
  const buttonTheme = tc.isLight ? 'light' : 'dark';
  const summaryHasContent = summary.trim().length > 0;
  const proseHasContent = localProseText.trim().length > 0;

  /**
   * Resolve the label for a "create / recreate a derived field" control.
   * ``targetHasContent`` selects between the Create and Recreate wording.
   */
  const fieldActionLabel = (
    target: SceneFieldGenerateTarget | 'prose',
    source: SceneFieldGenerateSource,
    targetHasContent: boolean
  ): string => {
    const labels: Record<string, [string, string]> = {
      'summary:beats': ['Create Summary from Beats', 'Recreate Summary from Beats'],
      'beats:summary': ['Create Beats from Summary', 'Recreate Beats from Summary'],
      'beats:prose': ['Create Beats from Prose', 'Recreate Beats from Prose'],
      'prose:beats': ['Create Prose from Beats', 'Recreate Prose from Beats'],
    };
    const entry = labels[`${target}:${source}`];
    if (!entry) return '';
    return t(targetHasContent ? entry[1] : entry[0]);
  };

  const targetHasContent = (target: SceneFieldGenerateTarget): boolean =>
    target === 'summary' ? summaryHasContent : hasBeatText;

  /** Regenerate a derived field from a source field, streaming into the UI. */
  const runFieldGeneration = async (
    target: SceneFieldGenerateTarget,
    source: SceneFieldGenerateSource
  ): Promise<void> => {
    if (!onGenerateSceneField) return;
    const errorLabel = fieldActionLabel(target, source, targetHasContent(target));
    setShowDiff(true);
    setGeneratingKey(`${target}:${source}`);
    setStreamingThinkingText('');
    setIsThinkingExpanded(true);
    setThinkingLocation(target);
    if (target === 'beats') setStreamingBeatsText('');
    const controller = new AbortController();
    generationAbortRef.current = controller;
    const previousSummary = summary;
    const previousBeats = beats;
    try {
      const result = await onGenerateSceneField({
        target,
        source,
        summary,
        beats,
        prose: localProseText,
        onChunk: (text: string): void => {
          if (target === 'summary') {
            setSummary(text);
          } else {
            setStreamingBeatsText(text);
          }
        },
        onThinking: (text: string): void => setStreamingThinkingText(text),
        signal: controller.signal,
      });
      if (!result) return;
      if (result.target === 'summary') {
        setSummary(result.text);
      } else if (result.beats.length > 0) {
        setBeats(result.beats);
      }
    } catch (err) {
      if (isAbortError(err)) {
        // Revert the live-previewed field to its pre-generation value.
        if (target === 'summary') setSummary(previousSummary);
        else setBeats(previousBeats);
        setStreamingThinkingText('');
        setThinkingLocation(null);
        return;
      }
      notifyError(errorLabel, err);
    } finally {
      if (generationAbortRef.current === controller) {
        generationAbortRef.current = null;
      }
      setGeneratingKey(null);
      setStreamingBeatsText('');
    }
  };

  const addBeat = (): void => {
    setBeats((prev: SceneBeat[]) => [
      ...prev,
      { id: `beat-${Date.now()}`, text: '', prose_link: null },
    ]);
  };

  const updateBeat = (idx: number, text: string): void => {
    setBeats((prev: SceneBeat[]) => {
      const next = [...prev];
      next[idx] = { ...next[idx], text };
      return next;
    });
  };

  const deleteBeat = (idx: number): void => {
    setBeats((prev: SceneBeat[]) =>
      prev.filter((_: SceneBeat, i: number) => i !== idx)
    );
  };

  const onStatusChange = (e: React.ChangeEvent<HTMLSelectElement>): void =>
    setStatus(e.target.value as Scene['status']);

  const onProseTextChange = (value: string): void => {
    setLocalProseText(value);
    setProseDirty(true);
    // Clear diff on user edit: typing in the prose is an implicit acceptance
    // of the automatic change, mirroring the summary field.
    if (showDiff && linkedProseChanged) {
      setAcceptedBaseline((prev: AcceptedBaseline) => ({
        ...prev,
        linkedProse: value,
      }));
    }
  };

  // ─── Diff accept / reject (unified — dispatched by element) ────────────

  /**
   * Resolve the diff section an element belongs to.
   *
   * Beat rows carry their own `data-diff` marker, so the nearest marker can be
   * the row itself — and a removed beat row has no textarea to identify it.
   * Walk up to the enclosing `data-diff-section` first so accept/reject always
   * target the field, not the individual row.
   */
  const resolveDiffSection = (el: HTMLElement): HTMLElement | null =>
    el.closest<HTMLElement>('[data-diff-section]') ??
    el.closest<HTMLElement>('[data-diff="changed"]');

  /** Determine which diff section an element belongs to and accept it. */
  const handleDiffAccept = (el: HTMLElement): void => {
    const section = resolveDiffSection(el);
    const sectionName = section?.getAttribute('data-diff-section') ?? null;
    const label = section?.querySelector('label')?.textContent ?? '';
    if (sectionName === 'linked-prose' || label.includes('Linked Prose')) {
      // Accepting the linked prose accepts the current prose state, so the
      // diff view ends and only the new content remains.
      setAcceptedBaseline((prev: AcceptedBaseline) => ({
        ...prev,
        linkedProse: localProseText,
      }));
      return;
    }
    if (!section) {
      // Hovering over an inline CodeMirror diff — accept all for the summary.
      setAcceptedBaseline((prev: AcceptedBaseline) => ({ ...prev, summary }));
      return;
    }
    // Section-level diff: find which section and accept it.
    if (sectionName === 'summary' || section.querySelector('.cm-content')) {
      // Summary section (contains CodeMirror)
      setAcceptedBaseline((prev: AcceptedBaseline) => ({ ...prev, summary }));
    } else if (
      sectionName === 'beats' ||
      section.textContent?.includes('Beats') ||
      section.querySelector('textarea')
    ) {
      // Beats section
      setAcceptedBaseline((prev: AcceptedBaseline) => ({
        ...prev,
        beats: [...beats],
      }));
    }
  };

  /** Determine which diff section an element belongs to and reject it. */
  const handleDiffReject = (el: HTMLElement): void => {
    const section = resolveDiffSection(el);
    const sectionName = section?.getAttribute('data-diff-section') ?? null;
    const label = section?.querySelector('label')?.textContent ?? '';
    if (sectionName === 'linked-prose' || label.includes('Linked Prose')) {
      // Reject: revert the prose to the baseline and clear the acceptance.
      const fallback = linkedProseBaseline ?? '';
      setLocalProseText(fallback);
      setAcceptedBaseline((prev: AcceptedBaseline) => {
        const next = { ...prev };
        delete next.linkedProse;
        return next;
      });
      return;
    }
    if (!section) {
      // Inline CodeMirror diff — revert summary to baseline.
      const fallback = baselineScene?.summary ?? '';
      setSummary(fallback);
      setAcceptedBaseline((prev: AcceptedBaseline) => ({
        ...prev,
        summary: fallback,
      }));
      return;
    }
    if (sectionName === 'summary' || section.querySelector('.cm-content')) {
      const fallback = baselineScene?.summary ?? '';
      setSummary(fallback);
      setAcceptedBaseline((prev: AcceptedBaseline) => ({
        ...prev,
        summary: fallback,
      }));
    } else if (
      sectionName === 'beats' ||
      section.textContent?.includes('Beats') ||
      section.querySelector('textarea')
    ) {
      const fallback = baselineScene?.beats ?? [];
      setBeats(fallback);
      setAcceptedBaseline((prev: AcceptedBaseline) => ({
        ...prev,
        beats: fallback,
      }));
    }
  };

  // Accept ALL diffs in the dialog.
  const handleDiffAcceptAll = (): void => {
    setAcceptedBaseline({
      summary,
      beats: [...beats],
      active_characters: activeTokens.map((t: CharToken) => t.name),
      passive_characters: passiveTokens.map((t: CharToken) => t.name),
      sourcebook_entry_ids: sourcebookTags.map((t: SourcebookTag) => t.id),
      scene_time: sceneTimeValue,
      timeline_id: timelineId,
      color_tag: colorTag,
      status,
      linkedProse: localProseText,
    });
  };

  /**
   * Live reasoning preview for the generation running in the current section.
   * Rendered next to the triggering control (never at the dialog top) so the
   * user sees it without scrolling away from the field being generated.
   */
  const renderThinkingPanel = (): React.ReactElement | null => {
    if (streamingThinkingText.length === 0) return null;
    return (
      <div
        data-testid="scene-writing-thinking"
        className={`mt-1 rounded-md border ${tc.border} ${tc.bg} px-3 py-2`}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-expanded={isThinkingExpanded}
            onClick={(): void =>
              setIsThinkingExpanded((value: boolean): boolean => !value)
            }
            title={isThinkingExpanded ? t('Hide thinking') : t('Show thinking')}
            className={`flex items-center gap-1.5 text-xs font-medium ${tc.text}`}
          >
            <Brain size={14} className={thinkingActive ? 'animate-pulse' : undefined} />
            <span>{t('Thinking')}</span>
            {isThinkingExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
          {thinkingActive && (
            <div className="flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              <button
                type="button"
                onClick={stopGeneration}
                className="text-xs font-medium text-brand-500 hover:text-brand-600"
              >
                {t('Stop generation')}
              </button>
            </div>
          )}
        </div>
        {isThinkingExpanded && (
          <div
            ref={thinkingScrollRef}
            className={`mt-1 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto ${tc.muted}`}
          >
            {streamingThinkingText}
            {thinkingActive && (
              <span className="inline-block w-1.5 h-3 ml-1 align-middle bg-brand-500/50 animate-pulse" />
            )}
          </div>
        )}
      </div>
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-14"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('Edit Scene')}
        className={`relative flex flex-col w-[96vw] h-[calc(100vh-4rem)] max-w-none rounded-xl shadow-2xl border ${tc.border} ${tc.bg} overflow-hidden`}
      >
        <div
          className={`flex items-center justify-between px-5 py-3 border-b ${tc.border} flex-shrink-0`}
        >
          <div className="flex items-center gap-2">
            <h2 className={`text-base font-semibold ${tc.text}`}>{t('Edit Scene')}</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t('Previous scene')}
                title={t('Previous scene')}
                onClick={(): void => {
                  if (previousNarrativeScene) {
                    requestNavigateScene(previousNarrativeScene.id);
                  }
                }}
                disabled={!previousNarrativeScene || !onNavigateScene}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs ${tc.border} ${tc.text} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <ChevronLeft size={14} />
                <span>{t('Previous scene')}</span>
              </button>
              <button
                type="button"
                aria-label={t('Next scene')}
                title={t('Next scene')}
                onClick={(): void => {
                  if (nextNarrativeScene) {
                    requestNavigateScene(nextNarrativeScene.id);
                  }
                }}
                disabled={!nextNarrativeScene || !onNavigateScene}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs ${tc.border} ${tc.text} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <span>{t('Next scene')}</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t('Toggle diff view')}
              aria-pressed={showDiff}
              title={showDiff ? t('Hide diff highlights') : t('Show diff highlights')}
              onClick={(): void => setShowDiff((value: boolean): boolean => !value)}
              className={`p-1.5 rounded-md transition-colors ${tc.text} hover:bg-brand-gray-100 dark:hover:bg-brand-gray-800`}
            >
              <MessageSquareDiff size={18} />
            </button>
            <button
              type="button"
              aria-label={t('Close scene editor')}
              onClick={onClose}
              className={`p-1.5 rounded-md hover:bg-brand-gray-100 dark:hover:bg-brand-gray-800 ${tc.text}`}
            >
              ✕
            </button>
          </div>
        </div>

        <div className={`px-5 py-2 border-b ${tc.border}`}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {sceneNarrativeIndex >= 0 && (
              <span className={`px-2 py-1 rounded-md border ${tc.border} ${tc.text}`}>
                {t('Scene {{index}} of {{total}}', {
                  index: sceneNarrativeIndex + 1,
                  total: narrativeOrderedScenes.length,
                })}
              </span>
            )}
            {sceneChapter && (
              <span className={`px-2 py-1 rounded-md border ${tc.border} ${tc.text}`}>
                {t('Chapter: {{title}}', { title: sceneChapter.title })}
              </span>
            )}
            {sceneBook && (
              <span className={`px-2 py-1 rounded-md border ${tc.border} ${tc.text}`}>
                {t('Book: {{title}}', { title: sceneBook.title })}
              </span>
            )}
            {sceneChapterIndex >= 0 && chapterNarrativeScenes.length > 0 && (
              <span className={`px-2 py-1 rounded-md border ${tc.border} ${tc.text}`}>
                {t('Chapter position {{index}} of {{total}}', {
                  index: sceneChapterIndex + 1,
                  total: chapterNarrativeScenes.length,
                })}
              </span>
            )}
            {openedViaTrigger && (sceneChangeHint?.changedFields?.length ?? 0) > 0 && (
              <span className={`px-2 py-1 rounded-md border ${tc.border} ${tc.text}`}>
                {t('AI changed fields: {{fields}}', {
                  fields: sceneChangeHint?.changedFields?.join(', '),
                })}
              </span>
            )}
          </div>
        </div>

        <div
          ref={diffContainerRef}
          className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
        >
          <div
            className={`${sectionCls} ${diffSectionCls(summaryChanged)}`}
            data-diff={summaryChanged ? 'changed' : undefined}
            data-diff-section="summary"
          >
            <div className="flex items-center justify-between gap-2">
              <label className={labelCls}>{t('Scene Summary')}</label>
              <div className="flex items-center gap-3">
                {onGenerateSceneField && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    theme={buttonTheme}
                    onClick={(): void => void runFieldGeneration('summary', 'beats')}
                    disabled={!hasBeatText || isGeneratingField || isSaving}
                  >
                    {generatingKey === 'summary:beats'
                      ? t('Generating summary...')
                      : fieldActionLabel('summary', 'beats', summaryHasContent)}
                  </Button>
                )}
                {showDiff && summaryChanged && (
                  <DiffViewTabs tab={summaryTab} onChange={setSummaryTab} />
                )}
              </div>
            </div>
            {thinkingLocation === 'summary' && renderThinkingPanel()}
            {summaryTab === 'old' ? (
              <div
                className={`rounded-md border ${tc.border} px-3 py-2 text-sm whitespace-pre-wrap overflow-hidden`}
                style={contentSurface}
              >
                {summaryBaseline || (
                  <span className="italic opacity-60">{t('No previous content')}</span>
                )}
              </div>
            ) : (
              <div
                className={`rounded-md border ${tc.border} overflow-hidden`}
                style={contentSurface}
              >
                <CodeMirrorEditor
                  ref={summaryEditorRef}
                  value={summary}
                  onChange={(value: string): void => {
                    setSummary(value);
                    // Clear diff on user edit: typing in the summary is an
                    // implicit acceptance of the automatic change.
                    if (showDiff && summaryChanged) {
                      setAcceptedBaseline((prev: AcceptedBaseline) => ({
                        ...prev,
                        summary: value,
                      }));
                    }
                  }}
                  baselineValue={
                    summaryTab === 'diff' && summaryChanged
                      ? summaryBaseline
                      : undefined
                  }
                  showDiff={summaryTab === 'diff' && summaryChanged ? showDiff : false}
                  highlightColors={highlightColors}
                  searchHighlightRanges={[]}
                  language={storyLanguage}
                  spellCheck={true}
                  mode="markdown"
                  className={`${contentEditorCls} min-h-[120px]`}
                  placeholder={t('Scene summary...')}
                />
              </div>
            )}
          </div>

          <div
            className={`${sectionCls} ${diffSectionCls(beatsChanged)}`}
            data-diff={beatsChanged ? 'changed' : undefined}
            data-diff-section="beats"
          >
            <div className="flex items-center justify-between gap-2">
              <label className={labelCls}>{t('Beats')}</label>
              <div className="flex items-center gap-3">
                {onGenerateSceneField && (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      theme={buttonTheme}
                      onClick={(): void => void runFieldGeneration('beats', 'summary')}
                      disabled={!summaryHasContent || isGeneratingField || isSaving}
                    >
                      {generatingKey === 'beats:summary'
                        ? t('Generating beats...')
                        : fieldActionLabel('beats', 'summary', hasBeatText)}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      theme={buttonTheme}
                      onClick={(): void => void runFieldGeneration('beats', 'prose')}
                      disabled={!proseHasContent || isGeneratingField || isSaving}
                    >
                      {generatingKey === 'beats:prose'
                        ? t('Generating beats...')
                        : fieldActionLabel('beats', 'prose', hasBeatText)}
                    </Button>
                  </>
                )}
                <button
                  type="button"
                  onClick={addBeat}
                  className="text-xs text-brand-500 hover:text-brand-600 font-medium"
                >
                  + {t('Add Beat')}
                </button>
              </div>
            </div>
            {thinkingLocation === 'beats' && renderThinkingPanel()}
            {generatingKey === 'beats:summary' || generatingKey === 'beats:prose' ? (
              <div
                className={`rounded-md border ${tc.border} px-3 py-2 text-sm whitespace-pre-wrap overflow-hidden`}
                style={contentSurface}
                aria-label={t('Generating beats...')}
              >
                {streamingBeatsText || (
                  <span className="italic opacity-60">{t('Generating beats...')}</span>
                )}
              </div>
            ) : null}
            {beatDiffRows.map((row: SceneBeatDiffEntry) => {
              if (row.currentIndex === null) {
                // Beat the AI removed: keep the old text visible in the delete
                // tint instead of letting it vanish from the diff view.
                return (
                  <div
                    key={`removed-beat-${row.baselineIndex}`}
                    data-diff="changed"
                    data-diff-kind="removed"
                    className="flex gap-2 items-start"
                  >
                    <div
                      className={`${contentEditorCls} flex-1 border ${tc.border} line-through opacity-70`}
                      style={beatDiffSurface('removed')}
                    >
                      {row.text}
                    </div>
                    <span className="mt-1 p-1.5" aria-hidden="true" />
                  </div>
                );
              }
              const idx = row.currentIndex;
              const beat = beats[idx];
              const beatAdded = row.kind === 'added';
              return (
                <div
                  key={beat.id}
                  data-diff={beatAdded ? 'changed' : undefined}
                  data-diff-kind={beatAdded ? 'added' : undefined}
                  className="flex gap-2 items-start"
                >
                  <textarea
                    className={`${contentEditorCls} flex-1 border ${tc.border}`}
                    style={beatAdded ? beatDiffSurface('added') : contentSurface}
                    rows={2}
                    placeholder={t('Beat text...')}
                    value={beat.text}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>): void =>
                      updateBeat(idx, e.target.value)
                    }
                  />
                  <button
                    type="button"
                    aria-label={t('Delete Beat')}
                    onClick={(): void => deleteBeat(idx)}
                    className={`mt-1 p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/40 ${tc.muted}`}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <div
            className={`${sectionCls} ${diffSectionCls(activeCharactersChanged || passiveCharactersChanged)}`}
          >
            <div>
              <label className={labelCls}>{t('Active Characters')}</label>
              <div className={`rounded-md border ${tc.border} ${tc.input} p-2`}>
                <div className="flex flex-wrap gap-2">
                  {activeTokens.map((token: CharToken, idx: number) => {
                    const matched = entryByName.get(normalizeToken(token.name));
                    const computedAge = activeComputedAgeByIndex.get(idx) ?? null;
                    const personalAgeDisplay = formatPersonalAgeDisplay(
                      token.personal_age
                    );
                    const tokenChanged =
                      showDiff &&
                      (idx >= baselineActiveCharacters.length ||
                        baselineActiveCharacters[idx] !== token.name);
                    return (
                      <div
                        key={`active-${idx}`}
                        data-diff={tokenChanged ? 'changed' : undefined}
                        role="button"
                        tabIndex={0}
                        onDoubleClick={(): void =>
                          matched && handleTagDoubleClick(matched.id)
                        }
                        onKeyDown={(
                          event: React.KeyboardEvent<HTMLDivElement>
                        ): void => {
                          if ((event.key === 'Enter' || event.key === ' ') && matched) {
                            event.preventDefault();
                            handleTagDoubleClick(matched.id);
                          }
                        }}
                        onMouseEnter={(e: React.MouseEvent<HTMLDivElement>): void =>
                          matched ? openHoverForEntry(e, matched) : undefined
                        }
                        onMouseLeave={closeHoverCard}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs ${diffTagCls(tokenChanged)} ${matched ? `${tc.surface} border-brand-500/40` : `${tc.bg} ${tc.border}`}`}
                        title={
                          matched
                            ? t('Double click to open sourcebook entry')
                            : undefined
                        }
                      >
                        <span className={tc.text}>{token.name}</span>
                        {computedAge && (
                          <span className={`text-[10px] ${tc.muted}`}>
                            {t('Age {{value}}', { value: computedAge })}
                          </span>
                        )}
                        {personalAgeDisplay && personalAgeDisplay !== computedAge && (
                          <span className={`text-[10px] ${tc.muted}`}>
                            {personalAgeDisplay}
                          </span>
                        )}
                        {matched && activeTimelinesAtScene > 1 && (
                          <button
                            type="button"
                            aria-label={t('Set character state at this scene')}
                            title={t('Set character state at this scene')}
                            className={`${tc.muted} hover:text-brand-500`}
                            onClick={(e: React.MouseEvent): void => {
                              e.stopPropagation();
                              openAgeEdit({ type: 'active_tag', index: idx });
                            }}
                          >
                            <Clock size={11} />
                          </button>
                        )}
                        <button
                          type="button"
                          className={tc.muted}
                          onClick={(
                            event: React.MouseEvent<HTMLButtonElement>
                          ): void => {
                            event.stopPropagation();
                            setActiveTokens((prev: CharToken[]) =>
                              prev.filter((_: CharToken, i: number) => i !== idx)
                            );
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  <input
                    type="text"
                    className={`min-w-[180px] flex-1 bg-transparent text-sm ${tc.text} focus:outline-none`}
                    placeholder={t('Type and press Enter')}
                    value={activeInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                      setActiveInput(e.target.value)
                    }
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>): void => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        if (activeSuggestions.length > 0) {
                          addActiveToken(activeSuggestions[0].name);
                        } else {
                          addActiveToken(activeInput);
                        }
                        setActiveInput('');
                      }
                      if (
                        e.key === 'Backspace' &&
                        !activeInput &&
                        activeTokens.length > 0
                      ) {
                        setActiveTokens((prev: CharToken[]) => prev.slice(0, -1));
                      }
                    }}
                  />
                </div>
              </div>
              {activeSuggestions.length > 0 && (
                <div
                  className={`mt-1 rounded-md border ${tc.border} ${tc.bg} max-h-32 overflow-y-auto`}
                >
                  {activeSuggestions.slice(0, 8).map((entry: SourcebookEntry) => (
                    <button
                      key={`active-sug-${entry.id}`}
                      type="button"
                      className={`w-full text-left px-2 py-1.5 text-xs ${tc.text} ${tc.isLight ? 'hover:bg-brand-500/10' : 'hover:bg-brand-gray-800'}`}
                      onClick={(): void => {
                        addActiveToken(entry.name);
                        setActiveInput('');
                      }}
                    >
                      {entry.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>{t('Passive Characters')}</label>
              <div className={`rounded-md border ${tc.border} ${tc.input} p-2`}>
                <div className="flex flex-wrap gap-2">
                  {passiveTokens.map((token: CharToken, idx: number) => {
                    const matched = entryByName.get(normalizeToken(token.name));
                    const computedAge = passiveComputedAgeByIndex.get(idx) ?? null;
                    const personalAgeDisplay = formatPersonalAgeDisplay(
                      token.personal_age
                    );
                    const tokenChanged =
                      showDiff &&
                      (idx >= baselinePassiveCharacters.length ||
                        baselinePassiveCharacters[idx] !== token.name);
                    return (
                      <div
                        key={`passive-${idx}`}
                        data-diff={tokenChanged ? 'changed' : undefined}
                        role="button"
                        tabIndex={0}
                        onDoubleClick={(): void =>
                          matched && handleTagDoubleClick(matched.id)
                        }
                        onKeyDown={(
                          event: React.KeyboardEvent<HTMLDivElement>
                        ): void => {
                          if ((event.key === 'Enter' || event.key === ' ') && matched) {
                            event.preventDefault();
                            handleTagDoubleClick(matched.id);
                          }
                        }}
                        onMouseEnter={(e: React.MouseEvent<HTMLDivElement>): void =>
                          matched ? openHoverForEntry(e, matched) : undefined
                        }
                        onMouseLeave={closeHoverCard}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs ${diffTagCls(tokenChanged)} ${matched ? `${tc.surface} border-brand-500/40` : `${tc.bg} ${tc.border}`}`}
                        title={
                          matched
                            ? t('Double click to open sourcebook entry')
                            : undefined
                        }
                      >
                        <span className={tc.text}>{token.name}</span>
                        {computedAge && (
                          <span className={`text-[10px] ${tc.muted}`}>
                            {t('Age {{value}}', { value: computedAge })}
                          </span>
                        )}
                        {personalAgeDisplay && personalAgeDisplay !== computedAge && (
                          <span className={`text-[10px] ${tc.muted}`}>
                            {personalAgeDisplay}
                          </span>
                        )}
                        {matched && activeTimelinesAtScene > 1 && (
                          <button
                            type="button"
                            aria-label={t('Set character state at this scene')}
                            title={t('Set character state at this scene')}
                            className={`${tc.muted} hover:text-brand-500`}
                            onClick={(e: React.MouseEvent): void => {
                              e.stopPropagation();
                              openAgeEdit({ type: 'passive_tag', index: idx });
                            }}
                          >
                            <Clock size={11} />
                          </button>
                        )}
                        <button
                          type="button"
                          className={tc.muted}
                          onClick={(
                            event: React.MouseEvent<HTMLButtonElement>
                          ): void => {
                            event.stopPropagation();
                            setPassiveTokens((prev: CharToken[]) =>
                              prev.filter((_: CharToken, i: number) => i !== idx)
                            );
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  <input
                    type="text"
                    className={`min-w-[180px] flex-1 bg-transparent text-sm ${tc.text} focus:outline-none`}
                    placeholder={t('Type and press Enter')}
                    value={passiveInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                      setPassiveInput(e.target.value)
                    }
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>): void => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        if (passiveSuggestions.length > 0) {
                          addPassiveToken(passiveSuggestions[0].name);
                        } else {
                          addPassiveToken(passiveInput);
                        }
                        setPassiveInput('');
                      }
                      if (
                        e.key === 'Backspace' &&
                        !passiveInput &&
                        passiveTokens.length > 0
                      ) {
                        setPassiveTokens((prev: CharToken[]) => prev.slice(0, -1));
                      }
                    }}
                  />
                </div>
              </div>
              {passiveSuggestions.length > 0 && (
                <div
                  className={`mt-1 rounded-md border ${tc.border} ${tc.bg} max-h-32 overflow-y-auto`}
                >
                  {passiveSuggestions.slice(0, 8).map((entry: SourcebookEntry) => (
                    <button
                      key={`passive-sug-${entry.id}`}
                      type="button"
                      className={`w-full text-left px-2 py-1.5 text-xs ${tc.text} ${tc.isLight ? 'hover:bg-brand-500/10' : 'hover:bg-brand-gray-800'}`}
                      onClick={(): void => {
                        addPassiveToken(entry.name);
                        setPassiveInput('');
                      }}
                    >
                      {entry.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={`${sectionCls} ${diffSectionCls(sourcebookChanged)}`}>
            <label className={labelCls}>{t('Sourcebook')}</label>
            <div className={`rounded-md border ${tc.border} ${tc.input} p-2`}>
              <div className="flex flex-wrap gap-2">
                {sourcebookTags.map((tag: SourcebookTag, idx: number) => {
                  const entry = entryById.get(tag.id);
                  if (!entry) return null;
                  const computedAge = sourcebookComputedAgeById.get(entry.id) ?? null;
                  const personalAgeDisplay = formatPersonalAgeDisplay(tag.personal_age);
                  const tagChanged =
                    showDiff &&
                    (idx >= baselineSourcebookIds.length ||
                      baselineSourcebookIds[idx] !== tag.id);
                  return (
                    <div
                      key={`sourcebook-${entry.id}`}
                      data-diff={tagChanged ? 'changed' : undefined}
                      role="button"
                      tabIndex={0}
                      onDoubleClick={(): void => handleTagDoubleClick(entry.id)}
                      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleTagDoubleClick(entry.id);
                        }
                      }}
                      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>): void =>
                        openHoverForEntry(e, entry)
                      }
                      onMouseLeave={closeHoverCard}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs ${diffTagCls(tagChanged)} ${tc.surface} border-brand-500/40`}
                      title={t('Double click to open sourcebook entry')}
                    >
                      <span className={tc.text}>{entry.name}</span>
                      <span
                        className={`px-1 py-0.5 rounded text-[10px] border ${tc.border} ${tc.muted}`}
                      >
                        {mapCategoryLabel(entry.category)}
                      </span>
                      {computedAge && (
                        <span className={`text-[10px] ${tc.muted}`}>
                          {t('Age {{value}}', { value: computedAge })}
                        </span>
                      )}
                      {personalAgeDisplay && personalAgeDisplay !== computedAge && (
                        <span className={`text-[10px] ${tc.muted}`}>
                          {personalAgeDisplay}
                        </span>
                      )}
                      {activeTimelinesAtScene > 1 && (
                        <button
                          type="button"
                          aria-label={t('Set character state at this scene')}
                          title={t('Set character state at this scene')}
                          className={`${tc.muted} hover:text-brand-500`}
                          onClick={(e: React.MouseEvent): void => {
                            e.stopPropagation();
                            openAgeEdit({ type: 'sourcebook_tag', entryId: entry.id });
                          }}
                        >
                          <Clock size={11} />
                        </button>
                      )}
                      <button
                        type="button"
                        className={tc.muted}
                        onClick={(event: React.MouseEvent<HTMLButtonElement>): void => {
                          event.stopPropagation();
                          setSourcebookTags((prev: SourcebookTag[]) =>
                            prev.filter((t: SourcebookTag) => t.id !== entry.id)
                          );
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                <input
                  type="text"
                  className={`min-w-[220px] flex-1 bg-transparent text-sm ${tc.text} focus:outline-none`}
                  placeholder={t('Search sourcebook entries...')}
                  value={sourcebookInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                    setSourcebookInput(e.target.value)
                  }
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>): void => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const firstSuggestion = sourcebookSuggestions[0];
                    if (firstSuggestion) {
                      addSourcebookTag(firstSuggestion.id);
                      setSourcebookInput('');
                      return;
                    }
                    const match = entryByName.get(normalizeToken(sourcebookInput));
                    if (match) {
                      addSourcebookTag(match.id);
                      setSourcebookInput('');
                    }
                  }}
                />
              </div>
            </div>
            {sourcebookSuggestions.length > 0 && (
              <div
                className={`mt-1 rounded-md border ${tc.border} ${tc.bg} max-h-40 overflow-y-auto`}
              >
                {sourcebookSuggestions.slice(0, 10).map((entry: SourcebookEntry) => (
                  <button
                    key={`sourcebook-sug-${entry.id}`}
                    type="button"
                    className={`w-full text-left px-2 py-1.5 text-xs ${tc.text} ${tc.isLight ? 'hover:bg-brand-500/10' : 'hover:bg-brand-gray-800'} flex items-center justify-between`}
                    onClick={(): void => {
                      addSourcebookTag(entry.id);
                      setSourcebookInput('');
                    }}
                  >
                    <span>{entry.name}</span>
                    <span className={tc.muted}>{mapCategoryLabel(entry.category)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            className={`${sectionCls} ${diffSectionCls(sceneTimeChanged || timelineChanged)}`}
          >
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls}>{t('Time')}</label>
              <div className="flex gap-2">
                {sceneTimeValue && (
                  <button
                    type="button"
                    className={`px-2 py-1 rounded-md border text-xs ${tc.border} ${tc.text}`}
                    onClick={(): void => setSceneTimeValue(null)}
                  >
                    {t('Clear')}
                  </button>
                )}
                <button
                  type="button"
                  className="px-2 py-1 rounded-md text-xs bg-brand-500 text-white"
                  onClick={(): void => setTemporalEditTarget({ type: 'scene' })}
                >
                  {sceneTimeValue ? t('Edit') : t('Set Time')}
                </button>
              </div>
            </div>
            <div className="mb-2">
              <label className={labelCls}>{t('Timeline')}</label>
              <select
                className={`${inputCls} ${timelineChanged ? 'ring-2 ring-brand-500/30' : ''}`}
                value={timelineId}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>): void =>
                  setTimelineId(event.target.value)
                }
                aria-label={t('Scene timeline')}
              >
                {timelineOptions.map((option: { id: string; label: string }) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {sceneTimeValue ? (
              <div
                className={`rounded-md border ${tc.border} ${tc.input} p-3 space-y-1`}
              >
                {showSceneTimeInlineDiff ? (
                  <>
                    {previousSceneTimeDisplayForDiff ? (
                      <p
                        data-testid="scene-time-diff-old"
                        className="text-sm text-red-600 dark:text-red-400 line-through"
                      >
                        {previousSceneTimeDisplayForDiff}
                      </p>
                    ) : (
                      <p className={`text-xs ${tc.muted}`}>
                        {t('Previous value unavailable')}
                      </p>
                    )}
                    <p
                      data-testid="scene-time-diff-new"
                      className="text-sm text-green-700 dark:text-green-400 font-medium"
                    >
                      {toDisplayString(sceneTimeValue, displayLocale)}
                    </p>
                  </>
                ) : (
                  <p className={`text-sm ${tc.text}`}>
                    {toDisplayString(sceneTimeValue, displayLocale)}
                  </p>
                )}
                <p className={`text-xs ${tc.muted}`}>
                  {t('International format: {{value}}', {
                    value:
                      toInternationalDisplayString(sceneTimeValue) || t('Unavailable'),
                  })}
                </p>
                {parsedSceneTime && (
                  <p className={`text-xs ${tc.muted}`}>
                    {t('Calendar: {{calendar}} | Time Zone: {{timeZone}}', {
                      calendar: parsedSceneTime.calendarId,
                      timeZone: parsedSceneTime.timeZoneId,
                    })}
                  </p>
                )}
              </div>
            ) : (
              <p className={`text-xs italic ${tc.muted}`}>
                {t('No timeline time set for this scene.')}
              </p>
            )}
          </div>

          <div className={`${sectionCls} ${diffSectionCls(colorTagChanged)}`}>
            <label className={labelCls}>{t('Color Tag')}</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={(): void => setColorTag(null)}
                className={`w-6 h-6 rounded-full border-2 ${colorTag === null ? 'border-brand-500' : tc.border} bg-brand-gray-200 dark:bg-brand-gray-700`}
                aria-label="none"
              />
              {COLOR_TAGS.map((c: string) => (
                <button
                  key={c}
                  type="button"
                  onClick={(): void => setColorTag(c)}
                  className={`w-6 h-6 rounded-full border-2 ${colorTag === c ? 'border-brand-500' : 'border-transparent'} ${COLOR_SWATCH[c]}`}
                  aria-label={c}
                />
              ))}
            </div>
          </div>

          <div className={`${sectionCls} ${diffSectionCls(statusChanged)}`}>
            <label className={labelCls}>{t('Status')}</label>
            <select
              className={`${inputCls} ${statusChanged ? 'ring-2 ring-brand-500/30' : ''}`}
              value={status}
              aria-label={t('Scene status')}
              onChange={onStatusChange}
            >
              <option value="active">{t('active')}</option>
              <option value="draft">{t('draft')}</option>
              <option value="inactive">{t('inactive')}</option>
            </select>
          </div>

          <div
            className={`${sectionCls} ${diffSectionCls(linkedProseChanged)}`}
            data-diff={linkedProseChanged ? 'changed' : undefined}
            data-diff-section="linked-prose"
          >
            <div className="flex items-center justify-between gap-2">
              <label className={labelCls}>{t('Linked Prose')}</label>
              <div className="flex items-center gap-3">
                {onWriteScene &&
                  (isWritingScene ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      theme={buttonTheme}
                      onClick={stopGeneration}
                    >
                      {t('Stop generation')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      theme={buttonTheme}
                      onClick={(): void => void handleWriteScene()}
                      disabled={isSaving || !hasBeatText}
                    >
                      {fieldActionLabel('prose', 'beats', proseHasContent)}
                    </Button>
                  ))}
                {showDiff && linkedProseChanged && (
                  <DiffViewTabs tab={linkedProseTab} onChange={setLinkedProseTab} />
                )}
              </div>
            </div>
            {thinkingLocation === 'prose' && renderThinkingPanel()}
            {isLinkedProseLink(proseLink) ? (
              <>
                {linkedProseTab === 'old' ? (
                  <div
                    className={`rounded-md border ${tc.border} px-3 py-2 text-sm font-mono whitespace-pre-wrap overflow-hidden`}
                    style={contentSurface}
                  >
                    {linkedProseBaseline || (
                      <span className="italic opacity-60">
                        {t('No previous content')}
                      </span>
                    )}
                  </div>
                ) : (
                  <>
                    {getLinkedProseText ? (
                      <div
                        className={`rounded-md border ${tc.border} overflow-hidden`}
                        style={contentSurface}
                      >
                        <CodeMirrorEditor
                          ref={linkedProseEditorRef}
                          value={localProseText}
                          onChange={onProseTextChange}
                          className={`${contentEditorCls} min-h-[9rem] font-mono`}
                          placeholder={t('Linked Prose')}
                          language={storyLanguage || 'en'}
                          spellCheck
                          viewMode="raw"
                          showDiff={
                            linkedProseTab === 'diff' && linkedProseChanged
                              ? showDiff
                              : false
                          }
                          highlightColors={highlightColors}
                          baselineValue={
                            linkedProseTab === 'diff' && linkedProseChanged
                              ? linkedProseBaseline
                              : undefined
                          }
                          searchHighlightRanges={[]}
                        />
                      </div>
                    ) : (
                      <p className={`text-xs ${tc.muted}`}>
                        {t('Open in split mode to edit linked prose')}
                      </p>
                    )}
                    <button
                      type="button"
                      className="text-xs text-red-500 hover:text-red-600 font-medium mt-1"
                      onClick={async (): Promise<void> => {
                        if (onUnlinkProse) {
                          try {
                            await onUnlinkProse(scene.id);
                            setProseLink(null);
                          } catch {
                            // error will be displayed by parent
                          }
                        }
                      }}
                    >
                      {t('Unlink prose')}
                    </button>
                  </>
                )}
              </>
            ) : isWritingScene || localProseText.length > 0 ? (
              // A brand-new scene is only linked once the backend has written
              // the prose.  Show the in-flight text anyway so writing always
              // streams visibly instead of looking frozen until the link lands.
              <div
                data-testid="scene-writing-prose-preview"
                className={`rounded-md border ${tc.border} px-3 py-2 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto ${tc.text}`}
                style={contentSurface}
              >
                {localProseText || (
                  <span className="italic opacity-60">{t('Writing Scene...')}</span>
                )}
              </div>
            ) : (
              <p className={`text-xs italic ${tc.muted}`}>
                {t('Drag prose from the editor to link this scene')}
              </p>
            )}
          </div>

          {((scene.causes?.length ?? 0) > 0 ||
            incomingCauseIds.length > 0 ||
            removedOutgoingCauseIds.length > 0 ||
            removedIncomingCauseIds.length > 0 ||
            otherScenes.length > 0) && (
            <div className={`${sectionCls} ${diffSectionCls(causesChanged)}`}>
              <label className={labelCls}>{t('Causes')}</label>
              {(incomingCauseIds.length > 0 || removedIncomingCauseIds.length > 0) && (
                <div className="space-y-1">
                  <p className={`text-xs font-medium ${tc.muted}`}>{t('Caused by')}:</p>
                  {otherScenes
                    .filter((other: Scene) => (other.causes ?? []).includes(scene.id))
                    .map((other: Scene) => {
                      const name = other.summary || String(other.id);
                      const causeAdded =
                        showDiff && !baselineIncomingCauseIds.includes(other.id);
                      return (
                        <div
                          key={other.id}
                          data-diff={causeAdded ? 'changed' : undefined}
                          className={`flex items-center gap-1 group ${diffAddedItemCls(causeAdded)}`}
                        >
                          <span
                            className={`flex-1 text-xs ${causeAdded ? 'text-green-700 dark:text-green-400' : tc.text} truncate`}
                            title={name}
                          >
                            {name}
                          </span>
                          <button
                            type="button"
                            aria-label={t('Delete cause')}
                            onClick={(): void =>
                              void onDeleteCause?.(other.id, scene.id)
                            }
                            className={`p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/40 ${tc.muted} hover:text-red-600 dark:hover:text-red-400 transition-opacity`}
                          >
                            🗑
                          </button>
                        </div>
                      );
                    })}
                  {removedIncomingCauseIds.map((id: SceneId) => {
                    const name =
                      baselineOtherScenes.find((s: Scene) => s.id === id)?.summary ||
                      String(id);
                    return (
                      <div
                        key={`removed-incoming-${id}`}
                        data-diff="changed"
                        className={`flex items-center gap-1 ${diffRemovedItemCls(true)}`}
                      >
                        <span
                          className="flex-1 text-xs text-red-600 dark:text-red-400 line-through truncate"
                          title={name}
                        >
                          {name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {((scene.causes?.length ?? 0) > 0 ||
                removedOutgoingCauseIds.length > 0) && (
                <div className="space-y-1">
                  <p className={`text-xs font-medium ${tc.muted}`}>{t('Causes')}:</p>
                  {scene.causes.map((id: SceneId) => {
                    const name =
                      allScenes.find((s: Scene) => s.id === id)?.summary || String(id);
                    const causeAdded =
                      showDiff && !baselineOutgoingCauseIds.includes(id);
                    return (
                      <div
                        key={id}
                        data-diff={causeAdded ? 'changed' : undefined}
                        className={`flex items-center gap-1 group ${diffAddedItemCls(causeAdded)}`}
                      >
                        <span
                          className={`flex-1 text-xs ${causeAdded ? 'text-green-700 dark:text-green-400' : tc.text} truncate`}
                          title={name}
                        >
                          {name}
                        </span>
                        <button
                          type="button"
                          aria-label={t('Delete cause')}
                          onClick={(): void => void onDeleteCause?.(scene.id, id)}
                          className={`p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/40 ${tc.muted} hover:text-red-600 dark:hover:text-red-400 transition-opacity`}
                        >
                          🗑
                        </button>
                      </div>
                    );
                  })}
                  {removedOutgoingCauseIds.map((id: SceneId) => {
                    const name =
                      baselineOtherScenes.find((s: Scene) => s.id === id)?.summary ||
                      String(id);
                    return (
                      <div
                        key={`removed-outgoing-${id}`}
                        data-diff="changed"
                        className={`flex items-center gap-1 ${diffRemovedItemCls(true)}`}
                      >
                        <span
                          className="flex-1 text-xs text-red-600 dark:text-red-400 line-through truncate"
                          title={name}
                        >
                          {name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className={`text-xs italic ${tc.muted}`}>
                {t('Alt+drag to create cause')}
              </p>
            </div>
          )}
        </div>

        {showDiff && (
          <FloatingDiffToolbar
            containerRef={diffContainerRef}
            enabled={true}
            isLight={tc.isLight}
            onAccept={handleDiffAccept}
            onReject={handleDiffReject}
            onAcceptAll={handleDiffAcceptAll}
            showAcceptAll={true}
          />
        )}

        <div
          className={`flex items-center justify-between px-5 py-3 border-t ${tc.border} flex-shrink-0`}
        >
          <div>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className={`text-sm ${tc.text}`}>
                  {t('Are you sure you want to delete this scene?')}
                </span>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                >
                  {t('Delete Scene')}
                </button>
                <button
                  type="button"
                  onClick={(): void => setConfirmDelete(false)}
                  className={`px-3 py-1.5 rounded-md border ${tc.border} ${tc.text} text-sm`}
                >
                  {t('Cancel')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={(): void => setConfirmDelete(true)}
                className="px-3 py-1.5 rounded-md text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 text-sm hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                {t('Delete Scene')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-1.5 rounded-md border ${tc.border} ${tc.text} text-sm hover:bg-brand-gray-100 dark:hover:bg-brand-gray-800`}
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              onClick={(): void => void handleSave()}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-md bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
            >
              {t('Save')}
            </button>
          </div>
        </div>

        {pendingSourcebookEntryId && (
          <div className="absolute inset-0 bg-black/55 flex items-center justify-center p-4 z-10">
            <div
              className={`w-full max-w-lg rounded-lg border ${tc.border} ${tc.bg} p-4 space-y-3`}
            >
              <h3 className={`text-sm font-semibold ${tc.text}`}>
                {t('Unsaved changes')}
              </h3>
              <p className={`text-sm ${tc.muted}`}>
                {t(
                  'You have unsaved scene changes. Save, discard, or cancel before opening the sourcebook entry.'
                )}
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-md border ${tc.border} ${tc.text} text-sm`}
                  onClick={(): void => setPendingSourcebookEntryId(null)}
                >
                  {t('Abort')}
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-md border ${tc.border} ${tc.text} text-sm`}
                  onClick={(): void => {
                    const entryId = pendingSourcebookEntryId;
                    setPendingSourcebookEntryId(null);
                    if (entryId) {
                      doOpenSourcebookEntry(entryId);
                      onClose();
                    }
                  }}
                >
                  {t('Discard')}
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-md bg-brand-500 text-white text-sm"
                  onClick={async (): Promise<void> => {
                    const entryId = pendingSourcebookEntryId;
                    if (!entryId) return;
                    await performSave();
                    setPendingSourcebookEntryId(null);
                    doOpenSourcebookEntry(entryId);
                    onClose();
                  }}
                >
                  {t('Save')}
                </button>
              </div>
            </div>
          </div>
        )}
        {pendingNavigationSceneId && (
          <div className="absolute inset-0 bg-black/55 flex items-center justify-center p-4 z-10">
            <div
              className={`w-full max-w-lg rounded-lg border ${tc.border} ${tc.bg} p-4 space-y-3`}
            >
              <h3 className={`text-sm font-semibold ${tc.text}`}>
                {t('Unsaved changes')}
              </h3>
              <p className={`text-sm ${tc.muted}`}>
                {t(
                  'You have unsaved scene changes. Save, discard, or cancel before switching scenes.'
                )}
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-md border ${tc.border} ${tc.text} text-sm`}
                  onClick={(): void => setPendingNavigationSceneId(null)}
                >
                  {t('Abort')}
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-md border ${tc.border} ${tc.text} text-sm`}
                  onClick={(): void => {
                    const nextSceneId = pendingNavigationSceneId;
                    setPendingNavigationSceneId(null);
                    if (nextSceneId && onNavigateScene) {
                      onNavigateScene(nextSceneId);
                    }
                  }}
                >
                  {t('Discard')}
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-md bg-brand-500 text-white text-sm"
                  onClick={async (): Promise<void> => {
                    const nextSceneId = pendingNavigationSceneId;
                    if (!nextSceneId) return;
                    await performSave();
                    setPendingNavigationSceneId(null);
                    if (onNavigateScene) {
                      onNavigateScene(nextSceneId);
                    }
                  }}
                >
                  {t('Save')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {hoveredEntry && (
        <SourcebookHoverCard
          entry={hoveredEntry}
          position={hoverPos}
          topRightMeta={
            hoveredEntryAgeDetail
              ? t('Age: {{value}}', { value: hoveredEntryAgeDetail })
              : null
          }
          bgClass={tc.bg}
          borderClass={tc.border}
          textClass={tc.text}
          subTextClass={tc.muted}
          availableImages={availableImages}
        />
      )}

      <SceneTemporalDialog
        isOpen={temporalEditTarget !== null}
        value={getTemporalDialogCurrentValue()}
        previousValue={
          temporalEditTarget?.type === 'scene' ? previousSceneTimeValue : sceneTimeValue
        }
        onClose={(): void => setTemporalEditTarget(null)}
        onApply={applyTemporalDialogValue}
      />

      {/* Age picker modal */}
      {ageEditTarget !== null && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/40"
          role="presentation"
        >
          <button
            type="button"
            aria-label={t('Close')}
            className="absolute inset-0"
            onClick={(): void => setAgeEditTarget(null)}
          />
          <div
            className={`relative rounded-xl shadow-xl border ${tc.border} ${tc.bg} p-5 w-80 space-y-3`}
            role="dialog"
            aria-label={t('Set character state at this scene')}
          >
            <p className={`text-sm font-semibold ${tc.text}`}>
              {t('Set character state at this scene')}
            </p>
            <div className="space-y-1">
              <p className={`text-xs font-medium ${tc.muted}`}>
                {t('Character state')}
              </p>
              {characterStateOptions.length > 0 ? (
                <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                  {characterStateOptions.map((option: PersonalStateOption) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={(): void => {
                        setAgeEditValue(option.value);
                        applyAgeEdit(option.value);
                      }}
                      className={`w-full text-left px-2.5 py-2 rounded-md border text-xs transition-colors ${
                        ageEditValue === option.value
                          ? 'bg-brand-500 text-white border-brand-600'
                          : `${tc.border} ${tc.text} hover:border-brand-500`
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className={`text-xs italic ${tc.muted}`}>
                  {t('No character states available')}
                </p>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className={`px-3 py-1.5 rounded-md border text-xs ${tc.border} ${tc.text}`}
                onClick={(): void => {
                  setAgeEditValue('');
                  applyAgeEdit('');
                }}
              >
                {t('Clear')}
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-md border text-xs ${tc.border} ${tc.text}`}
                onClick={(): void => setAgeEditTarget(null)}
              >
                {t('Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default SceneEditorDialog;

/* eslint-enable complexity, max-lines-per-function */
