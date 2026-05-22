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
import { ChevronLeft, ChevronRight, Clock, MessageSquareDiff } from 'lucide-react';
import type {
  Scene,
  SceneBeat,
  SceneProseLink,
  SceneTagPersonalDatetime,
  SourcebookEntry,
  SceneId,
} from '../../types';
import type { Chapter, Book } from '../../types/domain';
import { useThemeClasses } from '../layout/ThemeContext';
import { useFocusTrap } from '../layout/useFocusTrap';
import { CodeMirrorEditor } from '../editor/CodeMirrorEditor';
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
import { SceneTemporalDialog } from './SceneTemporalDialog';
import {
  getSceneEpochNanoseconds,
  buildChapterOrderMap,
  proseSort,
  normalizeChapterId,
} from './sceneSortUtils';
import { buildSceneTimelineOptions } from './timelineOptions';
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
  onClose: () => void;
  onSave: (updates: Partial<Omit<Scene, 'id'>>) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Removes the causal link between fromId and toId (updates both sides). */
  onDeleteCause?: (fromId: SceneId, toId: SceneId) => Promise<void>;
  /** Returns the current prose text for a given link, or null if unavailable. */
  getLinkedProseText?: (link: SceneProseLink) => string | null;
  /** Saves new prose content back to the file at the link range. */
  onSaveProseContent?: (text: string) => Promise<void>;
  /** Generates prose for this scene and links the result. */
  onWriteScene?: () => Promise<void>;
  /** Unlinks the scene from its current prose range. */
  onUnlinkProse?: (sceneId: SceneId) => Promise<void>;
  /** Open sourcebook dialog for an entry id. */
  onOpenSourcebookEntry?: (entryId: string) => void;
  openedViaTrigger?: boolean;
  summaryEditorRef?: React.Ref<EditorView | null>;
  onNavigateScene?: (sceneId: SceneId) => void;
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

/* eslint-disable complexity, max-lines-per-function */
export const SceneEditorDialog: React.FC<SceneEditorDialogProps> = ({
  scene,
  isOpen,
  onClose,
  onSave,
  onDelete,
  onDeleteCause,
  getLinkedProseText,
  onSaveProseContent,
  onWriteScene,
  onUnlinkProse,
  onOpenSourcebookEntry,
  openedViaTrigger = false,
  summaryEditorRef,
  onNavigateScene,
}: SceneEditorDialogProps) => {
  const { t, i18n } = useTranslation();
  const tc = useThemeClasses();
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
  const [summary, setSummary] = useState(scene.summary);
  const [beats, setBeats] = useState<SceneBeat[]>(scene.beats);
  const [showDiff, setShowDiff] = useState(Boolean(openedViaTrigger));
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
  const previousNarrativeScene =
    sceneNarrativeIndex > 0 ? narrativeOrderedScenes[sceneNarrativeIndex - 1] : null;
  const nextNarrativeScene =
    sceneNarrativeIndex >= 0 && sceneNarrativeIndex < narrativeOrderedScenes.length - 1
      ? narrativeOrderedScenes[sceneNarrativeIndex + 1]
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
  const [pendingSourcebookEntryId, setPendingSourcebookEntryId] = useState<
    string | null
  >(null);
  const [hoveredEntry, setHoveredEntry] = useState<SourcebookEntry | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [availableImages, setAvailableImages] = useState<ProjectImage[]>([]);

  const initialSnapshotRef = useRef<DirtySnapshot | null>(null);

  useEffect((): void => {
    if (!isOpen) return;

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
    setProseLink(scene.prose_link ?? null);
    setLocalProseText(
      scene.prose_link && getLinkedProseText
        ? (getLinkedProseText(scene.prose_link) ?? '')
        : ''
    );
    setProseDirty(false);
    setConfirmDelete(false);
    setPendingSourcebookEntryId(null);
    setHoveredEntry(null);
    setShowDiff(Boolean(openedViaTrigger));

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
  }, [isOpen, scene, getLinkedProseText, openedViaTrigger, baselineScene]);

  useEffect((): void => {
    if (hoveredEntry && availableImages.length === 0) {
      void listProjectImages().then((images: ProjectImage[]): void => {
        setAvailableImages(images);
      });
    }
  }, [hoveredEntry, availableImages.length]);

  if (!isOpen) return null;

  const otherScenes = allScenes.filter((s: Scene) => s.id !== scene.id);
  const previousSceneTimeValue = (() => {
    for (const candidateId of scene.order_after) {
      const linked = allScenes.find((s: Scene): boolean => s.id === candidateId);
      if (linked?.scene_time?.temporal_zoned_datetime) {
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
  const displayLocale = storyLanguage || i18n.resolvedLanguage || i18n.language;
  const summaryBaseline = baselineScene?.summary ?? (openedViaTrigger ? '' : undefined);
  const baselineBeats = baselineScene?.beats ?? [];
  const baselineActiveCharacters = baselineScene?.active_characters ?? [];
  const baselinePassiveCharacters = baselineScene?.passive_characters ?? [];
  const baselineSourcebookIds = baselineScene?.sourcebook_entry_ids ?? [];
  const baselineSceneTimeValue =
    baselineScene?.scene_time?.temporal_zoned_datetime ?? null;
  const baselineTimelineId = baselineScene
    ? normalizeTimelineId(baselineScene.timeline_id)
    : null;
  const baselineColorTag = baselineScene?.color_tag ?? null;
  const baselineStatus = baselineScene?.status;

  const beatsChanged =
    showDiff &&
    !arraysEqual(
      beats.map((beat: SceneBeat) => beat.text),
      baselineBeats.map((beat: SceneBeat) => beat.text)
    );
  const activeCharactersChanged =
    showDiff &&
    !arraysEqual(
      activeTokens.map((token: CharToken) => token.name),
      baselineActiveCharacters
    );
  const passiveCharactersChanged =
    showDiff &&
    !arraysEqual(
      passiveTokens.map((token: CharToken) => token.name),
      baselinePassiveCharacters
    );
  const sourcebookChanged =
    showDiff &&
    !arraysEqual(
      sourcebookTags.map((tag: SourcebookTag) => tag.id),
      baselineSourcebookIds
    );
  const sceneTimeChanged = showDiff && sceneTimeValue !== baselineSceneTimeValue;
  const timelineChanged =
    showDiff &&
    (baselineTimelineId === null
      ? timelineId !== MAIN_TIMELINE_ID
      : normalizeTimelineId(timelineId) !== baselineTimelineId);
  const colorTagChanged =
    showDiff && (baselineScene ? colorTag !== baselineColorTag : colorTag !== null);
  const statusChanged = showDiff && baselineScene ? status !== baselineStatus : false;

  const diffSectionCls = (changed: boolean): string =>
    changed
      ? `rounded-md ring-2 ring-brand-500/30 ${tc.isLight ? 'bg-brand-50' : 'bg-brand-gray-800'}`
      : '';
  const diffItemCls = (changed: boolean): string =>
    changed
      ? `rounded-md ${tc.isLight ? 'bg-brand-50 p-2' : 'bg-brand-gray-800/60 p-2'}`
      : '';
  const diffTagCls = (changed: boolean): string =>
    changed
      ? `${tc.isLight ? 'bg-brand-100' : 'bg-brand-gray-800'} ring-1 ring-brand-500/20`
      : '';

  const inputCls = `w-full px-3 py-2 rounded-md border ${tc.border} ${tc.input} ${tc.text} text-sm focus:outline-none focus:ring-2 focus:ring-brand-500`;
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

  const performSave = async (): Promise<void> => {
    setIsSaving(true);
    try {
      if (proseDirty && proseLink && onSaveProseContent) {
        await onSaveProseContent(localProseText);
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

  const handleWriteScene = async (): Promise<void> => {
    if (!onWriteScene) return;
    setIsWritingScene(true);
    try {
      await onWriteScene();
    } finally {
      setIsWritingScene(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    await onDelete();
    onClose();
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
  const onProseTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setLocalProseText(e.target.value);
    setProseDirty(true);
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
                  if (previousNarrativeScene && onNavigateScene) {
                    onNavigateScene(previousNarrativeScene.id);
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
                  if (nextNarrativeScene && onNavigateScene) {
                    onNavigateScene(nextNarrativeScene.id);
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
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className={sectionCls}>
            <label className={labelCls}>{t('Scene Summary')}</label>
            <div
              className={`rounded-md border ${tc.border} ${tc.input} overflow-hidden`}
            >
              <CodeMirrorEditor
                ref={summaryEditorRef}
                value={summary}
                onChange={setSummary}
                baselineValue={summaryBaseline}
                showDiff={showDiff}
                searchHighlightRanges={[]}
                language={storyLanguage}
                spellCheck={true}
                mode="markdown"
                className={`${inputCls} min-h-[120px]`}
                placeholder={t('Scene summary...')}
              />
            </div>
          </div>

          <div className={`${sectionCls} ${diffSectionCls(beatsChanged)}`}>
            <div className="flex items-center justify-between">
              <label className={labelCls}>{t('Beats')}</label>
              <button
                type="button"
                onClick={addBeat}
                className="text-xs text-brand-500 hover:text-brand-600 font-medium"
              >
                + {t('Add Beat')}
              </button>
            </div>
            {beats.map((beat: SceneBeat, idx: number) => {
              const beatChanged =
                showDiff && beat.text !== (baselineBeats[idx]?.text ?? '');
              return (
                <div
                  key={beat.id}
                  data-diff={beatChanged ? 'changed' : undefined}
                  className={`${diffItemCls(beatChanged)} flex gap-2 items-start`}
                >
                  <textarea
                    className={`${inputCls} flex-1`}
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
                        {token.personal_age && (
                          <span className={`text-[10px] ${tc.muted}`}>
                            {formatPersonalAgeDisplay(token.personal_age)}
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
                        {token.personal_age && (
                          <span className={`text-[10px] ${tc.muted}`}>
                            {formatPersonalAgeDisplay(token.personal_age)}
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
                      {tag.personal_age && (
                        <span className={`text-[10px] ${tc.muted}`}>
                          {formatPersonalAgeDisplay(tag.personal_age)}
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
                <p className={`text-sm ${tc.text}`}>
                  {toDisplayString(sceneTimeValue, displayLocale)}
                </p>
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

          <div className={sectionCls}>
            <label className={labelCls}>{t('Linked Prose')}</label>
            {onWriteScene && (
              <button
                type="button"
                className="mb-2 px-3 py-1.5 rounded-md bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 disabled:opacity-50"
                onClick={(): void => void handleWriteScene()}
                disabled={isWritingScene || isSaving}
              >
                {isWritingScene ? t('Writing Scene...') : t('Write Scene')}
              </button>
            )}
            {proseLink ? (
              <>
                {getLinkedProseText ? (
                  <textarea
                    className={`${inputCls} font-mono`}
                    rows={6}
                    value={localProseText}
                    onChange={onProseTextChange}
                    aria-label={t('Linked Prose')}
                  />
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
            ) : (
              <p className={`text-xs italic ${tc.muted}`}>
                {t('Drag prose from the editor to link this scene')}
              </p>
            )}
          </div>

          {(scene.order_before.length > 0 ||
            scene.order_after.length > 0 ||
            otherScenes.length > 0) && (
            <div className={sectionCls}>
              <label className={labelCls}>{t('Causes')}</label>
              {scene.order_before.length > 0 && (
                <div className="space-y-1">
                  <p className={`text-xs font-medium ${tc.muted}`}>
                    {t('Must come before')}:
                  </p>
                  {scene.order_before.map((id: SceneId) => {
                    const name =
                      allScenes.find((s: Scene) => s.id === id)?.summary || String(id);
                    return (
                      <div key={id} className="flex items-center gap-1 group">
                        <span
                          className={`flex-1 text-xs ${tc.text} truncate`}
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
                </div>
              )}
              {scene.order_after.length > 0 && (
                <div className="space-y-1">
                  <p className={`text-xs font-medium ${tc.muted}`}>
                    {t('Must come after')}:
                  </p>
                  {scene.order_after.map((id: SceneId) => {
                    const name =
                      allScenes.find((s: Scene) => s.id === id)?.summary || String(id);
                    return (
                      <div key={id} className="flex items-center gap-1 group">
                        <span
                          className={`flex-1 text-xs ${tc.text} truncate`}
                          title={name}
                        >
                          {name}
                        </span>
                        <button
                          type="button"
                          aria-label={t('Delete cause')}
                          onClick={(): void => void onDeleteCause?.(id, scene.id)}
                          className={`p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/40 ${tc.muted} hover:text-red-600 dark:hover:text-red-400 transition-opacity`}
                        >
                          🗑
                        </button>
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
      </div>

      {hoveredEntry && (
        <SourcebookHoverCard
          entry={hoveredEntry}
          position={hoverPos}
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
/* eslint-enable complexity, max-lines-per-function */
