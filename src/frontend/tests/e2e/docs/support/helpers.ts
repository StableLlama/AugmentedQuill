// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Shared black-box helpers for the docs-feature E2E suite.
 *
 * These helpers interact with the application only through its public UI and
 * HTTP API (the same surfaces a real user sees), never through internal
 * implementation details.  The demo projects are seeded by the Playwright
 * config (see playwright.docs.config.ts).
 */

import { expect, type Page } from '@playwright/test';

export const FRONTEND = 'http://127.0.0.1:28021';
export const BACKEND = 'http://127.0.0.1:28020';

export const DEMO_PROJECT = 'The Undrawn Valley';
export const SERIES_PROJECT = 'The Signal Fire';
export const BTTF_PROJECT = 'Back to the Future';

/** Select a project through the backend API (as the app itself would). */
export async function selectProject(page: Page, name: string): Promise<void> {
  const resp = await page.request.post(
    'http://127.0.0.1:28020/api/v1/projects/select',
    { data: { name } }
  );
  if (!resp.ok()) {
    throw new Error(`Failed to select project ${name}: ${resp.status()}`);
  }
}

/**
 * Load the app with a given project active and wait for the editor to mount.
 * The workspace mode (Page/Scenes/Split) is persisted per project, so we
 * explicitly restore Page mode first — otherwise the editor never renders.
 */
export async function gotoApp(
  page: Page,
  project: string = DEMO_PROJECT
): Promise<void> {
  await selectProject(page, project);
  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  // Restore the Page workspace so the editor mounts (view state persists).
  const pageMode = page.locator('[title="Page Mode"]').first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await page.locator('.cm-content').count()) > 0) break;
    await pageMode.click({ timeout: 8000 }).catch(() => {
      // Header may not be interactive yet; retry in the next loop pass.
    });
    await page.waitForTimeout(1000);
  }
  await page.waitForSelector('.cm-content', { timeout: 20000 });
  await page.waitForTimeout(1200);
}

/**
 * Open the left sidebar (Story Metadata / Chapters / Sourcebook) if it is not
 * already visible.  The app starts with the sidebar collapsed; the "Menu"
 * header button toggles it.
 */
export async function openSidebar(page: Page): Promise<void> {
  // The sidebar exposes the "Story" / "Chapters" / "Sourcebook" sections
  // (rendered in uppercase via CSS).
  const sourcebookHeader = page.locator('text=/Sourcebook/i').first();
  if (await sourcebookHeader.isVisible().catch(() => false)) {
    return;
  }
  const menuBtn = page.locator('header button:has-text("Menu")').first();
  if ((await menuBtn.count()) > 0) {
    await menuBtn.click({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }
}

/** Click a header button by its accessible title / tooltip text. */
export async function clickHeaderButton(page: Page, title: string): Promise<void> {
  const btn = page.locator(`[title="${title}"]`).first();
  await btn.click({ timeout: 10000 });
}

/** Open the Settings dialog from the header. */
export async function openSettings(page: Page): Promise<void> {
  const gear = page.locator('[title="Settings"]').first();
  await gear.click({ timeout: 10000 });
  await expect(page.locator('[role="dialog"]').first()).toBeAttached({
    timeout: 10000,
  });
}

/** Close any open dialog/modal with Escape. */
export async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

/** Switch the workspace to a given mode (Page / Scenes / Split) by title. */
export async function switchWorkspaceMode(
  page: Page,
  mode: 'Page' | 'Scenes' | 'Split'
): Promise<void> {
  const btn = page.locator(`[title="${mode} Mode"]`).first();
  if ((await btn.count()) > 0) {
    await btn.click({ timeout: 10000 });
  } else {
    await page.locator(`text="${mode} Mode"`).first().click({ timeout: 10000 });
  }
  await page.waitForTimeout(800);
}

/** Switch the scenes panel to a given view (Narrative / Pinboard / Chronological / Convergence Map). */
export async function switchScenesView(
  page: Page,
  view: 'Narrative' | 'Pinboard' | 'Chronological' | 'Convergence Map'
): Promise<void> {
  const btn = page.locator(`button:has-text("${view}")`).first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(600);
  }
}

/** Open the Settings dialog and switch to a named tab. */
export async function openSettingsTab(page: Page, tab: string): Promise<void> {
  await openSettings(page);
  const tabBtn = page.locator('[role="dialog"] button:has-text("' + tab + '")').first();
  await tabBtn.click({ timeout: 10000 });
  await page.waitForTimeout(400);
}

/** Type into the editor body at the end of the current content. */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
  await page.waitForTimeout(600);
}

/**
 * Set the editor cursor at a visible character offset by dispatching a
 * selection transaction through CodeMirror's public API.  Deterministic and
 * immune to dropped keyboard events under CI load.
 */
export async function setCursorAtOffset(page: Page, offset: number): Promise<void> {
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
        state: { doc: { length: number }; selection: { main: { head: number } } };
        focus: () => void;
      };
    };
    const view = w.__aqEditorView;
    if (!view) return false;
    const len = view.state.doc.length;
    const pos = Math.min(Math.max(0, target), len);
    view.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true });
    view.focus();
    return view.state.selection.main.head === pos;
  }, offset);
  if (!applied) {
    throw new Error(`Failed to set editor cursor at offset ${offset}`);
  }
  await page.waitForTimeout(300);
}

/** Read the visible text currently rendered inside the editor. */
export async function editorText(page: Page): Promise<string> {
  await page.waitForSelector('.cm-content', { timeout: 10000 });
  return (await page.locator('.cm-content').innerText()).trim();
}

/**
 * Select the trailing `length` characters of the editor document (programmatic
 * CodeMirror range selection).  Useful for applying formatting to text that
 * was just typed at the end of the chapter.
 */
export async function selectTrailingText(page: Page, length: number): Promise<void> {
  await page.waitForFunction(
    () => !!(window as unknown as { __aqEditorView?: unknown }).__aqEditorView,
    undefined,
    { timeout: 5000 }
  );
  const applied = await page.evaluate((count: number): boolean => {
    const w = window as unknown as {
      __aqEditorView?: {
        dispatch: (spec: {
          selection: { anchor: number; head: number };
          scrollIntoView: boolean;
        }) => void;
        state: { doc: { length: number } };
        focus: () => void;
      };
    };
    const view = w.__aqEditorView;
    if (!view) return false;
    const len = view.state.doc.length;
    view.dispatch({
      selection: { anchor: len - count, head: len },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }, length);
  if (!applied) {
    throw new Error(`Failed to select trailing ${length} chars`);
  }
  await page.waitForTimeout(300);
}
