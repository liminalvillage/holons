// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Stay signed in on this device": the session key at rest, sealed under a
// PIN (NIP-49, via @holons/core/auth) in localStorage. Opt-in — a kiosk is
// usually a shared screen, where a key that survives a reload is exactly
// what nobody wants — so nothing is written unless the person asks, and
// logging out (or unlinking the key) forgets it. The bare secret never
// touches storage: what sits here opens only with the PIN, and the live key
// still lives in memory only (sessionKey.ts).

import { openSecretKey, sealSecretKey } from "@holons/core/auth";
import type { AuthProvider } from "@holons/core/auth";

export const REMEMBER_KEY = "kiosk_remembered_key";

/** What is kept: the sealed key and enough to greet the person before they unlock it. */
export type RememberedKey = {
  ncryptsec: string;
  pubkey: string;
  provider: Exclude<AuthProvider, "telegram">;
  label?: string;
  /** When it was sealed (ms epoch). */
  at: number;
};

const PROVIDERS = new Set(["passkey", "nostr", "ethereum"]);

/** Parse the persisted note; null when absent or malformed. */
export function parseRememberedKey(raw: string | null): RememberedKey | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RememberedKey>;
    if (
      typeof v.ncryptsec !== "string" ||
      !v.ncryptsec.startsWith("ncryptsec1")
    )
      return null;
    if (typeof v.pubkey !== "string" || !/^[0-9a-f]{64}$/i.test(v.pubkey))
      return null;
    if (typeof v.provider !== "string" || !PROVIDERS.has(v.provider))
      return null;
    if (typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    const out: RememberedKey = {
      ncryptsec: v.ncryptsec,
      pubkey: v.pubkey.toLowerCase(),
      provider: v.provider as RememberedKey["provider"],
      at: v.at,
    };
    if (typeof v.label === "string" && v.label.trim())
      out.label = v.label.trim();
    return out;
  } catch {
    return null;
  }
}

/** The key remembered on this device, if any. */
export function readRememberedKey(): RememberedKey | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const p = parseRememberedKey(localStorage.getItem(REMEMBER_KEY));
    if (!p) localStorage.removeItem(REMEMBER_KEY);
    return p;
  } catch {
    return null;
  }
}

/**
 * Seal `secretHex` under `pin` and keep it. Slow on purpose (about a second
 * at the default work factor); `logn` is for specs.
 */
export function rememberKey(
  secretHex: string,
  pin: string,
  meta: Pick<RememberedKey, "pubkey" | "provider" | "label">,
  opts: { logn?: number; now?: number } = {},
): RememberedKey {
  const rec: RememberedKey = {
    ncryptsec: sealSecretKey(secretHex, pin, opts),
    pubkey: meta.pubkey.toLowerCase(),
    provider: meta.provider,
    at: opts.now ?? Date.now(),
  };
  if (meta.label) rec.label = meta.label;
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(rec));
  } catch {
    /* private mode / quota — it just won't survive a reload */
  }
  return rec;
}

/** The secret key (hex) behind the PIN, or null when the PIN is wrong. */
export function unlockRememberedKey(
  pin: string,
  rec: RememberedKey | null = readRememberedKey(),
): string | null {
  if (!rec) return null;
  return openSecretKey(rec.ncryptsec, pin);
}

/** Forget the sealed key (logout, unlink, "not my device"). */
export function forgetRememberedKey(): void {
  try {
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* ignore */
  }
}
