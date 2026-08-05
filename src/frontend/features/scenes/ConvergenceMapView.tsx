// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Convergence Map view — shows scenes sorted chronologically (same
 * layout as the Chronological view) with one vertical SVG "snake" path per
 * sourcebook entry drawn behind the cards. The snake follows the
 * prose/experience order of the entry, turning with smooth hairpin arcs
 * whenever a time-travel jump reverses the direction on screen.
 */

import React, {
  useMemo,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
  useEffect,
} from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import type { Scene, SceneId } from '../../types';
import type { EditorSettings } from '../../types/ui';
import type { Chapter, Book, SourcebookEntry } from '../../types/domain';
import { useTheme } from '../layout/ThemeContext';
import { CauseArrows, type GhostArrow } from './ConstraintArrows';
import { useSceneLanes, isCharacterEntry } from './useSceneLanes';
import { LaneHeader } from './LaneHeader';
import { SceneCard } from './SceneCard';
import { useSceneSelection } from './useSceneSelection';
import {
  buildChapterOrderMap,
  chronologicalSort,
  proseSort,
  computeCauseOrderViolations,
  computeTemporalCauseViolations,
} from './sceneSortUtils';
import type { ProjectType } from './sceneSortUtils';
import {
  buildTimelinePanelModel,
  type TimelineJumpEvent,
} from './convergenceMapTimeline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConvergenceMapViewProps {
  scenes: Scene[];
  sourcebookEntries?: SourcebookEntry[];
  projectType: ProjectType;
  chapters: Chapter[];
  books?: Book[];
  primarySelectedSceneId: SceneId | null;
  onSelectScene: (id: SceneId | null) => void;
  onSelectionChange?: (ids: ReadonlySet<SceneId>) => void;
  relatedSceneIds?: ReadonlySet<SceneId>;
  onEditScene?: (id: SceneId) => void;
  onAssignSceneTimeline?: (sceneId: SceneId, timelineId: string) => Promise<void>;
  onCreateCause?: (fromId: SceneId, toId: SceneId) => Promise<void>;
  initialVisibleLaneEntryIds?: string[];
  initialRemovedReferencedLaneIds?: string[];
  onVisibleLaneEntryIdsChange?: (ids: string[]) => void;
  onRemovedReferencedLaneIdsChange?: (ids: string[]) => void;
  editorSettings: EditorSettings;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACK_W = 32; // px — lateral spacing between neighboring snake lanes
const TRANSITION_DX = TRACK_W / 2; // horizontal offset from down-lane to middle up-lane
const TURN_R = TRANSITION_DX / 2; // radius for top/bottom half-circle turns
const SCENE_CIRCLE_R = 5; // snake node circle radius

// Left timeline panel
const TL_LANE_START_X = 8; // px — X position of the left-most timeline lane
const TL_LANE_GAP = 28; // px — horizontal spacing between swimlanes
const TL_DOT_R = 4; // px — radius of scene dots on timeline
const TL_CORNER_R = 6; // px — rounded corner radius on loop arrows
const TL_RIGHT_PAD = 8; // px — right breathing room for arrow heads
const DEFAULT_PLACEHOLDER_ROW_HEIGHT = 84; // px — fallback until card heights are measured
const PROSE_LANE_ID = '__prose__'; // synthetic lane id for the prose-order snake
const PROSE_SNAKE_OPACITY = 0.45; // lower opacity to distinguish prose snake from entry snakes
const DEFAULT_LANE_BUTTON_WIDTH = 144;
const LANE_HEADER_GAP = 8; // gap-2 between lane header items

// Scene color tags (Tailwind 400 palette) → SVG colors for timeline dots/arrows.
const SCENE_TAG_COLORS: Record<string, string> = {
  red: '#f87171',
  orange: '#fb923c',
  yellow: '#facc15',
  green: '#4ade80',
  teal: '#2dd4bf',
  blue: '#60a5fa',
  purple: '#a78bfa',
  pink: '#f472b6',
};

const getSceneColor = (scene: Scene): string | null => {
  const tag = scene.color_tag;
  if (typeof tag !== 'string') return null;
  return SCENE_TAG_COLORS[tag] ?? null;
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

type CardLayoutEntry = { x: number; y: number; w: number; h: number };

type MeasuredRowEntry = { y: number; h: number };

const getLayoutCenterY = (layout: { y: number; h: number }): number => {
  return layout.y + layout.h / 2;
};

const getPageProseStyle = (
  settings: EditorSettings
): {
  proseTrackColor: string;
  proseFill: string;
  proseIconColor: string;
} => {
  const pageL = settings.brightness * 100;
  const pageColor = `hsl(38, 25%, ${pageL}%)`;

  if (settings.theme === 'dark') {
    const textColor = `rgba(231, 229, 228, ${settings.contrast})`;
    return {
      proseTrackColor: textColor,
      proseFill: 'rgba(231, 229, 228, 0.16)',
      proseIconColor: pageColor,
    };
  }

  if (settings.theme === 'light') {
    const textColor = `rgba(20, 15, 10, ${settings.contrast})`;
    return {
      proseTrackColor: textColor,
      proseFill: 'rgba(20, 15, 10, 0.12)',
      proseIconColor: pageColor,
    };
  }

  return {
    proseTrackColor: pageColor,
    proseFill: `hsla(38, 25%, ${pageL}%, 0.45)`,
    proseIconColor: pageColor,
  };
};

export const compareSnakeSceneOrder = (
  a: Scene,
  b: Scene,
  laneBySceneId: ReadonlyMap<SceneId, number>,
  sceneEpochNanosecondsById: ReadonlyMap<SceneId, bigint>
): number => {
  const laneA = laneBySceneId.get(a.id) ?? 0;
  const laneB = laneBySceneId.get(b.id) ?? 0;
  if (laneA < laneB) return -1;
  if (laneA > laneB) return 1;

  const epochA = sceneEpochNanosecondsById.get(a.id);
  const epochB = sceneEpochNanosecondsById.get(b.id);
  if (epochA !== undefined && epochB !== undefined) {
    if (epochA < epochB) return -1;
    if (epochA > epochB) return 1;
  } else if (epochA !== undefined) {
    return -1;
  } else if (epochB !== undefined) {
    return 1;
  }

  return a.id - b.id;
};

/**
 * Build an SVG path string for one entry's snake.
 *
 * Scenes are visited in prose order. The path is divided into "downward runs" —
 * consecutive subsequences where each scene's Y ≥ the previous scene's Y. Each
 * run occupies its own horizontal lane (laneX = startX + runIndex * TRACK_W).
 * When the next prose-ordered scene is above the current position, a transition
 * connector is emitted that moves one TRACK_W to the right and travels UP to the
 * top of the next run. Scene markers therefore only appear at the start of, or
 * within, downward segments — the snake always reads top-to-bottom within a lane.
 *
 * Connector geometry (down → up → down via middle channel):
 *   - each downward run stays on its own laneX
 *   - the upward connector uses transitionX = (laneX + nextLaneX) / 2
 *     so upward travel is visibly centered between neighboring down-lanes
 *   - both the bottom and top turns are rendered as half-circle arcs
 */
export function buildSnakePath(
  proseScenes: Scene[],
  cardLayouts: Map<SceneId, CardLayoutEntry>,
  laneCenterX: number
): { pathData: string; sceneXById: Map<SceneId, number>; snakeWidth: number } {
  const sceneXById = new Map<SceneId, number>();

  const validScenes = proseScenes.filter((s: Scene) => cardLayouts.has(s.id));
  if (validScenes.length === 0) return { pathData: '', sceneXById, snakeWidth: 0 };

  // Normalize consecutive upward prose steps so a new lane starts at the
  // highest marker of that upward chain, then proceeds top-to-bottom.
  // Example Y sequence: 20 -> 13 -> 12 -> 14 becomes 20 -> 12 -> 13 -> 14.
  const normalizedScenes: Scene[] = [validScenes[0]];
  let idx = 0;
  while (idx < validScenes.length - 1) {
    const currentY = getLayoutCenterY(cardLayouts.get(validScenes[idx].id)!);
    const nextY = getLayoutCenterY(cardLayouts.get(validScenes[idx + 1].id)!);

    if (nextY < currentY) {
      let end = idx + 1;
      while (end < validScenes.length - 1) {
        const aY = getLayoutCenterY(cardLayouts.get(validScenes[end].id)!);
        const bY = getLayoutCenterY(cardLayouts.get(validScenes[end + 1].id)!);
        if (bY < aY) {
          end += 1;
          continue;
        }
        break;
      }

      for (let k = end; k > idx; k--) {
        normalizedScenes.push(validScenes[k]);
      }
      idx = end;
      continue;
    }

    normalizedScenes.push(validScenes[idx + 1]);
    idx += 1;
  }

  // Split into downward runs — maximal consecutive subsequences where
  // each scene's Y is ≥ the previous scene's Y.
  const runs: Scene[][] = [];
  let currentRun: Scene[] = [normalizedScenes[0]];
  for (let i = 1; i < normalizedScenes.length; i++) {
    const prevY = getLayoutCenterY(cardLayouts.get(normalizedScenes[i - 1].id)!);
    const currY = getLayoutCenterY(cardLayouts.get(normalizedScenes[i].id)!);
    if (currY >= prevY) {
      currentRun.push(normalizedScenes[i]);
    } else {
      runs.push(currentRun);
      currentRun = [normalizedScenes[i]];
    }
  }
  runs.push(currentRun);

  const numRuns = runs.length;
  const startX = laneCenterX - ((numRuns - 1) * TRACK_W) / 2;
  let minX = laneCenterX;
  let maxX = laneCenterX;
  const updateBounds = (x: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  };
  const parts: string[] = [];

  for (let runIdx = 0; runIdx < numRuns; runIdx++) {
    const laneX = startX + runIdx * TRACK_W;
    const run = runs[runIdx];

    for (let j = 0; j < run.length; j++) {
      const scene = run[j];
      const y = getLayoutCenterY(cardLayouts.get(scene.id)!);

      if (runIdx === 0 && j === 0) {
        parts.push(`M ${laneX},${y}`);
        updateBounds(laneX);
      } else if (j === 0) {
        // Connector already ends at the first point of this run.
      } else {
        parts.push(`L ${laneX},${y}`);
        updateBounds(laneX);
      }
      sceneXById.set(scene.id, laneX);
    }

    // Transition connector to the next run: go right one TRACK_W, then up.
    if (runIdx < numRuns - 1) {
      const nextLaneX = startX + (runIdx + 1) * TRACK_W;
      const transitionX = laneX + TRANSITION_DX;
      const lastScene = run[run.length - 1];
      const lastY = getLayoutCenterY(cardLayouts.get(lastScene.id)!);
      const firstNextScene = runs[runIdx + 1][0];
      const firstNextY = getLayoutCenterY(cardLayouts.get(firstNextScene.id)!);
      const entryY = firstNextY;

      // Bottom U-turn: half-circle from current down-lane to middle up-lane.
      // Sweep=0 yields the downward bow while reversing direction to upward.
      if (lastY > entryY) {
        parts.push(`a ${TURN_R},${TURN_R} 0 0 0 ${TRANSITION_DX},0`);
        parts.push(`L ${transitionX},${entryY}`);
      } else {
        // Degenerate case fallback.
        parts.push(`L ${transitionX},${lastY}`);
        parts.push(`L ${transitionX},${entryY}`);
      }
      updateBounds(transitionX);

      // Top U-turn: half-circle from middle up-lane to next down-lane.
      // Sweep=1 yields the upward bow while reversing direction to downward.
      parts.push(`a ${TURN_R},${TURN_R} 0 0 1 ${TRANSITION_DX},0`);

      updateBounds(transitionX + TRANSITION_DX);
      updateBounds(nextLaneX);
    }
  }

  const snakeWidth = Math.max(0, maxX - minX);
  return { pathData: parts.join(' '), sceneXById, snakeWidth };
}

/**
 * Non-branching join geometry.
 *
 * A jump that joins an existing timeline (a future jump, or a return) is drawn
 * in its OWN swimlane: it departs from the source point, runs a short
 * horizontal lead into its swimlane, travels vertically to the arrival height,
 * then JOINS the destination timeline with a short horizontal segment whose
 * arrowhead points into the timeline.  Both right-angle turns (the lead → the
 * vertical run, and the vertical run → the join) are rounded with a knee, the
 * same corner radius the branch arrows use:
 *
 *   timeline        jump swimlane
 *       │                │
 *       │ ● depY ──┐     │
 *       │          ╰─┐   │
 *       │            │   │
 *       │ ◀────── destY  │   ← short horizontal join (arrowhead)
 *       │                │
 *
 * When the destination is the same timeline the arrow simply detours out and
 * back, keeping the jump off the timeline's own line.
 */
function buildTimelineJoinGeometry(
  originX: number,
  depY: number,
  arrowX: number,
  destY: number,
  destX: number
): { pathData: string; endX: number; endY: number } {
  const cr = Math.min(TL_CORNER_R, Math.abs(destX - arrowX), Math.abs(destY - depY));

  // No room for a rounded knee (a flat/horizontal jump) — keep the sharp path.
  if (cr < 0.5) {
    return {
      pathData: [
        `M ${originX},${depY}`,
        `L ${arrowX},${depY}`,
        `L ${arrowX},${destY}`,
        `L ${destX},${destY}`,
      ].join(' '),
      endX: destX,
      endY: destY,
    };
  }

  const goingDown = destY >= depY;
  const goingRight = destX >= arrowX;

  // Knee 1 (at depY): the horizontal lead turns into the vertical run.
  const knee1 = goingDown
    ? `a ${cr},${cr} 0 0 1 ${cr},${cr}` // right → down (clockwise)
    : `a ${cr},${cr} 0 0 0 ${cr},${-cr}`; // right → up (counter-clockwise)

  // Knee 2 (at destY): the vertical run turns horizontal to join the target.
  const knee2 = goingDown
    ? goingRight
      ? `a ${cr},${cr} 0 0 0 ${cr},${cr}` // down → right (counter-clockwise)
      : `a ${cr},${cr} 0 0 1 ${-cr},${cr}` // down → left (clockwise)
    : goingRight
      ? `a ${cr},${cr} 0 0 1 ${cr},${-cr}` // up → right (clockwise)
      : `a ${cr},${cr} 0 0 0 ${-cr},${-cr}`; // up → left (counter-clockwise)

  const verticalY = goingDown ? destY - cr : destY + cr;

  return {
    pathData: [
      `M ${originX},${depY}`,
      `L ${arrowX - cr},${depY}`,
      knee1,
      `L ${arrowX},${verticalY}`,
      knee2,
      `L ${destX},${destY}`,
    ].join(' '),
    endX: destX,
    endY: destY,
  };
}

/**
 * Branch-creation jump arrow geometry (vertical swimlane arrow).
 *
 * A time jump starts from the origin scene's marker, runs a short distance
 * horizontally to the right onto the even swimlane between the two timelines,
 * then has a knee and extends vertically to the universum-time point where the
 * new timeline branches off its origin:
 *
 *   origin lane                    new lane
 *       │                                │
 *       │ ● departure (depY) ──┐         │
 *       │                      │         │
 *       │                      │         │
 *       │                      ▼ destY   │   ← vertical arrow (even swimlane)
 *       │                                │
 *
 * Knee UP (destY < depY) is a jump to the past; knee DOWN (destY >= depY) is a
 * jump to the future. The arrowhead is vertical (`tl-arrow-up`/`tl-arrow-down`)
 * and sits at the tip; when a scene marks the arrival moment its marker dot is
 * drawn at the tip and the scene card lines up to the right.
 */
function buildBranchCreationArrowGeometry(
  originX: number,
  depY: number,
  arrowX: number,
  destY: number
): { pathData: string; endX: number; endY: number } {
  const dx = arrowX - originX;
  const goingDown = destY >= depY;
  const cr = Math.min(TL_CORNER_R, Math.abs(dx));

  if (cr < 0.5) {
    return {
      pathData: [`M ${originX},${depY}`, `L ${arrowX},${destY}`].join(' '),
      endX: arrowX,
      endY: destY,
    };
  }

  const approachX = arrowX - Math.sign(dx) * cr;
  const arcDx = Math.sign(dx) * cr;
  const arcDy = goingDown ? cr : -cr;
  const sweepFlag = dx > 0 ? (goingDown ? 1 : 0) : goingDown ? 0 : 1;

  return {
    pathData: [
      `M ${originX},${depY}`,
      `L ${approachX},${depY}`,
      `a ${cr},${cr} 0 0 ${sweepFlag} ${arcDx},${arcDy}`,
      `L ${arrowX},${destY}`,
    ].join(' '),
    endX: arrowX,
    endY: destY,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Intentionally kept as one component to keep map layout and overlay geometry together.
/* eslint-disable complexity */

export const ConvergenceMapView: React.FC<ConvergenceMapViewProps> = ({
  scenes,
  sourcebookEntries = [],
  projectType,
  chapters,
  books = [],
  primarySelectedSceneId,
  onSelectScene,
  onSelectionChange,
  relatedSceneIds,
  onEditScene,
  onAssignSceneTimeline,
  onCreateCause,
  initialVisibleLaneEntryIds,
  initialRemovedReferencedLaneIds,
  onVisibleLaneEntryIdsChange,
  onRemovedReferencedLaneIdsChange,
  editorSettings,
}: ConvergenceMapViewProps) => {
  const { t } = useTranslation();
  const { isLight } = useTheme();

  // Theme colors used by the timeline panel / character snakes.  These are
  // hoisted above the timeline geometry memos so fallback colors are
  // initialised before any arrow memo references them (otherwise a TDZ error
  // fires as soon as a jump has no departure scene).
  const trackColor = isLight ? '#6366f1' : '#a5b4fc';
  const solidFill = isLight ? '#6366f1' : '#a5b4fc';
  const hollowFill = isLight ? '#f8fafc' : '#0f172a';
  const otherTrackColor = isLight ? '#8b1f3d' : '#d7b26f';
  const otherSolidFill = isLight ? '#8b1f3d' : '#f0d8a3';

  // Lane state (shared with NarrativeView via useSceneLanes).
  const lanes = useSceneLanes({
    scenes,
    sourcebookEntries,
    onSelectScene,
    onSelectionChange,
    initialVisibleLaneEntryIds,
    initialRemovedReferencedLaneIds,
    onVisibleLaneEntryIdsChange,
    onRemovedReferencedLaneIdsChange,
  });
  const {
    visibleLaneEntryIds,
    selectedLaneEntryIds,
    markerStyleBySceneId,
    filteredScenes,
    sceneEpochNanosecondsById,
    laneScrollLeft,
    setLaneScrollLeft,
    handleBackgroundMouseDown,
    sourcebookEntriesById,
  } = lanes;

  // Build chapter order map for chronological Y-axis sorting.
  const chapterOrderMap = useMemo(
    () => buildChapterOrderMap(projectType, chapters, books),
    [projectType, chapters, books]
  );

  // Sort ALL filtered scenes chronologically — this is the Y-axis order.
  const sortedScenes = useMemo(
    () =>
      [...filteredScenes].sort((a: Scene, b: Scene) =>
        chronologicalSort(a, b, chapterOrderMap, sceneEpochNanosecondsById)
      ),
    [filteredScenes, chapterOrderMap, sceneEpochNanosecondsById]
  );

  // Multi-select state — same semantics as NarrativeView.
  const { selectedSceneIds, activeSceneId, handleCardSelect } = useSceneSelection({
    displayOrder: sortedScenes,
    primarySelectedSceneId,
    onSelectScene,
    onSelectionChange,
  });

  const causeDragSourceRef = useRef<SceneId | null>(null);
  const causeTargetRef = useRef<SceneId | null>(null);

  const [causeSourceDisplay, setCauseSourceDisplay] = useState<SceneId | null>(null);
  const [causeTargetDisplay, setCauseTargetDisplay] = useState<SceneId | null>(null);
  const [ghostArrow, setGhostArrow] = useState<GhostArrow | null>(null);

  const handleCauseDragStart = useCallback(
    (_sceneId: SceneId, startClientX: number, startClientY: number): void => {
      if (!onCreateCause) return;
      causeDragSourceRef.current = _sceneId;
      causeTargetRef.current = null;
      setCauseSourceDisplay(_sceneId);
      setCauseTargetDisplay(null);

      const containerEl = innerContainerRef.current;
      const rect = containerEl?.getBoundingClientRect();
      const x = rect ? startClientX - rect.left : 0;
      const y = rect ? startClientY - rect.top : 0;
      setGhostArrow({ fromId: _sceneId, toX: x, toY: y, connected: false });

      const onMouseMove = (me: MouseEvent): void => {
        const containerEl2 = innerContainerRef.current;
        if (!containerEl2 || !causeDragSourceRef.current) return;
        const containerRect = containerEl2.getBoundingClientRect();
        const x2 = me.clientX - containerRect.left;
        const y2 = me.clientY - containerRect.top;
        const connected = causeTargetRef.current !== null;
        setGhostArrow({
          fromId: causeDragSourceRef.current,
          toX: x2,
          toY: y2,
          connected,
        });
      };

      document.addEventListener('mousemove', onMouseMove);

      const onUp = (): void => {
        if (
          onCreateCause &&
          causeDragSourceRef.current &&
          causeTargetRef.current !== null
        ) {
          void onCreateCause(causeDragSourceRef.current, causeTargetRef.current);
        }
        causeDragSourceRef.current = null;
        causeTargetRef.current = null;
        setCauseSourceDisplay(null);
        setCauseTargetDisplay(null);
        setGhostArrow(null);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mouseup', onUp);
    },
    [onCreateCause]
  );

  const handleCauseDrop = useCallback((targetId: SceneId): void => {
    if (causeDragSourceRef.current && causeDragSourceRef.current !== targetId) {
      causeTargetRef.current = targetId;
      setCauseTargetDisplay(targetId);
    }
  }, []);

  const handleCauseLeave = useCallback((): void => {
    causeTargetRef.current = null;
    setCauseTargetDisplay(null);
  }, []);

  // Cause/effect glow — same as NarrativeView.
  const activeScene = activeSceneId
    ? (scenes.find((s: Scene) => s.id === activeSceneId) ?? null)
    : null;
  const causeIds = new Set<SceneId>(
    scenes
      .filter((s: Scene) => (s.causes ?? []).includes(activeSceneId ?? -1))
      .map((s: Scene) => s.id)
  );
  const effectIds = new Set<SceneId>(activeScene?.causes ?? []);

  // Display index for each scene card (sequential position in sorted list).
  const sceneIndexMap = useMemo(() => {
    const map = new Map<SceneId, number>();
    sortedScenes.forEach((s: Scene, i: number) => map.set(s.id, i));
    return map;
  }, [sortedScenes]);

  const orderViolationSceneIds = useMemo(
    () => computeCauseOrderViolations(sortedScenes),
    [sortedScenes]
  );

  const temporalOrderViolationSceneIds = useMemo(
    () => computeTemporalCauseViolations(scenes),
    [scenes]
  );

  // -------------------------------------------------------------------------
  // Refs & measured layout state (same pattern as NarrativeView)
  // -------------------------------------------------------------------------

  const rootRef = useRef<HTMLDivElement>(null);
  const innerContainerRef = useRef<HTMLDivElement>(null);
  const laneTrackRef = useRef<HTMLDivElement>(null);
  const proseLaneRef = useRef<HTMLDivElement>(null);
  const bottomLaneScrollRef = useRef<HTMLDivElement>(null);
  const cardWrapperRefs = useRef(new Map<SceneId, HTMLDivElement>());
  const epochGapRefs = useRef(new Map<string, HTMLDivElement>());

  const [cardLayouts, setCardLayouts] = useState<Map<SceneId, CardLayoutEntry>>(
    new Map()
  );
  const [epochGapLayouts, setEpochGapLayouts] = useState<Map<string, MeasuredRowEntry>>(
    new Map()
  );
  const [lanePlaneWidth, setLanePlaneWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const cardLayoutsEqual = (
    a: ReadonlyMap<SceneId, CardLayoutEntry>,
    b: ReadonlyMap<SceneId, CardLayoutEntry>
  ): boolean => {
    if (a.size !== b.size) return false;
    for (const [key, value] of a) {
      const other = b.get(key);
      if (!other) return false;
      if (
        other.x !== value.x ||
        other.y !== value.y ||
        other.w !== value.w ||
        other.h !== value.h
      ) {
        return false;
      }
    }
    return true;
  };

  const rowLayoutsEqual = (
    a: ReadonlyMap<string, MeasuredRowEntry>,
    b: ReadonlyMap<string, MeasuredRowEntry>
  ): boolean => {
    if (a.size !== b.size) return false;
    for (const [key, value] of a) {
      const other = b.get(key);
      if (!other) return false;
      if (other.y !== value.y || other.h !== value.h) return false;
    }
    return true;
  };

  /** Measure all card positions and lane button centers. */
  const measureLayouts = useCallback(() => {
    const nextCards = new Map<SceneId, CardLayoutEntry>();
    cardWrapperRefs.current.forEach((el: HTMLDivElement, id: SceneId) => {
      nextCards.set(id, {
        x: el.offsetLeft,
        y: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
      });
    });
    setCardLayouts((prev: Map<SceneId, CardLayoutEntry>) =>
      cardLayoutsEqual(prev, nextCards) ? prev : nextCards
    );

    const nextEpochGapLayouts = new Map<string, MeasuredRowEntry>();
    epochGapRefs.current.forEach((el: HTMLDivElement, key: string) => {
      nextEpochGapLayouts.set(key, {
        y: el.offsetTop,
        h: el.offsetHeight,
      });
    });
    setEpochGapLayouts((prev: Map<string, MeasuredRowEntry>) =>
      rowLayoutsEqual(prev, nextEpochGapLayouts) ? prev : nextEpochGapLayouts
    );

    const nextLanePlaneWidth =
      laneTrackRef.current?.scrollWidth ?? laneTrackRef.current?.offsetWidth ?? 0;
    setLanePlaneWidth((prev: number) =>
      Math.abs(prev - nextLanePlaneWidth) < 1 ? prev : nextLanePlaneWidth
    );
    const nextViewportHeight = innerContainerRef.current?.clientHeight ?? 0;
    setViewportHeight((prev: number) =>
      Math.abs(prev - nextViewportHeight) < 1 ? prev : nextViewportHeight
    );
  }, []);

  useEffect(() => {
    const els = [innerContainerRef.current, laneTrackRef.current].filter(
      (el: HTMLDivElement | null): el is HTMLDivElement => el !== null
    );
    if (els.length === 0) return undefined;
    const ro = new ResizeObserver(measureLayouts);
    els.forEach((el: HTMLDivElement) => ro.observe(el));
    return () => ro.disconnect();
  }, [measureLayouts]);

  const timelinePanelModel = useMemo(
    () =>
      buildTimelinePanelModel(
        sortedScenes,
        sourcebookEntries,
        sceneEpochNanosecondsById
      ),
    [sortedScenes, sourcebookEntries, sceneEpochNanosecondsById]
  );

  const [draggingSceneId, setDraggingSceneId] = useState<SceneId | null>(null);
  const [dragHoverLane, setDragHoverLane] = useState<number | null>(null);
  const [pendingTimelineAssignments, setPendingTimelineAssignments] = useState<
    Map<SceneId, number>
  >(new Map());

  const getClosestTimelineLane = useCallback(
    (clientX: number, svg: SVGSVGElement | null): number | null => {
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const x = clientX - rect.left;
      let bestLane: number | null = null;
      let bestDist = Infinity;
      timelinePanelModel.laneNumbers.forEach((laneNumber: number) => {
        const laneX = TL_LANE_START_X + laneNumber * TL_LANE_GAP;
        const dist = Math.abs(x - laneX);
        if (dist < bestDist) {
          bestDist = dist;
          bestLane = laneNumber;
        }
      });
      return bestLane;
    },
    [timelinePanelModel.laneNumbers]
  );

  const handleTimelineDotPointerDown = useCallback(
    (sceneId: SceneId) =>
      (event: React.PointerEvent<SVGCircleElement>): void => {
        event.stopPropagation();
        event.preventDefault();
        const target = event.currentTarget;
        if (target.setPointerCapture) {
          target.setPointerCapture(event.pointerId);
        }
        setDraggingSceneId(sceneId);
        const lane = getClosestTimelineLane(event.clientX, target.ownerSVGElement);
        setDragHoverLane(lane);
      },
    [getClosestTimelineLane]
  );

  const handleTimelinePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): void => {
      if (draggingSceneId === null) return;
      const lane = getClosestTimelineLane(event.clientX, event.currentTarget);
      setDragHoverLane(lane);
    },
    [draggingSceneId, getClosestTimelineLane]
  );

  const commitTimelineAssignment = useCallback(
    async (sceneId: SceneId, lane: number | null): Promise<void> => {
      if (lane === null || onAssignSceneTimeline === undefined) return;
      const timelineId = timelinePanelModel.timelineIdByLane.get(lane);
      if (!timelineId) return;
      const scene = scenes.find((item: Scene) => item.id === sceneId);
      if (!scene) return;
      const currentTimelineId = scene.timeline_id ?? 'main';
      if (currentTimelineId === timelineId) {
        return;
      }

      setPendingTimelineAssignments(
        (prev: Map<SceneId, number>): Map<SceneId, number> => {
          const next = new Map(prev);
          next.set(sceneId, lane);
          return next;
        }
      );

      try {
        await onAssignSceneTimeline(sceneId, timelineId);
      } catch (error) {
        console.error(error);
        setPendingTimelineAssignments(
          (prev: Map<SceneId, number>): Map<SceneId, number> => {
            const next = new Map(prev);
            next.delete(sceneId);
            return next;
          }
        );
      }
    },
    [onAssignSceneTimeline, scenes, timelinePanelModel.timelineIdByLane]
  );

  useEffect(() => {
    if (pendingTimelineAssignments.size === 0) return;

    const next = new Map(pendingTimelineAssignments);
    let hasChanged = false;

    next.forEach((laneNumber: number, sceneId: SceneId): void => {
      const currentLane = timelinePanelModel.laneBySceneId.get(sceneId);
      if (currentLane === laneNumber) {
        next.delete(sceneId);
        hasChanged = true;
      }
    });

    if (hasChanged) {
      setPendingTimelineAssignments(next);
    }
  }, [pendingTimelineAssignments, timelinePanelModel.laneBySceneId]);

  const handleTimelinePointerUp = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): void => {
      if (draggingSceneId === null) return;
      const lane = getClosestTimelineLane(event.clientX, event.currentTarget);
      commitTimelineAssignment(draggingSceneId, lane);
      setDraggingSceneId(null);
      setDragHoverLane(lane);
    },
    [commitTimelineAssignment, draggingSceneId, getClosestTimelineLane]
  );

  const handleTimelinePointerCancel = useCallback((): void => {
    setDraggingSceneId(null);
    setDragHoverLane(null);
  }, []);

  // -------------------------------------------------------------------------
  // Snake path data (computed from measured layouts)
  // -------------------------------------------------------------------------

  const entrySnakeModelsById = useMemo(() => {
    const models = new Map<string, { proseScenes: Scene[]; snakeWidth: number }>();

    visibleLaneEntryIds.forEach((entryId: string) => {
      const entryScenes = sortedScenes.filter((s: Scene) =>
        markerStyleBySceneId.get(s.id)?.has(entryId)
      );
      const proseScenes = [...entryScenes].sort((a: Scene, b: Scene) => {
        return compareSnakeSceneOrder(
          a,
          b,
          timelinePanelModel.laneBySceneId,
          sceneEpochNanosecondsById
        );
      });

      const { snakeWidth } = buildSnakePath(proseScenes, cardLayouts, 0);
      models.set(entryId, { proseScenes, snakeWidth });
    });

    return models;
  }, [
    visibleLaneEntryIds,
    sortedScenes,
    markerStyleBySceneId,
    timelinePanelModel.laneBySceneId,
    sceneEpochNanosecondsById,
    cardLayouts,
  ]);

  const proseOrderedScenes = useMemo(
    () =>
      [...filteredScenes].sort((a: Scene, b: Scene) =>
        proseSort(a, b, chapterOrderMap)
      ),
    [filteredScenes, chapterOrderMap]
  );

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

  const proseSceneChapterById = useMemo((): Map<SceneId, string | null> => {
    const chapterRuns = proseOrderedScenes.map((scene: Scene) => {
      const link = scene.prose_link;
      if (!link || link.scope_type !== 'chapter') return null;
      const chapterId =
        typeof link.chapter_id === 'string'
          ? link.chapter_id.trim()
          : String(link.chapter_id ?? '');
      return chapterId.length > 0 ? chapterId : null;
    });

    const map = new Map<SceneId, string | null>();
    proseOrderedScenes.forEach((scene: Scene, index: number): void => {
      const directChapterId = chapterRuns[index];
      if (directChapterId) {
        map.set(scene.id, directChapterId);
        return;
      }

      let previousChapterId: string | null = null;
      for (let i = index - 1; i >= 0; i -= 1) {
        if (chapterRuns[i]) {
          previousChapterId = chapterRuns[i];
          break;
        }
      }
      if (previousChapterId) {
        map.set(scene.id, previousChapterId);
        return;
      }

      let nextChapterId: string | null = null;
      for (let i = index + 1; i < chapterRuns.length; i += 1) {
        if (chapterRuns[i]) {
          nextChapterId = chapterRuns[i];
          break;
        }
      }
      map.set(scene.id, nextChapterId);
    });

    return map;
  }, [proseOrderedScenes]);

  const proseSnakeWidth = useMemo(() => {
    const { snakeWidth } = buildSnakePath(proseOrderedScenes, cardLayouts, 0);
    return snakeWidth;
  }, [proseOrderedScenes, cardLayouts]);

  const laneWidths = useMemo(() => {
    const widths = new Map<string, number>();
    entrySnakeModelsById.forEach(
      (model: { proseScenes: Scene[]; snakeWidth: number }, entryId: string) => {
        const requiredWidth = Math.max(
          DEFAULT_LANE_BUTTON_WIDTH,
          model.snakeWidth + SCENE_CIRCLE_R * 2 + 16
        );
        widths.set(entryId, requiredWidth);
      }
    );
    return widths;
  }, [entrySnakeModelsById]);

  const proseLaneWidth = useMemo(() => {
    return Math.max(
      DEFAULT_LANE_BUTTON_WIDTH,
      proseSnakeWidth + SCENE_CIRCLE_R * 2 + 16
    );
  }, [proseSnakeWidth]);

  const laneCenterXById = useMemo(() => {
    const centers = new Map<string, number>();
    let xCursor = 0;
    centers.set(PROSE_LANE_ID, xCursor + proseLaneWidth / 2);
    xCursor += proseLaneWidth + LANE_HEADER_GAP;

    visibleLaneEntryIds.forEach((entryId: string) => {
      const laneWidth = laneWidths.get(entryId) ?? DEFAULT_LANE_BUTTON_WIDTH;
      centers.set(entryId, xCursor + laneWidth / 2);
      xCursor += laneWidth + LANE_HEADER_GAP;
    });

    return centers;
  }, [proseLaneWidth, visibleLaneEntryIds, laneWidths]);

  const snakePaths = useMemo(() => {
    return visibleLaneEntryIds.map((entryId: string) => {
      const centerX = laneCenterXById.get(entryId);
      const model = entrySnakeModelsById.get(entryId);
      if (centerX === undefined || !model) return null;

      const { pathData, sceneXById } = buildSnakePath(
        model.proseScenes,
        cardLayouts,
        centerX
      );

      return { entryId, pathData, proseScenes: model.proseScenes, sceneXById };
    });
  }, [visibleLaneEntryIds, laneCenterXById, entrySnakeModelsById, cardLayouts]);

  useLayoutEffect(() => {
    measureLayouts();
  }, [sortedScenes, visibleLaneEntryIds, measureLayouts]);

  // -------------------------------------------------------------------------
  // Prose-order snake (shows the narrative/chapter sequence of all scenes)
  // -------------------------------------------------------------------------

  const proseSnakePath = useMemo(() => {
    const centerX = laneCenterXById.get(PROSE_LANE_ID);
    if (centerX === undefined) return null;

    const { pathData, sceneXById, snakeWidth } = buildSnakePath(
      proseOrderedScenes,
      cardLayouts,
      centerX
    );
    return { pathData, proseScenes: proseOrderedScenes, sceneXById, snakeWidth };
  }, [laneCenterXById, proseOrderedScenes, cardLayouts]);

  const proseBreakMarkers = useMemo(() => {
    if (!proseSnakePath) return [] as Array<{ x: number; y: number; lines: 1 | 2 }>;

    const markers: Array<{ x: number; y: number; lines: 1 | 2 }> = [];
    for (let i = 1; i < proseOrderedScenes.length; i += 1) {
      const previousScene = proseOrderedScenes[i - 1];
      const currentScene = proseOrderedScenes[i];
      const previousLayout = cardLayouts.get(previousScene.id);
      const currentLayout = cardLayouts.get(currentScene.id);
      if (!previousLayout || !currentLayout) continue;

      const previousChapterId = proseSceneChapterById.get(previousScene.id) ?? null;
      const currentChapterId = proseSceneChapterById.get(currentScene.id) ?? null;
      if (
        !previousChapterId ||
        !currentChapterId ||
        previousChapterId === currentChapterId
      ) {
        continue;
      }

      const previousBookId = chapterById.get(previousChapterId)?.book_id ?? null;
      const currentBookId = chapterById.get(currentChapterId)?.book_id ?? null;
      const previousBook = previousBookId
        ? (bookById.get(previousBookId) ?? null)
        : null;
      const currentBook = currentBookId ? (bookById.get(currentBookId) ?? null) : null;
      const hasBookBreak =
        projectType === 'series' &&
        previousBook?.id !== undefined &&
        currentBook?.id !== undefined &&
        previousBook.id !== currentBook.id;

      const previousX = proseSnakePath.sceneXById.get(previousScene.id);
      const currentX = proseSnakePath.sceneXById.get(currentScene.id);
      const markerX =
        previousX !== undefined && currentX !== undefined
          ? (previousX + currentX) / 2
          : (currentX ?? previousX);
      if (markerX === undefined) {
        continue;
      }

      markers.push({
        x: markerX,
        y: (getLayoutCenterY(previousLayout) + getLayoutCenterY(currentLayout)) / 2,
        lines: hasBookBreak ? 2 : 1,
      });
    }

    return markers;
  }, [
    proseSnakePath,
    proseOrderedScenes,
    cardLayouts,
    proseSceneChapterById,
    chapterById,
    bookById,
    projectType,
  ]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      measureLayouts();
    });
    return () => cancelAnimationFrame(raf);
  }, [sortedScenes, visibleLaneEntryIds, measureLayouts]);

  // -------------------------------------------------------------------------
  // Time travel arrows for the left timeline panel
  // -------------------------------------------------------------------------

  type TimeTravelArrow = {
    pathData: string;
    markerEnd?: string;
    goingDown: boolean;
    entryName: string;
    createsNewTimeline: boolean;
    sourceX: number;
    destinationX: number;
    depY: number;
    destY: number;
    color: string;
  };
  const timelineLaneStartYByNumber = useMemo(() => {
    const starts = new Map<number, number>();

    sortedScenes.forEach((scene: Scene): void => {
      const layout = cardLayouts.get(scene.id);
      if (!layout) return;
      const cy = layout.y + layout.h / 2;
      const lane = timelinePanelModel.laneBySceneId.get(scene.id) ?? 0;
      const prev = starts.get(lane);
      if (prev === undefined || cy < prev) {
        starts.set(lane, cy);
      }
    });

    timelinePanelModel.events.forEach((event: TimelineJumpEvent): void => {
      if (!event.createsNewTimeline) return;
      if (event.destinationEpochNs === null) return;

      const startY =
        event.destinationSceneId !== null
          ? (() => {
              const sceneLayout = cardLayouts.get(event.destinationSceneId);
              return sceneLayout ? getLayoutCenterY(sceneLayout) : null;
            })()
          : (() => {
              const gap = epochGapLayouts.get(event.destinationEpochNs.toString());
              return gap ? getLayoutCenterY(gap) : null;
            })();
      if (startY === null) return;

      const prev = starts.get(event.destinationLane);
      if (prev === undefined || startY < prev) {
        starts.set(event.destinationLane, startY);
      }
    });

    return starts;
  }, [timelinePanelModel.events, sortedScenes, cardLayouts, epochGapLayouts]);

  const timelineLaneXByNumber = useMemo(() => {
    const map = new Map<number, number>();
    timelinePanelModel.laneNumbers.forEach((lane: number) => {
      map.set(lane, TL_LANE_START_X + lane * TL_LANE_GAP);
    });
    return map;
  }, [timelinePanelModel.laneNumbers]);

  /**
   * X coordinate for each scene's marker dot.  Normally a scene's dot sits on
   * its own timeline lane (odd swimlane).  A scene that exists at the exact
   * moment a time jump arrives (the destination scene of a branch-creating
   * jump) is instead marked at the TIP of that jump arrow — on the even
   * swimlane between the source and destination timelines — with its card at
   * the same height to the right.
   */
  const sceneMarkerXBySceneId = useMemo((): Map<SceneId, number> => {
    const markerX = new Map<SceneId, number>();
    sortedScenes.forEach((scene: Scene): void => {
      const lane = timelinePanelModel.laneBySceneId.get(scene.id) ?? 0;
      const laneX = timelineLaneXByNumber.get(lane);
      if (laneX !== undefined) markerX.set(scene.id, laneX);
    });

    timelinePanelModel.events.forEach((ev: TimelineJumpEvent): void => {
      if (!ev.createsNewTimeline || ev.destinationSceneId === null) return;
      const eventLaneX = timelineLaneXByNumber.get(ev.lane);
      if (eventLaneX === undefined) return;
      // The destination scene of a branch-creating jump is marked at the tip of
      // its arrow, on the jump's OWN swimlane.
      markerX.set(ev.destinationSceneId, eventLaneX);
    });

    return markerX;
  }, [sortedScenes, timelinePanelModel, timelineLaneXByNumber]);

  /** Resolved SVG color per scene (from its color_tag), or null when unset. */
  const sceneColorBySceneId = useMemo((): Map<SceneId, string | null> => {
    const colors = new Map<SceneId, string | null>();
    sortedScenes.forEach((scene: Scene): void => {
      colors.set(scene.id, getSceneColor(scene));
    });
    return colors;
  }, [sortedScenes]);

  const timelinePanelWidth = useMemo(() => {
    // Every timeline AND every jump reserves its own swimlane, so the panel
    // spans exactly the widest occupied column.
    const maxColumn = Math.max(0, ...timelinePanelModel.laneNumbers);
    return TL_LANE_START_X + maxColumn * TL_LANE_GAP + TL_RIGHT_PAD;
  }, [timelinePanelModel.laneNumbers]);

  /**
   * Y of each branch lane's branch point — the universum-time point where the
   * new timeline branches off its origin (the destination scene row when a
   * scene covers the arrival, otherwise the empty gap row).  Used both to start
   * the spawned timeline's horizontal line and to anchor the jump arrow tip.
   */
  const branchPointYByLane = useMemo((): Map<number, number | null> => {
    const points = new Map<number, number | null>();
    points.set(0, null);

    timelinePanelModel.events.forEach((ev: TimelineJumpEvent): void => {
      if (!ev.createsNewTimeline || ev.destinationEpochNs === null) return;
      let y: number | null = null;
      if (ev.destinationSceneId !== null) {
        const layout = cardLayouts.get(ev.destinationSceneId);
        y = layout ? getLayoutCenterY(layout) : null;
      }
      if (y === null) {
        const gap = epochGapLayouts.get(ev.destinationEpochNs.toString());
        y = gap ? getLayoutCenterY(gap) : null;
      }
      points.set(ev.destinationLane, y);
    });

    return points;
  }, [timelinePanelModel.events, cardLayouts, epochGapLayouts]);

  /** Maps each spawned branch lane → the source lane it branches off. */
  const timelineSpawnParentLane = useMemo((): Map<number, number> => {
    const map = new Map<number, number>();
    timelinePanelModel.events.forEach((ev: TimelineJumpEvent): void => {
      if (!ev.createsNewTimeline) return;
      if (!map.has(ev.destinationLane)) {
        map.set(ev.destinationLane, ev.sourceLane);
      }
    });
    return map;
  }, [timelinePanelModel.events]);

  const timeTravelArrows = useMemo((): TimeTravelArrow[] => {
    const arrows: TimeTravelArrow[] = [];

    const findSceneCenterForEpochInLane = (
      epochNs: bigint,
      lane: number
    ): number | null => {
      let bestY: number | null = null;

      sortedScenes.forEach((scene: Scene): void => {
        const sceneEpoch = sceneEpochNanosecondsById.get(scene.id);
        if (sceneEpoch === undefined || sceneEpoch !== epochNs) return;

        const sceneLane = timelinePanelModel.laneBySceneId.get(scene.id) ?? 0;
        if (sceneLane !== lane) return;

        const layout = cardLayouts.get(scene.id);
        if (!layout) return;

        const y = getLayoutCenterY(layout);
        if (bestY === null || y < bestY) {
          bestY = y;
        }
      });

      return bestY;
    };

    timelinePanelModel.events.forEach((ev: TimelineJumpEvent): void => {
      const sourceX = timelineLaneXByNumber.get(ev.sourceLane);
      if (sourceX === undefined) return;
      // The model only emits events with a known destination (a travel without
      // one draws no arrow), but the type keeps it nullable — guard it here.
      if (ev.destinationEpochNs === null) return;
      // The jump's OWN swimlane — never shared with a timeline or another jump.
      const arrowX = timelineLaneXByNumber.get(ev.lane) ?? sourceX;
      const destinationLaneX = timelineLaneXByNumber.get(ev.destinationLane) ?? sourceX;

      // The arrow is drawn dotted and colored like the causing scene.
      const arrowColor =
        ev.departureSceneId !== null
          ? (sceneColorBySceneId.get(ev.departureSceneId) ?? trackColor)
          : trackColor;

      // Departure point
      const depY =
        ev.departureSceneId !== null
          ? (() => {
              const sceneLayout = cardLayouts.get(ev.departureSceneId);
              return sceneLayout ? sceneLayout.y + sceneLayout.h / 2 : null;
            })()
          : (() => {
              const gap = epochGapLayouts.get(ev.departureEpochNs.toString());
              if (gap) return getLayoutCenterY(gap);

              // If no synthetic gap row exists (because a real scene now occupies
              // this exact epoch), anchor to the matching scene row on this lane.
              return findSceneCenterForEpochInLane(ev.departureEpochNs, ev.sourceLane);
            })();
      if (depY === null) return;

      // Determine destination point
      let destX = destinationLaneX;
      let destY: number | null = null;

      if (ev.createsNewTimeline) {
        // Branching case: the arrow extends to the universum-time point where
        // the new timeline branches off its origin (its branch point).  When a
        // scene covers that moment its marker sits at the arrow tip, so the
        // arrow head and the marker share the SAME vertical position; when no
        // scene covers it, the arrow points at the empty gap row (no marker).
        const destDotY = branchPointYByLane.get(ev.destinationLane) ?? null;
        destY = destDotY;
      } else {
        // Non-branching case: point at the destination scene on the destination
        // timeline (arrow head at the marker's vertical position), or at the
        // empty gap row when no scene covers the arrival (no marker).
        if (ev.destinationSceneId !== null) {
          const sceneLayout = cardLayouts.get(ev.destinationSceneId);
          destY = sceneLayout ? sceneLayout.y + sceneLayout.h / 2 : null;
        } else {
          const gap = epochGapLayouts.get(ev.destinationEpochNs.toString());
          destY = gap ? getLayoutCenterY(gap) : null;
        }
      }

      if (destY === null) return;
      if (Math.abs(destY - depY) < 2 && sourceX === destX) return;

      // Origin marker: every jump starts at the departure scene's dot, on its
      // OWN timeline — never on a different timeline while the marker sits
      // elsewhere.  A branch-creation jump uses the marker as its origin; a
      // non-branching join does the same, then runs in its own swimlane and
      // joins the destination timeline (a return loops back to the line it
      // left).
      const departureMarkerX =
        ev.departureSceneId !== null
          ? (sceneMarkerXBySceneId.get(ev.departureSceneId) ?? sourceX)
          : sourceX;

      let pathData: string;
      let markerEnd: string;

      if (ev.createsNewTimeline && ev.destinationEpochNs !== null) {
        const geometry = buildBranchCreationArrowGeometry(
          departureMarkerX,
          depY,
          arrowX,
          destY
        );
        pathData = geometry.pathData;
        markerEnd = destY > depY ? 'url(#tl-arrow-down)' : 'url(#tl-arrow-up)';

        arrows.push({
          pathData,
          markerEnd,
          goingDown: destY > depY,
          entryName: ev.entryName,
          createsNewTimeline: ev.createsNewTimeline,
          sourceX,
          destinationX: geometry.endX,
          depY,
          destY: geometry.endY,
          color: arrowColor,
        });
        return;
      }

      // Non-branching join: depart from the departure scene's dot → the jump's
      // own swimlane → arrival height → a short horizontal segment joining the
      // destination timeline.
      const geometry = buildTimelineJoinGeometry(
        departureMarkerX,
        depY,
        arrowX,
        destY,
        destX
      );
      pathData = geometry.pathData;
      markerEnd = destX > arrowX ? 'url(#tl-arrow-right)' : 'url(#tl-arrow-left)';

      arrows.push({
        pathData,
        markerEnd,
        goingDown: destY > depY,
        entryName: ev.entryName,
        createsNewTimeline: ev.createsNewTimeline,
        sourceX,
        destinationX: geometry.endX,
        depY,
        destY: geometry.endY,
        color: arrowColor,
      });
    });

    return arrows;
  }, [
    timelinePanelModel.events,
    cardLayouts,
    epochGapLayouts,
    timelineLaneXByNumber,
    branchPointYByLane,
    sceneMarkerXBySceneId,
    sceneColorBySceneId,
  ]);

  const timelineSceneAreaHeight = useMemo(() => {
    let maxBottom = 0;
    cardLayouts.forEach((layout: CardLayoutEntry): void => {
      maxBottom = Math.max(maxBottom, layout.y + layout.h);
    });
    return Math.ceil(maxBottom + 8);
  }, [cardLayouts]);

  const timelineOverlayHeight = Math.max(timelineSceneAreaHeight, viewportHeight);
  const cardsLeftPadding = timelinePanelWidth + 4;

  /**
   * Spawn path for each branched timeline (directory-tree style): a horizontal
   * "side going" line from the parent timeline at the branch point, a downward
   * knee, then a vertical line down to the bottom of the panel.
   */
  const branchSpawnPaths = useMemo((): Map<number, string> => {
    const paths = new Map<number, string>();
    timelinePanelModel.timelineLaneNumbers.forEach((laneNumber: number): void => {
      if (laneNumber === 0) return;
      const branchY = branchPointYByLane.get(laneNumber);
      if (branchY === null || branchY === undefined) return;
      const laneX = timelineLaneXByNumber.get(laneNumber);
      const parentLane = timelineSpawnParentLane.get(laneNumber) ?? 0;
      const parentX = timelineLaneXByNumber.get(parentLane);
      if (laneX === undefined || parentX === undefined) return;

      // Directory-tree spawn: a horizontal line from the parent at the branch
      // point, a rounded knee turning downward, then the vertical trunk to the
      // bottom.  Each timeline's trunk starts at its own branch point only — it
      // is never extended upward, so no timeline appears to start at a Y where
      // it does not actually begin.
      const dx = laneX - parentX;
      const absDx = Math.abs(dx);
      const horizontalSign = dx >= 0 ? 1 : -1;
      const cr = Math.min(TL_CORNER_R, absDx / 2);

      if (absDx < 0.5 || cr < 0.5) {
        paths.set(
          laneNumber,
          [`M ${parentX},${branchY}`, `L ${laneX},${timelineOverlayHeight}`].join(' ')
        );
        return;
      }

      const horizontalEndX = laneX - horizontalSign * cr;
      const arcDx = horizontalSign * cr;
      const arcDy = cr;
      paths.set(
        laneNumber,
        [
          `M ${parentX},${branchY}`,
          `L ${horizontalEndX},${branchY}`,
          `a ${cr},${cr} 0 0 ${horizontalSign > 0 ? 1 : 0} ${arcDx},${arcDy}`,
          `L ${laneX},${timelineOverlayHeight}`,
        ].join(' ')
      );
    });
    return paths;
  }, [
    timelinePanelModel.timelineLaneNumbers,
    branchPointYByLane,
    timelineSpawnParentLane,
    timelineLaneXByNumber,
    timelineOverlayHeight,
  ]);

  const placeholderRowHeight = useMemo((): number => {
    const heights = Array.from(cardLayouts.values()).map(
      (layout: CardLayoutEntry): number => layout.h
    );
    if (heights.length === 0) {
      return DEFAULT_PLACEHOLDER_ROW_HEIGHT;
    }
    const sortedHeights = [...heights].sort((a: number, b: number) => a - b);
    const middle = Math.floor(sortedHeights.length / 2);
    const median =
      sortedHeights.length % 2 === 1
        ? sortedHeights[middle]
        : (sortedHeights[middle - 1] + sortedHeights[middle]) / 2;
    return Math.max(40, Math.round(median));
  }, [cardLayouts]);

  /** All distinct epochs referenced by time-travel events that do not coincide
   *  with an actual scene row.  Each gets a blank gap row so arrows can anchor
   *  to a concrete DOM position without interpolation. */
  const gapEpochs = useMemo((): bigint[] => {
    const sceneEpochSet = new Set<bigint>();
    sortedScenes.forEach((scene: Scene) => {
      const ns = sceneEpochNanosecondsById.get(scene.id);
      if (ns !== undefined) sceneEpochSet.add(ns);
    });
    const seen = new Set<bigint>();
    const result: bigint[] = [];
    timelinePanelModel.events.forEach((ev: TimelineJumpEvent) => {
      const candidates: (bigint | null)[] = [
        ev.departureSceneId === null ? ev.departureEpochNs : null,
        ev.destinationSceneId === null && ev.destinationEpochNs !== null
          ? ev.destinationEpochNs
          : null,
      ];
      candidates.forEach((ns: bigint | null) => {
        if (ns !== null && !sceneEpochSet.has(ns) && !seen.has(ns)) {
          seen.add(ns);
          result.push(ns);
        }
      });
    });
    return result.sort((a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0));
  }, [timelinePanelModel.events, sortedScenes, sceneEpochNanosecondsById]);

  type TimelineListRow =
    | { kind: 'scene'; scene: Scene }
    | { kind: 'epoch-gap'; key: string; epochNs: bigint };

  const timelineListRows = useMemo((): TimelineListRow[] => {
    const rows: TimelineListRow[] = [];
    let gapIndex = 0;

    sortedScenes.forEach((scene: Scene, index: number): void => {
      const sceneEpoch = sceneEpochNanosecondsById.get(scene.id) ?? null;
      const previousScene = index > 0 ? sortedScenes[index - 1] : null;
      const previousEpoch =
        previousScene !== null
          ? (sceneEpochNanosecondsById.get(previousScene.id) ?? null)
          : null;

      while (gapIndex < gapEpochs.length) {
        const gapEpoch = gapEpochs[gapIndex];
        const afterPrevious = previousEpoch === null || gapEpoch > previousEpoch;
        const beforeCurrent = sceneEpoch !== null && gapEpoch <= sceneEpoch;
        if (afterPrevious && beforeCurrent) {
          rows.push({
            kind: 'epoch-gap',
            key: `epoch-gap-${gapEpoch.toString()}`,
            epochNs: gapEpoch,
          });
          gapIndex += 1;
          continue;
        }
        break;
      }

      rows.push({ kind: 'scene', scene });
    });

    while (gapIndex < gapEpochs.length) {
      rows.push({
        kind: 'epoch-gap',
        key: `epoch-gap-${gapEpochs[gapIndex].toString()}`,
        epochNs: gapEpochs[gapIndex],
      });
      gapIndex += 1;
    }

    return rows;
  }, [gapEpochs, sortedScenes, sceneEpochNanosecondsById]);

  const applyLaneScrollDelta = useCallback((delta: number): boolean => {
    const scroller = bottomLaneScrollRef.current;
    if (!scroller) return false;

    const maxScrollLeft = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
    if (maxScrollLeft <= 0) return false;

    const nextScrollLeft = Math.min(
      maxScrollLeft,
      Math.max(0, scroller.scrollLeft + delta)
    );
    if (Math.abs(nextScrollLeft - scroller.scrollLeft) < 0.1) return false;

    scroller.scrollLeft = nextScrollLeft;
    return true;
  }, []);

  const handleLaneWheelEvent = useCallback(
    (event: WheelEvent): void => {
      let delta = event.deltaX;
      if (Math.abs(delta) < 0.1 && event.shiftKey) {
        delta = event.deltaY;
      }
      if (Math.abs(delta) < 0.1) return;

      if (applyLaneScrollDelta(delta)) {
        event.preventDefault();
      }
    },
    [applyLaneScrollDelta]
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    root.addEventListener('wheel', handleLaneWheelEvent, { passive: false });
    return () => {
      root.removeEventListener('wheel', handleLaneWheelEvent);
    };
  }, [handleLaneWheelEvent]);

  // -------------------------------------------------------------------------
  // Bottom scroller sync (same as NarrativeView)
  // -------------------------------------------------------------------------

  const handleBottomLaneScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>): void => {
      const next = e.currentTarget.scrollLeft;
      setLaneScrollLeft((prev: number) => (Math.abs(prev - next) < 0.1 ? prev : next));
    },
    [setLaneScrollLeft]
  );

  // -------------------------------------------------------------------------
  // Theme classes
  // -------------------------------------------------------------------------

  const bgClass = isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-950';
  const { proseTrackColor, proseFill, proseIconColor } =
    getPageProseStyle(editorSettings);
  const proseHeaderClasses = isLight
    ? 'border-brand-gray-200 bg-white text-brand-gray-800'
    : 'border-brand-gray-700 bg-brand-gray-900 text-brand-gray-100';
  const solidStroke = solidFill;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      ref={rootRef}
      className={`w-full h-full flex flex-col ${bgClass}`}
      role="region"
      aria-label={t('Convergence Map')}
    >
      {/* Sticky lane header */}
      <div
        className={`sticky top-0 z-30 border-b ${isLight ? 'border-brand-gray-200 bg-brand-gray-50' : 'border-brand-gray-800 bg-brand-gray-950'}`}
      >
        <div
          className="overflow-hidden px-3 pt-2 pb-2"
          style={{ paddingLeft: `${cardsLeftPadding}px` }}
        >
          <LaneHeader
            lanes={lanes}
            laneTrackRef={laneTrackRef}
            laneWidths={laneWidths}
            prefixContent={
              <div
                ref={proseLaneRef}
                style={{ minWidth: proseLaneWidth }}
                className={[
                  'inline-flex flex-col items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium shadow-sm flex-shrink-0',
                  proseHeaderClasses,
                ].join(' ')}
                aria-label={t('Prose narrative order')}
              >
                <span className="block w-full truncate text-center">{t('Prose')}</span>
                <div
                  className="h-12 w-12 rounded-md border flex items-center justify-center"
                  style={{
                    backgroundColor: proseFill,
                    borderColor: proseTrackColor,
                  }}
                >
                  <FileText className="h-6 w-6" style={{ color: proseIconColor }} />
                </div>
              </div>
            }
          />
        </div>
      </div>

      {/* Scrollable content: snake overlay behind full-width cards */}
      <div
        ref={innerContainerRef}
        className="relative flex-1 overflow-y-auto overflow-x-hidden"
        role="presentation"
        tabIndex={-1}
        onMouseDown={handleBackgroundMouseDown}
        onKeyDown={() => {}}
      >
        {/* Snake SVG overlay — ABOVE the cards, pointer-events-none so cards stay clickable */}
        <div
          className="pointer-events-none absolute left-0 top-0 z-20 overflow-hidden"
          style={{
            height: timelineOverlayHeight > 0 ? `${timelineOverlayHeight}px` : '100%',
          }}
        >
          <div
            className="relative h-full"
            style={{
              width: lanePlaneWidth > 0 ? `${lanePlaneWidth}px` : '100%',
              transform: `translateX(${-laneScrollLeft}px)`,
            }}
          >
            <svg
              width={lanePlaneWidth || '100%'}
              height={timelineOverlayHeight > 0 ? timelineOverlayHeight : '100%'}
              className="absolute inset-0"
              style={{ overflow: 'visible', userSelect: 'none' }}
            >
              {/* Prose-order snake — rendered first so it sits behind entry snakes */}
              {proseSnakePath && proseSnakePath.pathData && (
                <g transform={`translate(${cardsLeftPadding},0)`}>
                  {!isLight && (
                    <path
                      d={proseSnakePath.pathData}
                      fill="none"
                      stroke="#000"
                      strokeWidth={8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={PROSE_SNAKE_OPACITY}
                    />
                  )}
                  <path
                    d={proseSnakePath.pathData}
                    fill="none"
                    stroke={proseTrackColor}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={PROSE_SNAKE_OPACITY}
                  />
                  {proseSnakePath.proseScenes.map((scene: Scene) => {
                    const cx = proseSnakePath.sceneXById.get(scene.id);
                    const layout = cardLayouts.get(scene.id);
                    if (cx === undefined || !layout) return null;
                    const cy = layout.y + layout.h / 2;
                    const isPrimary = primarySelectedSceneId === scene.id;
                    return (
                      <circle
                        key={scene.id}
                        cx={cx}
                        cy={cy}
                        r={isPrimary ? SCENE_CIRCLE_R + 2 : SCENE_CIRCLE_R}
                        fill={proseFill}
                        stroke={proseTrackColor}
                        strokeWidth={isPrimary ? 2.5 : 1.5}
                        opacity={PROSE_SNAKE_OPACITY}
                      />
                    );
                  })}
                  {proseBreakMarkers.map(
                    (marker: { x: number; y: number; lines: 1 | 2 }) => (
                      <g
                        key={`prose-break-${marker.x}-${marker.y}`}
                        data-prose-break={marker.lines === 2 ? 'book' : 'chapter'}
                      >
                        <line
                          x1={marker.x - 8}
                          y1={marker.y - (marker.lines === 2 ? 1.5 : 0)}
                          x2={marker.x + 8}
                          y2={marker.y - (marker.lines === 2 ? 1.5 : 0)}
                          stroke={proseTrackColor}
                          strokeWidth={1.5}
                          opacity={PROSE_SNAKE_OPACITY}
                        />
                        {marker.lines === 2 && (
                          <line
                            x1={marker.x - 8}
                            y1={marker.y + 1.5}
                            x2={marker.x + 8}
                            y2={marker.y + 1.5}
                            stroke={proseTrackColor}
                            strokeWidth={1.5}
                            opacity={PROSE_SNAKE_OPACITY}
                          />
                        )}
                      </g>
                    )
                  )}
                </g>
              )}
              {snakePaths.map((sp: (typeof snakePaths)[number]) => {
                if (!sp || !sp.pathData) return null;
                const { entryId, pathData, proseScenes, sceneXById } = sp;

                return (
                  <g key={entryId} transform={`translate(${cardsLeftPadding},0)`}>
                    {/* Snake track */}
                    <path
                      d={pathData}
                      fill="none"
                      stroke={
                        isCharacterEntry(sourcebookEntriesById.get(entryId))
                          ? trackColor
                          : otherTrackColor
                      }
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.7}
                    />
                    {/* Scene nodes on the snake */}
                    {proseScenes.map((scene: Scene) => {
                      const cx = sceneXById.get(scene.id);
                      const layout = cardLayouts.get(scene.id);
                      if (cx === undefined || !layout) return null;
                      const cy = layout.y + layout.h / 2;
                      const markerStyle = markerStyleBySceneId
                        .get(scene.id)
                        ?.get(entryId);
                      const entry = sourcebookEntriesById.get(entryId);
                      const entryIsCharacter = entry && isCharacterEntry(entry);
                      const effectiveMarkerStyle = entryIsCharacter
                        ? markerStyle
                        : 'solid';
                      const isSolid = effectiveMarkerStyle === 'solid';
                      const isPrimary = primarySelectedSceneId === scene.id;
                      const markerFill = isSolid
                        ? entryIsCharacter
                          ? solidFill
                          : otherSolidFill
                        : hollowFill;
                      const markerStroke = entryIsCharacter
                        ? solidStroke
                        : otherTrackColor;
                      return (
                        <circle
                          key={scene.id}
                          cx={cx}
                          cy={cy}
                          r={isPrimary ? SCENE_CIRCLE_R + 2 : SCENE_CIRCLE_R}
                          fill={markerFill}
                          stroke={markerStroke}
                          strokeWidth={isPrimary ? 2.5 : 1.5}
                          opacity={isPrimary ? 0.95 : 0.75}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <CauseArrows
          scenes={scenes}
          livePositions={new Map()}
          cardHeights={new Map()}
          cardLayouts={cardLayouts}
          activeSceneId={activeSceneId}
          hideDefaultArrows
          ghostArrow={ghostArrow}
        />

        {/* Left chronological timeline panel */}
        <div
          className="absolute left-0 top-0 z-20 overflow-hidden"
          style={{
            width: timelinePanelWidth,
            height: timelineOverlayHeight > 0 ? `${timelineOverlayHeight}px` : '100%',
          }}
        >
          <svg
            width={timelinePanelWidth}
            height={timelineOverlayHeight > 0 ? timelineOverlayHeight : '100%'}
            style={{
              overflow: 'visible',
              userSelect: 'none',
              cursor: draggingSceneId ? 'ew-resize' : 'default',
            }}
            aria-hidden="true"
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={handleTimelinePointerUp}
            onPointerCancel={handleTimelinePointerCancel}
          >
            {/* Timeline tracks — main line and spawned branches (tree style).
                Only timeline columns get vertical lines; jump columns carry
                only their arrow (one swimlane per item). */}
            {timelinePanelModel.timelineLaneNumbers.map((laneNumber: number) => {
              const laneX = timelineLaneXByNumber.get(laneNumber);
              if (laneX === undefined) return null;

              if (laneNumber === 0) {
                // Main timeline exists for the full visible chronology.
                return (
                  <line
                    key="lane-track-0"
                    x1={laneX}
                    y1={0}
                    x2={laneX}
                    y2={timelineOverlayHeight}
                    stroke={trackColor}
                    strokeWidth={3}
                    opacity={0.9}
                  />
                );
              }

              // Branched timeline: a horizontal spawn line from its parent at
              // the branch point, a downward knee, then a vertical line to the
              // bottom of the panel (directory-tree look).
              const spawnPath = branchSpawnPaths.get(laneNumber);
              if (spawnPath !== undefined) {
                return (
                  <path
                    key={`lane-track-${laneNumber}`}
                    d={spawnPath}
                    fill="none"
                    stroke={trackColor}
                    strokeWidth={3}
                    strokeLinejoin="round"
                    opacity={0.9}
                  />
                );
              }

              const lineStartY = timelineLaneStartYByNumber.get(laneNumber);
              if (lineStartY === undefined) return null;
              return (
                <line
                  key={`lane-track-${laneNumber}`}
                  x1={laneX}
                  y1={lineStartY}
                  x2={laneX}
                  y2={timelineOverlayHeight}
                  stroke={trackColor}
                  strokeWidth={3}
                  opacity={0.9}
                />
              );
            })}
            {/* Drag hover lane highlight */}
            {dragHoverLane !== null &&
              (() => {
                const laneX = timelineLaneXByNumber.get(dragHoverLane);
                if (laneX === undefined) return null;
                return (
                  <line
                    x1={laneX}
                    y1={0}
                    x2={laneX}
                    y2={timelineOverlayHeight}
                    stroke={trackColor}
                    strokeWidth={6}
                    opacity={0.14}
                    pointerEvents="none"
                  />
                );
              })()}
            {/* Scene position dots */}
            {sortedScenes.map((scene: Scene) => {
              const layout = cardLayouts.get(scene.id);
              const lane = timelinePanelModel.laneBySceneId.get(scene.id) ?? 0;
              const laneX = timelineLaneXByNumber.get(lane);
              if (!layout) return null;
              if (laneX === undefined) return null;
              // Scene markers sit on their timeline lane, except the destination
              // scene of a jump which is marked at the arrow tip (even swimlane).
              const targetX = sceneMarkerXBySceneId.get(scene.id) ?? laneX;
              const pendingLane = pendingTimelineAssignments.get(scene.id);
              const previewX =
                draggingSceneId === scene.id && dragHoverLane !== null
                  ? timelineLaneXByNumber.get(dragHoverLane)
                  : pendingLane !== undefined
                    ? timelineLaneXByNumber.get(pendingLane)
                    : targetX;
              const cx = previewX ?? targetX;
              const cy = layout.y + layout.h / 2;
              return (
                <g key={scene.id} data-scene-dot-id={scene.id}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={TL_DOT_R + 8}
                    fill="transparent"
                    pointerEvents="all"
                    onPointerDown={handleTimelineDotPointerDown(scene.id)}
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={TL_DOT_R}
                    fill={sceneColorBySceneId.get(scene.id) ?? solidFill}
                    opacity={0.8}
                    style={{ cursor: 'ew-resize' }}
                    pointerEvents="none"
                  />
                </g>
              );
            })}
            {/* Time travel arrows */}
            <defs>
              <marker
                id="tl-arrow-down"
                markerWidth="6"
                markerHeight="5"
                refX="5"
                refY="2.5"
                orient="90"
              >
                <polygon points="0 0, 6 2.5, 0 5" fill="context-stroke" />
              </marker>
              <marker
                id="tl-arrow-up"
                markerWidth="6"
                markerHeight="5"
                refX="5"
                refY="2.5"
                orient="270"
              >
                <polygon points="0 0, 6 2.5, 0 5" fill="context-stroke" />
              </marker>
              <marker
                id="tl-arrow-left"
                markerWidth="6"
                markerHeight="5"
                refX="5"
                refY="2.5"
                orient="180"
              >
                <polygon points="0 0, 6 2.5, 0 5" fill="context-stroke" />
              </marker>
              <marker
                id="tl-arrow-right"
                markerWidth="6"
                markerHeight="5"
                refX="1"
                refY="2.5"
                orient="0"
              >
                <polygon points="0 0, 6 2.5, 0 5" fill="context-stroke" />
              </marker>
            </defs>
            {timeTravelArrows.map((arrow: TimeTravelArrow, i: number) => (
              <g key={i}>
                {/* Arrow path: from the origin scene marker, knee, to the tip.
                    Dotted and colored like the causing scene. */}
                <path
                  d={arrow.pathData}
                  fill="none"
                  stroke={arrow.color}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="4 3"
                  markerEnd={arrow.markerEnd}
                  opacity={0.85}
                />
              </g>
            ))}
          </svg>
        </div>

        {/* Scene cards — full-width vertical list, exactly like Chronological view */}
        <div
          className="relative z-10 flex flex-col gap-2 p-3"
          style={{ paddingLeft: `${cardsLeftPadding}px` }}
        >
          {timelineListRows.map((row: TimelineListRow) => {
            if (row.kind === 'epoch-gap') {
              const key = row.epochNs.toString();
              return (
                <div
                  key={row.key}
                  ref={(el: HTMLDivElement | null) => {
                    if (el) {
                      epochGapRefs.current.set(key, el);
                    } else {
                      epochGapRefs.current.delete(key);
                    }
                  }}
                  aria-hidden="true"
                  className="w-full"
                  style={{ height: placeholderRowHeight }}
                />
              );
            }

            const scene = row.scene;
            const idx = sceneIndexMap.get(scene.id) ?? 0;
            return (
              <div
                key={scene.id}
                ref={(el: HTMLDivElement | null) => {
                  if (el) {
                    cardWrapperRefs.current.set(scene.id, el);
                  } else {
                    cardWrapperRefs.current.delete(scene.id);
                  }
                }}
              >
                <SceneCard
                  scene={scene}
                  index={idx}
                  variant="narrative"
                  onSelect={handleCardSelect}
                  onEdit={onEditScene ?? (() => {})}
                  onCauseDragStart={handleCauseDragStart}
                  onCauseDrop={handleCauseDrop}
                  onCauseLeave={handleCauseLeave}
                  isCauseSource={causeSourceDisplay === scene.id}
                  isCauseTarget={causeTargetDisplay === scene.id}
                  isSelected={selectedSceneIds.has(scene.id)}
                  isActive={activeSceneId === scene.id}
                  isCause={causeIds.has(scene.id)}
                  isEffect={effectIds.has(scene.id)}
                  isRelated={relatedSceneIds?.has(scene.id) ?? false}
                  orderViolation={
                    orderViolationSceneIds.has(scene.id) ? 'chronological' : undefined
                  }
                  temporalOrderViolation={temporalOrderViolationSceneIds.has(scene.id)}
                />
              </div>
            );
          })}
          {sortedScenes.length === 0 && (
            <p
              className={`text-sm text-center py-8 ${isLight ? 'text-brand-gray-400' : 'text-brand-gray-500'}`}
            >
              {selectedLaneEntryIds.size > 0
                ? t('No scenes match the selected entries')
                : t('No scenes yet')}
            </p>
          )}
        </div>
      </div>

      {/* Bottom lane horizontal scrollbar */}
      <div
        className={`border-t px-3 py-1 ${isLight ? 'border-brand-gray-200 bg-brand-gray-50' : 'border-brand-gray-800 bg-brand-gray-950'}`}
      >
        <div
          ref={bottomLaneScrollRef}
          className="overflow-x-auto overflow-y-hidden"
          onScroll={handleBottomLaneScroll}
          aria-label={t('Lane horizontal scrollbar')}
        >
          <div style={{ width: lanePlaneWidth, height: 1 }} />
        </div>
      </div>
    </div>
  );
};
/* eslint-enable complexity */
