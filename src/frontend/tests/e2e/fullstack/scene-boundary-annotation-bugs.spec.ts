// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Bug-hunt E2E tests documenting (currently FAILING) bugs in the
 * scene boundary-drag ↔ annotation coordinate system.
 *
 * The reported bug: with two ADJACENT scenes that each contain an annotation,
 * dragging the FIRST scene's END marker into the SECOND scene's range MOVES
 * the second scene's UNCHANGED end marker in the stored file.
 *
 * Reproduced root cause: in the backend `relink_scope_prose` annotation
 * re-injection, when an annotation's END position coincides with the SECOND
 * scene's END boundary (i.e. the annotation wraps the last word of scene 2),
 * `_map_to_linked` uses `pt <= stripped_pos`, so the annotation end marker is
 * placed AFTER the scene-2 end marker instead of BEFORE it — reordering
 * `<!--annotation:anno-b:end-->` past `<!--scene:2:end-->` and "moving" the
 * unchanged scene-2 end marker.
 *
 * These tests pin the CORRECT expected behaviour and FAIL against the current
 * code:
 *
 *   - the drag only changes the marker it is supposed to change,
 *   - the unaffected scene's far boundary marker stays put,
 *   - every annotation marker survives and keeps its text,
 *   - the visible prose is never altered,
 *   - undo after a drag restores the file exactly.
 *
 * Projects (see playwright.fullstack.config.ts):
 *   e2e-boundary-anno-test      anno-b wraps scene 2's FIRST word ("Delta")
 *   e2e-boundary-anno-end-test  anno-b wraps scene 2's LAST word ("Foxtrot")
 *
 * Run with: npx playwright test --config=playwright.fullstack.config.ts
 */

import { test, expect, type Page } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const FRONTEND = 'http://127.0.0.1:18001';
const BACKEND = 'http://127.0.0.1:18000';

const PROJECT_START_ANNO = 'e2e-boundary-anno-test';
const PROJECT_END_ANNO = 'e2e-boundary-anno-end-test';

const VISIBLE_TEXT = 'Alpha Bravo CharlieDelta Echo Foxtrot';

const PRISTINE_END_ANNO =
  '<!--scene:1:start--><!--annotation:anno-a:start-->Alpha<!--annotation:anno-a:end--> Bravo Charlie<!--scene:1:end-->' +
  '<!--scene:2:start-->Delta Echo <!--annotation:anno-b:start-->Foxtrot<!--annotation:anno-b:end--><!--scene:2:end-->';

const PRISTINE_START_ANNO =
  '<!--scene:1:start--><!--annotation:anno-a:start-->Alpha<!--annotation:anno-a:end--> Bravo Charlie<!--scene:1:end-->' +
  '<!--scene:2:start--><!--annotation:anno-b:start-->Delta<!--annotation:anno-b:end--> Echo Foxtrot<!--scene:2:end-->';

const PRE_SEEDED_ANNOS = ['anno-a', 'anno-b'];

/**
 * Restore *project* to its pristine seeded state via the API.  A single PUT of
 * the pristine chapter content fully resets coordinate state (scene ranges and
 * annotation offsets are re-derived from content markers on load, never
 * persisted).  Stray annotation records that are not pre-seeded are deleted.
 */
async function resetProject(
  request: APIRequestContext,
  project: string,
  pristine: string
): Promise<void> {
  const put = await request.put(
    `${BACKEND}/api/v1/projects/${project}/chapters/1/content`,
    { data: { content: pristine } }
  );
  if (!put.ok()) {
    throw new Error(`Reset chapter content failed: ${put.status()}`);
  }
  const annsResp = await request.get(
    `${BACKEND}/api/v1/projects/${project}/annotations`
  );
  if (!annsResp.ok()) {
    throw new Error(`GET annotations failed: ${annsResp.status()}`);
  }
  const anns = (await annsResp.json()) as Array<{ id: string }>;
  for (const ann of anns) {
    if (PRE_SEEDED_ANNOS.includes(ann.id)) continue;
    await request.delete(
      `${BACKEND}/api/v1/projects/${project}/annotations/${encodeURIComponent(ann.id)}`
    );
  }
}

function stripMarkers(content: string): string {
  return content.replace(/<!--(?:scene|annotation):[^:>]+:(?:start|end)-->/g, '');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function selectProject(
  request: APIRequestContext,
  project: string
): Promise<void> {
  const resp = await request.post(`${BACKEND}/api/v1/projects/select`, {
    data: { name: project },
  });
  if (!resp.ok()) {
    throw new Error(`select project failed: ${resp.status()}`);
  }
}

async function openApp(page: Page): Promise<void> {
  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#codemirror-editor .cm-content', { timeout: 15000 });
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
  const narrativeBtn = page.locator('button:has-text("Narrative")');
  if (await narrativeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await narrativeBtn.click();
    await page.waitForTimeout(500);
  }
}

/** Drag a scene boundary handle horizontally by deltaX pixels. */
async function dragHandle(
  page: Page,
  sceneId: number,
  edge: 'start' | 'end',
  deltaX: number
): Promise<void> {
  const handle = page.locator(`[data-testid="handle-${edge}-${sceneId}"]`);
  await handle.waitFor({ state: 'attached', timeout: 5000 });
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

async function chapterContent(
  request: APIRequestContext,
  project: string
): Promise<string> {
  const resp = await request.get(`${BACKEND}/api/v1/projects/${project}/chapters/1`);
  if (!resp.ok()) {
    throw new Error(`GET chapter failed: ${resp.status()}`);
  }
  const data = (await resp.json()) as { content: string };
  return data.content;
}

// ---------------------------------------------------------------------------
// The reported bug: anno-b wraps scene 2's LAST word, drag scene 1's END into
// scene 2 -> scene 2's unchanged end marker is moved / anno-b:end is reordered
// past scene2:end.
// ---------------------------------------------------------------------------

test.describe('REPORTED BUG: annotation at scene 2 end', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await resetProject(request, PROJECT_END_ANNO, PRISTINE_END_ANNO);
      await selectProject(request, PROJECT_END_ANNO);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('BUG: dragging scene 1 end into scene 2 keeps scene 2 end marker fixed', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    const before = await chapterContent(request, PROJECT_END_ANNO);
    const beforeEnd2 = before.indexOf('<!--scene:2:end-->'); // 211
    const beforeEnd1 = before.indexOf('<!--scene:1:end-->'); // 97

    // Select scene 1 and drag its END handle ~8 chars RIGHT into scene 2.
    await page.locator('[data-scene-card="1"]').click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    await dragHandle(page, 1, 'end', Math.round(8 * 9.5));

    const after = await chapterContent(request, PROJECT_END_ANNO);

    // Scene 1's end marker must have moved right (into scene 2).
    expect(after.indexOf('<!--scene:1:end-->')).toBeGreaterThan(beforeEnd1);

    // Scene 2's END marker is UNCHANGED — the drag must never move the far
    // end of the scene it is not dragging.  (REPORTED BUG: it moves.)
    expect(after.indexOf('<!--scene:2:end-->')).toBe(beforeEnd2);

    // anno-b's end marker must stay BEFORE scene 2's end marker (the
    // annotation is inside scene 2).  (REPORTED BUG: it is reordered AFTER.)
    expect(after.indexOf('<!--annotation:anno-b:end-->')).toBeLessThan(
      after.indexOf('<!--scene:2:end-->')
    );

    // Both annotations still wrap their words; no prose is altered.
    expect(after).toContain(
      '<!--annotation:anno-a:start-->Alpha<!--annotation:anno-a:end-->'
    );
    expect(stripMarkers(after)).toBe(VISIBLE_TEXT);
  });

  test('BUG: annotation anno-b keeps wrapping "Foxtrot" inside scene 2 after the drag', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    const before = await chapterContent(request, PROJECT_END_ANNO);

    await page.locator('[data-scene-card="1"]').click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    await dragHandle(page, 1, 'end', Math.round(8 * 9.5));

    const after = await chapterContent(request, PROJECT_END_ANNO);

    // The annotation's start/end must BOTH be inside scene 2 (after scene2:start
    // and before scene2:end), because "Foxtrot" is scene 2's last word.
    const start2 = after.indexOf('<!--scene:2:start-->');
    const end2 = after.indexOf('<!--scene:2:end-->');
    const annoBStart = after.indexOf('<!--annotation:anno-b:start-->');
    const annoBEnd = after.indexOf('<!--annotation:anno-b:end-->');
    expect(annoBStart).toBeGreaterThan(start2);
    expect(annoBEnd).toBeLessThan(end2);
    // (BUG: anno-b:end currently lands AFTER scene2:end.)
    expect(before.indexOf('<!--annotation:anno-b:end-->')).toBeGreaterThan(
      before.indexOf('<!--annotation:anno-b:start-->')
    );
  });

  test('BUG: shrinking scene 2 from the left keeps anno-b end before scene 2 end', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Drag scene 2's START handle RIGHT (scene 2 shrinks from the left).
    await page.locator('[data-scene-card="2"]').click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    await dragHandle(page, 2, 'start', Math.round(4 * 9.5));

    const after = await chapterContent(request, PROJECT_END_ANNO);
    // "Foxtrot" (anno-b) is still scene 2's last word: its end marker must
    // stay BEFORE scene 2's end marker.
    expect(after.indexOf('<!--annotation:anno-b:end-->')).toBeLessThan(
      after.indexOf('<!--scene:2:end-->')
    );
    expect(stripMarkers(after)).toBe(VISIBLE_TEXT);
  });

  test('BUG: expanding scene 2 to the right keeps anno-b end before scene 2 end', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Drag scene 2's END handle RIGHT (scene 2 expands).
    await page.locator('[data-scene-card="2"]').click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    await dragHandle(page, 2, 'end', Math.round(4 * 9.5));

    const after = await chapterContent(request, PROJECT_END_ANNO);
    expect(after.indexOf('<!--annotation:anno-b:end-->')).toBeLessThan(
      after.indexOf('<!--scene:2:end-->')
    );
    expect(stripMarkers(after)).toBe(VISIBLE_TEXT);
  });
});

// ---------------------------------------------------------------------------
// Control: annotation at scene 2's START (anno-b wraps "Delta").  The far-end
// marker invariant holds here — included to show the config difference.
// ---------------------------------------------------------------------------

test.describe('Control: annotation at scene 2 start', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await resetProject(request, PROJECT_START_ANNO, PRISTINE_START_ANNO);
      await selectProject(request, PROJECT_START_ANNO);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('dragging scene 1 end into scene 2 keeps scene 2 end marker fixed', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    const before = await chapterContent(request, PROJECT_START_ANNO);
    const beforeEnd2 = before.indexOf('<!--scene:2:end-->'); // 211

    await page.locator('[data-scene-card="1"]').click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    await dragHandle(page, 1, 'end', Math.round(8 * 9.5));

    const after = await chapterContent(request, PROJECT_START_ANNO);
    expect(after.indexOf('<!--scene:2:end-->')).toBe(beforeEnd2);
    expect(stripMarkers(after)).toBe(VISIBLE_TEXT);
  });
});

// ---------------------------------------------------------------------------
// Undo after the reorder drag must restore the file exactly.
// ---------------------------------------------------------------------------

test.describe('Undo after the reorder drag', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await resetProject(request, PROJECT_END_ANNO, PRISTINE_END_ANNO);
      await selectProject(request, PROJECT_END_ANNO);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('BUG: undo after dragging scene 1 end into scene 2 restores the pristine file exactly', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.locator('[data-scene-card="1"]').click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    await dragHandle(page, 1, 'end', Math.round(8 * 9.5));

    // Undo via the undo history menu entry for the boundary adjustment.
    await page.locator('[aria-label="Show undo history"]').click();
    const undoItem = page
      .locator('[role="menuitem"]')
      .filter({ hasText: 'Adjust scene prose boundary' })
      .first();
    await undoItem.click();
    await page.waitForTimeout(2500);

    // The file must be byte-for-byte identical to the pristine content.
    expect(await chapterContent(request, PROJECT_END_ANNO)).toBe(PRISTINE_END_ANNO);
    expect(await page.locator('#codemirror-editor .cm-content').textContent()).toBe(
      VISIBLE_TEXT
    );
  });
});
