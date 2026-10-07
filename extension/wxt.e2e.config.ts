import { defineConfig } from 'wxt';
import config from './wxt.config';

/**
 * The build the end-to-end specs drive: the one Chrome loads in everything but the card's shadow root, left open so
 * that Playwright can look into it (`ui/card/mount.tsx`). It goes to a folder of its own, so it never takes the
 * place of the build Chrome loads; Playwright makes it as a run starts (`e2e/build.ts`). A config of its own rather
 * than a build mode: WXT gives every mode but production React's development build.
 */
export default defineConfig({
  ...config,
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}-e2e',
  vite: async (env) => ({ ...(await config.vite?.(env)), define: { 'import.meta.env.E2E': 'true' } }),
});
