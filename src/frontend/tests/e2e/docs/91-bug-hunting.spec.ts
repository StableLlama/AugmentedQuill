// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E "bug hunting" tests for AugmentedQuill — adversarial
 * and destructive flows designed to shake out defects that the happy-path
 * docs suite does not cover (missing confirmations, broken controls, guard
 * rails, destructive operations).
 *
 * Confirmed defects are encoded as `test.fixme(...)` so the suite stays green
 * while clearly flagging the bug for the findings report.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  DEMO_PROJECT,
  SERIES_PROJECT,
  gotoApp,
  openSidebar,
  openSettings,
  closeDialog,
} from './support/helpers';

test.describe('Bug hunting — destructive flows', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
    await openSidebar(page);
  });

  // The header Undo button must revert the last edit (like Ctrl+Z).
  test('the header Undo button reverts the last edit', async ({
    page,
  }: {
    page: Page;
  }) => {
    const cm = page.locator('.cm-content').first();
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' UNDO-BTN-MARKER');
    await page.waitForTimeout(1000);
    await expect(page.locator('text=UNDO-BTN-MARKER').first()).toBeAttached();

    const undoBtn = page.locator('[title^="Undo"]').first();
    await expect(undoBtn).toBeEnabled();
    await undoBtn.click();
    await page.waitForTimeout(800);

    // The marker should be gone after clicking the header Undo button.
    await expect(page.locator('text=UNDO-BTN-MARKER').first()).not.toBeAttached({
      timeout: 5000,
    });
  });

  // docs/user_manual/04 says a chapter is "deleted immediately after
  // confirmation" — deleting a chapter must ask for confirmation first.
  test('deleting a chapter asks for confirmation first', async ({
    page,
  }: {
    page: Page;
  }) => {
    // Create a fresh chapter so the delete only touches throwaway data.
    await page.locator('[title="New Chapter"]').first().click();
    await page.waitForTimeout(2000);
    await expect(page.locator('[title="Delete Chapter"]').last()).toBeAttached({
      timeout: 8000,
    });

    // Delete the newest chapter — a confirmation dialog is documented.
    await page.locator('[title="Delete Chapter"]').last().click();
    await expect(
      page
        .getByRole('dialog')
        .filter({ hasText: /Delete|confirm/i })
        .first()
    ).toBeVisible({ timeout: 5000 });
  });

  // docs/user_manual/07 says deleting the active chat session happens "after
  // confirmation" — the header Delete Current Chat button must confirm first.
  test('deleting the current chat asks for confirmation first', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Delete Current Chat"]').first().click();
    await expect(
      page
        .getByRole('dialog')
        .filter({ hasText: /Are you sure|delete/i })
        .first()
    ).toBeVisible({ timeout: 5000 });
  });

  // docs/user_manual/07 says each saved session row deletes "after
  // confirmation" — the per-row delete must confirm first.
  test('deleting a chat history session asks for confirmation first', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Chat History"]').first().click();
    await page.waitForTimeout(800);
    const rowDelete = page
      .locator('[title="Delete this chat"]')
      .filter({ visible: true })
      .first();
    await expect(rowDelete).toBeAttached({ timeout: 8000 });
    await rowDelete.click();
    await expect(
      page
        .getByRole('dialog')
        .filter({ hasText: /Are you sure|delete/i })
        .first()
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Bug hunting — guard rails and destructive operations', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
    await openSidebar(page);
  });

  test('Replace All reduces the match count to zero', async ({
    page,
  }: {
    page: Page;
  }) => {
    // Add a unique token to the current chapter so only throwaway data changes.
    const cm = page.locator('.cm-content').first();
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' ZZUNIQUE-TOKEN');
    await page.waitForTimeout(800);

    await page.locator('[title="Search and Replace (Ctrl+F)"]').first().click();
    await page.waitForTimeout(800);
    const searchField = page
      .locator('input[type="search"], input[placeholder*="earch"]')
      .first();
    await searchField.fill('ZZUNIQUE-TOKEN');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await expect(page.locator('text=/match|matches/i').first()).toBeAttached({
      timeout: 10000,
    });

    const replaceField = page.locator('[aria-label="Replace..."]').first();
    await replaceField.fill('ZZREPLACED');
    await page.locator('button:has-text("Replace All")').first().click();
    await page.waitForTimeout(2000);

    // No matches remain after Replace All.
    await expect(page.locator('text=/No matches found/i').first()).toBeAttached({
      timeout: 10000,
    });
    await closeDialog(page);
  });

  test('a series with two books cannot be converted to a short story', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, SERIES_PROJECT);
    await openSettings(page);
    await page.locator('#settings-dialog button:has-text("Projects")').first().click();
    await page.waitForTimeout(500);

    // The active series project exposes the type selector; the Short Story
    // option must be disabled ("Too many items").
    const typeSelect = page
      .locator('#settings-dialog select')
      .filter({ has: page.locator('option:has-text("Short Story")') })
      .first();
    await expect(typeSelect).toBeAttached({ timeout: 8000 });
    const shortStory = typeSelect.locator('option:has-text("Short Story")').first();
    await expect(shortStory).toBeDisabled();
    await closeDialog(page);
  });

  test('switching the GUI language to German changes the UI and reverts back', async ({
    page,
  }: {
    page: Page;
  }) => {
    // Switch to German in the General tab and save.
    await openSettings(page);
    await page.locator('#settings-dialog button:has-text("General")').first().click();
    await page.waitForTimeout(500);
    await page.locator('#settings-dialog select').first().selectOption('de');
    await page.waitForTimeout(300);
    await page
      .locator('#settings-dialog button:has-text("Save & Close")')
      .first()
      .click();
    await page.waitForTimeout(1200);

    // The UI is now localized (header search button uses the German title).
    await expect(
      page.locator('[title="Suchen und Ersetzen (Strg+F)"]').first()
    ).toBeAttached({ timeout: 8000 });

    // Revert to English through the now-German settings dialog.
    await page.locator('[title="Einstellungen"]').first().click();
    await page.waitForTimeout(800);
    await page.locator('#settings-dialog button:has-text("Allgemein")').first().click();
    await page.waitForTimeout(400);
    await page.locator('#settings-dialog select').first().selectOption('en');
    await page.waitForTimeout(300);
    await page
      .locator('#settings-dialog button:has-text("Save & Close")')
      .first()
      .click();
    await page.waitForTimeout(1200);

    // English is restored.
    await expect(
      page.locator('[title="Search and Replace (Ctrl+F)"]').first()
    ).toBeAttached({ timeout: 8000 });
  });

  test('renaming a project via the pencil updates its title in settings', async ({
    page,
  }: {
    page: Page;
  }) => {
    const newName = `E2E Renamed ${Date.now()}`;
    await openSettings(page);
    await page.locator('#settings-dialog button:has-text("Projects")').first().click();
    await page.waitForTimeout(500);
    const dlg = page.locator('#settings-dialog');

    // Hover the demo project title to reveal the pencil, then rename it.
    await dlg.getByText(DEMO_PROJECT).first().hover();
    await page.waitForTimeout(400);
    const pencil = dlg
      .getByText(DEMO_PROJECT)
      .first()
      .locator('xpath=ancestor::div[contains(@class,"group")][1]')
      .locator('button')
      .first();
    await pencil.click();
    await page.waitForTimeout(400);

    const nameInput = dlg.locator('input').filter({ visible: true }).first();
    await nameInput.fill(newName);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);

    await expect(dlg.getByText(newName).first()).toBeAttached({ timeout: 8000 });
    await closeDialog(page);
  });

  test('duplicating a provider creates a copy in Machine Settings', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettings(page);
    await page
      .locator('#settings-dialog button:has-text("Machine Settings")')
      .first()
      .click();
    await page.waitForTimeout(600);
    const dlg = page.locator('#settings-dialog');
    const before = await dlg.locator('button[title="Duplicate provider"]').count();
    await expect(dlg.locator('text="Demo Provider"').first()).toBeAttached({
      timeout: 10000,
    });

    // Hover the provider row so the duplicate action becomes visible, then use it.
    await dlg.locator('text="Demo Provider"').first().hover();
    await page.waitForTimeout(400);
    await dlg.locator('button[title="Duplicate provider"]').first().click();
    await page.waitForTimeout(800);

    // A copy appears (one more duplicate action).
    await expect(dlg.locator('button[title="Duplicate provider"]')).toHaveCount(
      before + 1,
      { timeout: 8000 }
    );
    await closeDialog(page);
  });
});
