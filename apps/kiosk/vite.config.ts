import { sveltekit } from "@sveltejs/kit/vite";
// vitest's defineConfig = vite's + the typed `test` block below.
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  // Share the monorepo-root .env so HOLONS_APP / VITE_KIOSK_HOLON line up
  // with the web app, bot, and mcp-ui — one source of truth.
  envDir: resolve(__dirname, "../.."),
  plugins: [sveltekit()],
  define: {
    // The OpenAI key env is a LOCAL-DEV fallback for the direct voice mode
    // only. Vite inlines VITE_* values into the bundle, so a key set in a CI
    // host's env (e.g. Netlify) would ship to every visitor — Netlify's
    // secrets scanner rightly fails such builds. Force it empty in every
    // `vite build` so production bundles are structurally keyless; deployed
    // kiosks take the key from Settings → Voice, per device.
    ...(command === "build"
      ? { "import.meta.env.VITE_OPENAI_API_KEY": '""' }
      : {}),
  },
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
  build: {
    // Target modern evergreen browsers so esbuild/Rollup don't down-level
    // syntax or ship legacy polyfills (Lighthouse "avoid legacy JavaScript").
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
    // Pure-logic specs only (e.g. the swipe deck's geometry) — no DOM needed.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
}));
