#!/usr/bin/env node
/**
 * CI Setup Script for AD4M Integration Tests
 *
 * Downloads the bootstrap seed from the AD4M repo and prepares the test
 * environment. The bootstrap seed contains:
 * - The language-language bundle inline (ESM, built by Deno)
 * - Hashes for all system languages (agent, neighbourhood, perspective, etc.)
 *
 * At runtime, the language-language fetches system languages by hash from
 * the bootstrap store (https://bootstrap-store-gateway.perspect3vism.workers.dev).
 *
 * This replaces the previous approach of downloading individual CJS bundles
 * from perspect3vism repos and converting them to ESM.
 *
 * Usage: node scripts/setup-ci.cjs [executor-path]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AD4M_REPO_TAG = 'v0.10.1';
const BOOTSTRAP_SEED_URL = `https://raw.githubusercontent.com/coasys/ad4m/${AD4M_REPO_TAG}/tests/js/bootstrapSeed.json`;

const executorPath = process.argv[2];
const testDir = path.resolve(__dirname, '..');

function downloadBootstrapSeed(destDir) {
  const seedPath = path.join(destDir, 'bootstrapSeed.json');

  console.log(`  Downloading bootstrap seed from AD4M repo (${AD4M_REPO_TAG})...`);
  try {
    execSync(`curl -sfL "${BOOTSTRAP_SEED_URL}" -o "${seedPath}"`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`  Failed to download bootstrap seed: ${e.message}`);
    process.exit(1);
  }

  // Verify it's valid JSON with the expected fields
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  const required = ['languageLanguageBundle', 'agentLanguage', 'neighbourhoodLanguage', 'perspectiveLanguage'];
  for (const field of required) {
    if (!seed[field]) {
      console.error(`  Bootstrap seed missing required field: ${field}`);
      process.exit(1);
    }
  }

  console.log(`  Bootstrap seed downloaded and validated`);
  console.log(`    Language-language bundle: ${seed.languageLanguageBundle.length} chars`);
  console.log(`    Agent language: ${seed.agentLanguage}`);
  console.log(`    Neighbourhood language: ${seed.neighbourhoodLanguage}`);
  console.log(`    Perspective language: ${seed.perspectiveLanguage}`);
}

function verifyExecutor() {
  if (executorPath) {
    if (!fs.existsSync(executorPath)) {
      console.error(`Executor not found at: ${executorPath}`);
      process.exit(1);
    }
    console.log(`  Executor found at: ${executorPath}`);
    try {
      const version = execSync(`"${executorPath}" --version 2>&1`).toString().trim();
      console.log(`  Executor version: ${version}`);
    } catch (e) {
      console.log(`  (could not determine executor version)`);
    }
  }
}

// Main
console.log('AD4M Integration Test Setup\n');

console.log('Step 1: Download bootstrap seed');
downloadBootstrapSeed(testDir);

console.log('\nStep 2: Verify executor');
verifyExecutor();

console.log('\nSetup complete!');
console.log('The executor will fetch system languages at runtime via the bootstrap store.');
