import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        fetch: 'readonly',
        URL: 'readonly',
        crypto: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      'no-console': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': [
        'error',
        {
          args: 'none',
          caughtErrors: 'none',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-duplicate-imports': 'error',
      'no-unreachable': 'error',
      'no-undef': 'error',
    },
  },
  {
    files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // src/UI.js runs code inside Puppeteer page.evaluate(), so those callbacks
    // execute in a browser context with the DOM available.
    files: ['src/UI.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        requestAnimationFrame: 'readonly',
      },
    },
  },
  {
    ignores: [
      // Legacy/abandoned alternate bot implementations: not imported anywhere
      // and depend on uninstalled packages (@discordjs/voice, prism-media,
      // ipfs). Excluded until they are revived or removed.
      'src/MultiBot.js',
      'src/HolonsMultiBot.js',
      // Dead test referencing a module (WeQuestBot) that no longer exists.
      'tests/questest.js',
      // Flat config (ESLint 9) does NOT read .gitignore/.eslintignore, so
      // every vendored/generated/data dir must be listed here explicitly.
      // Without these, eslint parses html/ (710 minified vendor bundles incl.
      // pdfmake.min.js, apexcharts.min.js) and effectively hangs.
      'node_modules/**',
      'dist/**',
      'html/**',
      'logs/**',
      'contracts/**',
      'holosphere/**',
      'themes/**',
      'fields/**',
      'data/**',
      'images/**',
      'certs/**',
      'coverage/**',
      'public/**',
    ],
  },
];
