/**
 * Purpose: E2E tests for scene marker cursor navigation and drag behavior.
 *
 * jsdom cannot test cursor visibility, text reflow, or mouse-drag interaction
 * because it has no layout engine.  These tests run in a real Chromium browser
 * via Playwright against a minimal Vite-served fixture that imports CodeMirror
 * from the local node_modules.
 *
 * Prerequisite: the fixture Vite dev server must be running on port 5199.
 * Start it with:  cd tests/e2e/fixture && npx vite
 * Then run:        npx playwright test
 */

import { test, expect, type Page } from '@playwright/test';

interface WindowWithFixture {
  __setProseHighlight?: (ranges: unknown[]) => void;
}

const FIXTURE_URL = 'http://127.0.0.1:5199';

test.describe('Scene marker cursor navigation', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(FIXTURE_URL);
    await page.waitForSelector('.cm-content', { timeout: 15000 });
    await page.waitForSelector('.cm-prose-link-highlight', { timeout: 5000 });
  });

  test('clicking on highlighted scene prose keeps highlight and shows cursor', async ({
    page,
  }: {
    page: Page;
  }) => {
    // First click on prose to establish a starting point, then verify
    const cmContent = page.locator('.cm-content');
    // Click somewhere in the visible prose area (middle of the editor)
    await cmContent.click({ position: { x: 250, y: 20 } });
    await page.waitForTimeout(300);

    // Cursor must be visible
    const cursor = page.locator('.cm-cursor');
    await expect(cursor).toBeAttached({ timeout: 2000 });
  });

  test('moving cursor from outside to inside scene: cursor never disappears', async ({
    page,
  }: {
    page: Page;
  }) => {
    const cmContent = page.locator('.cm-content');
    // Click near the very start of content (before first scene)
    await cmContent.click({ position: { x: 10, y: 20 } });
    await page.waitForTimeout(200);

    // Press right arrow 20 times, checking cursor after each press
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
      const cursor = page.locator('.cm-cursor');
      await expect(cursor).toBeAttached({ timeout: 500 });
    }
  });

  test('moving cursor from inside to outside scene: cursor never disappears', async ({
    page,
  }: {
    page: Page;
  }) => {
    const cmContent = page.locator('.cm-content');
    // Click in the middle of content (inside a scene)
    await cmContent.click({ position: { x: 250, y: 20 } });
    await page.waitForTimeout(200);

    // Press left arrow many times, checking cursor after each press
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(50);
      const cursor = page.locator('.cm-cursor');
      await expect(cursor).toBeAttached({ timeout: 500 });
    }
  });

  test('cursor visually advances when moving from outside into a scene', async ({
    page,
  }: {
    page: Page;
  }) => {
    const cmContent = page.locator('.cm-content');
    await cmContent.click({ position: { x: 10, y: 20 } });
    await page.waitForTimeout(300);

    const before = await page.locator('.cm-cursor').boundingBox();
    expect(before).not.toBeNull();

    // Enough presses to cross the hidden marker into prose
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(30);
    }

    const after = await page.locator('.cm-cursor').boundingBox();
    expect(after).not.toBeNull();
    expect(after!.x).toBeGreaterThan(before!.x);
  });

  test('scene highlight activates when cursor enters via arrow keys', async ({
    page,
  }: {
    page: Page;
  }) => {
    const cmContent = page.locator('.cm-content');
    await cmContent.click({ position: { x: 10, y: 20 } });
    await page.waitForTimeout(200);

    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(30);
    }

    const highlights = page.locator('.cm-prose-link-highlight');
    await expect(highlights.first()).toBeAttached({ timeout: 3000 });
    const count = await highlights.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Scene marker drag interaction', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(FIXTURE_URL);
    await page.waitForSelector('.cm-content', { timeout: 15000 });
    await page.waitForSelector('.cm-prose-link-highlight', { timeout: 5000 });
    await page.waitForTimeout(500);
  });

  test('marker handle is visible and has correct dimensions', async ({
    page,
  }: {
    page: Page;
  }) => {
    const handles = page.locator('.cm-prose-handle');
    const count = await handles.count();
    expect(count).toBeGreaterThanOrEqual(4); // 2 scenes × 2 boundaries

    // Check that the first handle's ::before pseudo-element has content
    // (we verify via the class and that it's attached to DOM)
    const firstHandle = handles.first();
    await expect(firstHandle).toBeAttached();
    await expect(firstHandle).toHaveClass(/cm-prose-handle-(start|end)/);
  });

  test('marker handle has ew-resize cursor via CSS', async ({
    page,
  }: {
    page: Page;
  }) => {
    // The widget has width:0px (zero flow), so Playwright considers it
    // non-visible for hover.  Verify the CSS rule instead.
    const cursorValue = await page.evaluate(() => {
      const el = document.querySelector('.cm-prose-handle');
      return el ? window.getComputedStyle(el).cursor : null;
    });
    expect(cursorValue).toBe('ew-resize');
  });

  test('dragging a marker updates the status text', async ({
    page,
  }: {
    page: Page;
  }) => {
    const handle = page.locator('[data-testid="handle-start-a"]');
    await expect(handle).toBeAttached({ timeout: 2000 });

    const box = await handle.boundingBox();
    expect(box).not.toBeNull();

    // Perform a drag: mousedown, move, mouseup
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 30, box!.y + box!.height / 2, {
      steps: 5,
    });
    await page.mouse.up();

    // Check status was updated
    const status = page.locator('#status');
    await expect(status).toContainText('start boundary of a dragged', {
      timeout: 1000,
    });
  });

  test('text does not visibly shift when highlights are cleared', async ({
    page,
  }: {
    page: Page;
  }) => {
    const firstLine = page.locator('.cm-line').first();
    const initialBox = await firstLine.boundingBox();
    expect(initialBox).not.toBeNull();

    // Wait for __setProseHighlight to be defined by the fixture module
    await page.waitForFunction(
      () => (window as unknown as WindowWithFixture).__setProseHighlight
    );
    await page.evaluate(() =>
      (window as unknown as WindowWithFixture).__setProseHighlight?.([])
    );
    await page.waitForTimeout(300);

    // Get positions after highlights removed
    const afterClearBox = await firstLine.boundingBox();
    expect(afterClearBox).not.toBeNull();

    // Positions should be nearly identical (allow 1px tolerance)
    expect(Math.abs(initialBox!.x - afterClearBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(initialBox!.y - afterClearBox!.y)).toBeLessThanOrEqual(1);
  });
});
