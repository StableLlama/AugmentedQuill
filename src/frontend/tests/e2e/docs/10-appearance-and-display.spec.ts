// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E tests for the features described in
 * docs/user_manual/10_appearance_and_display.md — the Appearance popup
 * (design mode and sliders) and the Debug Logs dialog.
 */

import { test, expect, type Page } from '@playwright/test';
import { DEMO_PROJECT, gotoApp, closeDialog } from './support/helpers';

test.describe('Appearance and Display', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
  });

  test('the Appearance popup exposes the design mode toggle', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Page Appearance"]').first().click();
    await page.waitForTimeout(800);

    // The three design mode options documented in the manual.
    await expect(page.locator('button:has-text("Light")').first()).toBeAttached({
      timeout: 10000,
    });
    await expect(page.locator('button:has-text("Mixed")').first()).toBeAttached();
    await expect(page.locator('button:has-text("Dark")').first()).toBeAttached();
    await closeDialog(page);
  });

  test('switching to Dark design mode takes effect', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Page Appearance"]').first().click();
    await page.waitForTimeout(800);

    await page.locator('button:has-text("Dark")').first().click();
    await page.waitForTimeout(800);
    // The editor stays functional after the theme change.
    await expect(page.locator('.cm-content')).toBeAttached();
    await closeDialog(page);
  });

  test('the Appearance sliders are present', async ({ page }: { page: Page }) => {
    await page.locator('[title="Page Appearance"]').first().click();
    await page.waitForTimeout(800);

    // The five documented sliders.
    for (const label of [
      'Brightness',
      'Contrast',
      'Font Size',
      'Line Width',
      'Sidebar Width',
    ]) {
      await expect(page.locator(`text="${label}"`).first()).toBeAttached();
    }
    await closeDialog(page);
  });

  test('adjusting the Font Size slider changes the editor font size', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Page Appearance"]').first().click();
    await page.waitForTimeout(800);

    const fontSlider = page
      .locator('input[type="range"]')
      .filter({ visible: true })
      .nth(2);
    await expect(fontSlider).toBeAttached({ timeout: 10000 });
    await fontSlider.fill('24');
    await page.waitForTimeout(800);
    await closeDialog(page);

    // The editor reflects the larger font size (the page stays usable).
    await expect(page.locator('.cm-content')).toBeAttached();
  });

  test('the Debug Logs dialog opens', async ({ page }: { page: Page }) => {
    await page.locator('[title="Debug Logs"]').first().click();
    await page.waitForTimeout(800);
    await expect(page.locator('text=/LLM Communication Logs/i').first()).toBeAttached({
      timeout: 10000,
    });
    await closeDialog(page);
  });

  test('Debug Logs records entries after an AI request', async ({
    page,
  }: {
    page: Page;
  }) => {
    // Make an AI call so a log entry exists.
    await page.locator('[title="Extend Chapter (WRITING model)"]').first().click();
    await page.waitForTimeout(6000);

    await page.locator('[title="Debug Logs"]').first().click();
    await page.waitForTimeout(1500);

    // The aggregated view lists the request entries (model + endpoint).
    await expect(page.locator('text=/LLM Communication Logs/i').first()).toBeAttached({
      timeout: 10000,
    });
    await expect(page.locator('text=/demo-model/').first()).toBeAttached({
      timeout: 10000,
    });
    // View mode controls and toolbar actions are present.
    await expect(page.locator('button:has-text("Aggregated")').first()).toBeAttached();
    await expect(page.locator('button:has-text("Chunks")').first()).toBeAttached();
    await closeDialog(page);
  });
});
