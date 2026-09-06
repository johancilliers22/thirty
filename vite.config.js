import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
  server: { port: 5173 },
});
