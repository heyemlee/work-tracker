import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // The Cloudflare plugin runs the Worker in workerd during `vite dev`, so the SPA and /api share one server.
  plugins: [react(), tailwindcss(), cloudflare()],
  // PORT lets tooling assign a free port; 5180 stays clear of other Vite apps on the default 5173.
  server: { port: Number(process.env.PORT) || 5180, strictPort: true },
});
