// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The newcomer's profile: who they are and what they can offer and give.
// It is the person's own — one record in their personal holon,
// `<home>/dna/<home>` — so it travels with them to every holon they ask to
// join. The bot's wizard writes the same record (telegram-ui `dna.js`).
//
// What a holon asks of it is the holon's to say: a profile card lists the
// fields it needs (`ProfileField`), and the card is done once every
// required one is filled. The catalog below names the fields every surface
// already knows; a holon may add its own questions under keys of its own.

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

/** How a field is asked: a line, a paragraph, a date, a link, or a list. */
export type ProfileFieldType = 'text' | 'longtext' | 'date' | 'url' | 'list';

export const PROFILE_FIELD_TYPES: readonly ProfileFieldType[] = ['text', 'longtext', 'date', 'url', 'list'];

/** One thing a holon asks a newcomer's profile to hold. */
export interface ProfileField {
  /** The key on the profile record. */
  key: string;
  /** The question, as the newcomer reads it. */
  label: string;
  type: ProfileFieldType;
  /** Must be filled for the card to count as done. */
  required: boolean;
}

/** The fields every surface knows, with the question each one asks. */
export const PROFILE_FIELDS: readonly ProfileField[] = Object.freeze([
  { key: 'first_name', label: 'Your name', type: 'text', required: true },
  { key: 'last_name', label: 'Your last name', type: 'text', required: false },
  { key: 'ikigai', label: 'What you can offer and give', type: 'longtext', required: true },
  { key: 'summary', label: 'About you', type: 'longtext', required: false },
  { key: 'values', label: 'Your values', type: 'list', required: false },
  { key: 'category', label: 'Your field of work', type: 'text', required: false },
  { key: 'linkedin', label: 'A link about you', type: 'url', required: false },
  { key: 'arrival', label: 'Arrival date', type: 'date', required: true },
  { key: 'departure', label: 'Departure date', type: 'date', required: false },
]);

const catalog = (key: string): ProfileField => ({ ...PROFILE_FIELDS.find((f) => f.key === key)! });

/** What a profile card asks when it says nothing: a name, and what they bring. */
export const DEFAULT_PROFILE_FIELDS: readonly ProfileField[] = Object.freeze([catalog('first_name'), catalog('ikigai')]);

/** Keys a field may not take: the record's own. */
const RESERVED = new Set(['id', '_deleted', '_clock', '_meta']);

/**
 * Whatever is stored → usable fields. A field needs a key (made safe) and
 * a question (a known key keeps its catalog one), each key once,
 * an unknown type is `text`, `required` unless said otherwise. Nothing
 * usable → the default fields: a profile card always asks something.
 */
export function normalizeProfileFields(raw: unknown): ProfileField[] {
  if (!Array.isArray(raw)) return DEFAULT_PROFILE_FIELDS.map((f) => ({ ...f }));
  const out: ProfileField[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    const doc = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const key = String(doc.key ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
    const known = PROFILE_FIELDS.find((k) => k.key === key);
    const label = (typeof doc.label === 'string' ? doc.label.trim() : '') || known?.label || '';
    if (!key || !label || RESERVED.has(key) || seen.has(key)) continue;
    seen.add(key);
    const type = PROFILE_FIELD_TYPES.includes(doc.type as ProfileFieldType) ? (doc.type as ProfileFieldType) : (known?.type ?? 'text');
    out.push({ key, label, type, required: doc.required !== false });
  }
  return out.length ? out : DEFAULT_PROFILE_FIELDS.map((f) => ({ ...f }));
}

/** Does this value count as an answer? */
export function fieldFilled(value: unknown): boolean {
  return Array.isArray(value) ? value.some((x) => String(x ?? '').trim()) : typeof value === 'string' ? value.trim() !== '' : typeof value === 'number';
}

/** The required fields the profile has not answered yet. */
export function missingProfileFields(profile: OnboardingProfile | null | undefined, fields: readonly ProfileField[]): ProfileField[] {
  return fields.filter((f) => f.required && !fieldFilled(profile?.[f.key]));
}

/** Has the profile everything these fields require? */
export function profileComplete(profile: OnboardingProfile | null | undefined, fields: readonly ProfileField[]): boolean {
  return missingProfileFields(profile, fields).length === 0;
}

/** A stored value as one editable line of text (a list joins with commas). */
export function fieldText(field: ProfileField, value: unknown): string {
  if (Array.isArray(value)) return value.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
  return value == null ? '' : String(value);
}

/** What the person typed → the value the profile keeps (a list splits on commas). */
export function fieldValue(field: ProfileField, text: string): string | string[] {
  const s = String(text ?? '').trim();
  return field.type === 'list'
    ? s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : s;
}

/**
 * Is this typed text an answer the field can keep? A date is a calendar
 * day (`YYYY-MM-DD`), a link an http(s) address; anything else, any text.
 * Blank never is.
 */
export function fieldAccepts(field: ProfileField, text: string): boolean {
  const s = String(text ?? '').trim();
  if (!s) return false;
  if (field.type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  if (field.type === 'url') return /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(s);
  return true;
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
