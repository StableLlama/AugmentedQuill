// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E tests for the features described in
 * docs/user_manual/02_projects_and_settings.md — the Settings dialog tabs,
 * project management (create/rename/export/delete), project checkpoints, the
 * Machine Settings (AI providers) tab, and GUI language selection.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { DEMO_PROJECT, gotoApp, openSettings, closeDialog } from './support/helpers';

/** Settings dialog locator. */
function settingsDialog(page: Page): Locator {
  return page.locator('#settings-dialog');
}

/** Click a tab inside the Settings dialog. */
async function openSettingsTab(page: Page, tab: string): Promise<void> {
  await openSettings(page);
  const tabBtn = settingsDialog(page).locator(`button:has-text("${tab}")`).first();
  await tabBtn.click({ timeout: 10000 });
  await page.waitForTimeout(500);
}

test.describe('Projects and Settings', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
  });

  test('the settings dialog exposes the four documented tabs', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettings(page);
    const dialog = settingsDialog(page);
    await expect(dialog).toBeAttached({ timeout: 10000 });
    await expect(dialog.locator('button:has-text("Projects")').first()).toBeAttached();
    await expect(
      dialog.locator('button:has-text("Machine Settings")').first()
    ).toBeAttached();
    await expect(dialog.locator('button:has-text("General")').first()).toBeAttached();
    await expect(dialog.locator('button:has-text("About")').first()).toBeAttached();
  });

  test('the About tab shows version and runtime information', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettingsTab(page, 'About');
    const dialog = settingsDialog(page);
    // Documented fields: version, git revision, built, python, node, browser.
    await expect(dialog.locator('text=/Version/i').first()).toBeAttached();
    await expect(dialog.locator('text=/Git revision/i').first()).toBeAttached();
    await expect(dialog.locator('text=/Python/i').first()).toBeAttached();
    await expect(dialog.locator('text=/Node/i').first()).toBeAttached();
    // Browser user agent reflects the real browser running the app.
    await expect(
      dialog.locator('text=/Chrome|Chromium|Firefox|Safari/i').first()
    ).toBeAttached();
    // License / copyright and GitHub link.
    await expect(
      dialog.locator('text=/GPL|License|Copyright/i').first()
    ).toBeAttached();
    await expect(dialog.locator('a[href*="github.com"]').first()).toBeAttached();
  });

  test('the Projects tab lists projects with active badge and export actions', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettingsTab(page, 'Projects');
    const dialog = settingsDialog(page);

    // The demo project card is listed and is the active project.
    const card = dialog.locator('text="The Undrawn Valley"').first();
    await expect(card).toBeAttached({ timeout: 10000 });
    await expect(dialog.locator('text=/Active/i').first()).toBeAttached();

    // Toolbar actions documented: Refresh, Import, New Project.
    await expect(
      dialog.locator('button:has-text("New Project")').first()
    ).toBeAttached();
  });

  test('creating a new project from the Projects tab loads it immediately', async ({
    page,
  }: {
    page: Page;
  }) => {
    const name = `E2E Novel ${Date.now()}`;
    await openSettingsTab(page, 'Projects');
    const dialog = settingsDialog(page);

    await dialog.locator('button:has-text("New Project")').first().click();
    await page.waitForTimeout(500);

    // Create Project dialog: name field + type radios.
    const createDialog = page
      .locator('[role="dialog"]')
      .filter({ hasText: 'Create Project' });
    await expect(createDialog).toBeAttached({ timeout: 5000 });
    const nameField = createDialog.locator('input[type="text"]').first();
    await nameField.fill(name);

    // Novel is the standard multi-chapter structure.
    await createDialog.locator('label:has-text("Novel")').first().click();

    const createBtn = createDialog.locator('button:has-text("Create Project")').first();
    await expect(createBtn).toBeEnabled({ timeout: 5000 });
    await createBtn.click();
    await page.waitForTimeout(2000);

    // The new project is loaded: its title appears in the app header.
    await expect(page.locator(`text="${name}"`).first()).toBeAttached({
      timeout: 15000,
    });
  });

  test('creating a project is blocked until a name is entered', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettingsTab(page, 'Projects');
    const dialog = settingsDialog(page);
    await dialog.locator('button:has-text("New Project")').first().click();
    await page.waitForTimeout(500);

    const createDialog = page
      .locator('[role="dialog"]')
      .filter({ hasText: 'Create Project' });
    await expect(createDialog).toBeAttached({ timeout: 5000 });
    const createBtn = createDialog.locator('button:has-text("Create Project")').first();
    await expect(createBtn).toBeDisabled();
  });

  test('the project card exposes the documented export controls', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettingsTab(page, 'Projects');
    const dialog = settingsDialog(page);
    const card = dialog.locator('text="The Undrawn Valley"').first();
    await expect(card).toBeAttached({ timeout: 10000 });

    // Documented per-project export controls: EPUB and ZIP.
    await expect(
      dialog.locator('[title="Export Project (EPUB)"]').first()
    ).toBeAttached();
    await expect(
      dialog.locator('[title="Export Project (ZIP)"]').first()
    ).toBeAttached();
    await closeDialog(page);
  });

  test('project checkpoints menu is reachable from the header', async ({
    page,
  }: {
    page: Page;
  }) => {
    const checkpointsBtn = page.locator('[title="Checkpoints"]').first();
    await expect(checkpointsBtn).toBeAttached({ timeout: 10000 });
    await checkpointsBtn.click();
    await page.waitForTimeout(500);
    // The menu exposes the store action and the empty state.
    await expect(
      page.locator('button:has-text("Store Current State")').first()
    ).toBeAttached();
    await expect(page.locator('text="No checkpoints yet"').first()).toBeAttached();
    await closeDialog(page);
  });

  test('storing a checkpoint records the current project state', async ({
    page,
  }: {
    page: Page;
  }) => {
    const checkpointsBtn = page.locator('[title="Checkpoints"]').first();
    await checkpointsBtn.click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Store Current State")').first().click();
    await page.waitForTimeout(2000);

    // The menu stays open: a checkpoint row (timestamp) is now listed.
    await expect(page.locator('text=/\\d{4}-\\d{2}-\\d{2}/').first()).toBeAttached({
      timeout: 8000,
    });
    await closeDialog(page);
  });

  test('the Machine Settings tab shows the configured provider', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettingsTab(page, 'Machine Settings');
    const dialog = settingsDialog(page);

    // The demo provider is listed (seeded in the machine config).
    await expect(dialog.locator('text="Demo Provider"').first()).toBeAttached({
      timeout: 10000,
    });

    // Click the provider card to open its configuration form.
    await dialog.locator('text="Demo Provider"').first().click();
    await page.waitForTimeout(600);

    // Documented connection fields are present (inputs located by placeholder).
    const baseUrl = dialog
      .locator('input[placeholder="https://api.openai.com/v1"]')
      .first();
    await expect(baseUrl).toBeAttached();
    await expect(dialog.locator('input[placeholder^="sk"]').first()).toBeAttached();
    await expect(
      dialog.locator('input[placeholder="Select or type a model id"]').first()
    ).toBeAttached();

    // The provider points at the local mock LLM server.
    await expect(baseUrl).toHaveValue(/28022/);

    // Role toggles documented: Writing / Editing / Chat.
    await expect(dialog.locator('button:has-text("Writing")').first()).toBeAttached();
    await expect(dialog.locator('button:has-text("Editing")').first()).toBeAttached();
    await expect(dialog.locator('button:has-text("Chat")').first()).toBeAttached();

    // Save & Close is available.
    await expect(
      dialog.locator('button:has-text("Save & Close")').first()
    ).toBeAttached();
    await closeDialog(page);
  });

  test('the General tab exposes the GUI language selector', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettingsTab(page, 'General');
    const dialog = settingsDialog(page);
    await expect(dialog.locator('text=/GUI Language|Language/i').first()).toBeAttached({
      timeout: 10000,
    });
    await closeDialog(page);
  });
});
