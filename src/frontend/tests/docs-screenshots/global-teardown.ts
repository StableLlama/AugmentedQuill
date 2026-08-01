// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Global teardown for the docs-screenshots Playwright run.
 *
 * Removes the temporary data directory created by the config so repeated
 * runs never accumulate scratch state under the OS temp folder.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export default function globalTeardown(): void {
  const metaPath = path.join(os.tmpdir(), 'aq-docs-shots-meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { tmpDir?: string };
    if (meta.tmpDir) {
      fs.rmSync(meta.tmpDir, { recursive: true, force: true });
    }
  } catch {
    // Temp dir may not exist if a run failed early; nothing to clean up.
  }
  try {
    fs.rmSync(metaPath, { force: true });
  } catch {
    // ignore
  }
}
