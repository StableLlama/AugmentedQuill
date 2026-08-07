// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Full-browser E2E tests for scene boundary drag UX.
 *
 * The drag itself is the COSTLY part of each test (a full
 * frontend → backend → store → render roundtrip), so once it is done we run
 * as many CHEAP assertions as possible against BOTH the stored file and the
 * on-screen display, verifying that every interaction does exactly what we
 * expect:
 *
 *   FILE:
 *     - no prose is ever lost (stripped content unchanged),
 *     - scene markers are balanced, ordered and non-overlapping,
 *     - markers the drag must NOT touch stay at their exact pristine offset,
 *     - adjacent scenes share a single file boundary,
 *     - every annotation survives and still covers the same visible text,
 *     - an annotation fully inside a scene keeps its raw markers inside that
 *       scene (no annotation/scene marker reordering).
 *   DISPLAY:
 *     - the editor's visible text equals the file's stripped text,
 *     - annotation highlights are rendered,
 *     - boundary handles moved in the expected direction and stay aligned.
 *
 * Some of these assertions FAIL against the current code (they document real
 * bugs in the scene-boundary ↔ annotation coordinate system).  That is
 * intentional — do not fix them here.
 *
 * Seeded project (`e2e-boundary-test`, see playwright.fullstack.config.ts):
 *   Visible: "SceneThirteenSceneFourteenSceneSixteen_"
 *     scene 13 -> [0, 13)   scene 14 -> [13, 26)   scene 16 -> [26, 39)
 *     e2e-anno-1 "Scene" [0,5)  e2e-anno-2 "teen" [9,13)  e2e-anno-3 "Sixteen_" [31,39)
 *
 * Run with: npx playwright test --config=playwright.fullstack.config.ts
 */

import { test, expect, type Page } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const FRONTEND = 'http://127.0.0.1:18001';
const BACKEND = 'http://127.0.0.1:18000';
const PROJECT = 'e2e-boundary-test';

const FULL_CONTENT = 'SceneThirteenSceneFourteenSceneSixteen_';

// Pristine marker-inclusive content (matches the config seeding).
const PRISTINE_CONTENT =
  '<!--scene:13:start--><!--annotation:e2e-anno-1:start-->Scene<!--annotation:e2e-anno-1:end-->Thir' +
  '<!--annotation:e2e-anno-2:start-->teen<!--annotation:e2e-anno-2:end--><!--scene:13:end-->' +
  '<!--scene:14:start-->SceneFourteen<!--scene:14:end-->' +
  '<!--scene:16:start-->Scene<!--annotation:e2e-anno-3:start-->Sixteen_<!--annotation:e2e-anno-3:end--><!--scene:16:end-->';

// ---------------------------------------------------------------------------
// Marker layout helpers (mirror the frontend's coordinate model)
// ---------------------------------------------------------------------------

const INTERNAL_MARKER_RE = /<!--(?:scene|annotation):[^:>]+:(?:start|end)-->/g;
const CAPTURE_MARKER_RE = /<!--(scene|annotation):([^:>]+):(start|end)-->/g;

function stripped(content: string): string {
  return content.replace(INTERNAL_MARKER_RE, '');
}

/** Raw (marker-inclusive) positions of every scene/annotation marker pair. */
function layout(content: string): {
  scene: Record<number, { start: number; end: number }>;
  anno: Record<string, { start: number; end: number }>;
} {
  const scene: Record<number, { start: number; end: number }> = {};
  const anno: Record<string, { start: number; end: number }> = {};
  const sceneOpen: Record<number, number> = {};
  const annoOpen: Record<string, number> = {};
  const re = new RegExp(CAPTURE_MARKER_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const layer = m[1] as 'scene' | 'annotation';
    const id = m[2];
    const edge = m[3] as 'start' | 'end';
    if (edge === 'start') {
      if (layer === 'scene') sceneOpen[Number(id)] = m.index + m[0].length;
      else annoOpen[id] = m.index + m[0].length;
    } else {
      if (layer === 'scene') {
        const key = Number(id);
        scene[key] = { start: sceneOpen[key], end: m.index };
        delete sceneOpen[key];
      } else {
        anno[id] = { start: annoOpen[id], end: m.index };
        delete annoOpen[id];
      }
    }
  }
  return { scene, anno };
}

/**
 * Convert a raw offset to the visible (marker-stripped) coordinate space.
 * A raw offset at a marker's start maps to the visible count of prose that
 * precedes that marker (markers are invisible, so their own length never
 * contributes).
 */
function toVisibleOffset(content: string, rawOffset: number): number {
  let visible = 0;
  let lastIndex = 0;
  const re = new RegExp(INTERNAL_MARKER_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const gap = m.index - lastIndex; // visible prose before this marker
    if (rawOffset <= lastIndex + gap) {
      // rawOffset sits in the prose before this marker (or exactly at it).
      return visible + Math.max(0, rawOffset - lastIndex);
    }
    if (rawOffset < m.index + m[0].length) {
      // rawOffset is strictly inside this marker.
      return visible + gap;
    }
    visible += gap;
    lastIndex = m.index + m[0].length;
  }
  return visible + Math.max(0, rawOffset - lastIndex);
}

/** Convert a raw [start, end) pair to its visible span. */
function visibleSpan(
  content: string,
  rawStart: number,
  rawEnd: number
): [number, number] {
  return [toVisibleOffset(content, rawStart), toVisibleOffset(content, rawEnd)];
}

// ---------------------------------------------------------------------------
// FILE verification helpers (collect violations; report all at once)
// ---------------------------------------------------------------------------

async function fetchChapter(request: APIRequestContext): Promise<string> {
  const resp = await request.get(`${BACKEND}/api/v1/projects/${PROJECT}/chapters/1`);
  if (!resp.ok()) {
    throw new Error(`GET chapter failed: ${resp.status()}`);
  }
  const data = (await resp.json()) as { content: string };
  return data.content;
}

/** The drag must never alter a single visible character. */
function noProseLossViolations(content: string): string[] {
  const s = stripped(content);
  return s === FULL_CONTENT
    ? []
    : [`visible prose changed to "${s}" (expected "${FULL_CONTENT}")`];
}

/**
 * Scene markers: exactly the expected scenes are present, each has exactly one
 * start/end pair, ordered and non-overlapping; absent scenes have no markers.
 */
function sceneMarkerViolations(content: string, presentScenes: number[]): string[] {
  const v: string[] = [];
  const present = new Set(presentScenes);
  const L = layout(content);
  for (const id of [13, 14, 16]) {
    const count =
      content.match(new RegExp(`<!--scene:${id}:(start|end)-->`, 'g'))?.length ?? 0;
    if (present.has(id)) {
      if (count !== 2) {
        v.push(`scene ${id} has ${count} markers (expected 2)`);
      } else if (!L.scene[id]) {
        v.push(`scene ${id} layout missing`);
      } else if (L.scene[id].start >= L.scene[id].end) {
        v.push(`scene ${id} start (${L.scene[id].start}) >= end (${L.scene[id].end})`);
      }
    } else if (count !== 0) {
      v.push(`unlinked scene ${id} must have no markers (found ${count})`);
    }
  }
  // Adjacent present scenes are ordered and non-overlapping (end token before next start token).
  const ordered = presentScenes.slice().sort((a: number, b: number): number => a - b);
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const leftEnd = content.indexOf(`<!--scene:${ordered[i]}:end-->`);
    const rightStart = content.indexOf(`<!--scene:${ordered[i + 1]}:start-->`);
    if (leftEnd < 0) {
      v.push(`scene ${ordered[i]} end marker missing`);
    } else if (leftEnd + `<!--scene:${ordered[i]}:end-->`.length > rightStart) {
      v.push(`scene ${ordered[i]} end after scene ${ordered[i + 1]} start (overlap)`);
    }
  }
  return v;
}

/**
 * Annotations: each expected annotation is balanced and still covers the same
 * visible text as in the pristine file (a drag must never grow/shrink or move
 * an annotation's covered text).
 */
function annotationsPreservedViolations(
  content: string,
  expectedAnnos: string[] = ['e2e-anno-1', 'e2e-anno-2', 'e2e-anno-3']
): string[] {
  const v: string[] = [];
  const pristine = layout(PRISTINE_CONTENT);
  const L = layout(content);
  for (const id of expectedAnnos) {
    if (!L.anno[id]) {
      v.push(`anno ${id} missing`);
      continue;
    }
    if (L.anno[id].start >= L.anno[id].end) {
      v.push(`anno ${id} start (${L.anno[id].start}) >= end (${L.anno[id].end})`);
      continue;
    }
    const before = visibleSpan(
      PRISTINE_CONTENT,
      pristine.anno[id].start,
      pristine.anno[id].end
    );
    const after = visibleSpan(content, L.anno[id].start, L.anno[id].end);
    if (after[0] !== before[0] || after[1] !== before[1]) {
      v.push(
        `anno ${id} visible span [${after[0]},${after[1]}) changed from [${before[0]},${before[1]})`
      );
    }
  }
  return v;
}

/**
 * Nesting invariant: if an annotation's visible span lies fully inside a
 * scene's visible span, its raw markers must also lie inside that scene's raw
 * span.  A drag must never push an annotation's end marker past its own
 * scene's end marker (the reported reorder bug).
 */
function annotationNestingViolations(content: string): string[] {
  const v: string[] = [];
  const L = layout(content);
  for (const sceneId of Object.keys(L.scene)) {
    const s = L.scene[Number(sceneId)];
    const [sVisStart, sVisEnd] = visibleSpan(content, s.start, s.end);
    for (const annId of Object.keys(L.anno)) {
      const a = L.anno[annId];
      const [aVisStart, aVisEnd] = visibleSpan(content, a.start, a.end);
      if (aVisStart >= sVisStart && aVisEnd <= sVisEnd) {
        if (!(a.start >= s.start && a.end <= s.end)) {
          v.push(
            `anno ${annId} raw markers [${a.start},${a.end}) outside scene ${sceneId} [${s.start},${s.end}) although its visible span [${aVisStart},${aVisEnd}) lies inside scene ${sceneId} [${sVisStart},${sVisEnd})`
          );
        }
      }
    }
  }
  return v;
}

/**
 * Markers that the drag must NOT touch stay at their exact pristine offsets.
 */
function fixedMarkerViolations(content: string, fixedTokens: string[]): string[] {
  const v: string[] = [];
  for (const token of fixedTokens) {
    const got = content.indexOf(token);
    const expected = PRISTINE_CONTENT.indexOf(token);
    if (got !== expected) {
      v.push(`fixed marker ${token} at ${got} (expected ${expected})`);
    }
  }
  return v;
}

/**
 * Adjacent scenes share a single file boundary (end token, then start token).
 */
function fileBoundaryAlignmentViolations(
  content: string,
  pairs: Array<[number, number]>
): string[] {
  const v: string[] = [];
  for (const [left, right] of pairs) {
    const leftEnd = content.indexOf(`<!--scene:${left}:end-->`);
    const rightStart = content.indexOf(`<!--scene:${right}:start-->`);
    if (leftEnd < 0 || rightStart < 0) continue; // one side unlinked — N/A
    if (leftEnd + `<!--scene:${left}:end-->`.length !== rightStart) {
      v.push(`scene ${left} end and scene ${right} start are not adjacent in the file`);
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// DISPLAY verification helpers (collect violations)
// ---------------------------------------------------------------------------

/** The editor shows exactly the file's stripped content. */
async function displayViolations(page: Page, content: string): Promise<string[]> {
  const v: string[] = [];
  const editorText = (await page.locator('.cm-content').first().innerText()) ?? '';
  const strippedFile = stripped(content);
  if (editorText !== strippedFile) {
    v.push(`editor shows "${editorText}" but file strips to "${strippedFile}"`);
  }
  const texts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-annotation-range')).map(
      (el: Element) => el.textContent ?? ''
    )
  );
  for (const expected of ['Scene', 'teen', 'Sixteen_']) {
    if (!texts.includes(expected)) {
      v.push(`annotation highlight "${expected}" not rendered`);
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// Project reset (per-test isolation)
// ---------------------------------------------------------------------------

const PRE_SEEDED_ANNOS = ['e2e-anno-1', 'e2e-anno-2', 'e2e-anno-3'];

/**
 * Restore the project to its pristine seeded state via the API.  A single PUT
 * of the pristine chapter content fully resets the coordinate state: scene
 * prose ranges are never persisted (they are re-derived from content markers
 * on every load) and annotation offsets are also re-derived from markers.
 * We additionally delete any stray annotation records that are not part of
 * the pre-seeded set (defensive; drags never create/delete annotations).
 */
async function resetProject(request: APIRequestContext): Promise<void> {
  const put = await request.put(
    `${BACKEND}/api/v1/projects/${PROJECT}/chapters/1/content`,
    { data: { content: PRISTINE_CONTENT } }
  );
  if (!put.ok()) {
    throw new Error(`Reset chapter content failed: ${put.status()}`);
  }
  const annsResp = await request.get(
    `${BACKEND}/api/v1/projects/${PROJECT}/annotations`
  );
  if (!annsResp.ok()) {
    throw new Error(`GET annotations failed: ${annsResp.status()}`);
  }
  const anns = (await annsResp.json()) as Array<{ id: string }>;
  for (const ann of anns) {
    if (PRE_SEEDED_ANNOS.includes(ann.id)) continue;
    await request.delete(
      `${BACKEND}/api/v1/projects/${PROJECT}/annotations/${encodeURIComponent(ann.id)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Drag helpers
// ---------------------------------------------------------------------------

function installConsoleErrorCollector(page: Page): () => string[] {
  const errors: string[] = [];
  const handler = (msg: { type: () => string; text: () => string }): void => {
    if (msg.type() === 'error') errors.push(msg.text());
  };
  page.on('console', handler);
  return (): string[] => {
    page.removeListener('console', handler);
    const result = [...errors];
    errors.length = 0;
    return result;
  };
}

async function assertNoConsoleErrors(
  getErrors: () => string[],
  page: Page
): Promise<void> {
  const errors = getErrors();
  const realErrors = errors.filter(
    (e: string) =>
      !e.includes('Failed to fetch') &&
      !e.includes('unable to load instruction languages')
  );
  if (realErrors.length > 0) {
    await page.screenshot({
      path: `/tmp/console-error-drag-${Date.now()}.png`,
      fullPage: true,
    });
    expect(realErrors).toEqual([]);
  }
}

async function openAppWithHandles(page: Page, sceneNum: number): Promise<void> {
  await page.goto(`${FRONTEND}`);
  await page.waitForSelector('.cm-content', { timeout: 15000 });
  await page.waitForTimeout(1000);

  const splitBtn = page.locator('[title="Split Mode"]');
  if ((await splitBtn.count()) === 0) {
    await page.locator('text="Split Mode"').first().click({ timeout: 5000 });
  } else {
    await splitBtn.click({ timeout: 5000 });
  }
  await page.waitForTimeout(1000);

  const narrativeBtn = page.locator('button:has-text("Narrative")');
  if (await narrativeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await narrativeBtn.click();
    await page.waitForTimeout(500);
  }

  const sceneId = sceneNum === 1 ? 13 : sceneNum === 2 ? 14 : 16;
  await page.locator(`[data-scene-card="${sceneId}"]`).click({ timeout: 5000 });
  await page.waitForTimeout(1500);

  await expect(page.locator(`[data-testid="handle-start-${sceneId}"]`)).toBeAttached({
    timeout: 5000,
  });
}

async function handleX(
  page: Page,
  sceneId: number,
  edge: 'start' | 'end'
): Promise<number> {
  const box = await page
    .locator(`[data-testid="handle-${edge}-${sceneId}"]`)
    .boundingBox();
  if (!box) throw new Error(`handle-${edge}-${sceneId} not found`);
  return box.x;
}

async function expectBoundariesAligned(
  page: Page,
  leftScene: number,
  rightScene: number
): Promise<void> {
  const endHandle = page.locator(`[data-testid="handle-end-${leftScene}"]`);
  const startHandle = page.locator(`[data-testid="handle-start-${rightScene}"]`);
  if ((await endHandle.count()) === 0 || (await startHandle.count()) === 0) {
    return; // one side unlinked — N/A
  }
  const endX = await handleX(page, leftScene, 'end');
  const startX = await handleX(page, rightScene, 'start');
  expect(
    Math.abs(endX - startX),
    `boundary alignment end-${leftScene} vs start-${rightScene}`
  ).toBeLessThanOrEqual(1);
}

async function dragAndWait(
  page: Page,
  sceneId: number,
  edge: 'start' | 'end',
  deltaX: number
): Promise<void> {
  const handle = page.locator(`[data-testid="handle-${edge}-${sceneId}"]`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`handle-${edge}-${sceneId} not found`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(50);
  const steps = Math.max(Math.abs(deltaX), 5);
  for (let i = 1; i <= steps; i += 1) {
    const x = cx + (deltaX * i) / steps;
    await page.mouse.move(x, cy);
    await page.waitForTimeout(10);
  }
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(3000);
}

async function selectScene(page: Page, sceneNum: number): Promise<void> {
  const sceneId = sceneNum === 1 ? 13 : sceneNum === 2 ? 14 : 16;
  await page.locator(`[data-scene-card="${sceneId}"]`).click({ timeout: 5000 });
  await page.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// The one-shot "verify everything after the costly drag" helper
// ---------------------------------------------------------------------------

interface DragExpectations {
  /** Scenes that must still be linked after the drag. */
  presentScenes: number[];
  /** Raw marker tokens that must remain at their exact pristine offset. */
  fixedMarkers: string[];
  /** Adjacent scene pairs that must share a single file boundary. */
  aligned: Array<[number, number]>;
  /** Annotation IDs that must still be present and cover the same text. */
  expectedAnnos?: string[];
}

async function verifyAfterDrag(
  page: Page,
  request: APIRequestContext,
  exp: DragExpectations
): Promise<string> {
  const content = await fetchChapter(request);

  // Run every cheap FILE + DISPLAY check and report ALL violations at once
  // (one failure, complete picture).  The drag is the costly part, so we
  // extract maximum verification from each one.
  const violations: string[] = [
    ...noProseLossViolations(content),
    ...sceneMarkerViolations(content, exp.presentScenes),
    ...annotationsPreservedViolations(content, exp.expectedAnnos),
    ...annotationNestingViolations(content),
    ...fixedMarkerViolations(content, exp.fixedMarkers),
    ...fileBoundaryAlignmentViolations(content, exp.aligned),
  ];
  violations.push(...(await displayViolations(page, content)));

  expect(violations).toEqual([]);
  return content;
}

// ═══════════════════════════════════════════════════════════
// START boundary drags (3 scenarios)
// ═══════════════════════════════════════════════════════════

test.describe('Scene boundary drag — browser UX', () => {
  let getErrors: () => string[];

  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      getErrors = installConsoleErrorCollector(page);
      await page.setViewportSize({ width: 1920, height: 1080 });

      // Reset the shared project to pristine so every test starts from the
      // exact seeded state (the fullstack suite seeds the project once).
      await resetProject(request);

      const resp = await request.post(`${BACKEND}/api/v1/projects/select`, {
        data: { name: PROJECT },
      });
      if (!resp.ok()) {
        throw new Error(`Failed to select project ${PROJECT}: ${resp.status()}`);
      }

      await page.goto(`${FRONTEND}`);
      await page.waitForSelector('.cm-content', { timeout: 15000 });
      await page.waitForTimeout(2000);
    }
  );

  test.afterEach(async ({ page }: { page: Page }) => {
    await assertNoConsoleErrors(getErrors, page);
  });

  test('START: shrink scene 14 within its own text', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await openAppWithHandles(page, 2); // Scene 2 = ID 14
    const before = await handleX(page, 14, 'start');

    // Drag start handle right by ~16px (about 2 chars at 8px/char)
    await dragAndWait(page, 14, 'start', 16);

    // Handle moved right; scene stays linked.
    const after = await handleX(page, 14, 'start');
    expect(after).toBeGreaterThan(before);
    await expect(page.locator('[data-testid="handle-start-14"]')).toBeAttached();

    // Boundary alignment (handles).
    await expectBoundariesAligned(page, 13, 14);
    await expectBoundariesAligned(page, 14, 16);

    // Comprehensive file + display verification.
    await verifyAfterDrag(page, request, {
      presentScenes: [13, 14, 16],
      // scene 13's START, scene 14's END and all of scene 16 must be untouched.
      fixedMarkers: [
        '<!--scene:13:start-->',
        '<!--scene:14:end-->',
        '<!--scene:16:start-->',
        '<!--scene:16:end-->',
      ],
      // Shrinking scene 14 internally releases its first char into an
      // UNLINKED prose gap (scenes need not be adjacent), so no strict
      // file adjacency is expected here.  Ordering/non-overlap is still
      // enforced by the scene-marker checks.
      aligned: [],
    });
  });

  test('START: drag scene 14 start left into scene 13 (partial overlap)', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await openAppWithHandles(page, 2);
    const before14 = await handleX(page, 14, 'start');

    // Drag start handle left by ~60px (~7-8 chars into scene 13)
    await dragAndWait(page, 14, 'start', -60);

    const after14 = await handleX(page, 14, 'start');
    expect(after14).toBeLessThan(before14);
    await expect(page.locator('[data-testid="handle-start-14"]')).toBeAttached();
    await selectScene(page, 1);
    await expect(page.locator('[data-testid="handle-end-13"]')).toBeAttached();
    await expectBoundariesAligned(page, 13, 14);
    await selectScene(page, 2);
    await expectBoundariesAligned(page, 14, 16);

    // Comprehensive file + display verification.
    await verifyAfterDrag(page, request, {
      presentScenes: [13, 14, 16],
      // scene 13 START, scene 14 END and all of scene 16 must be untouched.
      fixedMarkers: [
        '<!--scene:13:start-->',
        '<!--scene:14:end-->',
        '<!--scene:16:start-->',
        '<!--scene:16:end-->',
      ],
      aligned: [
        [13, 14],
        [14, 16],
      ],
    });
  });

  test('START: drag scene 16 start left, engulfing scene 14', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await openAppWithHandles(page, 3);
    const before16 = await handleX(page, 16, 'start');

    // Drag start far left past scene 14 (~200px, safely beyond the engulf threshold)
    await dragAndWait(page, 16, 'start', -200);

    expect(await handleX(page, 16, 'start')).toBeLessThan(before16);

    // Scene 14 handles are gone (engulfed → unlinked).
    await expect(page.locator('[data-testid="handle-start-14"]')).not.toBeAttached({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="handle-end-14"]')).not.toBeAttached({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="handle-start-16"]')).toBeAttached();
    await selectScene(page, 1);
    await expectBoundariesAligned(page, 13, 16);

    // Comprehensive file + display verification.
    // Only scene 13's START is prefix-stable here: engulfing removes scene 14's
    // markers, so every marker AFTER scene 14 legitimately shifts left.
    await verifyAfterDrag(page, request, {
      presentScenes: [13, 16],
      fixedMarkers: ['<!--scene:13:start-->'],
      aligned: [[13, 16]],
    });
  });

  // ═══════════════════════════════════════════════════════════
  // END boundary drags (3 scenarios)
  // ═══════════════════════════════════════════════════════════

  test('END: shrink scene 14 within its own text', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await openAppWithHandles(page, 2); // Scene 2 = ID 14
    const before = await handleX(page, 14, 'end');

    // Drag end handle left by ~16px
    await dragAndWait(page, 14, 'end', -16);

    expect(await handleX(page, 14, 'end')).toBeLessThan(before);
    await expect(page.locator('[data-testid="handle-end-14"]')).toBeAttached();
    await expectBoundariesAligned(page, 13, 14);
    await expectBoundariesAligned(page, 14, 16);

    // Comprehensive file + display verification.
    await verifyAfterDrag(page, request, {
      presentScenes: [13, 14, 16],
      // scene 13 fully, scene 14 START and scene 16 END must be untouched.
      fixedMarkers: [
        '<!--scene:13:start-->',
        '<!--scene:13:end-->',
        '<!--scene:14:start-->',
        '<!--scene:16:end-->',
      ],
      // Shrinking scene 14 internally releases its last char into an
      // UNLINKED prose gap (scenes need not be adjacent), so no strict
      // file adjacency is expected here.
      aligned: [],
    });
  });

  test('END: drag scene 14 end right into scene 16 (partial overlap)', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await openAppWithHandles(page, 2);
    const before14 = await handleX(page, 14, 'end');

    // Drag end handle right by ~60px into scene 16
    await dragAndWait(page, 14, 'end', 60);

    const after14 = await handleX(page, 14, 'end');
    expect(after14).toBeGreaterThan(before14);
    await expect(page.locator('[data-testid="handle-end-14"]')).toBeAttached();
    await selectScene(page, 3);
    await expect(page.locator('[data-testid="handle-start-16"]')).toBeAttached();
    await expectBoundariesAligned(page, 14, 16);
    await selectScene(page, 1);
    await expectBoundariesAligned(page, 13, 14);

    // Comprehensive file + display verification.
    await verifyAfterDrag(page, request, {
      presentScenes: [13, 14, 16],
      // scene 13 fully, scene 14 START and scene 16 END must be untouched.
      fixedMarkers: [
        '<!--scene:13:start-->',
        '<!--scene:13:end-->',
        '<!--scene:14:start-->',
        '<!--scene:16:end-->',
      ],
      aligned: [
        [13, 14],
        [14, 16],
      ],
    });
  });

  test('END: drag scene 13 end right, engulfing scene 14', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await openAppWithHandles(page, 1);
    const before13 = await handleX(page, 13, 'end');

    // Drag end far right past scene 14 (~200px, safely beyond the engulf threshold)
    await dragAndWait(page, 13, 'end', 200);

    expect(await handleX(page, 13, 'end')).toBeGreaterThan(before13);

    // Scene 14 handles are gone (engulfed → unlinked).
    await expect(page.locator('[data-testid="handle-start-14"]')).not.toBeAttached({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="handle-end-14"]')).not.toBeAttached({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="handle-end-13"]')).toBeAttached();
    await selectScene(page, 3);
    await expectBoundariesAligned(page, 13, 16);

    // Comprehensive file + display verification.
    // Only scene 13's START is prefix-stable here: engulfing removes scene 14's
    // markers, so every marker AFTER scene 14 legitimately shifts left.
    await verifyAfterDrag(page, request, {
      presentScenes: [13, 16],
      fixedMarkers: ['<!--scene:13:start-->'],
      aligned: [[13, 16]],
    });
  });
});
