// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Smoke tests that validate the docs E2E harness itself.
 *
 * These confirm the isolated app (mock LLM + backend + frontend) boots with
 * seeded demo data, that plain chat streams text, and that chat-driven tool
 * calls execute against the real backend tool pipeline (the foundation the
 * feature specs rely on).
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { DEMO_PROJECT, gotoApp, openSidebar } from './support/helpers';

/** The chat composer input (labeled in the UI). */
function chatComposer(page: Page): Locator {
  return page.locator('[aria-label="Chat message"]');
}

test.describe('Docs E2E harness smoke', () => {
  test('app boots and renders the three-panel writing workspace', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);

    // Editor is present.
    await expect(page.locator('.cm-content')).toBeAttached({ timeout: 10000 });

    // The chat composer (right sidebar) is present.
    await expect(chatComposer(page)).toBeAttached({ timeout: 10000 });
  });

  test('chat streams a plain text response', async ({ page }: { page: Page }) => {
    await gotoApp(page, DEMO_PROJECT);

    const composer = chatComposer(page);
    await composer.click();
    await composer.fill('Tell me a short writing tip.');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);

    // The mock's chat response should appear in the message list.
    await expect(
      page.locator('text=/I can help with that|Here.s the plan/i').first()
    ).toBeAttached({ timeout: 15000 });
  });

  test('chat tool call creates a chapter via the real tool pipeline', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, DEMO_PROJECT);
    await openSidebar(page);

    const composer = chatComposer(page);
    await composer.click();
    await composer.fill('Create a new chapter called "The Mock Chapter".');
    await page.keyboard.press('Enter');

    // The chapter list should eventually contain the new chapter created by
    // the backend tool execution.
    await expect(page.locator('text="The Mock Chapter"').first()).toBeAttached({
      timeout: 30000,
    });
  });
});
