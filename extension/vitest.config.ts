import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// What WXT's own Vitest plugin sets up, minus the dev-server port it grabs (unavailable in sandboxes and CI
// runners alike): the `@domain` alias and a fake `browser` API.
export default defineConfig({
  resolve: {
    alias: {
      '@domain': here('../src/domain'),
      'wxt/browser': here('../node_modules/wxt/dist/virtual/mock-browser.mjs'),
    },
  },
  ssr: { noExternal: ['wxt'] },
  test: {
    environment: 'happy-dom',
    // Saved pages link stylesheets and fonts; tests never fetch them.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          // Saved pages keep their iframes' markup; tests never load anything from the network.
          disableIframePageLoading: true,
        },
      },
    },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // Dates in answers ("earliest start") are local-time; pin the owner's zone.
    env: { TZ: 'America/Los_Angeles' },
  },
});
