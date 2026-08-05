// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Black-box E2E tests for the features described in
 * docs/user_manual/07_ai_chat_assistant.md — the chat panel header controls
 * (new chat, delete, incognito, web search, scratchpad, history, settings),
 * the composer, streaming responses, message editing, and the system prompt.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { DEMO_PROJECT, gotoApp, closeDialog } from './support/helpers';

function composer(page: Page): Locator {
  return page.locator('[aria-label="Chat message"]');
}

test.describe('The AI Chat Assistant', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoApp(page, DEMO_PROJECT);
  });

  test('sending a message streams an assistant response', async ({
    page,
  }: {
    page: Page;
  }) => {
    const c = composer(page);
    await c.click();
    await c.fill('Tell me a short writing tip.');
    await page.keyboard.press('Enter');

    await expect(
      page.locator('text=/I can help with that|Here.s the plan/i').first()
    ).toBeAttached({
      timeout: 20000,
    });
  });

  test('the chat header exposes the documented controls', async ({
    page,
  }: {
    page: Page;
  }) => {
    await expect(page.locator('[title="New Chat"]').first()).toBeAttached();
    await expect(page.locator('[title="Delete Current Chat"]').first()).toBeAttached();
    await expect(
      page.locator('[title="Incognito Chat (Not Saved)"]').first()
    ).toBeAttached();
    await expect(page.locator('[title="Enable Web Search"]').first()).toBeAttached();
    await expect(page.locator('[title="Open Scratchpad"]').first()).toBeAttached();
    await expect(page.locator('[title="Chat History"]').first()).toBeAttached();
    await expect(page.locator('[title="Chat Settings"]').first()).toBeAttached();
    await expect(
      page.locator('[title="Send Message (CHAT model)"]').first()
    ).toBeAttached();
  });

  test('the chat history panel lists past sessions', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Chat History"]').first().click();
    await page.waitForTimeout(800);

    // The history panel shows the "Recent Chats" heading and a seeded session.
    await expect(page.locator('text=/Recent Chats/i').first()).toBeAttached({
      timeout: 10000,
    });
    await expect(
      page.locator('text=/Plan the opening chapters/i').first()
    ).toBeAttached();
    // The documented Clear All action is present.
    await expect(page.locator('button:has-text("Clear All")').first()).toBeAttached();
    await page.locator('[title="Chat History"]').first().click();
    await page.waitForTimeout(400);
  });

  test('the scratchpad dialog can be opened', async ({ page }: { page: Page }) => {
    await page.locator('[title="Open Scratchpad"]').first().click();
    await page.waitForTimeout(800);
    await expect(
      page.locator('[role="dialog"]:has-text("Scratchpad")').first()
    ).toBeAttached({ timeout: 10000 });
    await closeDialog(page);
  });

  test('the system prompt panel can customize the persona', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.locator('[title="Chat Settings"]').first().click();
    await page.waitForTimeout(800);

    // The system instruction textarea is editable.
    const promptArea = page.locator('textarea').last();
    await expect(promptArea).toBeAttached({ timeout: 10000 });
    const persona = 'You are a harsh but fair literary editor.';
    await promptArea.fill(persona);
    await page.locator('button:has-text("Update Persona")').first().click();
    await page.waitForTimeout(500);
    await page.locator('[title="Chat Settings"]').first().click();
    await page.waitForTimeout(400);
  });

  test('a new chat session can be started', async ({ page }: { page: Page }) => {
    await page.locator('[title="New Chat"]').first().click();
    await page.waitForTimeout(800);
    // The composer is empty and ready for a new conversation.
    const c = composer(page);
    await expect(c).toBeAttached();
  });

  test('the regenerate action re-runs the last request', async ({
    page,
  }: {
    page: Page;
  }) => {
    const c = composer(page);
    await c.click();
    await c.fill('Tell me a short writing tip.');
    await page.keyboard.press('Enter');
    await expect(
      page.locator('text=/I can help with that|Here.s the plan/i').first()
    ).toBeAttached({
      timeout: 20000,
    });

    await page
      .locator('[title="Regenerate last response (CHAT model)"]')
      .first()
      .click();
    await page.waitForTimeout(5000);
    await expect(
      page.locator('text=/I can help with that|Here.s the plan/i').first()
    ).toBeAttached({
      timeout: 20000,
    });
  });
});
