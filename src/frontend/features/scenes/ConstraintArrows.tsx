// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * SVG overlay that draws bezier arrows between scene cards to represent causal
 * ordering relationships. When an active scene is set, shows only arrows
 * involving that scene: causes → active in red, active → effects in green.
 * When no scene is active, all arrows are shown in the accent colour.
 *
 * Arrows start and end at the card border (not the centre). Each endpoint
 * carries the outward normal of the edge it exits, which is used as the
 * bezier tangent direction to create visible, correctly-angled curves.
 *
 * Card heights are measured in the DOM and passed in via `cardHeights` so the
 * intersection math is accurate even for variable-content cards.
 */

import React from 'react';
import type { Scene, SceneId } from '../../types';
import { useTheme } from '../layout/ThemeContext';

const CARD_WIDTH = 192; // matches w-48 (12rem × 16px)
/** Fallback when a card's measured height is not yet available. */
const DEFAULT_CARD_HEIGHT = 90;

type ArrowColor = 'default' | 'red' | 'green' | 'ghost' | 'ghost-connected';

/**
 * An arrow to draw. x1/y1 is the source border exit, nx1/ny1 its outward
 * normal; x2/y2 is the target border entry, nx2/ny2 the outward normal from
 * the target card facing the source (used to form the arrival control point).
 */
type Arrow = {
  x1: number;
  y1: number;
  nx1: number;
  ny1: number;
  x2: number;
  y2: number;
  nx2: number;
  ny2: number;
  key: string;
  arrowColor: ArrowColor;
};

/** Position lookup – keyed by scene id, allowing live values during drag. */
export type ScenePositions = Map<SceneId, { x: number; y: number }>;

/**
 * Per-card layout from DOM measurement. Used in views where cards are in a
 * flow layout (e.g. Narrative view) so their positions and widths differ from
 * the fixed pinboard values.
 */
export type CardLayout = { x: number; y: number; w: number; h: number };
export type CardLayoutMap = Map<SceneId, CardLayout>;

/** Ghost arrow state during an Alt+drag cause creation. */
export interface GhostArrow {
  /** Source scene id */
  fromId: SceneId;
  /** Canvas-space mouse X */
  toX: number;
  /** Canvas-space mouse Y */
  toY: number;
  /** Whether the mouse is currently over a valid target card */
  connected: boolean;
}

interface CauseArrowsProps {
  scenes: Scene[];
  /** Live per-scene positions (overrides scene.pinboard_x/y during drag). */
  livePositions: ScenePositions;
  /** Actual rendered heights keyed by scene id (from ResizeObserver in SceneCard). */
  cardHeights: Map<SceneId, number>;
  /** The currently active scene id. When set, only arrows involving this scene
   *  are drawn, coloured red (causes → active) or green (active → effects). */
  activeSceneId: SceneId | null;
  /** Optional ghost arrow to draw during an Alt+drag cause creation. */
  ghostArrow?: GhostArrow | null;
  /**
   * Optional DOM-measured card layouts (position + size). When provided for a
   * card, overrides `livePositions` / `scene.pinboard_x/y` and `cardHeights`
   * for that card. Used in Narrative view where cards fill the container width.
   */
  cardLayouts?: CardLayoutMap;
  /** Optional per-arrow fixed X coordinate (keyed by `${fromId}->${toId}`). */
  arrowLaneXByKey?: Map<string, number>;
  /**
   * When true, arrow endpoints use each card's vertical centre (y=midpoint)
   * instead of border intersections. Intended for Narrative view only.
   */
  useVerticalCenterEndpoints?: boolean;
  /**
   * Narrative-only mode: endpoint on active scene stays on card border,
   * while the connected scene endpoint uses vertical centre.
   */
  useVerticalCenterForConnectedOnly?: boolean;
  /**
   * When true, suppresses default (non-active) arrows. Useful for Narrative
   * view where purple dotted arrows should not be shown.
   */
  hideDefaultArrows?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes where the ray from the card centre toward (targetCX, targetCY)
 * exits the card border. Returns the exit point exactly on the card edge and
 * the outward normal of the hit edge (one of the four axis-aligned unit vectors).
 *
 * Exported so it can be unit-tested independently of the React component.
 */
export function borderExit(
  cardX: number,
  cardY: number,
  cardW: number,
  cardH: number,
  targetCX: number,
  targetCY: number
): { x: number; y: number; nx: number; ny: number } {
  const cx = cardX + cardW / 2;
  const cy = cardY + cardH / 2;
  const dx = targetCX - cx;
  const dy = targetCY - cy;

  if (dx === 0 && dy === 0) {
    // Degenerate: same centre – exit right edge.
    return { x: cx + cardW / 2, y: cy, nx: 1, ny: 0 };
  }

  const hw = cardW / 2;
  const hh = cardH / 2;

  let t = Infinity;
  let outNx = 1;
  let outNy = 0;

  if (dx !== 0) {
    const tx = (dx > 0 ? hw : -hw) / dx;
    if (tx > 0 && tx < t) {
      t = tx;
      outNx = dx > 0 ? 1 : -1;
      outNy = 0;
    }
  }
  if (dy !== 0) {
    const ty = (dy > 0 ? hh : -hh) / dy;
    if (ty > 0 && ty < t) {
      t = ty;
      outNx = 0;
      outNy = dy > 0 ? 1 : -1;
    }
  }

  return { x: cx + dx * t, y: cy + dy * t, nx: outNx, ny: outNy };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/* eslint-disable complexity */
export const CauseArrows: React.FC<CauseArrowsProps> = ({
  scenes,
  livePositions,
  cardHeights,
  activeSceneId,
  ghostArrow,
  cardLayouts,
  arrowLaneXByKey,
  useVerticalCenterEndpoints = false,
  useVerticalCenterForConnectedOnly = false,
  hideDefaultArrows = false,
}: CauseArrowsProps) => {
  const { isLight } = useTheme();
  const defaultColor = isLight ? '#6366f1' : '#818cf8'; // indigo-500 / indigo-400
  const redColor = '#ef4444'; // red-500
  const greenColor = '#22c55e'; // green-500
  const ghostColor = '#94a3b8'; // slate-400

  /** Resolve position for a scene: DOM layout overrides live/stored values. */
  const pos = (s: Scene): { x: number; y: number } => {
    const layout = cardLayouts?.get(s.id);
    if (layout) return { x: layout.x, y: layout.y };
    return livePositions.get(s.id) ?? { x: s.pinboard_x, y: s.pinboard_y };
  };

  /** Resolve actual card height: DOM layout overrides measured/default. */
  const h = (id: SceneId): number =>
    cardLayouts?.get(id)?.h ?? cardHeights.get(id) ?? DEFAULT_CARD_HEIGHT;

  /** Resolve actual card width: DOM layout overrides the pinboard constant. */
  const cardW = (id: SceneId): number => cardLayouts?.get(id)?.w ?? CARD_WIDTH;

  const byId = new Map<SceneId, Scene>(scenes.map((s: Scene) => [s.id, s]));
  const arrows: Arrow[] = [];

  /** Build one arrow from scene A (source) to scene B (target). */
  const makeArrow = (
    fromId: SceneId,
    toId: SceneId,
    color: ArrowColor
  ): Arrow | null => {
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to) return null;
    const fp = pos(from);
    const tp = pos(to);
    const key = `${fromId}->${toId}`;
    const laneX = arrowLaneXByKey?.get(key);
    if (
      laneX !== undefined &&
      (useVerticalCenterEndpoints || useVerticalCenterForConnectedOnly)
    ) {
      const fromY = fp.y + h(fromId) / 2;
      const toY = tp.y + h(toId) / 2;
      const down = toY >= fromY;

      if (useVerticalCenterForConnectedOnly && activeSceneId) {
        const fromIsActive = fromId === activeSceneId;
        const toIsActive = toId === activeSceneId;

        const src = fromIsActive
          ? {
              x: laneX,
              y: down ? fp.y + h(fromId) : fp.y,
              nx: 0,
              ny: down ? 1 : -1,
            }
          : { x: laneX, y: fromY, nx: 0, ny: down ? 1 : -1 };

        const tgt = toIsActive
          ? {
              x: laneX,
              y: down ? tp.y : tp.y + h(toId),
              nx: 0,
              ny: down ? -1 : 1,
            }
          : { x: laneX, y: toY, nx: 0, ny: down ? -1 : 1 };

        return {
          key,
          x1: src.x,
          y1: src.y,
          nx1: src.nx,
          ny1: src.ny,
          x2: tgt.x,
          y2: tgt.y,
          nx2: tgt.nx,
          ny2: tgt.ny,
          arrowColor: color,
        };
      }

      return {
        key,
        x1: laneX,
        y1: fromY,
        nx1: 0,
        ny1: down ? 1 : -1,
        x2: laneX,
        y2: toY,
        nx2: 0,
        ny2: down ? -1 : 1,
        arrowColor: color,
      };
    }

    const tCX = tp.x + cardW(toId) / 2;
    const tCY = tp.y + h(toId) / 2;
    const fCX = fp.x + cardW(fromId) / 2;
    const fCY = fp.y + h(fromId) / 2;
    const src = borderExit(fp.x, fp.y, cardW(fromId), h(fromId), tCX, tCY);
    const tgt = borderExit(tp.x, tp.y, cardW(toId), h(toId), fCX, fCY);
    return {
      key,
      x1: src.x,
      y1: src.y,
      nx1: src.nx,
      ny1: src.ny,
      x2: tgt.x,
      y2: tgt.y,
      nx2: tgt.nx,
      ny2: tgt.ny,
      arrowColor: color,
    };
  };

  if (activeSceneId) {
    const active = byId.get(activeSceneId);
    if (active) {
      for (const scene of scenes) {
        if ((scene.causes ?? []).includes(activeSceneId)) {
          const a = makeArrow(scene.id, activeSceneId, 'red');
          if (a) arrows.push(a);
        }
      }
      for (const effectId of active.causes) {
        const a = makeArrow(activeSceneId, effectId, 'green');
        if (a) arrows.push(a);
      }
    }
  } else if (!hideDefaultArrows) {
    for (const scene of scenes) {
      for (const targetId of scene.causes) {
        const a = makeArrow(scene.id, targetId, 'default');
        if (a) arrows.push(a);
      }
    }
  }

  // Ghost arrow during Alt+drag
  if (ghostArrow) {
    const src = byId.get(ghostArrow.fromId);
    if (src) {
      const sp = pos(src);
      const exit = borderExit(
        sp.x,
        sp.y,
        cardW(ghostArrow.fromId),
        h(ghostArrow.fromId),
        ghostArrow.toX,
        ghostArrow.toY
      );
      // For the tip we use a straight arrival normal (continue same direction).
      const dx = ghostArrow.toX - exit.x;
      const dy = ghostArrow.toY - exit.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      arrows.push({
        key: '__ghost__',
        x1: exit.x,
        y1: exit.y,
        nx1: exit.nx,
        ny1: exit.ny,
        x2: ghostArrow.toX,
        y2: ghostArrow.toY,
        nx2: -dx / dist,
        ny2: -dy / dist,
        arrowColor: ghostArrow.connected ? 'ghost-connected' : 'ghost',
      });
    }
  }

  if (arrows.length === 0) return null;

  const allX = arrows.flatMap((a: Arrow) => [a.x1, a.x2]);
  const allY = arrows.flatMap((a: Arrow) => [a.y1, a.y2]);
  const maxX = Math.max(...allX) + 40;
  const maxY = Math.max(...allY) + 40;

  const colorOf = (c: ArrowColor): string => {
    if (c === 'red') return redColor;
    if (c === 'green') return greenColor;
    if (c === 'ghost') return ghostColor;
    if (c === 'ghost-connected') return greenColor;
    return defaultColor;
  };

  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      width={maxX}
      height={maxY}
      aria-hidden="true"
    >
      <defs>
        {/*
          markerUnits="userSpaceOnUse" gives fixed pixel sizes independent of
          stroke width, so the arrowhead is always 14×9 canvas-px.
          refX="14" aligns the tip (x=14) with the path endpoint, which now lies
          exactly on the card border – no overshoot, no inset.
        */}
        <marker
          id="ah-default"
          markerUnits="userSpaceOnUse"
          markerWidth="14"
          markerHeight="9"
          refX="14"
          refY="4.5"
          orient="auto"
        >
          <path d="M0,0 L0,9 L14,4.5 z" fill={defaultColor} />
        </marker>
        <marker
          id="ah-red"
          markerUnits="userSpaceOnUse"
          markerWidth="14"
          markerHeight="9"
          refX="14"
          refY="4.5"
          orient="auto"
        >
          <path d="M0,0 L0,9 L14,4.5 z" fill={redColor} />
        </marker>
        <marker
          id="ah-green"
          markerUnits="userSpaceOnUse"
          markerWidth="14"
          markerHeight="9"
          refX="14"
          refY="4.5"
          orient="auto"
        >
          <path d="M0,0 L0,9 L14,4.5 z" fill={greenColor} />
        </marker>
        <marker
          id="ah-ghost"
          markerUnits="userSpaceOnUse"
          markerWidth="14"
          markerHeight="9"
          refX="14"
          refY="4.5"
          orient="auto"
        >
          <path d="M0,0 L0,9 L14,4.5 z" fill={ghostColor} />
        </marker>
        <marker
          id="ah-ghost-connected"
          markerUnits="userSpaceOnUse"
          markerWidth="14"
          markerHeight="9"
          refX="14"
          refY="4.5"
          orient="auto"
        >
          <path d="M0,0 L0,9 L14,4.5 z" fill={greenColor} />
        </marker>
      </defs>
      {arrows.map((a: Arrow) => {
        const stroke = colorOf(a.arrowColor);
        const isColoured = activeSceneId !== null || a.arrowColor === 'ghost-connected';
        const isGhost = a.arrowColor === 'ghost' || a.arrowColor === 'ghost-connected';

        // Edge-normal cubic bezier: each control point extends from its
        // endpoint along the outward edge normal. This ensures the curve
        // is tangent to the card border at both ends, producing visible
        // arcs regardless of the cards' relative positions.
        const edgeDist = Math.sqrt((a.x2 - a.x1) ** 2 + (a.y2 - a.y1) ** 2);
        // Arm length: 40 % of distance, clamped to [50, 120] px so nearby
        // cards still show a curve and distant ones don't over-extend.
        const arm = Math.min(120, Math.max(50, edgeDist * 0.4));
        const cp1x = a.x1 + a.nx1 * arm;
        const cp1y = a.y1 + a.ny1 * arm;
        // Target normal points AWAY from the target toward the source;
        // extending in that direction gives the arrival control point.
        const cp2x = a.x2 + a.nx2 * arm;
        const cp2y = a.y2 + a.ny2 * arm;

        return (
          <path
            key={a.key}
            d={`M ${a.x1} ${a.y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${a.x2} ${a.y2}`}
            fill="none"
            stroke={stroke}
            strokeWidth={isGhost ? 2 : isColoured ? 2.5 : 1.5}
            strokeDasharray={
              isGhost && a.arrowColor !== 'ghost-connected'
                ? '6,4'
                : isColoured
                  ? undefined
                  : '5,4'
            }
            markerEnd={`url(#ah-${a.arrowColor})`}
            opacity={isGhost ? 0.7 : isColoured ? 0.9 : 0.7}
          />
        );
      })}
    </svg>
  );
};
/* eslint-enable complexity */
