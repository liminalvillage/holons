import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "$lib": path.resolve(__dirname, "../../src/lib"),
      // Force @apollo/client to resolve from our node_modules (prevents CJS/ESM resolution issues)
      "@apollo/client": path.resolve(__dirname, "node_modules/@apollo/client"),
    },
  },
  test: {
    // Long timeouts for executor startup and Holochain operations
    testTimeout: 600_000, // 10 minutes per test
    hookTimeout: 300_000, // 5 minutes for before/after hooks
    // Force exit after tests complete (executor child processes keep node alive)
    forceExit: true,
    // Run tests sequentially (shared executor process)
    sequence: {
      concurrent: false,
    },
    // Include test files
    include: ["**/*.test.ts"],
  },
});
