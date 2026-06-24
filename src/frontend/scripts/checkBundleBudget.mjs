// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Enforce a gzip budget for the main frontend bundle to keep load
 * performance regressions visible in CI.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const ASSETS_DIR = path.resolve(process.cwd(), '../../static/dist/assets');
const MAIN_BUNDLE_PATTERN = /^index-.*\.js$/;
const MAX_GZIP_KB = Number(process.env.AQ_BUNDLE_BUDGET_GZIP_KB || 800);

const formatKb = (bytes) => (bytes / 1024).toFixed(2);

const fail = (message) => {
  console.error(`[bundle-budget] ${message}`);
  process.exit(1);
};

const run = async () => {
  let files;
  try {
    files = await fs.readdir(ASSETS_DIR);
  } catch (error) {
    fail(`Could not read assets directory: ${ASSETS_DIR}`);
  }

  const mainBundle = files.find((name) => MAIN_BUNDLE_PATTERN.test(name));
  if (!mainBundle) {
    fail('Main bundle not found (expected index-*.js in static/dist/assets).');
  }

  const bundlePath = path.join(ASSETS_DIR, mainBundle);
  const source = await fs.readFile(bundlePath);
  const gzipSizeBytes = gzipSync(source, { level: 9 }).length;
  const gzipKb = gzipSizeBytes / 1024;

  console.log(
    `[bundle-budget] ${mainBundle}: ${formatKb(source.length)} KB raw, ${formatKb(gzipSizeBytes)} KB gzip`
  );

  if (gzipKb > MAX_GZIP_KB) {
    fail(
      `Main bundle gzip size ${formatKb(gzipSizeBytes)} KB exceeds budget ${MAX_GZIP_KB} KB.`
    );
  }

  console.log(
    `[bundle-budget] OK (budget: ${MAX_GZIP_KB} KB, actual: ${formatKb(gzipSizeBytes)} KB).`
  );
};

run().catch((error) => {
  fail(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
});
