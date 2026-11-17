// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Split proposals, read and written (`split-proposals.ts` is the rule).
 *
 * An admin proposes a whole split; the other admins say yes or no; once more
 * than half said yes, the split is applied — by whichever admin's word made
 * it pass, at once, so nobody has to come back to press "apply". With one
 * admin, proposing applies: the same as saving, with a record.
 *
 * Applying writes through `saveAllocationConfig`, the one way every surface
 * saves a split, and only onto the split the proposal was drafted against:
 * if the stored split moved since, the proposal is stale and is refused.
 */

import { isHolonAdmin, resolveHolonAuthority } from '../holosphere/authority.js';
import { holonMembers } from '../protocol/founding.js';
import { loadAllocationInputs } from './cascade-load.js';
import { linkSeatedHolons } from './seating.js';
import { saveAllocationConfig } from './settings.js';
import type { SplitSave } from './split-draft.js';
import {
  FLOW_SPLIT_PROPOSALS_LENS,
  buildSplitMark,
  buildSplitProposal,
  buildSplitVerdict,
  foldSplitProposals,
  splitSaveHash,
  storedSplit,
  type FoldedSplitProposals,
  type SplitProposal,
} from './split-proposals.js';

const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.then((v) => v ?? fallback).catch(() => fallback);

export interface SplitProposalsContext extends FoldedSplitProposals {
  /** How many admins the holon has: the quorum is taken over them. */
  admins: number;
  /** `splitSaveHash` of the split as stored now. */
  current: string;
  /** Open proposals drafted against a split that has since moved. */
  stale: string[];
}

/** The hash of the holon's split as stored now. */
async function currentBase(holosphere: any, holon: string): Promise<string> {
  const inputs = await loadAllocationInputs(holosphere, holon);
  return splitSaveHash(storedSplit(inputs as never));
}

export async function loadSplitProposals(holosphere: any, holonId: string): Promise<SplitProposalsContext> {
  const holon = String(holonId ?? '');
  await quiet(holosphere.getAll(holon, FLOW_SPLIT_PROPOSALS_LENS), []);
  const [entries, members, current] = await Promise.all([
    quiet<any[]>(Promise.resolve().then(() => holosphere.getLog(holon, FLOW_SPLIT_PROPOSALS_LENS)), []),
    quiet(holonMembers(holosphere, holon), new Map()),
    quiet(currentBase(holosphere, holon), ''),
  ]);
  const admins = [...members.values()].filter((r) => r === 'admin').length;
  const folded = foldSplitProposals({ entries, actors: resolveHolonAuthority(holosphere, holon).actors, admins });
  return {
    ...folded,
    admins,
    current,
    stale: folded.open.filter((p) => current && p.base !== current).map((p) => p.id),
  };
}

async function mustSteer(holosphere: any, holon: string) {
  if (!(await isHolonAdmin(holosphere, holon))) throw new Error('Only an admin of the holon proposes or decides its split');
}

/** Apply a passed proposal: write its split, then say so on the log. */
export async function applySplitProposal(holosphere: any, holonId: string, proposalId: string): Promise<SplitProposal> {
  const holon = String(holonId ?? '');
  await mustSteer(holosphere, holon);
  const ctx = await loadSplitProposals(holosphere, holon);
  const p = ctx.proposals.find((x) => x.id === proposalId);
  if (!p) throw new Error('That proposal is not on this holon');
  if (p.status === 'applied') return p;
  if (p.status !== 'passed') throw new Error('Only a proposal that passed is applied');
  if (p.base !== ctx.current) throw new Error('The split changed since this was proposed: propose it again');
  // A holon seated by this split is read back only once the federation record names it.
  await linkSeatedHolons(holosphere, holon, Object.keys(p.split.zones ?? {}));
  await saveAllocationConfig(holosphere, holon, p.split.config, p.split.zones, p.split.people);
  const m = buildSplitMark(p.id, 'applied');
  await holosphere.append(holon, FLOW_SPLIT_PROPOSALS_LENS, m.item, { refs: m.refs });
  return { ...p, status: 'applied' };
}

/** What a word left the proposal as, applied when it passed. */
async function settle(holosphere: any, holon: string, id: string): Promise<SplitProposal | null> {
  const ctx = await loadSplitProposals(holosphere, holon);
  const p = ctx.proposals.find((x) => x.id === id) ?? null;
  if (p?.status === 'passed' && p.base === ctx.current) return applySplitProposal(holosphere, holon, id);
  return p;
}

/** Put a whole split forward, drafted against the split as stored now. */
export async function proposeSplit(
  holosphere: any,
  holonId: string,
  input: { split: SplitSave; note?: string },
): Promise<{ id: string; proposal: SplitProposal | null }> {
  const holon = String(holonId ?? '');
  await mustSteer(holosphere, holon);
  const base = await currentBase(holosphere, holon);
  const p = buildSplitProposal({ split: input.split, base, note: input.note });
  const event = await holosphere.append(holon, FLOW_SPLIT_PROPOSALS_LENS, p.item, { refs: p.refs });
  return { id: event.id, proposal: await settle(holosphere, holon, event.id) };
}

/** An admin's yes or no; a yes that makes it pass applies it. */
export async function decideSplitProposal(
  holosphere: any,
  holonId: string,
  proposalId: string,
  verdict: 'attest' | 'dispute',
  reason?: string,
): Promise<SplitProposal | null> {
  const holon = String(holonId ?? '');
  await mustSteer(holosphere, holon);
  const v = buildSplitVerdict(proposalId, verdict, reason);
  await holosphere.append(holon, FLOW_SPLIT_PROPOSALS_LENS, v.item, { refs: v.refs });
  return settle(holosphere, holon, proposalId);
}

/** The proposer takes it back. */
export async function withdrawSplitProposal(holosphere: any, holonId: string, proposalId: string): Promise<{ id: string }> {
  const m = buildSplitMark(proposalId, 'withdraw');
  const event = await holosphere.append(String(holonId), FLOW_SPLIT_PROPOSALS_LENS, m.item, { refs: m.refs });
  return { id: event.id };
}
