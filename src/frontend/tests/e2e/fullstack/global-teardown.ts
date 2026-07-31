// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Global teardown for fullstack E2E tests.
 * Cleans up the temporary data directory.
 */

import * as fs from 'fs';

async function globalTeardown(): Promise<void> {
  const tmpDir = process.env.AUGQ_USER_DATA_DIR;
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.AUGQ_USER_DATA_DIR;
  }
}

export default globalTeardown;
