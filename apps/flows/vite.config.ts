import { sveltekit } from "@sveltejs/kit/vite";
// vitest's defineConfig = vite's + the typed `test` block below.
import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Share the monorepo-root .env so VITE_FLOWS_* / HOLONS_APP line up with
  // the other apps — one source of truth.
  envDir: resolve(__dirname, "../.."),
  plugins: [sveltekit()],
  optimizeDeps: {
    exclude: ["@sveltejs/kit"],
  },
  resolve: {
    dedupe: ["svelte"],
  },
  ssr: {
    external: ["ws"],
    noExternal: ["holosphere"],
  },
  // The network layout's worker imports core: ES modules, so it can split.
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    rollupOptions: {
      external: ["ws"],
    },
  },
  server: {
    fs: {
      // Allow importing @holons/core source from the workspace root.
      strict: false,
      allow: [".."],
    },
  },
  test: {
    // Pure-logic specs only (hit-testing, urls, formatting, catalogs) — no DOM needed.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
