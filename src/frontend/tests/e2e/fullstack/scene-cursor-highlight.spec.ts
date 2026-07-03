/**
 * Purpose: Full-browser E2E tests for cursor-to-scene highlighting UX.
 *
 * Tests that when the user places the editor cursor in prose that belongs
 * to a scene, the corresponding scene card is highlighted in the Narrative
 * view and prose highlight decorations appear in the editor.
 *
 * Self-contained: uses the same temp-directory / ports as the boundary-drag
 * tests (18000/18001).  Run with:
 *   npx playwright test --config=playwright.fullstack.config.ts
 */

import { test, expect, type Page } from '@playwright/test';

const FRONTEND = 'http://127.0.0.1:18001';
const PROJECT = 'e2e-boundary-test';

/**
 * Navigate to the app, select the test project, switch to Split Mode, and
 * ensure the Narrative view is active so scene cards are visible.
 */
async function setupSplitModeWithNarrative(page: Page): Promise<void> {
  await page.goto(`${FRONTEND}`);
  await page.waitForSelector('.cm-content', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Switch to Split Mode
  const splitBtn = page.locator('[title="Split Mode"]');
  if ((await splitBtn.count()) === 0) {
    await page.locator('text="Split Mode"').first().click({ timeout: 5000 });
  } else {
    await splitBtn.click({ timeout: 5000 });
  }
  await page.waitForTimeout(1000);

  // Ensure Narrative view is active
  const narrativeBtn = page.locator('button:has-text("Narrative")');
  if (await narrativeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await narrativeBtn.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Click at a visible character offset in the CodeMirror editor.
 * Uses posAtCoords-style approximation: each character is ~9.5px wide
 * at 18px font size, plus ~20px left padding.
 */
async function clickAtEditorOffset(page: Page, visibleOffset: number): Promise<void> {
  const cmContent = page.locator('.cm-content');
  const box = await cmContent.boundingBox();
  if (!box) throw new Error('Editor .cm-content not found');

  // Approximate: ~9.5px per character, 20px left padding, first line ~20px down
  const charWidth = 9.5;
  const leftPad = 20;
  const x = leftPad + visibleOffset * charWidth;
  const y = 20;

  await cmContent.click({ position: { x, y } });
  await page.waitForTimeout(500);
}

test.describe('Scene cursor highlight — browser UX', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Select the test project via the backend API
    await page.goto(`${FRONTEND}`);
    await page.evaluate(async (projectName: string) => {
      await fetch('http://127.0.0.1:18000/api/v1/projects/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName }),
      });
    }, PROJECT);
    // Reload so the app picks up the selected project
    await page.goto(`${FRONTEND}`);
    await page.waitForTimeout(2000);
  });

  test('cursor inside scene prose highlights the owning scene card', async ({
    page,
  }: {
    page: Page;
  }) => {
    await setupSplitModeWithNarrative(page);

    // The test project has 3 scenes in chapter 1:
    //   Scene 13: "SceneThirteen" (visible offsets 0-12)
    //   Scene 14: "SceneFourteen" (visible offsets 13-25)
    //   Scene 16: "SceneSixteen_" (visible offsets 26-38)

    // Click inside Scene 14's prose (visible offset ~19, middle of "SceneFourteen")
    await clickAtEditorOffset(page, 19);
    await page.waitForTimeout(800);

    // The scene card for Scene 14 should now have the selection ring
    const scene14Card = page.locator('[data-scene-card="14"]');
    await expect(scene14Card).toBeAttached({ timeout: 5000 });

    // Verify the selection ring class is present
    await expect(scene14Card).toHaveClass(/ring-brand-400/, { timeout: 3000 });

    // Verify prose highlight decoration appears in the editor
    const highlights = page.locator('.cm-prose-link-highlight');
    await expect(highlights.first()).toBeAttached({ timeout: 3000 });
  });

  test('cursor outside any scene prose clears scene selection', async ({
    page,
  }: {
    page: Page;
  }) => {
    await setupSplitModeWithNarrative(page);

    // First click inside Scene 13's prose to select it
    await clickAtEditorOffset(page, 5);
    await page.waitForTimeout(800);

    const scene13Card = page.locator('[data-scene-card="13"]');
    await expect(scene13Card).toHaveClass(/ring-brand-400/, { timeout: 3000 });

    // Now click at the very end of the visible text (beyond all scenes)
    // Scene 16 ends at visible offset 38, so offset 45 should be outside
    await clickAtEditorOffset(page, 20);
    await page.waitForTimeout(500);

    // Press right arrow many times to move past the last scene
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(500);

    // Scene 13 should no longer be selected
    await expect(scene13Card).not.toHaveClass(/ring-brand-400/, { timeout: 3000 });
  });

  test('cursor moves between scenes and highlights the correct one', async ({
    page,
  }: {
    page: Page;
  }) => {
    await setupSplitModeWithNarrative(page);

    // Click at the start of visible content (inside Scene 13)
    await clickAtEditorOffset(page, 2);
    await page.waitForTimeout(800);

    const scene13Card = page.locator('[data-scene-card="13"]');
    await expect(scene13Card).toHaveClass(/ring-brand-400/, { timeout: 3000 });

    // Move cursor right past Scene 13 into Scene 14 (13 chars for SceneThirteen)
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(500);

    // Scene 13 should be deselected and Scene 14 should be selected
    const scene14Card = page.locator('[data-scene-card="14"]');
    await expect(scene13Card).not.toHaveClass(/ring-brand-400/, { timeout: 3000 });
    await expect(scene14Card).toHaveClass(/ring-brand-400/, { timeout: 3000 });

    // Move further right into Scene 16
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(500);

    const scene16Card = page.locator('[data-scene-card="16"]');
    await expect(scene14Card).not.toHaveClass(/ring-brand-400/, { timeout: 3000 });
    await expect(scene16Card).toHaveClass(/ring-brand-400/, { timeout: 3000 });
  });

  test('scene highlight persists after multiple cursor moves within same scene', async ({
    page,
  }: {
    page: Page;
  }) => {
    await setupSplitModeWithNarrative(page);

    // Click inside Scene 14's prose
    await clickAtEditorOffset(page, 18);
    await page.waitForTimeout(500);

    const scene14Card = page.locator('[data-scene-card="14"]');

    // Move cursor left and right within the scene — highlight should stay
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);
    await expect(scene14Card).toHaveClass(/ring-brand-400/, { timeout: 2000 });

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    await expect(scene14Card).toHaveClass(/ring-brand-400/, { timeout: 2000 });

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    await expect(scene14Card).toHaveClass(/ring-brand-400/, { timeout: 2000 });
  });
});
