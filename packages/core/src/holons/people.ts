// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The people across a set of holons: who is in which, who is in more than
 * one, and which pairs of holons they tie together. The other half of a map
 * of holons — federation says which holons chose each other, this says which
 * ones share people whether they federated or not.
 *
 * A person is counted once however they are written down: a Telegram id in
 * one holon's `users` and a key in another's are the same person when the
 * key is linked to them (`linkedKeys` on a record, or the kind-31926
 * directory). The roster read is the `users` lens — the one every surface
 * names people from — so nobody shows up here that the holon itself would
 * not list. A holon is never its own member, and neither bots nor other
 * holons are people.
 */

import { attestationIdentityMap, parseIdentifier } from '../shifts/attestation.js';
import { SHIFT_IDENTITY_LENS, attestationsFrom } from '../shifts/wire.js';
import { normalizeId } from '../identity/ids.js';
import { userName, type NameOptions, type NameRecord } from '../identity/index.js';
import { getFederationSnapshot } from '../federation/snapshot.js';

const HEX64 = /^[0-9a-f]{64}$/;
const HOLONISH = /^(-\d+|(holon|hub|chat)_[a-z0-9_-]+)$/i;

/** One holon's roster: its `users` records, as read. */
export interface HolonRoster {
  holon: string;
  members: Iterable<unknown>;
}

export interface PersonAcross {
  /** The person: the id their linked keys fold into, else the id as written. */
  id: string;
  /** Every id they were listed under, `id` included. */
  ids: string[];
  /** The holons they are in, in the order the rosters were given. */
  holons: string[];
  /** The first real name a roster had for them, when one did. */
  name?: string;
}

/** Two holons and the people in both. */
export interface HolonBridge {
  a: string;
  b: string;
  people: string[];
}

export interface PeopleAcross {
  /** Everyone, the most connected first. */
  people: PersonAcross[];
  /** Those in two holons or more. */
  connectors: PersonAcross[];
  /** Every pair of holons sharing someone, the most shared first. */
  bridges: HolonBridge[];
}

export interface PeopleAcrossOptions {
  /** Key → the person behind it (the kind-31926 directory). */
  identity?: Pick<Map<string, string>, 'get'>;
  /** How a roster record's name is written. */
  format?: NameOptions;
}

type Rec = NameRecord & { id?: unknown; is_bot?: unknown; _deleted?: unknown; linkedKeys?: unknown };

const byId = new Intl.Collator(undefined, { numeric: true });

export function peopleAcross(rosters: Iterable<HolonRoster>, opts: PeopleAcrossOptions = {}): PeopleAcross {
  const listed: Array<{ holon: string; id: string; rec: Rec }> = [];
  const order: string[] = [];
  // Keys a record claims for its own person, on top of the directory.
  const linked = new Map<string, string>();
  for (const roster of rosters) {
    const holon = normalizeId(roster.holon);
    if (!holon) continue;
    if (!order.includes(holon)) order.push(holon);
    for (const raw of roster.members ?? []) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as Rec;
      if (rec.is_bot === true || rec._deleted === true) continue;
      const id = normalizeId(rec.id as string | number | null | undefined);
      if (!id || id === holon || HOLONISH.test(id)) continue;
      listed.push({ holon, id, rec });
      if (Array.isArray(rec.linkedKeys) && !HEX64.test(id)) {
        for (const k of rec.linkedKeys) {
          const key = normalizeId(k as string);
          if (HEX64.test(key) && !linked.has(key)) linked.set(key, id);
        }
      }
    }
  }

  const personOf = (id: string) => (HEX64.test(id) ? normalizeId(opts.identity?.get(id) ?? linked.get(id) ?? id) : id);
  const format = { ...opts.format, idFallback: false, unknown: '' };
  const found = new Map<string, PersonAcross>();
  for (const { holon, id, rec } of listed) {
    const pid = personOf(id);
    if (pid === holon) continue;
    let p = found.get(pid);
    if (!p) found.set(pid, (p = { id: pid, ids: [pid], holons: [] }));
    if (!p.ids.includes(id)) p.ids.push(id);
    if (!p.holons.includes(holon)) p.holons.push(holon);
    if (!p.name) {
      const name = userName(rec, format).trim();
      if (name) p.name = name;
    }
  }

  const people = [...found.values()];
  for (const p of people) p.holons.sort((x, y) => order.indexOf(x) - order.indexOf(y));
  people.sort((x, y) => y.holons.length - x.holons.length || byId.compare(x.id, y.id));
  const connectors = people.filter((p) => p.holons.length > 1);

  const pairs = new Map<string, HolonBridge>();
  for (const p of connectors) {
    for (let i = 0; i < p.holons.length; i++) {
      for (let j = i + 1; j < p.holons.length; j++) {
        const key = `${p.holons[i]}\n${p.holons[j]}`;
        let bridge = pairs.get(key);
        if (!bridge) pairs.set(key, (bridge = { a: p.holons[i], b: p.holons[j], people: [] }));
        bridge.people.push(p.id);
      }
    }
  }
  const bridges = [...pairs.values()].sort(
    (x, y) => y.people.length - x.people.length || order.indexOf(x.a) - order.indexOf(y.a) || order.indexOf(x.b) - order.indexOf(y.b),
  );
  return { people, connectors, bridges };
}

/** The slice of a holosphere the read needs. */
export interface PeopleHost {
  getAll(holon: string, lens: string): Promise<unknown>;
  getAllGlobal?(lens: string): Promise<unknown>;
}

export interface LoadPeopleOptions extends PeopleAcrossOptions {
  /** Rosters read at once (default 4) — a dock can hold dozens of holons. */
  concurrency?: number;
}

function recordsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, unknown>);
  return [];
}

/** Key → person id from the kind-31926 directory; empty when it cannot be read. */
async function loadIdentity(hs: PeopleHost): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (typeof hs.getAllGlobal !== 'function') return out;
  try {
    const atts = attestationsFrom(recordsOf(await hs.getAllGlobal(SHIFT_IDENTITY_LENS)) as never);
    for (const [key, identifier] of attestationIdentityMap(atts)) {
      const parsed = parseIdentifier(identifier);
      if (parsed) out.set(key, parsed.id);
    }
  } catch {
    /* no directory: keys stand for themselves */
  }
  return out;
}

/** Read the `users` roster of each holon, `concurrency` at a time; unreadable ones list nobody. */
async function readRosters(hs: PeopleHost, holons: Iterable<string>, concurrency = 4): Promise<HolonRoster[]> {
  const ids = [...new Set([...holons].map((h) => normalizeId(h)).filter(Boolean))];
  const rosters: HolonRoster[] = ids.map((holon) => ({ holon, members: [] }));
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const i = next++;
      try {
        rosters[i].members = recordsOf(await hs.getAll(ids[i], 'users'));
      } catch {
        /* unreadable: nobody from here */
      }
    }
  };
  const lanes = Math.max(1, Math.min(concurrency, ids.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return rosters;
}

/**
 * Read the `users` roster of each holon and fold them (`peopleAcross`). A
 * holon whose roster cannot be read — offline, private, gone — simply
 * contributes nobody.
 */
export async function loadPeopleAcross(hs: PeopleHost, holons: Iterable<string>, opts: LoadPeopleOptions = {}): Promise<PeopleAcross> {
  const [identity, rosters] = await Promise.all([opts.identity ?? loadIdentity(hs), readRosters(hs, holons, opts.concurrency)]);
  return peopleAcross(rosters, { ...opts, identity });
}

// ── People of the federation ───────────────────────────────────────────────

/**
 * Someone a holon's federation partners list who is not in the holon
 * itself, in the shape a card stores a person (`id`, `username`,
 * `first_name`, `last_name`) — so a picker can put them on a task as is.
 */
export interface FederationPerson {
  /** The person: their linked keys folded in, as in `peopleAcross`. */
  id: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  /** Their display name ('' when no roster had one). */
  name: string;
  /** The partner holons that list them. */
  holons: string[];
}

export interface FederationPeopleOptions extends LoadPeopleOptions {
  /** The partners to read, instead of the holon's federation record. */
  partners?: Iterable<string>;
}

/** The slice of a holosphere the federation read needs on top of the rosters. */
export type FederationPeopleHost = PeopleHost & Parameters<typeof getFederationSnapshot>[0];

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Everyone in `holon`'s federation who is not already one of its members:
 * the rosters of its direct partners, folded with its own so a person
 * listed under a key here and a Telegram id there is still recognised as a
 * member. Direct partners only — the holon's own word on who it federates
 * with, not a crawl of theirs. No federation, or nobody new, is `[]`.
 */
export async function loadFederationPeople(
  hs: FederationPeopleHost,
  holon: string,
  opts: FederationPeopleOptions = {},
): Promise<FederationPerson[]> {
  const home = normalizeId(holon);
  if (!home) return [];
  let partners: string[];
  if (opts.partners) partners = [...opts.partners];
  else {
    try {
      partners = (await getFederationSnapshot(hs, home)).federated;
    } catch {
      return [];
    }
  }
  partners = partners.map((p) => normalizeId(p)).filter((p) => p && p !== home);
  if (!partners.length) return [];
  const [identity, rosters] = await Promise.all([opts.identity ?? loadIdentity(hs), readRosters(hs, [home, ...partners], opts.concurrency)]);
  const { people } = peopleAcross(rosters, { ...opts, identity });

  // The record to copy a person's name fields from: the first one, among
  // the ids they are listed under, that carries a name.
  const records = new Map<string, Rec>();
  for (const r of rosters) {
    for (const raw of r.members) {
      const rec = raw as Rec;
      const id = rec && typeof rec === 'object' ? normalizeId(rec.id as string) : '';
      if (id && !records.has(id) && userName(rec, { idFallback: false, unknown: '' })) records.set(id, rec);
    }
  }

  const out: FederationPerson[] = [];
  for (const p of people) {
    if (p.holons.includes(home)) continue;
    const rec = p.ids.map((id) => records.get(id)).find(Boolean);
    const person: FederationPerson = { id: p.id, name: p.name ?? '', holons: p.holons };
    for (const k of ['username', 'first_name', 'last_name'] as const) {
      const v = str(rec?.[k as keyof Rec]);
      if (v) person[k] = v;
    }
    out.push(person);
  }
  return out.sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || byName.compare(a.name, b.name) || byId.compare(a.id, b.id));
}

const byName = new Intl.Collator(undefined, { sensitivity: 'base' });
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * The people matching `query` — by name, username (with or without the
 * `@`) or id — those whose name starts with it first. A blank query
 * matches nobody: the federation is searched, not listed.
 */
export function findPeople<P extends { id: string; name?: string; username?: string; first_name?: string; last_name?: string }>(
  people: readonly P[],
  query: string,
  limit = 20,
): P[] {
  const q = fold(query).replace(/^@/, '');
  if (!q) return [];
  const scored: Array<[number, P]> = [];
  for (const p of people) {
    const names = [p.name, p.first_name, p.last_name, [p.first_name, p.last_name].filter(Boolean).join(' '), p.username?.replace(/^@/, '')]
      .map((n) => fold(n ?? ''))
      .filter(Boolean);
    const id = fold(p.id);
    const score = names.some((n) => n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q)))
      ? 0
      : names.some((n) => n.includes(q))
        ? 1
        : id === q || (q.length >= 4 && id.includes(q))
          ? 2
          : -1;
    if (score >= 0) scored.push([score, p]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, p]) => p);
}
