import { sveltekit } from "@sveltejs/kit/vite";
// vitest's defineConfig = vite's + the typed `test` block below.
import { defineConfig } from "vitest/config";
import { createReadStream, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Dev only: serve the fixture map (`dev/graph.json`, the Artizen funds and
 * projects with made-up people under them) at the URL the app draws by
 * default (`DEV_GRAPH_URL` in `src/lib/config.ts`). Not in `static/`, so a
 * production build never ships or reads it.
 */
function devGraph(): Plugin {
  const file = resolve(__dirname, "dev/graph.json");
  return {
    name: "flows-dev-graph",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev-graph.json", (_req, res) => {
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  // Share the monorepo-root .env so VITE_FLOWS_* / HOLONS_APP line up with
  // the other apps — one source of truth.
  envDir: resolve(__dirname, "../.."),
  plugins: [sveltekit(), devGraph()],
  optimizeDeps: {
    exclude: ["@sveltejs/kit"],
  },
  resolve: {
    dedupe: ["svelte"],
  },
  ssr: {
    // h3-js is Emscripten output that reads `__dirname`: bundled into the ESM
    // server it throws on load. Core's founding rules import it, and the
    // server's OpenCollective route imports `@holons/core/flows`, so it is
    // left to Node to load as the CommonJS it is.
    external: ["ws", "h3-js"],
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
