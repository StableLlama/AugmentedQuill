// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for FloatingDiffToolbar — the universal hover-triggered
 * floating accept/reject toolbar that appears next to any diff region.
 */

// @vitest-environment jsdom

import React, { useRef } from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from 'vitest';
import i18n from '../app/i18n';
import {
  FloatingDiffToolbar,
  type FloatingDiffToolbarProps,
} from './FloatingDiffToolbar';

const wrap = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Test container that renders diff elements inside a tracked ref. */
function TestHarness({
  enabled = true,
  onAccept,
  onReject,
  onAcceptAll,
  showAcceptAll = false,
  diffHtml,
}: {
  enabled?: boolean;
  onAccept: FloatingDiffToolbarProps['onAccept'];
  onReject: FloatingDiffToolbarProps['onReject'];
  onAcceptAll?: () => void;
  showAcceptAll?: boolean;
  diffHtml: string;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div
        ref={containerRef}
        data-testid="diff-container"
        style={{ position: 'relative', minHeight: 200 }}
        dangerouslySetInnerHTML={{ __html: diffHtml }}
      />
      <FloatingDiffToolbar
        containerRef={containerRef}
        enabled={enabled}
        onAccept={onAccept}
        onReject={onReject}
        onAcceptAll={onAcceptAll}
        showAcceptAll={showAcceptAll}
      />
    </div>
  );
}

/** Simulate hovering over a specific element inside the container. */
function hoverElement(selector: string): void {
  const container = screen.getByTestId('diff-container');
  const el = container.querySelector(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  const rect = rectStore.get(selector) ?? el.getBoundingClientRect();
  const cx = Math.round(rect.left + rect.width / 2);
  const cy = Math.round(rect.top + rect.height / 2);

  // Register the element for elementFromPoint lookup.
  pointStore.set(`${cx},${cy}`, el);

  fireEvent.mouseMove(container, {
    clientX: cx,
    clientY: cy,
  });
}

/** Simulate moving mouse away from all diff elements. */
function hoverAway(): void {
  const container = screen.getByTestId('diff-container');
  fireEvent.mouseMove(container, { clientX: 0, clientY: 0 });
}

// ─── Polyfill elementFromPoint for jsdom ────────────────────────────────────
// jsdom doesn't implement elementFromPoint.  We provide a minimal polyfill
// that delegates to our pointStore map.

let pointStore: Map<string, Element | null>;

beforeAll(() => {
  if (!('elementFromPoint' in document)) {
    Object.defineProperty(document, 'elementFromPoint', {
      value: (x: number, y: number): Element | null => {
        const key = `${Math.round(x)},${Math.round(y)}`;
        return pointStore?.get(key) ?? null;
      },
      writable: true,
      configurable: true,
    });
  }
});

// ─── Mock getBoundingClientRect ─────────────────────────────────────────────
// jsdom doesn't do layout, so we mock bounding rects.

let rectStore: Map<string, DOMRect>;

beforeEach(() => {
  rectStore = new Map();
  pointStore = new Map();
  const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element
  ) {
    const key =
      (this as HTMLElement).getAttribute('data-rect-key') ??
      (this as HTMLElement).className;
    if (rectStore.has(key)) {
      return rectStore.get(key)!;
    }
    return origGetBoundingClientRect.call(this);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Ensure portal remnants are cleared from document.body.
  document.body.innerHTML = '';
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('FloatingDiffToolbar', () => {
  const makeRect = (
    top: number,
    height: number,
    left: number = 100,
    width: number = 200
  ): DOMRect => ({
    top,
    bottom: top + height,
    left,
    right: left + width,
    height,
    width,
    x: left,
    y: top,
    toJSON: (): object => ({}),
  });

  it('does not render when not hovering over a diff', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();

    wrap(
      <TestHarness
        onAccept={onAccept}
        onReject={onReject}
        diffHtml='<span class="cm-diff-inserted">changed</span>'
      />
    );

    // Toolbar should not be visible initially — not in the container
    // and not in document.body either.
    const toolbarInDoc = document.body.querySelector('[role="toolbar"]');
    expect(toolbarInDoc).toBeNull();
  });

  it('renders when hovering over a cm-diff-inserted element', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    rectStore.set('cm-diff-inserted', makeRect(50, 20));

    wrap(
      <TestHarness
        onAccept={onAccept}
        onReject={onReject}
        diffHtml='<span class="cm-diff-inserted">changed text</span>'
      />
    );

    hoverElement('.cm-diff-inserted');

    expect(screen.getByLabelText('Accept change')).toBeTruthy();
    expect(screen.getByLabelText('Reject change')).toBeTruthy();
  });

  it('renders when hovering over a cm-diff-deleted element', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    rectStore.set('cm-diff-deleted', makeRect(80, 20));

    wrap(
      <TestHarness
        onAccept={onAccept}
        onReject={onReject}
        diffHtml='<span class="cm-diff-deleted">removed</span>'
      />
    );

    hoverElement('.cm-diff-deleted');

    expect(screen.getByLabelText('Accept change')).toBeTruthy();
  });

  it('renders when hovering over a data-diff element', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    rectStore.set('diff-row', makeRect(100, 30));

    wrap(
      <TestHarness
        onAccept={onAccept}
        onReject={onReject}
        diffHtml='<div data-diff="changed" class="diff-row">section diff</div>'
      />
    );

    hoverElement('[data-diff="changed"]');

    expect(screen.getByLabelText('Accept change')).toBeTruthy();
  });

  it('hides toolbar when mouse moves away from diff', async () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    rectStore.set('cm-diff-inserted', makeRect(50, 20));

    wrap(
      <TestHarness
        onAccept={onAccept}
        onReject={onReject}
        diffHtml='<span class="cm-diff-inserted">text</span>'
      />
    );

    hoverElement('.cm-diff-inserted');
    expect(screen.getByLabelText('Accept change')).toBeTruthy();

    // Move away — toolbar should disappear after a brief delay
    hoverAway();

    await act(async () => {
      await new Promise((r: (value: unknown) => void) => setTimeout(r, 300));
    });

    expect(screen.queryByLabelText('Accept change')).toBeNull();
  });

  it('calls onAccept with the diff element when accept is clicked', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    rectStore.set('cm-diff-inserted', makeRect(50, 20));

    wrap(
      <TestHarness
        onAccept={onAccept}
        onReject={onReject}
        diffHtml='<span class="cm-diff-inserted" id="diff-1">changed</span>'
      />
    );

    hoverElement('.cm-diff-inserted');
    fireEvent.click(screen.getByLabelText('Accept change'));

    expect(onAccept).toHaveBeenCalledTimes(1);
    const calledWith = onAccept.mock.calls[0][0] as HTMLElement;
    expect(calledWith.id).toBe('diff-1');
  });

  it('calls onReject with the diff element when reject is clicked', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    rectStore.set('cm-diff-deleted', makeRect(50, 20));

    wrap(
      <TestHarness
        onAccept={onAccept}
        onReject={onReject}
        diffHtml='<span class="cm-diff-deleted" id="diff-2">old</span>'
      />
    );

    hoverElement('.cm-diff-deleted');
    fireEvent.click(screen.getByLabelText('Reject change'));

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject.mock.calls[0][0].id).toBe('diff-2');
  });

  it('shows accept-all button when showAcceptAll is true', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onAcceptAll = vi.fn();
    rectStore.set('cm-diff-inserted', makeRect(50, 20));

    wrap(
      <TestHarness
        onAccept={onAccept}
        onReject={onReject}
        onAcceptAll={onAcceptAll}
        showAcceptAll={true}
        diffHtml='<span class="cm-diff-inserted">text</span>'
      />
    );

    hoverElement('.cm-diff-inserted');
    expect(screen.getByLabelText('Accept all changes')).toBeTruthy();
  });

  it('does not render when enabled is false', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    rectStore.set('cm-diff-inserted', makeRect(50, 20));

    wrap(
      <TestHarness
        enabled={false}
        onAccept={onAccept}
        onReject={onReject}
        diffHtml='<span class="cm-diff-inserted">text</span>'
      />
    );

    hoverElement('.cm-diff-inserted');
    expect(screen.queryByLabelText('Accept change')).toBeNull();
  });

  it('positions toolbar near the hovered diff element', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    rectStore.set('cm-diff-inserted', makeRect(120, 20, 300, 150));

    wrap(
      <TestHarness
        onAccept={onAccept}
        onReject={onReject}
        diffHtml='<span class="cm-diff-inserted">text</span>'
      />
    );

    hoverElement('.cm-diff-inserted');

    const toolbar = screen.getByRole('toolbar', { name: 'Diff actions' });
    // Position should be fixed (via Tailwind class) and near the element
    expect(toolbar.className).toContain('fixed');
    // top should be at or above the element (toolbar appears above the diff)
    expect(parseFloat(toolbar.style.top)).toBeLessThanOrEqual(130);
  });

  it('clamps toolbar to viewport when diff is near edges', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    // Diff element at the very top of viewport
    rectStore.set('cm-diff-inserted', makeRect(0, 20, 50, 100));

    wrap(
      <TestHarness
        onAccept={onAccept}
        onReject={onReject}
        diffHtml='<span class="cm-diff-inserted">top edge</span>'
      />
    );

    hoverElement('.cm-diff-inserted');

    const toolbar = screen.getByRole('toolbar', { name: 'Diff actions' });
    const top = parseFloat(toolbar.style.top);
    // Should not go below 0
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it('applies dark theme classes when isLight is false', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    rectStore.set('cm-diff-inserted', makeRect(50, 20));

    function DarkHarness(): React.ReactElement {
      const containerRef = useRef<HTMLDivElement>(null);
      return (
        <div>
          <div
            ref={containerRef}
            data-testid="diff-container"
            style={{ position: 'relative', minHeight: 200 }}
            dangerouslySetInnerHTML={{
              __html: '<span class="cm-diff-inserted">dark text</span>',
            }}
          />
          <FloatingDiffToolbar
            containerRef={containerRef}
            enabled={true}
            isLight={false}
            onAccept={onAccept}
            onReject={onReject}
          />
        </div>
      );
    }

    wrap(<DarkHarness />);

    hoverElement('.cm-diff-inserted');

    const toolbar = screen.getByRole('toolbar', { name: 'Diff actions' });
    // Dark theme: should have dark background and border classes
    expect(toolbar.className).toContain('bg-brand-gray-900');
    expect(toolbar.className).toContain('border-brand-gray-800');
    // Should NOT have light classes
    expect(toolbar.className).not.toContain('bg-white');
    expect(toolbar.className).not.toContain('border-brand-gray-200');

    // Accept button should have dark theme classes
    const acceptBtn = screen.getByLabelText('Accept change');
    expect(acceptBtn.className).toContain('text-green-400');
    expect(acceptBtn.className).not.toContain('text-green-600');

    // Reject button should have dark theme classes
    const rejectBtn = screen.getByLabelText('Reject change');
    expect(rejectBtn.className).toContain('text-red-400');
    expect(rejectBtn.className).not.toContain('text-red-600');
  });

  it('applies light theme classes by default when isLight is not specified', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    rectStore.set('cm-diff-inserted', makeRect(50, 20));

    wrap(
      <TestHarness
        onAccept={onAccept}
        onReject={onReject}
        diffHtml='<span class="cm-diff-inserted">light text</span>'
      />
    );

    hoverElement('.cm-diff-inserted');

    const toolbar = screen.getByRole('toolbar', { name: 'Diff actions' });
    // Default light theme: should have light background and border classes
    expect(toolbar.className).toContain('bg-white');
    expect(toolbar.className).toContain('border-brand-gray-200');

    // Accept button should have light theme classes
    const acceptBtn = screen.getByLabelText('Accept change');
    expect(acceptBtn.className).toContain('text-green-600');
  });
});
