// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Who "I" am on the map. Signing in gives one id — a Telegram id or a key —
// and the map may know me by more than that: a wallet login derives a fresh
// key that is seated nowhere, while the address behind it is where some seat
// is paid. So "mine" is the party I am, plus the parties paid at an address
// that is mine. The first I can act for; the others I can only watch, and
// collect for — anyone may send a collect, the Pot pays the row's address.

import {
  partiesByAddress,
  payoutAddressOf,
  readPayoutAddress,
  savePayoutAddress,
  type FlowGraphIndex,
} from "@holons/core/flows";
import { getHolosphere } from "./holosphere";

export interface MyParty {
  id: string;
  /** `self`: the party I signed in as. `address`: paid at a wallet of mine. */
  via: "self" | "address";
}

/** The parties of the graph that are mine, the one I am first. */
export function myParties(
  index: FlowGraphIndex | null,
  selfId: string | null,
  addresses: readonly (string | null | undefined)[],
): MyParty[] {
  if (!index) return [];
  const out: MyParty[] = [];
  const seen = new Set<string>();
  if (selfId && index.byId.has(selfId)) {
    out.push({ id: selfId, via: "self" });
    seen.add(selfId);
  }
  for (const address of addresses) {
    if (!address) continue;
    for (const id of partiesByAddress(index, address)) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, via: "address" });
    }
  }
  return out;
}

/** The account the browser wallet already shares with this site, without asking. */
export async function quietWalletAddress(): Promise<string | null> {
  const eth = (globalThis as any).ethereum;
  if (!eth?.request) return null;
  try {
    const accounts = await eth.request({ method: "eth_accounts" });
    const first = Array.isArray(accounts) ? accounts[0] : null;
    return typeof first === "string" ? first.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Where `partyId` is paid on `chainId`, read from its own settings. */
export async function loadPayout(
  partyId: string,
  chainId: number | null,
): Promise<string | null> {
  try {
    const hs = await getHolosphere();
    const settings = await (hs as any).get(partyId, "settings", partyId);
    return chainId != null
      ? payoutAddressOf(settings, chainId)
      : readPayoutAddress(settings);
  } catch {
    return null;
  }
}

/** Set where `partyId` is paid. Throws when the address is not one. */
export async function savePayout(
  partyId: string,
  address: string,
): Promise<void> {
  const hs = await getHolosphere();
  await savePayoutAddress(hs, partyId, address);
}

/**
 * The holons a person may stand behind besides themselves: the seats they
 * claimed, and the holons that seat them directly. Whether they STEER one is
 * the holon's own word (`canSteer`), asked by the caller.
 */
export function holonsNear(
  index: FlowGraphIndex | null,
  selfId: string | null,
  limit = 12,
): string[] {
  if (!index || !selfId) return [];
  const out = new Set<string>();
  for (const seat of index.aliasFrom.get(selfId) ?? []) out.add(seat);
  for (const link of index.into.get(selfId) ?? []) out.add(link.source);
  return [...out]
    .filter((id) => {
      const kind = index.byId.get(id)?.kind;
      return kind === "project" || kind === "fund" || kind === "pot";
    })
    .slice(0, limit);
}

const STEWARD_KEY = "flows_steward";

function stewardMemory(): Record<string, string[]> {
  try {
    const doc = JSON.parse(localStorage.getItem(STEWARD_KEY) ?? "{}");
    return doc && typeof doc === "object" ? doc : {};
  } catch {
    return {};
  }
}

/** Remember that `selfId` was seen to steward `holon`, so their front page can offer it. */
export function rememberSteered(selfId: string, holon: string): void {
  try {
    const doc = stewardMemory();
    doc[selfId] = [...new Set([holon, ...(doc[selfId] ?? [])])].slice(0, 24);
    localStorage.setItem(STEWARD_KEY, JSON.stringify(doc));
  } catch {
    /* private mode: the account is still reachable by search */
  }
}

/**
 * The accounts a person stewards: asked of each holon near them on the map
 * and each one this device saw them steward before. A steward need not be
 * seated anywhere, so the map alone cannot say.
 */
export async function steeredHolons(
  index: FlowGraphIndex | null,
  selfId: string | null,
  canSteer: (holon: string) => Promise<boolean>,
): Promise<string[]> {
  if (!index || !selfId) return [];
  const candidates = [
    ...new Set([
      ...holonsNear(index, selfId),
      ...(stewardMemory()[selfId] ?? []),
    ]),
  ].filter((id) => index.byId.has(id));
  const flags = await Promise.all(candidates.map((h) => canSteer(h)));
  return candidates.filter((_, i) => flags[i]);
}
