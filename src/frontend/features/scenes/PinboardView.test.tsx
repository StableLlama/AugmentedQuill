// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for PinboardView multi-select behaviour.
 *
 * Strategy: SceneCard and ConstraintArrows are replaced with lightweight stubs.
 * SceneCard records the onSelect/isSelected props so tests can trigger selection
 * directly.  All multi-select paths (plain click, Ctrl+click, Shift+click,
 * background click, lasso drag, and the prevPrimaryRef guard) are exercised.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import i18n from '../app/i18n';
import { PinboardView } from './PinboardView';
import type { Scene } from '../../types';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

type SelectHandler = (sceneId: string, e: MouseEvent) => void;
type LayoutHandler = (sceneId: string, height: number) => void;
// Each rendered card's onSelect callback, keyed by sceneId.
const cardSelectHandlers: Record<string, SelectHandler> = {};
// Most-recent isSelected value per card.
const cardIsSelected: Record<string, boolean> = {};
// Most-recent onLayout callback per card.
const cardLayoutHandlers: Record<string, LayoutHandler> = {};
// Last cardHeights map received by CauseArrows.
let lastArrowsCardHeights: Map<string, number> | null = null;

vi.mock('./SceneCard', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SceneCard: (props: any) => {
    cardSelectHandlers[props.scene.id] = props.onSelect;
    cardIsSelected[props.scene.id] = props.isSelected;
    if (props.onLayout) {
      cardLayoutHandlers[props.scene.id] = props.onLayout;
    }
    return (
      <div
        data-testid={`card-${props.scene.id}`}
        data-selected={props.isSelected ? 'true' : 'false'}
      />
    );
  },
}));

vi.mock('./ConstraintArrows', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CauseArrows: (props: any) => {
    lastArrowsCardHeights = props.cardHeights ?? null;
    return null;
  },
}));

vi.mock('../layout/ThemeContext', () => ({
  useTheme: vi.fn(() => ({ isLight: true })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScene(id: string, x: number = 0, y: number = 0): Scene {
  return {
    id,
    title: id,
    summary: '',
    pinboard_x: x,
    pinboard_y: y,
    order_index: 0,
    prose_link: null,
    predecessor_ids: [],
    created_at: '',
    updated_at: '',
  };
}

function makeMouseEvent(
  type: string,
  opts: Partial<
    MouseEventInit & { ctrlKey?: boolean; shiftKey?: boolean; button?: number }
  > = {}
): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    button: opts.button ?? 0,
  });
}

function makePointerEvent(
  type: string,
  opts: Partial<
    PointerEventInit & { ctrlKey?: boolean; shiftKey?: boolean; button?: number }
  > = {}
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    button: opts.button ?? 0,
  });
}

// Click a card by dispatching via its stored handler.
function clickCard(id: string, opts: { ctrl?: boolean; shift?: boolean } = {}): void {
  const e = makeMouseEvent('click', { ctrlKey: opts.ctrl, shiftKey: opts.shift });
  act(() => {
    cardSelectHandlers[id]?.(id, e);
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const scenes = [
  makeScene('s1', 0, 0),
  makeScene('s2', 200, 0),
  makeScene('s3', 400, 0),
];

interface RenderResult {
  onSelectScene: ReturnType<typeof vi.fn>;
  onSelectionChange: ReturnType<typeof vi.fn>;
  container: HTMLElement;
  rerender: (props?: Partial<React.ComponentProps<typeof PinboardView>>) => void;
}

function renderPinboard(
  primarySelectedSceneId: string | null = null,
  sceneList: Scene[] = scenes
): RenderResult {
  const onSelectScene = vi.fn();
  const onSelectionChange = vi.fn();

  let currentProps = {
    scenes: sceneList,
    primarySelectedSceneId,
    onSelectScene,
    onSelectionChange,
    onMoveScene: vi.fn(),
    onEditScene: vi.fn(),
    onCreateCause: vi.fn(),
  };

  const { rerender: baseRerender, container } = render(
    <I18nextProvider i18n={i18n}>
      <PinboardView {...currentProps} />
    </I18nextProvider>
  );

  const rerender = (overrides: Partial<typeof currentProps> = {}): void => {
    currentProps = { ...currentProps, ...overrides };
    baseRerender(
      <I18nextProvider i18n={i18n}>
        <PinboardView {...currentProps} />
      </I18nextProvider>
    );
  };

  return { onSelectScene, onSelectionChange, container, rerender };
}

// ---------------------------------------------------------------------------

describe('PinboardView — native scroll and zoom', () => {
  it('uses overflow-auto on the pinboard container', () => {
    const { container } = renderPinboard();
    const scrollContainer = container.firstElementChild as HTMLElement | null;
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer?.className).toContain('overflow-auto');
  });

  it('zooms when wheel is used with ctrl/meta and ignores plain wheel for native scrolling', () => {
    const { container } = renderPinboard();
    const scrollContainer = container.firstElementChild as HTMLElement;
    const canvas = container.querySelector(
      '[data-testid="pinboard-canvas"]'
    ) as HTMLElement;
    expect(canvas).not.toBeNull();

    act(() => {
      fireEvent.wheel(scrollContainer, { deltaY: -100, ctrlKey: true });
    });
    expect(canvas.style.transform).toContain('scale(1.1)');

    act(() => {
      fireEvent.wheel(scrollContainer, { deltaY: -100 });
    });
    expect(canvas.style.transform).toContain('scale(1.1)');
  });
});

// ---------------------------------------------------------------------------

describe('PinboardView — multi-select', () => {
  beforeEach(() => {
    // Reset shared spy maps.
    Object.keys(cardSelectHandlers).forEach(
      (k: string) => delete cardSelectHandlers[k]
    );
    Object.keys(cardIsSelected).forEach((k: string) => delete cardIsSelected[k]);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── Plain click ───────────────────────────────────────────────────────────

  it('plain click selects only that card', () => {
    const { onSelectScene } = renderPinboard();
    clickCard('s1');
    expect(cardIsSelected['s1']).toBe(true);
    expect(cardIsSelected['s2']).toBe(false);
    expect(onSelectScene).toHaveBeenCalledWith('s1');
  });

  it('plain click on a second card replaces selection', () => {
    const { onSelectScene } = renderPinboard('s1');
    clickCard('s2');
    expect(cardIsSelected['s1']).toBe(false);
    expect(cardIsSelected['s2']).toBe(true);
    expect(onSelectScene).toHaveBeenLastCalledWith('s2');
  });

  // ── Ctrl+click ────────────────────────────────────────────────────────────

  it('Ctrl+click toggles second card into selection', () => {
    renderPinboard('s1');
    clickCard('s2', { ctrl: true });
    expect(cardIsSelected['s1']).toBe(true);
    expect(cardIsSelected['s2']).toBe(true);
  });

  it('Ctrl+click toggles an already-selected card out', () => {
    renderPinboard('s1');
    // First, ctrl-add s2
    clickCard('s2', { ctrl: true });
    expect(cardIsSelected['s2']).toBe(true);
    // Then ctrl-remove s2
    clickCard('s2', { ctrl: true });
    expect(cardIsSelected['s2']).toBe(false);
    expect(cardIsSelected['s1']).toBe(true);
  });

  // ── Shift+click ───────────────────────────────────────────────────────────

  it('Shift+click from s1 to s3 selects s1,s2,s3', () => {
    renderPinboard('s1');
    clickCard('s3', { shift: true });
    expect(cardIsSelected['s1']).toBe(true);
    expect(cardIsSelected['s2']).toBe(true);
    expect(cardIsSelected['s3']).toBe(true);
  });

  it('Shift+click from s3 anchor back to s1 selects the whole range', () => {
    const { onSelectScene } = renderPinboard();
    // Anchor at s3
    clickCard('s3');
    onSelectScene.mockClear();
    // Shift-click s1
    clickCard('s1', { shift: true });
    expect(cardIsSelected['s1']).toBe(true);
    expect(cardIsSelected['s2']).toBe(true);
    expect(cardIsSelected['s3']).toBe(true);
  });

  // ── Background click clears selection ────────────────────────────────────

  it('clicking canvas background clears selection', () => {
    const { container, onSelectScene } = renderPinboard('s1');
    onSelectScene.mockClear();

    // Fire mousedown on the pinboard canvas wrapper (no card involved)
    const canvas = container.querySelector<HTMLElement>(
      '[data-testid="pinboard-canvas"]'
    );
    act(() => {
      if (canvas) {
        canvas.dispatchEvent(
          makePointerEvent('pointerdown', { clientX: 5, clientY: 5, button: 0 })
        );
        // No mousemove → not a lasso drag, so mouseup on document is plain click
        document.dispatchEvent(makeMouseEvent('mouseup', { clientX: 5, clientY: 5 }));
      }
    });
    expect(onSelectScene).toHaveBeenCalledWith(null);
  });

  // ── External primarySelectedSceneId change resets selection ───────────────

  it('external primary change resets multi-selection', () => {
    const { rerender } = renderPinboard('s1');
    // Build a multi-select first
    clickCard('s2', { ctrl: true });
    expect(cardIsSelected['s1']).toBe(true);
    expect(cardIsSelected['s2']).toBe(true);
    // Simulate external driven change (editor cursor sync)
    act(() => {
      rerender({ primarySelectedSceneId: 's3' });
    });
    expect(cardIsSelected['s1']).toBe(false);
    expect(cardIsSelected['s2']).toBe(false);
    expect(cardIsSelected['s3']).toBe(true);
  });

  // ── prevPrimaryRef guard: internal click must NOT reset selection ──────────

  it('internal card click does not reset multi-selection via useEffect', () => {
    // PinboardView calls prevPrimaryRef.current = sceneId BEFORE onSelectScene.
    // If the parent calls back with the same primary, the useEffect should not
    // reset the multi-selection.
    const { rerender } = renderPinboard('s1');
    // Ctrl-add s2
    clickCard('s2', { ctrl: true });
    expect(cardIsSelected['s1']).toBe(true);
    expect(cardIsSelected['s2']).toBe(true);
    // Simulate the parent echoing the primary back (the common case after onSelectScene).
    act(() => {
      // same primary that was already set by the internal Ctrl+click
      rerender({ primarySelectedSceneId: 's2' });
    });
    // Selection must still include both s1 and s2.
    expect(cardIsSelected['s1']).toBe(true);
    expect(cardIsSelected['s2']).toBe(true);
  });

  // ── Lasso drag selects intersecting cards ────────────────────────────────

  it('lasso drag over canvas selects cards within the dragged rectangle', () => {
    const { container, onSelectScene } = renderPinboard();
    onSelectScene.mockClear();

    const canvas = container.querySelector<HTMLElement>(
      '[data-testid="pinboard-canvas"]'
    );
    if (!canvas) {
      throw new Error('Canvas element not found');
    }

    // Stub getBoundingClientRect so coordinate math is predictable.
    const outerContainer = canvas.parentElement!;
    vi.spyOn(outerContainer, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    act(() => {
      // Mousedown at (0,0) on the canvas background
      canvas.dispatchEvent(
        makePointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 })
      );
      // Drag to (250, 150) — crosses s1 (x=0,w=192) and s2 (x=200,w=192).
      // s3 is at x=400, so it stays outside.
      document.dispatchEvent(
        makeMouseEvent('mousemove', { clientX: 250, clientY: 150 })
      );
      document.dispatchEvent(makeMouseEvent('mouseup', { clientX: 250, clientY: 150 }));
    });

    expect(cardIsSelected['s1']).toBe(true);
    expect(cardIsSelected['s2']).toBe(true);
    expect(cardIsSelected['s3']).toBe(false);
    expect(onSelectScene).toHaveBeenCalledWith('s1');
  });

  it('Ctrl+lasso drag adds to existing selection', () => {
    const { container, onSelectScene } = renderPinboard('s3');
    onSelectScene.mockClear();

    const canvas = container.querySelector<HTMLElement>(
      '[data-testid="pinboard-canvas"]'
    );
    if (!canvas) {
      throw new Error('Canvas element not found');
    }

    const outerContainer = canvas.parentElement!;
    vi.spyOn(outerContainer, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    act(() => {
      canvas.dispatchEvent(
        makePointerEvent('pointerdown', {
          clientX: 0,
          clientY: 0,
          button: 0,
          ctrlKey: true,
        })
      );
      document.dispatchEvent(
        makeMouseEvent('mousemove', { clientX: 250, clientY: 150 })
      );
      document.dispatchEvent(makeMouseEvent('mouseup', { clientX: 250, clientY: 150 }));
    });

    // s1 and s2 added via lasso; s3 was pre-selected
    expect(cardIsSelected['s1']).toBe(true);
    expect(cardIsSelected['s2']).toBe(true);
    expect(cardIsSelected['s3']).toBe(true);
    // onSelectScene still called with the first card in the lasso
    expect(onSelectScene).toHaveBeenCalledWith('s1');
  });

  // ── onSelectionChange fires with full set ────────────────────────────────

  it('Ctrl+click two cards fires onSelectionChange with both ids', () => {
    const { onSelectionChange } = renderPinboard('s1');
    onSelectionChange.mockClear();

    clickCard('s2', { ctrl: true });

    // Last call should include both s1 and s2
    const lastCallArg: ReadonlySet<string> =
      onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1][0];
    expect(lastCallArg.has('s1')).toBe(true);
    expect(lastCallArg.has('s2')).toBe(true);
    expect(lastCallArg.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// PinboardView — cardHeights wiring
// ---------------------------------------------------------------------------

describe('PinboardView — cardHeights wiring', () => {
  beforeEach(() => {
    Object.keys(cardSelectHandlers).forEach(
      (k: string) => delete cardSelectHandlers[k]
    );
    Object.keys(cardIsSelected).forEach((k: string) => delete cardIsSelected[k]);
    Object.keys(cardLayoutHandlers).forEach(
      (k: string) => delete cardLayoutHandlers[k]
    );
    lastArrowsCardHeights = null;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('passes onLayout to every rendered SceneCard', () => {
    renderPinboard(null, scenes);
    for (const s of scenes) {
      expect(typeof cardLayoutHandlers[s.id]).toBe('function');
    }
  });

  it('passes cardHeights map to CauseArrows on initial render', () => {
    renderPinboard();
    expect(lastArrowsCardHeights).toBeInstanceOf(Map);
  });

  it('updates cardHeights when onLayout is called by a card', () => {
    renderPinboard(null, scenes);

    // Simulate the SceneCard reporting its height via onLayout
    act(() => {
      cardLayoutHandlers['s1']?.('s1', 120);
    });

    expect(lastArrowsCardHeights?.get('s1')).toBe(120);
  });

  it('does not re-render CauseArrows when same height is reported again (dedup)', () => {
    renderPinboard(null, scenes);

    act(() => {
      cardLayoutHandlers['s1']?.('s1', 80);
    });
    const heightsAfterFirst = lastArrowsCardHeights;

    act(() => {
      cardLayoutHandlers['s1']?.('s1', 80); // same value
    });
    // Map reference should be unchanged (identity preserved by the dedup guard)
    expect(lastArrowsCardHeights).toBe(heightsAfterFirst);
  });

  it('accumulates heights from multiple cards independently', () => {
    renderPinboard(null, scenes);

    act(() => {
      cardLayoutHandlers['s1']?.('s1', 64);
      cardLayoutHandlers['s2']?.('s2', 96);
    });

    expect(lastArrowsCardHeights?.get('s1')).toBe(64);
    expect(lastArrowsCardHeights?.get('s2')).toBe(96);
  });

  it('overwrites previous height when a card reports a new value', () => {
    renderPinboard(null, scenes);

    act(() => {
      cardLayoutHandlers['s1']?.('s1', 64);
    });
    act(() => {
      cardLayoutHandlers['s1']?.('s1', 128); // card grew
    });

    expect(lastArrowsCardHeights?.get('s1')).toBe(128);
  });
});
