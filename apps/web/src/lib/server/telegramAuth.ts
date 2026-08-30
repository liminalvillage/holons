// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Server-side Telegram authentication for holons-web — OpenID Connect.
//
// Telegram runs a standard OIDC provider at https://oauth.telegram.org (set up
// via BotFather → Bot Settings → Web Login, which issues a client_id +
// client_secret). We use the Authorization Code flow with PKCE:
//   1. /login redirects the browser to Telegram's authorization_endpoint,
//   2. Telegram redirects back to /callback with an auth code,
//   3. we exchange the code (server-side, client_secret_basic) for an id_token,
//   4. verify the id_token signature against Telegram's JWKS,
//   5. mint our own OIDC-style JWT session cookie and derive a per-user Nostr
//      signing key from a server secret (so each user has a stable private
//      HoloSphere identity without managing keys).
//
// The same session cookie also serves key-based logins (passkey / Nostr key /
// Ethereum wallet): those prove key ownership via NIP-98 (/api/auth/key) and
// get a `nostr:<pubkey>` subject instead of a Telegram profile.
//
// Discovery: https://oauth.telegram.org/.well-known/openid-configuration
// Lives under $lib/server, so SvelteKit guarantees it is never bundled into the
// client — the client secret and other secrets stay server-side.

import { env } from "$env/dynamic/private";
import { schnorr } from "@noble/curves/secp256k1";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";

export interface TelegramProfile {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

// --- Telegram OIDC provider (from the discovery document) ---
const TG_ISSUER = "https://oauth.telegram.org";
const TG_AUTH_ENDPOINT = "https://oauth.telegram.org/auth";
const TG_TOKEN_ENDPOINT = "https://oauth.telegram.org/token";
const TG_JWKS_URI = "https://oauth.telegram.org/.well-known/jwks.json";
const TG_JWKS = createRemoteJWKSet(new URL(TG_JWKS_URI));
export const OIDC_SCOPE = "openid profile";

// --- Our own session ---
export const SESSION_COOKIE = "holons_session";
// Sessions slide: /api/auth/session re-mints the cookie on every restore, so
// this is the maximum *absence* before re-login, not a hard cap on session age.
export const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days
const SESSION_ISSUER = "holons";
const SESSION_AUDIENCE = "holons-web";
const enc = new TextEncoder();

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  jwtSecret: string;
  derivationSecret: string;
}

/** Read auth config from private env (server-only, sourced from root .env). */
export function authConfig(): AuthConfig {
  // .trim() guards against a trailing newline/space pasted into the env var —
  // a non-empty-but-wrong secret would otherwise fail as invalid_client.
  return {
    clientId: (env.TELEGRAM_OIDC_CLIENT_ID || "").trim(),
    clientSecret: (env.TELEGRAM_OIDC_CLIENT_SECRET || "").trim(),
    jwtSecret: (env.AUTH_JWT_SECRET || "").trim(),
    derivationSecret: (env.NOSTR_DERIVATION_SECRET || "").trim(),
  };
}

// ---------------------------------------------------------------------------
// PKCE + authorization request
// ---------------------------------------------------------------------------

/** Generate a PKCE verifier and its S256 challenge. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Opaque random value to bind the request to the callback (CSRF defense). */
export function generateState(): string {
  return randomBytes(16).toString("base64url");
}

/** Build the Telegram authorization URL the browser is redirected to. */
export function buildAuthorizationUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const u = new URL(TG_AUTH_ENDPOINT);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", opts.scope ?? OIDC_SCOPE);
  u.searchParams.set("state", opts.state);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  // Telegram's scope parser treats "+" literally, so a "+"-encoded space breaks
  // the openid scope (the token response then omits id_token). URLSearchParams
  // encodes spaces as "+", so force "%20". Other params are base64url/digits/a
  // URL with no literal spaces, so this only rewrites the scope separator.
  return u.toString().replace(/\+/g, "%20");
}

// ---------------------------------------------------------------------------
// Code exchange + id_token verification
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for an id_token, verify it against Telegram's
 * JWKS, and return the trusted profile. Throws on any failure.
 */
export async function exchangeCodeForProfile(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
}): Promise<TelegramProfile> {
  // client_secret_post: credentials in the form body. Telegram lists
  // client_secret_basic as supported too, but in practice rejects it with
  // invalid_client — the working flow passes client_id/secret in the body.
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });

  const res = await fetch(TG_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Token exchange failed (${res.status}): ${detail.slice(0, 200)}`,
    );
  }

  const tokens = (await res.json()) as {
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokens.id_token) {
    const detail = tokens.error
      ? `${tokens.error}${tokens.error_description ? `: ${tokens.error_description}` : ""}`
      : `fields: ${Object.keys(tokens).join(", ")}`;
    throw new Error(`Token response has no id_token (${detail})`);
  }

  return verifyIdToken(tokens.id_token, opts.clientId);
}

/** Verify a Telegram id_token signature + iss/aud and map OIDC claims. */
export async function verifyIdToken(
  idToken: string,
  clientId: string,
): Promise<TelegramProfile> {
  const { payload } = await jwtVerify(idToken, TG_JWKS, {
    issuer: TG_ISSUER,
    audience: clientId,
  });
  // Telegram's id_token carries the numeric Bot-API user id in a non-standard
  // `id` claim; the standard `sub` is a separate opaque subject identifier.
  // We namespace each holon by the Telegram user id (so it matches the user's
  // pre-existing data and the bot's view of them), so read `id` — never `sub`.
  // Fall back to `sub` only if `id` is somehow absent.
  const telegramId = (payload.id as string | number | undefined) ?? payload.sub;
  if (telegramId == null) throw new Error("id_token missing id/sub");
  return {
    id: String(telegramId),
    // OIDC `profile` scope: name (full), preferred_username, picture.
    first_name: (payload.name as string | undefined) ?? undefined,
    username: (payload.preferred_username as string | undefined) ?? undefined,
    photo_url: (payload.picture as string | undefined) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Per-user Nostr signing key (HoloSphere signing layer)
// ---------------------------------------------------------------------------

/**
 * Deterministically derive a Nostr keypair for a Telegram user.
 * key = HMAC-SHA256(derivationSecret, "telegram:<id>"), re-hashed with a counter
 * on the (astronomically unlikely) chance the scalar is out of range. Stable
 * across devices/sessions; the secret never leaves the server.
 */
export function deriveNostrKey(
  telegramId: string | number,
  derivationSecret: string,
): { privateKey: string; publicKey: string } {
  if (!derivationSecret)
    throw new Error("NOSTR_DERIVATION_SECRET is not configured");
  const secretBytes = enc.encode(derivationSecret);

  for (let i = 0; i < 1000; i++) {
    const msg = `telegram:${telegramId}` + (i ? `:${i}` : "");
    const candidate = hmac(sha256, secretBytes, enc.encode(msg));
    try {
      const publicKey = bytesToHex(schnorr.getPublicKey(candidate));
      return { privateKey: bytesToHex(candidate), publicKey };
    } catch {
      // out-of-range scalar — try next counter
    }
  }
  throw new Error("failed to derive a valid Nostr key");
}

// ---------------------------------------------------------------------------
// Session cookie (our own OIDC-style JWT)
// ---------------------------------------------------------------------------

/** The JSON body returned to the client after a successful login/restore. */
export interface AuthResult {
  user: TelegramProfile;
  nostrPublicKey: string;
  /** The user's own derived signing key — delivered over HTTPS for HoloSphere. */
  nostrPrivateKey: string;
}

/** Derive the signing key for a verified profile and shape the client response. */
export function buildAuthResult(
  profile: TelegramProfile,
  derivationSecret: string,
): AuthResult {
  const { privateKey, publicKey } = deriveNostrKey(
    profile.id,
    derivationSecret,
  );
  return {
    user: profile,
    nostrPublicKey: publicKey,
    nostrPrivateKey: privateKey,
  };
}

/** Cookie options shared by the set/clear paths. `secure` is decided per-request. */
export function sessionCookieOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    maxAge: SESSION_TTL_S,
  };
}

/** Short-lived cookie options for the transient PKCE/state during the redirect. */
export function transientCookieOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    maxAge: 600, // 10 minutes to complete the round-trip
  };
}

/** Mint the OIDC-style session JWT (HS256). */
export async function mintSession(
  profile: TelegramProfile,
  jwtSecret: string,
): Promise<string> {
  if (!jwtSecret) throw new Error("AUTH_JWT_SECRET is not configured");
  const claims = {
    id: profile.id,
    first_name: profile.first_name,
    last_name: profile.last_name,
    username: profile.username,
    photo_url: profile.photo_url,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(`telegram:${profile.id}`)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(enc.encode(jwtSecret));
}

/**
 * Mint a session for a key-based identity (passkey / Nostr key / Ethereum
 * wallet). The browser proved key ownership with a NIP-98 event; the session
 * carries only the pubkey and the provider — there is no server-derived
 * secret for these users.
 */
export async function mintKeySession(
  identity: { pubkey: string; provider: KeyProvider },
  jwtSecret: string,
): Promise<string> {
  if (!jwtSecret) throw new Error("AUTH_JWT_SECRET is not configured");
  if (!/^[0-9a-f]{64}$/.test(identity.pubkey))
    throw new Error("mintKeySession: pubkey must be 64-char hex");
  return new SignJWT({ provider: identity.provider })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(`nostr:${identity.pubkey}`)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(enc.encode(jwtSecret));
}

export type KeyProvider = "passkey" | "nostr" | "ethereum";

/** Who a session cookie belongs to: a Telegram profile or a bare Nostr key. */
export type SessionIdentity =
  | { kind: "telegram"; profile: TelegramProfile }
  | { kind: "key"; pubkey: string; provider: KeyProvider };

/** Verify our session JWT and return whoever it belongs to, or null. */
export async function verifySessionIdentity(
  token: string | undefined | null,
  jwtSecret: string,
): Promise<SessionIdentity | null> {
  if (!token || !jwtSecret) return null;
  try {
    const { payload } = await jwtVerify(token, enc.encode(jwtSecret), {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    const sub = String(payload.sub ?? "");
    if (sub.startsWith("nostr:")) {
      const pubkey = sub.slice("nostr:".length);
      if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
      const provider = payload.provider as string | undefined;
      return {
        kind: "key",
        pubkey,
        provider:
          provider === "passkey" || provider === "ethereum"
            ? provider
            : "nostr",
      };
    }
    const id =
      typeof payload.id === "string"
        ? payload.id
        : sub.replace(/^telegram:/, "");
    if (!id) return null;
    return {
      kind: "telegram",
      profile: {
        id,
        first_name: payload.first_name as string | undefined,
        last_name: payload.last_name as string | undefined,
        username: payload.username as string | undefined,
        photo_url: payload.photo_url as string | undefined,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Verify our session JWT and return the trusted Telegram profile, or null.
 * Key-based sessions yield null here — use {@link verifySessionIdentity} when
 * any signed-in identity will do.
 */
export async function verifySession(
  token: string | undefined | null,
  jwtSecret: string,
): Promise<TelegramProfile | null> {
  const identity = await verifySessionIdentity(token, jwtSecret);
  return identity?.kind === "telegram" ? identity.profile : null;
}
