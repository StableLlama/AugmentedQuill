// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the collapsible section.test unit so this responsibility stays isolated, testable, and easy to evolve.
 */

// @vitest-environment jsdom
/**
 * Tests for CollapsibleSection resize/drag behavior.
 *
 * Covers:
 * - Minimum height always accounts for drag handle visibility
 * - Drag follows mouse position accurately (RAF uses latest heightRef)
 * - Only the dragged section's height changes during resize
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
  within,
} from '@testing-library/react';
import { CollapsibleSection } from './CollapsibleSection';

afterEach((): void => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Helper: return a Partial<DOMRect> with defaults.
 */
function rect(overrides: Partial<DOMRect>): DOMRect {
  return {
    width: 200,
    height: 20,
    top: 0,
    left: 0,
    bottom: 20,
    right: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...overrides,
  } as DOMRect;
}

/**
 * Helper: create a controlled RAF mock so we can fire pending callbacks manually.
 */
function createRafController(): {
  rafSpy: ReturnType<typeof vi.spyOn>;
  flushRaf: () => void;
} {
  let pending: FrameRequestCallback | null = null;
  let nextId = 1;
  const rafSpy = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((cb: FrameRequestCallback): number => {
      pending = cb;
      return nextId++;
    });
  return {
    rafSpy,
    flushRaf: (): void => {
      const cb = pending;
      pending = null;
      if (cb) cb(performance.now());
    },
  };
}

describe('CollapsibleSection: drag handle visibility', () => {
  it('should use shrink-0 to prevent flex container from overriding explicit heights', () => {
    const { container } = render(
      <CollapsibleSection
        title="Test"
        isCollapsed={false}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={vi.fn()}
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    const section = container.firstChild as HTMLElement;
    expect(section.className).toContain('shrink-0');
    expect(section.className).not.toContain('flex-1');
  });

  it('should use flex-1 and shrink-0 when isLast is true', () => {
    const { container } = render(
      <CollapsibleSection
        title="Test"
        isCollapsed={false}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={vi.fn()}
        isLast
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    const section = container.firstChild as HTMLElement;
    expect(section.className).toContain('flex-1');
    expect(section.className).toContain('shrink-0');
  });

  it('should render the drag handle when isLast is false and not collapsed', () => {
    render(
      <CollapsibleSection
        title="Test"
        isCollapsed={false}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={vi.fn()}
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('should NOT render the drag handle when collapsed', () => {
    render(
      <CollapsibleSection
        title="Test"
        isCollapsed={true}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={vi.fn()}
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('should NOT render the drag handle when isLast is true', () => {
    render(
      <CollapsibleSection
        title="Test"
        isCollapsed={false}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={vi.fn()}
        isLast
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('should use overflow-y-auto on the content area so each section scrolls independently', () => {
    const { container } = render(
      <CollapsibleSection
        title="Test"
        isCollapsed={false}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={vi.fn()}
      >
        <div>Tall content that overflows the section</div>
      </CollapsibleSection>
    );

    // The content div is the flex-1 child that wraps children
    const section = container.firstChild as HTMLElement;
    const contentDiv = section.querySelector('.flex-1.overflow-y-auto') as HTMLElement;
    expect(contentDiv).toBeTruthy();
    expect(contentDiv.className).toContain('overflow-y-auto');
  });

  it('should NOT use overflow-hidden on the content area', () => {
    const { container } = render(
      <CollapsibleSection
        title="Test"
        isCollapsed={false}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={vi.fn()}
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    const section = container.firstChild as HTMLElement;
    const contentDiv = section.querySelector('.flex-1') as HTMLElement;
    expect(contentDiv).toBeTruthy();
    expect(contentDiv.className).not.toContain('overflow-hidden');
  });

  it('should still hide content area when collapsed', () => {
    render(
      <CollapsibleSection
        title="Test"
        isCollapsed={true}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={vi.fn()}
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    // Content div should not be in the DOM when collapsed
    const section = document.querySelector(
      '.flex.flex-col.overflow-hidden'
    ) as HTMLElement;
    const contentDiv = section?.querySelector('.flex-1') as HTMLElement;
    expect(contentDiv).toBeNull();
  });

  it('should never shrink the section below a minimum that includes drag handle space', () => {
    const onHeightChange = vi.fn();
    const { container } = render(
      <CollapsibleSection
        title="Test"
        isCollapsed={false}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={onHeightChange}
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    const section = container.firstChild as HTMLElement;
    const slider = screen.getByRole('slider');

    // Override getBoundingClientRect for the section
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 50, height: 200 })
    );

    const { flushRaf } = createRafController();

    // Start drag at bottom of section (Y=250)
    fireEvent.mouseDown(slider, { clientY: 250, button: 0 });
    flushRaf();

    // Drag far upward — would produce negative height if not clamped
    fireEvent.mouseMove(document, { clientY: 10 });
    flushRaf();

    // The section height must never go below header + drag handle height
    // minHeaderHeight = max(50, headerHeight) + 6 = 56 (with default 20px header)
    // After updateMinHeight fires, it's max(50, 20) + 6 = 56
    const appliedHeight = parseInt(section.style.height, 10);
    expect(appliedHeight).toBeGreaterThanOrEqual(56);

    // Release
    fireEvent.mouseUp(document);
  });
});

describe('CollapsibleSection: position accuracy (RAF uses latest heightRef)', () => {
  it('should set height based on the latest mousemove, not the first in an RAF window', () => {
    const onHeightChange = vi.fn();
    const { container } = render(
      <CollapsibleSection
        title="Test"
        isCollapsed={false}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={onHeightChange}
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    const section = container.firstChild as HTMLElement;
    const slider = screen.getByRole('slider');

    // Mock RAF so we can control when callbacks fire
    let rafCallbacks: Array<FrameRequestCallback> = [];
    let rafId = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      (cb: FrameRequestCallback): number => {
        rafCallbacks.push(cb);
        return rafId++;
      }
    );

    // Mock the section's getBoundingClientRect (top stays fixed at drag start)
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 100, height: 200 })
    );

    // Start drag at Y=300 (bottom of the 200px section starting at top=100)
    fireEvent.mouseDown(slider, { clientY: 300, button: 0 });

    // First mousemove: clientY=350 → height = 350-100 = 250
    // With sync-first apply: height should be 250 immediately
    fireEvent.mouseMove(document, { clientY: 350 });
    expect(parseInt(section.style.height, 10)).toBe(250);

    // Second mousemove BEFORE the first RAF fires: clientY=400 → heightRef=300
    fireEvent.mouseMove(document, { clientY: 400 });
    // Height still 250 (RAF hasn't fired yet for the throttle)
    expect(parseInt(section.style.height, 10)).toBe(250);

    // Now fire the pending RAF — should use latest heightRef.current=300
    act(() => {
      rafCallbacks[0](performance.now());
    });

    const appliedHeight = parseInt(section.style.height, 10);
    // Should be 300 (latest mousemove), not 250 (first mousemove)
    expect(appliedHeight).toBe(300);

    // Release
    fireEvent.mouseUp(document);
  });

  it('should apply height synchronously on first mousemove so section responds before RAF or mouseup', () => {
    const onHeightChange = vi.fn();
    const { container } = render(
      <CollapsibleSection
        title="Test"
        isCollapsed={false}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={onHeightChange}
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    const section = container.firstChild as HTMLElement;
    const slider = screen.getByRole('slider');

    // Mock RAF to capture but NOT fire
    let pendingRaf: FrameRequestCallback | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      (cb: FrameRequestCallback): number => {
        pendingRaf = cb;
        return 1;
      }
    );

    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 100, height: 200 })
    );

    // Start drag
    fireEvent.mouseDown(slider, { clientY: 300, button: 0 });

    // Move mouse — section should move synchronously with the first mousemove
    fireEvent.mouseMove(document, { clientY: 350 });
    expect(parseInt(section.style.height, 10)).toBe(250);

    // Now release mouse BEFORE the RAF fires (simulating a fast click-drag-release)
    fireEvent.mouseUp(document);

    // Even though RAF was cancelled by stopResizing, the section was already
    // visually updated by the synchronous applyHeight on the first mousemove.
    // And onHeightChange should have been called with the latest heightRef.
    expect(onHeightChange).toHaveBeenCalledWith(250);
  });
});

describe('CollapsibleSection: maxHeight constraint', () => {
  it('should cap drag height at maxHeight during drag (not just on mouseup)', () => {
    const onHeightChange = vi.fn();
    const { container } = render(
      <CollapsibleSection
        title="Test"
        isCollapsed={false}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={onHeightChange}
        maxHeight={300}
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    const section = container.firstChild as HTMLElement;
    const slider = screen.getByRole('slider');

    const { flushRaf } = createRafController();

    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 100, height: 200 })
    );

    // Start drag
    fireEvent.mouseDown(slider, { clientY: 300, button: 0 });
    flushRaf();

    // Drag to 350px (clientY=450 → height=350) — above max 300, should be capped
    fireEvent.mouseMove(document, { clientY: 450 });
    flushRaf();
    expect(parseInt(section.style.height, 10)).toBe(300);

    // Drag to 500px — above max 300, should be capped
    fireEvent.mouseMove(document, { clientY: 600 });
    flushRaf();
    expect(parseInt(section.style.height, 10)).toBe(300);

    // Release — onHeightChange should receive clamped value
    fireEvent.mouseUp(document);
    expect(onHeightChange).toHaveBeenCalledWith(300);
  });

  it('should not cap when maxHeight is not provided', () => {
    const onHeightChange = vi.fn();
    const { container } = render(
      <CollapsibleSection
        title="Test"
        isCollapsed={false}
        onToggle={vi.fn()}
        height={200}
        onHeightChange={onHeightChange}
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    const section = container.firstChild as HTMLElement;
    const slider = screen.getByRole('slider');

    const { flushRaf } = createRafController();

    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 100, height: 200 })
    );

    fireEvent.mouseDown(slider, { clientY: 300, button: 0 });
    flushRaf();

    // Drag far beyond normal range — no max, so should work
    fireEvent.mouseMove(document, { clientY: 600 });
    flushRaf();
    expect(parseInt(section.style.height, 10)).toBe(500);

    fireEvent.mouseUp(document);
    expect(onHeightChange).toHaveBeenCalledWith(500);
  });
});

describe('CollapsibleSection: only dragged section changes height', () => {
  it('should not change other sections when dragging one section', () => {
    const onHeightChange1 = vi.fn();
    const onHeightChange2 = vi.fn();

    const { container } = render(
      <div style={{ display: 'flex', flexDirection: 'column', height: 600 }}>
        <CollapsibleSection
          title="Section A"
          isCollapsed={false}
          onToggle={vi.fn()}
          height={200}
          onHeightChange={onHeightChange1}
        >
          <div>A content</div>
        </CollapsibleSection>
        <CollapsibleSection
          title="Section B"
          isCollapsed={false}
          onToggle={vi.fn()}
          height={150}
          onHeightChange={onHeightChange2}
        >
          <div>B content</div>
        </CollapsibleSection>
      </div>
    );

    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(2);

    const sections = container.firstChild!.childNodes as NodeListOf<HTMLElement>;
    const sectionA = sections[0];
    const sectionB = sections[1];

    // Mock getBoundingClientRect for each section
    vi.spyOn(sectionA, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 0, height: 200 })
    );
    vi.spyOn(sectionB, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 200, height: 150 })
    );

    const { flushRaf } = createRafController();

    // Record initial heights
    const initialHeightB = sectionB.style.height;

    // Start dragging section A's slider
    fireEvent.mouseDown(sliders[0], { clientY: 200, button: 0 });
    flushRaf();

    // Move mouse down 50px
    fireEvent.mouseMove(document, { clientY: 250 });
    flushRaf();

    // Section A should have grown
    const heightA = parseInt(sectionA.style.height, 10);
    expect(heightA).toBeGreaterThan(200);

    // Section B should NOT have changed during drag
    expect(sectionB.style.height).toBe(initialHeightB);
    expect(onHeightChange2).not.toHaveBeenCalled();

    // Release
    fireEvent.mouseUp(document);
  });

  it('should not touch other sections when one section completes a resize via parent re-render', () => {
    // Simulates the real app: onHeightChange triggers setEditorSettings which
    // passes a new height ONLY to the resized section, re-rendering all sections.
    const onHeightChange2 = vi.fn();

    // Render with a parent component that manages heights via state
    function ParentContainer(): React.ReactElement {
      const [heightA, setHeightA] = React.useState(200);
      const [heightB] = React.useState(150);

      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: 600 }}>
          <CollapsibleSection
            title="Section A"
            isCollapsed={false}
            onToggle={vi.fn()}
            height={heightA}
            onHeightChange={(h: number): void => setHeightA(h)}
          >
            <div>A content</div>
          </CollapsibleSection>
          <CollapsibleSection
            title="Section B"
            isCollapsed={false}
            onToggle={vi.fn()}
            height={heightB}
            onHeightChange={onHeightChange2}
          >
            <div>B content</div>
          </CollapsibleSection>
        </div>
      );
    }

    const { container } = render(<ParentContainer />);

    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(2);

    const sections = container.firstChild!.childNodes as NodeListOf<HTMLElement>;
    const sectionA = sections[0];
    const sectionB = sections[1];

    vi.spyOn(sectionA, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 0, height: 200 })
    );
    vi.spyOn(sectionB, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 200, height: 150 })
    );

    const { flushRaf } = createRafController();

    // Record B's height before
    const heightBBefore = sectionB.style.height;

    // Start drag on A and complete it
    fireEvent.mouseDown(sliders[0], { clientY: 200, button: 0 });
    flushRaf();
    fireEvent.mouseMove(document, { clientY: 280 }); // grow to 280
    flushRaf();
    fireEvent.mouseUp(document); // triggers onHeightChange → setHeightA(280)

    // After the parent re-render with new heightA=280:
    // Section A should have the new height
    const heightAAfter = parseInt(sectionA.style.height, 10);
    expect(heightAAfter).toBe(280);

    // Section B should still have its original height
    expect(sectionB.style.height).toBe(heightBBefore);
    expect(onHeightChange2).not.toHaveBeenCalled();
  });
});
