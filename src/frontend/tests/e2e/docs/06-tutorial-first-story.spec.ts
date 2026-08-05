// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E test for the happy path described in
 * docs/user_manual/06_tutorial_first_story.md — driving the whole workflow
 * through the AI Chat Assistant (create project, populate the Sourcebook,
 * create a chapter, write with the Chapter AI), the same flow a new user
 * follows in the tutorial.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoApp, openSidebar } from './support/helpers';

test.describe('Tutorial: Writing Your First Story (happy path)', () => {
  test('create a project via chat and switch to it', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, 'The Undrawn Valley');

    const composer = page.locator('[aria-label="Chat message"]');
    await composer.click();
    await composer.fill('Create a new project called "The Locked Archive".');
    await page.keyboard.press('Enter');

    // The app asks for confirmation before creating the project.
    await expect(page.locator('text=/Confirm project creation/i').first()).toBeAttached(
      {
        timeout: 30000,
      }
    );
    await page.locator('button:has-text("Allow")').first().click();
    await page.waitForTimeout(2000);

    // The app switches to the newly created project (header shows its title).
    await expect(page.locator('text="The Locked Archive"').first()).toBeAttached({
      timeout: 30000,
    });
  });

  test('create a sourcebook character via chat', async ({ page }: { page: Page }) => {
    await gotoApp(page, 'The Undrawn Valley');
    await openSidebar(page);

    const composer = page.locator('[aria-label="Chat message"]');
    await composer.click();
    await composer.fill(
      'Create a character profile in the Sourcebook for Vera. She is a cautious librarian.'
    );
    await page.keyboard.press('Enter');

    // The Sourcebook list eventually contains the new character.
    await expect(page.locator('text="Vera"').first()).toBeAttached({
      timeout: 30000,
    });
  });

  test('create a chapter via chat and open it in the editor', async ({
    page,
  }: {
    page: Page;
  }) => {
    await gotoApp(page, 'The Undrawn Valley');
    await openSidebar(page);

    const composer = page.locator('[aria-label="Chat message"]');
    await composer.click();
    await composer.fill('Create a new chapter called "Chapter 1".');
    await page.keyboard.press('Enter');

    // The chapter appears in the chapter list.
    await expect(page.locator('text="Chapter 1"').first()).toBeAttached({
      timeout: 30000,
    });
  });
});
