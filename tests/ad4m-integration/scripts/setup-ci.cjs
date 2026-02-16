#!/usr/bin/env node
/**
 * CI Setup Script for AD4M Integration Tests
 *
 * Prepares the test environment for running against a pre-built AD4M executor:
 * 1. Downloads system language bundles from AD4M releases
 * 2. Converts CJS bundles to ESM for Deno runtime compatibility
 * 3. Creates bootstrapSeed.json with ESM-converted Language Language bundle
 * 4. Patches IPFS references (removed from executor but in Language Language)
 *
 * Adapted from HexaField/nextgraph-adam-language scripts/patch-ad4m-test.cjs
 *
 * Usage: node scripts/setup-ci.cjs [executor-path]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RELEASE_TAG = 'v0.10.1';

// Node built-in modules that need 'node:' prefix in Deno
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
  'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
  'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib'
]);

function convertCjsToEsm(code) {
  let esm = code;

  esm = esm.replace(/^'use strict';\s*/m, '');
  esm = esm.replace(/Object\.defineProperty\(exports,\s*'__esModule'.*?\);\s*/g, '');

  const requires = [];
  esm = esm.replace(/var\s+(\w+)\s*=\s*require\('([^']+)'\);?/g, (match, varName, modName) => {
    const resolvedMod = NODE_BUILTINS.has(modName) ? `node:${modName}` : modName;
    requires.push({ varName, modName: resolvedMod });
    return '';
  });

  const namedExports = new Set();
  esm = esm.replace(/exports\["default"\]\s*=\s*(\w+);/g, (m, name) => {
    namedExports.add(`default:${name}`);
    return '';
  });
  esm = esm.replace(/exports\.default\s*=\s*(\w+);/g, (m, name) => {
    namedExports.add(`default:${name}`);
    return '';
  });
  esm = esm.replace(/exports\.(\w+)\s*=\s*(\w+);/g, (m, exportName, localName) => {
    namedExports.add(`named:${exportName}:${localName}`);
    return '';
  });

  esm = esm.replace(/\/\/# sourceMappingURL=.*$/m, '');

  // Stub IPFS usage (removed from executor v0.10.1+ but Language Language still references it)
  esm = esm.replace(
    /const ipfsAddress = await __classPrivateFieldGet.*?\.add\(\{.*?\}\s*,\s*\{.*?onlyHash.*?\}\);/gs,
    'const ipfsAddress = { cid: { toString: () => "Qm" + Math.random().toString(36).substring(2, 15) } };'
  );
  esm = esm.replace(
    /throw new Error\(`Language Persistence: Can't store language[^`]*`\);/g,
    'const hash = language.meta.address;'
  );
  // Also stub context.IPFS references
  esm = esm.replace(
    /context\.IPFS\.add\([^)]*\)/g,
    'Promise.resolve({ cid: { toString: () => "Qm" + Math.random().toString(36).substring(2, 15) } })'
  );

  const imports = requires.map(r => `import ${r.varName} from '${r.modName}';`).join('\n');

  const exportLines = [];
  for (const exp of namedExports) {
    if (exp.startsWith('default:')) {
      exportLines.push(`export default ${exp.split(':')[1]};`);
    } else {
      const [, exportName, localName] = exp.split(':');
      if (exportName === localName) {
        exportLines.push(`export { ${exportName} };`);
      } else {
        exportLines.push(`export { ${localName} as ${exportName} };`);
      }
    }
  }

  return `${imports}\n${esm}\n${exportLines.join('\n')}\n`;
}

function downloadLanguageBundles(destDir) {
  const langsDir = path.join(destDir, 'build', 'languages');
  fs.mkdirSync(langsDir, { recursive: true });

  // System language bundles from their respective repos (same URLs as @coasys/ad4m-test)
  const languages = {
    'agent-expression-store': 'https://github.com/perspect3vism/agent-language/releases/download/0.2.0/bundle.js',
    'languages': 'https://github.com/perspect3vism/local-language-persistence/releases/download/0.0.1/bundle.js',
    'neighbourhood-store': 'https://github.com/perspect3vism/local-neighbourhood-persistence/releases/download/0.0.1/bundle.js',
    'perspective-diff-sync': 'https://github.com/perspect3vism/perspective-diff-sync/releases/download/v0.2.2-test/bundle.js',
    'direct-message-language': 'https://github.com/perspect3vism/direct-message-language/releases/download/0.1.0/bundle.js',
    'perspective-language': 'https://github.com/perspect3vism/perspective-language/releases/download/0.0.1/bundle.js',
  };

  for (const [name, url] of Object.entries(languages)) {
    const langDir = path.join(langsDir, name, 'build');
    fs.mkdirSync(langDir, { recursive: true });
    const outPath = path.join(langDir, 'bundle.js');

    try {
      console.log(`  Downloading ${name}...`);
      execSync(`curl -fsSL "${url}" -o "${outPath}"`, { stdio: 'pipe' });
      const size = fs.statSync(outPath).size;
      console.log(`  → ${name}: ${size} bytes`);
    } catch (e) {
      console.warn(`  Failed to download ${name}: ${e.message}`);
    }
  }
}

function createBootstrapSeed(destDir) {
  const seed = {
    trustedAgents: [],
    knownLinkLanguages: [],
    directMessageLanguage: "",
    agentLanguage: "",
    perspectiveLanguage: "",
    neighbourhoodLanguage: "",
    languageLanguageBundle: "",
    languageLanguageSettings: { storagePath: "" },
    neighbourhoodLanguageSettings: { storagePath: "" }
  };

  const langsDir = path.join(destDir, 'build', 'languages');
  if (fs.existsSync(langsDir)) {
    for (const langName of fs.readdirSync(langsDir)) {
      const bundlePath = path.join(langsDir, langName, 'build', 'bundle.js');
      if (!fs.existsSync(bundlePath)) continue;

      let bundle = fs.readFileSync(bundlePath, 'utf-8');

      // Convert CJS to ESM if needed
      if (bundle.includes("require('") || bundle.match(/^exports\./m)) {
        bundle = convertCjsToEsm(bundle);
        fs.writeFileSync(bundlePath, bundle);
        console.log(`  Converted ${langName} to ESM (${bundle.length} chars)`);
      }

      // Map language names to seed fields — only Language Language gets embedded as bundle
      // System languages are referenced by hash; executor installs them at runtime
      switch (langName) {
        case 'languages':
          seed.languageLanguageBundle = bundle;
          break;
        // Other system languages stay as empty strings — executor uses languageLanguageOnly mode
      }
    }
  }

  // Set storage paths
  const publishedLangs = path.resolve(destDir, 'build', 'publishedLanguages');
  const publishedNeighbourhoods = path.resolve(destDir, 'build', 'publishedNeighbourhood');
  fs.mkdirSync(publishedLangs, { recursive: true });
  fs.mkdirSync(publishedNeighbourhoods, { recursive: true });
  seed.languageLanguageSettings.storagePath = publishedLangs;
  seed.neighbourhoodLanguageSettings.storagePath = publishedNeighbourhoods;

  const seedPath = path.join(destDir, 'bootstrapSeed.json');
  fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2));
  console.log(`  Created: ${seedPath} (Language Language: ${seed.languageLanguageBundle.length} chars)`);
}

function patchUtilsForCI(destDir, executorPath) {
  const utilsPath = path.join(destDir, 'utils', 'utils.ts');
  if (!fs.existsSync(utilsPath)) {
    console.warn('  utils.ts not found, skipping patch');
    return;
  }

  let code = fs.readFileSync(utilsPath, 'utf8');

  // Fix executor path
  code = code.replace(
    /export const AD4M_EXECUTOR_PATH = path\.resolve\([^;]+;/s,
    `export const AD4M_EXECUTOR_PATH = process.env.AD4M_EXECUTOR_PATH || "${executorPath}";`
  );

  // Fix bootstrap seed path (use our generated one)
  code = code.replace(
    /export const BOOTSTRAP_SEED_PATH = path\.resolve\([^;]+;/s,
    'export const BOOTSTRAP_SEED_PATH = path.resolve(__dirname, "..", "bootstrapSeed.json");'
  );

  // Force languageLanguageOnly to true for v0.10.1 (no system language hashes in seed)
  code = code.replace(
    /--language-language-only \$\{languageLanguageOnly\}/,
    '--language-language-only true',
  );

  fs.writeFileSync(utilsPath, code);
  console.log('  Patched utils.ts paths');
}

// Main
const testDir = path.join(__dirname, '..');
const executorPath = process.argv[2] || process.env.AD4M_EXECUTOR_PATH || '/usr/local/bin/ad4m-executor';

console.log('=== AD4M Integration Test CI Setup ===\n');

console.log('Step 1: Download system language bundles');
downloadLanguageBundles(testDir);

console.log('\nStep 2: Create bootstrapSeed with ESM-converted bundles');
createBootstrapSeed(testDir);

console.log('\nStep 3: Patch test utils for CI');
patchUtilsForCI(testDir, executorPath);

console.log('\n=== Setup complete ===');
