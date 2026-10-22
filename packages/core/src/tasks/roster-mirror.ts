// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A card's roster, mirrored into each person's own holon.
 *
 * Everyone a task or an event names — its participants, and an event's hosts —
 * holds a hologram of it in their home holon (the holon whose id is their
 * own): a bare `{ id, soul }` pointer back to where the card lives. That is
 * what makes a card someone was added to show up under "my holon" on every
 * surface, and the pointer write is the signal each UI already reacts to.
 *
 * Core keeps that true on every write. `attachRosterMirror` wraps `put` on a
 * HoloSphere instance; after each write to a roster lens it compares the
 * roster that was stored with the one just written, writes a pointer for
 * everyone who came on and drops the pointer of everyone who went off.
 * `createHoloSphere` attaches it to every instance it builds, so adding a
 * person is just a roster edit — a self-service join, an edit form, a voice
 * command, an MCP tool — and no surface mirrors anything itself.
 *
 * The pointer is signed by whoever made the write, usually not a key the
 * person's holon accepts. It still reads there: the card it points at names
 * the holon (see `namesHolon` in `@holons/core/holosphere`), and stops being
 * read the moment it no longer does.
 *
 * Skipped on purpose:
 *   - a card that lives in the person's own holon (nothing to mirror, and a
 *     pointer must never point at itself);
 *   - an address in the person's holon that already holds something else —
 *     ids collide across holons, and a card of their own is not ours to
 *     replace or delete;
 *   - private (password) writes, tombstones, hologram pointers and federated
 *     full copies: mirrors of a card whose roster is kept where it lives.
 *
 * The primary write is never blocked: a mirror failure is logged and
 * swallowed.
 */

import {
  resolveWriteTarget,
  splitWriteArgs,
  storedItem,
  type WriteTarget,
  type WriteTargetHost,
} from '../holosphere/write-target.js';
import { personalHolonOf } from '../users/keys.js';
import { hostsOf } from './hosts.js';
import { participantsOf, rosterDiff } from './participants.js';
import type { Quest, QuestParticipant } from './types.js';

/** The lenses whose records carry a roster. */
export const ROSTER_LENSES: readonly string[] = ['quests', 'events'];

/** The slice of a HoloSphere instance the mirror touches. */
export interface RosterMirrorHost extends WriteTargetHost {
  put(holon: string | null, lens: string, data: any, passwordOrOptions?: any, options?: any): Promise<any>;
  delete(holon: string | null, lens: string, key: string, password?: any, options?: any): Promise<any>;
  get?(holon: string, lens: string, key: string, password?: any, options?: any): Promise<any>;
  createHologram?(holon: string, lens: string, data: { id: string }): { id: string; soul: string };
  appname?: string;
}

export interface AttachRosterMirrorOptions {
  /** Report a mirror failure; defaults to `console.warn`. */
  log?: (message: string, error?: unknown) => void;
}

const ATTACHED = Symbol.for('holons.rosterMirror.attached');

/** True when `attachRosterMirror` already wrapped this instance. */
export function hasRosterMirror(host: unknown): boolean {
  return !!host && typeof host === 'object' && (host as any)[ATTACHED] === true;
}

/**
 * Everyone a card names: its participants, then the hosts of an event who are
 * not also taking part. One entry per person.
 */
export function rosterOf(quest: Quest | null | undefined): QuestParticipant[] {
  if (!quest || typeof quest !== 'object') return [];
  const seen = new Set<string>();
  const out: QuestParticipant[] = [];
  for (const p of [...participantsOf(quest), ...hostsOf(quest)]) {
    if (!p || typeof p !== 'object' || p.id == null || String(p.id) === '') continue;
    const key = String(p.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** The roster the local store holds for a card; empty when it holds no readable card. */
function storedRoster(host: RosterMirrorHost, target: WriteTarget): QuestParticipant[] {
  const item = storedItem(host, target.holon, target.lens, target.key);
  if (!item || item._deleted === true || item._locked === true) return [];
  if (isPointer(host, item)) return [];
  return rosterOf(item as unknown as Quest);
}

function isPointer(host: RosterMirrorHost, claim: unknown): claim is { id: string; soul: string } {
  if (!claim || typeof claim !== 'object' || typeof (claim as any).soul !== 'string') return false;
  return host.isHologram ? host.isHologram(claim) : !('title' in (claim as object));
}

/** Is this stored claim a pointer at exactly this card? */
function pointsAt(host: RosterMirrorHost, claim: unknown, target: WriteTarget): boolean {
  if (!isPointer(host, claim)) return false;
  const soul = host.parseSoulPath?.(claim.soul);
  return (
    !!soul &&
    String(soul.holon) === target.holon &&
    soul.lens === target.lens &&
    String(soul.key) === target.key
  );
}

type MirrorState = 'absent' | 'mirror' | 'occupied';

/**
 * What a person's holon holds at the card's address. `raw` also looks at the
 * local store's own claim, for a pointer a read no longer shows.
 */
async function mirrorState(
  host: RosterMirrorHost,
  home: string,
  target: WriteTarget,
  raw: boolean,
): Promise<MirrorState> {
  let claim: any = null;
  if (host.get) {
    try {
      claim = await host.get(home, target.lens, target.key, null, { resolveHolograms: false });
    } catch {
      claim = null; // unreadable — treat as absent
    }
  }
  if (!claim && (raw || !host.get)) claim = storedItem(host, home, target.lens, target.key);
  if (!claim || claim._deleted === true) return 'absent';
  return pointsAt(host, claim, target) ? 'mirror' : 'occupied';
}

/** A person's home holon, when the card does not already live there. */
function homeOf(person: QuestParticipant, target: WriteTarget): string | null {
  if (person.id == null) return null;
  const home = personalHolonOf({ id: person.id });
  return home && home !== target.holon ? home : null;
}

/**
 * Wrap `host.put` so every roster write keeps the people's own holons in
 * line. Idempotent: attaching twice is a no-op. Returns the same instance.
 */
export function attachRosterMirror<T extends RosterMirrorHost>(host: T, opts: AttachRosterMirrorOptions = {}): T {
  if (hasRosterMirror(host)) return host;
  const log = opts.log ?? ((message: string, error?: unknown) => console.warn(message, error ?? ''));
  const rawPut = host.put;

  const mirrorWriteOptions = (options: Record<string, any>): Record<string, any> => {
    const out: Record<string, any> = {};
    if (options.actingAs !== undefined) out.actingAs = options.actingAs;
    if (options.local !== undefined) out.local = options.local;
    return out;
  };

  const pointerTo = (target: WriteTarget): { id: string; soul: string } =>
    host.createHologram
      ? host.createHologram(target.holon, target.lens, { id: target.key })
      : { id: target.key, soul: `${host.appname}/${target.holon}/${target.lens}/${target.key}` };

  host.put = async function rosterPut(this: T, holon: any, lens: any, data: any, passwordOrOptions: any = null, options: any = {}) {
    const { password, options: opts2 } = splitWriteArgs(passwordOrOptions, options);
    const eligible =
      holon != null &&
      typeof lens === 'string' &&
      ROSTER_LENSES.includes(lens) &&
      !password &&
      !opts2.preserveFederationMeta &&
      data &&
      typeof data === 'object' &&
      data._deleted !== true &&
      !(host.isHologram?.(data) ?? false);

    // Before the write: where it lands, who was on the card, and which of the
    // people going off hold a mirror of it. Their pointers are read now, while
    // the stored card still names them — afterwards a read no longer shows a
    // pointer the card stopped vouching for.
    let target: WriteTarget | null = null;
    let before: QuestParticipant[] = [];
    const leaving: string[] = [];
    if (eligible) {
      try {
        target = resolveWriteTarget(host, String(holon), lens, data, opts2);
        const origin = (data as any)._federation?.origin;
        if (!ROSTER_LENSES.includes(target.lens) || (origin != null && String(origin) !== target.holon)) {
          target = null;
        } else if (target.key) {
          before = storedRoster(host, target);
          for (const person of rosterDiff(before, rosterOf(data)).left) {
            const home = homeOf(person, target);
            if (home && (await mirrorState(host, home, target, true)) === 'mirror') leaving.push(home);
          }
        }
      } catch (err) {
        log('[roster] could not resolve write target', err);
        target = null;
      }
    }

    const result = await rawPut.call(this, holon, lens, data, passwordOrOptions, options);

    if (target) {
      // A record written without an id gets one from the write itself.
      const landed: WriteTarget = target.key ? target : { ...target, key: String(data.id ?? '') };
      if (landed.key) {
        const writeOptions = mirrorWriteOptions(opts2);
        // Through `host.put` / `host.delete` as they stand now, so whatever a
        // UI hung on them (a refresh, an announcement) sees the pointer too.
        for (const person of rosterDiff(before, rosterOf(data)).joined) {
          const home = homeOf(person, landed);
          if (!home) continue;
          try {
            const state = await mirrorState(host, home, landed, false);
            if (state === 'mirror') continue;
            if (state === 'occupied') {
              log(`[roster] ${home}/${landed.lens}/${landed.key} holds another record; not mirrored`);
              continue;
            }
            await host.put(home, landed.lens, pointerTo(landed), writeOptions);
          } catch (err) {
            log(`[roster] failed to mirror ${landed.key} into ${home}`, err);
          }
        }
        for (const home of leaving) {
          try {
            await host.delete(home, landed.lens, landed.key, null, writeOptions);
          } catch (err) {
            log(`[roster] failed to drop the mirror of ${landed.key} from ${home}`, err);
          }
        }
      }
    }
    return result;
  } as T['put'];

  Object.defineProperty(host, ATTACHED, { value: true, enumerable: false, configurable: true });
  return host;
}
