import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
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
	server: {
		fs: {
			strict: false,
			allow: ['..']
		}
	}
});
