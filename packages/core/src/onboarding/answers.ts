// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A newcomer's answers to a holon's OWN questions (its `sealed` profile
// fields: how they hope to contribute, their wellbeing, their e-mail…) are
// the holon's business and theirs, not their public profile. They live in
// the person's holon — where their key counts before they are linked — as
// ONE record per holon asking, `<home>/answers/<holon>`, and that record is
// SEALED (`@holons/core/privacy`): its scope is locked with the person's
// holon and the holon's admins as its audience, so the person and those
// admins read it, nobody else does.
//
// Nothing is ever written in the clear: when the record cannot be sealed
// (the privacy layer refuses, or this identity holds no key for it) the
// write throws `AnswersNotSealedError` before anything reaches the wire —
// the rule the web application intake keeps for its applications.

import type { HoloSphere } from 'holosphere';
import { resolveHolonAuthority } from '../holosphere/authority.js';
import { audience, isLocked, lock, share } from '../privacy/audience.js';
import type { Scope } from '../privacy/types.js';
import { holonMembers } from '../protocol/founding.js';
import { isSealedField, readProfile, saveProfile, type OnboardingProfile, type ProfileField } from './profile.js';

/** The lens a person's sealed answers live in, one record per holon asking. */
export const ANSWERS_LENS = 'answers';

/** What one holon's questions were answered with. */
export interface SealedAnswers {
  /** The holon that asked. */
  id: string;
  answers: Record<string, string | string[]>;
  /** ISO time of the last answer. */
  updated: string;
}

/** The record could not be sealed (or this identity holds no key for it): nothing was written. */
export class AnswersNotSealedError extends Error {
  readonly home: string;
  readonly holon: string;
  constructor(home: string, holon: string, reason?: string) {
    super(`answers for ${holon} in ${home} are not sealed${reason ? `: ${reason}` : ''} — refusing to write in the clear`);
    this.name = 'AnswersNotSealedError';
    this.home = home;
    this.holon = holon;
  }
}

const scopeOf = (home: string, holon: string): Scope => ({ holon: String(home), lens: ANSWERS_LENS, item: String(holon) });

/** The keys that speak for `holon` as its admins: its anchor and every key seated as admin. */
export async function holonAdminKeys(hs: HoloSphere, holon: string): Promise<string[]> {
  const out = new Set<string>();
  const anchor = resolveHolonAuthority(hs, holon).anchor;
  if (anchor) out.add(String(anchor).toLowerCase());
  try {
    for (const [pub, role] of await holonMembers(hs, holon)) if (role === 'admin') out.add(String(pub).toLowerCase());
  } catch {
    /* no log readable: the anchor alone */
  }
  return [...out].sort();
}

const inFlight = new WeakMap<object, Map<string, Promise<void>>>();

/**
 * Make sure `<home>/answers/<holon>` is sealed and this identity holds its
 * key: lock it when it is public (the person's holon reads it), and let
 * every admin of `holon` read it. Idempotent; concurrent calls share one.
 * Throws {@link AnswersNotSealedError} instead of leaving it open.
 */
export function ensureAnswersSealed(hs: HoloSphere, home: string, holon: string): Promise<void> {
  let byScope = inFlight.get(hs);
  if (!byScope) inFlight.set(hs, (byScope = new Map()));
  const k = `${home}\u0000${holon}`;
  const running = byScope.get(k);
  if (running) return running;
  const scope = scopeOf(home, holon);
  const p = (async () => {
    try {
      if (!(await isLocked(hs, scope))) await lock(hs, scope);
    } catch (err) {
      throw new AnswersNotSealedError(home, holon, (err as Error)?.message);
    }
    if (!(await isLocked(hs, scope))) throw new AnswersNotSealedError(home, holon, 'the record is still public after locking');
    if (!hs.privacy?.holdsKey(scope)) throw new AnswersNotSealedError(home, holon, 'the record is sealed but this identity holds no key for it');
    // The holon's admins read it: the ones not yet in the audience are added
    // (only the vault's owner can; another sealer keeps the owner's audience).
    try {
      const now = await audience(hs, scope);
      if (now.owned) {
        const listed = new Set(now.holons.map((e) => e.holon.toLowerCase()));
        for (const admin of await holonAdminKeys(hs, holon)) if (!listed.has(admin)) await share(hs, scope, admin);
      }
    } catch (err) {
      console.warn('[onboarding] admins not yet given the answers key:', (err as Error)?.message);
    }
  })().finally(() => byScope!.delete(k));
  byScope.set(k, p);
  return p;
}

/** The person's sealed answers to `holon`'s questions, or null (none, or no key to open them). */
export async function readAnswers(hs: HoloSphere, home: string, holon: string): Promise<SealedAnswers | null> {
  try {
    const rec = (await hs.get(String(home), ANSWERS_LENS, String(holon))) as (SealedAnswers & { _deleted?: boolean }) | null;
    if (!rec || rec._deleted || !rec.answers || typeof rec.answers !== 'object') return null;
    return rec;
  } catch {
    return null;
  }
}

/**
 * Merge `answers` into the person's sealed answers to `holon` (sealing the
 * record first). Returns what was stored. Throws
 * {@link AnswersNotSealedError} rather than write in the clear.
 */
export async function saveAnswers(
  hs: HoloSphere,
  home: string,
  holon: string,
  answers: Record<string, string | string[]>,
  opts: { now?: () => Date } = {},
): Promise<SealedAnswers> {
  await ensureAnswersSealed(hs, home, holon);
  const cur = await readAnswers(hs, home, holon);
  const next: SealedAnswers = {
    id: String(holon),
    answers: { ...(cur?.answers ?? {}), ...answers },
    updated: (opts.now?.() ?? new Date()).toISOString(),
  };
  await hs.put(String(home), ANSWERS_LENS, next);
  return next;
}

/**
 * Everything the person answered for `holon`: their profile (the shared
 * catalog fields), with their sealed answers to the holon's own questions
 * over it. What a profile card checks and an answer form fills in.
 */
export async function readOnboardingAnswers(hs: HoloSphere, home: string, holon: string): Promise<OnboardingProfile | null> {
  const [profile, sealed] = await Promise.all([readProfile(hs, home), readAnswers(hs, home, holon)]);
  if (!profile && !sealed) return null;
  return { ...(profile ?? {}), ...(sealed?.answers ?? {}), id: String(home) };
}

/**
 * Keep what the person answered on a profile card: the catalog fields on
 * their profile, the holon's sealed questions in its sealed record — never
 * the one in the other. Fields the card does not ask are kept on the
 * profile, as before. Returns the merged view (as `readOnboardingAnswers`).
 */
export async function saveOnboardingAnswers(
  hs: HoloSphere,
  home: string,
  holon: string,
  fields: readonly ProfileField[],
  values: Record<string, string | string[]>,
): Promise<OnboardingProfile> {
  const sealedKeys = new Set(fields.filter(isSealedField).map((f) => f.key));
  const open: Record<string, string | string[]> = {};
  const sealed: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(values)) (sealedKeys.has(k) ? sealed : open)[k] = v;
  // Sealed first: a refusal leaves nothing half-written in the clear.
  const kept = Object.keys(sealed).length ? await saveAnswers(hs, home, holon, sealed) : await readAnswers(hs, home, holon);
  const profile = Object.keys(open).length ? await saveProfile(hs, home, open as Partial<OnboardingProfile>) : await readProfile(hs, home);
  return { ...(profile ?? {}), ...(kept?.answers ?? {}), id: String(home) };
}
