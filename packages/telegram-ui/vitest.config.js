import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 10000,
    setupFiles: ['./tests/setup.js'],
    include: [
      '**/tests/**/*.test.js',
      '**/tests/**/*.spec.js',
      '**/__tests__/**/*.js',
    ],
    coverage: {
      reporter: ['text', 'lcov', 'html'],
      include: ['*.js', 'core/**/*.js', 'utils/**/*.js', 'modules/**/*.js'],
      exclude: [
        'node_modules/**',
        'coverage/**',
        'jest.config.js',
        'vitest.config.js',
        'radata/**',
        'data/**',
        'images/**',
        'certs/**',
      ],
    },
  },
});
