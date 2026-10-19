// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// One party's money, fetched. The map says who seats whom; this reads what
// each of those seats is worth right now and what the party did with it:
//
//   - the seat in the Pot, off the chain (`live.ts`);
//   - a right in each fund above the party that holds something off chain —
//     a linked collective, or minted units — judged by that fund's own
//     claims log.
//
// Every figure is worked out in core (`loadJudgedClaims`, `partyStandings`,
// `accountBalances`); this module only decides WHICH holons to read, fetches
// their collective through our own relay route, and holds the answers for
// the length of a visit. Shares come off the map on screen (`graphRights`),
// so reading a fund never walks its children again.

import { get } from "svelte/store";
import {
  FLOW_CLAIMS_LENS,
  accountBalances,
  buildClaim,
  buildClaimVerdict,
  buildPayout,
  fitsHeadroom,
  graphRights,
  isValidCollectiveSlug,
  loadJudgedClaims,
  logLine,
  membershipsOf,
  partyStandings,
  potLine,
  readCollectiveSlug,
  saveCollectiveSlug,
  upstreamShares,
  type AccountBalance,
  type AccountLine,
  type Claim,
  type ClaimRail,
  type FlowGraphIndex,
  type JudgedClaims,
  type OpenCollectiveSnapshot,
  type Payout,
} from "@holons/core/flows";
import { isHolonAdmin, writeAcceptance } from "@holons/core/holosphere";
import { currentUser } from "./auth";
import { index, potId } from "./graph";
import { getHolosphere } from "./holosphere";
import { potLive, readAccounts } from "./live";

/** How many funds above a party are read for a statement. */
export const STATEMENT_FUNDS = 8;

export interface HolonFund {
  holon: string;
  /** The collective the holon linked, when it linked one. */
  slug: string;
  /** Its balance and movements, when it could be fetched. */
  collective: OpenCollectiveSnapshot | null;
  /** The holon's claims log, judged. Null when it could not be read. */
  judged: JudgedClaims | null;
  /**
   * Whether an entry signed by this session counts on the holon's logs: a
   * founded holon hears only its members. False means a claim filed from
   * here would be recorded and ignored — so it is not offered.
   */
  heard: boolean;
}

const quiet = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return (await run()) ?? fallback;
  } catch {
    return fallback;
  }
};

const collectives = new Map<string, Promise<OpenCollectiveSnapshot | null>>();

/** A collective's balance and movements, through our own relay route. */
export function fetchCollective(
  slug: string,
  force = false,
): Promise<OpenCollectiveSnapshot | null> {
  if (!isValidCollectiveSlug(slug)) return Promise.resolve(null);
  if (!force && collectives.has(slug)) return collectives.get(slug)!;
  const reading = quiet(async () => {
    const res = await fetch(
      `/api/opencollective?slug=${encodeURIComponent(slug)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as OpenCollectiveSnapshot;
  }, null);
  collectives.set(slug, reading);
  return reading;
}

const funds = new Map<string, Promise<HolonFund>>();

/** A holon's fund: its collective and its judged claims log. Read once per visit unless forced. */
export function loadFund(holonId: string, force = false): Promise<HolonFund> {
  const holon = String(holonId ?? "");
  if (!force && funds.has(holon)) return funds.get(holon)!;
  const reading = (async (): Promise<HolonFund> => {
    const hs = await quiet(() => getHolosphere(), null as any);
    if (!hs || !holon)
      return { holon, slug: "", collective: null, judged: null, heard: false };
    const settings = await quiet(
      () => (hs as any).get(holon, "settings", holon),
      null,
    );
    const slug = readCollectiveSlug(settings);
    const collective = slug ? await fetchCollective(slug, force) : null;
    const map = get(index);
    const shares =
      map?.byId.has(holon) && (map.out.get(holon)?.length ?? 0) > 0
        ? graphRights(map, holon)
        : null;
    const judged = await quiet(
      () => loadJudgedClaims(hs, holon, { collective, shares, ownOnly: true }),
      null,
    );
    // Asked after the log was read: that read pulled the membership too.
    (hs as any)._readAuthority?.invalidate(holon);
    const standing = await quiet(() => writeAcceptance(hs, holon), null);
    const heard = !!standing && standing.status !== "held";
    return { holon, slug, collective, judged, heard };
  })();
  funds.set(holon, reading);
  return reading;
}

/** One claim as a statement shows it: where it was raised, and how it was paid. */
export interface ActivityRow {
  holon: string;
  claim: Claim;
  payout: Payout | null;
}

/** A party's claims in one fund, newest first. */
export function activityOf(fund: HolonFund, party?: string): ActivityRow[] {
  const folded = fund.judged?.ctx.folded;
  if (!folded) return [];
  const paid = new Map(folded.payouts.map((p) => [p.claimId, p]));
  return folded.claims
    .filter((c) => party == null || c.party === party)
    .map((claim) => ({
      holon: fund.holon,
      claim,
      payout: paid.get(claim.id) ?? null,
    }))
    .sort((a, z) => z.claim.createdAt - a.claim.createdAt);
}

export interface Statement {
  lines: AccountLine[];
  balances: AccountBalance[];
  activity: ActivityRow[];
  /** The funds that were read, by holon. */
  funds: Record<string, HolonFund>;
  /** More funds stand above the party than were read. */
  partial: boolean;
}

export const EMPTY_STATEMENT: Statement = {
  lines: [],
  balances: [],
  activity: [],
  funds: {},
  partial: false,
};

/** The holons above a party whose fund may hold a right of its: who seats it first, then who stands further up. */
export function fundsAbove(map: FlowGraphIndex, party: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of [
    ...membershipsOf(map, party),
    ...upstreamShares(map, party),
  ]) {
    if (seen.has(row.id) || row.kind === "person" || row.kind === "placeholder")
      continue;
    seen.add(row.id);
    out.push(row.id);
  }
  return out;
}

/** Everything a party's account screen shows, read in one go. */
export async function loadStatement(
  party: string,
  force = false,
): Promise<Statement> {
  const map = get(index);
  const node = map?.byId.get(party);
  if (!map || !node) return EMPTY_STATEMENT;
  const above = fundsAbove(map, party);
  const read = above.slice(0, STATEMENT_FUNDS);

  const [seats, loaded] = await Promise.all([
    get(potLive).record ? quiet(() => readAccounts(party, node.rest), []) : [],
    Promise.all(read.map((h) => loadFund(h, force))),
  ]);

  const lines: AccountLine[] = seats.map((s) =>
    potLine({ holon: potId, unit: s.unit, token: s.token, account: s.account }),
  );
  const activity: ActivityRow[] = [];
  const byHolon: Record<string, HolonFund> = {};
  for (const fund of loaded) {
    byHolon[fund.holon] = fund;
    if (!fund.judged) continue;
    const held = new Set(fund.judged.held.map((u) => u.toUpperCase()));
    for (const s of partyStandings(fund.judged, party)) {
      // A unit the holon's Pot holds is collected on chain, never here.
      if (held.has(s.unit)) continue;
      lines.push(
        logLine({
          holon: fund.holon,
          unit: s.unit,
          headroom: s.headroom,
          totals: s.totals,
        }),
      );
    }
    activity.push(...activityOf(fund, party));
  }
  activity.sort((a, z) => z.claim.createdAt - a.claim.createdAt);
  return {
    lines,
    balances: accountBalances(lines),
    activity,
    funds: byHolon,
    partial: above.length > read.length,
  };
}

/**
 * May the signed-in person steer this holon — edit its split, link its
 * collective, answer its applications, mark its claims paid? Its membership
 * is pulled first, so the answer is the one its readers will enforce.
 */
export async function canSteer(holonId: string): Promise<boolean> {
  if (!get(currentUser) || !holonId) return false;
  return quiet(async () => {
    const hs = (await getHolosphere()) as any;
    await Promise.all([
      quiet(() => hs.getAll(holonId, "_members"), []),
      quiet(() => hs.get(holonId, "settings", holonId), null),
      quiet(() => hs.getAll(holonId, "users"), []),
    ]);
    hs._readAuthority?.invalidate(holonId);
    return isHolonAdmin(hs, holonId);
  }, false);
}

/** Ask a fund to pay part of a right: a claim on its log, signed as the person signed in. */
export async function requestClaim(
  holon: string,
  input: {
    party: string;
    amount: number;
    unit: string;
    rail: ClaimRail;
    memo?: string;
  },
): Promise<string> {
  const fund = await loadFund(holon);
  const standing = fund.judged
    ? partyStandings(fund.judged, input.party).find(
        (s) => s.unit === input.unit.toUpperCase(),
      )
    : null;
  if (!standing || !fitsHeadroom(standing.headroom, input.amount))
    throw new Error("over-right");
  const hs = (await getHolosphere()) as any;
  const a = buildClaim(input);
  const event = await hs.append(holon, FLOW_CLAIMS_LENS, a.item, {
    refs: a.refs,
  });
  await loadFund(holon, true);
  return event.id;
}

/** An attester's word on a claim. */
export async function judgeClaim(
  holon: string,
  claimId: string,
  verdict: "attest" | "dispute",
  reason?: string,
): Promise<void> {
  const hs = (await getHolosphere()) as any;
  const a = buildClaimVerdict(claimId, verdict, reason);
  await hs.append(holon, FLOW_CLAIMS_LENS, a.item, { refs: a.refs });
  await loadFund(holon, true);
}

/** Record that a claim was paid, how, and where the payment can be looked up. */
export async function markPaid(
  holon: string,
  claim: Claim,
  input: { rail?: ClaimRail; ref?: string },
): Promise<void> {
  const hs = (await getHolosphere()) as any;
  const a = buildPayout({
    claimId: claim.id,
    party: claim.party,
    amount: claim.amount,
    unit: claim.unit,
    rail: input.rail ?? claim.rail,
    ref: input.ref,
  });
  await hs.append(holon, FLOW_CLAIMS_LENS, a.item, { refs: a.refs });
  await loadFund(holon, true);
}

/** Link (or with an empty slug, unlink) a holon's collective. Returns the slug as stored. */
export async function linkCollective(
  holon: string,
  slug: string,
): Promise<string> {
  const hs = await getHolosphere();
  const saved = await saveCollectiveSlug(hs, holon, slug);
  funds.delete(holon);
  return saved;
}
