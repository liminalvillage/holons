#!/usr/bin/env node

/**
 * Generate a new Nostr keypair for use with HoloSphere
 * Run with: node generate-nostr-key.js
 */

import { randomBytes } from "crypto";
import { getPublicKey } from "../holosphere2/node_modules/nostr-tools/lib/esm/index.js";

console.log("\n🔑 Generating new Nostr keypair...\n");

// Generate new private key (32 random bytes)
const privateKeyBytes = randomBytes(32);
const privateKeyHex = privateKeyBytes.toString("hex");

// Derive public key from private key
const publicKeyHex = getPublicKey(privateKeyBytes);

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Private Key (hex):");
console.log(privateKeyHex);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Public Key (hex):");
console.log(publicKeyHex);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

console.log("⚠️  IMPORTANT: Keep your private key SECRET and SAFE!");
console.log("   - Never share your private key with anyone");
console.log("   - Store it securely (password manager, encrypted file, etc.)");
console.log("   - Anyone with your private key has full access to your data\n");

console.log("📝 Add this to your .env file:");
console.log(`VITE_HOLOSPHERE_PRIVATE_KEY="${privateKeyHex}"\n`);

console.log("✅ Then update +layout.svelte line 31 with your new public key:");
console.log(`console.log("Expected:", "${publicKeyHex}");\n`);
