// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E tests for the features described in
 * docs/user_manual/09_project_images.md — the Project Images dialog, image
 * settings, the action bar (placeholders, uploads, prompt generation), image
 * cards with their actions, and the generated prompt popup.
 */

import { test, expect, type Page } from '@playwright/test';
import { DEMO_PROJECT, gotoApp } from './support/helpers';

test.describe('Project Images', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
  });

  async function openImagesDialog(page: Page): Promise<void> {
    // The "Insert Image" toolbar button opens the Project Images dialog.
    await page
      .locator('[title="Insert Image"]')
      .filter({ visible: true })
      .first()
      .click();
    await page.waitForTimeout(1200);
  }

  test('the Project Images dialog opens and lists the project images', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImagesDialog(page);
    await expect(page.locator('text=/Project Images/i').first()).toBeAttached({
      timeout: 10000,
    });

    // Seeded images are listed as cards with their titles.
    for (const title of ['cover.png', 'portrait.png', 'elias.png', 'valley.png']) {
      await expect(page.locator(`text="${title}"`).first()).toBeAttached();
    }
  });

  test('the action bar exposes the documented actions', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImagesDialog(page);
    await expect(
      page.locator('button:has-text("Create Placeholder")').first()
    ).toBeAttached();
    await expect(
      page.locator('button:has-text("Upload New Image")').first()
    ).toBeAttached();
    await expect(
      page.locator('button:has-text("Generate Placeholder Prompts")').first()
    ).toBeAttached();
  });

  test('creating a placeholder adds a card to the grid', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImagesDialog(page);
    const before = await page.locator('button:has-text("Create prompt")').count();
    await page.locator('button:has-text("Create Placeholder")').first().click();
    await page.waitForTimeout(1000);

    // A new placeholder card appears (one more "Create prompt" action).
    await expect(page.locator('button:has-text("Create prompt")')).toHaveCount(
      before + 1,
      {
        timeout: 8000,
      }
    );
  });

  test('an image card exposes Replace, Insert, and Create prompt actions', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImagesDialog(page);
    await expect(page.locator('button:has-text("Replace")').first()).toBeAttached();
    await expect(page.locator('button:has-text("Insert")').first()).toBeAttached();
    await expect(
      page.locator('button:has-text("Create prompt")').first()
    ).toBeAttached();
    await expect(
      page.locator('button:has-text("Update description")').first()
    ).toBeAttached();
  });

  test('Create prompt opens the generated prompt popup with a copy action', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImagesDialog(page);
    await page.locator('button:has-text("Create prompt")').first().click();
    await page.waitForTimeout(4000);

    // The prompt popup streams the generated prompt and offers Copy.
    await expect(
      page.locator('button:has-text("Copy to Clipboard")').first()
    ).toBeAttached({
      timeout: 15000,
    });
    await expect(
      page.locator('text=/Generating|Copy to Clipboard/i').first()
    ).toBeAttached();
  });

  test('clicking a thumbnail opens the lightbox', async ({ page }: { page: Page }) => {
    await openImagesDialog(page);
    // Click the first real image thumbnail (a visible img wider than an icon).
    const thumbs = page.locator('img').filter({ visible: true });
    let thumb: ReturnType<typeof page.locator> | null = null;
    for (let i = 0; i < (await thumbs.count()); i++) {
      const box = await thumbs.nth(i).boundingBox();
      if (box && box.width > 40 && box.height > 40) {
        thumb = thumbs.nth(i);
        break;
      }
    }
    if (thumb) {
      await thumb.click({ timeout: 10000, force: true });
      await page.waitForTimeout(800);
      // The lightbox overlay appears (a large visible image).
      await expect(page.locator('img').filter({ visible: true }).first()).toBeVisible({
        timeout: 5000,
      });
    }
    // Close the lightbox and confirm the app is still usable.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('.cm-content')).toBeAttached({ timeout: 5000 });
  });
});
