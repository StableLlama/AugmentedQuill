import { test, type Page } from '@playwright/test';
import { DEMO_PROJECT, gotoApp, openSettings } from './support/helpers';

test('debug language save close', async ({ page }: { page: Page }) => {
  await gotoApp(page, DEMO_PROJECT);
  await openSettings(page);
  await page.locator('#settings-dialog button:has-text("General")').first().click();
  await page.waitForTimeout(500);
  await page.locator('#settings-dialog select').first().selectOption('de');
  await page.waitForTimeout(300);
  await page
    .locator('#settings-dialog button:has-text("Save & Close")')
    .first()
    .click();
  await page.waitForTimeout(1200);
  console.log(
    'header after save-close (menu btn text):',
    await page.locator('header button:has-text("Menu")').count()
  );
  await openSettings(page);
  await page.waitForTimeout(800);
  const tabs = page.locator('#settings-dialog button');
  const texts: string[] = [];
  for (let i = 0; i < (await tabs.count()); i++)
    texts.push((await tabs.nth(i).innerText()).trim().slice(0, 25));
  console.log('tabs after save-close:', texts.join(' | '));
  // revert
  await page
    .locator(
      '#settings-dialog button:has-text("Allgemein"), #settings-dialog button:has-text("General")'
    )
    .first()
    .click();
  await page.waitForTimeout(400);
  await page.locator('#settings-dialog select').first().selectOption('en');
  await page.waitForTimeout(300);
  await page
    .locator(
      '#settings-dialog button:has-text("Speichern & Schließen"), #settings-dialog button:has-text("Save & Close")'
    )
    .first()
    .click();
  await page.waitForTimeout(800);
});
