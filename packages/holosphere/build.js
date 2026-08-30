#!/usr/bin/env node

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const version = packageJson.version;

console.log(`🏗️  Building HoloSphere v${version} bundle...`);

// Create bundled version with all dependencies
try {
  await build({
    entryPoints: ['holosphere.js'],
    bundle: true,
    minify: false, // Keep readable for development
    format: 'iife', // Immediately Invoked Function Expression for browser
    globalName: 'HoloSphere',
    outfile: 'holosphere-bundle.js',
    platform: 'browser',
    target: 'es2020',
    banner: {
      js: `/**
 * HoloSphere Bundle v${version}
 * Holonic Geospatial Communication Infrastructure
 * 
 * Includes:
 * - HoloSphere core
 * - Gun.js (real-time database)
 * - H3.js (geospatial indexing) 
 * - Ajv (JSON schema validation)
 * 
 * Usage:
 * <script src="https://unpkg.com/holosphere@${version}/holosphere-bundle.js"></script>
 * <script>
 *   const hs = new HoloSphere('myapp');
 * </script>
 * 
 * @author Roberto Valenti
 * @license AGPL-3.0-or-later
 */`
    },
    footer: {
      js: `
// Ensure HoloSphere is properly exposed as global constructor
if (typeof window !== 'undefined') {
  window.HoloSphere = HoloSphere.default || HoloSphere;
}
if (typeof global !== 'undefined') {
  global.HoloSphere = HoloSphere.default || HoloSphere;
}
`
    },
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    external: [], // Bundle everything
  });

  console.log('✅ Bundle created: holosphere-bundle.js');

  // Also create a minified version
  await build({
    entryPoints: ['holosphere.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'HoloSphere', 
    outfile: 'holosphere-bundle.min.js',
    platform: 'browser',
    target: 'es2020',
    banner: {
      js: `/* HoloSphere Bundle v${version} - Holonic Geospatial Communication Infrastructure */`
    },
    footer: {
      js: `if (typeof window !== 'undefined') { window.HoloSphere = HoloSphere.default || HoloSphere; } if (typeof global !== 'undefined') { global.HoloSphere = HoloSphere.default || HoloSphere; }`
    },
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    external: [],
  });

  console.log('✅ Minified bundle created: holosphere-bundle.min.js');

  // Create ES6 module bundle too
  await build({
    entryPoints: ['holosphere.js'],
    bundle: true,
    minify: false,
    format: 'esm',
    outfile: 'holosphere-bundle.esm.js',
    platform: 'browser',
    target: 'es2020',
    banner: {
      js: `/**
 * HoloSphere ESM Bundle v${version}
 * ES6 Module version with all dependencies bundled
 * 
 * Usage:
 * import HoloSphere from 'https://unpkg.com/holosphere@${version}/holosphere-bundle.esm.js';
 * const hs = new HoloSphere('myapp');
 */`
    },
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    external: [],
  });

  console.log('✅ ESM bundle created: holosphere-bundle.esm.js');
  console.log('🎉 Build completed successfully!');

} catch (error) {
  console.error('❌ Build failed:', error);
  process.exit(1);
} 