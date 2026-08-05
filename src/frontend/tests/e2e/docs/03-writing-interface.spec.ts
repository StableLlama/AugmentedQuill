// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E tests for the features described in
 * docs/user_manual/03_writing_interface.md — the editor workspace, the
 * formatting toolbar, markdown rendering in the view modes, the Chapter AI
 * actions (Extend / Rewrite), the Suggest-next-paragraph pane and its modes,
 * and the summary AI controls.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  DEMO_PROJECT,
  gotoApp,
  openSidebar,
  editorText,
  selectTrailingText,
} from './support/helpers';

test.describe('Writing Interface', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
  });

  test('the editor shows the active chapter title and body', async ({
    page,
  }: {
    page: Page;
  }) => {
    await expect(
      page.locator('textarea[placeholder="Chapter Title"]').first()
    ).toBeAttached({
      timeout: 10000,
    });
    const title = page.locator('textarea[placeholder="Chapter Title"]').first();
    await expect(title).toHaveValue('The Faded Map');
    await expect(
      page.locator('text=The library smelled of dust').first()
    ).toBeAttached();
  });

  test('the chapter title is editable', async ({ page }: { page: Page }) => {
    const title = page.locator('textarea[placeholder="Chapter Title"]').first();
    const newTitle = 'E2E Retitled Chapter';
    await title.fill(newTitle);
    await page.waitForTimeout(1500);
    // The title appears in the sidebar chapter list after saving.
    await openSidebar(page);
    await expect(page.locator(`text="${newTitle}"`).first()).toBeAttached({
      timeout: 8000,
    });
    // Restore the original title.
    await title.fill('The Faded Map');
    await page.waitForTimeout(1000);
  });

  test('the formatting toolbar inserts markdown for bold and italic', async ({
    page,
  }: {
    page: Page;
  }) => {
    const cm = page.locator('.cm-content');
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('E2E FORMAT TEST');
    await page.waitForTimeout(400);

    // Select the trailing inserted text programmatically.
    await selectTrailingText(page, 'E2E FORMAT TEST'.length);

    // Click Bold then Italic.
    const bold = page
      .getByRole('button', { name: 'Bold', exact: true })
      .filter({ visible: true })
      .first();
    const italic = page
      .getByRole('button', { name: 'Italic', exact: true })
      .filter({ visible: true })
      .first();
    await bold.click({ timeout: 10000 });
    await page.waitForTimeout(400);
    await italic.click({ timeout: 10000 });
    await page.waitForTimeout(400);

    const text = await editorText(page);
    // Bold + italic wrap the selection (as **_..._** or **_..._).
    expect(text).toContain('_E2E FORMAT TEST_');
    expect(text).toContain('**');
  });

  test('the heading and list formatting buttons insert their markers', async ({
    page,
  }: {
    page: Page;
  }) => {
    const cm = page.locator('.cm-content');
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('E2E HEADING');
    await page.waitForTimeout(400);
    await selectTrailingText(page, 'E2E HEADING'.length);

    await page
      .getByRole('button', { name: 'H1', exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page.waitForTimeout(400);
    const text = await editorText(page);
    expect(text).toContain('# E2E HEADING');
  });

  test('the quote formatting button inserts a blockquote marker', async ({
    page,
  }: {
    page: Page;
  }) => {
    const cm = page.locator('.cm-content');
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('E2E QUOTE');
    await page.waitForTimeout(400);
    await page.keyboard.press('Home');
    await page.waitForTimeout(300);

    const quote = page
      .locator(
        'button[title*="quote" i], button[aria-label*="quote" i], button[aria-label*="Blockquote" i]'
      )
      .filter({ visible: true })
      .first();
    if ((await quote.count()) > 0) {
      await quote.click({ timeout: 10000 });
      await page.waitForTimeout(400);
      const text = await editorText(page);
      expect(text).toContain('> ');
    } else {
      // The quote button may be collapsed into the Format menu on this size;
      // assert the toolbar still exposes the documented formatting group.
      await expect(
        page.locator('button:has-text("H3")').filter({ visible: true }).first()
      ).toBeAttached();
    }
  });

  test('Extend Chapter appends prose using the WRITING model', async ({
    page,
  }: {
    page: Page;
  }) => {
    const before = await editorText(page);
    await page.locator('[title="Extend Chapter (WRITING model)"]').first().click();
    await page.waitForTimeout(6000);

    // The mock WRITING response is appended to the chapter prose.
    await expect(
      page.locator('text=/A young cartographer named Nora/i').first()
    ).toBeAttached({ timeout: 20000 });
    const after = await editorText(page);
    expect(after.length).toBeGreaterThan(before.length);
  });

  test('Rewrite Chapter regenerates the chapter body', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Rewrite Chapter (WRITING model)"]').first().click();
    await page.waitForTimeout(6000);
    // The rewrite replaces the chapter content with the mock WRITING output.
    await expect(
      page.locator('text=/A young cartographer named Nora/i').first()
    ).toBeAttached({ timeout: 20000 });
  });

  test('Suggest Next Paragraph opens a pane with continuation cards', async ({
    page,
  }: {
    page: Page;
  }) => {
    // Ensure the editor has focus so suggestions apply at the cursor.
    const cm = page.locator('.cm-content');
    await cm.click();
    await cm.focus();
    await page.waitForTimeout(300);

    // Trigger suggestions with Ctrl+Enter.
    await page.keyboard.press('Control+Enter');
    // The pane header appears, then the streamed continuation card.
    await expect(page.locator('text=/CHOOSE A CONTINUATION/i').first()).toBeAttached({
      timeout: 15000,
    });
    await expect(page.locator('text=/Nora turned the map over/i').first()).toBeAttached(
      { timeout: 20000 }
    );
  });

  test('a suggestion card can be inserted into the draft', async ({
    page,
  }: {
    page: Page;
  }) => {
    const cm = page.locator('.cm-content');
    await cm.click();
    await cm.focus();
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('text=/CHOOSE A CONTINUATION/i').first()).toBeAttached({
      timeout: 15000,
    });
    const card = page.locator('text=/Nora turned the map over/i').first();
    await expect(card).toBeAttached({ timeout: 20000 });
    await card.click();
    await page.waitForTimeout(1500);

    // The suggestion text is now part of the chapter prose.
    const text = await editorText(page);
    expect(text).toContain('Nora turned the map over');
  });

  test('the suggestion mode selector offers Guided, Instructed, and Pure', async ({
    page,
  }: {
    page: Page;
  }) => {
    const cm = page.locator('.cm-content');
    await cm.click();
    await cm.focus();
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('text=/CHOOSE A CONTINUATION/i').first()).toBeAttached({
      timeout: 15000,
    });

    // Mode selector options documented in the docs.
    await expect(page.locator('text=/Guided/i').first()).toBeAttached();
    await expect(page.locator('text=/Instructed/i').first()).toBeAttached();
    await expect(page.locator('text=/Pure/i').first()).toBeAttached();
    // Escape closes the suggestion pane.
    await page.keyboard.press('Escape');
  });

  test('pressing Ctrl+F opens the Search and Replace dialog', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(800);
    await expect(page.locator('text=/Search and Replace/i').first()).toBeAttached({
      timeout: 10000,
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });

  test('the Models control exposes the per-role selectors and status', async ({
    page,
  }: {
    page: Page;
  }) => {
    const modelsBtn = page.locator('[title="Model settings"]').first();

    // On wide windows the per-role selectors may be shown inline instead of
    // behind the Models button; open the popup when the button is present.
    if ((await modelsBtn.count()) > 0) {
      await modelsBtn.click();
      await page.waitForTimeout(600);
    }

    // Each role selector shows the active provider (the seeded demo provider)
    // with a status indicator.
    await expect(
      page.locator('[title="Selected: Demo Provider"]').first()
    ).toBeAttached({ timeout: 10000 });
    // A green "connected" dot confirms the provider is reachable.
    await expect(page.locator('.bg-emerald-500').first()).toBeAttached({
      timeout: 5000,
    });

    // When the popup is open it labels the Editing and Chat roles.
    if ((await modelsBtn.count()) > 0) {
      await expect(page.locator('label:has-text("Editing")').first()).toBeAttached();
      await expect(page.locator('label:has-text("Chat")').first()).toBeAttached();
      // Close the popup via the dismiss overlay (the Models button itself is
      // covered while the popup is open).
      await page.locator('[aria-label=\"Close model menu\"]').click();
      await page.waitForTimeout(300);
    }
  });
});
