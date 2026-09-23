# The protocol: plural consensus over one immutable event space

Nostr keeps the signed claims. A holon derives its own reality from them:

```
Reality_H = collapse( verified entries ∩ accepted signers of H (as of each entry's time), rules of H )
```

There is no global ledger and no global consensus. There is one event space
(the relays), and every holon — every reader — folds the entries it accepts
into its own state, deterministically, so two readers holding the same set
derive the same state. Checkpoints let them check that they did.

## Where it lives

| layer | what | where |
|---|---|---|
| storage | append-only lenses on the **regular kind 1808**: every signed entry its own record (id = event id), never replaced, never tombstoned; `append` / `appendSigned` / `getLog` / `subscribeLog` | `packages/holosphere/log.js`, `store/wire.js` `createAppendWire`, `STORE.md` |
| meaning | the five record types, the reduce, the shared lens context, the partner import | `@holons/core/protocol` |
| first log | fund claims (`flow_claims`) | `@holons/core/flows` `claims.ts` |
| second log | governance votes (`governance_votes`) | `@holons/core/governance` `votes.ts`, counted by `tally.ts` `tallyBallots` |
| surfaces | kiosk Flows card + `/api/flows/log` (claims, votes, policy), kiosk Rules tab in the allocation panel, kiosk/web `ProposalVote` in the quest modals, web Fund allocation panel + Rules, MCP `flow_*` / `governance_*` / `protocol_*` tools, bot `/fundclaim` family + `/fundpolicy` + `/vote` `/votes` + new-moon checkpoints per lens | `apps/kiosk/src/lib/flowsClaims.ts`, `governanceVotes.ts`, `components/AllocationSettings.svelte`, `components/ProposalVote.svelte`; `apps/web/src/components/flows/Flows.svelte`, `governance/ProposalVote.svelte`; `packages/mcp-ui/src/tools/{flows,governance,protocol}.ts`; `packages/telegram-ui/src/{FundClaims,GovernanceVotes,protocolContext}.js` |

## The five record types

- **Action** — something a member says happened or should happen; the domain
  gives it a `kind` and a body (`claim`, `payout`, …). May carry `prev` (the
  author's previous entry: a chain that must not fork) and `basis` (what it
  consumes: spent twice is a conflict).
- **Attestation** — a signer's verdict on one action, `attests` or
  `disputes` on the `e` tag. Quorum and disputes are counted at reduce time;
  an attester's own action carries their attestation.
- **Membership** — holosphere's signed `_members` log: a genesis key, admins
  adding and removing keys, folded **as-of-time** (a removed key keeps the
  writes it signed while it was in). `buildTimeline` is the fold; core wraps
  it in `acceptedActors`.
- **Policy** — the holon's rule for a lens, an admin-signed entry of the
  `_policy` log: which roles author, which attest, the quorum, whether the
  first consumer of a basis wins (`earliest`) or a human decides (`quorum`),
  and the **partners** it imports, each pinned to its genesis pubkey.
  `DEFAULT_POLICY` when none. Edited in the kiosk's Rules tab, the web fund
  panel's Rules, MCP `protocol_policy_set`, bot `/fundpolicy`; a non-admin's
  entry is recorded and shown, never applied.
- **Checkpoint** — a merkle root over the accepted entries of a lens in one
  epoch (a lunar cycle, `lunationAt().index`), signed by a recognized key
  (the holon key). Readers `verifyCheckpoint` against their own fold; a
  mismatch is shown, never silently resolved.

## The reduce (`collapse`)

1. order by `(created_at, id)`;
2. drop entries whose author is not accepted **as of** that time;
3. drop actions whose author's role is not in `policy.authors`;
4. count attestations: latest word per attester per target; a dispute holds,
   fewer than `quorum` attests holds;
5. `prev` must name the author's last entry that counted or is held —
   else `fork`; a second consumer of a `basis` is `double-consume`
   (`earliest`) or held as `conflict` (`quorum`);
6. the domain's own `validate` over the running state (a claim past the
   right is held as `over`, kept and shown, not counted);
7. `fold` the accepted actions.

Nothing is deleted: every entry is judged (`accepted | pending | rejected`,
with a reason), so a UI shows the pending ones, and an entry counts
retroactively the moment its reason goes away — a key added, a quorum
reached, a dispute withdrawn.

## Votes

A proposal is still a `type:'proposal'` quest. A vote on it is an entry of
the `governance_votes` log — `vote { proposal, choice: yes|no|abstain, party }`
— judged by the same reduce (signer, role, quorum, disputes, `late` when the
caller knows the close) and folded to one counted vote per party per
proposal, the newest. `tallyBallots` counts the ballots the way
`tallyProposal` counted participants: reputation weights, delegation chains
followed to the voter's choice, a strict majority of every member's weight.
A change of mind is a newer entry; two votes stamped in the same second are
ordered by id, like everything else.

## Federation: a partner's accepted entries

Two holons share the event space and derive their own realities; a partner's
log is readable by its `h` tag. What enters a holon's fold is decided in
three steps (`protocol/federation.ts`):

1. **trust is data** — the importer's policy pins the partner's genesis
   pubkey (`policy.partners[holon]`). No trust on first use: a partner whose
   membership log was not founded by the pinned key folds with that key
   alone, marked `bootstrap`.
2. **the partner's own rules say what it accepted** — `importPartnerLog`
   collapses the partner's log with the partner's signers (as of time) and
   the partner's policy for the lens, no domain rule.
3. **the importer re-judges under its own policy** — `federatedActors` joins
   the importer's signers with the partners': the importer's word wins for a
   key it knows; a partner key counts as a `member` acting for the partner
   holon, never as an attester of the importer's entries. The partner's
   accepted entries ride into the importer's single collapse, so its quorum,
   attesters and domain rule (a partner claims its own right, votes as its
   own seat) apply, and a checkpoint over the importer's accepted set covers
   them.

Every surface reads the pinned partners' logs on the way in
(`importPartnerLogs`), re-read when the policy log moves.

## Who counts

The bot holds the holon key and the derivation secret, so it knows every
member's derived key: `createTrustCache.refresh` signs that roster into the
holon's `_members` log (`syncMembersLog`) — founding the holon once — and
records `settings.holonPubkey` so browsers pin the same trust anchor. Until a
holon is founded, readers fold with a **bootstrap** set assembled from lens
data (`bootstrapFromLenses`: the holon key, linked keys, attested keys,
`settings.nostrTrustedPubkeys`); the result is marked `source: 'bootstrap'`
and every surface says "provisional".

A browser's own device key is never an accepted signer. The kiosk signs a
Telegram user's entries server-side under their derived key
(`/api/flows/log`, a claim only for themselves); key logins sign with their
adopted key; the web instance already holds the member's derived key.

## What this does not do

No ordering or double-spend protection beyond the rules above — Nostr gives
neither, and scarce assets settle elsewhere. No content encryption (NIP-44
is a separate track), no relay write policy (NIP-42), no anchoring of
checkpoint roots to a chain (the root is there to be anchored). `enforce`
mode in holosphere stays off: this reduce runs only over append-only lenses,
and every replaceable lens keeps its last-writer-wins.

Open after Phase 4: policy for lenses other than `flow_claims` is set through
MCP/bot only (the kiosk Rules tab edits the claims rule); proposals have no
close time yet, so `late` is only a fold option; a partner's genesis is
pinned by hand (its `settings.holonPubkey`), not discovered.

Design notes and open decisions: `NOSTR-SIGNING-PLAN.md` in git history
(`git show 9f7eddc7^:packages/holosphere/NOSTR-SIGNING-PLAN.md`) is the RFC
this realizes; the append-only lens is documented in
`packages/holosphere/STORE.md` and `NOSTR-BACKEND.md`.
