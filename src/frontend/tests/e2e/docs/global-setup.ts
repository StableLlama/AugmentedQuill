// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Global setup for the docs-feature E2E Playwright run.
 *
 * The temp data dir and demo projects are created at config-evaluation time
 * (see playwright.docs.config.ts), so this hook only exposes the scratch dir
 * path for the specs that need it.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export default function globalSetup(): void {
  const metaPath = path.join(os.tmpdir(), 'aq-docs-e2e-meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
    tmpDir?: string;
  };
  process.env.AUGQ_USER_DATA_DIR = meta.tmpDir || '';
}
