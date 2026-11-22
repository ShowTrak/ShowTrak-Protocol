// Lint config for the protocol repo on its own (`npm run lint`, CI).
//
// It is deliberately not called eslint.config.mjs, and lives in tooling/ with
// its own package.json, because this repo is also checked out as shared/ inside
// ShowTrak Server, Client and Timers:
//   - ESLint 10 lints each file with the nearest eslint.config.*, so a config
//     here under that name would take over when an app lints shared/.
//   - The apps install shared/ as a file: dependency, and npm installs a linked
//     package's devDependencies too, so tooling in the root package.json would
//     change every app's lockfile.
// The rules match ShowTrak Server's, which also lints shared/ with its own.
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: ['**/node_modules/**', 'dist/**', 'e2e/work/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended, prettier],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      // A require() stays where a module is loaded lazily on purpose (start-up
      // cost: electron-updater in src/electron/app-updater.ts), typed as
      // `require('x') as typeof import('x')`; every other module is imported.
      // Off in ShowTrak Server for the same reason.
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          caughtErrors: 'none',
          argsIgnorePattern: '^_[^_].*$|^_$',
          varsIgnorePattern: '^_[^_].*$|^_$',
        },
      ],
    },
  },
]);
