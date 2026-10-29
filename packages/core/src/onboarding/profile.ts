// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The newcomer's profile: who they are and what they can offer and give.
// It is the person's own — one record in their personal holon,
// `<home>/dna/<home>` — so it travels with them to every holon they ask to
// join. The bot's wizard writes the same record (telegram-ui `dna.js`).

import type { HoloSphere } from 'holosphere';

export const PROFILE_LENS = 'dna';

export interface OnboardingProfile {
  id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  /** What they can offer and give. */
  ikigai?: string;
  summary?: string;
  values?: string[] | string;
  category?: string;
  linkedin?: string;
  arrival?: string;
  departure?: string;
  [key: string]: unknown;
}

const filled = (v: unknown): boolean =>
  Array.isArray(v) ? v.some((x) => String(x ?? '').trim()) : typeof v === 'string' ? v.trim() !== '' : false;

/** Enough to apply with: a name, and something about what they bring. */
export function profileReady(profile: OnboardingProfile | null | undefined): boolean {
  if (!profile) return false;
  const named = filled(profile.first_name) || filled(profile.name);
  return named && (filled(profile.ikigai) || filled(profile.summary) || filled(profile.values));
}

/** The person's profile in their personal holon, or null. */
export async function readProfile(hs: HoloSphere, home: string): Promise<OnboardingProfile | null> {
  const id = String(home);
  try {
    const rec = (await hs.get(id, PROFILE_LENS, id)) as (OnboardingProfile & { _deleted?: boolean }) | null;
    return rec && !rec._deleted ? rec : null;
  } catch {
    return null;
  }
}

/** Merge `fields` into the profile (made on the first write). Returns what was stored. */
export async function saveProfile(hs: HoloSphere, home: string, fields: Partial<OnboardingProfile>): Promise<OnboardingProfile> {
  const id = String(home);
  const next: OnboardingProfile = { ...((await readProfile(hs, id)) ?? {}), ...fields, id };
  await hs.put(id, PROFILE_LENS, next);
  return next;
}
