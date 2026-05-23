// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for SceneCard — covers:
 *  - onLayout callback: called on mount with the card's offsetHeight
 *  - onLayout callback: called again when ResizeObserver fires
 *  - onLayout omitted: no error when prop is undefined
 *  - Visual state props: isActive/isCause/isEffect/isSelected class application
 *  - displayX/displayY override rendering position
 */

// @vitest-environment jsdom

import React from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../app/i18n';
import { SceneCard } from './SceneCard';
import type { Scene } from '../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../layout/ThemeContext', () => ({
  useTheme: vi.fn(() => ({ isLight: true })),
}));

// ---------------------------------------------------------------------------
// ResizeObserver stub
// ---------------------------------------------------------------------------

type ROCallback = (entries: ResizeObserverEntry[]) => void;

let observeTargets: Map<Element, ROCallback> = new Map();

class MockResizeObserver {
  private cb: ROCallback;
  constructor(cb: ROCallback) {
    this.cb = cb;
  }
  observe(el: Element): void {
    observeTargets.set(el, this.cb);
  }
  disconnect(): void {
    observeTargets.forEach((_: ROCallback, el: Element) => observeTargets.delete(el));
  }
}

/** Simulate a resize event on all observed elements. */
function triggerResize(): void {
  observeTargets.forEach((cb: ROCallback, el: Element) => {
    cb([{ target: el } as ResizeObserverEntry]);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScene(overrides: Record<string, unknown> = {}): Scene {
  const legacy = overrides as {
    causes?: SceneId[];
    [key: string]: unknown;
  };
  return {
    id: 'sc1',
    title: 'Test Scene',
    summary: 'A test scene',
    pinboard_x: 100,
    pinboard_y: 200,
    order_index: 0,
    prose_link: null,
    predecessor_ids: [],
    created_at: '',
    updated_at: '',
    beats: [],
    active_characters: [],
    passive_characters: [],
    location: null,
    time: null,
    color_tag: null,
    status: 'active',
    causes: [...(legacy.causes ?? [])],
    ...rest,
  } as Scene;
}

const NOOP = vi.fn();

function renderCard(
  scene: Scene,
  extra: { onLayout?: (id: string, h: number) => void } = {}
): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <SceneCard
        scene={scene}
        index={0}
        onDragMove={NOOP}
        onDragEnd={NOOP}
        onSelect={NOOP}
        onEdit={NOOP}
        onCauseDragStart={NOOP}
        onCauseDrop={NOOP}
        onCauseLeave={NOOP}
        isCauseTarget={false}
        isSelected={false}
        isActive={false}
        isCause={false}
        isEffect={false}
        onLayout={extra.onLayout}
      />
    </I18nextProvider>
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  observeTargets = new Map();
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// onLayout — initial mount
// ---------------------------------------------------------------------------

describe('SceneCard onLayout — mount', () => {
  it('calls onLayout with sceneId and offsetHeight on mount', () => {
    const onLayout = vi.fn();
    const scene = makeScene({ id: 'scene-42' });

    // jsdom returns 0 for offsetHeight by default, which is fine for unit tests.
    renderCard(scene, { onLayout });

    expect(onLayout).toHaveBeenCalledOnce();
    expect(onLayout).toHaveBeenCalledWith('scene-42', expect.any(Number));
  });

  it('does not throw when onLayout is not provided', () => {
    expect(() => renderCard(makeScene())).not.toThrow();
  });

  it('does not call onLayout when prop is undefined', () => {
    const onLayout = vi.fn();
    renderCard(makeScene()); // no onLayout
    expect(onLayout).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// onLayout — ResizeObserver
// ---------------------------------------------------------------------------

describe('SceneCard onLayout — ResizeObserver', () => {
  it('calls onLayout again when ResizeObserver fires', () => {
    const onLayout = vi.fn();
    renderCard(makeScene({ id: 'sc-resize' }), { onLayout });

    onLayout.mockClear();

    act(() => {
      triggerResize();
    });

    expect(onLayout).toHaveBeenCalledOnce();
    expect(onLayout).toHaveBeenCalledWith('sc-resize', expect.any(Number));
  });

  it('disconnects observer on unmount (no calls after unmount)', () => {
    const onLayout = vi.fn();
    const { unmount } = renderCard(makeScene({ id: 'sc-unmount' }), { onLayout });

    unmount();
    onLayout.mockClear();

    act(() => {
      triggerResize();
    });

    expect(onLayout).not.toHaveBeenCalled();
  });

  it('passes the scene id consistently to all onLayout calls', () => {
    const onLayout = vi.fn();
    renderCard(makeScene({ id: 'consistent-id' }), { onLayout });

    act(() => {
      triggerResize();
    });
    act(() => {
      triggerResize();
    });

    for (const call of onLayout.mock.calls) {
      expect(call[0]).toBe('consistent-id');
    }
  });
});

// ---------------------------------------------------------------------------
// Visual state props
// ---------------------------------------------------------------------------

describe('SceneCard — visual state class application', () => {
  it('applies isActive ring class when isActive is true', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <SceneCard
          scene={makeScene()}
          index={0}
          onDragMove={NOOP}
          onDragEnd={NOOP}
          onSelect={NOOP}
          onEdit={NOOP}
          onCauseDragStart={NOOP}
          onCauseDrop={NOOP}
          onCauseLeave={NOOP}
          isCauseTarget={false}
          isSelected={false}
          isActive={true}
          isCause={false}
          isEffect={false}
        />
      </I18nextProvider>
    );
    const card = container.querySelector('[data-scene-card]');
    expect(card?.className).toContain('ring-violet-400');
  });

  it('applies isCause ring class when isCause is true', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <SceneCard
          scene={makeScene()}
          index={0}
          onDragMove={NOOP}
          onDragEnd={NOOP}
          onSelect={NOOP}
          onEdit={NOOP}
          onCauseDragStart={NOOP}
          onCauseDrop={NOOP}
          onCauseLeave={NOOP}
          isCauseTarget={false}
          isSelected={false}
          isActive={false}
          isCause={true}
          isEffect={false}
        />
      </I18nextProvider>
    );
    const card = container.querySelector('[data-scene-card]');
    expect(card?.className).toContain('ring-red-500');
  });

  it('applies isEffect ring class when isEffect is true', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <SceneCard
          scene={makeScene()}
          index={0}
          onDragMove={NOOP}
          onDragEnd={NOOP}
          onSelect={NOOP}
          onEdit={NOOP}
          onCauseDragStart={NOOP}
          onCauseDrop={NOOP}
          onCauseLeave={NOOP}
          isCauseTarget={false}
          isSelected={false}
          isActive={false}
          isCause={false}
          isEffect={true}
        />
      </I18nextProvider>
    );
    const card = container.querySelector('[data-scene-card]');
    expect(card?.className).toContain('ring-green-500');
  });

  it('applies isCauseTarget ring when isCauseTarget is true', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <SceneCard
          scene={makeScene()}
          index={0}
          onDragMove={NOOP}
          onDragEnd={NOOP}
          onSelect={NOOP}
          onEdit={NOOP}
          onCauseDragStart={NOOP}
          onCauseDrop={NOOP}
          onCauseLeave={NOOP}
          isCauseTarget={true}
          isSelected={false}
          isActive={false}
          isCause={false}
          isEffect={false}
        />
      </I18nextProvider>
    );
    const card = container.querySelector('[data-scene-card]');
    expect(card?.className).toContain('ring-brand-500');
  });
});

describe('SceneCard — scene time indicator', () => {
  it('shows a scene time icon with story and international tooltip values', () => {
    const scene = makeScene({
      scene_time: {
        temporal_zoned_datetime: '2024-03-01T12:34:56+00:00[UTC][u-ca=gregory]',
      },
    });

    const { container } = renderCard(scene);
    const indicator = container.querySelector<HTMLElement>(
      '[data-scene-time-indicator]'
    );

    expect(indicator).toBeTruthy();
    expect(indicator?.getAttribute('title')).toContain('Story time:');
    expect(indicator?.getAttribute('title')).toContain('International:');
  });

  it('includes the scene id in the status dot tooltip and labels it as an ID', () => {
    const scene = makeScene({ id: 'scene-123' });
    const { container } = renderCard(scene);
    const statusDot = container.querySelector<HTMLElement>(
      '[data-scene-status-indicator]'
    );

    expect(statusDot).toBeTruthy();
    expect(statusDot?.getAttribute('title')).toContain('Scene status');
    expect(statusDot?.getAttribute('title')).toContain('ID');
    expect(statusDot?.getAttribute('title')).toContain('scene-123');
  });

  it('does not show a scene time icon for invalid temporal values', () => {
    const scene = makeScene({
      scene_time: { temporal_zoned_datetime: 'not-a-valid-temporal-value' },
    });

    const { container } = renderCard(scene);
    const indicator = container.querySelector('[data-scene-time-indicator]');
    expect(indicator).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// displayX / displayY
// ---------------------------------------------------------------------------

describe('SceneCard — displayX/displayY override', () => {
  it('uses scene.pinboard_x/y when no override provided', () => {
    const scene = makeScene({ pinboard_x: 100, pinboard_y: 200 });
    const { container } = renderCard(scene);
    const card = container.querySelector<HTMLElement>('[data-scene-card]');
    expect(card?.style.left).toBe('100px');
    expect(card?.style.top).toBe('200px');
  });

  it('uses displayX/displayY when provided', () => {
    const scene = makeScene({ pinboard_x: 100, pinboard_y: 200 });
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <SceneCard
          scene={scene}
          index={0}
          onDragMove={NOOP}
          onDragEnd={NOOP}
          onSelect={NOOP}
          onEdit={NOOP}
          onCauseDragStart={NOOP}
          onCauseDrop={NOOP}
          onCauseLeave={NOOP}
          isCauseTarget={false}
          isSelected={false}
          isActive={false}
          isCause={false}
          isEffect={false}
          displayX={50}
          displayY={75}
        />
      </I18nextProvider>
    );
    const card = container.querySelector<HTMLElement>('[data-scene-card]');
    expect(card?.style.left).toBe('50px');
    expect(card?.style.top).toBe('75px');
  });
});
