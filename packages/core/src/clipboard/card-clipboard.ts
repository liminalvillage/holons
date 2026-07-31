// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Portable card clipboard. A "card" (a quest/event or a library thing) can be
// copied as plain text and pasted anywhere — another holon, another device,
// or any text surface (chat, notes). The copied text is human-readable with a
// single machine-parseable marker line at the end, so the same clipboard
// content reads well in Telegram AND round-trips losslessly back into a holon.
//
// Only *portable* fields travel: title/name, description, category, schedule,
// location, picture, type and value. Memberships (participants, appreciation),
// status, dependencies, borrow state, ids and federation/hologram provenance
// are deliberately left behind — pasting always creates a fresh, unclaimed
// card in the target holon.

import { createTask } from '../tasks/creation.js';
import type { Quest, QuestInitiator } from '../tasks/types.js';
import type { LibraryItem, CreateLibraryItemOptions, LibraryItemType } from '../library/types.js';
import { LIBRARY_TYPES } from '../library/types.js';

/** Prefix of the machine-parseable line inside copied card text. */
export const CARD_MARKER = 'holons-card:';

/** Format discriminator/version stamped into every payload. */
export const CARD_FORMAT = 'card/1';

/** Portable fields of a quest (task or calendar event). */
export interface QuestCardData {
  title: string;
  description?: string;
  category?: string;
  /** Quest `type` (task/quest/event/recurring/offer/request/need …). */
  type?: string;
  when?: string;
  ends?: string;
  location?: string;
  picture?: string;
}

/** Portable fields of a library thing (its id doubles as its name). */
export interface ThingCardData {
  name: string;
  type?: string;
  category?: string;
  description?: string;
  value?: number;
}

export type CardPayload =
  | { kind: 'quest'; data: QuestCardData }
  | { kind: 'thing'; data: ThingCardData };

const trimmed = (v: unknown): string | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
};

/** Extract the portable payload of a quest (task or event). */
export function cardFromQuest(quest: Quest): CardPayload {
  const data: QuestCardData = { title: trimmed(quest.title) ?? 'Untitled' };
  const set = (k: Exclude<keyof QuestCardData, 'title'>, v: string | undefined) => {
    if (v !== undefined) data[k] = v;
  };
  set('description', trimmed(quest.description));
  set('category', trimmed(quest.category));
  set('type', trimmed(quest.type));
  set('when', trimmed(quest.when));
  // `ends` is canonical; `until` is the legacy (bot) name for the same field.
  set('ends', trimmed(quest.ends ?? quest.until));
  set('location', trimmed(quest.location));
  set('picture', trimmed(quest.picture));
  return { kind: 'quest', data };
}

/** Extract the portable payload of a library thing. */
export function cardFromLibraryItem(item: LibraryItem): CardPayload {
  const data: ThingCardData = { name: trimmed(item.id) ?? 'Untitled' };
  const type = trimmed(item.type);
  if (type) data.type = type;
  const category = trimmed(item.category);
  if (category && category !== 'Uncategorized') data.category = category;
  const description = trimmed(item.description);
  if (description) data.description = description;
  const value = Number(item.value);
  if (Number.isFinite(value) && value > 0) data.value = value;
  return { kind: 'thing', data };
}

/**
 * Serialize a payload as clipboard text: a short human-readable block, a blank
 * line, then one `holons-card: {…}` marker line that `parseCardText` finds
 * even when the text was pasted through (and quoted inside) another medium.
 */
export function encodeCardText(payload: CardPayload): string {
  const lines: string[] = [];
  if (payload.kind === 'quest') {
    const d = payload.data;
    lines.push(d.title);
    const meta = [d.category, d.when, d.location].filter(Boolean).join(' · ');
    if (meta) lines.push(meta);
    if (d.description) lines.push(d.description);
  } else {
    const d = payload.data;
    lines.push(d.name);
    const meta = [d.type, d.category].filter(Boolean).join(' · ');
    if (meta) lines.push(meta);
    if (d.description) lines.push(d.description);
  }
  const marker = `${CARD_MARKER} ${JSON.stringify({ holons: CARD_FORMAT, ...payload })}`;
  return `${lines.join('\n')}\n\n${marker}`;
}

/** Validate/coerce a decoded JSON object into a `CardPayload`, else null. */
function toPayload(raw: unknown): CardPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.holons !== CARD_FORMAT) return null;
  const data = obj.data;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (obj.kind === 'quest') {
    const title = trimmed(d.title);
    if (!title) return null;
    const out: QuestCardData = { title };
    for (const k of ['description', 'category', 'type', 'when', 'ends', 'location', 'picture'] as const) {
      const v = trimmed(d[k]);
      if (v !== undefined) out[k] = v;
    }
    return { kind: 'quest', data: out };
  }
  if (obj.kind === 'thing') {
    const name = trimmed(d.name);
    if (!name) return null;
    const out: ThingCardData = { name };
    for (const k of ['type', 'category', 'description'] as const) {
      const v = trimmed(d[k]);
      if (v !== undefined) out[k] = v;
    }
    const value = Number(d.value);
    if (Number.isFinite(value) && value > 0) out.value = value;
    return { kind: 'thing', data: out };
  }
  return null;
}

/**
 * Find a card payload in pasted text. Tolerates surrounding prose (the text
 * may have travelled through chat): tries the whole text as bare JSON first,
 * then every `holons-card:` marker line. Returns null when there is no card.
 */
export function parseCardText(text: string): CardPayload | null {
  if (!text) return null;
  try {
    const whole = toPayload(JSON.parse(text.trim()));
    if (whole) return whole;
  } catch {
    /* not bare JSON — look for marker lines */
  }
  // JSON.stringify output never contains raw newlines, so each marker's
  // payload ends at its line end.
  const re = /holons-card:\s*(\{[^\n\r]*\})/g;
  for (const match of text.matchAll(re)) {
    try {
      const payload = toPayload(JSON.parse(match[1]));
      if (payload) return payload;
    } catch {
      /* keep scanning — a quoted/mangled marker may precede an intact one */
    }
  }
  return null;
}

export interface QuestFromCardInput {
  holonId: string | number;
  /** The pasting user — becomes the new quest's initiator. */
  initiator?: QuestInitiator;
  /** Override the creation timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

/**
 * Materialize a pasted quest card as a fresh quest for the target holon:
 * canonical defaults from `createTask` (status ongoing, empty memberships),
 * the payload's portable fields on top. The id is left empty — the caller
 * assigns its platform id before persisting.
 */
export function questFromCard(
  payload: Extract<CardPayload, { kind: 'quest' }>,
  input: QuestFromCardInput
): Quest {
  const d = payload.data;
  const quest = createTask({
    holonId: input.holonId,
    initiator: input.initiator,
    title: d.title,
    type: d.type,
    category: d.category,
    picture: d.picture ?? null,
    now: input.now
  });
  if (d.description) quest.description = d.description;
  if (d.when) quest.when = d.when;
  if (d.ends) quest.ends = d.ends;
  if (d.location) quest.location = d.location;
  return quest;
}

const LIBRARY_TYPE_SET = new Set<string>(Object.values(LIBRARY_TYPES));

/**
 * Materialize a pasted thing card as `addItem` inputs for the target holon.
 * An unknown type is dropped so `addItem` falls back to its name-based guess;
 * borrow state never travels.
 */
export function libraryAddFromCard(
  payload: Extract<CardPayload, { kind: 'thing' }>,
  options: Pick<CreateLibraryItemOptions, 'createdBy' | 'createdByUsername'> = {}
): { itemId: string; options: CreateLibraryItemOptions } {
  const d = payload.data;
  const out: CreateLibraryItemOptions = { ...options };
  if (d.type && LIBRARY_TYPE_SET.has(d.type)) out.type = d.type as LibraryItemType;
  if (d.category) out.category = d.category;
  if (d.description) out.description = d.description;
  if (d.value) out.value = d.value;
  return { itemId: d.name, options: out };
}
