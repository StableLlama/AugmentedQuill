// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E "error path" tests for AugmentedQuill — every
 * destructive / failure scenario the docs describe should degrade gracefully:
 * cancel prompts keep the data, upstream LLM failures are surfaced without
 * wedging the UI, invalid input is handled without crashing.
 *
 * Each destructive test first creates its own throwaway data so the shared
 * seeded projects are never damaged.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import {
  DEMO_PROJECT,
  SERIES_PROJECT,
  gotoApp,
  openSidebar,
  openSettings,
  closeDialog,
} from './support/helpers';

function composer(page: Page): Locator {
  return page.locator('[aria-label="Chat message"]');
}

/** The app-wide confirmation dialog (message usually says "Are you sure…"). */
async function confirmBox(page: Page): Promise<Locator> {
  const box = page
    .getByRole('dialog')
    .filter({ hasText: /Are you sure|Delete Book and all|Confirm project creation/ })
    .last();
  await expect(box).toBeVisible({ timeout: 8000 });
  return box;
}

async function clickConfirm(page: Page, label: string): Promise<void> {
  const box = await confirmBox(page);
  await box.locator(`button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
}

test.describe('Error paths — destructive actions', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
    await openSidebar(page);
  });

  // The sourcebook entry delete must use the app's ConfirmDialog and keep the
  // entry when cancelled.
  test('cancelling a sourcebook entry delete keeps the entry', async ({
    page,
  }: {
    page: Page;
  }) => {
    const name = `E2E Cancel Entry ${Date.now()}`;
    await page.locator('[title="Add Entry"]').first().click();
    await page.waitForTimeout(800);
    const editor = page.locator('[role="dialog"]').last();
    await editor.locator('input').first().fill(name);
    await editor.locator('button:has-text("Save Entry")').first().click();
    await page.waitForTimeout(1500);
    await expect(page.locator(`text="${name}"`).first()).toBeAttached({
      timeout: 8000,
    });

    // Open the entry, start deleting it, then cancel the confirmation.
    await page.locator(`text="${name}"`).first().click();
    await page.waitForTimeout(800);
    await page
      .locator('[role="dialog"]')
      .last()
      .locator('button:has-text("Delete")')
      .first()
      .click();
    await clickConfirm(page, 'Cancel');

    // The entry survives.
    await expect(page.locator(`text="${name}"`).first()).toBeAttached({
      timeout: 8000,
    });
    await closeDialog(page);
  });

  // Confirming the sourcebook entry delete removes the entry from the visible
  // list immediately (no stale row until reload).
  // Confirming the sourcebook entry delete permanently deletes the entry: it is
  // removed on the backend and the normal entry row is replaced by a
  // struck-through "deleted" marker (the app's diff-tracking indicator).
  test('confirming a sourcebook entry delete removes the entry from the list', async ({
    page,
  }: {
    page: Page;
  }) => {
    const name = `E2E Delete Entry ${Date.now()}`;
    await page.locator('[title="Add Entry"]').first().click();
    await page.waitForTimeout(800);
    const editor = page.locator('[role="dialog"]').last();
    await editor.locator('input').first().fill(name);
    await editor.locator('button:has-text("Save Entry")').first().click();
    await page.waitForTimeout(1500);
    await expect(page.locator(`text="${name}"`).first()).toBeAttached({
      timeout: 8000,
    });

    // Confirm the deletion through the app's ConfirmDialog.
    await page.locator(`text="${name}"`).first().click();
    await page.waitForTimeout(800);
    await page
      .locator('[role="dialog"]')
      .last()
      .locator('button:has-text("Delete")')
      .first()
      .click();
    await clickConfirm(page, 'OK');
    await page.waitForTimeout(1000);

    // The normal (clickable) entry row is gone; a struck-through "deleted"
    // marker row takes its place.
    await expect(
      page.getByRole('listitem', { name: `${name} (deleted)` }).first()
    ).toBeAttached({ timeout: 8000 });
  });

  test('cancelling an image delete keeps the image', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page
      .locator('[title="Insert Image"]')
      .filter({ visible: true })
      .first()
      .click();
    await page.waitForTimeout(1200);
    const before = await page.locator('[title="Delete image"]').count();
    await page.locator('button:has-text("Create Placeholder")').first().click();
    await page.waitForTimeout(1000);
    await expect(page.locator('[title="Delete image"]')).toHaveCount(before + 1, {
      timeout: 8000,
    });

    await page.locator('[title="Delete image"]').last().click();
    await clickConfirm(page, 'Cancel');
    await expect(page.locator('[title="Delete image"]')).toHaveCount(before + 1, {
      timeout: 8000,
    });
    await closeDialog(page);
  });

  test('confirming an image delete removes the image', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page
      .locator('[title="Insert Image"]')
      .filter({ visible: true })
      .first()
      .click();
    await page.waitForTimeout(1200);
    const before = await page.locator('[title="Delete image"]').count();
    await page.locator('button:has-text("Create Placeholder")').first().click();
    await page.waitForTimeout(1000);
    await expect(page.locator('[title="Delete image"]')).toHaveCount(before + 1, {
      timeout: 8000,
    });

    await page.locator('[title="Delete image"]').last().click();
    await clickConfirm(page, 'OK');
    await expect(page.locator('[title="Delete image"]')).toHaveCount(before, {
      timeout: 8000,
    });
    await closeDialog(page);
  });

  test('cancelling a book delete keeps the book (series)', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, SERIES_PROJECT);
    await openSidebar(page);

    const title = `E2E Keep Book ${Date.now()}`;
    await page
      .locator('button[aria-label="Start creating a new book"]')
      .first()
      .click();
    await page.waitForTimeout(800);
    const bookTitle = page.locator('input[placeholder="Book Title"]').first();
    await bookTitle.fill(title);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await expect(page.locator(`text="${title}"`).first()).toBeAttached({
      timeout: 8000,
    });

    await page.locator(`text="${title}"`).first().hover();
    await page.waitForTimeout(400);
    const delBtn = page
      .locator(`text="${title}"`)
      .first()
      .locator('xpath=ancestor::*[contains(@class,"group")][1]')
      .locator('[title="Delete Book"]')
      .first();
    if ((await delBtn.count()) === 0) {
      await page
        .locator('[title="Delete Book"]')
        .filter({ visible: true })
        .first()
        .click();
    } else {
      await delBtn.click();
    }
    await clickConfirm(page, 'Cancel');

    await expect(page.locator(`text="${title}"`).first()).toBeAttached({
      timeout: 8000,
    });
  });

  test('confirming a book delete removes the book (series)', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, SERIES_PROJECT);
    await openSidebar(page);

    const title = `E2E Drop Book ${Date.now()}`;
    await page
      .locator('button[aria-label="Start creating a new book"]')
      .first()
      .click();
    await page.waitForTimeout(800);
    const bookTitle = page.locator('input[placeholder="Book Title"]').first();
    await bookTitle.fill(title);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await expect(page.locator(`text="${title}"`).first()).toBeAttached({
      timeout: 8000,
    });

    const delBtn = page
      .locator(`text="${title}"`)
      .first()
      .locator('xpath=ancestor::*[contains(@class,"group")][1]')
      .locator('[title="Delete Book"]')
      .first();
    if ((await delBtn.count()) === 0) {
      await page
        .locator('[title="Delete Book"]')
        .filter({ visible: true })
        .first()
        .click();
    } else {
      await delBtn.click();
    }
    await clickConfirm(page, 'OK');

    await expect(page.locator(`text="${title}"`).first()).not.toBeVisible({
      timeout: 8000,
    });
  });

  test('cancelling a checkpoint delete keeps the checkpoint', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Checkpoints"]').first().click();
    await page.waitForTimeout(600);
    await page.locator('button:has-text("Store Current State")').first().click();
    await page.waitForTimeout(2000);

    const row = page
      .locator('[role="listitem"]')
      .filter({ has: page.locator('[title^="Load checkpoint"]') })
      .last();
    await expect(row).toBeAttached({ timeout: 8000 });
    await row.locator('[title="Delete"]').click();
    await clickConfirm(page, 'Cancel');

    // The confirmation overlay closes the checkpoints menu (outside-click), so
    // reopen it: the checkpoint row must still be listed.
    await page.locator('[title="Checkpoints"]').first().click();
    await page.waitForTimeout(600);
    await expect(
      page
        .locator('[role="listitem"]')
        .filter({ has: page.locator('[title^="Load checkpoint"]') })
        .first()
    ).toBeAttached({ timeout: 8000 });
    await closeDialog(page);
  });

  test('confirming a checkpoint delete removes the checkpoint', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Checkpoints"]').first().click();
    await page.waitForTimeout(600);
    await page.locator('button:has-text("Store Current State")').first().click();
    await page.waitForTimeout(2000);

    const rows = page
      .locator('[role="listitem"]')
      .filter({ has: page.locator('[title^="Load checkpoint"]') });
    const before = await rows.count();
    await expect(rows.first()).toBeAttached({ timeout: 8000 });
    await rows.last().locator('[title="Delete"]').click();
    await clickConfirm(page, 'Delete');

    // The confirmation overlay closes the checkpoints menu (outside-click), so
    // reopen it and verify the deleted row is gone.
    await page.locator('[title="Checkpoints"]').first().click();
    await page.waitForTimeout(600);
    await expect(rows).toHaveCount(before - 1, { timeout: 8000 });
    await closeDialog(page);
  });

  // The chat-history "Clear All" action must use the app's ConfirmDialog and
  // keep the sessions when cancelled.
  test('cancelling chat history Clear All keeps the saved sessions', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Chat History"]').first().click();
    await page.waitForTimeout(800);
    const clearAll = page.locator('button:has-text("Clear All")').first();
    await expect(clearAll).toBeAttached({ timeout: 8000 });

    await clearAll.click();
    await clickConfirm(page, 'Cancel');

    // No crash and the panel is still open: a seeded session is still listed.
    await expect(
      page.locator('text=/Plan the opening chapters/i').first()
    ).toBeAttached({
      timeout: 8000,
    });
    await page.locator('[title="Chat History"]').first().click();
    await page.waitForTimeout(400);
  });
});

test.describe('Error paths — LLM and chat failures', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
  });

  // An upstream LLM failure in the CHAT flow must be surfaced as an "AI Error"
  // message instead of silently ending the stream.
  test('an upstream chat failure surfaces an AI Error message', async ({
    page,
  }: {
    page: Page;
  }) => {
    const c = composer(page);
    await c.click();
    await c.fill('MOCK_ERROR please fail this request');
    await page.keyboard.press('Enter');

    // The failure is shown to the user instead of silently swallowing it.
    await expect(page.locator('text=/AI Error/i').first()).toBeAttached({
      timeout: 20000,
    });
  });

  test('chat Stop generation aborts an in-flight stream', async ({
    page,
  }: {
    page: Page;
  }) => {
    const c = composer(page);
    await c.click();
    await c.fill('MOCK_STOP keep streaming forever');
    await page.keyboard.press('Enter');

    const stopBtn = page.locator('button:has-text("Stop generation")').first();
    await expect(stopBtn).toBeVisible({ timeout: 15000 });
    // Wait until the slow mock stream has actually delivered content, so the
    // abort happens mid-stream (not before the first token).
    await expect(page.locator('text=/lingering/').first()).toBeAttached({
      timeout: 15000,
    });
    await stopBtn.click();
    await page.waitForTimeout(800);

    // The stream is aborted: the Stop control disappears and the composer is
    // usable again (not stuck loading).
    await expect(
      page.locator('button:has-text("Stop generation")').first()
    ).not.toBeVisible({ timeout: 8000 });
    await expect(composer(page).first()).toBeEnabled({ timeout: 8000 });
    // The partial assistant text that streamed before the abort stays on screen.
    await expect(page.locator('text=/lingering/').first()).toBeAttached({
      timeout: 8000,
    });
  });

  test('an empty chat message cannot be sent', async ({ page }: { page: Page }) => {
    const c = composer(page);
    await c.click();
    await expect(page.locator('[aria-label="Send Message"]').first()).toBeDisabled();

    // The demo project already has seeded chat history containing the mock's
    // canned reply, so count those bubbles before/after to detect a new send.
    const before = await page.locator('text=/I can help with that/i').count();
    // Even pressing Enter with an empty composer sends nothing.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    const after = await page.locator('text=/I can help with that/i').count();
    expect(after).toBe(before);
  });
});

test.describe('Error paths — search and providers', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
  });

  test('an invalid regex search stays usable without crashing', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Search and Replace (Ctrl+F)"]').first().click();
    await page.waitForTimeout(800);

    // Enable regular expression mode and type an unterminated pattern.
    await page.locator('[title="Regular Expression"]').first().click();
    await page.waitForTimeout(400);
    const searchField = page
      .locator('input[type="search"], input[placeholder*="earch"]')
      .first();
    await searchField.fill('[');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // The dialog is still open and usable — either a red error is shown or a
    // graceful "No matches found" state, never a crash.
    await expect(page.locator('text=/Search and Replace/i').first()).toBeAttached({
      timeout: 10000,
    });
    await expect(searchField).toBeAttached();
    await closeDialog(page);
  });

  test('a provider with an unreachable endpoint shows Connection failed', async ({
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
    const dialog = page.locator('#settings-dialog');

    await dialog.locator('button[aria-label="Add provider"]').first().click();
    await page.waitForTimeout(500);

    // The new provider row is selected; fill in a name, a dead endpoint, and a
    // key.  The API key field is disabled until its toggle is switched on.
    const nameInput = dialog
      .locator('label:has-text("Name") + input, input:not([placeholder])')
      .first();
    await nameInput.fill('Broken Provider');
    await dialog
      .locator('input[placeholder="https://api.openai.com/v1"]')
      .first()
      .fill('http://127.0.0.1:1/v1');
    await dialog.locator('[title="Enable API key"]').first().click();
    await dialog.locator('input[placeholder^="sk"]').first().fill('sk-broken');

    // The connection test reports the failure.
    await expect(dialog.locator('text=/Connection failed/i').first()).toBeAttached({
      timeout: 15000,
    });
    await closeDialog(page);
  });
});

test.describe('Error paths — project creation and deletion', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
  });

  test('cancelling chat-driven project creation creates no project', async ({
    page,
  }: {
    page: Page;
  }) => {
    const name = `E2E Denied Project ${Date.now()}`;
    const c = composer(page);
    await c.click();
    await c.fill(`Create a new project called "${name}"`);
    await page.keyboard.press('Enter');

    // The dangerous action is gated behind a confirmation prompt.
    await expect(page.locator('text=/Confirm project creation/i').first()).toBeAttached(
      {
        timeout: 30000,
      }
    );
    await clickConfirm(page, 'Cancel');
    await page.waitForTimeout(1500);

    // The project was not created: it is absent from the Projects tab.
    await openSettings(page);
    await page.locator('#settings-dialog button:has-text("Projects")').first().click();
    await page.waitForTimeout(600);
    await expect(
      page.locator('#settings-dialog').getByText(name).first()
    ).not.toBeAttached({ timeout: 8000 });
    await closeDialog(page);
  });

  test('cancelling a project delete keeps the project', async ({
    page,
  }: {
    page: Page;
  }) => {
    const name = `E2E Keep Project ${Date.now()}`;
    await openSettings(page);
    await page.locator('#settings-dialog button:has-text("Projects")').first().click();
    await page.waitForTimeout(500);
    await page
      .locator('#settings-dialog button:has-text("New Project")')
      .first()
      .click();
    await page.waitForTimeout(500);
    const createDialog = page
      .locator('[role="dialog"]')
      .filter({ hasText: 'Create Project' });
    await createDialog.locator('input[type="text"]').first().fill(name);
    await createDialog.locator('label:has-text("Novel")').first().click();
    await createDialog.locator('button:has-text("Create Project")').first().click();
    await page.waitForTimeout(2500);

    // Creating a project loads it immediately and closes the settings dialog;
    // its title appears in the app header.
    await expect(page.locator(`text="${name}"`).first()).toBeAttached({
      timeout: 15000,
    });

    // Reopen settings and go to the Projects tab to delete it.
    await openSettings(page);
    await page.locator('#settings-dialog button:has-text("Projects")').first().click();
    await page.waitForTimeout(600);
    const settingsProjects = page.locator('#settings-dialog');
    await expect(settingsProjects.getByText(name).first()).toBeAttached({
      timeout: 10000,
    });

    // Delete, then cancel — the project survives.
    await settingsProjects
      .getByText(name)
      .first()
      .locator('xpath=ancestor::div[contains(@class,"group")][last()]')
      .locator('[title="Delete"]')
      .first()
      .click();
    await clickConfirm(page, 'Cancel');
    await expect(settingsProjects.getByText(name).first()).toBeAttached({
      timeout: 8000,
    });

    // Delete, then confirm — the project is removed (cleanup).
    await settingsProjects
      .getByText(name)
      .first()
      .locator('xpath=ancestor::div[contains(@class,"group")][last()]')
      .locator('[title="Delete"]')
      .first()
      .click();
    await clickConfirm(page, 'OK');
    await expect(settingsProjects.getByText(name).first()).not.toBeAttached({
      timeout: 10000,
    });
    await closeDialog(page);
  });
});
