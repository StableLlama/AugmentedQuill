// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Scene card component shared by the Pinboard and Narrative views.
 *
 * In 'pinboard' mode (default) the card is absolutely positioned on the
 * infinite canvas and supports drag-to-move and Alt+drag cause creation.
 *
 * In 'narrative' mode the card uses flow layout (full-width, minimal height)
 * and only supports click-to-select, double-click-to-edit, and prose drop.
 * Drag-to-move and cause-drag are disabled; those props become optional.
 */

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, FileX } from 'lucide-react';
import type { Scene, SceneId } from '../../types';
import type { ProseDropData } from './types';
import { useTheme } from '../layout/ThemeContext';
import { toDisplayString, toInternationalDisplayString } from '../../utils/temporal';

// Color tag palette — matches tailwind classes so purge doesn't strip them.
const COLOR_TAG_CLASSES: Record<string, { bg: string; border: string }> = {
  red: {
    bg: 'bg-red-100 dark:bg-red-900/40',
    border: 'border-red-400 dark:border-red-600',
  },
  orange: {
    bg: 'bg-orange-100 dark:bg-orange-900/40',
    border: 'border-orange-400 dark:border-orange-600',
  },
  yellow: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/40',
    border: 'border-yellow-400 dark:border-yellow-600',
  },
  green: {
    bg: 'bg-green-100 dark:bg-green-900/40',
    border: 'border-green-400 dark:border-green-600',
  },
  teal: {
    bg: 'bg-teal-100 dark:bg-teal-900/40',
    border: 'border-teal-400 dark:border-teal-600',
  },
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-900/40',
    border: 'border-blue-400 dark:border-blue-600',
  },
  purple: {
    bg: 'bg-purple-100 dark:bg-purple-900/40',
    border: 'border-purple-400 dark:border-purple-600',
  },
  pink: {
    bg: 'bg-pink-100 dark:bg-pink-900/40',
    border: 'border-pink-400 dark:border-pink-600',
  },
};

const DEFAULT_CARD = {
  bg: 'bg-white dark:bg-brand-gray-800',
  border: 'border-brand-gray-200 dark:border-brand-gray-700',
};

/** Layout and interaction variant. */
export type SceneCardVariant = 'pinboard' | 'narrative';

interface SceneCardProps {
  scene: Scene;
  index: number;
  /**
   * 'pinboard' (default): absolutely positioned on the canvas with drag-to-move
   * and Alt+drag cause creation.
   * 'narrative': flow layout, full-width, click/dblclick/drop only.
   */
  variant?: SceneCardVariant;
  /** Called every frame while dragging to report the cumulative delta (in canvas
   *  pixels) so that the parent can update live positions and SVG arrows.
   *  Required in pinboard mode; unused in narrative mode. */
  onDragMove?: (sceneId: SceneId, dx: number, dy: number) => void;
  /** Called when the drag ends, with the final cumulative delta.
   *  Required in pinboard mode; unused in narrative mode. */
  onDragEnd?: (sceneId: SceneId, dx: number, dy: number) => void;
  /** Called on single click to select this card. Receives the native event so
   *  the caller can inspect ctrlKey / shiftKey for multi-selection logic. */
  onSelect: (sceneId: SceneId, e: MouseEvent) => void;
  /** Called on double-click to open the editor. */
  onEdit: (sceneId: SceneId) => void;
  /** Called when Alt+drag starts, providing the source scene id and the
   *  starting canvas-space coordinates so the ghost arrow can be placed.
   *  Required in pinboard mode; unused in narrative mode. */
  onCauseDragStart?: (
    sceneId: SceneId,
    startCanvasX: number,
    startCanvasY: number
  ) => void;
  /** Called when Alt+drag enters this card – provides the target scene id.
   *  Pinboard only. */
  onCauseDrop?: (targetSceneId: SceneId) => void;
  /** Called when Alt+drag leaves this card without releasing. Pinboard only. */
  onCauseLeave?: () => void;
  /** Whether this card is the target of an ongoing cause drag. Pinboard only. */
  isCauseTarget?: boolean;
  /** Whether this card is currently selected. */
  isSelected: boolean;
  /** Whether this card is the single active card (shows cause/effect arrows). */
  isActive: boolean;
  /** Whether this card is a cause of the currently active scene (red glow). */
  isCause: boolean;
  /** Whether the active scene is a cause of this card (green glow). */
  isEffect: boolean;
  /** Called when prose text is dropped onto this card. */
  onDropProse?: (sceneId: SceneId, data: ProseDropData) => void;
  /** Override display position (canvas px) during live drag. Pinboard only. */
  displayX?: number;
  displayY?: number;
  /** Called whenever the card's rendered height changes (used by CauseArrows for
   *  accurate border-intersection math). Pinboard only. */
  onLayout?: (sceneId: SceneId, height: number) => void;
}

/* eslint-disable complexity */
export const SceneCard: React.FC<SceneCardProps> = ({
  scene,
  index,
  variant = 'pinboard',
  onDragMove,
  onDragEnd,
  onSelect,
  onEdit,
  onCauseDragStart,
  onCauseDrop,
  onCauseLeave,
  isCauseTarget = false,
  isSelected,
  isActive,
  isCause,
  isEffect,
  onDropProse,
  displayX,
  displayY,
  onLayout,
}: SceneCardProps) => {
  const { t, i18n } = useTranslation();
  const { isLight } = useTheme();

  const isNarrative = variant === 'narrative';

  const colorKey = scene.color_tag ?? '';
  const colorClasses = COLOR_TAG_CLASSES[colorKey] ?? DEFAULT_CARD;

  // ---------- layout reporting ----------
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !onLayout) return;
    onLayout(scene.id, el.offsetHeight);
    const ro = new ResizeObserver(() => {
      onLayout(scene.id, el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scene.id, onLayout]);

  // ---------- drag state ----------
  const dragStart = useRef<{
    mouseX: number;
    mouseY: number;
    cardX: number;
    cardY: number;
  } | null>(null);
  const moved = useRef(false);

  const startNarrativeClickTracking = (e: React.MouseEvent<HTMLDivElement>): void => {
    let hasMoved = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const nativeEvt = e.nativeEvent;
    const onMoveCk = (me: MouseEvent): void => {
      if (Math.abs(me.clientX - startX) + Math.abs(me.clientY - startY) > 4)
        hasMoved = true;
    };
    const onUpCk = (me: MouseEvent): void => {
      document.removeEventListener('mousemove', onMoveCk);
      document.removeEventListener('mouseup', onUpCk);
      if (!hasMoved) onSelect(scene.id, me ?? nativeEvt);
    };
    document.addEventListener('mousemove', onMoveCk);
    document.addEventListener('mouseup', onUpCk);
  };

  const startAltCauseDragTracking = (e: React.MouseEvent<HTMLDivElement>): void => {
    // Alt+mousedown: begin cause drag. Compute canvas-space start position
    // from the card's stored position (the zoom/pan are accounted for by the
    // parent when converting mouse coords to canvas coords).
    const startCanvasX = scene.pinboard_x + 96; // card horizontal centre
    const startCanvasY = scene.pinboard_y + 45; // card vertical centre (approx for ~90px card)
    onCauseDragStart?.(scene.id, startCanvasX, startCanvasY);

    const startX = e.clientX;
    const startY = e.clientY;
    const nativeStart = e.nativeEvent;
    let altMoved = false;

    const onAltMove = (me: MouseEvent): void => {
      if (Math.abs(me.clientX - startX) + Math.abs(me.clientY - startY) > 4)
        altMoved = true;
    };
    const onAltUp = (me: MouseEvent): void => {
      document.removeEventListener('mousemove', onAltMove);
      document.removeEventListener('mouseup', onAltUp);
      if (!altMoved) {
        // Alt+click with no drag -> activate the scene (plain select).
        onSelect(scene.id, nativeStart);
      }
      void me;
    };
    document.addEventListener('mousemove', onAltMove);
    document.addEventListener('mouseup', onAltUp);
  };

  const startCardDragTracking = (e: React.MouseEvent<HTMLDivElement>): void => {
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      cardX: scene.pinboard_x,
      cardY: scene.pinboard_y,
    };
    moved.current = false;

    const onMouseMove = (me: MouseEvent): void => {
      if (!dragStart.current) return;
      const dx = me.clientX - dragStart.current.mouseX;
      const dy = me.clientY - dragStart.current.mouseY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
      if (moved.current) {
        // Report raw screen-pixel delta; parent divides by zoom.
        onDragMove?.(scene.id, dx, dy);
      }
    };

    const onMouseUp = (me: MouseEvent): void => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (dragStart.current && moved.current) {
        const dx = me.clientX - dragStart.current.mouseX;
        const dy = me.clientY - dragStart.current.mouseY;
        onDragEnd?.(scene.id, dx, dy);
      } else if (!moved.current) {
        onSelect(scene.id, me);
      }
      dragStart.current = null;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.stopPropagation();

    if (isNarrative) {
      // Narrative: click detection only - no drag-to-move, no cause drag.
      startNarrativeClickTracking(e);
      return;
    }

    if (e.altKey) {
      startAltCauseDragTracking(e);
      return;
    }

    startCardDragTracking(e);
  };

  const handleMouseEnter = (e: React.MouseEvent): void => {
    if (!isNarrative && e.buttons === 1 && e.altKey) {
      onCauseDrop?.(scene.id);
    }
  };

  const handleMouseLeave = (e: React.MouseEvent): void => {
    if (!isNarrative && e.buttons === 1 && e.altKey) {
      onCauseLeave?.();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onEdit(scene.id);
  };

  const handleDragOver = (e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes('application/aq-prose-selection')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
    }
  };

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/aq-prose-selection');
    if (!raw || !onDropProse) return;
    try {
      const data = JSON.parse(raw) as ProseDropData;
      onDropProse(scene.id, data);
    } catch {
      // ignore malformed data
    }
  };

  const statusDot =
    scene.status === 'active'
      ? 'bg-green-400'
      : scene.status === 'draft'
        ? 'bg-yellow-400'
        : 'bg-brand-gray-400';

  const sceneTimeRaw = scene.scene_time?.temporal_zoned_datetime;
  const storyTimeDisplay = toDisplayString(sceneTimeRaw, i18n.language);
  const internationalTimeDisplay = toInternationalDisplayString(
    sceneTimeRaw,
    i18n.language
  );
  const hasSceneTime = storyTimeDisplay.length > 0;
  const sceneTimeTooltip = hasSceneTime
    ? [
        t('Story time: {{value}}', { value: storyTimeDisplay }),
        t('International: {{value}}', { value: internationalTimeDisplay }),
      ].join('\n')
    : '';

  return (
    <div
      ref={cardRef}
      data-scene-card={scene.id}
      role="button"
      tabIndex={0}
      aria-label={t('Scene {{index}}', { index: index + 1 })}
      onKeyDown={(e: React.KeyboardEvent): void => {
        if (e.key === 'Enter' || e.key === ' ') onEdit(scene.id);
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={
        isNarrative
          ? undefined
          : { left: displayX ?? scene.pinboard_x, top: displayY ?? scene.pinboard_y }
      }
      className={[
        isNarrative
          ? 'relative w-full min-h-0 rounded-lg border-2 shadow-sm cursor-pointer select-none'
          : 'absolute w-48 min-h-16 rounded-lg border-2 shadow-md cursor-grab active:cursor-grabbing select-none',
        'transition-shadow hover:shadow-lg',
        colorClasses.bg,
        isCauseTarget
          ? 'ring-2 ring-brand-500 shadow-lg'
          : isActive
            ? [
                'ring-2 ring-violet-400/80',
                'shadow-[0_0_0_4px_rgba(139,92,246,0.15),0_8px_32px_rgba(139,92,246,0.35)]',
              ].join(' ')
            : isCause
              ? [
                  'ring-2 ring-red-500/80',
                  'shadow-[0_0_0_4px_rgba(239,68,68,0.12),0_8px_28px_rgba(239,68,68,0.5)]',
                ].join(' ')
              : isEffect
                ? [
                    'ring-2 ring-green-500/80',
                    'shadow-[0_0_0_4px_rgba(34,197,94,0.12),0_8px_28px_rgba(34,197,94,0.5)]',
                  ].join(' ')
                : isSelected
                  ? 'ring-2 ring-brand-400 ' + colorClasses.border
                  : colorClasses.border,
        scene.status === 'inactive' ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {hasSceneTime && (
        <span
          data-scene-time-indicator="true"
          className={`absolute top-2 right-2 ${isLight ? 'text-brand-gray-500' : 'text-brand-gray-300'}`}
          title={sceneTimeTooltip}
          aria-label={t('Scene time set')}
        >
          <Clock3 size={14} aria-hidden="true" />
        </span>
      )}

      {!scene.prose_link && (
        <span
          data-no-prose-indicator="true"
          className={`absolute top-2 ${hasSceneTime ? 'right-8' : 'right-2'} ${isLight ? 'text-brand-gray-400' : 'text-brand-gray-500'}`}
          title={t('Not yet linked to prose')}
          aria-label={t('Scene has no prose link')}
        >
          <FileX size={14} aria-hidden="true" />
        </span>
      )}

      {/* color stripe at top */}
      {colorKey && (
        <div
          className={`h-1.5 rounded-t-md ${colorClasses.border.replace('border-', 'bg-').split(' ')[0]}`}
        />
      )}

      <div className="p-3">
        {/* status dot */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <span
            data-scene-status-indicator="true"
            className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot}`}
            title={t('Scene status: ID {{id}}', { id: scene.id })}
            aria-label={t('Scene status: ID {{id}}', { id: scene.id })}
          />
        </div>

        {/* summary */}
        <p
          className={`text-sm font-medium leading-snug line-clamp-3 ${hasSceneTime ? 'pr-5' : ''} ${isLight ? 'text-brand-gray-900' : 'text-brand-gray-100'}`}
        >
          {scene.summary || t('Scene {{index}}', { index: index + 1 })}
        </p>

        {/* beats count */}
        {scene.beats.length > 0 && (
          <p
            className={`text-xs mt-1.5 ${isLight ? 'text-brand-gray-500' : 'text-brand-gray-400'}`}
          >
            {scene.beats.length} {t('Beats').toLowerCase()}
          </p>
        )}

        {/* characters */}
        {scene.active_characters.length > 0 && (
          <p
            className={`text-xs mt-0.5 truncate ${isLight ? 'text-brand-gray-500' : 'text-brand-gray-400'}`}
          >
            {scene.active_characters.join(', ')}
          </p>
        )}
      </div>
    </div>
  );
};
/* eslint-enable complexity */
