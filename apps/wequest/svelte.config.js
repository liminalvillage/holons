import adapter from "@sveltejs/adapter-netlify";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // The app runs entirely client-side (Holosphere/Gun are browser-only), but
  // Telegram login needs a server: the OIDC token exchange uses the
  // client_secret. adapter-netlify serves the CSR shell and the /api/auth/*
  // endpoints as serverless functions on the same site (kiosk pattern).
  kit: {
    adapter: adapter(),
    // Single root .env shared across the monorepo, so $env/dynamic/private
    // sees the OIDC secrets in local dev.
    env: { dir: "../.." },
  },
  preprocess: [vitePreprocess()],
};

export default config;
