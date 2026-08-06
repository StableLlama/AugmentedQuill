// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box, high-level E2E integrity tests for the scene-linked
 * prose ↔ annotation coordinate system.
 *
 * The editor runs with `hideSceneMarkers=true`: internal markers
 * (`<!--scene:...-->`, `<!--annotation:...-->`) are stripped from the visible
 * document, and every user gesture (selection, drag, annotation creation)
 * must be converted back to RAW (marker-inclusive) offsets before it reaches
 * the backend.  Bugs in this conversion silently corrupt the project file —
 * the worst kind of bug, because the stored prose no longer matches what the
 * author sees in the editor.
 *
 * These tests operate ONLY through the public browser UI + HTTP API (black
 * box) and always assert the invariant:
 *
 *     what the editor DISPLAYS  ===  what the backend FILE stores
 *
 * after every operation: annotation create/delete, scene prose link/unlink,
 * boundary drag, undo/redo, and plain text edits.
 *
 * Seeded project (`e2e-integrity-test`, see playwright.fullstack.config.ts):
 *   Visible text:  "Alpha Bravo CharlieDelta Echo Foxtrot"
 *     scene 1 -> "Alpha Bravo Charlie"   (visible [0, 19))
 *     scene 2 -> "Delta Echo Foxtrot"    (visible [19, 37))
 *     anno-1  -> "Alpha"                 (visible [0, 5))
 *
 * Each test starts from a pristine project (reset via the API in beforeEach),
 * so tests never leak state into each other.
 *
 * Run with: npx playwright test --config=playwright.fullstack.config.ts
 */

import { test, expect, type Page } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const FRONTEND = 'http://127.0.0.1:18001';
const BACKEND = 'http://127.0.0.1:18000';
const PROJECT = 'e2e-integrity-test';

// Visible (marker-stripped) chapter text.
const VISIBLE_TEXT = 'Alpha Bravo CharlieDelta Echo Foxtrot';

// Pristine marker-inclusive chapter content (matches the config seeding).
const PRISTINE_CONTENT =
  '<!--scene:1:start--><!--annotation:anno-1:start-->Alpha<!--annotation:anno-1:end--> Bravo Charlie<!--scene:1:end--><!--scene:2:start-->Delta Echo Foxtrot<!--scene:2:end-->';

// Visible offsets:
//   scene 1 = [0, 19) "Alpha Bravo Charlie"
//   "Alpha" = [0, 5), "Bravo" = [6, 11), "Charlie" = [12, 19)
//   scene 2 = [19, 37) "Delta Echo Foxtrot"

// Approximate editor metrics (used by the existing annotation-ux spec too).
const CHAR_WIDTH = 9.5;
const LEFT_PAD = 20;
const LINE_Y = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function selectProject(request: APIRequestContext, name: string): Promise<void> {
  const resp = await request.post(`${BACKEND}/api/v1/projects/select`, {
    data: { name },
  });
  if (!resp.ok()) {
    throw new Error(`Failed to select project ${name}: ${resp.status()}`);
  }
}

/**
 * Reset the project to its pristine seeded state via the API: restore the
 * chapter content and delete every annotation except the pre-seeded anno-1.
 * Scenes keep their original prose_link offsets (still valid once the
 * pristine content is restored).
 */
async function resetProject(request: APIRequestContext): Promise<void> {
  const put = await request.put(
    `${BACKEND}/api/v1/projects/${PROJECT}/chapters/1/content`,
    { data: { content: PRISTINE_CONTENT } }
  );
  if (!put.ok()) {
    throw new Error(`Reset chapter content failed: ${put.status()}`);
  }
  const anns = await backendAnnotations(request);
  for (const a of anns) {
    if (a.id === 'anno-1') continue;
    await request.delete(
      `${BACKEND}/api/v1/projects/${PROJECT}/annotations/${encodeURIComponent(a.id)}`
    );
  }
}

/** Open the app, select the project, wait for the editor to mount. */
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

/** Set the CodeMirror selection via the exposed view (visible offsets). */
async function setEditorSelection(page: Page, from: number, to: number): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(
        window as unknown as { __aqEditorView?: { dispatch: (spec: unknown) => void } }
      ).__aqEditorView,
    undefined,
    { timeout: 8000 }
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
 * Viewport coordinates of a visible character offset on the first editor line,
 * using the same char-metrics as the existing annotation-ux spec.
 */
async function charPoint(
  page: Page,
  offset: number
): Promise<{ x: number; y: number }> {
  const box = await page.locator('#codemirror-editor .cm-content').boundingBox();
  if (!box) throw new Error('editor .cm-content not found');
  return { x: box.x + LEFT_PAD + offset * CHAR_WIDTH, y: box.y + LINE_Y };
}

/** The visible text currently shown in the chapter editor. */
async function editorVisibleText(page: Page): Promise<string> {
  return (await page.locator('#codemirror-editor .cm-content').textContent()) ?? '';
}

/** Raw chapter content (marker-inclusive) as stored on the backend. */
async function backendChapterContent(request: APIRequestContext): Promise<string> {
  const resp = await request.get(`${BACKEND}/api/v1/projects/${PROJECT}/chapters/1`);
  if (!resp.ok()) {
    throw new Error(`GET chapter failed: ${resp.status()}`);
  }
  const data = (await resp.json()) as { content: string };
  return data.content;
}

/** All annotations on the backend, including runtime offsets. */
async function backendAnnotations(
  request: APIRequestContext
): Promise<Array<{ id: string; comment: string }>> {
  const resp = await request.get(`${BACKEND}/api/v1/projects/${PROJECT}/annotations`);
  if (!resp.ok()) {
    throw new Error(`GET annotations failed: ${resp.status()}`);
  }
  return (await resp.json()) as Array<{ id: string; comment: string }>;
}

/**
 * Create an annotation from the current editor selection via Ctrl+Shift+A.
 * Returns the created annotation id.
 */
async function createAnnotationFromSelection(
  page: Page,
  request: APIRequestContext,
  comment: string
): Promise<string> {
  await page.keyboard.press('Control+Shift+KeyA');
  await page.waitForTimeout(500);
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeAttached({ timeout: 5000 });
  const textarea = dialog.locator('textarea');
  await expect(textarea).toBeAttached({ timeout: 3000 });
  await textarea.fill(comment);
  await page.waitForTimeout(200);
  const submitBtn = dialog.locator('button[type="submit"]');
  await expect(submitBtn).toBeEnabled({ timeout: 2000 });
  await submitBtn.click();
  await page.waitForTimeout(1200);
  await expect(dialog).not.toBeAttached({ timeout: 3000 });

  const anns = await backendAnnotations(request);
  const created = anns.find(
    (a: { id: string; comment: string }) => a.comment === comment
  );
  if (!created) throw new Error('Created annotation not found on backend');
  return created.id;
}

/** All texts currently covered by annotation highlight decorations. */
async function annotationHighlightTexts(page: Page): Promise<string[]> {
  const highlights = page.locator('.cm-annotation-range');
  const count = await highlights.count();
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push((await highlights.nth(i).textContent()) ?? '');
  }
  return out;
}

/** The concatenated text covered by all scene prose-link highlights. */
async function proseHighlightText(page: Page): Promise<string> {
  const highlights = page.locator('.cm-prose-link-highlight');
  const count = await highlights.count();
  let out = '';
  for (let i = 0; i < count; i += 1) {
    out += (await highlights.nth(i).textContent()) ?? '';
  }
  return out;
}

/** Strip all internal marker tokens from a raw content string. */
function stripMarkers(content: string): string {
  return content.replace(/<!--(?:scene|annotation):[^:>]+:(?:start|end)-->/g, '');
}

/** True when the raw content is intact: markers wrap exactly the seeded spans. */
function assertMarkersIntact(content: string): void {
  // Exactly one scene-1 start/end pair, one scene-2 pair.
  expect(content.match(/<!--scene:1:start-->/g)?.length ?? 0).toBe(1);
  expect(content.match(/<!--scene:1:end-->/g)?.length ?? 0).toBe(1);
  expect(content.match(/<!--scene:2:start-->/g)?.length ?? 0).toBe(1);
  expect(content.match(/<!--scene:2:end-->/g)?.length ?? 0).toBe(1);
  // Scene 1 wraps exactly "Alpha Bravo Charlie", scene 2 wraps "Delta Echo Foxtrot".
  const scene1 = /<!--scene:1:start-->([\s\S]*?)<!--scene:1:end-->/.exec(content)?.[1];
  const scene2 = /<!--scene:2:start-->([\s\S]*?)<!--scene:2:end-->/.exec(content)?.[1];
  expect(stripMarkers(scene1 ?? '')).toBe('Alpha Bravo Charlie');
  expect(stripMarkers(scene2 ?? '')).toBe('Delta Echo Foxtrot');
  // Scene markers are not nested/interleaved.
  expect(content.indexOf('<!--scene:1:start-->')).toBeLessThan(
    content.indexOf('<!--scene:1:end-->')
  );
  expect(content.indexOf('<!--scene:1:end-->')).toBeLessThan(
    content.indexOf('<!--scene:2:start-->')
  );
  // Visible text is unchanged.
  expect(stripMarkers(content)).toBe(VISIBLE_TEXT);
}

// ---------------------------------------------------------------------------
// Bug A: context-menu "Add annotation"
// ---------------------------------------------------------------------------

test.describe('Context-menu annotation creation', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await selectProject(request, PROJECT);
      await resetProject(request);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('real right-click -> click "Add annotation" opens the dialog and persists', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Select "Bravo" (visible [6, 11)) deterministically inside scene 1.
    await setEditorSelection(page, 6, 11);

    // Right-click at the middle of the selection (real mouse).
    const pos = await charPoint(page, 8);
    await page.mouse.click(pos.x, pos.y, { button: 'right' });
    await page.waitForTimeout(500);

    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeAttached({ timeout: 5000 });

    // Real left-click on the "Add annotation" menu item.
    const addBtn = contextMenu.locator('[role="menuitem"]');
    await addBtn.waitFor({ timeout: 3000 });
    const box = await addBtn.boundingBox();
    if (!box) throw new Error('Add annotation menu item has no box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);

    // The annotation dialog MUST open.
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeAttached({ timeout: 5000 });

    // Creating through it must persist an annotation on the backend.
    const textarea = dialog.locator('textarea');
    await textarea.fill('Context menu annotation');
    const submitBtn = dialog.locator('button[type="submit"]');
    await submitBtn.click();
    await page.waitForTimeout(1200);

    const anns = await backendAnnotations(request);
    const created = anns.find(
      (a: { id: string; comment: string }) => a.comment === 'Context menu annotation'
    );
    expect(created).toBeDefined();

    // The annotation must wrap exactly "Bravo" in the file, and the file must
    // otherwise be intact.
    const content = await backendChapterContent(request);
    expect(content).toContain(
      `<!--annotation:${created!.id}:start-->Bravo<!--annotation:${created!.id}:end-->`
    );
    assertMarkersIntact(content);
    expect(await editorVisibleText(page)).toBe(VISIBLE_TEXT);
  });
});

// ---------------------------------------------------------------------------
// Bug B: Ctrl+Shift+A must not disturb the scene's linked prose
// ---------------------------------------------------------------------------

test.describe('Annotation in scene-linked prose preserves scene linkage', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await selectProject(request, PROJECT);
      await resetProject(request);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('Ctrl+Shift+A annotation wraps exactly the selected word', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Select "Bravo" (visible [6, 11)) inside scene 1.
    await setEditorSelection(page, 6, 11);
    await page.waitForTimeout(300);

    // Create an annotation on "Bravo".
    const comment = 'Integrity annotation on Bravo';
    const createdId = await createAnnotationFromSelection(page, request, comment);
    expect(createdId).toMatch(/^annot-/);

    // The backend file must wrap EXACTLY "Bravo" with the new annotation
    // markers — no extra prose swallowed.
    const afterContent = await backendChapterContent(request);
    const marker = `<!--annotation:${createdId}:start-->Bravo<!--annotation:${createdId}:end-->`;
    expect(afterContent).toContain(marker);

    // Scene markers + visible text must be untouched.
    assertMarkersIntact(afterContent);
    expect(await editorVisibleText(page)).toBe(VISIBLE_TEXT);

    // The annotation highlight in the editor must cover exactly "Bravo".
    expect(await annotationHighlightTexts(page)).toContain('Bravo');
  });

  test('annotation whose end lands on a marker boundary does not swallow the marker', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Select "Alpha" (visible [0, 5)) — its end lands exactly on the anno-1
    // end-marker boundary.  The annotation must wrap only "Alpha", not the
    // marker or the prose after it.
    await setEditorSelection(page, 0, 5);
    const comment = 'boundary annotation';
    const createdId = await createAnnotationFromSelection(page, request, comment);

    const content = await backendChapterContent(request);
    const marker = `<!--annotation:${createdId}:start-->Alpha<!--annotation:${createdId}:end-->`;
    expect(content).toContain(marker);

    // anno-1's span must still wrap exactly "Alpha" (nested or adjacent, but
    // the scene markers must stay intact and at the correct place).
    assertMarkersIntact(content);
    expect(await editorVisibleText(page)).toBe(VISIBLE_TEXT);
  });

  test('scene highlight range is stable after adding an annotation', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Place the cursor inside scene 1 prose: scene 1 prose must be highlighted.
    await setEditorSelection(page, 2, 2);
    await page.waitForTimeout(400);
    expect(await proseHighlightText(page)).toBe('Alpha Bravo Charlie');

    // Select "Charlie" (visible [12, 19)) and annotate it.
    await setEditorSelection(page, 12, 19);
    await createAnnotationFromSelection(page, request, 'annotation on Charlie');
    await page.waitForTimeout(500);

    // Move the cursor back inside scene 1: the highlight must STILL cover
    // exactly "Alpha Bravo Charlie" (not shifted/shrunk by the annotation).
    await setEditorSelection(page, 2, 2);
    await page.waitForTimeout(400);
    expect(await proseHighlightText(page)).toBe('Alpha Bravo Charlie');

    // Scene 1 prose on the backend is intact (with the new annotation inside).
    const content = await backendChapterContent(request);
    assertMarkersIntact(content);
    const scene1Span = /<!--scene:1:start-->([\s\S]*?)<!--scene:1:end-->/.exec(
      content
    )?.[1];
    expect(stripMarkers(scene1Span ?? '')).toBe('Alpha Bravo Charlie');
  });

  test('annotation in scene 2 does not disturb scene 1 or scene 2 linkage', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Select "Delta" (visible [19, 24)) in scene 2 and annotate it.
    await setEditorSelection(page, 19, 24);
    const createdId = await createAnnotationFromSelection(
      page,
      request,
      'annotation on Delta'
    );

    const content = await backendChapterContent(request);
    expect(content).toContain(
      `<!--annotation:${createdId}:start-->Delta<!--annotation:${createdId}:end-->`
    );
    assertMarkersIntact(content);
    expect(await editorVisibleText(page)).toBe(VISIBLE_TEXT);
  });
});

// ---------------------------------------------------------------------------
// Annotation delete keeps file and display in sync
// ---------------------------------------------------------------------------

test.describe('Annotation delete integrity', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await selectProject(request, PROJECT);
      await resetProject(request);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('deleting an annotation removes its markers from the file and display', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Create an annotation on "Bravo".
    await setEditorSelection(page, 6, 11);
    const id = await createAnnotationFromSelection(
      page,
      request,
      'delete me annotation'
    );
    expect(await annotationHighlightTexts(page)).toContain('Bravo');

    // Delete it through the annotation panel.
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });
    const item = panel
      .locator('[role="button"]')
      .filter({ hasText: 'delete me annotation' });
    await expect(item).toBeAttached({ timeout: 5000 });
    await item.hover();
    const delBtn = item.locator('[aria-label="Delete annotation"]');
    await expect(delBtn).toBeAttached({ timeout: 3000 });
    await delBtn.click();
    await page.waitForTimeout(1500);

    // File: markers gone, content back to pristine (plus unchanged anno-1).
    const content = await backendChapterContent(request);
    expect(content).not.toContain(`<!--annotation:${id}:start-->`);
    expect(content).not.toContain(`<!--annotation:${id}:end-->`);
    assertMarkersIntact(content);
    expect(await editorVisibleText(page)).toBe(VISIBLE_TEXT);

    // Display: only anno-1's highlight remains.
    expect(await annotationHighlightTexts(page)).toContain('Alpha');
    expect(await annotationHighlightTexts(page)).not.toContain('Bravo');
  });
});

// ---------------------------------------------------------------------------
// Text edits keep markers intact (write / delete / edit)
// ---------------------------------------------------------------------------

test.describe('Text edits preserve markers and file==display', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await selectProject(request, PROJECT);
      await resetProject(request);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('inserting text inside scene 1 keeps markers aligned', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Place the cursor after "Alpha" (visible offset 5) and type.
    await setEditorSelection(page, 5, 5);
    await page.keyboard.type('X');
    // Wait for the debounced autosave roundtrip.
    await page.waitForTimeout(2500);

    const content = await backendChapterContent(request);
    // Scene 1 must now contain "AlphaX Bravo Charlie" and BOTH scene markers
    // must survive the autosave (this was previously corrupted).
    const scene1Span = /<!--scene:1:start-->([\s\S]*?)<!--scene:1:end-->/.exec(
      content
    )?.[1];
    expect(stripMarkers(scene1Span ?? '')).toBe('AlphaX Bravo Charlie');
    expect(stripMarkers(content)).toBe('AlphaX Bravo CharlieDelta Echo Foxtrot');
    expect(content).toContain('<!--scene:1:start-->');
    expect(content).toContain('<!--scene:2:start-->');
    // anno-1 markers must still be present (the X lands at anno-1's end
    // boundary, so the annotation may legitimately include it).
    expect(content).toContain('<!--annotation:anno-1:start-->');
    expect(content).toContain('<!--annotation:anno-1:end-->');

    // Display matches file.
    expect(await editorVisibleText(page)).toBe(
      'AlphaX Bravo CharlieDelta Echo Foxtrot'
    );
  });

  test('deleting text inside scene 1 keeps markers aligned', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Select "Bravo " (visible [6, 12)) and delete.
    await setEditorSelection(page, 6, 12);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(2500);

    const content = await backendChapterContent(request);
    const scene1Span = /<!--scene:1:start-->([\s\S]*?)<!--scene:1:end-->/.exec(
      content
    )?.[1];
    expect(stripMarkers(scene1Span ?? '')).toBe('Alpha Charlie');
    expect(stripMarkers(content)).toBe('Alpha CharlieDelta Echo Foxtrot');
    expect(content).toContain('<!--scene:1:start-->');
    expect(content).toContain('<!--scene:1:end-->');

    expect(await editorVisibleText(page)).toBe('Alpha CharlieDelta Echo Foxtrot');
  });

  test('editing across the scene 1/2 boundary keeps both scenes intact', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Place the cursor at the scene 1/2 boundary (visible offset 19, the
    // position right after "Charlie") and type.  The "!" may land on either
    // side of the invisible boundary — what matters is that both scene marker
    // pairs survive, stay correctly ordered, and the visible text matches.
    await setEditorSelection(page, 19, 19);
    await page.keyboard.type('!');
    await page.waitForTimeout(2500);

    const content = await backendChapterContent(request);
    const s1start = content.indexOf('<!--scene:1:start-->');
    const s1end = content.indexOf('<!--scene:1:end-->');
    const s2start = content.indexOf('<!--scene:2:start-->');
    const s2end = content.indexOf('<!--scene:2:end-->');
    expect(s1start).toBeGreaterThanOrEqual(0);
    expect(s1end).toBeGreaterThan(s1start);
    expect(s2start).toBeGreaterThan(s1end);
    expect(s2end).toBeGreaterThan(s2start);
    expect(content.match(/<!--scene:1:start-->/g)).toHaveLength(1);
    expect(content.match(/<!--scene:2:start-->/g)).toHaveLength(1);
    expect(stripMarkers(content)).toBe('Alpha Bravo Charlie!Delta Echo Foxtrot');
    expect(await editorVisibleText(page)).toBe(
      'Alpha Bravo Charlie!Delta Echo Foxtrot'
    );
  });
});

// ---------------------------------------------------------------------------
// Scene boundary drag keeps file and display in sync
// ---------------------------------------------------------------------------

/** Drag a scene boundary handle horizontally by deltaX pixels. */
async function dragHandle(
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
  // Frontend → backend → frontend store → React re-render roundtrip.
  await page.waitForTimeout(3000);
}

test.describe('Scene boundary drag keeps file and display in sync', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await selectProject(request, PROJECT);
      await resetProject(request);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('dragging the scene 1/2 boundary keeps markers balanced and file==display', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Select scene 1 to show its boundary handles.
    await page.locator('[data-scene-card="1"]').click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    const endHandle = page.locator('[data-testid="handle-end-1"]');
    await expect(endHandle).toBeAttached({ timeout: 5000 });

    const beforeBox = await endHandle.boundingBox();
    if (!beforeBox) throw new Error('end handle has no box');

    // Drag scene 1's end handle LEFT (~3 characters) so scene 1 shrinks.
    await dragHandle(page, 1, 'end', -Math.round(3 * CHAR_WIDTH));

    const afterBox = await endHandle.boundingBox();
    expect(afterBox && afterBox.x).toBeLessThan(beforeBox.x);

    // File invariants: both scenes still present, balanced and ordered, the
    // shared boundary moved left, and NO prose was lost.
    const content = await backendChapterContent(request);
    expect(stripMarkers(content)).toBe(VISIBLE_TEXT);
    const s1s = content.indexOf('<!--scene:1:start-->');
    const s1e = content.indexOf('<!--scene:1:end-->');
    const s2s = content.indexOf('<!--scene:2:start-->');
    const s2e = content.indexOf('<!--scene:2:end-->');
    expect(s1s).toBeGreaterThanOrEqual(0);
    expect(s1e).toBeGreaterThan(s1s);
    expect(s2s).toBeGreaterThanOrEqual(s1e);
    expect(s2e).toBeGreaterThan(s2s);
    // The boundary moved left of its original position (97 = after "Alpha
    // Bravo Charlie" in the pristine content).
    expect(s1e).toBeLessThan(97);

    // Display still matches the file's visible text.
    expect(await editorVisibleText(page)).toBe(VISIBLE_TEXT);
  });
});

// ---------------------------------------------------------------------------
// Scene prose link / unlink integrity
// ---------------------------------------------------------------------------

/** Simulate dragging the current editor selection onto a scene card. */
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
  await page.waitForTimeout(3000);
}

test.describe('Scene prose link/unlink integrity', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await selectProject(request, PROJECT);
      await resetProject(request);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('linking prose to a new unlinked scene keeps file==display', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Create a brand-new unlinked scene (id 3) through the API, then reload
    // so the pinboard picks it up.
    const resp = await request.post(`${BACKEND}/api/v1/projects/${PROJECT}/scenes`, {
      data: { summary: 'New scene', pinboard_x: 100, pinboard_y: 100 },
    });
    expect(resp.ok()).toBe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#codemirror-editor .cm-content', { timeout: 15000 });
    await page.waitForTimeout(1500);
    await switchToSplitMode(page);

    // Select "Charlie" (visible [12, 19)) and link it to scene 3.
    await setEditorSelection(page, 12, 19);
    await dropSelectionOnScene(page, 3);

    // File: scene 3 now wraps EXACTLY "Charlie" (no swallowed prose from the
    // adjacent scene).  Scene markers are exclusive, so scene 1 (whose prose
    // contained "Charlie") is unlinked by the backend; scene 2 stays intact.
    const content = await backendChapterContent(request);
    expect(content).toContain('<!--scene:3:start-->Charlie<!--scene:3:end-->');
    expect(content).not.toContain('<!--scene:1:start-->');
    expect(content).not.toContain('<!--scene:1:end-->');
    expect(content).toContain('<!--scene:2:start-->');
    expect(content).toContain('<!--annotation:anno-1:start-->');
    expect(stripMarkers(content)).toBe(VISIBLE_TEXT);
    expect(await editorVisibleText(page)).toBe(VISIBLE_TEXT);
  });

  test('unlinking prose removes the markers and keeps file==display', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Open scene 2's editor dialog and unlink its prose.
    await page.locator('[data-scene-card="2"]').dblclick({ timeout: 5000 });
    const unlinkBtn = page.getByRole('button', { name: /Unlink prose/i });
    await expect(unlinkBtn).toBeAttached({ timeout: 8000 });
    await unlinkBtn.click();
    await page.waitForTimeout(2000);

    // File: scene 2 markers are gone, scene 1 intact, no prose lost.
    const content = await backendChapterContent(request);
    expect(content).not.toContain('<!--scene:2:start-->');
    expect(content).not.toContain('<!--scene:2:end-->');
    expect(content).toContain('<!--scene:1:start-->');
    expect(stripMarkers(content)).toBe(VISIBLE_TEXT);
    expect(await editorVisibleText(page)).toBe(VISIBLE_TEXT);
  });
});

// ---------------------------------------------------------------------------
// Undo / redo persistence
// ---------------------------------------------------------------------------

test.describe('Undo/redo persists file==display', () => {
  test.beforeEach(
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await selectProject(request, PROJECT);
      await resetProject(request);
      await openApp(page);
      await switchToSplitMode(page);
    }
  );

  test('undo and redo of a text edit both persist to the backend', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Type "X" after "Alpha" inside scene 1.
    await setEditorSelection(page, 5, 5);
    await page.keyboard.type('X');
    await page.waitForTimeout(2500);

    let content = await backendChapterContent(request);
    expect(stripMarkers(content)).toContain('AlphaX');
    expect(content).toContain('<!--scene:1:start-->');

    // Undo via the header button (prefers the editor's CodeMirror undo).
    await page.locator('[title^="Undo"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(2500);

    content = await backendChapterContent(request);
    expect(stripMarkers(content)).toBe(VISIBLE_TEXT);
    expect(stripMarkers(content)).not.toContain('AlphaX');
    expect(content).toContain('<!--scene:1:start-->');

    // Redo by dispatching Ctrl+Shift+Z directly to the CodeMirror content
    // (the header Redo button reflects story history, which does not cover
    // editor-only text edits, so it is disabled here).
    const dispatched = await page.evaluate((): boolean => {
      const el = document.querySelector('#codemirror-editor .cm-content');
      if (!el) return false;
      const event = new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: true,
        shiftKey: true,
        bubbles: false,
        cancelable: true,
      });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(dispatched).toBe(true);
    await page.waitForTimeout(2500);

    content = await backendChapterContent(request);
    expect(stripMarkers(content)).toContain('AlphaX');
    expect(content).toContain('<!--scene:1:start-->');

    // Display matches the file in every state.
    expect(await editorVisibleText(page)).toBe(stripMarkers(content));
  });
});
