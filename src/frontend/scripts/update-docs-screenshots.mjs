// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Replaces `[SCREENSHOT: ...]` placeholder markers in the user-manual docs with
 * real image links, using the manifest written by the docs-screenshots capture
 * run (docs/user_manual/screenshots/.screenshot-manifest.json).
 *
 * Two marker shapes are handled:
 *   1. `[SCREENSHOT: <description>]` (backtick-wrapped)  ->  ![<description>](screenshots/<file>.png)
 *   2. ![SCREENSHOT: <description>](screenshots/...)      ->  alt text normalized (prefix stripped)
 *
 * The script is idempotent: markers that already became image links are left
 * untouched.
 *
 * Run with:
 *   node scripts/update-docs-screenshots.mjs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// src/frontend/scripts -> repo root is three levels up.
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs', 'user_manual');
const SHOTS_DIR = path.join(DOCS_DIR, 'screenshots');
const MANIFEST_PATH = path.join(SHOTS_DIR, '.screenshot-manifest.json');

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(
      `No screenshot manifest found at ${MANIFEST_PATH}. Run the capture suite first:\n` +
        '  npx playwright test --config=docs-screenshots.config.ts'
    );
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  if (!Array.isArray(raw)) {
    console.error('Screenshot manifest is not an array; nothing to do.');
    process.exit(1);
  }
  return raw.filter(
    (entry) => typeof entry.marker === 'string' && typeof entry.file === 'string'
  );
}

/**
 * Replace backtick-wrapped markers and normalize "SCREENSHOT:" alt prefixes in
 * one markdown document. Returns { content, replacements }.
 */
function updateDocument(content, manifest) {
  let updated = content;
  let replacements = 0;

  // 1) `[SCREENSHOT: <marker>]` -> ![<marker>](screenshots/<file>)
  for (const { marker, file } of manifest) {
    const backticked = `\`[SCREENSHOT: ${marker}]\``;
    if (!updated.includes(backticked)) continue;
    const occurrences = updated.split(backticked).length - 1;
    const imageLink = `![${marker}](screenshots/${file})`;
    updated = updated.split(backticked).join(imageLink);
    replacements += occurrences;
  }

  // 2) ![SCREENSHOT: X](...) -> ![X](...)  (strip the literal prefix in alts)
  const altPrefix = /!\[SCREENSHOT:\s*/g;
  if (altPrefix.test(updated)) {
    updated = updated.replace(altPrefix, '![');
    replacements += 1;
  }

  return { updated, replacements };
}

function main() {
  const manifest = readManifest();
  if (manifest.length === 0) {
    console.log('Screenshot manifest is empty; no markers to replace.');
    return;
  }

  const files = fs
    .readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(DOCS_DIR, name));

  let totalReplacements = 0;
  const changed = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const { updated, replacements } = updateDocument(content, manifest);
    if (replacements > 0 && updated !== content) {
      fs.writeFileSync(file, updated);
      changed.push(path.relative(REPO_ROOT, file));
      totalReplacements += replacements;
      console.log(`  ${path.basename(file)}: ${replacements} marker(s) replaced`);
    }
  }

  if (changed.length === 0) {
    console.log('No markers needed updating (docs already up to date).');
  } else {
    console.log(
      `\nUpdated ${changed.length} file(s), ${totalReplacements} marker(s) total.`
    );
  }
}

main();
