// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the playwright.fullstack.config unit so this responsibility stays isolated, testable, and easy to evolve.
 */

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

// Create the E2E test projects before the backend starts.
//
// Each spec file is given its own project so concurrent tests never corrupt
// each other's data.  `scene-boundary-drag` mutates scene structure (it even
// unlinks scenes), which would break `scene-cursor-highlight` if they shared
// a project; `annotation-ux` mutates annotations.
function marker(id: number, edge: 'start' | 'end'): string {
  return `<!--scene:${id}:${edge}-->`;
}

// Pre-existing annotation IDs for E2E tests.
const ANNO_1 = 'e2e-anno-1';
const ANNO_2 = 'e2e-anno-2';
const ANNO_3 = 'e2e-anno-3';

function annoMarker(id: string, edge: 'start' | 'end'): string {
  return `<!--annotation:${id}:${edge}-->`;
}

/**
 * Create a pristine test project directory with the scene/annotation markers
 * and story.json shared by the fullstack specs.
 */
function createTestProject(name: string): void {
  const root = path.join(TMP_DIR, 'projects', name);
  const chapters = path.join(root, 'chapters');
  fs.mkdirSync(chapters, { recursive: true });

  fs.writeFileSync(
    path.join(root, 'story.json'),
    JSON.stringify(
      {
        metadata: { version: 9 },
        project_title: 'E2E Boundary Test',
        format: 'markdown',
        project_type: 'novel',
        chapters: [{ id: 1, title: 'Chapter 1', summary: '', filename: '0001.txt' }],
        annotations: [
          {
            id: ANNO_1,
            comment: 'Annotation on "Scene" at start of scene 13',
            scope_type: 'chapter',
            chapter_id: '1',
            book_id: null,
          },
          {
            id: ANNO_2,
            comment: 'Annotation on "teen" at end of scene 13',
            scope_type: 'chapter',
            chapter_id: '1',
            book_id: null,
          },
          {
            id: ANNO_3,
            comment: 'Annotation on "Sixteen_" inside scene 16',
            scope_type: 'chapter',
            chapter_id: '1',
            book_id: null,
          },
        ],
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

  // Chapter content: original visible text is preserved as
  // "SceneThirteenSceneFourteenSceneSixteen_" (39 chars).
  // Annotation markers are embedded within the existing prose:
  //   e2e-anno-1 wraps "Scene"   (first 5 chars of scene 13, offsets 0-4)
  //   e2e-anno-2 wraps "teen"    (last 4 chars of scene 13, offsets 9-12)
  //   e2e-anno-3 wraps "Sixteen_" (all of scene 16 text, offsets 26-38)
  const chapterContent =
    marker(13, 'start') +
    annoMarker(ANNO_1, 'start') +
    'Scene' +
    annoMarker(ANNO_1, 'end') +
    'Thir' +
    annoMarker(ANNO_2, 'start') +
    'teen' +
    annoMarker(ANNO_2, 'end') +
    marker(13, 'end') +
    marker(14, 'start') +
    'SceneFourteen' +
    marker(14, 'end') +
    marker(16, 'start') +
    'Scene' +
    annoMarker(ANNO_3, 'start') +
    'Sixteen_' +
    annoMarker(ANNO_3, 'end') +
    marker(16, 'end');
  fs.writeFileSync(path.join(chapters, '0001.txt'), chapterContent);
}

/**
 * Create a project with a single chapter of plain, space-separated prose and
 * NO scenes.  Used by the scene-linked-prose-undo spec so it can create and
 * link scenes from scratch and assert clean word boundaries.
 */
function createPlainProseProject(name: string): void {
  const root = path.join(TMP_DIR, 'projects', name);
  const chapters = path.join(root, 'chapters');
  fs.mkdirSync(chapters, { recursive: true });

  fs.writeFileSync(
    path.join(root, 'story.json'),
    JSON.stringify(
      {
        metadata: { version: 9 },
        project_title: 'Scene Link E2E',
        format: 'markdown',
        project_type: 'novel',
        chapters: [{ id: 1, title: 'Chapter 1', summary: '', filename: '0001.txt' }],
        scenes: {},
      },
      null,
      2
    )
  );

  // Space-separated words so a mid-word prose insertion is easy to detect.
  fs.writeFileSync(
    path.join(chapters, '0001.txt'),
    'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India.\n'
  );
}

/**
 * Create a project with one chapter that already has a linked scene (scene 1
 * spans the word "Bravo").  Used by the BUG-2 E2E test so it can edit a linked
 * scene's prose and verify that Undo persists the revert to the backend.
 */
function createLinkedSceneProject(name: string): void {
  const root = path.join(TMP_DIR, 'projects', name);
  const chapters = path.join(root, 'chapters');
  fs.mkdirSync(chapters, { recursive: true });

  fs.writeFileSync(
    path.join(root, 'story.json'),
    JSON.stringify(
      {
        metadata: { version: 9 },
        project_title: 'Scene Link E2E',
        format: 'markdown',
        project_type: 'novel',
        chapters: [{ id: 1, title: 'Chapter 1', summary: '', filename: '0001.txt' }],
        scenes: {
          1: {
            id: 1,
            summary: 'Linked scene',
            beats: [],
            active_characters: [],
            passive_characters: [],
            causes: [],
            status: 'active',
            pinboard_x: 100,
            pinboard_y: 100,
          },
        },
      },
      null,
      2
    )
  );

  // Scene 1 is linked to the word "Bravo".
  fs.writeFileSync(
    path.join(chapters, '0001.txt'),
    'Alpha <!--scene:1:start-->Bravo<!--scene:1:end--> Charlie Delta Echo Foxtrot Golf Hotel India.\n'
  );
}

// Project used by scene-boundary-drag (mutates scene structure).
createTestProject('e2e-boundary-test');
// Dedicated pristine project used by scene-cursor-highlight so drag/annotation
// mutations can never corrupt the scene ranges it asserts.
createTestProject('e2e-cursor-test');
// Dedicated project used by annotation-ux (mutates annotations).
createTestProject('e2e-annotation-test');
// Dedicated projects used by the scene-linked-prose-undo spec.  Each test
// mutates scene/prose state (linking prose, deleting scenes, undo), so each
// gets its own project to keep the assertions independent.
createPlainProseProject('e2e-scene-link-test');
createLinkedSceneProject('e2e-scene-undo-link-test');
createPlainProseProject('e2e-scene-delete-undo-test');

// Write temp dir path so tests can find the projects directory
fs.writeFileSync(path.join(os.tmpdir(), 'aq-e2e-tmpdir'), TMP_DIR);

export default defineConfig({
  testDir: './tests/e2e/fullstack',
  timeout: 60000,
  retries: 0,
  // The fullstack specs share one backend (single active-project registry and
  // project files).  Some specs mutate project data (scene boundary drags,
  // annotations), so running files concurrently corrupts the state that other
  // specs read.  Serialize to keep the shared backend state deterministic.
  workers: 1,
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
