// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Generates / updates all documentation screenshots for `docs/user_manual`.
 *
 * Each screenshot is defined in `screenshotDefs` below: an id (which is also
 * the PNG filename), the `[SCREENSHOT: ...]` marker it satisfies (if any),
 * a capture strategy (full page vs. dialog element), and a setup routine that
 * drives the isolated app to the required UI state.
 *
 * After capturing, the spec writes `.screenshot-manifest.json` next to the
 * PNGs mapping each doc marker to its filename so the docs updater
 * (`scripts/update-docs-screenshots.mjs`) can replace markers with real image
 * links.
 *
 * Run with:
 *   npx playwright test --config=docs-screenshots.config.ts
 */

import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const BACKEND = 'http://127.0.0.1:28010';
const FRONTEND = 'http://127.0.0.1:28011';
const DEMO_PROJECT = 'Screenshots Demo';
const SERIES_PROJECT = 'Screenshots Series';

// docs/user_manual/screenshots relative to this spec file
// (src/frontend/tests/docs-screenshots -> repo root is four levels up).
const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = path.resolve(SPEC_DIR, '../../../../docs/user_manual/screenshots');
const MANIFEST_PATH = path.join(SHOTS_DIR, '.screenshot-manifest.json');

// ---------------------------------------------------------------------------
// Capture strategy types
// ---------------------------------------------------------------------------

type Shot =
  | { kind: 'fullPage' }
  | { kind: 'element'; selector: string }
  | { kind: 'dialog'; dialogText: string; panel?: boolean };

interface ScreenshotDef {
  /** Stable slug; also the PNG filename (without extension). */
  id: string;
  /** Exact `[SCREENSHOT: ...]` marker text this screenshot satisfies. */
  marker?: string;
  /** Capture strategy. */
  shot: Shot;
  /** Project to load first (defaults to the demo novel). */
  project?: 'demo' | 'series';
  /**
   * Optional viewport to size the capture window to.  Dialog screenshots that
   * fill the window (metadata editor, etc.) should match the dialog's natural
   * size so there is no wasted empty space; panel screenshots can use a
   * slightly narrower window to make the sidebar prominent.
   */
  viewport?: { width: number; height: number };
  /** Drive the app to the required UI state. */
  setup: (ctx: CaptureCtx) => Promise<void>;
}

interface CaptureCtx {
  page: Page;
  project: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Select a project via the backend API, reload, and wait for the editor. */
async function selectProject(page: Page, name: string): Promise<void> {
  await page.goto(`${FRONTEND}`);
  await page.waitForTimeout(700);
  await page.evaluate(
    async (args: { backend: string; projectName: string }) => {
      await fetch(`${args.backend}/api/v1/projects/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: args.projectName }),
      });
    },
    { backend: BACKEND, projectName: name }
  );
  await page.goto(`${FRONTEND}`);
  await page.waitForSelector('.cm-content', { timeout: 20000 });
  await page.waitForTimeout(1200);
}

/** Reset to a known clean project state (fresh reload each time). */
async function reset(ctx: CaptureCtx): Promise<void> {
  await selectProject(ctx.page, ctx.project);
  await ensureSidebarOpen(ctx.page);
}

/**
 * The sidebar defaults to closed in the UI store; open it via the header
 * toggle (shows "Menu" when closed, "Hide" when open) so captures show the
 * full three-panel app and sidebar sections are interactive.
 */
async function ensureSidebarOpen(page: Page): Promise<void> {
  const toggle = page.locator('button:has-text("Menu")').first();
  if ((await toggle.count()) > 0) {
    await toggle.click({ timeout: 5000, force: true }).catch(async () => {
      await toggle.evaluate((el: SVGElement | HTMLElement) =>
        (el as HTMLElement).click()
      );
    });
    await page.waitForTimeout(700);
  }
}

/**
 * Hide the left sidebar and right chat panel so only the editor column shows.
 * Both header toggles display "Hide" while open; click any that remain.
 */
async function hidePanels(page: Page): Promise<void> {
  for (let guard = 0; guard < 4; guard += 1) {
    const hide = page.locator('button:has-text("Hide")').first();
    if ((await hide.count()) === 0) break;
    await hide.click({ timeout: 4000, force: true }).catch(async () => {
      await hide.evaluate((el: SVGElement | HTMLElement) =>
        (el as HTMLElement).click()
      );
    });
    await page.waitForTimeout(500);
  }
}

/** Switch the whole app to the Light design mode and close the popup. */
async function switchToLightMode(page: Page): Promise<void> {
  await clickFirst(
    page,
    ['[title="Page Appearance"]', '[aria-label="Page Appearance"]'],
    'Page Appearance'
  );
  await clickFirst(page, ['button:has-text("Light")'], 'Design Mode Light');
  // Dismiss the appearance popup (Escape, then click away on the editor).
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.mouse.click(700, 500).catch(() => undefined);
  await page.waitForTimeout(700);
}

/** Click the first matching selector; return true if a click happened. */
async function clickFirst(
  page: Page,
  selectors: string[],
  label: string,
  timeout: number = 6000
): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      try {
        await loc.click({ timeout });
        return true;
      } catch (e) {
        console.log(
          `  [warn] click ${label} via ${sel} failed: ${String(e).slice(0, 120)}`
        );
      }
    }
  }
  console.log(`  [warn] ${label}: no selector matched (${selectors.join(' | ')})`);
  return false;
}

async function waitForClickable(
  page: Page,
  selector: string,
  label: string,
  timeout: number = 15000
): Promise<boolean> {
  const loc = page.locator(selector).first();
  try {
    await loc.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    console.log(`  [warn] ${label}: not visible within ${timeout}ms`);
    return false;
  }
}

async function openSettings(page: Page): Promise<boolean> {
  const ok = await clickFirst(
    page,
    ['[title="Settings"]', '[aria-label="Settings"]'],
    'Settings'
  );
  if (ok) {
    await page
      .locator('[role="dialog"]')
      .filter({ hasText: 'Settings' })
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => undefined);
  }
  return ok;
}

async function openChapterMetadata(page: Page): Promise<boolean> {
  const edit = page.locator('[title="Edit Metadata"]').first();
  try {
    await edit.waitFor({ state: 'attached', timeout: 15000 });
  } catch {
    console.log('  [warn] Edit Metadata button never attached');
    return false;
  }
  // The edit button is hover-revealed (opacity-0 group-hover:opacity-100), so
  // hover the chapter card first, then click; fall back to a programmatic
  // click if the hover does not take effect in time.
  await edit.hover({ timeout: 5000 }).catch(() => undefined);
  await edit.click({ timeout: 8000 }).catch(async () => {
    await edit.evaluate((el: SVGElement | HTMLElement) => (el as HTMLElement).click());
  });
  await page.waitForTimeout(800);
  return true;
}

/**
 * Focus a single sidebar section (Story / Chapters / Sourcebook) so the app
 * shows only that panel, then capture the whole page for a focused but still
 * alive-looking screenshot. Returns false if the section could not be focused.
 */
async function focusSidebarSection(page: Page, title: string): Promise<boolean> {
  const btn = page.locator(`[title="${title}"]`).first();
  try {
    await btn.waitFor({ state: 'attached', timeout: 12000 });
  } catch {
    console.log(`  [warn] Focus ${title}: button never attached`);
    return false;
  }
  // The focus button can report as not-visible in headless (fixed-position
  // sidebar), so force the click and fall back to a programmatic one.
  await btn.click({ timeout: 5000, force: true }).catch(async () => {
    await btn.evaluate((el: SVGElement | HTMLElement) => (el as HTMLElement).click());
  });
  await page.waitForTimeout(800);
  return true;
}

/** Load a seeded chat session so the chat panel shows a real conversation. */
async function loadChatSession(page: Page, sessionName: string): Promise<void> {
  await clickFirst(
    page,
    ['[aria-label="Chat History"]', '[title="Chat History"]'],
    'Chat History'
  );
  await page.waitForTimeout(500);
  await clickFirst(
    page,
    [`button:has-text("${sessionName}")`],
    `Session ${sessionName}`
  );
  await page.waitForTimeout(1200);
}

async function capture(ctx: CaptureCtx, def: ScreenshotDef): Promise<void> {
  const file = path.join(SHOTS_DIR, `${def.id}.png`);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  if (def.shot.kind === 'fullPage') {
    await ctx.page.screenshot({ path: file, fullPage: true });
  } else if (def.shot.kind === 'element') {
    await ctx.page.locator(def.shot.selector).first().screenshot({ path: file });
  } else {
    // Capture the topmost visible dialog (the one the recipe just opened).
    // Text matching is fragile (i18n keys, aria-labelledby titles), so we pick
    // the last dialog in DOM order that is actually visible.
    const dialogs = ctx.page.locator('[role="dialog"]');
    const count = await dialogs.count();
    let target: import('@playwright/test').Locator | null = null;
    for (let i = count - 1; i >= 0; i -= 1) {
      const d = dialogs.nth(i);
      if (await d.isVisible().catch(() => false)) {
        target = d;
        break;
      }
    }
    if (!target) {
      throw new Error(`no visible [role=dialog] found for ${def.id}`);
    }
    await target.waitFor({ state: 'visible', timeout: 8000 });
    if (def.shot.panel) {
      // Some dialogs put role="dialog" on the full-screen overlay; capture the
      // inner panel (max-w-md card) instead so the screenshot is focused.
      const panel = target.locator('div.max-w-md').filter({ visible: true }).first();
      if ((await panel.count()) > 0) {
        await panel.screenshot({ path: file });
        return;
      }
    }
    await target.screenshot({ path: file });
  }
}

// ---------------------------------------------------------------------------
// Screenshot definitions
// ---------------------------------------------------------------------------

const screenshotDefs: ScreenshotDef[] = [
  // ---- main dashboard ----
  {
    id: 'main',
    shot: { kind: 'fullPage' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
    },
  },

  // ---- 02 projects & settings ----
  {
    id: '02_settings_projects',
    marker: 'The Settings Dialog showing the Projects tab with a list of projects',
    shot: { kind: 'fullPage' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await openSettings(ctx.page);
    },
  },
  {
    id: '02_create_project_dialog',
    shot: { kind: 'dialog', dialogText: 'Create New Project', panel: true },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await openSettings(ctx.page);
      await waitForClickable(
        ctx.page,
        'button:has-text("New Project")',
        'New Project button'
      );
      await clickFirst(
        ctx.page,
        ['[title="New Project"]', 'button:has-text("New Project")'],
        'New Project'
      );
    },
  },
  {
    id: '02_machine_settings_1',
    shot: { kind: 'fullPage' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await openSettings(ctx.page);
      await waitForClickable(
        ctx.page,
        'button:has-text("Machine Settings")',
        'Machine Settings tab'
      );
      await clickFirst(
        ctx.page,
        ['button:has-text("Machine Settings")'],
        'Machine Settings tab'
      );
    },
  },
  {
    id: '02_machine_settings_2',
    shot: { kind: 'element', selector: 'div.flex-1.overflow-y-auto:has(h3)' },
    viewport: { width: 1700, height: 1500 },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await openSettings(ctx.page);
      await waitForClickable(
        ctx.page,
        'button:has-text("Machine Settings")',
        'Machine Settings tab'
      );
      await clickFirst(
        ctx.page,
        ['button:has-text("Machine Settings")'],
        'Machine Settings tab'
      );
    },
  },
  {
    id: '02_machine_settings_3',
    shot: { kind: 'fullPage' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await openSettings(ctx.page);
      await waitForClickable(
        ctx.page,
        'button:has-text("Machine Settings")',
        'Machine Settings tab'
      );
      await clickFirst(
        ctx.page,
        ['button:has-text("Machine Settings")'],
        'Machine Settings tab'
      );
      // The overrides section is a heading (not a button); scroll it into
      // view so the full-page capture shows it expanded at the bottom.
      await waitForClickable(
        ctx.page,
        'h4:has-text("Expert: Prompt Overrides")',
        'Expert Prompt Overrides'
      );
      await ctx.page
        .locator('h4:has-text("Expert: Prompt Overrides")')
        .first()
        .scrollIntoViewIfNeeded({ timeout: 8000 })
        .catch(() => undefined);
      await ctx.page.waitForTimeout(600);
    },
  },

  // ---- 03 writing interface ----
  {
    id: '03_chapter_ai',
    shot: { kind: 'fullPage' },
    // Width 1700+: at medium widths (1300-1600) a header layout bug hides the
    // Chapter AI Extend/Rewrite buttons; at 1700+ they show with their labels.
    viewport: { width: 1700, height: 950 },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      // Focus on the editor column: hide the sidebars and use the light theme
      // so the Chapter AI badge (Extend / Rewrite) is easy to read.
      await hidePanels(ctx.page);
      await switchToLightMode(ctx.page);
      // Hover "Extend" so the reader sees how to use the Chapter AI badge.
      await ctx.page
        .locator('button:has-text("Extend")')
        .first()
        .hover({ timeout: 5000 })
        .catch(() => undefined);
      await ctx.page.waitForTimeout(600);
    },
  },
  {
    id: '03_continuation',
    shot: { kind: 'fullPage' },
    viewport: { width: 1500, height: 950 },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      // Show only the editor + suggestion footer so the sidebars don't distract.
      await hidePanels(ctx.page);
      await clickFirst(
        ctx.page,
        ['button:has-text("Suggest next paragraph")'],
        'Suggest next paragraph'
      );
      // Wait for the suggestion cards to finish streaming in.
      await ctx.page
        .waitForFunction(
          () => {
            const el = document.querySelector(
              'button:has-text("Suggest next paragraph")'
            );
            return !!el && !(el as HTMLButtonElement).disabled;
          },
          undefined,
          { timeout: 15000 }
        )
        .catch(() => undefined);
      await ctx.page.waitForTimeout(2500);
    },
  },
  {
    id: '03_metadata_summary',
    shot: { kind: 'dialog', dialogText: 'Summary' },
    viewport: { width: 1050, height: 860 },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await openChapterMetadata(ctx.page);
      await clickFirst(
        ctx.page,
        ['button:has-text("Summary")', '[role="tab"]:has-text("Summary")'],
        'Summary tab'
      );
    },
  },

  // ---- 04 chapters & books ----
  {
    id: '04_sidebar_metadata_dialog',
    marker:
      'Sidebar showing story metadata on top, the chapter list, and the metadata dialog open for a selected chapter',
    shot: { kind: 'fullPage' },
    viewport: { width: 1500, height: 950 },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await openChapterMetadata(ctx.page);
      // Switch to sidebar (non-fullscreen) mode so the dialog sits beside the sidebar.
      await clickFirst(
        ctx.page,
        [
          '[title="Switch to Sidebar View"]',
          '[aria-label="Switch to sidebar view"]',
          '[title="Minimize"]',
          '[aria-label="Minimize"]',
          '[title="Sidebar mode"]',
          '[title="Collapse"]',
        ],
        'Sidebar mode'
      );
    },
  },
  {
    id: '04_chapters_panel',
    marker:
      'Chapters panel with a highlighted chapter card, expand/collapse book controls, and drag handles visible',
    shot: { kind: 'element', selector: '#aq-sidebar' },
    viewport: { width: 1300, height: 900 },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await focusSidebarSection(ctx.page, 'Chapters');
    },
  },
  {
    id: '04_metadata_fullscreen',
    marker:
      'Metadata Editor Dialog in fullscreen mode, showing the tab bar, title input, and summary textarea with AI buttons',
    shot: { kind: 'dialog', dialogText: 'Summary' },
    viewport: { width: 1100, height: 880 },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await openChapterMetadata(ctx.page);
    },
  },
  {
    id: '04_conflicts_tab',
    marker:
      'Conflicts tab showing two conflict rows with description, resolution plan, and reorder arrows',
    shot: { kind: 'dialog', dialogText: 'Conflicts' },
    viewport: { width: 1050, height: 860 },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await openChapterMetadata(ctx.page);
      await clickFirst(
        ctx.page,
        ['button:has-text("Conflicts")', '[role="tab"]:has-text("Conflicts")'],
        'Conflicts tab'
      );
    },
  },
  {
    id: '04_series_books',
    marker:
      'Series view with multiple books expanded, showing Add Chapter and drag handles for books',
    shot: { kind: 'element', selector: '#aq-sidebar' },
    viewport: { width: 1300, height: 900 },
    project: 'series',
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await focusSidebarSection(ctx.page, 'Chapters');
    },
  },
  {
    id: '04_story_metadata',
    marker: 'Story Metadata panel with tags, notes, and the pencil icon highlighted',
    shot: { kind: 'element', selector: '#aq-sidebar' },
    viewport: { width: 1300, height: 900 },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await focusSidebarSection(ctx.page, 'Story');
    },
  },

  // ---- 05 sourcebook ----
  {
    id: '05_sourcebook_panel',
    shot: { kind: 'element', selector: '#aq-sidebar' },
    // Tall viewport so the Sourcebook section (bottom of the sidebar) has room
    // to show several entries, not just one.
    viewport: { width: 1300, height: 1500 },
    setup: async (ctx: CaptureCtx) => {
      // Keep the full sidebar (story + chapters + sourcebook) so readers can
      // locate the Sourcebook section; it sits at the bottom of the sidebar.
      await reset(ctx);
    },
  },
  {
    id: '05_sourcebook_entry_dialog',
    shot: { kind: 'dialog', dialogText: 'Add Sourcebook Entry' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      // The Add Entry button sits in the sourcebook section at the bottom of
      // the sidebar.  Prefer the visible instance and use a force/programmatic
      // click because the section can still be settling after project load.
      let addBtn = ctx.page
        .locator('[title="Add Entry"]')
        .filter({ visible: true })
        .first();
      if ((await addBtn.count()) === 0) {
        addBtn = ctx.page.locator('[title="Add Entry"]').first();
      }
      await addBtn.scrollIntoViewIfNeeded().catch(() => undefined);
      await addBtn.click({ timeout: 8000, force: true }).catch(async () => {
        await addBtn.evaluate((el: SVGElement | HTMLElement) =>
          (el as HTMLElement).click()
        );
      });
      await ctx.page.waitForTimeout(1000);
    },
  },
  {
    id: '05_sourcebook_hover',
    marker:
      'Sourcebook hover card showing the Nora entry with its linked portrait and description',
    shot: { kind: 'element', selector: 'div.fixed:has-text("Nora")' },
    viewport: { width: 1400, height: 950 },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      // Focus the Sourcebook section so the entry list fills the sidebar and
      // the hover card floats clearly to its right, over the editor.
      await focusSidebarSection(ctx.page, 'Sourcebook');
      // Hover the Nora entry row (its first button) to reveal the image-backed
      // hover card; fall back to a programmatic mouseover if the hover stalls.
      const noraRow = ctx.page
        .locator('[role="listitem"]', { hasText: 'Nora' })
        .first();
      await noraRow.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => undefined);
      const noraButton = noraRow.locator('button').first();
      await noraButton.hover({ timeout: 8000, force: true }).catch(async () => {
        await noraButton.evaluate((el: SVGElement | HTMLElement) =>
          (el as HTMLElement).dispatchEvent(
            new MouseEvent('mouseover', { bubbles: true })
          )
        );
      });
      await ctx.page.waitForTimeout(1500);
    },
  },

  // ---- 06 project images ----
  {
    id: '06_project_images',
    marker:
      'The Project Images dialog showing the settings accordion, the action bar with three buttons, and an image grid with cards',
    shot: { kind: 'dialog', dialogText: 'Project Images' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await clickFirst(
        ctx.page,
        ['[title="Insert Image"]'],
        'Insert Image (Project Images)'
      );
    },
  },
  {
    id: '06_image_card',
    marker:
      'A single image card showing the thumbnail, title input, description textarea, and action buttons',
    shot: { kind: 'element', selector: '[aria-label^="Image card"]' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await clickFirst(
        ctx.page,
        ['[title="Insert Image"]'],
        'Insert Image (Project Images)'
      );
    },
  },
  {
    id: '06_continuation',
    marker:
      'The suggestion footer open with continuation cards based on the current chapter context',
    shot: { kind: 'fullPage' },
    viewport: { width: 1500, height: 950 },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await hidePanels(ctx.page);
      await clickFirst(
        ctx.page,
        ['button:has-text("Suggest next paragraph")'],
        'Suggest next paragraph'
      );
      await ctx.page.waitForTimeout(4000);
    },
  },
  {
    id: '06_generated_prompt',
    marker:
      'Project Images dialog showing an image card with the generated prompt popup open',
    shot: { kind: 'dialog', dialogText: 'Project Images' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await clickFirst(
        ctx.page,
        ['[title="Insert Image"]'],
        'Insert Image (Project Images)'
      );
      // The seeded cover image has a description and the demo provider is
      // multimodal, so "Create prompt" is enabled.  Clicking it opens the
      // generated-prompt popup.
      await waitForClickable(
        ctx.page,
        'button:has-text("Create prompt")',
        'Create prompt button'
      );
      await clickFirst(
        ctx.page,
        ['button:has-text("Create prompt")', 'button:has-text("Generate description")'],
        'Create prompt'
      );
      await ctx.page.waitForTimeout(3500);
    },
  },

  // ---- 07 ai chat assistant ----
  {
    id: '07_chat_panel',
    marker:
      'The AI Chat Assistant panel open in the right sidebar next to the text editor',
    shot: { kind: 'fullPage' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      // Load a seeded conversation so the panel feels alive.
      await loadChatSession(ctx.page, 'Plan the opening chapters');
    },
  },
  {
    id: '07_chat_header',
    marker: 'Chat panel header showing the session title and all icon buttons',
    shot: { kind: 'element', selector: 'aside[aria-label="AI Chat Assistant"]' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await loadChatSession(ctx.page, 'Plan the opening chapters');
    },
  },
  {
    id: '07_chat_history',
    marker:
      'Chat History panel showing a list of previous sessions with dates and the Clear All button',
    shot: { kind: 'fullPage' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await clickFirst(
        ctx.page,
        ['[aria-label="Chat History"]', '[title="Chat History"]'],
        'Chat History'
      );
      await ctx.page.waitForTimeout(800);
    },
  },
  {
    id: '07_tool_call_limit',
    marker:
      'Tool Call Limit dialog showing the call count and the three action buttons',
    shot: { kind: 'dialog', dialogText: 'Tool Call Limit' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      // Reaching the tool-call limit requires a live chat run with many tool
      // calls, which cannot be reproduced deterministically offline.  If a
      // recipe arrives, this step documents that the dialog opens after the
      // limit is hit.  We deliberately do not fabricate it.
      throw new Error(
        'Tool Call Limit requires a live model run with many tool calls; skipping.'
      );
    },
  },

  // ---- 08 appearance & display ----
  {
    id: '08_appearance',
    marker:
      'The Appearance popup open, showing the Design Mode toggle and the five sliders',
    shot: { kind: 'dialog', dialogText: 'Page Appearance' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await clickFirst(
        ctx.page,
        ['[title="Page Appearance"]', '[aria-label="Page Appearance"]'],
        'Page Appearance'
      );
      // Show the Design Mode toggle demonstrating the light theme.
      await clickFirst(ctx.page, ['button:has-text("Light")'], 'Design Mode Light');
      await ctx.page.waitForTimeout(700);
    },
  },
  {
    id: '08_debug_logs',
    marker:
      'Debug Logs dialog showing the aggregated view with a list of request entries, one expanded to show the request and response JSON',
    shot: { kind: 'dialog', dialogText: 'LLM Communication Logs' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      // Generate real log entries by running one suggestion through the mock
      // LLM (the backend records the request/response via logged_request).
      await clickFirst(
        ctx.page,
        ['button:has-text("Suggest next paragraph")'],
        'Suggest'
      );
      await ctx.page.waitForTimeout(3500);
      await clickFirst(ctx.page, ['[title="Debug Logs"]'], 'Debug Logs');
      // Expand the first log entry (its toggle carries aria-expanded).
      const expand = ctx.page.locator('[aria-expanded="false"]').first();
      try {
        await expand.waitFor({ state: 'attached', timeout: 10000 });
        await expand.click({ timeout: 6000, force: true }).catch(async () => {
          await expand.evaluate((el: SVGElement | HTMLElement) =>
            (el as HTMLElement).click()
          );
        });
      } catch {
        console.log('  [warn] no collapsed debug-log entry found to expand');
      }
      await ctx.page.waitForTimeout(600);
    },
  },

  // ---- 09 sourcebook (tutorial) ----
  {
    id: '09_sourcebook',
    shot: { kind: 'element', selector: '#aq-sidebar' },
    viewport: { width: 1300, height: 1500 },
    setup: async (ctx: CaptureCtx) => {
      // Same as 05_sourcebook_panel: full sidebar so the Sourcebook is locatable.
      await reset(ctx);
    },
  },

  // ---- 12 search and replace ----
  {
    id: '12_search_and_replace_dialog',
    shot: { kind: 'dialog', dialogText: 'Search and Replace' },
    setup: async (ctx: CaptureCtx) => {
      await reset(ctx);
      await clickFirst(
        ctx.page,
        ['[title="Search and Replace (Ctrl+F)"]', '[aria-label="Search and Replace"]'],
        'Search and Replace'
      );
      await waitForClickable(ctx.page, '[aria-label="Search..."]', 'Search input');
      const search = ctx.page.locator('[aria-label="Search..."]').first();
      if ((await search.count()) > 0) {
        await search.fill('valley');
        // Search only runs on Enter or the Find button — typing alone does not.
        await search.press('Enter');
        await ctx.page.waitForTimeout(2500);
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Runner: one test per screenshot (serial mode) so a single slow or hung
// capture never tears down the browser for the rest of the suite.  A failed
// capture is recorded and reported in the summary without failing the test,
// so the docs updater can still run for everything that succeeded.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

type ShotStatus = 'ok' | 'failed' | 'skipped';

interface CaptureResult {
  id: string;
  status: ShotStatus;
}

const results: CaptureResult[] = [];
const manifest: Array<{ marker: string; file: string }> = [];

for (const def of screenshotDefs) {
  test(`capture ${def.id}`, async ({ page }: { page: Page }) => {
    test.setTimeout(180000);
    if (def.viewport) {
      await page.setViewportSize(def.viewport);
      await page.waitForTimeout(300);
    }
    const ctx: CaptureCtx = {
      page,
      project: def.project === 'series' ? SERIES_PROJECT : DEMO_PROJECT,
    };
    console.log(`\n>>> ${def.id}`);
    try {
      await def.setup(ctx);
      await ctx.page.waitForTimeout(600); // settle paint / animations
      await capture(ctx, def);
      results.push({ id: def.id, status: 'ok' });
      if (def.marker) manifest.push({ marker: def.marker, file: `${def.id}.png` });
      console.log(`  [ok] wrote ${def.id}.png`);
    } catch (e) {
      const status = /skipping|requires a live model/i.test(String(e))
        ? 'skipped'
        : 'failed';
      results.push({ id: def.id, status });
      console.log(`  [${status.toUpperCase()}] ${def.id}: ${String(e).slice(0, 220)}`);
    }
  });
}

test.afterAll(() => {
  // Persist marker -> file mapping for the docs updater.
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log('\n===== SUMMARY =====');
  for (const r of results) {
    console.log(`  ${r.status.padEnd(7)} ${r.id}`);
  }
  const ok = results.filter((r: CaptureResult) => r.status === 'ok').length;
  const skipped = results.filter((r: CaptureResult) => r.status === 'skipped').length;
  const failed = results.filter((r: CaptureResult) => r.status === 'failed').length;
  console.log(`\n${ok} ok, ${skipped} skipped, ${failed} failed`);
});
