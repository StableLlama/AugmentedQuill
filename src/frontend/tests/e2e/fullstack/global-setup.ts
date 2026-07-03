/**
 * Global setup for fullstack E2E tests.
 * The temp directory is created in the playwright config.
 * This just exports the AUGQ_USER_DATA_DIR for test access.
 * Since the config already set it via command line, we don't need to
 * create anything here — just make it available as an env var.
 */

async function globalSetup(): Promise<void> {
  // The temp dir is computed and passed via AUGQ_USER_DATA_DIR in the
  // webServer command.  No additional setup needed here.
}

export default globalSetup;
