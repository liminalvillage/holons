/**
 * Nostr-compatible cryptographic utilities for HoloSphere v1.3
 * Provides key generation, encoding, and conversion using secp256k1
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { bech32 } from '@scure/base';

function generatePrivateKey() {
    const privKey = secp256k1.utils.randomPrivateKey();
    return bytesToHex(privKey);
}

function getPublicKey(privateKeyHex) {
    // Get compressed public key (33 bytes) then extract x-only (32 bytes)
    const pubBytes = secp256k1.getPublicKey(privateKeyHex, true);
    // x-only pubkey is the compressed key minus the prefix byte
    return bytesToHex(pubBytes.slice(1));
}

function getPublicKeyFromBytes(privateKeyBytes) {
    const pubBytes = secp256k1.getPublicKey(privateKeyBytes, true);
    return bytesToHex(pubBytes.slice(1));
}

function hexToNpub(hex) {
    const data = hexToBytes(hex);
    const words = bech32.toWords(data);
    return bech32.encode('npub', words, 1500);
}

function hexToNsec(hex) {
    const data = hexToBytes(hex);
    const words = bech32.toWords(data);
    return bech32.encode('nsec', words, 1500);
}

function npubToHex(npub) {
    const { words } = bech32.decode(npub, 1500);
    const data = bech32.fromWords(words);
    return bytesToHex(new Uint8Array(data));
}

function nsecToHex(nsec) {
    const { words } = bech32.decode(nsec, 1500);
    const data = bech32.fromWords(words);
    return bytesToHex(new Uint8Array(data));
}

function parseNsecOrHex(input) {
    if (!input || typeof input !== 'string') return null;
    input = input.trim();
    if (input.startsWith('nsec1')) {
        try {
            return nsecToHex(input);
        } catch (e) {
            return null;
        }
    }
    // Validate hex
    if (/^[0-9a-f]{64}$/i.test(input)) {
        return input.toLowerCase();
    }
    return null;
}

function parseNpubOrHex(input) {
    if (!input || typeof input !== 'string') return null;
    input = input.trim();
    if (input.startsWith('npub1')) {
        try {
            return npubToHex(input);
        } catch (e) {
            return null;
        }
    }
    if (/^[0-9a-f]{64}$/i.test(input)) {
        return input.toLowerCase();
    }
    return null;
}

function shortenPubKey(pubkey, len = 8) {
    if (!pubkey) return '';
    return pubkey.slice(0, len) + '...' + pubkey.slice(-len);
}

function shortenNpub(npub, len = 8) {
    if (!npub) return '';
    return npub.slice(0, len + 5) + '...' + npub.slice(-len);
}

function generateNonce() {
    const bytes = new Uint8Array(32);
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        // Simple fallback - not cryptographically secure but functional
        for (let i = 0; i < 32; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    return bytesToHex(bytes);
}

export const nostrUtils = {
    generatePrivateKey,
    getPublicKey,
    getPublicKeyFromBytes,
    parseNsecOrHex,
    parseNpubOrHex,
    hexToNpub,
    hexToNsec,
    npubToHex,
    nsecToHex,
    hexToBytes,
    bytesToHex,
    shortenPubKey,
    shortenNpub,
    generateNonce
};

export { hexToBytes, bytesToHex };
export default nostrUtils;
