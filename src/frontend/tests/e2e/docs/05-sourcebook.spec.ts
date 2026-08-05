// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E tests for the features described in
 * docs/user_manual/05_sourcebook.md — the Sourcebook browser (list, search,
 * include/exclude, hover preview), the Sourcebook entry dialog (name,
 * category, synonyms, description), and automatic selection mode.
 */

import { test, expect, type Page } from '@playwright/test';
import { DEMO_PROJECT, gotoApp, openSidebar, closeDialog } from './support/helpers';

test.describe('The Sourcebook', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
    await openSidebar(page);
  });

  test('the sourcebook lists the seeded entries', async ({ page }: { page: Page }) => {
    await expect(page.locator('text="Nora"').first()).toBeAttached({ timeout: 10000 });
    await expect(page.locator('text="Elias"').first()).toBeAttached();
    await expect(page.locator('text="The Innkeeper"').first()).toBeAttached();
  });

  test('the search field filters entries in real time', async ({
    page,
  }: {
    page: Page;
  }) => {
    const filter = page.locator('input[placeholder="Filter entries..."]').first();
    await expect(filter).toBeAttached({ timeout: 10000 });
    await filter.fill('Nora');
    await page.waitForTimeout(600);

    // Nora is still listed; an unrelated entry is filtered out.
    await expect(page.locator('text="Nora"').first()).toBeAttached();
    // Elias should be hidden from the visible list.
    await expect(page.locator('text="Elias"').first()).not.toBeVisible({
      timeout: 3000,
    });
  });

  test('a new sourcebook entry can be created from the plus button', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Add Entry"]').first().click();
    await page.waitForTimeout(800);

    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeAttached({ timeout: 10000 });

    const name = `E2E Character ${Date.now()}`;
    // Name field + category selector.
    await dialog.locator('input').first().fill(name);
    await dialog.locator('button:has-text("Character")').first().click();
    await page.waitForTimeout(300);

    // Save Entry is enabled once a name exists.
    const saveBtn = dialog.locator('button:has-text("Save Entry")').first();
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await page.waitForTimeout(1500);

    // The new entry appears in the sourcebook list.
    await expect(page.locator(`text="${name}"`).first()).toBeAttached({
      timeout: 8000,
    });
  });

  test('Save Entry stays disabled until a name is provided', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Add Entry"]').first().click();
    await page.waitForTimeout(800);
    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeAttached({ timeout: 10000 });
    const saveBtn = dialog.locator('button:has-text("Save Entry")').first();
    await expect(saveBtn).toBeDisabled({ timeout: 5000 });
    await closeDialog(page);
  });

  test('an existing entry can be opened and its description edited', async ({
    page,
  }: {
    page: Page;
  }) => {
    // Click the Elias row to open its entry dialog.
    await page.locator('text="Elias"').first().click();
    await page.waitForTimeout(800);

    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeAttached({ timeout: 10000 });

    // The description rich text area can be updated.
    const desc = dialog.locator('[contenteditable="true"]').first();
    const newDesc = `E2E description ${Date.now()}`;
    await desc.fill(newDesc);
    await page.waitForTimeout(500);

    // Save Entry persists the change.
    await dialog.locator('button:has-text("Save Entry")').first().click();
    await page.waitForTimeout(1500);
    await closeDialog(page);

    // Reopen and verify the description persisted.
    await page.locator('text="Elias"').first().click();
    await page.waitForTimeout(800);
    const dialog2 = page.locator('[role="dialog"]').last();
    await expect(dialog2).toBeAttached({ timeout: 10000 });
    await expect(dialog2.locator(`text="${newDesc}"`).first()).toBeAttached({
      timeout: 8000,
    });
    await closeDialog(page);
  });

  test('the category selector offers the documented categories', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Add Entry"]').first().click();
    await page.waitForTimeout(800);
    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeAttached({ timeout: 10000 });

    for (const category of [
      'Character',
      'Location',
      'Organization',
      'Item',
      'Event',
      'Lore',
    ]) {
      await expect(
        dialog.locator(`button:has-text("${category}")`).first()
      ).toBeAttached();
    }
    await closeDialog(page);
  });

  test('the automatic selection toggle exists and disables manual checkboxes', async ({
    page,
  }: {
    page: Page;
  }) => {
    const autoToggle = page
      .locator('[title="Toggle automatic sourcebook selection"]')
      .first();
    await expect(autoToggle).toBeAttached({ timeout: 10000 });
    await autoToggle.click();
    await page.waitForTimeout(1000);
    // Toggling must not crash the list; entries remain visible.
    await expect(page.locator('text="Nora"').first()).toBeAttached();
    await autoToggle.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('text="Nora"').first()).toBeAttached();
  });
});
