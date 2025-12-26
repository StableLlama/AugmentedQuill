import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isDev = mode === 'development';
    return {
      base: isDev ? '/' : '/static/dist/',
      build: {
        outDir: '../static/dist',
        emptyOutDir: true,
        minify: false,
        sourcemap: true,
      },
      css: {
        devSourcemap: true,
      },
      server: {
        // During development we keep the browser URL on :8000.
        // The FastAPI backend should run on :8001 and is reached via proxy.
        port: 8000,
        strictPort: true,
        host: '0.0.0.0',
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8001',
                changeOrigin: true,
            }
        }
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
