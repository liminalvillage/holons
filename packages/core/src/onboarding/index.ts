// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Starting a hub from a screen: the claim round trip.
//
// A hub is a Telegram chat — a group, or a person's private chat with the
// bot — so "create a hub" always leaves the screen for Telegram, and Telegram
// has no way to hand anything back. What it CAN do is carry a payload out:
// `t.me/<bot>?startgroup=<payload>` (add the bot to a group) and
// `t.me/<bot>?start=<payload>` (chat with it) both deliver the payload to the
// bot as the chat's first `/start <payload>`.
//
// So the screen mints a one-time CLAIM TOKEN, sends it out in the payload,
// and the bot, on receiving it, records "<token> → this chat" on the relay
// under a well-known namespace. The screen, watching that key, learns the
// hub's id without anyone copying anything. The token is the only secret in
// the loop: random enough that no one guesses it, useless once redeemed.
//
// Pure, store-agnostic: the bot and the kiosk both call in with their own
// holosphere handle.

/** The namespace (holon) the claim records live under. */
export const CLAIM_NAMESPACE = 'hubclaims';
/** The lens inside it. One record per token, keyed by the token. */
export const CLAIM_LENS = 'claims';
/** Payload prefix that tells the bot a `/start` carries a claim token. */
export const CLAIM_PREFIX = 'claim_';
/** A claim older than this is stale: the screen that minted it has moved on. */
export const CLAIM_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Token alphabet and length. Telegram start payloads allow `[A-Za-z0-9_-]`,
 * at most 64 characters; 22 characters of a 64-symbol alphabet is 132 bits.
 */
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const TOKEN_LENGTH = 22;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,48}$/;

/** What kind of chat a claim resolved to. */
export type HubKind = 'group' | 'personal';

/** The record the bot writes: `<token> → this chat`. */
export interface HubClaim {
  /** The token, which is also the record key. */
  id: string;
  /** The holon id — the chat id, as the board keys on it. */
  holon: string;
  kind: HubKind;
  /** The chat's title (a group) or the person's name, when known. */
  name?: string;
  /** When the bot redeemed the token (ms epoch). */
  at: number;
}

/** The slice of a holosphere the claim round trip needs. */
export interface ClaimStore {
  get(holon: string, lens: string, key: string): Promise<unknown>;
  put(holon: string, lens: string, data: object): Promise<unknown>;
}

/** Random bytes; injectable so specs can pin the token. */
export type RandomBytes = (n: number) => Uint8Array;

function defaultRandomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
  if (!c?.getRandomValues) throw new Error('No secure random source available');
  c.getRandomValues(buf);
  return buf;
}

/** Mint a fresh claim token. */
export function newClaimToken(randomBytes: RandomBytes = defaultRandomBytes): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let out = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) out += TOKEN_ALPHABET[bytes[i] & 63];
  return out;
}

/** Is this a token this module could have minted (shape only)? */
export function isClaimToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

/** The `/start` payload that carries a token out to the bot. */
export function claimPayload(token: string): string {
  if (!isClaimToken(token)) throw new Error('Not a claim token');
  return `${CLAIM_PREFIX}${token}`;
}

/**
 * The token a `/start` payload carries, or null when it is not a claim. The
 * whole message text is accepted too (`/start claim_x`, `/start@Bot claim_x`),
 * so a bot handler can pass either.
 */
export function parseClaimPayload(input: string | null | undefined): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const payload = /^\/start(@\S+)?\s+/i.test(raw) ? raw.replace(/^\/start(@\S+)?\s+/i, '').trim() : raw;
  if (!payload.startsWith(CLAIM_PREFIX)) return null;
  const token = payload.slice(CLAIM_PREFIX.length);
  return isClaimToken(token) ? token : null;
}

/** A Telegram chat, as the bot sees it in `ctx.chat`. */
export interface ChatLike {
  id: string | number;
  type?: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/** What a chat claims: its id as the holon, and a name to dock it under. */
export function hubClaimFromChat(chat: ChatLike): Pick<HubClaim, 'holon' | 'kind' | 'name'> {
  const holon = String(chat.id ?? '').trim();
  const kind: HubKind = chat.type === 'private' ? 'personal' : 'group';
  const name =
    kind === 'group'
      ? String(chat.title ?? '').trim()
      : [chat.first_name, chat.last_name]
          .map((s) => String(s ?? '').trim())
          .filter(Boolean)
          .join(' ') || String(chat.username ?? '').trim();
  return name ? { holon, kind, name } : { holon, kind };
}

/** Is `value` a claim record, shape-wise? */
export function isHubClaim(value: unknown): value is HubClaim {
  const c = value as HubClaim;
  return (
    !!c &&
    typeof c === 'object' &&
    isClaimToken(c.id) &&
    typeof c.holon === 'string' &&
    /^-?\d+$/.test(c.holon) &&
    c.holon !== '0' &&
    (c.kind === 'group' || c.kind === 'personal') &&
    typeof c.at === 'number' &&
    Number.isFinite(c.at) &&
    (c.name === undefined || typeof c.name === 'string')
  );
}

/** A claim the screen should still honour: recent, and not from the future. */
export function isFreshClaim(claim: HubClaim, now = Date.now(), maxAgeMs = CLAIM_MAX_AGE_MS): boolean {
  return claim.at <= now + 60_000 && now - claim.at <= maxAgeMs;
}

/**
 * The bot's half: redeem `token` for `chat`. Writes the claim record; the
 * screen that minted the token is watching for it. A malformed token or a
 * chat without a usable id is refused (returns null) rather than written.
 */
export async function recordHubClaim(
  store: ClaimStore,
  token: string,
  chat: ChatLike,
  now = Date.now(),
): Promise<HubClaim | null> {
  if (!isClaimToken(token)) return null;
  const claim: HubClaim = { id: token, ...hubClaimFromChat(chat), at: now };
  if (!isHubClaim(claim)) return null;
  await store.put(CLAIM_NAMESPACE, CLAIM_LENS, claim);
  return claim;
}

/**
 * The screen's half: the claim for `token`, or null when the bot has not
 * redeemed it yet (or redeemed it too long ago to trust).
 */
export async function readHubClaim(
  store: ClaimStore,
  token: string,
  opts: { now?: number; maxAgeMs?: number } = {},
): Promise<HubClaim | null> {
  if (!isClaimToken(token)) return null;
  const raw = await store.get(CLAIM_NAMESPACE, CLAIM_LENS, token);
  return claimFor(raw, token, opts);
}

/**
 * Filter one record (a read, or a subscription emission) down to the claim
 * for `token`, or null. Shared by `readHubClaim` and live watchers.
 */
export function claimFor(
  raw: unknown,
  token: string,
  opts: { now?: number; maxAgeMs?: number } = {},
): HubClaim | null {
  if (!isHubClaim(raw) || raw.id !== token) return null;
  return isFreshClaim(raw, opts.now, opts.maxAgeMs) ? raw : null;
}
