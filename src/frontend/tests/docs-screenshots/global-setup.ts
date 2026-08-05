// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Global setup for the docs-screenshots Playwright run.
 *
 * The temp data dir and demo projects are created at config-evaluation time
 * (see docs-screenshots.config.ts), so this hook only needs to expose the
 * scratch dir path for the capture spec.
 */

export default function globalSetup(): void {
  // Nothing to provision here — the config seeds the temp dir and projects.
}
