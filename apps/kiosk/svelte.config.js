import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // SPA mode: the kiosk runs entirely client-side (Holosphere/Gun are
  // browser-only), so we prerender nothing and serve an index.html fallback.
  kit: {
    adapter: adapter({ fallback: "index.html", strict: false }),
  },
  preprocess: [vitePreprocess()],
};

export default config;
