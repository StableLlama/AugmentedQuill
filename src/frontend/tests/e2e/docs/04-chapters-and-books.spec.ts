// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E tests for the features described in
 * docs/user_manual/04_chapters_and_books.md — story types, managing chapters
 * (select/add/delete), the Metadata Editor dialog (summary/notes/private
 * notes/conflicts), conflict tracking, and the series book controls.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  DEMO_PROJECT,
  SERIES_PROJECT,
  gotoApp,
  openSidebar,
  closeDialog,
} from './support/helpers';

test.describe('Chapters and Books', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
  });

  test('clicking a chapter in the sidebar loads it into the editor', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await openSidebar(page);

    // Chapter 2 exists in the sidebar; clicking it loads its prose.
    await page.locator('text="The Empty Road"').first().click();
    await page.waitForTimeout(1500);
    await expect(
      page.locator('text=The road narrowed as it climbed').first()
    ).toBeAttached({ timeout: 10000 });
  });

  test('adding a chapter appends it to the novel chapter list', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await openSidebar(page);

    const addBtn = page.locator('[title="New Chapter"]').first();
    await expect(addBtn).toBeAttached({ timeout: 10000 });
    const editCountBefore = await page.locator('[title="Edit Metadata"]').count();
    await addBtn.click();
    await page.waitForTimeout(2000);

    // A new chapter card appears in the list (one more edit button).
    await expect(page.locator('[title="Edit Metadata"]')).toHaveCount(
      editCountBefore + 1,
      { timeout: 8000 }
    );
  });

  test('the Metadata Editor dialog exposes the documented tabs', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await openSidebar(page);

    // Open the metadata editor for the active chapter (first edit button).
    await page.locator('[title="Edit Metadata"]').first().click({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // The dialog opens and shows the documented tabs.
    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeAttached({ timeout: 10000 });
    await expect(dialog.locator('button:has-text("Summary")').first()).toBeAttached();
    await expect(dialog.locator('button:has-text("Notes")').first()).toBeAttached();
    await expect(
      dialog.locator('button:has-text("Private Notes")').first()
    ).toBeAttached();
    await expect(dialog.locator('button:has-text("Conflicts")').first()).toBeAttached();
    await closeDialog(page);
  });

  test('the chapter summary can be edited in the Metadata Editor', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await openSidebar(page);

    // Edit metadata for "The Empty Road" (the second chapter card).
    await page.locator('[title="Edit Metadata"]').nth(1).click({ timeout: 10000 });
    await page.waitForTimeout(1000);

    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeAttached({ timeout: 10000 });

    // The Summary tab contains a rich text area; type a new summary.
    await dialog.locator('button:has-text("Summary")').first().click();
    await page.waitForTimeout(400);
    const summaryArea = dialog.locator('[contenteditable="true"]').first();
    const newSummary = `E2E summary ${Date.now()}`;
    await summaryArea.fill(newSummary);
    await page.waitForTimeout(1500);

    // Close and verify the summary appears in the sidebar card.
    await closeDialog(page);
    await page.waitForTimeout(800);
    await expect(page.locator(`text="${newSummary}"`).first()).toBeAttached({
      timeout: 8000,
    });
  });

  test('a conflict can be added to a chapter', async ({ page }: { page: Page }) => {
    await gotoApp(page, DEMO_PROJECT);
    await openSidebar(page);

    await page.locator('[title="Edit Metadata"]').first().click({ timeout: 10000 });
    await page.waitForTimeout(1000);

    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeAttached({ timeout: 10000 });
    await dialog.locator('button:has-text("Conflicts")').first().click();
    await page.waitForTimeout(500);

    // "Add Conflict" appends a row (conflict fields are rich text areas).
    const addConflict = dialog.locator('button:has-text("Add Conflict")').first();
    await expect(addConflict).toBeAttached({ timeout: 5000 });
    const countBefore = await dialog.locator('[contenteditable="true"]').count();
    await addConflict.click();
    await page.waitForTimeout(600);
    expect(await dialog.locator('[contenteditable="true"]').count()).toBeGreaterThan(
      countBefore
    );

    await closeDialog(page);
  });

  test('the series project lists books with their chapters', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, SERIES_PROJECT);
    await openSidebar(page);

    // Books are the top-level groups.
    await expect(page.locator('text="The Signal"').first()).toBeAttached({
      timeout: 10000,
    });
    await expect(page.locator('text="The Shore"').first()).toBeAttached();
    // Chapters inside books.
    await expect(page.locator('text="First Watch"').first()).toBeAttached();
    await expect(page.locator('text="The Wreck"').first()).toBeAttached();
    await expect(page.locator('text="The Visitor"').first()).toBeAttached();
  });

  test('a book can be added to the series', async ({ page }: { page: Page }) => {
    await gotoApp(page, SERIES_PROJECT);
    await openSidebar(page);

    const addBookBtn = page
      .locator('button[aria-label="Start creating a new book"]')
      .first();
    await expect(addBookBtn).toBeAttached({ timeout: 10000 });
    await addBookBtn.click();
    await page.waitForTimeout(800);

    // An inline title field appears; name the book and confirm with Enter.
    const bookTitle = page.locator('input[placeholder="Book Title"]').first();
    await expect(bookTitle).toBeAttached({ timeout: 5000 });
    await bookTitle.fill('E2E Book');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);

    await expect(page.locator('text="E2E Book"').first()).toBeAttached({
      timeout: 8000,
    });
  });
});
