import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	},
	optimizeDeps: {
		include: ['svelte', 'ajv', 'h3-js'],
		exclude: ['@sveltejs/kit', 'holosphere']
	},
	resolve: {
		dedupe: ['svelte', 'ajv', 'h3-js'],
		preserveSymlinks: false
	},
	server: {
		fs: {
			strict: false,
			allow: ['..']
		}
	}
});
