import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createLocalApiMiddleware } from './scripts/local-preview-api.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const localHtml = '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local Express Questionnaire</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/src/local/main.jsx"></script></body></html>';
export default defineConfig({
  envDir: false,
  plugins: [react(), {
    name: 'isolated-local-express',
    transformIndexHtml: { order: 'pre', handler: () => localHtml },
    configureServer(server) { server.middlewares.use(createLocalApiMiddleware(root)); }
  }],
  define: { 'import.meta.env.VITE_LOCAL_PREVIEW': JSON.stringify(true) },
  resolve: { alias: [
    { find: /^(?:@\/api\/base44Client|(?:\.\.?\/)+(?:api\/)?base44Client)(?:\.js)?$/, replacement: root + 'src/local/base44Client.js' },
    { find: /^(?:@\/lib\/app-params|(?:\.\.?\/)+(?:lib\/)?app-params)(?:\.js)?$/, replacement: root + 'src/local/app-params.js' },
    { find: /^(?:@\/components\/questionnaire\/|(?:\.\.?\/)+(?:components\/questionnaire\/)?)GeographicQuestion(?:\.jsx)?$/, replacement: root + 'src/local/LocalGeographicQuestion.jsx' },
    { find: /^(?:@\/components\/questionnaire\/|(?:\.\.?\/)+(?:components\/questionnaire\/)?)ThankYouModal(?:\.jsx)?$/, replacement: root + 'src/local/LocalThankYouModal.jsx' },
    { find: '@', replacement: root + 'src' }
  ] },
  server: {
    host: '127.0.0.1', port: 5174, strictPort: true,
    headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://localhost:5174 ws://127.0.0.1:5174; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer'
    },
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/base44/.app.jsonc', '**/.local-preview/**'] }
  },
  build: { outDir: 'dist-local', emptyOutDir: true }
});
