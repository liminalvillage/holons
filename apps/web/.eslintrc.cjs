// Minimal ESLint config so the lint script can parse ESM files
// (`svelte.config.js`, `src/utils/date.js`, `scripts/*.js`). The repo
// historically had no .eslintrc and relied on prettier + svelte-check;
// this config exists only to make `eslint .` not crash on `import`/
// `export` keywords. Rules deliberately empty.
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  ignorePatterns: [
    "**/*.ts",
    "**/*.tsx",
    "**/*.svelte",
    "**/*.cjs",
    "**/*.mjs",
  ],
};
