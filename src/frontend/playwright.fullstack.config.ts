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
 * Create a pristine project with two ADJACENT linked scenes, each containing
 * an annotation inside its prose.  Used by the boundary-drag bug hunt so the
 * coordinate conversion is exercised with annotation markers present inside
 * both scenes (the reported bug: dragging the first scene's end marker into
 * the second scene moves the second scene's UNCHANGED end marker).
 *
 *   Visible: "Alpha Bravo CharlieDelta Echo Foxtrot"
 *   scene 1: "Alpha Bravo Charlie"  (anno-a wraps "Alpha")
 *   scene 2: "Delta Echo Foxtrot"   (anno-b wraps "Delta")
 */
function createBoundaryAnnoProject(name: string): void {
  const root = path.join(TMP_DIR, 'projects', name);
  const chapters = path.join(root, 'chapters');
  fs.mkdirSync(chapters, { recursive: true });

  const annoA = 'anno-a';
  const annoB = 'anno-b';
  const chapterContent =
    marker(1, 'start') +
    annoMarker(annoA, 'start') +
    'Alpha' +
    annoMarker(annoA, 'end') +
    ' Bravo Charlie' +
    marker(1, 'end') +
    marker(2, 'start') +
    annoMarker(annoB, 'start') +
    'Delta' +
    annoMarker(annoB, 'end') +
    ' Echo Foxtrot' +
    marker(2, 'end');

  fs.writeFileSync(
    path.join(root, 'story.json'),
    JSON.stringify(
      {
        metadata: { version: 9 },
        project_title: 'Boundary + Annotation',
        format: 'markdown',
        project_type: 'novel',
        chapters: [{ id: 1, title: 'Chapter 1', summary: '', filename: '0001.txt' }],
        annotations: [
          {
            id: annoA,
            comment: 'anno in scene 1',
            scope_type: 'chapter',
            chapter_id: '1',
            book_id: null,
          },
          {
            id: annoB,
            comment: 'anno in scene 2',
            scope_type: 'chapter',
            chapter_id: '1',
            book_id: null,
          },
        ],
        scenes: {
          1: {
            id: 1,
            summary: 'Scene 1',
            beats: [],
            active_characters: [],
            passive_characters: [],
            causes: [],
            status: 'active',
            pinboard_x: 100,
            pinboard_y: 100,
            prose_link: {
              scope_type: 'chapter',
              chapter_id: '1',
              book_id: null,
              start_offset: 20,
              end_offset: 97,
            },
          },
          2: {
            id: 2,
            summary: 'Scene 2',
            beats: [],
            active_characters: [],
            passive_characters: [],
            causes: [],
            status: 'active',
            pinboard_x: 300,
            pinboard_y: 100,
            prose_link: {
              scope_type: 'chapter',
              chapter_id: '1',
              book_id: null,
              start_offset: 115,
              end_offset: 211,
            },
          },
        },
      },
      null,
      2
    )
  );

  fs.writeFileSync(path.join(chapters, '0001.txt'), chapterContent);
}

/**
 * Create a pristine project with two ADJACENT linked scenes where the
 * annotation inside scene 2 wraps scene 2's LAST word ("Foxtrot").  This is
 * the configuration that reproduces the reported bug: dragging scene 1's end
 * marker into scene 2 moves/reorders scene 2's UNCHANGED end marker.
 *
 *   Visible: "Alpha Bravo CharlieDelta Echo Foxtrot"
 *   scene 1: "Alpha Bravo Charlie"  (anno-a wraps "Alpha")
 *   scene 2: "Delta Echo Foxtrot"   (anno-b wraps "Foxtrot" — at scene 2's end)
 */
function createBoundaryAnnoEndProject(name: string): void {
  const root = path.join(TMP_DIR, 'projects', name);
  const chapters = path.join(root, 'chapters');
  fs.mkdirSync(chapters, { recursive: true });

  const annoA = 'anno-a';
  const annoB = 'anno-b';
  const chapterContent =
    marker(1, 'start') +
    annoMarker(annoA, 'start') +
    'Alpha' +
    annoMarker(annoA, 'end') +
    ' Bravo Charlie' +
    marker(1, 'end') +
    marker(2, 'start') +
    'Delta Echo ' +
    annoMarker(annoB, 'start') +
    'Foxtrot' +
    annoMarker(annoB, 'end') +
    marker(2, 'end');

  fs.writeFileSync(
    path.join(root, 'story.json'),
    JSON.stringify(
      {
        metadata: { version: 9 },
        project_title: 'Boundary + Annotation at end',
        format: 'markdown',
        project_type: 'novel',
        chapters: [{ id: 1, title: 'Chapter 1', summary: '', filename: '0001.txt' }],
        annotations: [
          {
            id: annoA,
            comment: 'anno in scene 1',
            scope_type: 'chapter',
            chapter_id: '1',
            book_id: null,
          },
          {
            id: annoB,
            comment: 'anno at scene 2 end',
            scope_type: 'chapter',
            chapter_id: '1',
            book_id: null,
          },
        ],
        scenes: {
          1: {
            id: 1,
            summary: 'Scene 1',
            beats: [],
            active_characters: [],
            passive_characters: [],
            causes: [],
            status: 'active',
            pinboard_x: 100,
            pinboard_y: 100,
            prose_link: {
              scope_type: 'chapter',
              chapter_id: '1',
              book_id: null,
              start_offset: 20,
              end_offset: 97,
            },
          },
          2: {
            id: 2,
            summary: 'Scene 2',
            beats: [],
            active_characters: [],
            passive_characters: [],
            causes: [],
            status: 'active',
            pinboard_x: 300,
            pinboard_y: 100,
            prose_link: {
              scope_type: 'chapter',
              chapter_id: '1',
              book_id: null,
              start_offset: 115,
              end_offset: 211,
            },
          },
        },
      },
      null,
      2
    )
  );

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

/**
 * Create a pristine novel project with three clearly distinct paragraphs and
 * NO scenes.  Used by the scene-link-regressions spec so it can create and
 * link scenes from scratch and assert that a second linked scene keeps its
 * full paragraph (instead of a truncated fragment).
 */
function createSceneLinkRegressionProject(name: string): void {
  const root = path.join(TMP_DIR, 'projects', name);
  const chapters = path.join(root, 'chapters');
  fs.mkdirSync(chapters, { recursive: true });

  fs.writeFileSync(
    path.join(root, 'story.json'),
    JSON.stringify(
      {
        metadata: { version: 9 },
        project_title: 'Scene Link Regressions',
        format: 'markdown',
        project_type: 'novel',
        chapters: [{ id: 1, title: 'Chapter 1', summary: '', filename: '0001.txt' }],
        scenes: {},
      },
      null,
      2
    )
  );

  // Three distinct single-line paragraphs so a truncated link is unambiguous.
  fs.writeFileSync(
    path.join(chapters, '0001.txt'),
    'One apple falls from the tree in the orchard.\n' +
      'Two birds fly over the hill toward the lake.\n' +
      'Three fish swim in the clear blue water of the pond.\n'
  );
}

// Scene marker token lengths (used to seed prose_link offsets).
const SCENE_START_LEN = '<!--scene:1:start-->'.length; // 20
const SCENE_END_LEN = '<!--scene:1:end-->'.length; // 18

/**
 * Create a pristine project with two linked scenes and one pre-existing
 * annotation used by the scene/annotation integrity spec:
 *
 *   Visible text: "Alpha Bravo CharlieDelta Echo Foxtrot"
 *     scene 1 -> "Alpha Bravo Charlie"  (visible [0, 18))
 *     scene 2 -> "Delta Echo Foxtrot"   (visible [18, 36))
 *     anno-1  -> "Alpha"                (visible [0, 5))
 *
 * Markers are embedded in the chapter file; prose_link offsets are stored in
 * story.json in RAW (marker-inclusive) space:
 *   scene1: start_offset = SCENE_START_LEN (20), end_offset = 97
 *   scene2: start_offset = 115, end_offset = 133
 */
function createIntegrityProject(name: string): void {
  const root = path.join(TMP_DIR, 'projects', name);
  const chapters = path.join(root, 'chapters');
  fs.mkdirSync(chapters, { recursive: true });

  const annoStart = '<!--annotation:anno-1:start-->'; // 30
  const annoEnd = '<!--annotation:anno-1:end-->'; // 28

  const chapterContent =
    marker(1, 'start') +
    annoStart +
    'Alpha' +
    annoEnd +
    ' Bravo Charlie' +
    marker(1, 'end') +
    marker(2, 'start') +
    'Delta Echo Foxtrot' +
    marker(2, 'end');

  const scene1Start = SCENE_START_LEN;
  const scene1End = scene1Start + annoStart.length + 5 + annoEnd.length + 14; // 97
  const scene2Start = scene1End + SCENE_END_LEN; // 115
  const scene2End = scene2Start + 18; // 133

  fs.writeFileSync(
    path.join(root, 'story.json'),
    JSON.stringify(
      {
        metadata: { version: 9 },
        project_title: 'Scene/Annotation Integrity',
        format: 'markdown',
        project_type: 'novel',
        chapters: [{ id: 1, title: 'Chapter 1', summary: '', filename: '0001.txt' }],
        annotations: [
          {
            id: 'anno-1',
            comment: 'Annotation on "Alpha"',
            scope_type: 'chapter',
            chapter_id: '1',
            book_id: null,
          },
        ],
        scenes: {
          1: {
            id: 1,
            summary: 'Scene 1',
            beats: [],
            active_characters: [],
            passive_characters: [],
            causes: [],
            status: 'active',
            pinboard_x: 100,
            pinboard_y: 100,
            prose_link: {
              scope_type: 'chapter',
              chapter_id: '1',
              book_id: null,
              start_offset: scene1Start,
              end_offset: scene1End,
            },
          },
          2: {
            id: 2,
            summary: 'Scene 2',
            beats: [],
            active_characters: [],
            passive_characters: [],
            causes: [],
            status: 'active',
            pinboard_x: 300,
            pinboard_y: 100,
            prose_link: {
              scope_type: 'chapter',
              chapter_id: '1',
              book_id: null,
              start_offset: scene2Start,
              end_offset: scene2End,
            },
          },
        },
      },
      null,
      2
    )
  );

  fs.writeFileSync(path.join(chapters, '0001.txt'), chapterContent);
}

// Project used by scene-boundary-drag (mutates scene structure).
createTestProject('e2e-boundary-test');
// Dedicated project used by the scene/annotation integrity spec (mutates
// scenes, annotations, prose, markers).
createIntegrityProject('e2e-integrity-test');
// Dedicated project used by the boundary-drag bug hunt: two adjacent linked
// scenes, each containing an annotation (mutates scene boundaries).
createBoundaryAnnoProject('e2e-boundary-anno-test');
// Dedicated project reproducing the reported boundary-drag reorder bug: the
// annotation inside scene 2 wraps scene 2's LAST word (mutates boundaries).
createBoundaryAnnoEndProject('e2e-boundary-anno-end-test');
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
// Dedicated projects used by the scene-link-regressions spec.  Each test
// mutates scene/prose state (linking prose, undo), so each gets its own
// project to keep the assertions independent.
createSceneLinkRegressionProject('e2e-scene-link-regression');
createSceneLinkRegressionProject('e2e-scene-link-regression-b2');
createSceneLinkRegressionProject('e2e-scene-undo-persist');

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
