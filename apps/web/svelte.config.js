import adapter from "@sveltejs/adapter-netlify";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    // The monorepo keeps a single root .env (shared by web + bot). Point
    // SvelteKit's $env loader there so $env/dynamic/private sees server secrets
    // (TELEGRAM, AUTH_JWT_SECRET, NOSTR_DERIVATION_SECRET) in local dev. In
    // production these come from the platform's process.env (Netlify) regardless.
    env: { dir: "../.." },
  },
  build: {
    rollupOptions: {
      external: ["siwe"],
    },
  },
  // Enhanced preprocessing with better TypeScript support
  preprocess: [
    vitePreprocess({
      typescript: {
        // Relax TypeScript checking for Svelte components
        compilerOptions: {
          skipLibCheck: true,
          noImplicitAny: false,
          allowSyntheticDefaultImports: true,
        },
      },
    }),
  ],
};

export default config;
