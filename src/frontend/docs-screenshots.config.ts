// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the docs-screenshots playwright.config unit.
 *
 * This config is responsible for booting a fully isolated AugmentedQuill
 * (backend + frontend) against a temporary data directory and seeding rich
 * demo projects so the documentation screenshots always capture meaningful,
 * reproducible UI states.  It intentionally never touches real user data
 * under `data/` (see AGENTS.md "Test Data Safety").
 *
 * Run with:
 *   npx playwright test --config=docs-screenshots.config.ts
 */

import { defineConfig } from '@playwright/test';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const BACKEND_PORT = 28010;
const FRONTEND_PORT = 28011;
const MOCK_LLM_PORT = 28012;

// Scratch data dir, created at config-evaluation time so the webServer
// commands and the capture spec can reference it.  Removed on teardown.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-docs-shots-'));
const configDir = path.join(TMP_DIR, 'config');
fs.mkdirSync(configDir, { recursive: true });

// ---------------------------------------------------------------------------
// Minimal, valid machine/projects config so the backend boots cleanly.
// ---------------------------------------------------------------------------

fs.writeFileSync(
  path.join(configDir, 'machine.json'),
  JSON.stringify({
    openai: {
      models: [
        {
          name: 'Demo Provider',
          // Local mock LLM server so the app treats the model as working
          // (connection probe + streaming succeed against it).
          base_url: `http://127.0.0.1:${MOCK_LLM_PORT}/v1`,
          api_key: 'sk-demo-screenshot',
          timeout_s: 120,
          model: 'demo-model',
          context_window_tokens: 8192,
          temperature: 0.7,
          max_tokens: 2048,
          supports_function_calling: true,
          // Pretend the model can generate images so the Project Images
          // dialog's generate/create-prompt actions are enabled.
          is_multimodal: true,
        },
      ],
      selected: 'Demo Provider',
      selected_chat: 'Demo Provider',
      selected_writing: 'Demo Provider',
      selected_editing: 'Demo Provider',
    },
    gui_language: 'en',
  })
);
fs.writeFileSync(
  path.join(configDir, 'projects.json'),
  JSON.stringify({ projects: [] })
);

// ---------------------------------------------------------------------------
// Tiny generated placeholder images (solid color + label) so sourcebook
// entries and the Project Images dialog have thumbnails to render.
// ---------------------------------------------------------------------------

/** 1x1-ish PNG pixel data for a flat color. Encoded as base64 PNGs. */
const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Write a small valid PNG into a project's images dir.
 * Used as a fallback when the real mockup art is not available.
 */
function writePlaceholderImage(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(PNG_1x1_BASE64, 'base64'));
}

// Real artwork used by the Project Images screenshots, taken from the docs
// assets so the dialog shows meaningful cover/portrait images.
const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const MOCKUP_DIR = path.resolve(CONFIG_DIR, '../../docs/user_manual/assets/mockup');

/** Copy a mockup image into a project images dir, falling back to a placeholder. */
function writeDemoImage(imagesDir: string, name: string): void {
  fs.mkdirSync(imagesDir, { recursive: true });
  const src = path.join(MOCKUP_DIR, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(imagesDir, name));
  } else {
    writePlaceholderImage(path.join(imagesDir, name));
  }
}

// ---------------------------------------------------------------------------
// Demo project seeding.
// The "Screenshots Demo" novel exercises the writing/metadata/sourcebook/
// search screenshots.  The "Screenshots Series" project exercises the
// book/books UI.  Content is deliberately generic and neutral.
// ---------------------------------------------------------------------------

const DEMO_PROJECT_NAME = 'Screenshots Demo';
const SERIES_PROJECT_NAME = 'Screenshots Series';

/**
 * Create a rich novel project on disk (the proven fullstack pattern: write
 * story.json + chapter files before the backend scans the projects folder).
 */
function createDemoNovelProject(root: string): void {
  const chaptersDir = path.join(root, 'chapters');
  const imagesDir = path.join(root, 'images');
  fs.mkdirSync(chaptersDir, { recursive: true });

  writeDemoImage(imagesDir, 'cover.png');
  writeDemoImage(imagesDir, 'portrait.png');

  // Image metadata: give the placeholder images titles + descriptions so the
  // Project Images cards look complete and the "Create prompt" action (which
  // requires a description) is enabled.
  fs.writeFileSync(
    path.join(imagesDir, 'metadata.json'),
    JSON.stringify(
      {
        version: 1,
        items: {
          'cover.png': {
            title: 'Cover concept',
            description:
              'A stylized map of the Unwritten Valley, drawn in faded ink with a compass rose missing from the center.',
          },
          'portrait.png': {
            title: 'Nora portrait',
            description:
              'A warm pencil sketch of a young cartographer studying a folded map by lamplight.',
          },
        },
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(root, 'story.json'),
    JSON.stringify(
      {
        metadata: { version: 9 },
        project_title: DEMO_PROJECT_NAME,
        project_type: 'novel',
        language: 'en',
        format: 'markdown',
        tags: ['Fantasy', 'Adventure', 'Coming of Age'],
        story_summary:
          'A young cartographer discovers a hidden valley on the old maps and sets out to find it before the surveyors erase it from the records.',
        notes:
          'Keep the tone warm and slightly wry. The valley is not magical — it is simply forgotten.',
        private_notes:
          'Twist to reveal in the final chapter: the map was drawn by the protagonist’s own missing father.',
        chapters: [
          {
            id: 1,
            title: 'The Faded Map',
            summary:
              'Nora finds an old map folded inside a library book, marked with a valley that no longer appears on any modern chart.',
            filename: '0001.txt',
            notes: 'Establish the library and the archivist’s warning.',
            private_notes: 'Seed the father’s initials in the map corner.',
            conflicts: [
              {
                description:
                  'The archivist knows the valley exists but is sworn not to speak of it.',
                resolution: 'Revealed when Nora returns with proof in the final act.',
              },
              {
                description: 'Nora’s brother wants to sell the map to the surveyors.',
                resolution: 'Resolved when he sees what the valley means to her.',
              },
            ],
          },
          {
            id: 2,
            title: 'The Empty Road',
            summary:
              'Nora and her brother Elias follow the old road until it simply stops at a hedge that is not on any map.',
            filename: '0002.txt',
          },
          {
            id: 3,
            title: 'The Unwritten Valley',
            summary:
              'Beyond the hedge, Nora finds a valley of tidy farms whose people have never heard of the wider world — and an innkeeper who recognizes the map.',
            filename: '0003.txt',
          },
        ],
        scenes: {
          1: {
            id: 1,
            summary: 'Nora finds the map in the library',
            beats: [],
            active_characters: ['Nora'],
            passive_characters: ['Archivist'],
            causes: [],
            status: 'active',
            pinboard_x: 100,
            pinboard_y: 100,
          },
          2: {
            id: 2,
            summary: 'The archivist warns her away',
            beats: [],
            active_characters: ['Nora', 'Archivist'],
            passive_characters: [],
            causes: [],
            status: 'active',
            pinboard_x: 320,
            pinboard_y: 100,
          },
        },
        sourcebook: {
          Nora: {
            description:
              'A meticulous young cartographer with a stubborn streak. She trusts paper over people and has never been farther than the county line.',
            category: 'Character',
            synonyms: ['Nora Hale'],
            images: ['portrait.png'],
            keywords: ['cartographer', 'stubborn', 'nora'],
            relations: [],
            creates_new_timeline: false,
            timeline_id: 'main',
          },
          Elias: {
            description:
              "Nora's older brother, pragmatic and a little envious. He sees the map as money; Nora sees it as a doorway.",
            category: 'Character',
            synonyms: ['Elias Hale'],
            images: [],
            keywords: ['brother', 'pragmatic', 'elias'],
            relations: [],
            creates_new_timeline: false,
            timeline_id: 'main',
          },
          'The Unwritten Valley': {
            description:
              'A self-sufficient valley of farms and workshops that exists off every survey. Its people assume the outside world is a rumor.',
            category: 'Location',
            synonyms: ['The Hidden Valley'],
            images: [],
            keywords: ['valley', 'hidden', 'farms'],
            relations: [],
            creates_new_timeline: false,
            timeline_id: 'main',
          },
          'The Surveyors': {
            description:
              'The cartographic office that plans to redraw the county maps. They are efficient, well-funded, and not interested in questions.',
            category: 'Lore',
            synonyms: ['Cartographic Office'],
            images: [],
            keywords: ['surveyors', 'maps', 'office'],
            relations: [],
            creates_new_timeline: false,
            timeline_id: 'main',
          },
        },
      },
      null,
      2
    )
  );

  // Chapter prose: distinct, single-paragraph text per chapter.
  const chapterText = [
    'The library smelled of dust and old glue. Nora had come for a quiet corner to finish her field notes, but the book on the reading table was already open, and inside it, folded so thin it was almost a shadow, lay a map of a valley that no survey had ever recorded.\n',
    'The road narrowed as it climbed, then stopped. Not faded — stopped. A dense hedge ran across the way where the map promised the route would continue, and beyond it the hills were green and ordinary and entirely unmarked.\n',
    'The hedge parted at a gate that had no hinges. On the far side, the valley opened like a page being turned: farms in tidy rows, a village with a blue roof on the inn, and a woman at the well who looked up and knew the map the moment she saw it.\n',
  ];
  chapterText.forEach((text: string, index: number) => {
    const filename = `000${index + 1}.txt`;
    fs.writeFileSync(path.join(chaptersDir, filename), text);
  });

  // Seed a few chat sessions so the Chat History panel and the chat
  // screenshots have realistic-looking conversation state.
  const chatsDir = path.join(root, 'chats');
  fs.mkdirSync(chatsDir, { recursive: true });
  const seedChats = [
    {
      filename: 'chat-2026-06-01T10-00-00-000Z.json',
      name: 'Plan the opening chapters',
      messages: [
        {
          id: 'seed-msg-1',
          role: 'user',
          text: 'Help me plan the opening chapters. Nora should find the map early and be driven to investigate alone.',
        },
        {
          id: 'seed-msg-2',
          role: 'model',
          text: 'Here is a plan for the first three chapters: open with the library discovery, have Elias push to sell the map, then let Nora cross the hedge on her own. Want me to update the chapter summaries to match?',
          thinking: '',
          tool_calls: [],
        },
      ],
    },
    {
      filename: 'chat-2026-06-02T15-30-00-000Z.json',
      name: 'Worldbuilding for the valley',
      messages: [
        {
          id: 'seed-msg-3',
          role: 'user',
          text: 'Draft the lore for The Unwritten Valley: its people, the inn, and why the surveys always miss it.',
        },
        {
          id: 'seed-msg-4',
          role: 'model',
          text: 'The valley keeps no maps of its own because it never needed them — every road leads home. I have added a Sourcebook entry with these details.',
          thinking: '',
          tool_calls: [],
        },
      ],
    },
    {
      filename: 'chat-2026-06-03T09-15-00-000Z.json',
      name: 'Edit Chapter One',
      messages: [
        {
          id: 'seed-msg-5',
          role: 'user',
          text: 'Can you tighten the first paragraph of Chapter One and make the discovery feel more dangerous?',
        },
        {
          id: 'seed-msg-6',
          role: 'model',
          text: 'Revised opening: the library is closing, the book is overdue, and the map is folded into a page that someone tried to tear out. I updated the chapter prose.',
          thinking: '',
          tool_calls: [],
        },
      ],
    },
  ];
  seedChats.forEach(
    (chat: {
      filename: string;
      name: string;
      messages: Array<{
        id: string;
        role: string;
        text: string;
        thinking?: string;
        tool_calls?: unknown[];
      }>;
    }) => {
      // Derive a valid ISO timestamp from the filename so the history panel
      // shows real dates and the backend sort works (it crashes on null).
      const stem = chat.filename.replace(/^chat-/, '').replace(/\.json$/, '');
      const iso = `${stem.slice(0, 10)}T${stem.slice(11, 13)}:${stem.slice(14, 16)}:${stem.slice(17, 19)}.000Z`;
      fs.writeFileSync(
        path.join(chatsDir, chat.filename),
        JSON.stringify(
          {
            id: `chat-${stem}`,
            name: chat.name,
            messages: chat.messages,
            systemPrompt: '',
            allowWebSearch: false,
            scratchpad: '',
            projectContextRevision: null,
            created_at: iso,
            updated_at: iso,
          },
          null,
          2
        )
      );
    }
  );
}

/**
 * Create a series project with two books (each with its own chapter files),
 * so the books UI has multiple expanded volumes to capture.
 */
function createDemoSeriesProject(root: string): void {
  const book1Dir = path.join(root, 'books', 'book-1', 'chapters');
  const book2Dir = path.join(root, 'books', 'book-2', 'chapters');
  fs.mkdirSync(book1Dir, { recursive: true });
  fs.mkdirSync(book2Dir, { recursive: true });

  fs.writeFileSync(
    path.join(root, 'story.json'),
    JSON.stringify(
      {
        metadata: { version: 9 },
        project_title: SERIES_PROJECT_NAME,
        project_type: 'series',
        language: 'en',
        format: 'markdown',
        story_summary:
          'A three-volume tale of a lighthouse keeper’s daughter and the signal fire that outlives the maps.',
        tags: ['Historical', 'Family Saga'],
        books: [
          {
            id: 'book-1',
            folder: 'book-1',
            title: 'The Signal',
            chapters: [
              {
                id: 1,
                title: 'First Watch',
                summary: 'Maren takes her first night watch alone.',
                filename: '0001.txt',
              },
              {
                id: 2,
                title: 'The Wreck',
                summary: 'A storm brings an unfamiliar ship to the rocks.',
                filename: '0002.txt',
              },
            ],
          },
          {
            id: 'book-2',
            folder: 'book-2',
            title: 'The Shore',
            chapters: [
              {
                id: 1,
                title: 'The Visitor',
                summary: 'The stranger asks for the keeper by name.',
                filename: '0001.txt',
              },
            ],
          },
        ],
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(book1Dir, '0001.txt'),
    'Maren climbed the spiral stairs with the lamp trimmed low, the sea muttering below her like a held breath.\n'
  );
  fs.writeFileSync(
    path.join(book1Dir, '0002.txt'),
    'The storm came in at midnight, and with it a ship that carried no flags and answered no hails.\n'
  );
  fs.writeFileSync(
    path.join(book2Dir, '0001.txt'),
    'The stranger arrived at dawn, soaked to the bone, and asked for the keeper by a name Maren had never heard.\n'
  );
}

const demoProjectRoot = path.join(TMP_DIR, 'projects', DEMO_PROJECT_NAME);
const seriesProjectRoot = path.join(TMP_DIR, 'projects', SERIES_PROJECT_NAME);
createDemoNovelProject(demoProjectRoot);
createDemoSeriesProject(seriesProjectRoot);

// Persist the temp dir + demo project names at a fixed location so the
// capture spec and the teardown can locate them without recomputing the
// config evaluation (the temp dir itself is a random mkdtemp path).
const metaPath = path.join(os.tmpdir(), 'aq-docs-shots-meta.json');
fs.writeFileSync(
  metaPath,
  JSON.stringify({
    tmpDir: TMP_DIR,
    demoProject: DEMO_PROJECT_NAME,
    seriesProject: SERIES_PROJECT_NAME,
  })
);

export default defineConfig({
  testDir: './tests/docs-screenshots',
  timeout: 120000,
  retries: 0,
  // A single worker keeps the shared backend (single active-project registry
  // and shared screenshot output dir) deterministic.
  workers: 1,
  outputDir: path.join(TMP_DIR, 'test-artifacts'),
  globalSetup: './tests/docs-screenshots/global-setup.ts',
  globalTeardown: './tests/docs-screenshots/global-teardown.ts',
  webServer: [
    {
      command: `MOCK_LLM_PORT=${MOCK_LLM_PORT} node tests/docs-screenshots/mock-llm-server.mjs`,
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
