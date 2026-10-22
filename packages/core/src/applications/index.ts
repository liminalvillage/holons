// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @holons/core/applications
 *
 * Community applications — the form a person fills to join a holon (Liminal
 * Village's /apply on the web, `/apply` with the bot). An application holds
 * an e-mail address and wellbeing answers, so the holon keeps it in its
 * `applications` lens SEALED: the lens is locked (see @holons/core/privacy)
 * with the holon itself as the audience, so its members read it and nobody
 * else does. `storeApplication` never writes in the clear: if the lens is not
 * private with a key this identity holds, it throws `ApplicationsNotSealedError`
 * before anything reaches the wire.
 *
 * The record's `data` uses the storage keys of the bot's form
 * (packages/telegram-ui/data/booking.json): selections as option values
 * (a list for a multi-choice question, a string for a single choice) and an
 * "Other" answer's free text in `<key>_other`.
 */

import type { HoloSphere } from 'holosphere';
import { isLocked, lock } from '../privacy/audience.js';
import type { Scope } from '../privacy/types.js';

export const APPLICATIONS_LENS = 'applications';
/** Liminal Village: the holon web applications go to unless told otherwise. */
export const DEFAULT_APPLICATIONS_HOLON = '-1003864542239';
/** The largest web application accepted, serialized (relays cap events near 64 KB). */
export const MAX_APPLICATION_BYTES = 64 * 1024;

/** `data` keys whose value is a list of option values. */
export const APPLICATION_LIST_KEYS: readonly string[] = Object.freeze(['role', 'transportation', 'tasks']);

/** `data` keys whose value is text (or a single option value). */
export const APPLICATION_TEXT_KEYS: readonly string[] = Object.freeze([
  'email',
  'name',
  'location',
  'age_range',
  'x',
  'linkedin',
  'website',
  'role_other',
  'intention',
  'ikigai',
  'background',
  'community_experience',
  'wellbeing',
  'referral',
  'visit',
  'arrival',
  'departure',
  'transportation_other',
  'drivers_license',
  'accommodation',
  'watched',
  'tasks_other',
  'contribution_preference',
  'contribution_preference_other',
  'capacity',
  'social_links',
  'public_profile',
]);

/**
 * The answers an applicant may put on their public profile (the DNA record
 * in their own holon, `<telegram id>/dna/<telegram id>`), when they say so.
 */
export const PROFILE_KEYS: readonly string[] = Object.freeze(['ikigai', 'linkedin']);

export type ApplicationData = Record<string, string | string[]>;

/** An application as the holon keeps it (web-born; the bot's own adds Telegram fields). */
export interface WebApplication {
  id: string;
  submittedAt: string;
  source: 'web';
  status: 'submitted';
  email: string;
  name: string;
  data: ApplicationData;
  /**
   * Present when the applicant asked for their ikigai and LinkedIn on their
   * public profile: the secret their `/start profile_<token>` link carries.
   * The web never knows their Telegram id, so the bot learns whose profile
   * it is only when they open that link. Dropped once redeemed.
   */
  profileClaim?: string;
}

export type ParseResult =
  | { ok: true; record: WebApplication }
  | { ok: false; status: 400 | 413; error: string };

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** 16–43 base64url characters: at least 96 random bits, and short enough for a 64-character `/start` payload. */
const PROFILE_CLAIM_RE = /^[A-Za-z0-9_-]{16,43}$/;
/** The `/start` payload that redeems a profile claim: `profile_<token>`. */
export const PROFILE_CLAIM_PREFIX = 'profile_';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 10_000;
const MAX_ITEMS = 50;
const MAX_ITEM = 500;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const bad = (error: string): ParseResult => ({ ok: false, status: 400, error });

/**
 * Validate a web application as it arrives over HTTP. Unknown keys, at the
 * top level and in `data`, are dropped; a wrong type is an error.
 */
export function parseWebApplication(input: unknown): ParseResult {
  if (!isPlainObject(input)) return bad('the body must be a JSON object');
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(input)).length;
  } catch {
    return bad('the body is not serializable');
  }
  if (size > MAX_APPLICATION_BYTES) return { ok: false, status: 413, error: `an application is at most ${MAX_APPLICATION_BYTES} bytes` };

  const { id, submittedAt, source, status, email, name, data, profileClaim } = input;
  if (typeof id !== 'string' || !ID_RE.test(id)) return bad('id must be 1–128 characters of A-Z a-z 0-9 . _ : -');
  if (typeof submittedAt !== 'string' || Number.isNaN(Date.parse(submittedAt))) return bad('submittedAt must be an ISO date');
  if (source !== 'web') return bad("source must be 'web'");
  if (status !== 'submitted') return bad("status must be 'submitted'");
  if (typeof email !== 'string' || email.length > 320 || !EMAIL_RE.test(email.trim())) return bad('email must be an e-mail address');
  if (typeof name !== 'string' || !name.trim() || name.length > 200) return bad('name is required (at most 200 characters)');
  if (!isPlainObject(data)) return bad('data must be an object');
  if (profileClaim !== undefined && (typeof profileClaim !== 'string' || !PROFILE_CLAIM_RE.test(profileClaim))) {
    return bad('profileClaim must be 16–43 characters of A-Z a-z 0-9 _ -');
  }

  const out: ApplicationData = {};
  for (const key of APPLICATION_LIST_KEYS) {
    const v = data[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length > MAX_ITEMS || !v.every((x) => typeof x === 'string' && x.length <= MAX_ITEM)) {
      return bad(`data.${key} must be a list of at most ${MAX_ITEMS} strings`);
    }
    out[key] = [...v];
  }
  for (const key of APPLICATION_TEXT_KEYS) {
    const v = data[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length > MAX_TEXT) return bad(`data.${key} must be a string of at most ${MAX_TEXT} characters`);
    out[key] = v;
  }

  const record: WebApplication = { id, submittedAt, source, status, email: email.trim(), name: name.trim(), data: out };
  if (profileClaim !== undefined) record.profileClaim = profileClaim;
  return { ok: true, record };
}

/** The lens could not be made private (or no key is held for it): nothing was written. */
export class ApplicationsNotSealedError extends Error {
  constructor(holon: string, reason?: string) {
    super(`applications of ${holon} are not sealed${reason ? `: ${reason}` : ''} — refusing to write in the clear`);
    this.name = 'ApplicationsNotSealedError';
  }
}

const inFlight = new WeakMap<object, Map<string, Promise<void>>>();

/**
 * Make sure the holon's `applications` lens is private and this identity
 * holds its key: lock it (audience: the holon itself) when it is public.
 * Idempotent; concurrent calls share one lock.
 */
export function ensureApplicationsSealed(hs: HoloSphere, holon: string): Promise<void> {
  let byHolon = inFlight.get(hs);
  if (!byHolon) inFlight.set(hs, (byHolon = new Map()));
  const running = byHolon.get(holon);
  if (running) return running;
  const scope: Scope = { holon, lens: APPLICATIONS_LENS };
  const p = (async () => {
    try {
      if (!(await isLocked(hs, scope))) await lock(hs, scope);
    } catch (err) {
      throw new ApplicationsNotSealedError(holon, (err as Error)?.message);
    }
    if (!(await isLocked(hs, scope))) throw new ApplicationsNotSealedError(holon, 'the lens is still public after locking');
    if (!hs.privacy?.holdsKey(scope)) throw new ApplicationsNotSealedError(holon, 'the lens is private but this identity holds no key for it');
  })().finally(() => byHolon.delete(holon));
  byHolon.set(holon, p);
  return p;
}

/**
 * Keep an application in the holon's sealed `applications` lens, under its
 * own id. A repeated id leaves the stored record as it is (a steward may have
 * moved it on) and answers `{ created: false }`.
 */
export async function storeApplication(
  hs: HoloSphere,
  holon: string,
  record: { id: string } & Record<string, unknown>,
): Promise<{ created: boolean }> {
  await ensureApplicationsSealed(hs, holon);
  const existing = await hs.get(holon, APPLICATIONS_LENS, record.id);
  if (existing) return { created: false };
  await hs.put(holon, APPLICATIONS_LENS, record);
  return { created: true };
}

/** The claim token in a `/start profile_<token>` payload, or null. */
export function parseProfileClaimPayload(payload: string | null | undefined): string | null {
  const raw = String(payload ?? '').trim();
  if (!raw.startsWith(PROFILE_CLAIM_PREFIX)) return null;
  const token = raw.slice(PROFILE_CLAIM_PREFIX.length);
  return PROFILE_CLAIM_RE.test(token) ? token : null;
}

/** The profile fields an application's answers hold (only those answered). */
export function profileFromApplication(data: ApplicationData | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PROFILE_KEYS) {
    const v = data?.[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim();
  }
  return out;
}

/**
 * The application whose profile claim is `token`, with its profile fields,
 * or null for an unknown or spent token.
 */
export async function findProfileClaim(
  hs: HoloSphere,
  holon: string,
  token: string,
): Promise<{ application: WebApplication & Record<string, unknown>; profile: Record<string, string> } | null> {
  if (!PROFILE_CLAIM_RE.test(token)) return null;
  await ensureApplicationsSealed(hs, holon);
  const all = ((await hs.getAll(holon, APPLICATIONS_LENS)) ?? []) as Array<WebApplication & Record<string, unknown>>;
  const application = all.find((a) => a && typeof a.profileClaim === 'string' && a.profileClaim === token);
  return application ? { application, profile: profileFromApplication(application.data) } : null;
}

/**
 * Spend a claim once its profile is written: drop the token so the link
 * works once, and note who redeemed it. The application stays sealed.
 */
export async function spendProfileClaim(
  hs: HoloSphere,
  holon: string,
  application: WebApplication & Record<string, unknown>,
  claimedBy: string | number,
): Promise<void> {
  await ensureApplicationsSealed(hs, holon);
  const { profileClaim: _spent, ...rest } = application;
  await hs.put(holon, APPLICATIONS_LENS, { ...rest, profileClaimedBy: String(claimedBy), profileClaimedAt: new Date().toISOString() });
}
