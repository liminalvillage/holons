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

/**
 * Read the `users` roster of each holon and fold them (`peopleAcross`). A
 * holon whose roster cannot be read — offline, private, gone — simply
 * contributes nobody.
 */
export async function loadPeopleAcross(hs: PeopleHost, holons: Iterable<string>, opts: LoadPeopleOptions = {}): Promise<PeopleAcross> {
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
  const lanes = Math.max(1, Math.min(opts.concurrency ?? 4, ids.length));
  const [identity] = await Promise.all([opts.identity ?? loadIdentity(hs), ...Array.from({ length: lanes }, worker)]);
  return peopleAcross(rosters, { ...opts, identity });
}
