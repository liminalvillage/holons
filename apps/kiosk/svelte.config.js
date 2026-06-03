import adapter from "@sveltejs/adapter-netlify";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // The kiosk pages run entirely client-side (Holosphere/Gun are browser-only),
  // but login needs a server: Telegram OIDC requires a server-side token
  // exchange with the client_secret. adapter-netlify serves the CSR shell and
  // the /api/auth/* endpoints as serverless functions on the same site.
  kit: {
    adapter: adapter(),
    // Single root .env shared across the monorepo, so $env/dynamic/private sees
    // the OIDC secrets in local dev (in prod they come from Netlify's env).
    env: { dir: "../.." },
  },
  preprocess: [vitePreprocess()],
};

export default config;
