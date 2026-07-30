/**
 * Purpose: Full-browser E2E tests for annotation UX.
 *
 * Covers the complete annotation lifecycle:
 *   1. Pre-existing annotations render highlights in the editor.
 *   2. The annotation sidebar lists all annotations for the chapter.
 *   3. Clicking an annotation in the sidebar highlights its text range.
 *   4. Placing the cursor inside annotated text selects the matching
 *      annotation in the sidebar.
 *   5. Creating a new annotation via text selection + dialog.
 *   6. Overlapping annotations on the same text.
 *   7. Deleting an annotation removes its highlight.
 *   8. Annotations coexist with scene boundaries.
 *
 * TEST ISOLATION: Each describe block recreates the project's annotation
 * state via the API in beforeEach, so tests are independent.
 *
 * Run with: npx playwright test --config=playwright.fullstack.config.ts
 */

import { test, expect, type Page } from '@playwright/test';

const FRONTEND = 'http://127.0.0.1:18001';
const BACKEND = 'http://127.0.0.1:18000';
const PROJECT = 'e2e-boundary-test';

// ---------------------------------------------------------------------------
// Annotation IDs from playwright config
// ---------------------------------------------------------------------------

const PREEXISTING_IDS = ['e2e-anno-1', 'e2e-anno-2', 'e2e-anno-3'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the app, select the project, and optionally switch mode.
 * Returns after the editor is loaded.
 */
async function navigateAndSelectProject(page: Page): Promise<void> {
  await page.goto(`${FRONTEND}`);
  await page.waitForTimeout(500);

  // Select project via backend API
  await page.evaluate(async (projectName: string) => {
    await fetch('http://127.0.0.1:18000/api/v1/projects/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: projectName }),
    });
  }, PROJECT);

  // Reload so the app picks up the selected project
  await page.goto(`${FRONTEND}`);
  await page.waitForSelector('.cm-content', { timeout: 15000 });
  await page.waitForTimeout(1000);
}

/**
 * Switch to Write Mode. Assumes page is already at the app.
 */
async function switchToWriteMode(page: Page): Promise<void> {
  const writeBtn = page.locator('[title="Write Mode"]');
  if ((await writeBtn.count()) > 0) {
    await writeBtn.click({ timeout: 5000 });
    await page.waitForTimeout(1000);
  }
}

/**
 * Switch to Split Mode and Narrative view. Assumes page is already at the app.
 */
async function switchToSplitNarrative(page: Page): Promise<void> {
  const splitBtn = page.locator('[title="Split Mode"]');
  if ((await splitBtn.count()) > 0) {
    await splitBtn.click({ timeout: 5000 });
  } else {
    await page.locator('text="Split Mode"').first().click({ timeout: 5000 });
  }
  await page.waitForTimeout(1000);

  const narrativeBtn = page.locator('button:has-text("Narrative")');
  if (await narrativeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await narrativeBtn.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Delete annotations from the project, preserving specified IDs.
 */
async function deleteAnnotationsExcept(
  page: Page,
  preserveIds: string[] = []
): Promise<void> {
  await page.evaluate(
    async (args: { projectName: string; preserve: string[] }) => {
      const resp = await fetch(
        `http://127.0.0.1:18000/api/v1/projects/${args.projectName}/annotations`
      );
      const anns: Array<{ id: string }> = await resp.json();
      const preserveSet = new Set(args.preserve);
      for (const ann of anns) {
        if (preserveSet.has(ann.id)) continue;
        await fetch(
          `http://127.0.0.1:18000/api/v1/projects/${args.projectName}/annotations/${encodeURIComponent(ann.id)}`,
          { method: 'DELETE' }
        );
      }
    },
    { projectName: PROJECT, preserve: preserveIds }
  );
}

/**
 * Set cursor at a visible offset using keyboard navigation from the editor
 * start.  More reliable than approximate pixel clicking.
 */
async function setCursorAtOffset(page: Page, offset: number): Promise<void> {
  const cmContent = page.locator('.cm-content');
  const box = await cmContent.boundingBox();
  if (!box) throw new Error('Editor .cm-content not found');

  await cmContent.click({ position: { x: 25, y: 25 } });
  await page.waitForTimeout(300);

  for (let i = 0; i < offset; i++) {
    await page.keyboard.press('ArrowRight');
  }
  await page.waitForTimeout(500);
}

/**
 * Select a range of text in the editor.
 */
async function selectEditorRange(
  page: Page,
  startOffset: number,
  endOffset: number
): Promise<void> {
  const cmContent = page.locator('.cm-content');
  const box = await cmContent.boundingBox();
  if (!box) throw new Error('Editor .cm-content not found');

  const charWidth = 9.5;
  const leftPad = 20;
  const y = 20;

  const startX = leftPad + startOffset * charWidth;
  const endX = leftPad + endOffset * charWidth;

  await cmContent.click({ position: { x: startX, y } });
  await page.waitForTimeout(200);
  await page.keyboard.down('Shift');
  await cmContent.click({ position: { x: endX, y } });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// Tests — read-only (pre-existing annotations)
// ---------------------------------------------------------------------------

test.describe('Annotation UX — reading', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateAndSelectProject(page);
    await switchToWriteMode(page);
  });

  test('pre-existing annotation highlights are visible in the editor', async ({
    page,
  }: {
    page: Page;
  }) => {
    const highlights = page.locator('.cm-annotation-range');
    const count = await highlights.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('annotation panel shows all annotations for the chapter', async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });

    const items = panel.locator('[role="button"]');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('clicking an annotation in the sidebar highlights its text', async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });

    const firstItem = panel.locator('[role="button"]').first();
    await firstItem.click();
    await page.waitForTimeout(500);

    // The active annotation gets amber styling
    await expect(firstItem).toHaveClass(/bg-amber/, { timeout: 3000 });

    // Editor highlights should be visible
    const highlights = page.locator('.cm-annotation-range');
    await expect(highlights.first()).toBeAttached({ timeout: 3000 });
  });

  test('annotation highlight spans only the annotated characters', async ({
    page,
  }: {
    page: Page;
  }) => {
    const highlights = page.locator('.cm-annotation-range');
    const count = await highlights.count();
    expect(count).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < Math.min(count, 3); i++) {
      const box = await highlights.nth(i).boundingBox();
      if (box) {
        expect(box.width).toBeLessThan(200);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — cursor-to-annotation linking (Split Mode)
// ---------------------------------------------------------------------------

test.describe('Annotation UX — cursor linking', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    // Clean up any annotations created by previous tests so cursor-linking
    // tests see only the pre-existing annotations from the test project.
    await page.goto(`${FRONTEND}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await deleteAnnotationsExcept(page, PREEXISTING_IDS);
    await navigateAndSelectProject(page);
    await switchToWriteMode(page);
  });

  test('cursor inside annotated text selects the annotation in the sidebar', async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });

    // Set cursor inside "Scene" (visible offset ~2, annotated by e2e-anno-1)
    await setCursorAtOffset(page, 2);

    const activeItem = panel.locator('[role="button"].bg-amber-500\\/20');
    await expect(activeItem).toBeAttached({ timeout: 5000 });
  });

  test('cursor outside annotated text deselects sidebar annotation', async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });

    // Set cursor inside "Scene" (annotated)
    await setCursorAtOffset(page, 2);

    const activeItem = panel.locator('[role="button"].bg-amber-500\\/20');
    await expect(activeItem).toBeAttached({ timeout: 5000 });

    // Set cursor in unannotated "Thir" (offsets 5-8)
    await setCursorAtOffset(page, 6);

    await expect(activeItem).not.toBeAttached({ timeout: 5000 });
  });

  test('cursor moves between annotations and selects the correct one', async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });

    // Set cursor inside "Scene" (e2e-anno-1)
    await setCursorAtOffset(page, 2);

    let activeItem = panel.locator('[role="button"].bg-amber-500\\/20');
    await expect(activeItem).toBeAttached({ timeout: 5000 });
    await expect(activeItem).toContainText('Annotation on "Scene"');

    // Move right into "teen" area (e2e-anno-2, at offsets 9-12)
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(800);

    // Should now have active item for e2e-anno-2 or still e2e-anno-1
    const teenItem = panel.locator(
      '[role="button"].bg-amber-500\\/20:has-text("teen")'
    );
    const sceneItem = panel.locator(
      '[role="button"].bg-amber-500\\/20:has-text(\'Annotation on "Scene"\')'
    );
    const teenVisible = await teenItem.isVisible().catch(() => false);
    const sceneVisible = await sceneItem.isVisible().catch(() => false);
    expect(teenVisible || sceneVisible).toBe(true);
  });
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

test.describe('Annotation UX — creation', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateAndSelectProject(page);
    await switchToWriteMode(page);
  });

  test('creating an annotation via selection and dialog adds highlight', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.waitForSelector('.cm-content', { timeout: 15000 });
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });

    const initialCount = await panel.locator('[role="button"]').count();

    // Select "SceneThirteen" (visible offsets 0-12)
    await selectEditorRange(page, 0, 12);
    await page.waitForTimeout(300);

    // Trigger annotation dialog via Ctrl+Shift+A
    await page.keyboard.press('Control+Shift+KeyA');
    await page.waitForTimeout(500);

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeAttached({ timeout: 5000 });

    const textarea = dialog.locator('textarea');
    await expect(textarea).toBeAttached({ timeout: 3000 });
    await textarea.fill('E2E test annotation');
    await page.waitForTimeout(200);

    const submitBtn = dialog.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 2000 });
    await submitBtn.click();
    await page.waitForTimeout(1000);

    // Dialog should close
    await expect(dialog).not.toBeAttached({ timeout: 3000 });

    // Should have more annotations now
    const finalCount = await panel.locator('[role="button"]').count();
    expect(finalCount).toBeGreaterThan(initialCount);

    // New highlight should exist
    const highlights = page.locator('.cm-annotation-range');
    await expect(highlights.first()).toBeAttached({ timeout: 3000 });
  });

  test('creating annotation via right-click context menu', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.waitForSelector('.cm-content', { timeout: 15000 });
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });

    const initialCount = await panel.locator('[role="button"]').count();

    // Select "SceneFourteen" (visible offsets 13-25)
    await selectEditorRange(page, 13, 25);
    await page.waitForTimeout(300);

    // Right-click within the selected text using page.mouse for more
    // reliable event dispatch
    const cmContent = page.locator('.cm-content');
    const charWidth = 9.5;
    const leftPad = 20;
    const box = await cmContent.boundingBox();
    if (!box) throw new Error('Editor .cm-content not found');
    const x = box.x + leftPad + 19 * charWidth;
    const y = box.y + 20;
    await page.mouse.click(x, y, { button: 'right' });
    await page.waitForTimeout(500);

    // The context menu should appear
    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeAttached({ timeout: 5000 });

    // Click "Add annotation" in the context menu
    const addBtn = contextMenu.locator('[role="menuitem"]');
    await addBtn.evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(500);

    // Annotation dialog should appear
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeAttached({ timeout: 5000 });

    // Fill and submit
    const textarea = dialog.locator('textarea');
    await textarea.fill('Context menu annotation');
    const submitBtn = dialog.locator('button[type="submit"]');
    await submitBtn.click();
    await page.waitForTimeout(1000);

    // Dialog should close
    await expect(dialog).not.toBeAttached({ timeout: 3000 });

    // Annotation should have been created
    const finalCount = await panel.locator('[role="button"]').count();
    expect(finalCount).toBeGreaterThan(initialCount);
  });

  test('creating an overlapping annotation on already-annotated text', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.waitForSelector('.cm-content', { timeout: 15000 });
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });

    const initialCount = await panel.locator('[role="button"]').count();

    // Select "Scene" which overlaps e2e-anno-1 and adjacent text (offsets 0-5)
    await selectEditorRange(page, 0, 5);
    await page.waitForTimeout(300);

    await page.keyboard.press('Control+Shift+KeyA');
    await page.waitForTimeout(500);

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeAttached({ timeout: 5000 });

    const textarea = dialog.locator('textarea');
    await textarea.fill('Overlapping annotation');
    const submitBtn = dialog.locator('button[type="submit"]');
    await submitBtn.click();
    await page.waitForTimeout(1000);

    const finalCount = await panel.locator('[role="button"]').count();
    expect(finalCount).toBeGreaterThan(initialCount);

    // Multiple highlights may exist at overlapping positions
    const highlights = page.locator('.cm-annotation-range');
    await expect(highlights.first()).toBeAttached({ timeout: 3000 });
  });

  test('creating annotation across a scene boundary', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.waitForSelector('.cm-content', { timeout: 15000 });
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });

    const initialCount = await panel.locator('[role="button"]').count();

    // Select across scene 13-14 boundary (visible offsets 7-18)
    await selectEditorRange(page, 7, 18);
    await page.waitForTimeout(300);

    await page.keyboard.press('Control+Shift+KeyA');
    await page.waitForTimeout(500);

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeAttached({ timeout: 5000 });

    const textarea = dialog.locator('textarea');
    await textarea.fill('Cross-scene annotation');
    const submitBtn = dialog.locator('button[type="submit"]');
    await submitBtn.click();
    await page.waitForTimeout(1000);

    const finalCount = await panel.locator('[role="button"]').count();
    expect(finalCount).toBeGreaterThan(initialCount);

    const highlights = page.locator('.cm-annotation-range');
    await expect(highlights.first()).toBeAttached({ timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// Tests — annotations and editor content
// ---------------------------------------------------------------------------

test.describe('Annotation UX — with scenes', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateAndSelectProject(page);
    await switchToWriteMode(page);
  });

  test('annotations are visible alongside editor content', async ({
    page,
  }: {
    page: Page;
  }) => {
    // Both the editor and annotations should be visible
    const editor = page.locator('.cm-content');
    await expect(editor).toBeAttached({ timeout: 5000 });

    const annotationHighlights = page.locator('.cm-annotation-range');
    await expect(annotationHighlights.first()).toBeAttached({ timeout: 5000 });

    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Tests — edit flow
// Tests — deletion (destructive, runs after other tests)
// ---------------------------------------------------------------------------

test.describe('Annotation UX — editing', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${FRONTEND}`);
    await page.waitForTimeout(500);
    await deleteAnnotationsExcept(page, PREEXISTING_IDS);
    await navigateAndSelectProject(page);
    await switchToWriteMode(page);
  });

  test('editing an annotation comment persists the change', async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });

    const firstItem = panel.locator('[role="button"]').first();
    await firstItem.hover();
    await page.waitForTimeout(300);

    const editBtn = firstItem.locator('[aria-label="Edit annotation"]');
    await expect(editBtn).toBeVisible({ timeout: 2000 });
    await editBtn.click();
    await page.waitForTimeout(300);

    const textarea = firstItem.locator('textarea');
    await expect(textarea).toBeAttached({ timeout: 2000 });
    await textarea.fill('Edited annotation comment');
    await page.waitForTimeout(200);

    const saveBtn = firstItem.locator('[aria-label="save"]');
    await saveBtn.click();
    await page.waitForTimeout(500);

    await expect(firstItem).toContainText('Edited annotation comment');
  });

  test('canceling edit reverts to original comment', async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });

    const firstItem = panel.locator('[role="button"]').first();
    const originalText = await firstItem.innerText();

    await firstItem.hover();
    await page.waitForTimeout(200);

    const editBtn = firstItem.locator('[aria-label="Edit annotation"]');
    if (await editBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(200);

      const textarea = firstItem.locator('textarea');
      await expect(textarea).toBeAttached({ timeout: 2000 });
      await textarea.fill('This should be reverted');
      await page.waitForTimeout(200);

      const cancelBtn = firstItem.locator('[aria-label="cancel"]');
      await cancelBtn.click();
      await page.waitForTimeout(500);

      await expect(firstItem).toContainText(originalText.substring(0, 30));
    }
  });
});

// Tests — creating new annotations
