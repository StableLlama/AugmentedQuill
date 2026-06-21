import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  server: {
    port: 5199,
    strictPort: true,
    host: '127.0.0.1',
  },
});
