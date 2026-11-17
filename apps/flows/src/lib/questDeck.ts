// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The quest deck's gesture and memory. Pure geometry for a card that follows
// the finger (adapted from the kiosk's task deck, left and right only), and
// what one viewer said on this device: yes or no per quest, and who they
// would work with again. None of it leaves the device — the board only ever
// hears a join or a pledge, never a no.

/** Where a committed swipe went. */
export type QuestSwipe = "yes" | "no";

const ROTATE_DEG_PER_PX = 0.08;

/** The swipe a released drag commits to, or null to spring back. */
export function swipeDecision(
  dx: number,
  threshold: number,
): QuestSwipe | null {
  if (Math.abs(dx) <= threshold) return null;
  return dx > 0 ? "yes" : "no";
}

/** How strongly each badge shows for the current drag, 0…1, full at the threshold. */
export function badgeOpacity(
  dx: number,
  threshold: number,
): { yes: number; no: number } {
  const clamp = (v: number) => Math.max(0, Math.min(1, v / threshold));
  return { yes: clamp(dx), no: clamp(-dx) };
}

/** The top card's transform while it tracks the finger. */
export function cardTransform(dx: number, dy: number): string {
  return `translate(${dx}px, ${dy}px) rotate(${dx * ROTATE_DEG_PER_PX}deg)`;
}

/** The slice of `Storage` this needs: lets the specs pass a plain map. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SWIPES = "flows_quest_swipes";
const RATINGS = "flows_quest_ratings";
/** A swipe owner when nobody is signed in: a no needs no login. */
const ANON = "anon";
const MAX_REMEMBERED = 500;

function device(): KeyValue | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readDoc<T>(store: KeyValue | null, key: string): Record<string, T> {
  try {
    const doc = JSON.parse(store?.getItem(key) ?? "{}");
    return doc && typeof doc === "object" ? (doc as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeDoc(store: KeyValue | null, key: string, doc: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(doc));
  } catch {
    /* private mode: the deck deals again next visit */
  }
}

export interface Swipes {
  yes: string[];
  no: string[];
}

const deckKey = (board: string, viewer: string | null) =>
  `${board} ${viewer || ANON}`;

/** What this viewer said on this board, on this device. */
export function readSwipes(
  board: string,
  viewer: string | null,
  store: KeyValue | null = device(),
): Swipes {
  const got = readDoc<Swipes>(store, SWIPES)[deckKey(board, viewer)];
  return {
    yes: Array.isArray(got?.yes) ? got.yes.map(String) : [],
    no: Array.isArray(got?.no) ? got.no.map(String) : [],
  };
}

/** Remember a yes or a no; a later word on the same quest replaces it. */
export function recordSwipe(
  board: string,
  viewer: string | null,
  quest: string,
  swipe: QuestSwipe,
  store: KeyValue | null = device(),
): Swipes {
  const doc = readDoc<Swipes>(store, SWIPES);
  const mine = readSwipes(board, viewer, store);
  const drop = (ids: string[]) => ids.filter((id) => id !== quest);
  const next: Swipes = {
    yes: drop(mine.yes),
    no: drop(mine.no),
  };
  next[swipe] = [quest, ...next[swipe]].slice(0, MAX_REMEMBERED);
  doc[deckKey(board, viewer)] = next;
  writeDoc(store, SWIPES, doc);
  return next;
}

/** Forget every no on a board, so the deck deals them again. */
export function forgetNoes(
  board: string,
  viewer: string | null,
  store: KeyValue | null = device(),
): Swipes {
  const doc = readDoc<Swipes>(store, SWIPES);
  const next = { ...readSwipes(board, viewer, store), no: [] };
  doc[deckKey(board, viewer)] = next;
  writeDoc(store, SWIPES, doc);
  return next;
}

export type Rating = "again" | "not";

/** Who this viewer would (not) work with again: party → rating. Private. */
export function readRatings(
  viewer: string | null,
  store: KeyValue | null = device(),
): Record<string, Rating> {
  const got = readDoc<Record<string, Rating>>(store, RATINGS)[viewer || ANON];
  return got && typeof got === "object" ? { ...got } : {};
}

export function rate(
  viewer: string | null,
  party: string,
  rating: Rating | null,
  store: KeyValue | null = device(),
): Record<string, Rating> {
  const doc = readDoc<Record<string, Rating>>(store, RATINGS);
  const mine = readRatings(viewer, store);
  if (rating) mine[party] = rating;
  else delete mine[party];
  doc[viewer || ANON] = mine;
  writeDoc(store, RATINGS, doc);
  return mine;
}

/** The two sets the feed ranks by. */
export function ratingSets(ratings: Record<string, Rating>): {
  liked: Set<string>;
  avoided: Set<string>;
} {
  const liked = new Set<string>();
  const avoided = new Set<string>();
  for (const [party, r] of Object.entries(ratings))
    (r === "again" ? liked : avoided).add(party);
  return { liked, avoided };
}

const FUNDS = "flows_quest_funds";

/** The funds this viewer follows for quests, or null when they never chose. */
export function readQuestFunds(
  viewer: string | null,
  store: KeyValue | null = device(),
): string[] | null {
  const got = readDoc<string[]>(store, FUNDS)[viewer || ANON];
  return Array.isArray(got) ? got.map(String) : null;
}

export function saveQuestFunds(
  viewer: string | null,
  funds: string[],
  store: KeyValue | null = device(),
): string[] {
  const doc = readDoc<string[]>(store, FUNDS);
  const next = [...new Set(funds.map(String).filter(Boolean))];
  doc[viewer || ANON] = next;
  writeDoc(store, FUNDS, doc);
  return next;
}

/** The slice of the map a default needs. */
export interface FundsMap {
  byId: Map<string, { id: string; kind: string; share: number }>;
  into: Map<string, { source: string }[]>;
}

/**
 * Where a viewer who never chose starts: the funds that pay them (or the
 * parties they are), then the largest funds, up to `n`.
 */
export function defaultQuestFunds(
  index: FundsMap | null,
  mine: readonly string[],
  n = 6,
): string[] {
  if (!index) return [];
  const isFund = (id: string) => index.byId.get(id)?.kind === "fund";
  const out: string[] = [];
  const add = (id: string) => {
    if (out.length < n && isFund(id) && !out.includes(id)) out.push(id);
  };
  for (const id of mine) {
    add(id);
    for (const l of index.into.get(id) ?? []) add(l.source);
  }
  [...index.byId.values()]
    .filter((x) => x.kind === "fund")
    .sort((a, z) => z.share - a.share || (a.id < z.id ? -1 : 1))
    .forEach((f) => add(f.id));
  return out;
}
