// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The accepted-signer set and the key→party map, from lens data a browser
 * already syncs — for a holon nobody has founded yet, or a reader without
 * the derivation secret.
 *
 * The bot knows every member's derived key (it holds the secret); a browser
 * does not. What it does have: the holon's `settings` (the holon key, the
 * admin, explicitly trusted pubkeys), the `users` lens (each member's
 * `linkedKeys`) and the kind-31926 identity directory (`shift_identity`,
 * attested key → person). This assembles those into the same shape the
 * bot's trust cache produces, so both fold the same log the same way — up
 * to the derived keys the browser cannot know, which is why the result is
 * provisional until the holon is founded and the bot has synced the roster
 * into `_members`.
 */

import type { IdentityAttestation } from '../shifts/attestation.js';
import { linkedKeysOf } from '../users/keys.js';
import { partiesFromAttestations } from './identity.js';
import type { BootstrapInput } from './membership.js';

export interface LensBootstrapInput {
  holonId: string;
  /** The holon's settings record (`holonPubkey`, `admin`, `nostrTrustedPubkeys` are read). */
  settings?: Record<string, unknown> | null;
  /** The holon's `users` records (`id`, `linkedKeys`). */
  users?: ReadonlyArray<{ id?: string | number | null; linkedKeys?: readonly string[] | null } | null> | null;
  /** Identity attestations (`attestationsFrom(getAllGlobal('shift_identity'))`). */
  attestations?: Iterable<IdentityAttestation> | null;
  /** The holon's own key, when the caller knows it better than settings do. */
  holonPubkey?: string | null;
  coordinatorPubkey?: string;
  blockedProviders?: readonly string[];
}

export interface LensBootstrap {
  /** For `bootstrapActors` / `resolveAcceptedActors`. */
  actors: BootstrapInput;
  /** Key → party, for `createPartyResolver`. */
  keyToParty: Map<string, string>;
  /** Party → linked keys, for `createPartyResolver`. */
  linkedKeys: Map<string, string[]>;
  holonPubkey: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/i;
const hexKey = (v: unknown): string | null => (typeof v === 'string' && HEX64.test(v) ? v.toLowerCase() : null);

/** Assemble the provisional signer set and party map from lens data. */
export function bootstrapFromLenses(input: LensBootstrapInput): LensBootstrap {
  const settings = input.settings ?? {};
  const holonPubkey = hexKey(input.holonPubkey) ?? hexKey(settings.holonPubkey);
  const keyToParty = partiesFromAttestations(input.attestations ?? [], {
    coordinatorPubkey: input.coordinatorPubkey,
    blockedProviders: input.blockedProviders,
  });
  const linkedKeys = new Map<string, string[]>();
  const members = new Set<string>();
  for (const u of input.users ?? []) {
    if (!u || u.id === undefined || u.id === null) continue;
    const party = String(u.id);
    const keys = linkedKeysOf(u as never);
    if (keys.length) linkedKeys.set(party, keys);
    for (const k of keys) members.add(k.toLowerCase());
  }
  for (const [k, party] of keyToParty) {
    members.add(k.toLowerCase());
    if (!linkedKeys.has(party)) linkedKeys.set(party, []);
  }
  for (const k of Array.isArray(settings.nostrTrustedPubkeys) ? settings.nostrTrustedPubkeys : []) {
    const key = hexKey(k);
    if (key) members.add(key);
  }
  const admins = new Set<string>();
  if (holonPubkey) {
    members.add(holonPubkey);
    admins.add(holonPubkey);
    keyToParty.set(holonPubkey, String(input.holonId));
  }
  const adminId = settings.admin != null && String(settings.admin) !== '' ? String(settings.admin) : null;
  if (adminId) {
    for (const k of linkedKeys.get(adminId) ?? []) admins.add(k.toLowerCase());
    for (const [k, party] of keyToParty) if (party === adminId) admins.add(k.toLowerCase());
  }
  return {
    actors: { members: [...members], admins: [...admins], genesis: holonPubkey },
    keyToParty,
    linkedKeys,
    holonPubkey,
  };
}
