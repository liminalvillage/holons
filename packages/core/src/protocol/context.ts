// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * From lens data to the three things every fold needs: who counts
 * (`AcceptedActors`), who each key is (`PartyResolver`) and the rules
 * (`_policy`, folded). One function so the kiosk, the web, the bot and the
 * MCP cannot drift: a domain (fund claims, governance votes) calls this,
 * then its own fold.
 */

import { bootstrapFromLenses, type LensBootstrapInput } from './bootstrap.js';
import { createPartyResolver, type PartyResolver } from './identity.js';
import { resolveAcceptedActors, type MembershipEnvelope } from './membership.js';
import { foldPolicies, policyFor } from './policy.js';
import type { AcceptedActors, LogEvent, Policy } from './types.js';

export interface LensContextInput {
  holonId: string;
  /** The `_policy` log, when the holon has one. */
  policyEntries?: Iterable<LogEvent<unknown>> | null;
  /** The signed `_members` envelopes (`readMembersLog`), when founded. */
  membersLog?: MembershipEnvelope[] | null;
  settings?: Record<string, unknown> | null;
  users?: LensBootstrapInput['users'];
  attestations?: LensBootstrapInput['attestations'];
  /** Key → party the caller knows beyond the lenses (the bot's derived keys). */
  extraKeyToParty?: Iterable<readonly [string, string]> | null;
  /** Keys the caller trusts beyond the lenses (the bot's derived member keys). */
  extraMembers?: Iterable<string> | null;
  holonPubkey?: string | null;
}

export interface LensContext {
  actors: AcceptedActors;
  parties: PartyResolver;
  /** Every lens's rule the admins have set. */
  policies: Map<string, Policy>;
  /** The rule for a lens, or the default. */
  policyFor(lens: string): Policy;
  holonPubkey: string | null;
}

/** Decide who counts and who each key is, from what the lenses hold. */
export function lensContext(input: LensContextInput): LensContext {
  const boot = bootstrapFromLenses({
    holonId: input.holonId,
    settings: input.settings,
    users: input.users,
    attestations: input.attestations,
    holonPubkey: input.holonPubkey,
  });
  for (const [k, party] of input.extraKeyToParty ?? []) if (!boot.keyToParty.has(k)) boot.keyToParty.set(k, party);
  const members = new Set([...boot.actors.members, ...(input.extraMembers ?? []), ...boot.keyToParty.keys()]);
  const actors = resolveAcceptedActors({
    membersLog: input.membersLog,
    genesis: boot.holonPubkey,
    bootstrap: { ...boot.actors, members: [...members] },
  });
  const parties = createPartyResolver({
    keyToParty: boot.keyToParty,
    linkedKeys: boot.linkedKeys,
    holonPubkey: boot.holonPubkey,
    holonId: input.holonId,
  });
  const policies = foldPolicies(input.policyEntries ?? [], actors);
  return {
    actors,
    parties,
    policies,
    policyFor: (lens) => policyFor(policies, lens),
    holonPubkey: boot.holonPubkey,
  };
}
