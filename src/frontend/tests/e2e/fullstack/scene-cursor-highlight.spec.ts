/**
 * Purpose: Full-browser E2E tests for cursor-to-scene highlighting UX.
 *
 * Tests that when the user places the editor cursor in prose that belongs
 * to a scene, the corresponding scene card is highlighted in the Narrative
 * view and prose highlight decorations appear in the editor.
 *
 * Uses page.evaluate to dispatch cursor changes directly through CodeMirror's
 * internal API, avoiding unreliable approximate pixel-click positioning.
 *
 * Self-contained: uses the same temp-directory / ports as the boundary-drag
 * tests (18000/18001).  Run with:
 *   npx playwright test --config=playwright.fullstack.config.ts
 */

import { test, expect, type Page } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const FRONTEND = 'http://127.0.0.1:18001';
// Dedicated pristine project so concurrent drag/annotation tests (which
// mutate the shared e2e-boundary-test project) never corrupt these scene
// ranges.  Created by playwright.fullstack.config.ts.
const PROJECT = 'e2e-cursor-test';

/**
 * Set up Split Mode and Narrative view.  Assumes the page is already loaded
 * with the test project selected (handled by beforeEach).
 */
async function setupSplitModeWithNarrative(page: Page): Promise<void> {
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
 * Set the editor cursor at a visible character offset by dispatching a
 * selection transaction directly through CodeMirror's API via page.evaluate.
 * Deterministic and immune to dropped keyboard events under CI load.  The
 * editor runs with hideSceneMarkers=true, so document offsets equal visible
 * character offsets.
 */
async function setCursorAtOffset(page: Page, offset: number): Promise<void> {
  // Wait for the editor view to be exposed (remounts on mode switches).
  await page.waitForFunction(
    () => !!(window as unknown as { __aqEditorView?: unknown }).__aqEditorView,
    undefined,
    { timeout: 5000 }
  );

  const applied = await page.evaluate((target: number): boolean => {
    const w = window as unknown as {
      __aqEditorView?: {
        dispatch: (spec: {
          selection: { anchor: number; head: number };
          scrollIntoView: boolean;
        }) => void;
        state: {
          doc: { length: number };
          selection: { main: { head: number } };
        };
        focus: () => void;
      };
    };
    const view = w.__aqEditorView;
    if (!view) return false;
    const len = view.state.doc.length;
    const pos = Math.min(Math.max(0, target), len);
    view.dispatch({
      selection: { anchor: pos, head: pos },
      scrollIntoView: true,
    });
    view.focus();
    return view.state.selection.main.head === pos;
  }, offset);

  if (!applied) {
    throw new Error(`Failed to set editor cursor at offset ${offset}`);
  }
  // Give React a tick to process the selection-change callback.
  await page.waitForTimeout(300);
}

test.describe('Scene cursor highlight — browser UX', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });

      // Select this spec's dedicated pristine project BEFORE loading the app.
      // The fullstack specs share one backend whose "current" project is
      // global state, and the app auto-selects it on load via an async
      // refresh.  Selecting our project first guarantees the app loads it
      // instead of whichever project a previous spec left active.
      const resp = await request.post('http://127.0.0.1:18000/api/v1/projects/select', {
        data: { name: PROJECT },
      });
      if (!resp.ok()) {
        throw new Error(`Failed to select project ${PROJECT}: ${resp.status()}`);
      }

      await page.goto(`${FRONTEND}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.cm-content', { timeout: 15000 });
      await page.waitForTimeout(1500);
    }
  );

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

    // Set cursor inside Scene 14's prose (offset ~19, middle of "SceneFourteen")
    await setCursorAtOffset(page, 19);

    // The scene card for Scene 14 should now have the active ring
    const scene14Card = page.locator('[data-scene-card="14"]');
    await expect(scene14Card).toBeAttached({ timeout: 5000 });

    // Cursor sync sets the scene as active (violet ring), not just selected
    await expect(scene14Card).toHaveClass(/ring-violet-400/, { timeout: 3000 });

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

    // Set cursor inside Scene 13 (visible offsets 0-12)
    await setCursorAtOffset(page, 5);

    const scene13Card = page.locator('[data-scene-card="13"]');
    await expect(scene13Card).toHaveClass(/ring-violet-400/, { timeout: 3000 });

    // Set cursor inside Scene 14 (different scene → deselects Scene 13)
    await setCursorAtOffset(page, 19);

    // Scene 13 should no longer be active
    await expect(scene13Card).not.toHaveClass(/ring-violet-400/, { timeout: 3000 });

    // Set cursor well past the end of all scene text (offset > 38)
    await setCursorAtOffset(page, 80);

    // No scene card should have the active ring now
    const scene14Card = page.locator('[data-scene-card="14"]');
    await expect(scene14Card).not.toHaveClass(/ring-violet-400/, { timeout: 3000 });
  });

  test('cursor moves between scenes and highlights the correct one', async ({
    page,
  }: {
    page: Page;
  }) => {
    await setupSplitModeWithNarrative(page);

    // Set cursor inside Scene 13 (visible offsets 0-12)
    await setCursorAtOffset(page, 5);

    const scene13Card = page.locator('[data-scene-card="13"]');
    await expect(scene13Card).toHaveClass(/ring-violet-400/, { timeout: 3000 });

    // Set cursor inside Scene 14 (visible offsets 13-25)
    await setCursorAtOffset(page, 19);

    const scene14Card = page.locator('[data-scene-card="14"]');
    await expect(scene13Card).not.toHaveClass(/ring-violet-400/, { timeout: 3000 });
    await expect(scene14Card).toHaveClass(/ring-violet-400/, { timeout: 3000 });

    // Set cursor inside Scene 16 (visible offsets 26-38)
    await setCursorAtOffset(page, 30);

    const scene16Card = page.locator('[data-scene-card="16"]');
    await expect(scene14Card).not.toHaveClass(/ring-violet-400/, { timeout: 3000 });
    await expect(scene16Card).toHaveClass(/ring-violet-400/, { timeout: 3000 });
  });

  test('scene highlight persists after multiple cursor moves within same scene', async ({
    page,
  }: {
    page: Page;
  }) => {
    await setupSplitModeWithNarrative(page);

    // Set cursor inside Scene 14 (visible offsets 13-25)
    await setCursorAtOffset(page, 19);

    const scene14Card = page.locator('[data-scene-card="14"]');
    await expect(scene14Card).toBeAttached({ timeout: 5000 });
    await expect(scene14Card).toHaveClass(/ring-violet-400/, { timeout: 3000 });

    // Move cursor to a different position still within Scene 14
    await setCursorAtOffset(page, 22);
    await expect(scene14Card).toHaveClass(/ring-violet-400/, { timeout: 2000 });

    // Move cursor to another position within Scene 14
    await setCursorAtOffset(page, 15);
    await expect(scene14Card).toHaveClass(/ring-violet-400/, { timeout: 2000 });
  });
});
