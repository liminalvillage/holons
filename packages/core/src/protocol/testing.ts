// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test fixtures for the protocol: real signed entries without a holosphere
 * instance, in exactly the shape `getLog` yields. Shared by every spec that
 * reduces a log — here, in flows, in governance.
 */

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { HOLOSPHERE_LOG_KIND, logRefs } from 'holosphere/nostr-events.js';
import type { MembershipEnvelope } from './membership.js';
import type { LogEvent, RefsInput, Role } from './types.js';

export interface TestKey {
  sk: Uint8Array;
  pk: string;
}

export function testKey(): TestKey {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}

export interface SignedEntryInput<T> {
  sk: Uint8Array;
  item: T;
  refs?: RefsInput;
  created_at?: number;
  holon?: string;
  lens?: string;
  app?: string;
}

/** A signed kind-1808 entry, as a `LogEvent` (plus the raw `event`). */
export function signedEntry<T extends Record<string, unknown>>(input: SignedEntryInput<T>): LogEvent<T> & { event: ReturnType<typeof finalizeEvent> } {
  const tags: string[][] = [['h', input.holon ?? 'h1'], ['l', input.lens ?? 'log']];
  for (const [marker, v] of Object.entries(input.refs ?? {})) {
    for (const id of Array.isArray(v) ? v : [v]) if (id) tags.push(['e', String(id), '', marker]);
  }
  tags.push(['n', input.app ?? 'protocol-test']);
  const event = finalizeEvent(
    { kind: HOLOSPHERE_LOG_KIND, created_at: input.created_at ?? Math.floor(Date.now() / 1000), tags, content: JSON.stringify(input.item) },
    input.sk,
  );
  return { id: event.id, pubkey: event.pubkey, created_at: event.created_at, refs: logRefs(event), item: input.item, event };
}

/** A signed `_members` envelope in holosphere's own shape. */
export function membershipOp(input: {
  sk: Uint8Array;
  op: 'genesis' | 'add' | 'remove';
  pubkey?: string;
  role?: Role;
  created_at: number;
  holon?: string;
  app?: string;
}): MembershipEnvelope {
  const holon = input.holon ?? 'h1';
  const id = input.op === 'genesis' ? 'genesis' : `${input.op}:${input.pubkey}:${input.created_at}`;
  const body = { id, op: input.op, ...(input.pubkey ? { pubkey: input.pubkey } : {}), ...(input.role ? { role: input.role } : {}) };
  return finalizeEvent(
    {
      kind: 30078,
      created_at: input.created_at,
      tags: [['h', holon], ['l', '_members'], ['d', `${holon}/_members/${id}`], ['n', input.app ?? 'protocol-test']],
      content: JSON.stringify(body),
    },
    input.sk,
  );
}

/** A deterministic shuffle (seeded LCG), for order-independence tests. */
export function shuffled<T>(items: readonly T[], seed = 7): T[] {
  const out = [...items];
  let s = seed >>> 0;
  const next = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
