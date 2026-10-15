import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['generated', 'dist', '.archive', 'test-results', 'playwright-report', 'web/.generated']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  { files: ['web/*.js'], extends: [js.configs.recommended], languageOptions: { globals: globals.browser } },
  { files: ['scripts/*.mjs'], extends: [js.configs.recommended], languageOptions: { globals: globals.node } },
]);
