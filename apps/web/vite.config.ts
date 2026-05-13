import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { execSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const commitHash = execSync('git rev-parse --short HEAD').toString().trim();
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	// Load .env from the monorepo root so HOLONS_APP / VITE_HOLONS_APP share a
	// single source of truth with mcp-ui and the bot.
	envDir: resolve(__dirname, '../..'),
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	},
	define: {
		// Provide global Buffer for libraries that expect Node.js environment
		global: 'globalThis',
		__COMMIT_HASH__: JSON.stringify(commitHash)
	},
	optimizeDeps: {
		include: ['svelte', 'ajv', 'h3-js', 'buffer'],
		exclude: ['@sveltejs/kit']
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
		// Ensure these packages are bundled (not externalized)
		noExternal: ['holosphere']
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
