// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ONE rule for "does this key count for this holon, at that moment".
 *
 * The answer is itself a fold over signed events: holosphere's `_members`
 * log (a genesis key, admins adding and removing keys, folded as-of-time so
 * a removed key keeps the writes it signed while it was in). Core wraps that
 * fold — `buildTimeline` — and adds the two things holosphere leaves to the
 * app: what to do before a holon has been founded, and how the existing
 * membership (the `users` lens the bot maintains) becomes signed ops.
 *
 * Who is allowed to define reality is the product of previously signed
 * reality. Genesis is the base case.
 */

import { buildTimeline, type MembershipEnvelope } from 'holosphere/signing.js';
import type { HoloSphere } from 'holosphere';
import { MEMBERS_LENS } from './events.js';
import type { AcceptedActors, Role } from './types.js';

export type { MembershipEnvelope };

/**
 * The actors a holon's signed membership log defines. `null` when the log
 * has no genesis (nothing to anchor trust to — use `bootstrapActors`).
 * `genesis` pins the anchor; without it the earliest self-signed genesis is
 * trusted on first use.
 */
export function actorsFromMembersLog(events: MembershipEnvelope[], genesis?: string | null): AcceptedActors | null {
  const tl = buildTimeline(events ?? [], genesis ?? undefined);
  if (!tl.genesisPub) return null;
  return {
    source: 'log',
    genesis: tl.genesisPub,
    isAcceptedAt: (pub, at) => tl.isAuthorizedAt(pub, at),
    roleAt: (pub, at) => tl.roleAt(pub, at),
  };
}

export interface BootstrapInput {
  /** Keys that count as members (the holon key, members' derived keys, linked keys, trusted pubkeys). */
  members: Iterable<string>;
  /** Keys that also count as admins (the holon key, `settings.admin` members). */
  admins?: Iterable<string>;
  /** The holon key, when known — reported as the anchor. */
  genesis?: string | null;
}

/**
 * Time-blind actors for a holon nobody has founded yet: the CURRENT list,
 * applied to every moment. Reads reduce, but the result is provisional
 * (`source: 'bootstrap'`) — a UI says so.
 */
export function bootstrapActors(input: BootstrapInput): AcceptedActors {
  const admins = new Set([...(input.admins ?? [])].map((k) => k.toLowerCase()));
  const members = new Set([...(input.members ?? [])].map((k) => k.toLowerCase()));
  for (const a of admins) members.add(a);
  return {
    source: 'bootstrap',
    genesis: input.genesis ?? null,
    isAcceptedAt: (pub) => members.has(String(pub).toLowerCase()),
    roleAt: (pub) => {
      const k = String(pub).toLowerCase();
      return admins.has(k) ? 'admin' : members.has(k) ? 'member' : null;
    },
  };
}

/** The signed log when it has a genesis, the bootstrap list otherwise. */
export function resolveAcceptedActors(input: {
  membersLog?: MembershipEnvelope[] | null;
  genesis?: string | null;
  bootstrap?: BootstrapInput | null;
}): AcceptedActors {
  const fromLog = input.membersLog?.length ? actorsFromMembersLog(input.membersLog, input.genesis) : null;
  if (fromLog) return fromLog;
  return bootstrapActors(input.bootstrap ?? { members: [], genesis: input.genesis ?? null });
}

/** Every signed `_members` envelope the instance holds for a holon (verified on apply). */
export async function readMembersLog(hs: HoloSphere, holon: string): Promise<MembershipEnvelope[]> {
  await hs.ready();
  const store = hs.store;
  const out: MembershipEnvelope[] = [];
  for (const id of store.listEventIds(String(holon), MEMBERS_LENS)) {
    for (const e of store.getEvents(String(holon), MEMBERS_LENS, id)) out.push(e as MembershipEnvelope);
  }
  return out;
}

export interface MembersSyncResult {
  founded: boolean;
  added: string[];
  removed: string[];
  /** Keys whose role changed (removed then re-added). */
  changed: string[];
}

export interface MembersSyncOptions {
  /**
   * Unseat keys that are in the log but not in `desired` (default true).
   * Pass false when `desired` may be incomplete — a roster read that came
   * back empty on a cold start must never be taken as "nobody is a member":
   * removal is as-of-time, so every write those keys make until they are
   * re-added would be lost to every reader.
   */
  prune?: boolean;
}

/**
 * Bring a holon's signed `_members` log in line with `desired` (pubkey →
 * role), signing with the instance key. Founds the holon on first use (the
 * instance key becomes genesis admin), then adds, removes and re-roles the
 * difference. Idempotent: an unchanged roster issues nothing. The instance
 * must hold the holon key (or an admin key) for the ops to count.
 */
export async function syncMembersLog(hs: HoloSphere, holon: string, desired: Map<string, Role>, opts: MembersSyncOptions = {}): Promise<MembersSyncResult> {
  const result: MembersSyncResult = { founded: false, added: [], removed: [], changed: [] };
  const h = String(holon);
  const want = new Map<string, Role>();
  for (const [k, r] of desired) want.set(k.toLowerCase(), r === 'admin' ? 'admin' : 'member');
  const me = hs.currentPubkey.toLowerCase();

  let current = await hs.getMembers(h);
  if (!current.size) {
    await hs.foundHolon(h);
    result.founded = true;
    current = await hs.getMembers(h);
  }
  // Ops are folded by (time, id): a remove and a re-add of one key in the
  // same second would sort `add` before `remove` and drop the key, so the
  // re-add is stamped one second later.
  const now = Math.floor(Date.now() / 1000);
  for (const [pub, role] of want) {
    if (pub === me) continue; // genesis is an admin by construction
    const have = current.get(pub);
    if (have === role) continue;
    if (have) {
      await hs.removeMember(h, pub, { at: now });
      await hs.addMember(h, pub, role, { at: now + 1 });
      result.changed.push(pub);
    } else {
      await hs.addMember(h, pub, role, { at: now });
      result.added.push(pub);
    }
  }
  if (opts.prune === false) return result;
  for (const pub of current.keys()) {
    if (pub === me || want.has(pub)) continue;
    await hs.removeMember(h, pub, { at: now });
    result.removed.push(pub);
  }
  return result;
}
