// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// What the map cannot hold: the Pot as it is right now. The snapshot says who
// gets what share; this reads how much there is to share — what the Pot
// received on chain and what was minted to it — and, for a party, what its
// seat has brought: collected, collectable, accruing.
//
// Read once per visit and on demand; nothing here is cached on the device.
// Every amount is worked out in core (`potTotal`, `potAccount`); this only
// fetches the counters and holds them in stores.

import { get, writable } from "svelte/store";
import {
  loadMints,
  loadPotRecord,
  loadRights,
  potAccount,
  potClaimArgs,
  potTotal,
  potUnits,
  rightsByRef,
  rightsRow,
  type PotAccount,
  type PotRecord,
  type PotSources,
  type RightsTable,
} from "@holons/core/flows";
import { potId } from "./graph";
import { getHolosphere } from "./holosphere";
import {
  collectOnChain,
  potReceipts,
  readPotState,
  readTreasury,
  type PotState,
  type TreasuryState,
} from "./pot";

export interface PotLive {
  status: "idle" | "loading" | "ready";
  /** The Pot contract the holon recorded, when it has deployed one. */
  record: PotRecord | null;
  /** Its counters, when the chain could be read. */
  state: PotState | null;
  /** The table the Pot is paying from. */
  activeTable: RightsTable | null;
  /** The units there is something of, largest first. */
  units: string[];
  /** Unit → what the Pot has to divide in it. */
  totals: Record<string, number>;
  treasury: TreasuryState | null;
}

const EMPTY: PotLive = {
  status: "idle",
  record: null,
  state: null,
  activeTable: null,
  units: [],
  totals: {},
  treasury: null,
};

export const potLive = writable<PotLive>(EMPTY);

const quiet = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return (await run()) ?? fallback;
  } catch {
    return fallback;
  }
};

let loading: Promise<void> | null = null;

/** Read the Pot's record, counters, mints and active table. Quiet: what cannot be read is absent. */
export function loadPotLive(force = false): Promise<void> {
  if (!potId) return Promise.resolve();
  if (loading && !force) return loading;
  potLive.update((p) => ({ ...p, status: "loading" }));
  loading = (async () => {
    const hs = await quiet(() => getHolosphere(), null as any);
    if (!hs) {
      potLive.set({ ...EMPTY, status: "ready" });
      return;
    }
    const record = await quiet(() => loadPotRecord(hs, potId), null);
    const [state, mints, rights, treasury] = await Promise.all([
      record ? quiet(() => readPotState(record, record.tokens), null) : null,
      quiet(() => loadMints(hs, potId), null),
      record ? quiet(() => loadRights(hs, potId), null) : null,
      record?.treasury ? quiet(() => readTreasury(record), null) : null,
    ]);
    const sources: PotSources = {
      mints: mints?.folded ?? null,
      chain: potReceipts(state),
    };
    const units = potUnits(sources);
    const totals: Record<string, number> = {};
    for (const unit of units) totals[unit] = potTotal(unit, sources, null);
    const activeTable = state?.active?.tableRef
      ? (rightsByRef(rights?.folded, state.active.tableRef)?.table ?? null)
      : null;
    potLive.set({
      status: "ready",
      record,
      state,
      activeTable,
      units: units.filter((u) => totals[u] > 0),
      totals,
      treasury,
    });
  })();
  return loading;
}

export interface PartyAccount {
  party: string;
  unit: string;
  token: string;
  account: PotAccount;
  /** The active table has a row for this party it can still collect on. */
  canCollect: boolean;
}

/**
 * What a party's seat has brought in each unit the Pot holds on chain.
 * `sharePct` is what RESTS with the party — a project that passes everything
 * on accrues nothing itself.
 */
export async function readAccounts(
  party: string,
  sharePct: number,
): Promise<PartyAccount[]> {
  const live = get(potLive);
  if (!live.record) return [];
  const state = await quiet(
    () => readPotState(live.record!, live.record!.tokens, party),
    null,
  );
  if (!state) return [];
  return state.units
    .map((u) => {
      const row = rightsRow(live.activeTable, party, u.token);
      const account = potAccount({
        sharePct,
        decimals: u.decimals,
        received: u.received,
        declared: u.declared,
        cumulative: row?.cumulative ?? null,
        released: u.mine,
      });
      return {
        party,
        unit: u.unit,
        token: u.token,
        account,
        canCollect: account.collectable > 0,
      };
    })
    .filter((a) => a.account.total > 0);
}

/** Collect a party's row. Anyone may send it; the Pot pays the row's address. */
export async function collect(party: string, token: string): Promise<string> {
  const live = get(potLive);
  if (!live.record || !live.activeTable) throw new Error("no-table");
  const args = potClaimArgs(live.activeTable, party, token);
  if (!args) throw new Error("no-row");
  const hash = await collectOnChain(live.record, args);
  await loadPotLive(true);
  return hash;
}
