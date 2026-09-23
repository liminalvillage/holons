// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * From a signing key to a party.
 *
 * Actions are signed by keys; rights, balances and votes belong to parties
 * (a member id, a partner holon). One person holds several keys — the derived
 * Telegram key, a linked personal key, a browser device key — and they must
 * fold to one party or a claim under one key would not count against a
 * right earned under another. The sources already exist: kind-31926 identity
 * attestations (`shifts/attestation`), `linkedKeys` on the member's record,
 * the holon's own key. This module only orders them.
 */

import { attestationIdentityMap, parseIdentifier, type IdentityAttestation } from '../shifts/attestation.js';

export interface PartyResolver {
  /** The party a key acts for, or null when nobody claims it. */
  partyOf(pubkey: string): string | null;
  /** Every key known to act for a party. */
  keysOf(party: string): string[];
}

export interface PartyResolverInput {
  /** Key → party, e.g. from `partiesFromAttestations` or a host's trust cache. Highest precedence. */
  keyToParty?: Iterable<readonly [string, string]> | Map<string, string>;
  /** Party → keys, e.g. each member's `linkedKeys`. */
  linkedKeys?: Iterable<readonly [string, Iterable<string>]> | Map<string, Iterable<string>>;
  /** The holon's own key acts for the holon itself. */
  holonPubkey?: string | null;
  holonId?: string | null;
}

/**
 * Precedence, first claim wins: explicit key→party, then linked keys, then
 * the holon key. A key already bound to one party is never remapped.
 */
export function createPartyResolver(input: PartyResolverInput = {}): PartyResolver {
  const byKey = new Map<string, string>();
  const byParty = new Map<string, Set<string>>();
  const bind = (pubkey: string, party: string) => {
    const k = String(pubkey).toLowerCase();
    const p = String(party);
    if (!k || !p || byKey.has(k)) return;
    byKey.set(k, p);
    let set = byParty.get(p);
    if (!set) byParty.set(p, (set = new Set()));
    set.add(k);
  };
  for (const [k, p] of input.keyToParty ?? []) bind(k, p);
  for (const [p, keys] of input.linkedKeys ?? []) for (const k of keys ?? []) bind(k, p);
  if (input.holonPubkey && input.holonId) bind(input.holonPubkey, input.holonId);
  return {
    partyOf: (pubkey) => byKey.get(String(pubkey).toLowerCase()) ?? null,
    keysOf: (party) => [...(byParty.get(String(party)) ?? [])],
  };
}

/**
 * Key → party from identity attestations: the attested identifier
 * (`telegram:<id>`) becomes the party id every domain already uses (`<id>`).
 * The coordinator's directory outranks other providers and the earliest link
 * wins, as `attestationIdentityMap` decides.
 */
export function partiesFromAttestations(
  atts: Iterable<IdentityAttestation>,
  opts: { coordinatorPubkey?: string; blockedProviders?: readonly string[] } = {},
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [pubkey, identifier] of attestationIdentityMap(atts, opts)) {
    const parsed = parseIdentifier(identifier);
    out.set(pubkey, parsed ? parsed.id : identifier);
  }
  return out;
}
