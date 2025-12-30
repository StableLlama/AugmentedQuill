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
      // Frontend dev server (Vite). Backend runs separately (default :8000).
      port: 28001,
      strictPort: true,
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:28000',
          changeOrigin: true,
        },
        '/static': {
          target: 'http://127.0.0.1:28000',
          changeOrigin: true,
        },
      },
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.OPENAI_API_KEY),
      'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
