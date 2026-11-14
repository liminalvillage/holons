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
// already knows; a holon may add its own questions under keys of its own,
// as text or as a choice among options (`choice`: one, `multi`: any).
//
// A holon's own questions are the holon's business, not the person's public
// profile: their answers are SEALED (`sealed`, the default for a key the
// catalog does not know) — kept in the person's holon under `answers/<holon>`,
// readable by the person and the holon's admins only (see answers.ts).

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

/**
 * How a field is asked: a line, a paragraph, a date, a link, a list, one
 * option among its `options` (`choice`), or any of them (`multi`).
 */
export type ProfileFieldType = 'text' | 'longtext' | 'date' | 'url' | 'list' | 'choice' | 'multi';

export const PROFILE_FIELD_TYPES: readonly ProfileFieldType[] = ['text', 'longtext', 'date', 'url', 'list', 'choice', 'multi'];

/** One answer a `choice` or `multi` field offers. */
export interface ProfileOption {
  /** What is stored: lowercase letters, digits, `_` and `-`. */
  value: string;
  /** What the person reads. */
  label: string;
  /** A line under the label. */
  hint?: string;
}

/** Most options a field offers. */
export const MAX_PROFILE_OPTIONS = 40;

/** One thing a holon asks a newcomer's profile to hold. */
export interface ProfileField {
  /** The key on the profile record. */
  key: string;
  /** The question, as the newcomer reads it. */
  label: string;
  type: ProfileFieldType;
  /** Must be filled for the card to count as done. */
  required: boolean;
  /** A `choice` / `multi` field: what may be picked (at least one). */
  options?: ProfileOption[];
  /**
   * The answer is kept sealed for the person and the holon's admins
   * (`answers/<holon>` in the person's holon), never on their public
   * profile. Unset: sealed unless the key is one of the catalog's — a
   * holon's own question is sealed unless it says otherwise (see
   * {@link isSealedField}; normalizing keeps it only where it differs).
   */
  sealed?: boolean;
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

const optionValue = (raw: unknown): string =>
  String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 48);

/** Whatever is stored → the options a field offers: each value once, at most {@link MAX_PROFILE_OPTIONS}. */
export function normalizeProfileOptions(raw: unknown): ProfileOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileOption[] = [];
  const seen = new Set<string>();
  for (const o of raw) {
    const doc = (o && typeof o === 'object' ? o : { value: o, label: o }) as Record<string, unknown>;
    const word = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
    const label = word(doc.label) || word(doc.value);
    const value = optionValue(doc.value ?? label);
    if (!value || !label || seen.has(value)) continue;
    seen.add(value);
    const hint = typeof doc.hint === 'string' ? doc.hint.trim() : '';
    out.push({ value, label, ...(hint ? { hint } : {}) });
    if (out.length >= MAX_PROFILE_OPTIONS) break;
  }
  return out;
}

/** Is `type` one that picks among options? */
export const isChoiceField = (field: Pick<ProfileField, 'type'>): boolean => field.type === 'choice' || field.type === 'multi';

/** Is the field's answer sealed? A catalog key is not unless it says so; a holon's own question is unless it says not. */
export function isSealedField(field: Pick<ProfileField, 'key' | 'sealed'>): boolean {
  return typeof field.sealed === 'boolean' ? field.sealed : !PROFILE_FIELDS.some((k) => k.key === field.key);
}

/**
 * Whatever is stored → usable fields. A field needs a key (made safe) and
 * a question (a known key keeps its catalog one), each key once,
 * an unknown type is `text`, `required` unless said otherwise, `sealed`
 * only where it differs from the default (see {@link isSealedField}). A `choice` or `multi` field
 * without a single usable option asks for text instead. Nothing usable →
 * the default fields: a profile card always asks something.
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
    let type = PROFILE_FIELD_TYPES.includes(doc.type as ProfileFieldType) ? (doc.type as ProfileFieldType) : (known?.type ?? 'text');
    const options = isChoiceField({ type }) ? normalizeProfileOptions(doc.options) : [];
    if (isChoiceField({ type }) && !options.length) type = 'text';
    // Kept only where it differs from the default for its key.
    const sealed = typeof doc.sealed === 'boolean' && doc.sealed !== isSealedField({ key }) ? { sealed: doc.sealed } : {};
    out.push({ key, label, type, required: doc.required !== false, ...(options.length ? { options } : {}), ...sealed });
  }
  return out.length ? out : DEFAULT_PROFILE_FIELDS.map((f) => ({ ...f }));
}

/** Does this value count as an answer? */
export function fieldFilled(value: unknown): boolean {
  return Array.isArray(value) ? value.some((x) => String(x ?? '').trim()) : typeof value === 'string' ? value.trim() !== '' : typeof value === 'number';
}

/** The options of a choice field a stored value picks (unknown values dropped). */
function picked(field: ProfileField, value: unknown): string[] {
  const values = (Array.isArray(value) ? value : value == null ? [] : [value]).map((v) => String(v ?? '').trim()).filter(Boolean);
  const offered = new Set((field.options ?? []).map((o) => o.value));
  return values.filter((v) => offered.has(v));
}

/** Does this stored value answer this field? A choice must pick one of its options (a `choice` exactly one). */
export function fieldAnswered(field: ProfileField, value: unknown): boolean {
  if (!isChoiceField(field)) return fieldFilled(value);
  const n = picked(field, value).length;
  return field.type === 'choice' ? n === 1 && !Array.isArray(value) : n > 0;
}

/** The required fields the profile has not answered yet. */
export function missingProfileFields(profile: OnboardingProfile | null | undefined, fields: readonly ProfileField[]): ProfileField[] {
  return fields.filter((f) => f.required && !fieldAnswered(f, profile?.[f.key]));
}

/** Has the profile everything these fields require? */
export function profileComplete(profile: OnboardingProfile | null | undefined, fields: readonly ProfileField[]): boolean {
  return missingProfileFields(profile, fields).length === 0;
}

/** A stored value as one editable line of text (a list joins with commas; a choice is its option values). */
export function fieldText(field: ProfileField, value: unknown): string {
  if (Array.isArray(value)) return value.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
  return value == null ? '' : String(value);
}

/** The option a typed or picked word names: by value, else by label (case and accents aside). */
export function optionFor(field: ProfileField, word: string): ProfileOption | undefined {
  const w = String(word ?? '').trim();
  if (!w) return undefined;
  const options = field.options ?? [];
  const v = optionValue(w);
  const fold = (x: string) => x.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return options.find((o) => o.value === w) ?? options.find((o) => o.value === v) ?? options.find((o) => fold(o.label) === fold(w));
}

/** The labels a stored choice value reads as, in the field's order. */
export function optionLabels(field: ProfileField, value: unknown): string[] {
  const chosen = new Set(picked(field, value));
  return (field.options ?? []).filter((o) => chosen.has(o.value)).map((o) => o.label);
}

const parts = (input: string | readonly string[]): string[] =>
  (Array.isArray(input) ? input : String(input ?? '').split(','))
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);

/**
 * What the person typed or picked → the value the profile keeps: a list
 * splits on commas; a `choice` keeps the option value it names, a `multi`
 * the values of every option named (picked values, or typed values or
 * labels separated by commas), in the field's order. Words that name no
 * option are dropped.
 */
export function fieldValue(field: ProfileField, input: string | readonly string[]): string | string[] {
  if (field.type === 'list') return parts(input);
  if (field.type === 'multi') {
    const named = new Set(parts(input).map((w) => optionFor(field, w)?.value).filter((v): v is string => !!v));
    return (field.options ?? []).map((o) => o.value).filter((v) => named.has(v));
  }
  const s = Array.isArray(input) ? String(input[0] ?? '').trim() : String(input ?? '').trim();
  if (field.type === 'choice') return optionFor(field, s)?.value ?? '';
  return s;
}

/**
 * Is this typed text (or these picks) an answer the field can keep? A date
 * is a calendar day (`YYYY-MM-DD`), a link an http(s) address, a choice
 * names exactly one of its options, a multi only options (at least one);
 * anything else, any text. Blank never is.
 */
export function fieldAccepts(field: ProfileField, text: string | readonly string[]): boolean {
  if (isChoiceField(field)) {
    const words = field.type === 'choice' ? (Array.isArray(text) ? parts(text) : [String(text ?? '').trim()].filter(Boolean)) : parts(text);
    if (!words.length || (field.type === 'choice' && words.length !== 1)) return false;
    return words.every((w) => !!optionFor(field, w));
  }
  const s = String(Array.isArray(text) ? text.join(', ') : (text ?? '')).trim();
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
