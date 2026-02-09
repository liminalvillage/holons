import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const commitHash = execSync('git rev-parse --short HEAD').toString().trim();
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const holosphereVersion = pkg.dependencies?.holosphere || 'unknown';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	},
	define: {
		// Provide global Buffer for libraries that expect Node.js environment
		global: 'globalThis',
		__COMMIT_HASH__: JSON.stringify(commitHash),
		__HOLOSPHERE_VERSION__: JSON.stringify(holosphereVersion)
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
