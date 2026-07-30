/**
 * @gears-frontx/telemetry ESLint Configuration
 *
 * Layer rules are path-scoped, not package-scoped:
 * - src/** except src/plugin/** is L1-pure: zero @gears-frontx dependencies, no React.
 * - src/plugin/** is the L2 adapter: may import @gears-frontx/framework, still no React.
 */

import { sdkConfig } from '@gears-frontx/eslint-config/sdk.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...sdkConfig,

  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  // The SDK surface is a browser wire format and a hook contract typed against consumer data,
  // so `unknown` and a small number of `any` sites are load-bearing here.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    files: ['src/plugin/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/react', '@gears-frontx/react/*'],
              message: 'GEAR VIOLATION: the plugin adapter is headless. It cannot import @gears-frontx/react.',
            },
            {
              group: ['react', 'react-dom', 'react/*'],
              message: 'GEAR VIOLATION: the plugin adapter is headless. It cannot import React.',
            },
          ],
        },
      ],
    },
  },
];
