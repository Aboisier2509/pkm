import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { offlineShellPlugin } from './src/pwa/build-plugin.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    offlineShellPlugin(version),
    {
      name: 'pkm-development-csp',
      apply: 'serve',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          // Vite injects CSS during HMR and connects to its local WebSocket.
          // This hook is disabled for builds, preserving the production policy.
          return html
            .replace(/style-src 'self'(?=;)/, "style-src 'self' 'unsafe-inline'")
            .replace(/connect-src 'self'(?=;)/, "connect-src 'self' ws://localhost:5173 ws://127.0.0.1:5173");
        },
      },
    },
  ],
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: { target: ['chrome111', 'edge111', 'safari16.4', 'firefox114'] },
  server: { host: 'localhost', port: 5173, strictPort: true },
  preview: { host: 'localhost', port: 4173, strictPort: true },
});
