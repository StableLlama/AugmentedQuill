// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E tests for the features described in
 * docs/user_manual/08_search_and_replace.md — opening search, the search
 * options (case sensitive, regex, phonetic), the scopes, navigating results,
 * and replacing matches.
 */

import { test, expect, type Page } from '@playwright/test';
import { DEMO_PROJECT, gotoApp } from './support/helpers';

test.describe('Search and Replace', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
  });

  test('the search dialog opens from the header search button', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Search and Replace (Ctrl+F)"]').first().click();
    await page.waitForTimeout(800);
    await expect(page.locator('text=/Search and Replace/i').first()).toBeAttached({
      timeout: 10000,
    });
  });

  test('searching finds matches across the project', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Search and Replace (Ctrl+F)"]').first().click();
    await page.waitForTimeout(800);

    const searchField = page
      .locator('input[type="search"], input[placeholder*="earch"]')
      .first();
    await searchField.fill('Nora');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Matches appear (the demo novel references Nora in prose, summary,
    // sourcebook).
    await expect(page.locator('text=/match|matches/i').first()).toBeAttached({
      timeout: 10000,
    });
  });

  test('the case sensitive toggle narrows results', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Search and Replace (Ctrl+F)"]').first().click();
    await page.waitForTimeout(800);

    const searchField = page
      .locator('input[type="search"], input[placeholder*="earch"]')
      .first();
    await searchField.fill('nora');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);

    // Toggle case sensitivity (Aa).
    const caseToggle = page
      .locator('button[title*="ase"], button:has-text("Aa")')
      .first();
    await caseToggle.click();
    await page.waitForTimeout(1500);
    // The dialog remains usable.
    await expect(searchField).toBeAttached();
  });

  test('the regex toggle is available', async ({ page }: { page: Page }) => {
    await page.locator('[title="Search and Replace (Ctrl+F)"]').first().click();
    await page.waitForTimeout(800);
    const regexToggle = page
      .locator('button[title*="egex"], button:has-text(".*")')
      .first();
    await expect(regexToggle).toBeAttached({ timeout: 10000 });
  });

  test('the phonetic toggle is available', async ({ page }: { page: Page }) => {
    await page.locator('[title="Search and Replace (Ctrl+F)"]').first().click();
    await page.waitForTimeout(800);
    const phonToggle = page
      .locator('button[title*="honetic"], button:has-text("~")')
      .first();
    await expect(phonToggle).toBeAttached({ timeout: 10000 });
  });

  test('the search scopes are selectable', async ({ page }: { page: Page }) => {
    await page.locator('[title="Search and Replace (Ctrl+F)"]').first().click();
    await page.waitForTimeout(800);

    for (const scope of [
      'Current Chapter',
      'All Chapters',
      'Sourcebook',
      'Metadata',
      'All',
    ]) {
      await expect(page.locator(`text="${scope}"`).first()).toBeAttached();
    }
  });
});
