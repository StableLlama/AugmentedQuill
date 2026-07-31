// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Full-browser E2E tests for scene boundary drag UX.
 *
 * Each test: opens the app in Split Mode (with a 1920×1080 viewport so all
 * toolbar buttons are visible), selects a scene to show handles, drags a
 * handle with mouse events, waits for the full roundtrip
 * (frontend → backend → frontend store update → React re-render),
 * then verifies that:
 *   - handles moved in the expected direction,
 *   - adjacent scene boundaries are pixel-aligned (they share a split point),
 *   - the editor's visible text content remains intact (no data loss),
 *   - engulfed scenes are properly unlinked.
 *
 * Self-contained: temp directory, ports 18000/18001.  Run with:
 *   npx playwright test --config=playwright.fullstack.config.ts
 */

import { test, expect, type Page } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const FRONTEND = 'http://127.0.0.1:18001';
const PROJECT = 'e2e-boundary-test';

// Scene text lengths (from the chapter content created by the config)
// Scene 13: "SceneThirteen" = 13 chars, Scene 14: "SceneFourteen" = 13 chars,
// Scene 16: "SceneSixteen_" = 13 chars.  Total visible: 39 chars.
const FULL_CONTENT = 'SceneThirteenSceneFourteenSceneSixteen_';

// ---------------------------------------------------------------------------
// Console error tracking
// ---------------------------------------------------------------------------

function installConsoleErrorCollector(page: Page): () => string[] {
  const errors: string[] = [];
  const handler = (msg: { type: () => string; text: () => string }): void => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
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

/**
 * Navigate to the app, switch to Split Mode, select a scene to show handles,
 * and verify handles are visible.
 */
async function openAppWithHandles(page: Page, sceneNum: number): Promise<void> {
  await page.goto(`${FRONTEND}`);
  // Wait for editor
  await page.waitForSelector('.cm-content', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Switch to Split Mode (try title attribute first, then text)
  const splitBtn = page.locator('[title="Split Mode"]');
  if ((await splitBtn.count()) === 0) {
    await page.locator('text="Split Mode"').first().click({ timeout: 5000 });
  } else {
    await splitBtn.click({ timeout: 5000 });
  }
  await page.waitForTimeout(1000);

  // Ensure we're in Narrative view (click it if visible)
  const narrativeBtn = page.locator('button:has-text("Narrative")');
  if (await narrativeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await narrativeBtn.click();
    await page.waitForTimeout(500);
  }

  // Click the scene card to show highlights/handles.
  // Scene cards have data-scene-card attributes with the real scene ID.
  const sceneId = sceneNum === 1 ? 13 : sceneNum === 2 ? 14 : 16;
  await page.locator(`[data-scene-card="${sceneId}"]`).click({ timeout: 5000 });
  await page.waitForTimeout(1500);

  // Verify handles appear
  await expect(page.locator(`[data-testid="handle-start-${sceneId}"]`)).toBeAttached({
    timeout: 5000,
  });
}

/**
 * Get the current x-position of a handle.
 */
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

/**
 * Read the visible text content of the CodeMirror editor.
 */
async function getEditorText(page: Page): Promise<string> {
  return page.locator('.cm-content').innerText();
}

/**
 * Verify that two adjacent scene boundaries are pixel-aligned.
 * For example, handle-end-13 and handle-start-14 should be at the same X
 * position because they define the same split point between scenes 13 and 14.
 */
async function expectBoundariesAligned(
  page: Page,
  leftScene: number,
  rightScene: number
): Promise<void> {
  // Both handles must exist for this check to be meaningful
  const endHandle = page.locator(`[data-testid="handle-end-${leftScene}"]`);
  const startHandle = page.locator(`[data-testid="handle-start-${rightScene}"]`);

  if ((await endHandle.count()) === 0 || (await startHandle.count()) === 0) {
    // One or both scenes are unlinked — alignment doesn't apply
    return;
  }

  const endX = await handleX(page, leftScene, 'end');
  const startX = await handleX(page, rightScene, 'start');

  // Allow 1px tolerance for sub-pixel rendering differences
  expect(
    Math.abs(endX - startX),
    `boundary alignment: end-${leftScene} (${endX}) vs start-${rightScene} (${startX})`
  ).toBeLessThanOrEqual(1);
}

/**
 * Drag a handle horizontally by deltaX pixels, then wait for the roundtrip.
 */
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

  // Use mouse event dispatch to trigger the CodeMirror widget's mousedown
  // handler which listens on `document` for mousemove/mouseup.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(50);

  // Move in small steps so CodeMirror's posAtCoords resolves each position
  const steps = Math.max(Math.abs(deltaX), 5);
  for (let i = 1; i <= steps; i++) {
    const x = cx + (deltaX * i) / steps;
    await page.mouse.move(x, cy);
    await page.waitForTimeout(10);
  }
  await page.waitForTimeout(50);
  await page.mouse.up();

  // Wait for: API request → backend processing → response → frontend
  // store update → React re-render → useSceneProseSync highlights update.
  await page.waitForTimeout(3000);
}

/**
 * Click a scene button in the Narrative panel to show its handles.
 * Must be called after openAppWithHandles has set up Split Mode.
 */
async function selectScene(page: Page, sceneNum: number): Promise<void> {
  const sceneId = sceneNum === 1 ? 13 : sceneNum === 2 ? 14 : 16;
  await page.locator(`[data-scene-card="${sceneId}"]`).click({ timeout: 5000 });
  await page.waitForTimeout(800);
}

// ═══════════════════════════════════════════════════════════
// START boundary drags (3 scenarios)
// ═══════════════════════════════════════════════════════════

test.describe('Scene boundary drag — browser UX', () => {
  let getErrors: () => string[];

  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      getErrors = installConsoleErrorCollector(page);
      // Ensure a large viewport so the responsive Split button is visible
      await page.setViewportSize({ width: 1920, height: 1080 });

      // Select this spec's project BEFORE loading the app.  The fullstack
      // specs share one backend whose "current" project is global state and
      // the app auto-selects it on load via an async refresh, so selecting
      // first guarantees the app loads our project.
      const resp = await request.post('http://127.0.0.1:18000/api/v1/projects/select', {
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
  }: {
    page: Page;
  }) => {
    await openAppWithHandles(page, 2); // Scene 2 = ID 14
    const before = await handleX(page, 14, 'start');

    // Drag start handle right by ~16px (about 2 chars at 8px/char)
    await dragAndWait(page, 14, 'start', 16);

    // After roundtrip, handle should have moved right
    const after = await handleX(page, 14, 'start');
    expect(after).toBeGreaterThan(before);
    // Handle must still exist (scene not unlinked)
    await expect(page.locator('[data-testid="handle-start-14"]')).toBeAttached();

    // Boundary alignment: scene 13 end and scene 14 start share a boundary
    await expectBoundariesAligned(page, 13, 14);

    // Content integrity: no data loss
    expect(await getEditorText(page)).toBe(FULL_CONTENT);
  });

  test('START: drag scene 14 start left into scene 13 (partial overlap)', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAppWithHandles(page, 2);
    const before14 = await handleX(page, 14, 'start');

    // Drag start handle left by ~60px (~7-8 chars into scene 13)
    await dragAndWait(page, 14, 'start', -60);

    // Scene 14 start moved left
    const after14 = await handleX(page, 14, 'start');
    expect(after14).toBeLessThan(before14);

    // Both handles still exist
    await expect(page.locator('[data-testid="handle-start-14"]')).toBeAttached();
    await selectScene(page, 1);
    await expect(page.locator('[data-testid="handle-end-13"]')).toBeAttached();

    // CRITICAL: adjacent boundaries must be pixel-aligned
    await expectBoundariesAligned(page, 13, 14);
    await selectScene(page, 2);
    await expectBoundariesAligned(page, 14, 16);

    // Content integrity: no data loss
    expect(await getEditorText(page)).toBe(FULL_CONTENT);
  });

  test('START: drag scene 16 start left, engulfing scene 14', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAppWithHandles(page, 3);
    const before16 = await handleX(page, 16, 'start');

    // Drag start far left past scene 14 (~150px)
    await dragAndWait(page, 16, 'start', -150);

    // Scene 16 start moved left
    expect(await handleX(page, 16, 'start')).toBeLessThan(before16);

    // Scene 14 handles must be GONE (engulfed → unlinked)
    await expect(page.locator('[data-testid="handle-start-14"]')).not.toBeAttached({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="handle-end-14"]')).not.toBeAttached({
      timeout: 5000,
    });
    // Scene 16 start still exists
    await expect(page.locator('[data-testid="handle-start-16"]')).toBeAttached();

    // Boundary alignment: 13 end and 16 start now share a boundary
    await selectScene(page, 1);
    await expectBoundariesAligned(page, 13, 16);

    // Content integrity: no data loss
    expect(await getEditorText(page)).toBe(FULL_CONTENT);
  });

  // ═══════════════════════════════════════════════════════════
  // END boundary drags (3 scenarios)
  // ═══════════════════════════════════════════════════════════

  test('END: shrink scene 14 within its own text', async ({ page }: { page: Page }) => {
    await openAppWithHandles(page, 2); // Scene 2 = ID 14
    const before = await handleX(page, 14, 'end');

    // Drag end handle left by ~16px
    await dragAndWait(page, 14, 'end', -16);

    expect(await handleX(page, 14, 'end')).toBeLessThan(before);
    await expect(page.locator('[data-testid="handle-end-14"]')).toBeAttached();

    // Boundary alignment
    await expectBoundariesAligned(page, 13, 14);
    await expectBoundariesAligned(page, 14, 16);

    // Content integrity
    expect(await getEditorText(page)).toBe(FULL_CONTENT);
  });

  test('END: drag scene 14 end right into scene 16 (partial overlap)', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAppWithHandles(page, 2);
    const before14 = await handleX(page, 14, 'end');

    // Drag end handle right by ~60px into scene 16
    await dragAndWait(page, 14, 'end', 60);

    // Scene 14 end moved right
    const after14 = await handleX(page, 14, 'end');
    expect(after14).toBeGreaterThan(before14);

    // Both handles still exist
    await expect(page.locator('[data-testid="handle-end-14"]')).toBeAttached();
    await selectScene(page, 3);
    await expect(page.locator('[data-testid="handle-start-16"]')).toBeAttached();

    // CRITICAL: adjacent boundaries must be pixel-aligned
    await expectBoundariesAligned(page, 14, 16);
    await selectScene(page, 1);
    await expectBoundariesAligned(page, 13, 14);

    // Content integrity
    expect(await getEditorText(page)).toBe(FULL_CONTENT);
  });

  test('END: drag scene 13 end right, engulfing scene 14', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAppWithHandles(page, 1);
    const before13 = await handleX(page, 13, 'end');

    // Drag end far right past scene 14 (~150px)
    await dragAndWait(page, 13, 'end', 150);

    // Scene 13 end moved right
    expect(await handleX(page, 13, 'end')).toBeGreaterThan(before13);

    // Scene 14 handles must be GONE (engulfed → unlinked)
    await expect(page.locator('[data-testid="handle-start-14"]')).not.toBeAttached({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="handle-end-14"]')).not.toBeAttached({
      timeout: 5000,
    });
    // Scene 13 end still exists
    await expect(page.locator('[data-testid="handle-end-13"]')).toBeAttached();

    // Boundary alignment: 13 end and 16 start now share a boundary
    await selectScene(page, 3);
    await expectBoundariesAligned(page, 13, 16);

    // Content integrity
    expect(await getEditorText(page)).toBe(FULL_CONTENT);
  });
});
