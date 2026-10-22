#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generate a new Nostr keypair for a HoloSphere service identity.
 * Run from apps/web:  node scripts/generate-nostr-key.js
 */

import { generateNsec, pubkeyOf, toNpub } from "@holons/core/nostr";

const nsec = generateNsec();
const npub = toNpub(pubkeyOf(nsec));

console.log("\n🔑 New Nostr keypair\n");
console.log("Secret key (keep it server-side, never in a client bundle):");
console.log(`HOLOSPHERE_NSEC=${nsec}`);
console.log("\nPublic key (safe to ship to the browser):");
console.log(`VITE_HOLOSPHERE_NPUB=${npub}\n`);
console.log("Add both lines to the root .env (never commit it).\n");
