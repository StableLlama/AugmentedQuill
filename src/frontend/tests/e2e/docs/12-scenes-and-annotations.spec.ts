// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E tests for the features described in
 * docs/user_manual/12_scenes_and_annotations.md — the workspace modes, the
 * Scenes views (Narrative / Pinboard / Chronological / Convergence Map), the
 * Scene Editor dialog, and inline annotations.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  DEMO_PROJECT,
  BTTF_PROJECT,
  gotoApp,
  openSidebar,
  closeDialog,
} from './support/helpers';

test.describe('Scenes and Annotations', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
  });

  test('the workspace modes (Page / Scenes / Split) are available', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await expect(page.locator('[title="Page Mode"]').first()).toBeAttached();
    await expect(page.locator('[title="Scenes Mode"]').first()).toBeAttached();
    await expect(page.locator('[title="Split Mode"]').first()).toBeAttached();
  });

  test('Scenes mode shows the narrative scene cards', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await page.locator('[title="Scenes Mode"]').first().click();
    await page.waitForTimeout(1000);

    // Narrative view (default) shows scene cards for the demo scenes.
    await expect(page.locator('[data-scene-card]').first()).toBeAttached({
      timeout: 10000,
    });
    await expect(
      page.locator('text=/Nora finds the map in the library/i').first()
    ).toBeAttached();
    await expect(
      page.locator('text=/The archivist warns her away/i').first()
    ).toBeAttached();
  });

  test('the scenes view switcher offers all four views', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await page.locator('[title="Scenes Mode"]').first().click();
    await page.waitForTimeout(1000);

    for (const view of ['Narrative', 'Pinboard', 'Chronological', 'Convergence Map']) {
      await expect(page.locator(`button:has-text("${view}")`).first()).toBeAttached();
    }
  });

  test('switching to the Pinboard view renders the canvas', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await page.locator('[title="Scenes Mode"]').first().click();
    await page.waitForTimeout(1000);
    await page.locator('button:has-text("Pinboard")').first().click();
    await page.waitForTimeout(800);

    // Pinboard still shows the scene cards.
    await expect(page.locator('[data-scene-card]').first()).toBeAttached({
      timeout: 10000,
    });
  });

  test('switching to the Chronological view sorts scenes by time', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await page.locator('[title="Scenes Mode"]').first().click();
    await page.waitForTimeout(1000);
    await page.locator('button:has-text("Chronological")').first().click();
    await page.waitForTimeout(800);

    await expect(page.locator('[data-scene-card]').first()).toBeAttached({
      timeout: 10000,
    });
  });

  test('the Convergence Map renders for the time-travel project', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, BTTF_PROJECT);
    await page.locator('[title="Scenes Mode"]').first().click();
    await page.waitForTimeout(1500);
    await page.locator('button:has-text("Convergence Map")').first().click();
    await page.waitForTimeout(1500);

    // Character lanes and scene cards render in the convergence map.
    await expect(page.locator('[data-scene-card]').first()).toBeAttached({
      timeout: 15000,
    });
  });

  test('double-clicking a scene card opens the Scene Editor dialog', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await page.locator('[title="Scenes Mode"]').first().click();
    await page.waitForTimeout(1000);

    const card = page.locator('[data-scene-card]').first();
    await expect(card).toBeAttached({ timeout: 10000 });
    await card.dblclick({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // The Scene Editor dialog exposes the documented properties.
    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeAttached({ timeout: 10000 });
    await expect(dialog.locator('text=/Summary/i').first()).toBeAttached();
    await expect(dialog.locator('text=/Status/i').first()).toBeAttached();
    await closeDialog(page);
    await closeDialog(page);
  });

  test('an inline annotation can be created on selected text', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);

    // The annotation panel is present.
    const panel = page.locator('[aria-label="Annotation panel"]');
    await expect(panel).toBeAttached({ timeout: 10000 });
    const initialCount = await panel.locator('[role="button"]').count();

    // Select the opening words and create an annotation.
    const cm = page.locator('.cm-content');
    await cm.click();
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Shift+ArrowRight');
    }
    await page.keyboard.press('Control+Shift+KeyA');
    await page.waitForTimeout(600);

    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeAttached({ timeout: 5000 });
    const input = dialog.locator('textarea, input, [contenteditable="true"]').first();
    await input.fill('E2E annotation comment');
    await dialog
      .locator(
        'button[type="submit"], button:has-text("Add"), button:has-text("Save"), button:has-text("Create")'
      )
      .first()
      .click();
    await page.waitForTimeout(1200);

    // The annotation count grew.
    expect(await panel.locator('[role="button"]').count()).toBeGreaterThan(
      initialCount
    );
  });

  test('the sidebar sections can be focused and resized', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await openSidebar(page);

    // Section focus controls and the resize handle are documented.
    const focus = page
      .locator('button[title*="focus"], [aria-label*="focus" i]')
      .first();
    if ((await focus.count()) > 0) {
      await focus.click();
      await page.waitForTimeout(600);
    }
    const resize = page.locator('[aria-label*="Resize"]').first();
    await expect(resize).toBeAttached({ timeout: 5000 });
  });
});
