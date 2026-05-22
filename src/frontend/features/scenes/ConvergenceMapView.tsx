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
import { useSceneLanes, isCharacterEntry } from './useSceneLanes';
import { LaneHeader } from './LaneHeader';
import { SceneCard } from './SceneCard';
import { useSceneSelection } from './useSceneSelection';
import { buildChapterOrderMap, chronologicalSort, proseSort } from './sceneSortUtils';
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
  onEditScene?: (id: SceneId) => void;
  onAssignSceneTimeline?: (sceneId: SceneId, timelineId: string) => Promise<void>;
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
const TL_LANE_GAP = 28; // px — horizontal spacing between timeline lanes
const TL_DOT_R = 4; // px — radius of scene dots on timeline
const TL_LOOP_W_CROSS = 30; // px — baseline bow for cross-lane jumps
const TL_LOOP_W_SAME = 14; // px — baseline bow for same-lane jumps (= TL_LANE_GAP/2)
const TL_CORNER_R = 6; // px — rounded corner radius on loop arrows
const TL_RIGHT_PAD = 8; // px — right breathing room for arrow heads
const DEFAULT_PLACEHOLDER_ROW_HEIGHT = 84; // px — fallback until card heights are measured
const PROSE_LANE_ID = '__prose__'; // synthetic lane id for the prose-order snake
const PROSE_SNAKE_OPACITY = 0.45; // lower opacity to distinguish prose snake from entry snakes
const DEFAULT_LANE_BUTTON_WIDTH = 144;
const LANE_HEADER_GAP = 8; // gap-2 between lane header items

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
function buildSnakePath(
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
  const processedYs: number[] = [];

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
      processedYs.push(y);
    }

    // Transition connector to the next run: go right one TRACK_W, then up.
    if (runIdx < numRuns - 1) {
      const nextLaneX = startX + (runIdx + 1) * TRACK_W;
      const transitionX = laneX + TRANSITION_DX;
      const lastScene = run[run.length - 1];
      const lastY = getLayoutCenterY(cardLayouts.get(lastScene.id)!);
      const firstNextScene = runs[runIdx + 1][0];
      const firstNextY = getLayoutCenterY(cardLayouts.get(firstNextScene.id)!);
      const priorMarkerAbove = processedYs
        .filter((y: number) => y < firstNextY)
        .reduce<number | null>((maxY: number | null, y: number) => {
          if (maxY === null || y > maxY) return y;
          return maxY;
        }, null);
      const entryY = priorMarkerAbove ?? firstNextY;

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

      if (entryY < firstNextY) {
        parts.push(`L ${nextLaneX},${firstNextY}`);
      }
    }
  }

  const snakeWidth = Math.max(0, maxX - minX);
  return { pathData: parts.join(' '), sceneXById, snakeWidth };
}

/**
 * Build an SVG path string for a time travel arrow on the left timeline panel.
 * The arrow loops from depY → destY, bowing RIGHT of the track (toward the scene cards).
 *
 *  destY > depY (forward jump): arrow goes DOWN on the right
 *  destY < depY (backward jump): arrow goes UP on the right
 *
 * Shape: start at (TL_TRACK_X, depY), horizontal right to loop edge,
 * vertical to destY, horizontal left back to TL_TRACK_X.
 * Corners are rounded with radius TL_CORNER_R.
 */
/**
 * Universal time-travel arrow geometry.
 *
 * By default jumps bow to the RIGHT of max(sourceX, destinationX). Callers may
 * pass a custom `loopX` to keep a jump in a lane-local side channel instead.
 *
 * The shape is always a U-like path opening toward the right-side channel:
 *
 *   ┌── rx ──┐
 *   │        │
 *   srcX    dstX  (same lane → dstX = srcX, so it bows right and returns)
 *
 * Backward jump (destY < depY, going UP in the SVG): arrowhead tip points UP.
 * Forward jump  (destY ≥ depY, going DOWN):          arrowhead tip points DOWN.
 */
function buildTimeTravelArrowGeometry(
  sourceX: number,
  depY: number,
  destinationX: number,
  destY: number,
  loopX?: number
): { pathData: string; endX: number; endY: number } {
  const cr = TL_CORNER_R;
  const rx = loopX ?? Math.max(sourceX, destinationX) + TL_LOOP_W_CROSS;
  const goingDown = destY >= depY;

  if (goingDown) {
    return {
      pathData: [
        `M ${sourceX},${depY}`,
        `L ${rx - cr},${depY}`,
        `a ${cr},${cr} 0 0 1 ${cr},${cr}`,
        `L ${rx},${destY - cr}`,
        `a ${cr},${cr} 0 0 1 ${-cr},${cr}`,
        `L ${destinationX},${destY}`,
      ].join(' '),
      endX: destinationX,
      endY: destY,
    };
  }

  return {
    pathData: [
      `M ${sourceX},${depY}`,
      `L ${rx - cr},${depY}`,
      `a ${cr},${cr} 0 0 0 ${cr},${-cr}`,
      `L ${rx},${destY + cr}`,
      `a ${cr},${cr} 0 0 0 ${-cr},${-cr}`,
      `L ${destinationX},${destY}`,
    ].join(' '),
    endX: destinationX,
    endY: destY,
  };
}

function getTimeTravelLoopX(
  sourceX: number,
  destinationX: number,
  depY: number,
  destY: number
): number {
  if (sourceX === destinationX && destY < depY) {
    return sourceX + TL_LOOP_W_SAME;
  }

  return Math.max(sourceX, destinationX) + TL_LOOP_W_CROSS;
}

function buildBranchCreationArrowGeometry(
  sourceX: number,
  depY: number,
  destinationLaneX: number,
  destY: number
): { pathData: string; endX: number; endY: number } {
  const targetX = (sourceX + destinationLaneX) / 2;
  const dx = targetX - sourceX;
  const goingDown = destY >= depY;
  const cr = Math.min(TL_CORNER_R, Math.abs(dx));

  if (cr < 0.5) {
    return {
      pathData: [`M ${sourceX},${depY}`, `L ${targetX},${destY}`].join(' '),
      endX: targetX,
      endY: destY,
    };
  }

  const approachX = targetX - Math.sign(dx) * cr;
  const arcDx = Math.sign(dx) * cr;
  const arcDy = goingDown ? cr : -cr;
  const sweepFlag = dx > 0 ? (goingDown ? 1 : 0) : goingDown ? 0 : 1;

  return {
    pathData: [
      `M ${sourceX},${depY}`,
      `L ${approachX},${depY}`,
      `a ${cr},${cr} 0 0 ${sweepFlag} ${arcDx},${arcDy}`,
      `L ${targetX},${destY}`,
    ].join(' '),
    endX: targetX,
    endY: destY,
  };
}

function buildSpawnedTimelineTrackPath(
  parentLaneX: number,
  laneX: number,
  spawnY: number,
  overlayHeight: number
): string {
  const cornerRadius = TL_CORNER_R;
  const dx = laneX - parentLaneX;
  const absDx = Math.abs(dx);
  const horizontalSign = dx >= 0 ? 1 : -1;
  const usableCornerRadius = Math.min(cornerRadius, absDx / 2);

  // If the parent and destination lanes are effectively the same X,
  // fall back to a direct vertical continuation.
  if (absDx < 0.5 || usableCornerRadius < 0.5) {
    return [`M ${laneX},${spawnY}`, `L ${laneX},${overlayHeight}`].join(' ');
  }

  const horizontalEndX = laneX - horizontalSign * usableCornerRadius;
  const arcDx = horizontalSign * usableCornerRadius;
  const arcDy = usableCornerRadius;

  return [
    `M ${parentLaneX},${spawnY}`,
    `L ${horizontalEndX},${spawnY}`,
    `a ${usableCornerRadius},${usableCornerRadius} 0 0 ${horizontalSign > 0 ? 1 : 0} ${arcDx},${arcDy}`,
    `L ${laneX},${overlayHeight}`,
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Intentionally kept as one component to keep map layout and overlay geometry together.
/* eslint-disable complexity */
// eslint-disable-next-line max-lines-per-function
export const ConvergenceMapView: React.FC<ConvergenceMapViewProps> = ({
  scenes,
  sourcebookEntries = [],
  projectType,
  chapters,
  books = [],
  primarySelectedSceneId,
  onSelectScene,
  onSelectionChange,
  onEditScene,
  onAssignSceneTimeline,
  initialVisibleLaneEntryIds,
  initialRemovedReferencedLaneIds,
  onVisibleLaneEntryIdsChange,
  onRemovedReferencedLaneIdsChange,
  editorSettings,
}: ConvergenceMapViewProps) => {
  const { t } = useTranslation();
  const { isLight } = useTheme();

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

  // Cause/effect glow — same as NarrativeView.
  const activeScene = activeSceneId
    ? (scenes.find((s: Scene) => s.id === activeSceneId) ?? null)
    : null;
  const causeIds = new Set<SceneId>(activeScene?.order_after ?? []);
  const effectIds = new Set<SceneId>(activeScene?.order_before ?? []);

  // Display index for each scene card (sequential position in sorted list).
  const sceneIndexMap = useMemo(() => {
    const map = new Map<SceneId, number>();
    sortedScenes.forEach((s: Scene, i: number) => map.set(s.id, i));
    return map;
  }, [sortedScenes]);

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
   * Compute the actual rightmost X reached by any time-travel loop so the
   * timeline panel is sized exactly to its content (no over-reservation).
   */
  const maxTimeTravelLoopX = useMemo((): number => {
    let max = 0;
    timelinePanelModel.events.forEach((ev: TimelineJumpEvent): void => {
      const sourceX = timelineLaneXByNumber.get(ev.sourceLane);
      if (sourceX === undefined) return;
      if (ev.createsNewTimeline) {
        // Branch-creation arrows use a midpoint — they stay within lane bounds.
        const destinationLaneX =
          timelineLaneXByNumber.get(ev.destinationLane) ?? sourceX;
        max = Math.max(max, Math.max(sourceX, destinationLaneX));
        return;
      }
      const destinationX = timelineLaneXByNumber.get(ev.destinationLane) ?? sourceX;
      if (sourceX === destinationX) {
        // Same-lane backward jump: bow right by TL_LOOP_W_SAME.
        max = Math.max(max, sourceX + TL_LOOP_W_SAME);
      } else {
        // Cross-lane jump: bow right by TL_LOOP_W_CROSS from the rightmost lane.
        max = Math.max(max, Math.max(sourceX, destinationX) + TL_LOOP_W_CROSS);
      }
    });
    return max;
  }, [timelinePanelModel.events, timelineLaneXByNumber]);

  const timelinePanelWidth = useMemo(() => {
    const maxLaneNumber = Math.max(0, ...timelinePanelModel.laneNumbers);
    const rightMostLaneX = TL_LANE_START_X + maxLaneNumber * TL_LANE_GAP;
    const contentRight = Math.max(rightMostLaneX, maxTimeTravelLoopX);
    return contentRight + TL_RIGHT_PAD;
  }, [timelinePanelModel.laneNumbers, maxTimeTravelLoopX]);

  const timelineSpawns = useMemo((): Map<number, number | null> => {
    const spawns = new Map<number, number | null>();
    spawns.set(0, null);

    timelinePanelModel.events.forEach((ev: TimelineJumpEvent): void => {
      if (!ev.createsNewTimeline || ev.destinationEpochNs === null) return;

      const measuredGap = epochGapLayouts.get(ev.destinationEpochNs.toString());
      if (measuredGap !== undefined) {
        spawns.set(ev.destinationLane, getLayoutCenterY(measuredGap));
        return;
      }

      const spawnY =
        ev.destinationSceneId !== null
          ? (() => {
              const layout = cardLayouts.get(ev.destinationSceneId);
              return layout ? getLayoutCenterY(layout) : null;
            })()
          : null; // gap row not yet measured
      spawns.set(ev.destinationLane, spawnY);
    });

    return spawns;
  }, [timelinePanelModel.events, cardLayouts, epochGapLayouts]);

  /** Maps each spawned branch lane → the source lane that created it. */
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

  // For branch-creation jumps that land on an actual destination scene, place
  // that scene dot on the horizontal spawn segment so the arrow can terminate
  // directly on the dot (special case like 19->17 in the sketch).
  const timelineSceneDotXOverrides = useMemo((): Map<SceneId, number> => {
    const overrides = new Map<SceneId, number>();

    timelinePanelModel.events.forEach((ev: TimelineJumpEvent): void => {
      if (!ev.createsNewTimeline) return;
      if (ev.destinationSceneId === null) return;

      const sourceX = timelineLaneXByNumber.get(ev.sourceLane);
      const destinationLaneX = timelineLaneXByNumber.get(ev.destinationLane);
      if (sourceX === undefined || destinationLaneX === undefined) return;

      overrides.set(ev.destinationSceneId, (sourceX + destinationLaneX) / 2);
    });

    return overrides;
  }, [timelinePanelModel.events, timelineLaneXByNumber]);

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
      let destX = sourceX;
      let destY: number | null = null;
      const destinationLaneX = timelineLaneXByNumber.get(ev.destinationLane) ?? sourceX;

      if (ev.createsNewTimeline && ev.destinationEpochNs !== null) {
        // Branching case: target the split height on the spawned timeline.
        const spawnY = timelineSpawns.get(ev.destinationLane);

        if (spawnY != null) {
          if (ev.destinationSceneId !== null) {
            // Special case: when the destination scene exists exactly at the
            // branch spawn point, terminate at the marker border so the arrow
            // points to the dot, not to the horizontal spawn line.
            const goingDown = spawnY >= depY;
            destY = spawnY + (goingDown ? -TL_DOT_R : TL_DOT_R);
          } else {
            destY = spawnY;
          }
        } else if (ev.destinationSceneId !== null) {
          // Scene exists at destination — use its Y as the arrival point
          const sceneLayout = cardLayouts.get(ev.destinationSceneId);
          destY = sceneLayout ? sceneLayout.y + sceneLayout.h / 2 : null;
        } else {
          // No gap row measured yet for this epoch.
          destY = null;
        }
        destX = destinationLaneX;
      } else {
        // Non-branching case: point at destination scene or stay on source lane
        if (ev.destinationSceneId !== null) {
          const sceneLayout = cardLayouts.get(ev.destinationSceneId);
          if (sceneLayout) {
            const centerY = sceneLayout.y + sceneLayout.h / 2;
            // Vertical arrivals: stop at top/bottom edge of dot.
            // Same-lane backward (horizontal arrival) offset is applied at draw time.
            const isSameLaneBwd =
              ev.sourceLane === ev.destinationLane && centerY < depY;
            destY = isSameLaneBwd
              ? centerY
              : centerY + (centerY >= depY ? -TL_DOT_R : TL_DOT_R);
            destX = sourceX;
          } else {
            destY = null;
            destX = sourceX;
          }
        } else if (ev.destinationEpochNs !== null) {
          // Use the measured epoch-gap row position.
          const gap = epochGapLayouts.get(ev.destinationEpochNs.toString());
          destY = gap ? getLayoutCenterY(gap) : null;
          destX = sourceX;
        } else {
          destY = depY - 20;
          destX = sourceX;
        }
      }

      if (destY === null) return;
      if (Math.abs(destY - depY) < 2 && sourceX === destX) return;

      let pathData: string;
      let markerEnd: string;

      if (ev.createsNewTimeline && ev.destinationEpochNs !== null) {
        const geometry = buildBranchCreationArrowGeometry(
          sourceX,
          depY,
          destinationLaneX,
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
        });
        return;
      }

      const loopX = ev.createsNewTimeline
        ? Math.max(
            sourceX,
            timelineLaneXByNumber.get(ev.destinationLane) ?? sourceX + TL_LANE_GAP
          ) + TL_LOOP_W_CROSS
        : getTimeTravelLoopX(sourceX, destX, depY, destY);

      if (sourceX === destX && destY > depY) {
        // Same-lane forward travel remains on the timeline.
        pathData = `M ${sourceX},${depY} L ${destX},${destY}`;
        markerEnd = 'url(#tl-arrow-down)';
      } else {
        // Backward jumps and cross-lane jumps use a side-channel loop.
        const isSameLaneBackward = sourceX === destX && destY < depY;
        // For same-lane backward jumps with a known destination scene the path arrives
        // horizontally; shift the endpoint to the right edge of the destination dot.
        const drawDestX =
          isSameLaneBackward && ev.destinationSceneId !== null
            ? destX + TL_DOT_R
            : destX;
        const geometry = buildTimeTravelArrowGeometry(
          sourceX,
          depY,
          drawDestX,
          destY,
          loopX
        );
        pathData = geometry.pathData;
        // Same-lane backward jumps arrive horizontally from the right side-channel;
        // all other loops arrive vertically.
        markerEnd =
          destY > depY
            ? 'url(#tl-arrow-down)'
            : isSameLaneBackward
              ? 'url(#tl-arrow-left)'
              : 'url(#tl-arrow-up)';
      }

      arrows.push({
        pathData,
        markerEnd,
        goingDown: destY > depY,
        entryName: ev.entryName,
        createsNewTimeline: ev.createsNewTimeline,
        sourceX,
        destinationX: destX,
        depY,
        destY,
      });
    });

    return arrows;
  }, [
    timelinePanelModel.events,
    cardLayouts,
    epochGapLayouts,
    timelineLaneXByNumber,
    timelineSpawns,
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
  const trackColor = isLight ? '#6366f1' : '#a5b4fc';
  const solidFill = isLight ? '#6366f1' : '#a5b4fc';
  const hollowFill = isLight ? '#f8fafc' : '#0f172a';
  const otherTrackColor = isLight ? '#8b1f3d' : '#f5c3d1';
  const otherSolidFill = isLight ? '#8b1f3d' : '#f5c3d1';
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
            {/* Vertical track lines for all timelines */}
            {timelinePanelModel.laneNumbers.map((laneNumber: number) => {
              const laneX = timelineLaneXByNumber.get(laneNumber);
              if (laneX === undefined) return null;

              // Determine where the line should start.
              let lineStartY: number | undefined;

              if (laneNumber === 0) {
                // Main timeline exists for the full visible chronology.
                lineStartY = 0;
              } else {
                // Branched timelines only exist from their spawn onward.
                const spawnY = timelineSpawns.get(laneNumber);
                if (spawnY !== null && spawnY !== undefined) {
                  lineStartY = spawnY;
                } else {
                  lineStartY = timelineLaneStartYByNumber.get(laneNumber);
                }
              }

              // Skip rendering if no anchor exists.
              if (lineStartY === undefined) return null;

              const lineEndY = Math.max(timelineOverlayHeight, lineStartY + 1);

              if (laneNumber !== 0) {
                const spawnY = timelineSpawns.get(laneNumber);
                if (spawnY !== null && spawnY !== undefined) {
                  const parentLane = timelineSpawnParentLane.get(laneNumber) ?? 0;
                  const parentLaneX =
                    timelineLaneXByNumber.get(parentLane) ?? laneX - TL_LANE_GAP;
                  const spawnedPath = buildSpawnedTimelineTrackPath(
                    parentLaneX,
                    laneX,
                    spawnY,
                    lineEndY
                  );

                  return (
                    <path
                      key={`lane-track-${laneNumber}`}
                      d={spawnedPath}
                      fill="none"
                      stroke={trackColor}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.7}
                    />
                  );
                }
              }

              return (
                <line
                  key={`lane-track-${laneNumber}`}
                  x1={laneX}
                  y1={lineStartY}
                  x2={laneX}
                  y2={lineEndY}
                  stroke={trackColor}
                  strokeWidth={2}
                  opacity={0.7}
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
              const overriddenX = timelineSceneDotXOverrides.get(scene.id);
              const targetX = overriddenX ?? laneX;
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
                    fill={solidFill}
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
                <polygon points="0 0, 6 2.5, 0 5" fill={trackColor} />
              </marker>
              <marker
                id="tl-arrow-up"
                markerWidth="6"
                markerHeight="5"
                refX="5"
                refY="2.5"
                orient="270"
              >
                <polygon points="0 0, 6 2.5, 0 5" fill={trackColor} />
              </marker>
              <marker
                id="tl-arrow-left"
                markerWidth="6"
                markerHeight="5"
                refX="5"
                refY="2.5"
                orient="180"
              >
                <polygon points="0 0, 6 2.5, 0 5" fill={trackColor} />
              </marker>
            </defs>
            {timeTravelArrows.map((arrow: TimeTravelArrow, i: number) => (
              <g key={i}>
                {/* Dot at departure point */}
                <circle
                  cx={arrow.sourceX}
                  cy={arrow.depY}
                  r={3}
                  fill={trackColor}
                  opacity={0.85}
                />
                {/* Arrow path with new semantics */}
                <path
                  d={arrow.pathData}
                  fill="none"
                  stroke={trackColor}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
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
                  isSelected={selectedSceneIds.has(scene.id)}
                  isActive={activeSceneId === scene.id}
                  isCause={causeIds.has(scene.id)}
                  isEffect={effectIds.has(scene.id)}
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
