// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The holons a person keeps — the `holons` lens in their own (pubkey or user
 * id) holon. Written by every surface that shows someone a board they are in,
 * read wherever "which hubs am I in" is the question: the dock, the inbound
 * climb (`@holons/core/flows`), a bot that seats a member. Kept apart from
 * the formation code so a leaf module can import it without the whole stack.
 */

/** The lens in a person's own holon that lists the holons they keep. */
export const MY_HOLONS_LENS = 'holons';

export interface RememberedHolon {
  id: string;
  name?: string;
  /** When it was (last) remembered, ms epoch. */
  at: number;
}

export function isRememberedHolon(value: unknown): value is RememberedHolon {
  const r = value as RememberedHolon;
  return !!r && typeof r === 'object' && typeof r.id === 'string' && r.id.trim() !== '' && typeof r.at === 'number' && Number.isFinite(r.at) && (r.name === undefined || typeof r.name === 'string');
}

/** The slice of a holosphere the list needs. */
export interface HolonListStore {
  getAll(holon: string, lens: string): Promise<unknown>;
  put(holon: string, lens: string, data: object): Promise<unknown>;
  delete(holon: string, lens: string, key: string): Promise<unknown>;
}

/** Remember `holon` in `person`'s own list (their pubkey holon). An empty name keeps the old one. */
export async function rememberHolon(store: HolonListStore, person: string, entry: { id: string; name?: string }, now = Date.now()): Promise<RememberedHolon> {
  const id = String(entry.id ?? '').trim();
  if (!id) throw new Error('rememberHolon: a holon id is required');
  const name = String(entry.name ?? '').trim();
  const current = (await myHolons(store, person)).find((h) => h.id === id);
  const next: RememberedHolon = { id, at: now };
  const keep = name || current?.name;
  if (keep) next.name = keep;
  await store.put(person, MY_HOLONS_LENS, next);
  return next;
}

export async function forgetHolon(store: HolonListStore, person: string, holon: string): Promise<void> {
  await store.delete(person, MY_HOLONS_LENS, String(holon));
}

/** The holons `person` keeps, most recent first. */
export async function myHolons(store: HolonListStore, person: string): Promise<RememberedHolon[]> {
  let raw: unknown;
  try {
    raw = await store.getAll(person, MY_HOLONS_LENS);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  return list.filter(isRememberedHolon).sort((a, b) => b.at - a.at);
}
