import adapter from '@sveltejs/adapter-netlify';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter()
	},
	build: {
		rollupOptions: {
		  external: ['siwe']
		}
	  },
	// Enhanced preprocessing with better TypeScript support
	preprocess: [
		vitePreprocess({
			typescript: {
				// Relax TypeScript checking for Svelte components
				compilerOptions: {
					skipLibCheck: true,
					noImplicitAny: false,
					allowSyntheticDefaultImports: true
				}
			}
		})
	]
};

export default config;
