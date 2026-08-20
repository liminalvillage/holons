// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// End-to-end key pairing: Telegram-held signing key → kiosk session.
//
// The user's Nostr key is generated CLIENT-SIDE inside our Telegram Mini App
// (routes/key) and lives in their Telegram CloudStorage — per-user, per-bot,
// reachable from any device where they hold the Telegram account. No server
// (ours included) can derive or read it; there is no derivation secret.
//
// To sign on the kiosk, the key travels one hop, sealed end-to-end:
//
//   kiosk                                   user's phone (Mini App)
//   ─────                                   ───────────────────────
//   ephemeral secp256k1 keypair
//   QR deep-link  t.me/<bot>/<app>?startapp=v1-<channel>-<kioskPub>
//                                    ──▶    reads start_param
//                                           key ← CloudStorage (or generate)
//                                           ECDH(sender eph, kioskPub)
//                                           → HKDF-SHA256 → AES-256-GCM
//                                           envelope → global `key_pairing`
//   polls channel  ◀──
//   ECDH(kiosk eph, senderPub) → decrypt
//   hs.login(key) — in-memory only, never persisted on the shared device
//
// The channel (a Holosphere global lens) is public but carries only
// ciphertext; without the kiosk's ephemeral private key — which never leaves
// the kiosk's memory — an envelope is useless, and each channel id is
// single-use random. Envelopes are deleted after pickup and ignored past
// PAIRING_TTL_MS.

import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils";

/** Global lens the sealed envelopes travel through. */
export const PAIRING_LENS = "key_pairing";
/** Envelopes older than this are stale — never accepted, safe to purge. */
export const PAIRING_TTL_MS = 5 * 60 * 1000;

const HKDF_INFO = "holons-key-pairing-v1";

export interface Ephemeral {
  privHex: string;
  /** Compressed (33-byte) hex public key. */
  pubHex: string;
}

/** One sealed key envelope as it sits on the pairing channel. */
export interface PairingEnvelope {
  /** = channel id; the lens key the kiosk polls. */
  id: string;
  /** Sender's ephemeral compressed pubkey (hex). */
  senderPub: string;
  /** AES-GCM iv (hex, 12 bytes). */
  iv: string;
  /** AES-GCM ciphertext+tag (hex). */
  ct: string;
  /** Sender's claimed Telegram user id — a UX crosscheck, not proof. */
  telegramId?: string;
  created: string;
}

/** Fresh ephemeral secp256k1 keypair for one pairing attempt. */
export function generateEphemeral(): Ephemeral {
  const priv = secp256k1.utils.randomPrivateKey();
  return {
    privHex: bytesToHex(priv),
    pubHex: bytesToHex(secp256k1.getPublicKey(priv, true)),
  };
}

/** Random single-use channel id (32 hex chars). */
export function newChannelId(): string {
  return bytesToHex(randomBytes(16));
}

/**
 * ECDH → HKDF-SHA256 → AES-256-GCM key. The shared secret is the x-coordinate
 * of the ECDH point (libsecp convention: drop the parity byte of the
 * compressed shared point).
 */
async function deriveAesKey(
  privHex: string,
  otherPubHex: string,
): Promise<CryptoKey> {
  const point = secp256k1.getSharedSecret(privHex, otherPubHex, true);
  const keyBytes = hkdf(sha256, point.subarray(1), undefined, HKDF_INFO, 32);
  return crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Sender side (Mini App): seal `secretHex` to the kiosk's ephemeral pubkey.
 * A fresh sender ephemeral per envelope — nothing links two pairings.
 */
export async function sealKey(
  secretHex: string,
  kioskPubHex: string,
  channelId: string,
  telegramId?: string,
): Promise<PairingEnvelope> {
  const sender = generateEphemeral();
  const aes = await deriveAesKey(sender.privHex, kioskPubHex);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aes,
    hexToBytes(secretHex) as BufferSource,
  );
  return {
    id: channelId,
    senderPub: sender.pubHex,
    iv: bytesToHex(iv),
    ct: bytesToHex(new Uint8Array(ct)),
    ...(telegramId ? { telegramId: String(telegramId) } : {}),
    created: new Date().toISOString(),
  };
}

/**
 * Kiosk side: open an envelope with the pairing's ephemeral private key.
 * Returns the secret key hex, or null when the envelope is stale, malformed,
 * or sealed to a different key (GCM authentication fails).
 */
export async function openKey(
  privHex: string,
  envelope: PairingEnvelope,
): Promise<string | null> {
  try {
    if (Date.now() - Date.parse(envelope.created) > PAIRING_TTL_MS) return null;
    const aes = await deriveAesKey(privHex, envelope.senderPub);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: hexToBytes(envelope.iv) as BufferSource },
      aes,
      hexToBytes(envelope.ct) as BufferSource,
    );
    return bytesToHex(new Uint8Array(pt));
  } catch {
    return null;
  }
}

// ── Deep-link payload ────────────────────────────────────────────────────────
// Telegram `startapp` accepts only [A-Za-z0-9_-], max 512 chars — hex fields
// joined by dashes fit natively, no base64 needed.

export function buildStartParam(
  channelId: string,
  kioskPubHex: string,
): string {
  return `v1-${channelId}-${kioskPubHex}`;
}

export function parseStartParam(
  raw: string | undefined | null,
): { channelId: string; kioskPub: string } | null {
  if (!raw) return null;
  const m = /^v1-([0-9a-f]{32})-([0-9a-f]{66})$/.exec(raw.trim());
  return m ? { channelId: m[1], kioskPub: m[2] } : null;
}

/** `miniapp` is "<botUsername>/<appShortName>", e.g. "HolonsBot/keys". */
export function buildDeepLink(miniapp: string, startParam: string): string {
  return `https://t.me/${miniapp}?startapp=${startParam}`;
}
