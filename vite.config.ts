import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'node',
		testTimeout: 120000,
		hookTimeout: 60000,
		globals: true,
		pool: 'forks'
	},
	define: {
		// Provide global Buffer for libraries that expect Node.js environment
		global: 'globalThis'
	},
	optimizeDeps: {
		include: ['svelte', 'ajv', 'h3-js', 'buffer'],
		exclude: ['@sveltejs/kit', 'holosphere']
	},
	resolve: {
		dedupe: ['svelte', 'ajv', 'h3-js'],
		preserveSymlinks: false,
		alias: {
			// Polyfill Buffer for browser
			buffer: 'buffer/'
		}
	},
	ssr: {
		// Don't bundle Node.js-only packages for SSR
		external: ['ws'],
		// Ensure nostr-tools is bundled (not externalized)
		noExternal: ['nostr-tools']
	},
	build: {
		rollupOptions: {
			// Externalize Node.js-only packages from client bundle
			external: ['ws']
		}
	},
	server: {
		fs: {
			strict: false,
			allow: ['..']
		}
	}
});
