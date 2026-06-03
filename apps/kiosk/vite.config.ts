import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Share the monorepo-root .env so VITE_HOLONS_APP / VITE_KIOSK_HOLON line up
  // with the web app, bot, and mcp-ui — one source of truth.
  envDir: resolve(__dirname, "../.."),
  plugins: [sveltekit()],
  define: {
    // Holosphere expects a Node-ish global; map it to the browser globalThis.
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["buffer"],
    exclude: ["@sveltejs/kit"],
  },
  resolve: {
    dedupe: ["svelte"],
    alias: {
      buffer: "buffer/",
    },
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
});
