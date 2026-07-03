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
