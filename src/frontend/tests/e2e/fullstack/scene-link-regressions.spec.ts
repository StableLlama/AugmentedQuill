// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Full-browser E2E regression tests for scene↔prose linking bugs
 * found during manual testing of the Scenes feature.
 *
 *   - BUG-1: Linking a SECOND scene into a chapter truncates the linked range
 *     (the `<!--scene:N:end-->` marker is placed too early), so the scene ends
 *     up linked to only a fragment of the selected paragraph.
 *   - BUG-2: Right after linking prose (before any reload), the Scene Editor
 *     dialog's "Linked Prose" field shows the WRONG (shifted) text range.
 *   - BUG-4: Undoing "Link scene prose" does not persist — no backend call is
 *     made, so the scene link and the chapter markers remain after reload.
 *
 * Each test FAILS against the current code and documents the expected
 * behaviour, so a fix can be verified against these assertions.
 *
 * Scenes are created through the backend API BEFORE the app loads (instead of
 * via the Add Scene dialog) because the dialog's own CodeMirror instances
 * unmount and clear the shared `window.__aqEditorView` global used to drive
 * the chapter editor selection deterministically.
 *
 * Self-contained: uses the temp-directory / ports (18000/18001) of the
 * fullstack config.  Run with:
 *   npx playwright test --config=playwright.fullstack.config.ts
 */

import { test, expect, type Page } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const FRONTEND = 'http://127.0.0.1:18001';
const PROJECT_LINK = 'e2e-scene-link-regression';
const PROJECT_LINK_2 = 'e2e-scene-link-regression-b2';
const PROJECT_UNDO = 'e2e-scene-undo-persist';

// Paragraph texts from the seeded chapter content (see playwright.fullstack.config).
// Each paragraph is a single line terminated by "\n".
const P1 = 'One apple falls from the tree in the orchard.';
const P2 = 'Two birds fly over the hill toward the lake.';

// Offsets in the visible (marker-free) editor document:
//   P1 spans [0, P1_END), P2 spans [P1_END, P2_END).
const P1_END = P1.length + 1; // 47
const P2_END = P1_END + P2.length + 1; // 92

async function selectProject(request: APIRequestContext, name: string): Promise<void> {
  const resp = await request.post('http://127.0.0.1:18000/api/v1/projects/select', {
    data: { name },
  });
  if (!resp.ok()) {
    throw new Error(`Failed to select project ${name}: ${resp.status()}`);
  }
}

/**
 * Create `count` brand-new unlinked scenes through the backend API so the app
 * loads with ready-to-link scene cards.
 */
async function createScenesViaApi(
  request: APIRequestContext,
  project: string,
  count: number
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const resp = await request.post(
      `http://127.0.0.1:18000/api/v1/projects/${project}/scenes`,
      { data: { summary: '', pinboard_x: 100, pinboard_y: 100 } }
    );
    if (!resp.ok()) {
      throw new Error(`Failed to create scene in ${project}: ${resp.status()}`);
    }
  }
}

/**
 * Select the project, create the requested scenes, load the app and switch to
 * Split Mode + Narrative view.
 */
async function setupApp(
  page: Page,
  request: APIRequestContext,
  project: string,
  sceneCount: number
): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await selectProject(request, project);
  await createScenesViaApi(request, project, sceneCount);

  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cm-content', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const splitBtn = page.locator('[title="Split Mode"]');
  if ((await splitBtn.count()) === 0) {
    await page.locator('text="Split Mode"').first().click({ timeout: 5000 });
  } else {
    await splitBtn.click({ timeout: 5000 });
  }
  await page.waitForTimeout(1200);

  const narrativeBtn = page.locator('button:has-text("Narrative")');
  if (await narrativeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await narrativeBtn.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Set the CodeMirror selection to [from, to] via the exposed editor view.
 * The editor runs with hideSceneMarkers=true, so these are visible offsets.
 */
async function setEditorSelection(page: Page, from: number, to: number): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(
        window as unknown as { __aqEditorView?: { dispatch: (spec: unknown) => void } }
      ).__aqEditorView,
    undefined,
    { timeout: 5000 }
  );

  const applied = await page.evaluate(
    (range: { from: number; to: number }): boolean => {
      const w = window as unknown as {
        __aqEditorView?: {
          dispatch: (spec: {
            selection: { anchor: number; head: number };
            scrollIntoView: boolean;
          }) => void;
          focus: () => void;
        };
      };
      const view = w.__aqEditorView;
      if (!view) return false;
      view.dispatch({
        selection: { anchor: range.from, head: range.to },
        scrollIntoView: true,
      });
      view.focus();
      return true;
    },
    { from, to }
  );

  if (!applied) {
    throw new Error(`Failed to set editor selection [${from}, ${to})`);
  }
  await page.waitForTimeout(300);
}

/**
 * Simulate the "drag prose from the editor onto a scene card" gesture by
 * dispatching the CodeMirror dragstart (which fills the custom
 * `application/aq-prose-selection` payload) followed by dragover/drop on the
 * target scene card.  Mirrors the app's real drop pipeline.
 */
async function dropSelectionOnScene(page: Page, sceneId: number): Promise<void> {
  const handled = await page.evaluate((targetSceneId: number): boolean => {
    const cm = document.querySelector('#codemirror-editor .cm-content');
    const card = document.querySelector(`[data-scene-card="${targetSceneId}"]`);
    if (!cm || !card) return false;
    const dt = new DataTransfer();
    cm.dispatchEvent(
      new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
    );
    if (!dt.types.includes('application/aq-prose-selection')) {
      return false;
    }
    const over = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    });
    card.dispatchEvent(over);
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    });
    card.dispatchEvent(drop);
    return drop.defaultPrevented;
  }, sceneId);

  if (!handled) {
    throw new Error(`Drop onto scene ${sceneId} was not handled`);
  }
  // Wait for the frontend → backend → frontend roundtrip.
  await page.waitForTimeout(3000);
}

async function linkedProseText(page: Page): Promise<string> {
  // Open the first scene card's editor dialog.
  await page.locator('[data-scene-card]').first().dblclick({ timeout: 5000 });
  const lp = page.getByRole('textbox', { name: /Linked Prose/i });
  await lp.waitFor({ timeout: 8000 });
  const text = ((await lp.textContent()) ?? '').trim();
  // Close the dialog.
  await page.getByRole('button', { name: /^Save$/i }).click({ timeout: 5000 });
  await page.waitForTimeout(1000);
  return text;
}

test.describe('Scene prose-link regressions — browser UX', () => {
  test('BUG-1: a second linked scene keeps its full paragraph', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await setupApp(page, request, PROJECT_LINK, 2);

    // Scene 1 → paragraph 1.
    await setEditorSelection(page, 0, P1_END);
    await dropSelectionOnScene(page, 1);

    // Scene 2 → paragraph 2.
    await setEditorSelection(page, P1_END, P2_END);
    await dropSelectionOnScene(page, 2);

    // The chapter content must contain the FULL paragraph 2 wrapped by
    // scene 2's markers (not a truncated fragment).  Parse the JSON payload
    // so the `content` newlines are unescaped before matching.
    const resp = await request.get(
      `http://127.0.0.1:18000/api/v1/projects/${PROJECT_LINK}/chapters/1`
    );
    const data = (await resp.json()) as { content: string };
    expect(data.content).toContain(`<!--scene:2:start-->${P2}\n<!--scene:2:end-->`);
  });

  test('BUG-2: linked prose is shown correctly in the Scene Editor right after linking', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await setupApp(page, request, PROJECT_LINK_2, 1);

    // Link paragraph 1 to the first scene, then read the Scene Editor's
    // "Linked Prose" field WITHOUT reloading the page.
    await setEditorSelection(page, 0, P1_END);
    await dropSelectionOnScene(page, 1);

    const shown = await linkedProseText(page);
    expect(shown).toBe(P1);
  });
});

test.describe('Scene undo persistence — browser UX', () => {
  test('BUG-4: undoing "Link scene prose" persists to the backend across reload', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await setupApp(page, request, PROJECT_UNDO, 1);

    // Link paragraph 1 to the first scene.
    await setEditorSelection(page, 0, P1_END);
    await dropSelectionOnScene(page, 1);

    // Undo the link.
    await page.locator('[aria-label^="Undo"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Reload — the undo must have persisted, so the scene must be unlinked on
    // the backend (prose_link null) and the chapter must have no markers.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.cm-content', { timeout: 15000 });
    await page.waitForTimeout(1500);

    const scenesResp = await request.get(
      `http://127.0.0.1:18000/api/v1/projects/${PROJECT_UNDO}/scenes`
    );
    const scenes = (await scenesResp.json()) as Array<{
      id: number;
      prose_link: { scope_type: string; start_offset: number } | null;
    }>;
    const scene = scenes.find((s: { id: number }) => s.id === 1);
    expect(scene).toBeDefined();
    // After a persisted undo the scene must be back in its UNLINKED state
    // (the app represents unlinked scenes with a runtime
    // `{ scope_type: 'unlinked' }` prose_link, not `null`).
    expect(scene?.prose_link?.scope_type ?? 'unlinked').toBe('unlinked');

    const chResp = await request.get(
      `http://127.0.0.1:18000/api/v1/projects/${PROJECT_UNDO}/chapters/1`
    );
    const chapter = (await chResp.json()) as { content: string };
    expect(chapter.content).not.toContain('<!--scene:1:start-->');
    expect(chapter.content).not.toContain('<!--scene:1:end-->');
  });
});
