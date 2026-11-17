// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Seating: who a holon's split may name, and the link a seated holon needs.
 *
 * A holon placed on a ring is only read back when the federation record
 * names it (`toAllocationPartners`), so every write that seats one links it
 * first. The link carries no data and moves no value — what pays is the
 * ring, and that is the split's own rule (an admin's write, or a proposal
 * the admins passed).
 *
 * `seatableParty` reads what a person typed or pasted — a holon id, a key
 * (hex or npub), a Telegram id, or a Flows link to any of them — into the
 * id a split stores.
 */

import { getFederationSnapshot } from '../federation/snapshot.js';
import { setFederationPartner } from '../federation/partners.js';
import { idKind, normalizeId } from '../identity/ids.js';

export interface SeatableParty {
  id: string;
  /** How a split stores it: a holon among the zones, anyone else among the people. */
  kind: 'holon' | 'person';
}

const HEX64 = /^[0-9a-f]{64}$/;
const ID_MAX = 200;

/** What a typed or pasted party is, or null when it names nobody. */
export function seatableParty(input: unknown): SeatableParty | null {
  let raw = String(input ?? '').trim();
  if (!raw) return null;
  // A Flows link: the id is the segment after /h/ or /p/.
  const link = /\/(h|p)\/([^/?#\s]+)/.exec(raw);
  if (link) {
    try {
      raw = decodeURIComponent(link[2]);
    } catch {
      raw = link[2];
    }
  }
  const id = normalizeId(raw);
  if (!id || id.length > ID_MAX || /[\s/?#]/.test(id)) return null;
  // A malformed npub is not a holon id.
  if (/^npub1/i.test(id)) return null;
  if (HEX64.test(id) || /^\d+$/.test(id)) return { id, kind: 'person' };
  return idKind(id) === 'holon' ? { id, kind: 'holon' } : null;
}

/**
 * Link each holon in `ids` that `holon`'s federation record does not name
 * yet. People need no link and are skipped, as is the holon itself.
 * Returns the ids linked by this call.
 */
export async function linkSeatedHolons(
  holosphere: any,
  holon: string,
  ids: Iterable<string>,
  names: Record<string, string> = {},
): Promise<string[]> {
  const self = String(holon ?? '');
  const wanted = [...new Set([...ids].map((id) => String(id ?? '')))].filter(
    (id) => id && id !== self && seatableParty(id)?.kind === 'holon',
  );
  if (!wanted.length) return [];
  let federated: string[] = [];
  try {
    federated = (await getFederationSnapshot(holosphere, self)).federated ?? [];
  } catch {
    federated = [];
  }
  const linked: string[] = [];
  for (const id of wanted) {
    if (federated.includes(id)) continue;
    const ok = await setFederationPartner(holosphere, self, id, {
      inbound: [],
      outbound: [],
      ...(names[id] ? { partnerName: names[id] } : {}),
    });
    if (!ok) throw new Error(`Could not link ${id} to the holon`);
    linked.push(id);
  }
  return linked;
}
