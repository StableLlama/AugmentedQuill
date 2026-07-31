// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Full-browser E2E tests covering the fixed scene-editing bugs from
 * bug_reports_scene_editing.md:
 *
 *   - BUG-1: A brand-new (unlinked) scene must NOT expose an editable "Linked
 *     Prose" field or an "Unlink prose" action.  Typing there previously
 *     inserted prose into the chapter at a wrong offset, splitting words.
 *   - BUG-2: Editing a linked scene's prose must be undone cleanly — the
 *     chapter prose returns to its previous text after Undo.
 *   - BUG-6: Undo of "Delete Scene" must persist — the scene must still exist
 *     after a page reload.
 *
 * Self-contained: uses the temp-directory / ports (18000/18001) of the
 * fullstack config.  Run with:
 *   npx playwright test --config=playwright.fullstack.config.ts
 */

import { test, expect, type Page } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const FRONTEND = 'http://127.0.0.1:18001';
const PROJECT_LINK = 'e2e-scene-link-test';
const PROJECT_UNDO_LINK = 'e2e-scene-undo-link-test';
const PROJECT_DELETE_UNDO = 'e2e-scene-delete-undo-test';

async function selectProject(request: APIRequestContext, name: string): Promise<void> {
  const resp = await request.post('http://127.0.0.1:18000/api/v1/projects/select', {
    data: { name },
  });
  if (!resp.ok()) {
    throw new Error(`Failed to select project ${name}: ${resp.status()}`);
  }
}

async function openApp(page: Page): Promise<void> {
  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cm-content', { timeout: 15000 });
  await page.waitForTimeout(1500);
}

async function switchToSplitMode(page: Page): Promise<void> {
  const splitBtn = page.locator('[title="Split Mode"]');
  if ((await splitBtn.count()) === 0) {
    await page.locator('text="Split Mode"').first().click({ timeout: 5000 });
  } else {
    await splitBtn.click({ timeout: 5000 });
  }
  await page.waitForTimeout(1200);
}

async function addScene(page: Page): Promise<void> {
  await page.locator('button:has-text("Add Scene")').first().click({ timeout: 5000 });
  // A brand-new scene is unlinked, so the dialog shows the drag-to-link hint
  // (no editable "Linked Prose" field) once it opens.
  await page
    .getByText('Drag prose from the editor to link this scene')
    .first()
    .waitFor({ timeout: 8000 });
}

async function saveScene(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Save$/i }).click({ timeout: 5000 });
  // Allow the prose-content + chapter-content + scene roundtrip to settle.
  await page.waitForTimeout(3000);
}

async function chapterText(page: Page): Promise<string> {
  // Take the longest .cm-content text (the chapter editor body).
  const contents = page.locator('.cm-content');
  const count = await contents.count();
  let longest = '';
  for (let i = 0; i < count; i += 1) {
    const t = await contents.nth(i).textContent();
    if (t && t.length > longest.length) longest = t;
  }
  return longest;
}

async function sceneCount(page: Page): Promise<number> {
  return page.locator('[data-scene-card]').count();
}

test.describe('BUG-1: brand-new scenes must not expose the Linked Prose editor', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await selectProject(request, PROJECT_LINK);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('a new scene shows the drag-to-link hint and no editable Linked Prose field', async ({
    page,
  }: {
    page: Page;
  }) => {
    await addScene(page);

    // The unlinked scene must NOT offer an editable Linked Prose field or an
    // Unlink action — typing there previously inserted prose mid-word (BUG-1).
    await expect(page.getByRole('textbox', { name: /Linked Prose/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Unlink prose/i })).toHaveCount(0);
    await expect(
      page.getByText('Drag prose from the editor to link this scene')
    ).toBeVisible();
  });
});

test.describe('BUG-2: undo of a linked-prose edit reverts the chapter', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await selectProject(request, PROJECT_UNDO_LINK);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('undoing a linked-prose edit persists the revert to the backend', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Scene 1 is pre-linked to the word "Bravo".
    await page.locator('[data-scene-card="1"]').dblclick({ timeout: 5000 });
    const lp = page.getByRole('textbox', { name: /Linked Prose/i });
    await lp.waitFor({ timeout: 8000 });
    // Replace the linked prose ("Bravo") with "Zulu".  fill() reliably selects
    // and replaces the content of the CodeMirror contenteditable.
    await lp.fill('Zulu');
    await saveScene(page);

    // The edit is reflected in the backend chapter AND the scene markers are
    // preserved (no marker-stripping corruption from the editor autosave).
    const afterSave = await request.get(
      `http://127.0.0.1:18000/api/v1/projects/${PROJECT_UNDO_LINK}/chapters/1`
    );
    const afterSaveText = await afterSave.text();
    expect(afterSaveText).toContain('Zulu');
    expect(afterSaveText).toContain('<!--scene:1:start-->');

    // Undo the linked-prose edit via the undo history menu, targeting the
    // "Edit scene linked prose" entry whose onUndo persists the revert.
    await page.locator('[aria-label="Show undo history"]').click();
    const menuItems = page.locator('[role="menuitem"]');
    const undoItem = menuItems.filter({ hasText: 'Edit scene linked prose' }).first();
    await undoItem.click({ timeout: 5000 });
    await page.waitForTimeout(3000);

    // The revert must be persisted on the backend (BUG-2), not just in memory,
    // and the scene markers must remain intact.
    const afterUndo = await request.get(
      `http://127.0.0.1:18000/api/v1/projects/${PROJECT_UNDO_LINK}/chapters/1`
    );
    const text = await afterUndo.text();
    expect(text).toContain('Bravo');
    expect(text).not.toContain('Zulu');
    expect(text).toContain('<!--scene:1:start-->');
  });
});

test.describe('BUG-6: undo of Delete Scene must persist across reload', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await selectProject(request, PROJECT_DELETE_UNDO);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('deleted scene survives undo + page reload', async ({
    page,
  }: {
    page: Page;
  }) => {
    // Create one scene and persist it.
    await addScene(page);
    await saveScene(page);
    expect(await sceneCount(page)).toBe(1);

    // Reopen the scene editor and delete it via the two-step confirmation.
    await page.locator('[data-scene-card]').first().dblclick({ timeout: 5000 });
    const deleteBtn = page.getByRole('button', { name: /Delete Scene/i });
    await deleteBtn.waitFor({ timeout: 8000 });
    await deleteBtn.click();
    await page.waitForTimeout(500);
    // The same label now acts as the confirm button.
    await page.getByRole('button', { name: /Delete Scene/i }).click();
    await page.waitForTimeout(2000);
    expect(await sceneCount(page)).toBe(0);

    // Undo restores the scene in the UI.
    await page.locator('[aria-label^="Undo"]').click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    expect(await sceneCount(page)).toBe(1);

    // Reload — the restored scene must still exist (the undo re-creates it on
    // the backend, BUG-6).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.cm-content', { timeout: 15000 });
    await page.waitForTimeout(1500);
    await switchToSplitMode(page);
    expect(await sceneCount(page)).toBe(1);
  });
});
