// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Universal floating hover toolbar for diff accept / reject.
 *
 * Attaches to any container element and shows a fixed-position toolbar
 * when the user hovers over a diff-highlighted region (CodeMirror inline
 * diffs, section diffs, or any element matching the diff selector).
 *
 * The toolbar stays within the viewport (clamped), follows the hovered
 * element on scroll, and hides when the mouse leaves the diff region.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FloatingDiffToolbarProps {
  /** Ref to the container element to monitor for diff hover. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Whether the toolbar is active. */
  enabled: boolean;
  /** Called when user accepts the currently hovered diff. Receives the diff DOM element. */
  onAccept: (diffElement: HTMLElement) => void;
  /** Called when user rejects the currently hovered diff. Receives the diff DOM element. */
  onReject: (diffElement: HTMLElement) => void;
  /** Called when user accepts all diffs in the container. */
  onAcceptAll?: () => void;
  /** Show the accept-all button. */
  showAcceptAll?: boolean;
  /**
   * CSS selector for diff elements to detect.  Default covers CodeMirror
   * inline diffs and section-level data-diff markers.
   */
  diffSelector?: string;
  /** Whether the current theme is light (used for conditional styling). */
  isLight?: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_DIFF_SELECTOR =
  '.cm-diff-inserted, .cm-diff-deleted, [data-diff="changed"]';

const TOOLBAR_HEIGHT = 36;
const TOOLBAR_WIDTH = 112;
const HIDE_DELAY_MS = 250;
const GAP_PX = 4;

// ─── Component ──────────────────────────────────────────────────────────────

export const FloatingDiffToolbar: React.FC<FloatingDiffToolbarProps> = ({
  containerRef,
  enabled,
  onAccept,
  onReject,
  onAcceptAll,
  showAcceptAll = false,
  diffSelector = DEFAULT_DIFF_SELECTOR,
  isLight = true,
}: FloatingDiffToolbarProps) => {
  const { t } = useTranslation();

  const [hoveredDiff, setHoveredDiff] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const [acceptAllConfirm, setAcceptAllConfirm] = useState(false);

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = useRef<HTMLElement | null>(null);

  // ── Find diff element under cursor ──────────────────────────────────────

  const findDiffAtPoint = useCallback(
    (clientX: number, clientY: number): HTMLElement | null => {
      const container = containerRef.current;
      if (!container) return null;

      const topEl = document.elementFromPoint(clientX, clientY);
      if (!(topEl instanceof HTMLElement)) return null;
      if (!container.contains(topEl)) return null;

      // Check the element and its ancestors for a diff match.
      let el: HTMLElement | null = topEl;
      while (el && container.contains(el)) {
        if (el.matches(diffSelector)) return el;
        el = el.parentElement;
      }
      return null;
    },
    [containerRef, diffSelector]
  );

  // ── Update toolbar position from element rect ───────────────────────────

  const updatePosition = useCallback((el: HTMLElement): void => {
    const rect = el.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    // Place toolbar above the element if there's room, otherwise below.
    let top = rect.top - TOOLBAR_HEIGHT - GAP_PX;
    if (top < GAP_PX) {
      top = Math.min(rect.bottom + GAP_PX, viewH - TOOLBAR_HEIGHT - GAP_PX);
    }

    // Clamp to viewport top/bottom.
    top = Math.max(GAP_PX, Math.min(top, viewH - TOOLBAR_HEIGHT - GAP_PX));

    // Center horizontally over the element, clamped to viewport edges.
    let left = rect.left + rect.width / 2 - TOOLBAR_WIDTH / 2;
    left = Math.max(GAP_PX, Math.min(left, viewW - TOOLBAR_WIDTH - GAP_PX));

    setPosition({ top, left });
  }, []);

  // ── Mouse move handler ──────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: MouseEvent): void => {
      if (!enabled) return;

      const diff = findDiffAtPoint(e.clientX, e.clientY);
      if (diff) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        if (hoveredRef.current !== diff) {
          hoveredRef.current = diff;
          setHoveredDiff(diff);
          updatePosition(diff);
        }
      } else if (hoveredRef.current) {
        // Delay hiding so the user can move the mouse to the toolbar.
        if (!hideTimerRef.current) {
          hideTimerRef.current = setTimeout((): void => {
            hoveredRef.current = null;
            setHoveredDiff(null);
            setAcceptAllConfirm(false);
            hideTimerRef.current = null;
          }, HIDE_DELAY_MS);
        }
      }
    },
    [enabled, findDiffAtPoint, updatePosition]
  );

  // ── Scroll handler: keep toolbar near visible portion of large diffs ────

  const handleScroll = useCallback((): void => {
    if (!hoveredRef.current || !enabled) return;
    updatePosition(hoveredRef.current);
  }, [enabled, updatePosition]);

  // ── Toolbar mouse enter/leave ───────────────────────────────────────────

  const handleToolbarEnter = useCallback((): void => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const handleToolbarLeave = useCallback((): void => {
    hideTimerRef.current = setTimeout((): void => {
      hoveredRef.current = null;
      setHoveredDiff(null);
      setAcceptAllConfirm(false);
      hideTimerRef.current = null;
    }, HIDE_DELAY_MS);
  }, []);

  // ── Effects ─────────────────────────────────────────────────────────────

  useEffect((): (() => void) | undefined => {
    const container = containerRef.current;
    if (!container) return undefined;

    container.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('scroll', handleScroll, { passive: true });

    return (): void => {
      container.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('scroll', handleScroll);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [containerRef, handleMouseMove, handleScroll]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (!enabled || !hoveredDiff) return null;

  const handleAccept = (): void => {
    onAccept(hoveredDiff);
    setAcceptAllConfirm(false);
  };

  const handleReject = (): void => {
    onReject(hoveredDiff);
    setAcceptAllConfirm(false);
  };

  const handleAcceptAll = (): void => {
    if (!acceptAllConfirm) {
      setAcceptAllConfirm(true);
      return;
    }
    setAcceptAllConfirm(false);
    onAcceptAll?.();
  };

  return createPortal(
    <div
      role="toolbar"
      aria-label={t('Diff actions')}
      className={`fixed z-[200] flex items-center gap-0.5 px-1.5 py-1 rounded-lg shadow-lg border ${
        isLight
          ? 'border-brand-gray-200 bg-white'
          : 'border-brand-gray-800 bg-brand-gray-900'
      }`}
      style={{
        top: position.top,
        left: position.left,
        height: TOOLBAR_HEIGHT,
      }}
      onMouseEnter={handleToolbarEnter}
      onMouseLeave={handleToolbarLeave}
    >
      <button
        type="button"
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
          isLight
            ? 'text-green-600 hover:bg-green-100 hover:text-green-700'
            : 'text-green-400 hover:bg-green-900/30 hover:text-green-300'
        }`}
        onClick={handleAccept}
        title={t('Accept change')}
        aria-label={t('Accept change')}
      >
        <Check size={15} />
      </button>
      <button
        type="button"
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
          isLight
            ? 'text-red-600 hover:bg-red-100 hover:text-red-700'
            : 'text-red-400 hover:bg-red-900/30 hover:text-red-300'
        }`}
        onClick={handleReject}
        title={t('Reject change')}
        aria-label={t('Reject change')}
      >
        <X size={15} />
      </button>
      {showAcceptAll && onAcceptAll && (
        <button
          type="button"
          className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
            acceptAllConfirm
              ? isLight
                ? 'bg-brand-100 text-brand-700'
                : 'bg-brand-900/40 text-brand-300'
              : isLight
                ? 'text-brand-600 hover:bg-brand-100 hover:text-brand-700'
                : 'text-brand-400 hover:bg-brand-900/30 hover:text-brand-300'
          }`}
          onClick={handleAcceptAll}
          onBlur={(): void => setAcceptAllConfirm(false)}
          title={
            acceptAllConfirm
              ? t('Click again to confirm accept all')
              : t('Accept all changes')
          }
          aria-label={
            acceptAllConfirm ? t('Confirm accept all changes') : t('Accept all changes')
          }
        >
          <CheckCheck size={15} />
        </button>
      )}
    </div>,
    document.body
  );
};
