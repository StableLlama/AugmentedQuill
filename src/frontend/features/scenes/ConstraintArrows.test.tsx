// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for ConstraintArrows — covers:
 *  - borderExit geometry (unit-level: exact border snapping, normals, edge cases)
 *  - CauseArrows component rendering: no output when nothing to draw,
 *    active-scene arrows (red causes, green effects), inactive default arrows,
 *    ghost arrow rendering, cardHeights prop usage.
 */

// @vitest-environment jsdom

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { borderExit, CauseArrows } from './ConstraintArrows';
import type { ScenePositions, GhostArrow } from './ConstraintArrows';
import type { Scene } from '../../types';

vi.mock('../layout/ThemeContext', () => ({
  useTheme: vi.fn(() => ({ isLight: true })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CARD_W = 192;
const CARD_H = 80;

/** Minimal Scene stub with cause fields. */
function makeScene(
  id: string,
  x: number,
  y: number,
  overrides: Record<string, unknown> = {}
): Scene {
  const legacy = overrides as {
    causes?: SceneId[];
    [key: string]: unknown;
  };
  return {
    id,
    title: id,
    summary: id,
    pinboard_x: x,
    pinboard_y: y,
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

function emptyHeights(): Map<string, number> {
  return new Map();
}

// ---------------------------------------------------------------------------
// borderExit — geometry unit tests
// ---------------------------------------------------------------------------

describe('borderExit — axis-aligned exits', () => {
  // Card at (0,0), 100×80. Centre = (50, 40).

  it('exits the right edge when target is directly to the right', () => {
    const result = borderExit(0, 0, 100, 80, 200, 40);
    expect(result.x).toBeCloseTo(100, 5); // right edge
    expect(result.y).toBeCloseTo(40, 5); // centre height
    expect(result.nx).toBe(1);
    expect(result.ny).toBe(0);
  });

  it('exits the left edge when target is directly to the left', () => {
    const result = borderExit(0, 0, 100, 80, -100, 40);
    expect(result.x).toBeCloseTo(0, 5); // left edge
    expect(result.y).toBeCloseTo(40, 5);
    expect(result.nx).toBe(-1);
    expect(result.ny).toBe(0);
  });

  it('exits the bottom edge when target is directly below', () => {
    const result = borderExit(0, 0, 100, 80, 50, 200);
    expect(result.x).toBeCloseTo(50, 5); // centre width
    expect(result.y).toBeCloseTo(80, 5); // bottom edge
    expect(result.nx).toBe(0);
    expect(result.ny).toBe(1);
  });

  it('exits the top edge when target is directly above', () => {
    const result = borderExit(0, 0, 100, 80, 50, -100);
    expect(result.x).toBeCloseTo(50, 5);
    expect(result.y).toBeCloseTo(0, 5); // top edge
    expect(result.nx).toBe(0);
    expect(result.ny).toBe(-1);
  });
});

describe('borderExit — diagonal exits', () => {
  // Card (0,0), 100×80, aspect ratio 100/80 = 1.25.
  // Target at 45° means dx===dy in screen pixels.
  // Ray hits right edge if dx/hw > dy/hh i.e. dx/50 > dy/40 → dx/dy > 1.25.
  // At exact 45° (dx=dy), right edge wins: 50/40 > 1 → no, hh/hw = 40/50 = 0.8,
  // so at 45° tx = 50/dx and ty = 40/dx, ty < tx → bottom edge.

  it('exits bottom edge on a 45° downward-right ray (tall card)', () => {
    // dx = dy = 1000 (45° from centre of 100×80 card)
    const result = borderExit(0, 0, 100, 80, 1050, 1040);
    // Bottom edge y=80, normal (0,1)
    expect(result.y).toBeCloseTo(80, 5);
    expect(result.nx).toBe(0);
    expect(result.ny).toBe(1);
  });

  it('exits right edge on a shallow angle (nearly horizontal)', () => {
    // dx very large, dy small → right edge
    const result = borderExit(0, 0, 100, 80, 1050, 45); // dy=5 from centre (40+5=45)
    expect(result.x).toBeCloseTo(100, 5);
    expect(result.nx).toBe(1);
    expect(result.ny).toBe(0);
  });
});

describe('borderExit — exit point is exactly on the border', () => {
  it('right-exit x equals cardX + cardW', () => {
    const result = borderExit(10, 20, CARD_W, CARD_H, 500, 20 + CARD_H / 2);
    expect(result.x).toBeCloseTo(10 + CARD_W, 5);
  });

  it('left-exit x equals cardX', () => {
    const result = borderExit(10, 20, CARD_W, CARD_H, -500, 20 + CARD_H / 2);
    expect(result.x).toBeCloseTo(10, 5);
  });

  it('bottom-exit y equals cardY + cardH', () => {
    const result = borderExit(10, 20, CARD_W, CARD_H, 10 + CARD_W / 2, 500);
    expect(result.y).toBeCloseTo(20 + CARD_H, 5);
  });

  it('top-exit y equals cardY', () => {
    const result = borderExit(10, 20, CARD_W, CARD_H, 10 + CARD_W / 2, -500);
    expect(result.y).toBeCloseTo(20, 5);
  });

  it('exit point always lies on the border for random-ish angles', () => {
    const angles = [10, 30, 60, 120, 150, 200, 250, 310];
    for (const deg of angles) {
      const rad = (deg * Math.PI) / 180;
      const targetX = 50 + Math.cos(rad) * 1000;
      const targetY = 40 + Math.sin(rad) * 1000;
      const r = borderExit(0, 0, 100, 80, targetX, targetY);
      // The exit point must lie exactly on one of the four edges.
      const onLeft = Math.abs(r.x - 0) < 1e-9;
      const onRight = Math.abs(r.x - 100) < 1e-9;
      const onTop = Math.abs(r.y - 0) < 1e-9;
      const onBottom = Math.abs(r.y - 80) < 1e-9;
      expect(onLeft || onRight || onTop || onBottom).toBe(true);
    }
  });
});

describe('borderExit — degenerate case (same centre)', () => {
  it('returns the right-edge midpoint when target equals card centre', () => {
    // cardX=0, cardY=0, w=100, h=80 → centre=(50,40)
    const result = borderExit(0, 0, 100, 80, 50, 40);
    expect(result.x).toBeCloseTo(100, 5); // right edge
    expect(result.y).toBeCloseTo(40, 5); // vertical centre
    expect(result.nx).toBe(1);
    expect(result.ny).toBe(0);
  });
});

describe('borderExit — non-origin card position', () => {
  it('correctly handles a card that is not at the origin', () => {
    // Card at (200, 150), 100×80
    const result = borderExit(200, 150, 100, 80, 1000, 190);
    // target centre is to the right → exits right edge
    expect(result.x).toBeCloseTo(300, 5);
    expect(result.nx).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CauseArrows — component rendering
// ---------------------------------------------------------------------------

describe('CauseArrows — renders nothing when no arrows needed', () => {
  it('returns null when scenes array is empty', () => {
    const { container } = render(
      <CauseArrows
        scenes={[]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no active scene and no order relationships', () => {
    const s1 = makeScene('s1', 0, 0);
    const s2 = makeScene('s2', 300, 0);
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when active scene has no causes or effects', () => {
    const s1 = makeScene('s1', 0, 0);
    const { container } = render(
      <CauseArrows
        scenes={[s1]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId="s1"
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('CauseArrows — active scene arrows', () => {
  it('renders an SVG when active scene has a cause', () => {
    // s1 must come before s2 (s2.causes = [s1], s1.causes = [s2])
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 300, 0, { causes: ['s1'] });
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId="s2"
      />
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders a red path for a cause arrow (cause → active)', () => {
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 300, 0, { causes: ['s1'] });
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId="s2"
      />
    );
    const paths = container.querySelectorAll('path[stroke="#ef4444"]');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('renders a green path for an effect arrow (active → effect)', () => {
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 300, 0, { causes: ['s1'] });
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId="s1"
      />
    );
    const paths = container.querySelectorAll('path[stroke="#22c55e"]');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('renders both cause and effect arrows when active scene has both', () => {
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 300, 0, { causes: ['s1'], causes: ['s3'] });
    const s3 = makeScene('s3', 600, 0, { causes: ['s2'] });
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2, s3]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId="s2"
      />
    );
    expect(container.querySelectorAll('path[stroke="#ef4444"]').length).toBeGreaterThan(
      0
    );
    expect(container.querySelectorAll('path[stroke="#22c55e"]').length).toBeGreaterThan(
      0
    );
  });

  it('skips arrows for cause ids not present in the scenes array (invalid ref)', () => {
    const s1 = makeScene('s1', 0, 0, { causes: ['nonexistent'] });
    const { container } = render(
      <CauseArrows
        scenes={[s1]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId="s1"
      />
    );
    // No valid arrows → null
    expect(container.firstChild).toBeNull();
  });
});

describe('CauseArrows — no active scene (default arrows)', () => {
  it('renders an SVG for default arrows when causes is set', () => {
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 300, 0);
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId={null}
      />
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('skips arrows whose target is not in scenes (invalid causes id)', () => {
    const s1 = makeScene('s1', 0, 0, { causes: ['missing'] });
    const { container } = render(
      <CauseArrows
        scenes={[s1]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('CauseArrows — live positions override', () => {
  it('uses livePositions when available instead of stored position', () => {
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 0, 0); // same position as s1 — no arrow without live
    const livePositions: ScenePositions = new Map([
      ['s2', { x: 400, y: 0 }], // move s2 away
    ]);
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={livePositions}
        cardHeights={emptyHeights()}
        activeSceneId={null}
      />
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

describe('CauseArrows — cardHeights prop', () => {
  it('uses measured height for border intersection (path d attribute reflects height)', () => {
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 400, 200);

    const shortHeights = new Map([
      ['s1', 60],
      ['s2', 60],
    ]);
    const tallHeights = new Map([
      ['s1', 200],
      ['s2', 200],
    ]);

    const { container: c1 } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={shortHeights}
        activeSceneId={null}
      />
    );
    const { container: c2 } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={tallHeights}
        activeSceneId={null}
      />
    );

    // Arrow paths have fill="none"; marker paths have a fill color.
    const d1 = c1.querySelector('path[fill="none"]')?.getAttribute('d') ?? '';
    const d2 = c2.querySelector('path[fill="none"]')?.getAttribute('d') ?? '';
    // Different heights → different path coordinates
    expect(d1).not.toBe(d2);
  });

  it('falls back to DEFAULT_CARD_HEIGHT when id not in cardHeights', () => {
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 400, 0);
    // No heights provided — should not throw
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={new Map()}
        activeSceneId={null}
      />
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

describe('CauseArrows — ghost arrow', () => {
  it('renders a dashed ghost path when ghostArrow is provided (unconnected)', () => {
    const s1 = makeScene('s1', 0, 0);
    const ghost: GhostArrow = { fromId: 's1', toX: 300, toY: 150, connected: false };
    const { container } = render(
      <CauseArrows
        scenes={[s1]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId={null}
        ghostArrow={ghost}
      />
    );
    expect(container.querySelector('svg')).toBeTruthy();
    // Dashed stroke for unconnected ghost
    const dashed = container.querySelector('path[stroke-dasharray]');
    expect(dashed).toBeTruthy();
  });

  it('renders a solid green ghost path when connected', () => {
    const s1 = makeScene('s1', 0, 0);
    const ghost: GhostArrow = { fromId: 's1', toX: 300, toY: 150, connected: true };
    const { container } = render(
      <CauseArrows
        scenes={[s1]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId={null}
        ghostArrow={ghost}
      />
    );
    const greenPath = container.querySelector('path[stroke="#22c55e"]');
    expect(greenPath).toBeTruthy();
  });

  it('ignores ghost arrow when fromId is not in scenes', () => {
    const s1 = makeScene('s1', 0, 0);
    const ghost: GhostArrow = {
      fromId: 'missing',
      toX: 300,
      toY: 150,
      connected: false,
    };
    const { container } = render(
      <CauseArrows
        scenes={[s1]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId={null}
        ghostArrow={ghost}
      />
    );
    // No valid arrows at all → null
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when ghostArrow is null', () => {
    const s1 = makeScene('s1', 0, 0);
    const { container } = render(
      <CauseArrows
        scenes={[s1]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId={null}
        ghostArrow={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('CauseArrows — SVG marker attributes', () => {
  it('uses markerUnits=userSpaceOnUse so arrowhead size is stroke-width independent', () => {
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 400, 0);
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId={null}
      />
    );
    const marker = container.querySelector('marker');
    expect(marker?.getAttribute('markerUnits')).toBe('userSpaceOnUse');
  });

  it('has refX equal to markerWidth so tip aligns with path endpoint', () => {
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 400, 0);
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={emptyHeights()}
        activeSceneId={null}
      />
    );
    const markers = container.querySelectorAll('marker');
    markers.forEach((m: Element) => {
      expect(m.getAttribute('refX')).toBe(m.getAttribute('markerWidth'));
    });
  });
});

describe('CauseArrows — path endpoints at card borders', () => {
  it('path M (start) x-coordinate equals card right-edge when source is left of target', () => {
    // s1 at (0,0), target at (400,0) → s1 exits right edge at x=192
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 400, 0);
    const cardH = 80;
    const heights = new Map([
      ['s1', cardH],
      ['s2', cardH],
    ]);
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={heights}
        activeSceneId={null}
      />
    );
    const path = container.querySelector('path[fill="none"]');
    const d = path?.getAttribute('d') ?? '';
    // Path starts "M <x1> <y1> C ..."
    const match = /^M\s+([\d.]+)\s+([\d.]+)/.exec(d);
    expect(match).toBeTruthy();
    const x1 = parseFloat(match![1]);
    // s1 right edge = 0 + 192 = 192
    expect(x1).toBeCloseTo(192, 1);
  });

  it('path endpoint (x2) equals left edge of target card when target is to the right', () => {
    // s1 exits right edge → enters s2 left edge at x=400
    const s1 = makeScene('s1', 0, 0, { causes: ['s2'] });
    const s2 = makeScene('s2', 400, 0);
    const cardH = 80;
    const heights = new Map([
      ['s1', cardH],
      ['s2', cardH],
    ]);
    const { container } = render(
      <CauseArrows
        scenes={[s1, s2]}
        livePositions={new Map()}
        cardHeights={heights}
        activeSceneId={null}
      />
    );
    const path = container.querySelector('path[fill="none"]');
    const d = path?.getAttribute('d') ?? '';
    // Path ends "... <cp2x> <cp2y>, <x2> <y2>"
    const match = /([\d.]+)\s+([\d.]+)$/.exec(d.trim());
    expect(match).toBeTruthy();
    const x2 = parseFloat(match![1]);
    // s2 left edge = 400
    expect(x2).toBeCloseTo(400, 1);
  });
});
