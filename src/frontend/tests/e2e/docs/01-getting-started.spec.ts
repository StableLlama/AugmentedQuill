// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E tests for the features described in
 * docs/user_manual/01_getting_started.md — the three-panel workspace, the
 * persistent header bar, view modes, undo/redo, and the chat panel toggle.
 *
 * These tests interact with the app only through its public UI.
 */

import { test, expect, type Page } from '@playwright/test';
import { DEMO_PROJECT, gotoApp, openSidebar } from './support/helpers';

test.describe('Getting Started — main interface', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
  });

  test('the three-panel workspace renders: sidebar, editor, and chat panel', async ({
    page,
  }: {
    page: Page;
  }) => {
    // Editor is present and shows the active chapter prose.
    await expect(page.locator('.cm-content')).toBeAttached({ timeout: 10000 });
    await expect(page.locator('text=The library smelled of dust').first()).toBeAttached(
      {
        timeout: 10000,
      }
    );

    // Right sidebar chat composer is present.
    await expect(page.locator('[aria-label="Chat message"]')).toBeAttached({
      timeout: 10000,
    });

    // The left sidebar can be opened and exposes the documented sections.
    await openSidebar(page);
    await expect(page.locator('text=/Story/i').first()).toBeAttached({
      timeout: 10000,
    });
    await expect(page.locator('text=/Chapters/i').first()).toBeAttached();
    await expect(page.locator('text=/Sourcebook/i').first()).toBeAttached();
  });

  test('the left sidebar shows story metadata, chapters, and sourcebook entries', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSidebar(page);

    // Story metadata: title, summary, style tags.
    await expect(page.locator('text="The Undrawn Valley"').first()).toBeAttached();
    await expect(page.locator('text="Fantasy"').first()).toBeAttached();

    // Chapters: all three demo chapters are listed.
    await expect(page.locator('text="The Faded Map"').first()).toBeAttached();
    await expect(page.locator('text="The Empty Road"').first()).toBeAttached();
    await expect(page.locator('text="The Unwritten Valley"').first()).toBeAttached();

    // Sourcebook entries.
    await expect(page.locator('text="Nora"').first()).toBeAttached();
    await expect(page.locator('text="Elias"').first()).toBeAttached();
  });

  test('clicking the logo/app title opens the Settings dialog', async ({
    page,
  }: {
    page: Page;
  }) => {
    const logo = page.locator('[aria-label="Open settings"]').first();
    await logo.click({ timeout: 10000 });
    await expect(page.locator('[role="dialog"]').first()).toBeAttached({
      timeout: 10000,
    });
    // The dialog exposes the four documented tabs.
    await expect(page.locator('button:has-text("Projects")').first()).toBeAttached();
    await expect(
      page.locator('button:has-text("Machine Settings")').first()
    ).toBeAttached();
    await expect(page.locator('button:has-text("General")').first()).toBeAttached();
    await expect(page.locator('button:has-text("About")').first()).toBeAttached();
  });

  test('the header exposes the documented center and right controls', async ({
    page,
  }: {
    page: Page;
  }) => {
    // Center: view modes.
    await expect(page.locator('button:has-text("Raw")').first()).toBeAttached();
    await expect(page.locator('button:has-text("MD")').first()).toBeAttached();
    await expect(page.locator('button:has-text("Visual")').first()).toBeAttached();

    // Chapter AI actions.
    await expect(
      page.locator('[title="Extend Chapter (WRITING model)"]').first()
    ).toBeAttached();
    await expect(
      page.locator('[title="Rewrite Chapter (WRITING model)"]').first()
    ).toBeAttached();

    // Right: settings, appearance, debug logs, and the chat toggle.
    await expect(page.locator('[title="Settings"]').first()).toBeAttached();
    await expect(page.locator('[title="Page Appearance"]').first()).toBeAttached();
    await expect(page.locator('[title="Debug Logs"]').first()).toBeAttached();
    await expect(page.locator('[aria-label="Toggle AI Chat"]').first()).toBeAttached();
  });

  test('undo removes the last edit and redo restores it', async ({
    page,
  }: {
    page: Page;
  }) => {
    const cm = page.locator('.cm-content');
    await cm.click();
    await page.keyboard.press('Control+End');
    const before = await cm.innerText();

    // insertText performs one transaction, so a single Undo reverts it all.
    await page.keyboard.insertText(' UNDO-E2E-MARKER');
    await page.waitForTimeout(1000);
    await expect(page.locator('text=UNDO-E2E-MARKER').first()).toBeAttached({
      timeout: 5000,
    });

    // The header Undo/Redo controls are present after an edit.
    await expect(page.locator('[title^="Undo"]').first()).toBeAttached({
      timeout: 5000,
    });
    await expect(page.locator('[title^="Redo"]').first()).toBeAttached();

    // Undo the last change (standard Ctrl+Z) and verify the text is gone.
    await page.keyboard.press('Control+KeyZ');
    await page.waitForTimeout(800);
    const afterUndo = await cm.innerText();
    expect(afterUndo).not.toContain('UNDO-E2E-MARKER');
    expect(afterUndo.trim()).toBe(before.trim());

    // Redo re-applies the change.
    await page.keyboard.press('Control+Shift+KeyZ');
    await page.waitForTimeout(800);
    const afterRedo = await cm.innerText();
    expect(afterRedo).toContain('UNDO-E2E-MARKER');
  });

  test('switching between Raw, MD, and Visual view modes preserves the text', async ({
    page,
  }: {
    page: Page;
  }) => {
    const raw = page
      .getByRole('button', { name: 'Raw', exact: true })
      .filter({ visible: true })
      .first();
    const md = page
      .getByRole('button', { name: 'MD', exact: true })
      .filter({ visible: true })
      .first();
    const visual = page
      .getByRole('button', { name: 'Visual', exact: true })
      .filter({ visible: true })
      .first();

    await raw.click();
    await page.waitForTimeout(600);
    await expect(
      page.locator('text=The library smelled of dust').first()
    ).toBeAttached();

    await md.click();
    await page.waitForTimeout(600);
    await expect(
      page.locator('text=The library smelled of dust').first()
    ).toBeAttached();

    await visual.click();
    await page.waitForTimeout(600);
    await expect(
      page.locator('text=The library smelled of dust').first()
    ).toBeAttached();

    // Restore the default mode so the persisted view state does not hide the
    // header toolbar controls for subsequent tests in this spec.
    await raw.click();
    await page.waitForTimeout(600);
  });

  test('the whitespace toggle (WS) control is present and usable', async ({
    page,
  }: {
    page: Page;
  }) => {
    const ws = page
      .locator('[title="Toggle whitespace characters"]')
      .filter({ visible: true })
      .first();
    await expect(ws).toBeAttached({ timeout: 10000 });
    // The toggle may sit under a sticky header; force-click to flip it.
    await ws.click({ force: true });
    await page.waitForTimeout(600);
    // Toggling must not break the editor content.
    await expect(
      page.locator('text=The library smelled of dust').first()
    ).toBeAttached();
  });

  test('the chat panel can be hidden and reopened from the header', async ({
    page,
  }: {
    page: Page;
  }) => {
    const composer = page.locator('[aria-label="Chat message"]');
    await expect(composer).toBeAttached({ timeout: 10000 });

    // "Hide" collapses the right chat panel.
    await page.locator('[aria-label="Toggle AI Chat"]').first().click();
    await page.waitForTimeout(800);
    await expect(composer).not.toBeVisible({ timeout: 5000 });

    // The same button (now labeled to open) restores it.
    await page.locator('[aria-label="Toggle AI Chat"]').first().click();
    await page.waitForTimeout(800);
    await expect(composer).toBeVisible({ timeout: 5000 });
  });

  test('the format toolbar exposes the documented formatting buttons', async ({
    page,
  }: {
    page: Page;
  }) => {
    // Formatting shortcuts shown in the docs.
    await expect(page.locator('button:has-text("B")').first()).toBeAttached();
    await expect(page.locator('button:has-text("I")').first()).toBeAttached();
    await expect(page.locator('button:has-text("H1")').first()).toBeAttached();
    await expect(page.locator('button:has-text("H2")').first()).toBeAttached();
    await expect(page.locator('button:has-text("H3")').first()).toBeAttached();
  });
});
