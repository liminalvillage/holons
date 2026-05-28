export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js',
    '**/__tests__/**/*.js',
  ],
  collectCoverageFrom: [
    '*.js',
    '!node_modules/**',
    '!coverage/**',
    '!jest.config.js',
    '!radata/**',
    '!data/**',
    '!images/**',
    '!certs/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000,
};
