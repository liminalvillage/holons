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
  BUNDLE_BINDING_ABI,
  BUNDLE_BYTECODE,
  BUNDLE_CLAIM_ABI,
  BUNDLE_CONSTRUCTOR_ABI,
  BUNDLE_SYNC_ALL_ABI,
  bundleClaimArgs,
  bundleConstructorArgList,
  bundleConstructorArgs,
  bundleSyncArgList,
  bundleSyncArgs,
  chainInteriorRoster,
  readBoundAddress,
  resolveInteriorMembers,
  saveAllocationConfig,
  saveBundleRecord,
  type AllocationConfig,
  type AllocationMember,
  type HolonBundleRecord,
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
  /**
   * The holon being synced. With it, a split that has an interior share but
   * nobody in it seats the holon itself (core `chainInteriorRoster`) — the
   * Bundle has no withdraw, so a pot paid to no one would be stranded.
   */
  holonId?: string;
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
      members: chainInteriorRoster(
        input.holonId ?? "",
        members,
        input.config.interiorPercent,
      ),
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
  const hash = await syncAllocationOnChain({ ...input, holonId });
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

// ── Deploying ────────────────────────────────────────────────────────────
// A holon with no Bundle yet gets one from the kiosk the way the dashboard
// makes it: the connected wallet owns it, the holon id is its creator member
// and its name (core `bundleConstructorArgs`), and the record lands on the
// canonical settings document through core `saveBundleRecord`.

/**
 * Deploy a Bundle for `holonId` and record it. Returns the record, which is
 * what the split is then synced to. Gas is estimated — a deploy is not
 * state-dependent the way a cascade is, so the estimate holds.
 */
export async function deployBundleOnChain(
  store: any,
  holonId: string,
  config: Pick<AllocationConfig, "steepness" | "nzones">,
): Promise<HolonBundleRecord> {
  const owner = await connectedWallet();
  const args = bundleConstructorArgs({ owner, holonId, config });
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  const signer = await provider.getSigner();
  const factory = new ethers.ContractFactory(
    [BUNDLE_CONSTRUCTOR_ABI],
    BUNDLE_BYTECODE,
    signer,
  );
  let address = "";
  let txHash = "";
  try {
    const contract = await factory.deploy(...bundleConstructorArgList(args));
    const tx = contract.deploymentTransaction();
    txHash = String(tx?.hash ?? "");
    const receipt = await tx?.wait();
    if (receipt?.status !== 1) {
      throw new ChainError("The deployment failed on chain.", "failed");
    }
    address = String(receipt.contractAddress ?? (await contract.getAddress()));
  } catch (err: any) {
    if (err instanceof ChainError) throw err;
    if (isRejection(err))
      throw new ChainError("Transaction rejected.", "rejected");
    throw new ChainError(
      err?.shortMessage ?? err?.message ?? "Deployment failed.",
      "failed",
    );
  }
  const record: HolonBundleRecord = {
    address,
    creatorUserId: args.creatorUserId,
    steepness: args.steepness.toString(),
    nzones: Number(args.nzones),
    deployedAt: Date.now(),
    txHash,
  };
  await saveBundleRecord(store, holonId, record);
  return record;
}

// ── Bindings ─────────────────────────────────────────────────────────────
// Who a member's share is paid to on chain. `claim(userId, beneficiary)` on
// the guarded Bundle binds it — and re-binds it — and only the holon's owner
// wallet or the wallet already bound may send it. Bound to another Bundle,
// the share is divided again there: the on-chain cascade.

export interface BundleBindings {
  owner: string | null;
  /** By member id; null when unbound. Lower-case. */
  bound: Record<string, string | null>;
  /** Which bound addresses hold code — a sub-holon rather than a wallet. */
  isContract: Record<string, boolean>;
  /**
   * Whether the contract knows the id at all. Only a synced split seats a
   * member; a party added in the sheet since is not on chain yet and cannot
   * be bound until the split is updated there.
   */
  member: Record<string, boolean>;
}

/**
 * Read the owner and every listed member's binding. Reads need no account,
 * only a provider, so nothing is prompted; without a wallet in the browser
 * there is no provider and the answer is null.
 */
export async function readBindings(
  bundleAddress: string,
  userIds: string[],
): Promise<BundleBindings | null> {
  if (!isWalletAvailable()) return null;
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  const code = await provider.getCode(bundleAddress).catch(() => "0x");
  if (!code || code === "0x") return null;
  const contract = new ethers.Contract(
    bundleAddress,
    [...BUNDLE_BINDING_ABI],
    provider,
  );
  const owner = readBoundAddress(await contract.owner().catch(() => null));
  const bound: Record<string, string | null> = {};
  const isContract: Record<string, boolean> = {};
  const member: Record<string, boolean> = {};
  await Promise.all(
    userIds.map(async (id) => {
      const addr = readBoundAddress(
        await contract.userIdToAddress(String(id)).catch(() => null),
      );
      bound[id] = addr;
      isContract[id] = addr
        ? (await provider.getCode(addr).catch(() => "0x")) !== "0x"
        : false;
      member[id] = Boolean(
        await contract.isBundleMember(String(id)).catch(() => false),
      );
    }),
  );
  return { owner, bound, isContract, member };
}

/** The address the wallet would sign with, asking to connect if needed. */
export async function connectedWallet(): Promise<string> {
  if (!isWalletAvailable()) {
    throw new ChainError("No Ethereum wallet in this browser.", "no-wallet");
  }
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  try {
    await provider.send("eth_requestAccounts", []);
    return (await provider.getSigner()).getAddress();
  } catch (err: any) {
    if (isRejection(err))
      throw new ChainError("Wallet connection rejected.", "rejected");
    throw new ChainError(
      err?.message ?? "Could not connect the wallet.",
      "failed",
    );
  }
}

/**
 * Bind a member's share to `beneficiary` and pay out what is stored for them.
 *
 * A contract beneficiary re-distributes in the same transaction, so the gas
 * is set explicitly: lagging nodes under-estimate a cascade and the call
 * would run out mid-way. Returns the transaction hash.
 */
export async function bindOnChain(input: {
  bundleAddress: string;
  userId: string;
  beneficiary: string;
}): Promise<string> {
  const args = bundleClaimArgs(input);
  await connectedWallet();
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  const signer = await provider.getSigner();
  const code = await provider.getCode(input.bundleAddress).catch(() => "0x");
  if (!code || code === "0x") {
    throw new ChainError(
      "No contract at the bundle address on the wallet's network.",
      "no-contract",
    );
  }
  const contract = new ethers.Contract(
    input.bundleAddress,
    [BUNDLE_CLAIM_ABI],
    signer,
  );
  try {
    const tx = await contract.claim(...args, { gasLimit: 2_000_000n });
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
      err?.reason ?? err?.shortMessage ?? err?.message ?? "Binding failed.",
      "failed",
    );
  }
}

function isRejection(err: any): boolean {
  return err?.code === 4001 || err?.code === "ACTION_REJECTED";
}
