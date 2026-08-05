// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the playwright.docs playwright.config unit.
 *
 * This config runs the high-level, black-box E2E suite that verifies every
 * feature described in `docs/user_manual/`.  It boots a fully isolated
 * AugmentedQuill (mock LLM + backend + frontend) against a temporary data
 * directory and seeds rich demo projects (novel, series, time travel).
 *
 * The mock LLM runs with MOCK_LLM_TOOLS=1 so chat-driven tool actions
 * (create project/chapter/book/sourcebook entry/scene, update story summary,
 * search/replace) execute against the real backend tool pipeline.
 *
 * Run with:
 *   npx playwright test --config=playwright.docs.config.ts
 */

import { defineConfig } from '@playwright/test';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  writeMachineConfig,
  writeProjectsRegistry,
  seedDemoProjects,
} from './tests/e2e/support/seed-projects';

const BACKEND_PORT = 28020;
const FRONTEND_PORT = 28021;
const MOCK_LLM_PORT = 28022;

// Scratch data dir, created at config-evaluation time so the webServer
// commands and the specs can reference it.  Removed on teardown.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-docs-e2e-'));
const configDir = path.join(TMP_DIR, 'config');
fs.mkdirSync(configDir, { recursive: true });

writeMachineConfig(configDir, MOCK_LLM_PORT);
writeProjectsRegistry(configDir);

const metaPath = path.join(os.tmpdir(), 'aq-docs-e2e-meta.json');
seedDemoProjects(TMP_DIR, configDir, metaPath);

export default defineConfig({
  testDir: './tests/e2e/docs',
  timeout: 90000,
  retries: 1,
  // A single worker keeps the shared backend (single active-project registry
  // and shared project files) deterministic across the feature specs.
  workers: 1,
  outputDir: path.join(TMP_DIR, 'test-artifacts'),
  globalSetup: './tests/e2e/docs/global-setup.ts',
  globalTeardown: './tests/e2e/docs/global-teardown.ts',
  webServer: [
    {
      command: `MOCK_LLM_TOOLS=1 MOCK_LLM_PORT=${MOCK_LLM_PORT} node tests/docs-screenshots/mock-llm-server.mjs`,
      url: `http://127.0.0.1:${MOCK_LLM_PORT}/v1/models`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `cd ../.. && AUGQ_USER_DATA_DIR=${TMP_DIR} venv/bin/python -m augmentedquill.main --host 127.0.0.1 --port ${BACKEND_PORT}`,
      url: `http://127.0.0.1:${BACKEND_PORT}/api/v1/projects`,
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: `VITE_BACKEND_PORT=${BACKEND_PORT} npx vite --port ${FRONTEND_PORT} --strictPort`,
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
  use: {
    headless: true,
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 20000,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
