// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @holons/core/protocol — plural consensus over one immutable event space.
 *
 * Nostr keeps the signed claims (holosphere's append-only lenses, kind
 * 1808). A holon derives its own reality from them:
 *
 *     Reality_H = collapse(verified entries ∩ accepted signers of H, rules of H)
 *
 * Five record types carry it — Action, Attestation, Membership, Policy,
 * Checkpoint — and this module owns what each one means: who counts as of
 * when (`membership`), which key acts for which party (`identity`), the
 * lens's rule (`policy`), the reduce itself (`reduce`) and the root a signer
 * publishes so readers can compare folds (`checkpoint`). Domains (flows,
 * governance) bring the fold and the validation; UIs render the result.
 */

export type { AcceptedActors, Appendable, LogEvent, LogRefs, Policy, RefsInput, Role } from './types.js';
export { byLogOrder } from './types.js';

export {
  MEMBERS_LENS,
  POLICY_LENS,
  CHECKPOINTS_LENS,
  PROTOCOL_LENSES,
  action,
  attestation,
  attestationTarget,
  attestationVerdict,
  isAction,
  isAttestation,
  isCheckpoint,
  isPolicy,
  recordType,
  type ActionRecord,
  type AttestationRecord,
  type CheckpointRecord,
  type PolicyRecord,
  type ProtocolRecord,
  type RecordType,
} from './events.js';

export {
  actorsFromMembersLog,
  bootstrapActors,
  resolveAcceptedActors,
  readMembersLog,
  syncMembersLog,
  type BootstrapInput,
  type MembersSyncResult,
  type MembershipEnvelope,
} from './membership.js';

export { createPartyResolver, partiesFromAttestations, type PartyResolver, type PartyResolverInput } from './identity.js';

export { DEFAULT_POLICY, normalizePolicy, policyRecord, foldPolicies, policyFor } from './policy.js';

export {
  collapse,
  type CollapseInput,
  type CollapseResult,
  type EntryStatus,
  type HoldReason,
  type Judged,
  type RejectReason,
  type Verdict,
} from './reduce.js';

export {
  EMPTY_ROOT,
  merkleRoot,
  epochOf,
  entriesInEpoch,
  buildCheckpoint,
  verifyCheckpoint,
  foldCheckpoints,
  checkpointKey,
  type CheckpointVerdict,
} from './checkpoint.js';
