// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the playwright.config unit so this responsibility stays isolated, testable, and easy to evolve.
 *
 * This config drives the lightweight "fixture" E2E suite: scene-marker cursor
 * navigation against a minimal Vite-served CodeMirror fixture (port 5199).
 * The heavier suites are isolated in their own configs and excluded here so
 * they never run against the wrong webServer:
 *   - fullstack suite   -> playwright.fullstack.config.ts
 *   - docs/user_manual  -> playwright.docs.config.ts
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/fullstack/**', '**/docs/**'],
  timeout: 30000,
  retries: 1,
  outputDir: './tests/e2e/.test-artifacts',
  webServer: {
    command: 'npm run test:e2e:fixture',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10000,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
