// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who reads on behalf of a holon. A personal holon (its id is a pubkey) reads
// through that key and the keys its own signed `users` record links. A group
// holon reads through its NIP-29 state — the `p` tags of its kind-39001
// admins and kind-39002 members — signed by its anchor (the genesis of its
// `_members` log, else the earliest self-signed `holonPubkey`), which is the
// same state `publishGroupState` keeps current. Nothing else is consulted:
// a holon with no signed state has no readers yet, and that is an answer.

import type { HoloSphere } from 'holosphere';
import { holonAnchor, membersEvents } from 'holosphere/authority.js';
import { verifyEvent } from 'nostr-tools/pure';
import { personalReaderKeys } from '../holosphere/authority.js';
import { GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND } from '../nostr/groups.js';
import { buildTimeline } from 'holosphere/signing.js';
import { isPubkeyHolonId } from './scope.js';
import type { HolonReaders } from './types.js';

type ReaderHost = HoloSphere & {
  _relaySync?: (holon: string, lens: string, opts?: { await?: boolean }) => Promise<unknown>;
  store: { listEventIds(holon: string | null, lens: string): string[]; getEvents(holon: string | null, lens: string, id: string): unknown[] };
};

interface StateEvent {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  [k: string]: unknown;
}

export interface HolonReadersOptions {
  /** How long to listen for the group state on the relays (ms). */
  windowMs?: number;
}

/** The NIP-29 state of a holon as its anchor last signed it: newest 39001 and 39002. */
async function groupState(hs: ReaderHost, holon: string, anchor: string, windowMs: number): Promise<StateEvent[]> {
  const relays = typeof hs.nostrRelays === 'function' ? hs.nostrRelays() : [];
  if (!relays.length || typeof hs.subscribeNostr !== 'function') return [];
  const newest = new Map<number, StateEvent>();
  await new Promise<void>((resolve) => {
    let close: (() => void) | null = null;
    const finish = () => {
      try { close?.(); } catch { /* closed */ }
      resolve();
    };
    const timer = setTimeout(finish, windowMs);
    try {
      close = hs.subscribeNostr(
        { kinds: [GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND], '#d': [holon], authors: [anchor] },
        (event: StateEvent) => {
          if (!event || String(event.pubkey).toLowerCase() !== anchor) return;
          if (!event.tags?.some((t) => t[0] === 'd' && t[1] === holon)) return;
          try { if (!verifyEvent(event as never)) return; } catch { return; }
          const cur = newest.get(event.kind);
          if (!cur || cur.created_at < event.created_at) newest.set(event.kind, event);
        },
      );
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
  return [...newest.values()];
}

const pTags = (events: StateEvent[]): string[] =>
  events.flatMap((e) => e.tags.filter((t) => t[0] === 'p' && /^[0-9a-f]{64}$/i.test(t[1] ?? '')).map((t) => t[1].toLowerCase()));

/**
 * The keys that read on behalf of `holonId`. Never throws: a holon nothing
 * signed speaks for has `kind: 'none'` and no keys.
 */
export async function holonReaders(hs: HoloSphere, holonId: string, opts: HolonReadersOptions = {}): Promise<HolonReaders> {
  const id = String(holonId ?? '').trim();
  if (!id) return { keys: [], kind: 'none' };
  if (isPubkeyHolonId(id)) return { keys: personalReaderKeys(hs, id), kind: 'personal' };
  const host = hs as ReaderHost;
  await hs.ready();
  for (const lens of ['_members', 'settings']) {
    try { await host._relaySync?.(id, lens, { await: true }); } catch { /* offline: the store decides */ }
  }
  const anchor = holonAnchor(host.store, id);
  if (!anchor) return { keys: [], kind: 'none' };
  const keys = new Set<string>([anchor.toLowerCase()]);
  for (const k of pTags(await groupState(host, id, anchor.toLowerCase(), opts.windowMs ?? 1500))) keys.add(k);
  // The signed log this instance holds is the same roster the state is built from.
  const log = membersEvents(host.store, id) as never[];
  if (log.length) {
    try {
      for (const [pub] of buildTimeline(log).currentMembers()) keys.add(String(pub).toLowerCase());
    } catch { /* an unreadable log adds nothing */ }
  }
  return { keys: [...keys].sort(), kind: 'group' };
}
