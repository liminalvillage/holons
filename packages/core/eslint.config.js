// Architectural guard for @holons/core: "Core owns meaning; UIs only render."
//
// This config is intentionally minimal — it does NOT impose formatting/style
// rules on the (historically unlinted) domain code. Its sole job is to enforce
// the import boundary that keeps core UI-agnostic and portable across every
// interface: core may not VALUE-import any UI/transport library. `import type`
// is allowed (types don't create a runtime dependency), per the repo rule.

import tseslint from 'typescript-eslint';

/** UI / transport libraries core must never depend on at runtime. */
const UI_LIBRARIES = [
  'svelte',
  '@sveltejs/kit',
  'telegraf',
  'discord.js',
  'discord-api-types',
  '@modelcontextprotocol/sdk',
];

const message =
  'Core is UI-agnostic (core owns meaning; UIs only render). Do not import UI/transport libraries here — keep domain logic portable. `import type` is allowed.';

export default tseslint.config(
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: UI_LIBRARIES.map(name => ({
            name,
            message,
            allowTypeImports: true,
          })),
          patterns: [
            {
              group: [
                'svelte/*',
                '@sveltejs/*',
                'telegraf/*',
                'discord.js/*',
                '@modelcontextprotocol/*',
              ],
              message,
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  { ignores: ['node_modules/**', 'dist/**', 'schemas/**', 'scripts/**'] }
);
