// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Server-side Telegram authentication for the kiosk — OpenID Connect.
//
// Telegram runs a standard OIDC provider at https://oauth.telegram.org (set up
// via BotFather → Bot Settings → Web Login). The kiosk only needs to *identify*
// the editor (writes are signed by the kiosk's own device key; the user is
// recorded via `actingAs`), so this is the identity half of the web app's flow
// with no Nostr key derivation:
//   /login   → redirect to Telegram (Authorization Code + PKCE)
//   /callback → exchange code (client_secret_basic), verify id_token vs JWKS,
//               mint a session cookie scoped to the hub domain
//   /session → return the verified profile (or a dev user in non-prod)
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
export const SESSION_COOKIE = "kiosk_session";
export const SESSION_TTL_S = 7 * 24 * 60 * 60; // 7 days
const SESSION_ISSUER = "holons-kiosk";
const SESSION_AUDIENCE = "holons-kiosk";
const enc = new TextEncoder();

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  jwtSecret: string;
}

/** Read auth config from private env (server-only, sourced from root .env). */
export function authConfig(): AuthConfig {
  return {
    clientId: env.TELEGRAM_OIDC_CLIENT_ID || "",
    clientSecret: env.TELEGRAM_OIDC_CLIENT_SECRET || "",
    jwtSecret: env.AUTH_JWT_SECRET || "",
  };
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
  if (!payload.sub) throw new Error("id_token missing sub");
  return {
    id: String(payload.sub),
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

export function transientCookieOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    maxAge: 600,
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
