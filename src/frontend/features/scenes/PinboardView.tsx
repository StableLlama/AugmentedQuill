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
  relatedSceneIds?: ReadonlySet<SceneId>;
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
  relatedSceneIds,
}: PinboardViewProps) => {
  const { t } = useTranslation();
  const { isLight } = useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [scrollOffset, setScrollOffset] = useState({ x: 0, y: 0 });

  // Keep refs in sync so async handlers always have current values.
  const zoomRef = useRef(zoom);
  const scrollOffsetRef = useRef(scrollOffset);
  const scenesRef = useRef(scenes);
  const isPanning = useRef(false);
  const panStart = useRef({ mouseX: 0, mouseY: 0, scrollLeft: 0, scrollTop: 0 });
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    scrollOffsetRef.current = scrollOffset;
  }, [scrollOffset]);
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

  const handleWheel = useCallback((e: WheelEvent): void => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom((prev: number) => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      return Math.min(3, Math.max(0.3, prev + delta));
    });
  }, []);

  const handleScroll = useCallback((): void => {
    const el = containerRef.current;
    if (!el) return;
    const next = { x: el.scrollLeft, y: el.scrollTop };
    scrollOffsetRef.current = next;
    setScrollOffset(next);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('scroll', handleScroll);
    };
  }, [handleWheel, handleScroll]);

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
        const currentScroll = scrollOffsetRef.current;
        const toCanvas = (sx: number, sy: number): { cx: number; cy: number } => ({
          cx: (sx + currentScroll.x) / currentZoom,
          cy: (sy + currentScroll.y) / currentZoom,
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
    if (e.target !== e.currentTarget) return;

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      const containerEl = containerRef.current;
      if (!containerEl) return;
      e.preventDefault();
      isPanning.current = true;
      panStart.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        scrollLeft: containerEl.scrollLeft,
        scrollTop: containerEl.scrollTop,
      };
      const onMove = (me: MouseEvent): void => {
        if (!isPanning.current) return;
        const dx = me.clientX - panStart.current.mouseX;
        const dy = me.clientY - panStart.current.mouseY;
        if (!containerRef.current) return;
        containerRef.current.scrollLeft = panStart.current.scrollLeft - dx;
        containerRef.current.scrollTop = panStart.current.scrollTop - dy;
        handleScroll();
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
    (sceneId: SceneId, startClientX: number, startClientY: number): void => {
      causeDragSourceRef.current = sceneId;
      causeTargetRef.current = null;
      setCauseTargetDisplay(null);

      const containerEl = containerRef.current;
      const rect = containerEl?.getBoundingClientRect();
      const screenX = rect
        ? startClientX - rect.left + (containerEl?.scrollLeft ?? 0)
        : 0;
      const screenY = rect
        ? startClientY - rect.top + (containerEl?.scrollTop ?? 0)
        : 0;
      const cz = zoomRef.current;
      const canvasX = screenX / cz;
      const canvasY = screenY / cz;

      // Initialise ghost arrow at the pointer location in canvas space.
      setGhostArrow({
        fromId: sceneId,
        toX: canvasX,
        toY: canvasY,
        connected: false,
      });

      const onMouseMove = (me: MouseEvent): void => {
        const containerEl = containerRef.current;
        if (!containerEl || !causeDragSourceRef.current) return;
        const rect = containerEl.getBoundingClientRect();
        const screenX = me.clientX - rect.left + containerEl.scrollLeft;
        const screenY = me.clientY - rect.top + containerEl.scrollTop;
        const cz = zoomRef.current;
        const canvasX = screenX / cz;
        const canvasY = screenY / cz;
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

  const contentWidth = Math.max(
    1,
    scenes.reduce(
      (max: number, scene: Scene): number =>
        Math.max(max, scene.pinboard_x + CARD_WIDTH),
      0
    )
  );

  const contentHeight = Math.max(
    1,
    scenes.reduce((max: number, scene: Scene): number => {
      const sceneHeight = Math.max(
        CARD_APPROX_HEIGHT,
        cardHeights.get(scene.id) ?? CARD_APPROX_HEIGHT
      );
      return Math.max(max, scene.pinboard_y + sceneHeight);
    }, 0)
  );

  const scaledContentWidth = contentWidth * zoom;
  const scaledContentHeight = contentHeight * zoom;

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
      className={`relative w-full h-full overflow-auto select-none ${bgClass}`}
      style={{
        backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`,
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${-scrollOffset.x % (24 * zoom)}px ${-scrollOffset.y % (24 * zoom)}px`,
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
            if (containerRef.current) {
              containerRef.current.scrollLeft = 0;
              containerRef.current.scrollTop = 0;
              handleScroll();
            }
          }}
          className="w-7 h-7 rounded-md border border-brand-gray-300 dark:border-brand-gray-700 bg-white dark:bg-brand-gray-800 text-brand-gray-700 dark:text-brand-gray-200 text-xs hover:bg-brand-gray-100 dark:hover:bg-brand-gray-700 flex items-center justify-center shadow-sm"
        >
          ↺
        </button>
      </div>

      {/* Canvas layer */}
      <div
        style={{
          width: `${scaledContentWidth}px`,
          height: `${scaledContentHeight}px`,
          minWidth: '100%',
          minHeight: '100%',
          position: 'relative',
        }}
      >
        <div
          data-testid="pinboard-canvas"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: `${contentWidth}px`,
            height: `${contentHeight}px`,
            transform: `scale(${zoom})`,
            transformOrigin: '0 0',
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
                isCauseSource={causeDragSourceRef.current === scene.id}
                isSelected={selectedSceneIds.has(scene.id)}
                isActive={activeSceneId === scene.id}
                isCause={causeIds.has(scene.id)}
                isEffect={effectIds.has(scene.id)}
                isRelated={relatedSceneIds?.has(scene.id) ?? false}
                onDropProse={onDropProse}
                displayX={livePos?.x}
                displayY={livePos?.y}
                onLayout={handleCardLayout}
              />
            );
          })}
        </div>
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
