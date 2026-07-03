import { defineConfig } from '@playwright/test';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const BACKEND_PORT = 18000;
const FRONTEND_PORT = 18001;

// Create temp directory at config evaluation time so the webServer
// commands can reference it.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-e2e-'));
const configDir = path.join(TMP_DIR, 'config');
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(
  path.join(configDir, 'machine.json'),
  JSON.stringify({
    models: {},
    default_chat_model: '',
    default_rewrite_model: '',
    default_extend_model: '',
  })
);
fs.writeFileSync(
  path.join(configDir, 'projects.json'),
  JSON.stringify({ projects: [] })
);

// Create the E2E test project before the backend starts
const projectDir = path.join(TMP_DIR, 'projects', 'e2e-boundary-test');
const chaptersDir = path.join(projectDir, 'chapters');
fs.mkdirSync(chaptersDir, { recursive: true });

function marker(id: number, edge: 'start' | 'end'): string {
  return `<!--scene:${id}:${edge}-->`;
}

fs.writeFileSync(
  path.join(projectDir, 'story.json'),
  JSON.stringify(
    {
      metadata: { version: 9 },
      project_title: 'E2E Boundary Test',
      format: 'markdown',
      project_type: 'novel',
      chapters: [{ id: 1, title: 'Chapter 1', summary: '', filename: '0001.txt' }],
      scenes: {
        13: {
          id: 13,
          summary: 'Scene 13',
          beats: [],
          active_characters: [],
          passive_characters: [],
          causes: [],
          status: 'active',
          pinboard_x: 100,
          pinboard_y: 100,
        },
        14: {
          id: 14,
          summary: 'Scene 14',
          beats: [],
          active_characters: [],
          passive_characters: [],
          causes: [],
          status: 'active',
          pinboard_x: 300,
          pinboard_y: 100,
        },
        16: {
          id: 16,
          summary: 'Scene 16',
          beats: [],
          active_characters: [],
          passive_characters: [],
          causes: [],
          status: 'active',
          pinboard_x: 500,
          pinboard_y: 100,
        },
      },
    },
    null,
    2
  )
);

const chapterContent =
  marker(13, 'start') +
  'SceneThirteen' +
  marker(13, 'end') +
  marker(14, 'start') +
  'SceneFourteen' +
  marker(14, 'end') +
  marker(16, 'start') +
  'SceneSixteen_' +
  marker(16, 'end');
fs.writeFileSync(path.join(chaptersDir, '0001.txt'), chapterContent);

// Write temp dir path so tests can find the projects directory
fs.writeFileSync(path.join(os.tmpdir(), 'aq-e2e-tmpdir'), TMP_DIR);

export default defineConfig({
  testDir: './tests/e2e/fullstack',
  timeout: 60000,
  retries: 0,
  outputDir: './tests/e2e/.test-artifacts',
  globalSetup: './tests/e2e/fullstack/global-setup.ts',
  globalTeardown: './tests/e2e/fullstack/global-teardown.ts',
  webServer: [
    {
      command: `cd ../.. && AUGQ_USER_DATA_DIR=${TMP_DIR} venv/bin/python -m augmentedquill.main --host 127.0.0.1 --port ${BACKEND_PORT}`,
      url: `http://127.0.0.1:${BACKEND_PORT}/api/v1/projects`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `VITE_BACKEND_PORT=${BACKEND_PORT} npx vite --port ${FRONTEND_PORT} --strictPort`,
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
  use: {
    headless: true,
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 15000,
    screenshot: 'on',
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
