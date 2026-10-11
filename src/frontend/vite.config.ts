// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the vite.config unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import path from 'path';
import fs from 'fs';
import child_process from 'child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const frontendPackagePath = path.resolve(import.meta.dirname, 'package.json');
let appVersion = 'unknown';
try {
  const pkgJson = JSON.parse(fs.readFileSync(frontendPackagePath, 'utf-8'));
  appVersion = String(pkgJson.version || 'unknown');
} catch (_e) {
  console.warn('Unable to resolve frontend version from package.json', _e);
}

let gitRevision = 'unknown';
try {
  gitRevision = child_process
    .execSync('git rev-parse --short HEAD', { encoding: 'utf-8' })
    .trim();
} catch (_e) {
  console.warn('Unable to resolve git revision at build time', _e);
}

let pythonVersion = 'unknown';
try {
  pythonVersion = child_process
    .execSync('python --version', { encoding: 'utf-8' })
    .trim();
} catch {
  try {
    pythonVersion = child_process
      .execSync('python3 --version', { encoding: 'utf-8' })
      .trim();
  } catch (inner) {
    console.warn('Unable to resolve python version at build time', inner);
  }
}

const nodeVersion = process.versions?.node ? `v${process.versions.node}` : 'unknown';

export default defineConfig(({ mode }: import('vite').ConfigEnv) => {
  const env = loadEnv(mode, '.', '');
  const isDev = mode === 'development';
  return {
    base: isDev ? '/' : '/static/dist/',
    build: {
      outDir: '../../static/dist',
      emptyOutDir: true,
      minify: false,
      sourcemap: true,
    },
    css: {
      devSourcemap: true,
    },
    server: {
      // Frontend dev server (Vite). Backend runs separately (default :8000).
      // Override via VITE_BACKEND_URL (e.g. http://127.0.0.1:28000) or
      // VITE_BACKEND_HOST/VITE_BACKEND_PORT.
      port: 5173,
      strictPort: true,
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target:
            env.VITE_BACKEND_URL ||
            `http://${env.VITE_BACKEND_HOST || '127.0.0.1'}:${env.VITE_BACKEND_PORT || '8000'}`,
          changeOrigin: true,
        },
        '/static': {
          target:
            env.VITE_BACKEND_URL ||
            `http://${env.VITE_BACKEND_HOST || '127.0.0.1'}:${env.VITE_BACKEND_PORT || '8000'}`,
          changeOrigin: true,
        },
      },
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.OPENAI_API_KEY),
      'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
      'process.env.APP_VERSION': JSON.stringify(appVersion),
      'process.env.GIT_REVISION': JSON.stringify(gitRevision),
      'process.env.PYTHON_VERSION': JSON.stringify(pythonVersion),
      'process.env.NODE_VERSION': JSON.stringify(nodeVersion),
      'process.env.GITHUB_PROJECT_URL': JSON.stringify(
        'https://github.com/StableLlamaAI/AugmentedQuill'
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
  };
});
