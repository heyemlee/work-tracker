import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { localToolsProxy } from './scripts/localToolsProxy.ts';

export default defineConfig({
  // The Cloudflare plugin runs the Worker in workerd during `vite dev`, so the SPA and /api share one server.
  plugins: [localToolsProxy(), react(), tailwindcss(), cloudflare()],
  // Keep the main app's scanner out of extension HTML entrypoints with their own aliases.
  optimizeDeps: { entries: ['index.html'] },
  // PORT lets tooling assign a free port; 5180 stays clear of other Vite apps on the default 5173.
  server: { host: '127.0.0.1', port: Number(process.env.PORT) || 5180, strictPort: true },
});
