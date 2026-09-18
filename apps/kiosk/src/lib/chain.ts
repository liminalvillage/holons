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
  describeChain,
  readBoundAddress,
  requiredChainId,
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
    public readonly kind:
      | "no-wallet"
      | "rejected"
      | "no-contract"
      | "wrong-network"
      | "failed",
  ) {
    super(message);
    this.name = "ChainError";
  }
}

export interface ChainSyncInput {
  bundleAddress: string;
  /**
   * The chain the Bundle is recorded on. The write is refused unless the
   * wallet is on it (after asking the wallet to switch). Absent for a record
   * that never said, where "is there code at the address" is all there is.
   */
  chainId?: number;
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
 * Value never crosses chains. Before any write to a Bundle the wallet must be
 * on the chain the Bundle is recorded on: the same address holds a different
 * contract — or nothing — on another network (a deployer's nth deployment
 * lands on the same address on every chain). The wallet is asked to switch;
 * a refusal, or a wallet that cannot, ends the write. A record that never
 * said its chain is checked for code only, and the chain found is returned
 * so the caller can record it.
 */
async function ensureChain(
  provider: ethers.BrowserProvider,
  bundleAddress: string,
  expected: number | null | undefined,
): Promise<number> {
  const want = requiredChainId({ chainId: expected ?? undefined });
  let actual = Number((await provider.getNetwork()).chainId);
  if (want != null && actual !== want) {
    try {
      await provider.send("wallet_switchEthereumChain", [
        { chainId: "0x" + want.toString(16) },
      ]);
    } catch {
      // Refused, or the wallet does not know the chain: said below.
    }
    // A fresh provider: ethers caches the network it first saw.
    actual = Number(
      (await new ethers.BrowserProvider((window as any).ethereum).getNetwork())
        .chainId,
    );
    if (actual !== want) {
      throw new ChainError(
        `This Bundle is on ${describeChain(want)?.name}; the wallet is on ${
          describeChain(actual)?.name
        }. Switch the wallet to ${describeChain(want)?.name} first.`,
        "wrong-network",
      );
    }
  }
  const code = await provider.getCode(bundleAddress).catch(() => "0x");
  if (!code || code === "0x") {
    throw new ChainError(
      `No contract at the bundle address on ${describeChain(actual)?.name}.`,
      "no-contract",
    );
  }
  return actual;
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

  const chainId = await ensureChain(
    provider,
    input.bundleAddress,
    input.chainId,
  );
  // The switch above may have moved the wallet: sign on the chain we checked.
  const onChain = new ethers.BrowserProvider((window as any).ethereum);
  signer = await onChain.getSigner();
  lastWriteChainId = chainId;

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

/** The chain the last successful write went to — see `recordChainIfUnknown`. */
let lastWriteChainId: number | null = null;

/**
 * A record from before chains were recorded learns its chain from the first
 * write that reached it, so every later write is held to it.
 */
async function recordChainIfUnknown(
  store: any,
  holonId: string,
  bundle: HolonBundleRecord | null | undefined,
): Promise<void> {
  if (!bundle || requiredChainId(bundle) != null || lastWriteChainId == null)
    return;
  await saveBundleRecord(store, holonId, {
    ...bundle,
    chainId: lastWriteChainId,
  });
}

/** The chain first, then the mirror every wallet-less surface reads. */
export async function syncAllocationOnChainAndMirror(
  store: any,
  holonId: string,
  input: ChainSyncInput,
  zones: Record<string, number>,
  people: Record<string, number>,
  bundle?: HolonBundleRecord | null,
): Promise<string> {
  const hash = await syncAllocationOnChain({ ...input, holonId });
  await recordChainIfUnknown(store, holonId, bundle);
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
  const chainId = Number((await provider.getNetwork()).chainId);
  const record: HolonBundleRecord = {
    address,
    chainId,
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
  /** The chain the wallet is on — which is the chain these were read from. */
  chainId: number;
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
  expectedChainId?: number,
): Promise<BundleBindings | null> {
  if (!isWalletAvailable()) return null;
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  const chainId = Number((await provider.getNetwork()).chainId);
  // Never read the wrong chain's contract as this one: the panel says the
  // wallet is elsewhere instead (`chainStanding`).
  const want = requiredChainId({ chainId: expectedChainId });
  if (want != null && chainId !== want) return null;
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
  return { chainId, owner, bound, isContract, member };
}

/** The chain the browser wallet is on, without prompting; null without one. */
export async function walletChainId(): Promise<number | null> {
  if (!isWalletAvailable()) return null;
  try {
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    return Number((await provider.getNetwork()).chainId);
  } catch {
    return null;
  }
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
  /** The Bundle's recorded chain; the write is refused elsewhere. */
  chainId?: number;
  userId: string;
  beneficiary: string;
}): Promise<string> {
  const args = bundleClaimArgs(input);
  await connectedWallet();
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  lastWriteChainId = await ensureChain(
    provider,
    input.bundleAddress,
    input.chainId,
  );
  const signer = await new ethers.BrowserProvider(
    (window as any).ethereum,
  ).getSigner();
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
