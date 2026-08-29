// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Passkey sign-in via the WebAuthn PRF extension.
//
// No server-side credential store: the authenticator evaluates
// HMAC(credential secret, PASSKEY_PRF_SALT) and hands back 32 bytes that are
// stable for the life of the passkey. Those bytes become the user's Nostr key
// (core `deriveNostrKeyFromEntropy`). Passkeys are bound to the rpId
// (hostname), so localhost and production yield different identities.

import { browser } from "$app/environment";
import { PASSKEY_PRF_SALT, deriveNostrKeyFromEntropy } from "@holons/core/auth";
import { AuthUiError, isAbort, type ProviderLogin } from "./types";

const CRED_KEY = "holons_passkey_cred";

type PrfResults = {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
};

export function isPasskeySupported(): boolean {
  return (
    browser &&
    typeof PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.get === "function" &&
    window.isSecureContext
  );
}

function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function cachedCredentialId(): Uint8Array | null {
  try {
    const v = localStorage.getItem(CRED_KEY);
    return v ? unb64u(v) : null;
  } catch {
    return null;
  }
}
function cacheCredentialId(raw: ArrayBuffer) {
  try {
    localStorage.setItem(CRED_KEY, b64u(raw));
  } catch {
    /* storage blocked — discoverable credentials still work */
  }
}

/** TS 5.7 types `Uint8Array` over `ArrayBufferLike`; WebAuthn wants a plain `ArrayBuffer`. */
function buf(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(
    u8.byteOffset,
    u8.byteOffset + u8.byteLength,
  ) as ArrayBuffer;
}

function challenge(): ArrayBuffer {
  return buf(crypto.getRandomValues(new Uint8Array(32)));
}
const PRF_SALT = buf(PASSKEY_PRF_SALT);

/** Ask the authenticator for the PRF bytes of an existing passkey. */
async function assert(
  allow?: Uint8Array,
): Promise<{ id: ArrayBuffer; prf: Uint8Array | null }> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge(),
      rpId: location.hostname,
      userVerification: "required",
      allowCredentials: allow ? [{ type: "public-key", id: buf(allow) }] : [],
      extensions: {
        prf: { eval: { first: PRF_SALT } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new AuthUiError("No passkey was returned.", "failed");
  const ext = cred.getClientExtensionResults() as PrfResults;
  const first = ext.prf?.results?.first;
  return { id: cred.rawId, prf: first ? new Uint8Array(first) : null };
}

/** Create a new PRF-capable, discoverable passkey for this site. */
export async function createPasskey(): Promise<void> {
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge(),
      rp: { name: "Holons", id: location.hostname },
      user: { id: buf(userId), name: "holons", displayName: "Holons" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred)
    throw new AuthUiError("Passkey creation was cancelled.", "cancelled");
  const ext = cred.getClientExtensionResults() as PrfResults;
  if (ext.prf && ext.prf.enabled === false) {
    throw new AuthUiError(
      "This passkey can't derive a key (no PRF support). Try another authenticator.",
      "unsupported",
    );
  }
  cacheCredentialId(cred.rawId);
}

/**
 * Sign in with a passkey. Uses the cached credential when one exists,
 * otherwise a discoverable-credential prompt; creates a passkey first when
 * `create` is set (the "I don't have one yet" path).
 */
export async function signInWithPasskey(
  opts: { create?: boolean } = {},
): Promise<ProviderLogin> {
  if (!isPasskeySupported()) {
    throw new AuthUiError(
      "Passkeys aren't available in this browser.",
      "unsupported",
    );
  }
  try {
    if (opts.create) await createPasskey();
    const known = cachedCredentialId();
    let { id, prf } = await assert(known ?? undefined);
    if (!prf && known) {
      // Cached id may belong to a passkey that was deleted; retry discoverable.
      ({ id, prf } = await assert());
    }
    if (!prf) {
      throw new AuthUiError(
        "This browser or passkey doesn't support key derivation (PRF). Try Chrome, Safari 18+, or another sign-in method.",
        "unsupported",
      );
    }
    cacheCredentialId(id);
    const key = deriveNostrKeyFromEntropy(prf, "passkey");
    return {
      ...key,
      identity: {
        provider: "passkey",
        pubkey: key.publicKey,
        subject: b64u(id),
        label: "Passkey",
      },
    };
  } catch (err) {
    if (err instanceof AuthUiError) throw err;
    if (isAbort(err))
      throw new AuthUiError("Passkey prompt was cancelled.", "cancelled");
    throw new AuthUiError(
      (err as Error)?.message || "Passkey sign-in failed.",
      "failed",
    );
  }
}
