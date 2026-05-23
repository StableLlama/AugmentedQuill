// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Infinite-canvas pinboard for scenes.
 * Supports pan (middle-mouse or Alt+drag on background), zoom (wheel),
 * free-position cards with live arrow tracking during drag,
 * multi-card drag (dragging one selected card moves all selected cards),
 * Alt+drag on a card to create causal links with ghost-arrow preview,
 * and multi-card selection via Ctrl+click, Shift+click, and lasso drag.
 *
 * Active scene and selection are independent: Ctrl+click adds a card to
 * the selection and makes it the new active scene. Lasso in additive mode
 * (Ctrl/Shift held) adds to the selection without changing the active scene.
 * Plain click selects and activates only the clicked card.
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Scene, SceneId } from '../../types';
import type { ProseDropData } from './types';
import { SceneCard } from './SceneCard';
import { CauseArrows } from './ConstraintArrows';
import type { GhostArrow, ScenePositions } from './ConstraintArrows';
import { useTheme } from '../layout/ThemeContext';
import { useSceneSelection } from './useSceneSelection';

/** Approximate card width matching Tailwind w-48 = 192 px. */
const CARD_WIDTH = 192;
/** Approximate card height used for lasso hit-testing. */
const CARD_APPROX_HEIGHT = 130;

interface LassoRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PinboardViewProps {
  scenes: Scene[];
  primarySelectedSceneId: SceneId | null;
  onSelectScene: (id: SceneId | null) => void;
  onMoveScene: (sceneId: SceneId, x: number, y: number) => void;
  onEditScene: (sceneId: SceneId) => void;
  onCreateCause: (fromId: SceneId, toId: SceneId) => void;
  onDropProse?: (sceneId: SceneId, data: ProseDropData) => void;
  onSelectionChange?: (ids: ReadonlySet<SceneId>) => void;
}

export const PinboardView: React.FC<PinboardViewProps> = ({
  scenes,
  primarySelectedSceneId,
  onSelectScene,
  onMoveScene,
  onEditScene,
  onCreateCause,
  onDropProse,
  onSelectionChange,
}: PinboardViewProps) => {
  const { t } = useTranslation();
  const { isLight } = useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Keep refs in sync so async handlers always have current values.
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const scenesRef = useRef(scenes);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);
  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);

  // ---- Multi-selection + active scene (shared hook) ----
  const {
    selectedSceneIds,
    activeSceneId,
    setSelectedSceneIds,
    setActiveSceneId,
    handleCardSelect,
    anchorIdRef,
    prevPrimaryRef,
    activeSceneIdRef,
    selectedIdsRef,
  } = useSceneSelection({
    displayOrder: scenes,
    primarySelectedSceneId,
    onSelectScene,
    onSelectionChange,
  });

  // ---- Live card positions during drag ----
  // A plain Map updated every mousemove frame. We store it in state so React
  // re-renders the SVG arrows every frame, but only the Map reference changes
  // (not individual scene objects).
  const [livePositions, setLivePositions] = useState<ScenePositions>(new Map());
  // Set to true in handleCardDragEnd; cleared by the useEffect below once the
  // 'scenes' prop reflects the committed store update so we never clear
  // livePositions before scene.pinboard_x has been updated (prevents snapback).
  const pendingLiveClearRef = useRef(false);

  // ---- Ghost arrow during Alt+drag ----
  const [ghostArrow, setGhostArrow] = useState<GhostArrow | null>(null);

  // ---- Actual card heights measured via ResizeObserver (used by CauseArrows) ----
  const [cardHeights, setCardHeights] = useState<Map<SceneId, number>>(new Map());

  const handleCardLayout = useCallback((sceneId: SceneId, height: number): void => {
    setCardHeights((prev: Map<SceneId, number>) => {
      if (prev.get(sceneId) === height) return prev; // avoid spurious re-renders
      const next = new Map(prev);
      next.set(sceneId, height);
      return next;
    });
  }, []);

  // Clear live drag positions once the 'scenes' prop has caught up with the
  // store update committed in handleCardDragEnd.  Using a useEffect that depends
  // on [scenes] guarantees we wait until the new pinboard_x/y values are
  // available in the render that clears the override – preventing a one-frame
  // snapback to the original position.
  useEffect((): void => {
    if (!pendingLiveClearRef.current) return;
    pendingLiveClearRef.current = false;
    setLivePositions(new Map());
  }, [scenes]);

  // ---- Lasso overlay ----
  const [lassoRect, setLassoRect] = useState<LassoRect | null>(null);

  // ---- Cause drag state ----
  const causeDragSourceRef = useRef<SceneId | null>(null);
  const causeTargetRef = useRef<SceneId | null>(null);
  const [causeTargetDisplay, setCauseTargetDisplay] = useState<SceneId | null>(null);

  // Pan via middle-mouse
  const isPanning = useRef(false);
  const panStart = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });

  const handleWheel = useCallback((e: WheelEvent): void => {
    e.preventDefault();
    setZoom((prev: number) => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      return Math.min(3, Math.max(0.3, prev + delta));
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ---- Multi-card move handler ----
  // Called by SceneCard when the user drags a card. The delta is in screen
  // pixels; we convert to canvas pixels by dividing by the current zoom.
  // If the dragged card is selected, all selected cards move together.
  const handleCardDragMove = useCallback(
    (draggedId: SceneId, screenDx: number, screenDy: number): void => {
      const cz = zoomRef.current;
      const dx = screenDx / cz;
      const dy = screenDy / cz;
      const currentSelected = selectedIdsRef.current;
      const movers: SceneId[] = currentSelected.has(draggedId)
        ? Array.from(currentSelected)
        : [draggedId];

      const next: ScenePositions = new Map();
      for (const id of movers) {
        const s = scenesRef.current.find((sc: Scene) => sc.id === id);
        if (!s) continue;
        next.set(id, {
          x: Math.max(0, s.pinboard_x + dx),
          y: Math.max(0, s.pinboard_y + dy),
        });
      }
      setLivePositions(next);
    },
    []
  );

  // Called when drag ends – commit all positions to the store.
  const handleCardDragEnd = useCallback(
    (draggedId: SceneId, screenDx: number, screenDy: number): void => {
      const cz = zoomRef.current;
      const dx = screenDx / cz;
      const dy = screenDy / cz;
      const currentSelected = selectedIdsRef.current;
      const movers: SceneId[] = currentSelected.has(draggedId)
        ? Array.from(currentSelected)
        : [draggedId];

      const finalLive: ScenePositions = new Map();
      for (const id of movers) {
        const s = scenesRef.current.find((sc: Scene) => sc.id === id);
        if (!s) continue;
        const newX = Math.max(0, s.pinboard_x + dx);
        const newY = Math.max(0, s.pinboard_y + dy);
        finalLive.set(id, { x: newX, y: newY });
        onMoveScene(id, newX, newY);
      }
      // Keep live positions at the final dragged location until the store update
      // propagates through React (useEffect on [scenes] will clear them then).
      setLivePositions(finalLive);
      pendingLiveClearRef.current = true;
    },
    [onMoveScene]
  );

  // ---- Background click / lasso drag ----
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0 || e.altKey) return;

    const containerEl = containerRef.current;
    if (!containerEl) return;
    const containerRect = containerEl.getBoundingClientRect();

    const startX = e.clientX - containerRect.left;
    const startY = e.clientY - containerRect.top;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;

    let dragged = false;

    const onMove = (me: MouseEvent): void => {
      const curX = me.clientX - containerRect.left;
      const curY = me.clientY - containerRect.top;
      if (!dragged && Math.abs(curX - startX) + Math.abs(curY - startY) > 4) {
        dragged = true;
      }
      if (dragged) {
        setLassoRect({ x1: startX, y1: startY, x2: curX, y2: curY });
      }
    };

    const onUp = (me: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setLassoRect(null);

      if (dragged) {
        const curX = me.clientX - containerRect.left;
        const curY = me.clientY - containerRect.top;
        const currentZoom = zoomRef.current;
        const currentPan = panRef.current;
        const toCanvas = (sx: number, sy: number): { cx: number; cy: number } => ({
          cx: (sx - currentPan.x) / currentZoom,
          cy: (sy - currentPan.y) / currentZoom,
        });
        const tl = toCanvas(Math.min(startX, curX), Math.min(startY, curY));
        const br = toCanvas(Math.max(startX, curX), Math.max(startY, curY));

        const inLasso = scenesRef.current
          .filter(
            (s: Scene) =>
              s.pinboard_x < br.cx &&
              s.pinboard_x + CARD_WIDTH > tl.cx &&
              s.pinboard_y < br.cy &&
              s.pinboard_y + CARD_APPROX_HEIGHT > tl.cy
          )
          .map((s: Scene) => s.id);

        if (additive) {
          // Additive lasso: add to selection, preserve active scene.
          setSelectedSceneIds((prev: ReadonlySet<SceneId>) => {
            const next = new Set(prev);
            inLasso.forEach((id: SceneId) => next.add(id));
            return next;
          });
          // Do not change active scene in additive mode.
          const primary = inLasso[0] ?? null;
          if (primary) anchorIdRef.current = primary;
          prevPrimaryRef.current = activeSceneIdRef.current;
          onSelectScene(primary);
        } else {
          // Non-additive lasso: replace selection and clear active scene.
          setSelectedSceneIds(new Set(inLasso));
          setActiveSceneId(null);
          const primary = inLasso[0] ?? null;
          if (primary) anchorIdRef.current = primary;
          prevPrimaryRef.current = null;
          onSelectScene(primary);
        }
      } else {
        if (!additive) {
          setActiveSceneId(null);
          setSelectedSceneIds(new Set());
          anchorIdRef.current = null;
          prevPrimaryRef.current = null;
          onSelectScene(null);
        }
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      isPanning.current = true;
      panStart.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      const onMove = (me: MouseEvent): void => {
        if (!isPanning.current) return;
        setPan({
          x: panStart.current.panX + (me.clientX - panStart.current.mouseX),
          y: panStart.current.panY + (me.clientY - panStart.current.mouseY),
        });
      };
      const onUp = (): void => {
        isPanning.current = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
  };

  // ---- Cause drag handlers (Alt+drag on a card) ----
  const handleCauseDragStart = useCallback(
    (sceneId: SceneId, startCanvasX: number, startCanvasY: number): void => {
      causeDragSourceRef.current = sceneId;
      causeTargetRef.current = null;
      setCauseTargetDisplay(null);

      // Initialise ghost arrow at the start point.
      setGhostArrow({
        fromId: sceneId,
        toX: startCanvasX,
        toY: startCanvasY,
        connected: false,
      });

      const onMouseMove = (me: MouseEvent): void => {
        const containerEl = containerRef.current;
        if (!containerEl || !causeDragSourceRef.current) return;
        const rect = containerEl.getBoundingClientRect();
        const screenX = me.clientX - rect.left;
        const screenY = me.clientY - rect.top;
        const cz = zoomRef.current;
        const cp = panRef.current;
        const canvasX = (screenX - cp.x) / cz;
        const canvasY = (screenY - cp.y) / cz;
        const connected = causeTargetRef.current !== null;
        setGhostArrow({
          fromId: causeDragSourceRef.current,
          toX: canvasX,
          toY: canvasY,
          connected,
        });
      };

      const onUp = (): void => {
        if (causeDragSourceRef.current && causeTargetRef.current !== null) {
          onCreateCause(causeDragSourceRef.current, causeTargetRef.current);
        }
        causeDragSourceRef.current = null;
        causeTargetRef.current = null;
        setCauseTargetDisplay(null);
        setGhostArrow(null);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMouseMove);
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

  const bgClass = isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-950';
  const dotColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';

  const activeScene = activeSceneId
    ? (scenes.find((s: Scene) => s.id === activeSceneId) ?? null)
    : null;
  const causeIds = new Set<SceneId>(
    scenes
      .filter((s: Scene) => (s.causes ?? []).includes(activeSceneId ?? -1))
      .map((s: Scene) => s.id)
  );
  const effectIds = new Set<SceneId>(activeScene?.causes ?? []);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none ${bgClass}`}
      style={{
        backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`,
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${pan.x % (24 * zoom)}px ${pan.y % (24 * zoom)}px`,
      }}
      onPointerDown={handleMouseDown}
      aria-label={t('Pinboard')}
      role="region"
    >
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button
          type="button"
          aria-label={t('Zoom In')}
          onClick={() => setZoom((z: number) => Math.min(3, z + 0.2))}
          className="w-7 h-7 rounded-md border border-brand-gray-300 dark:border-brand-gray-700 bg-white dark:bg-brand-gray-800 text-brand-gray-700 dark:text-brand-gray-200 text-sm font-bold hover:bg-brand-gray-100 dark:hover:bg-brand-gray-700 flex items-center justify-center shadow-sm"
        >
          +
        </button>
        <button
          type="button"
          aria-label={t('Zoom Out')}
          onClick={() => setZoom((z: number) => Math.max(0.3, z - 0.2))}
          className="w-7 h-7 rounded-md border border-brand-gray-300 dark:border-brand-gray-700 bg-white dark:bg-brand-gray-800 text-brand-gray-700 dark:text-brand-gray-200 text-sm font-bold hover:bg-brand-gray-100 dark:hover:bg-brand-gray-700 flex items-center justify-center shadow-sm"
        >
          −
        </button>
        <button
          type="button"
          aria-label={t('Reset Zoom')}
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          className="w-7 h-7 rounded-md border border-brand-gray-300 dark:border-brand-gray-700 bg-white dark:bg-brand-gray-800 text-brand-gray-700 dark:text-brand-gray-200 text-xs hover:bg-brand-gray-100 dark:hover:bg-brand-gray-700 flex items-center justify-center shadow-sm"
        >
          ↺
        </button>
      </div>

      {/* Canvas layer */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'absolute',
          inset: 0,
        }}
        onPointerDown={handleCanvasMouseDown}
      >
        {/* Cause arrows drawn under the cards */}
        <CauseArrows
          scenes={scenes}
          livePositions={livePositions}
          cardHeights={cardHeights}
          activeSceneId={activeSceneId}
          ghostArrow={ghostArrow}
        />

        {scenes.map((scene: Scene, idx: number) => {
          const livePos = livePositions.get(scene.id);
          return (
            <SceneCard
              key={scene.id}
              scene={scene}
              index={idx}
              onSelect={handleCardSelect}
              onEdit={onEditScene}
              onDragMove={handleCardDragMove}
              onDragEnd={handleCardDragEnd}
              onCauseDragStart={handleCauseDragStart}
              onCauseDrop={handleCauseDrop}
              onCauseLeave={handleCauseLeave}
              isCauseTarget={causeTargetDisplay === scene.id}
              isSelected={selectedSceneIds.has(scene.id)}
              isActive={activeSceneId === scene.id}
              isCause={causeIds.has(scene.id)}
              isEffect={effectIds.has(scene.id)}
              onDropProse={onDropProse}
              displayX={livePos?.x}
              displayY={livePos?.y}
              onLayout={handleCardLayout}
            />
          );
        })}
      </div>

      {/* Lasso overlay — screen space */}
      {lassoRect && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: Math.min(lassoRect.x1, lassoRect.x2),
            top: Math.min(lassoRect.y1, lassoRect.y2),
            width: Math.abs(lassoRect.x2 - lassoRect.x1),
            height: Math.abs(lassoRect.y2 - lassoRect.y1),
            border: '1.5px dashed #6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.07)',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        />
      )}
    </div>
  );
};
