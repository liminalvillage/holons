// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Pushing the allocation split to the holon's Bundle contract from the kiosk.
//
// The kiosk has no contract manager of its own: it needs exactly one call,
// `syncAll`, on an address the settings lens already records. So this is a
// bare wallet call — the injected provider (MetaMask, Rabby, Brave …) signs,
// core encodes (`bundleSyncArgs`, the same numbers the dashboard sends), and
// the mirror is written afterwards through `saveAllocationConfig` so what the
// wallet-less readers see is what actually went on chain.

import { ethers } from "ethers";
import {
  BUNDLE_SYNC_ALL_ABI,
  bundleSyncArgList,
  bundleSyncArgs,
  resolveInteriorMembers,
  saveAllocationConfig,
  type AllocationConfig,
  type AllocationMember,
  type InteriorShares,
} from "@holons/core/flows";
import { isWalletAvailable } from "./login/ethereum";

export { isWalletAvailable };

export class ChainError extends Error {
  constructor(
    message: string,
    public readonly kind: "no-wallet" | "rejected" | "no-contract" | "failed",
  ) {
    super(message);
    this.name = "ChainError";
  }
}

export interface ChainSyncInput {
  bundleAddress: string;
  config: AllocationConfig;
  /** The equation's roster; swapped for `shares` under a custom split. */
  scored: AllocationMember[];
  shares: InteriorShares;
  /** Partners AND people on rings — the contract does not tell them apart. */
  placed: { id: string; zone: number }[];
}

/** The transaction-ready call for one draft. Pure, so the sheet can preview it. */
export function encodeChainSync(input: ChainSyncInput): unknown[] {
  const members = resolveInteriorMembers({
    config: input.config,
    scored: input.scored,
    shares: input.shares,
  }).map((m) => ({ userId: m.id, percentage: m.percentage }));
  return bundleSyncArgList(
    bundleSyncArgs({
      config: input.config,
      members,
      partners: input.placed,
    }),
  );
}

/**
 * Send `syncAll` and wait for it to be mined.
 *
 * The dashboard's manager uses a fixed 5M gas limit for this batch call
 * because lagging RPC nodes under-estimate it; the same limit is used here.
 * Returns the transaction hash.
 */
export async function syncAllocationOnChain(
  input: ChainSyncInput,
): Promise<string> {
  if (!isWalletAvailable()) {
    throw new ChainError("No Ethereum wallet in this browser.", "no-wallet");
  }
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  let signer: ethers.Signer;
  try {
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
  } catch (err: any) {
    if (isRejection(err))
      throw new ChainError("Wallet connection rejected.", "rejected");
    throw new ChainError(
      err?.message ?? "Could not connect the wallet.",
      "failed",
    );
  }

  // The bundle lives on one network; a wallet on another sees no code there
  // and would burn gas on a call to nothing.
  const code = await provider.getCode(input.bundleAddress).catch(() => "0x");
  if (!code || code === "0x") {
    throw new ChainError(
      "No contract at the bundle address on the wallet's network.",
      "no-contract",
    );
  }

  const contract = new ethers.Contract(
    input.bundleAddress,
    [BUNDLE_SYNC_ALL_ABI],
    signer,
  );
  try {
    const tx = await contract.syncAll(...encodeChainSync(input), {
      gasLimit: 5_000_000n,
    });
    const receipt = await tx.wait();
    if (receipt?.status !== 1) {
      throw new ChainError("The transaction failed on chain.", "failed");
    }
    return String(tx.hash);
  } catch (err: any) {
    if (err instanceof ChainError) throw err;
    if (isRejection(err))
      throw new ChainError("Transaction rejected.", "rejected");
    throw new ChainError(
      err?.shortMessage ?? err?.message ?? "Sync failed.",
      "failed",
    );
  }
}

/** The chain first, then the mirror every wallet-less surface reads. */
export async function syncAllocationOnChainAndMirror(
  store: any,
  holonId: string,
  input: ChainSyncInput,
  zones: Record<string, number>,
  people: Record<string, number>,
): Promise<string> {
  const hash = await syncAllocationOnChain(input);
  await saveAllocationConfig(
    store,
    holonId,
    input.config,
    zones,
    people,
    input.shares,
  );
  return hash;
}

function isRejection(err: any): boolean {
  return err?.code === 4001 || err?.code === "ACTION_REJECTED";
}
