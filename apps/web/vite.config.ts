import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";
import { execSync } from "child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const commitHash = execSync("git rev-parse --short HEAD").toString().trim();
const __dirname = dirname(fileURLToPath(import.meta.url));

// Pull the pinned holosphere version out of this package.json so the
// BrowserPanel footer can render the exact alpha/beta/etc. label that
// users are running on, instead of holosphere.js's hardcoded
// `HOLOSPHERE_VERSION = '1.3.0'` (which loses the alpha suffix).
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
);
const holosphereVersion = pkg.dependencies?.holosphere ?? "unknown";

export default defineConfig({
  // Load .env from the monorepo root so the namespace knob is a single source
  // of truth with mcp-ui and the bot.
  envDir: resolve(__dirname, "../.."),
  // Expose HOLONS_* to client code (import.meta.env.HOLONS_APP) alongside the
  // default VITE_ prefix — so HOLONS_APP is the ONE namespace var across server
  // and browser, with no separate VITE_HOLONS_APP. Only HOLONS_APP / HOLONS_PEER
  // live under this prefix; never put a secret under HOLONS_*.
  envPrefix: ["VITE_", "HOLONS_"],
  plugins: [sveltekit()],
  test: {
    include: ["src/**/*.{test,spec}.{js,ts}"],
  },
  define: {
    // Provide global Buffer for libraries that expect Node.js environment
    global: "globalThis",
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __HOLOSPHERE_VERSION__: JSON.stringify(holosphereVersion),
  },
  optimizeDeps: {
    include: ["svelte", "ajv", "h3-js", "buffer"],
    exclude: ["@sveltejs/kit"],
  },
  resolve: {
    dedupe: ["svelte", "ajv", "h3-js"],
    preserveSymlinks: false,
    alias: {
      // Polyfill Buffer for browser
      buffer: "buffer/",
    },
  },
  ssr: {
    // Don't bundle Node.js-only packages for SSR
    external: ["ws"],
    // Ensure these packages are bundled (not externalized)
    noExternal: ["holosphere"],
  },
  build: {
    // Target modern evergreen browsers so esbuild/Rollup don't down-level
    // syntax or ship legacy polyfills (Lighthouse "avoid legacy JavaScript").
    target: "es2022",
    rollupOptions: {
      // Externalize Node.js-only packages from client bundle
      external: ["ws"],
    },
  },
  server: {
    fs: {
      strict: false,
      allow: [".."],
    },
  },
});
