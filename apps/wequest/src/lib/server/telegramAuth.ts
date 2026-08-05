// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Server-side Telegram authentication for WeQuest — OpenID Connect (ported from the kiosk).
//
// Telegram runs a standard OIDC provider at https://oauth.telegram.org (set up
// via BotFather → Bot Settings → Web Login). WeQuest only needs to *identify*
// the editor (writes are signed by the app's own device key; the user is
// recorded via `actingAs`), so this is the identity half of the web app's flow
// with no Nostr key derivation:
//   /login   → redirect to Telegram (Authorization Code + PKCE)
//   /callback → exchange code (client_secret_post), verify id_token vs JWKS,
//               mint a session cookie scoped to .hubs.network
//   /session → return the verified profile (or a dev user in non-prod)
//
// Multi-tenant: all subdomains route through one canonical callback origin
// (TELEGRAM_OIDC_CALLBACK_ORIGIN) so only ONE redirect_uri is registered in
// BotFather; the session cookie is .hubs.network-wide and we bounce the user
// back to their originating subdomain.
//
// Lives under $lib/server, so SvelteKit never bundles it into the client.

import { env } from "$env/dynamic/private";
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
const TG_JWKS = createRemoteJWKSet(
  new URL("https://oauth.telegram.org/.well-known/jwks.json"),
);
export const OIDC_SCOPE = "openid profile";

// --- Our own session ---
export const SESSION_COOKIE = "wequest_session";
// Sessions slide: /api/auth/session re-mints the cookie on every restore, so
// this is the maximum *absence* before re-login, not a hard cap on session age.
export const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days
const SESSION_ISSUER = "holons-wequest";
const SESSION_AUDIENCE = "holons-wequest";
const enc = new TextEncoder();

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  jwtSecret: string;
  /**
   * Single canonical callback origin for the multi-tenant flow, e.g.
   * "https://hubs.network". Every tenant subdomain routes its OIDC round-trip
   * through this one host (so only ONE redirect_uri must be registered in
   * BotFather), then we bounce the user back to their originating subdomain.
   * Empty in local dev → falls back to the request origin (single host).
   */
  callbackOrigin: string;
}

/** Read auth config from private env (server-only, sourced from root .env). */
export function authConfig(): AuthConfig {
  // .trim() guards against a trailing newline/space pasted into the env var —
  // a non-empty-but-wrong secret would otherwise fail as invalid_client.
  return {
    clientId: (env.TELEGRAM_OIDC_CLIENT_ID || "").trim(),
    clientSecret: (env.TELEGRAM_OIDC_CLIENT_SECRET || "").trim(),
    jwtSecret: (env.AUTH_JWT_SECRET || "").trim(),
    callbackOrigin: (env.TELEGRAM_OIDC_CALLBACK_ORIGIN || "")
      .trim()
      .replace(/\/$/, ""),
  };
}

/**
 * Whether `origin` is a safe place to redirect the user back to after login
 * (prevents the return cookie from being used as an open redirect): any
 * hubs.network host over https, or localhost in dev.
 */
export function isAllowedReturnOrigin(
  origin: string | undefined | null,
): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const h = u.hostname;
    const isHub = h === "hubs.network" || h.endsWith(".hubs.network");
    const isLocal = h === "localhost" || h === "127.0.0.1";
    return (u.protocol === "https:" && isHub) || isLocal;
  } catch {
    return false;
  }
}

// --- PKCE + authorization request ---

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(16).toString("base64url");
}

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

// --- Code exchange + id_token verification ---

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
  // We record this user as the actor by their Telegram user id so it matches
  // the bot's and web app's view of them (e.g. quest participants) — so read
  // `id`, never `sub`. Fall back to `sub` only if `id` is somehow absent.
  const telegramId = (payload.id as string | number | undefined) ?? payload.sub;
  if (telegramId == null) throw new Error("id_token missing id/sub");
  return {
    id: String(telegramId),
    first_name: (payload.name as string | undefined) ?? undefined,
    username: (payload.preferred_username as string | undefined) ?? undefined,
    photo_url: (payload.picture as string | undefined) ?? undefined,
  };
}

// --- Session cookie (our own JWT) ---

/**
 * Cookie domain for the request host: `.hubs.network` for any hub subdomain so
 * the session is shared across tenants; undefined for localhost/previews.
 */
export function cookieDomain(hostname: string): string | undefined {
  return hostname === "hubs.network" || hostname.endsWith(".hubs.network")
    ? ".hubs.network"
    : undefined;
}

export function sessionCookieOptions(secure: boolean, domain?: string) {
  return {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    maxAge: SESSION_TTL_S,
    ...(domain ? { domain } : {}),
  };
}

export function transientCookieOptions(secure: boolean, domain?: string) {
  return {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    maxAge: 600,
    ...(domain ? { domain } : {}),
  };
}

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

export async function verifySession(
  token: string | undefined | null,
  jwtSecret: string,
): Promise<TelegramProfile | null> {
  if (!token || !jwtSecret) return null;
  try {
    const { payload } = await jwtVerify(token, enc.encode(jwtSecret), {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    const id =
      typeof payload.id === "string"
        ? payload.id
        : String(payload.sub).replace(/^telegram:/, "");
    if (!id) return null;
    return {
      id,
      first_name: payload.first_name as string | undefined,
      last_name: payload.last_name as string | undefined,
      username: payload.username as string | undefined,
      photo_url: payload.photo_url as string | undefined,
    };
  } catch {
    return null;
  }
}
