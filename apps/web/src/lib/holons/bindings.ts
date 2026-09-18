// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Who each share is paid to on chain, and binding it.
 *
 * `claim(userId, beneficiary)` on the guarded Bundle binds a member id to an
 * address — and re-binds it — and only the holon's owner wallet or the wallet
 * already bound may send it. Bound to another Bundle, the share is divided
 * again there: the on-chain cascade. The kiosk has the same two operations in
 * its `chain.ts`; the encoders and the who-may-bind rule are core's.
 */

import { ethers } from "ethers";
import {
  BUNDLE_BINDING_ABI,
  BUNDLE_CLAIM_ABI,
  bundleClaimArgs,
  describeChain,
  readBoundAddress,
  requiredChainId,
  type HolonBundleRecord,
} from "@holons/core/flows";

export class WrongNetworkError extends Error {
  constructor(
    public readonly want: number,
    public readonly actual: number,
  ) {
    super(
      `This Bundle is on ${describeChain(want)?.name}; the wallet is on ${describeChain(actual)?.name}. Switch the wallet to ${describeChain(want)?.name} first.`,
    );
    this.name = "WrongNetworkError";
  }
}

/**
 * Value never crosses chains. Before any write to a Bundle the wallet must be
 * on the chain the Bundle is recorded on — the same address holds a different
 * contract, or nothing, on another network. The wallet is asked to switch; a
 * refusal ends the write. Returns the chain the wallet is on, and a fresh
 * provider on it (ethers caches the network a provider first saw).
 */
export async function ensureChain(
  bundle: Pick<HolonBundleRecord, "chainId"> | null | undefined,
): Promise<{ chainId: number; provider: ethers.BrowserProvider }> {
  const eth = (window as any).ethereum;
  let provider = new ethers.BrowserProvider(eth);
  let actual = Number((await provider.getNetwork()).chainId);
  const want = requiredChainId(bundle);
  if (want != null && actual !== want) {
    try {
      await provider.send("wallet_switchEthereumChain", [
        { chainId: "0x" + want.toString(16) },
      ]);
    } catch {
      // Refused, or unknown to the wallet: said below.
    }
    provider = new ethers.BrowserProvider(eth);
    actual = Number((await provider.getNetwork()).chainId);
    if (actual !== want) throw new WrongNetworkError(want, actual);
  }
  return { chainId: actual, provider };
}

export interface BundleBindings {
  owner: string | null;
  /** By member id; null when unbound. Lower-case. */
  bound: Record<string, string | null>;
  /** Which bound addresses hold code — a sub-holon rather than a wallet. */
  isContract: Record<string, boolean>;
  /** Whether the contract knows the id: only a synced split seats a member. */
  member: Record<string, boolean>;
}

/** Read the owner and every listed member's binding. Reads prompt nothing. */
export async function readBindings(
  provider: ethers.Provider,
  bundleAddress: string,
  userIds: string[],
  expectedChainId?: number,
): Promise<BundleBindings | null> {
  // Never read the wrong chain's contract as this one.
  const want = requiredChainId({ chainId: expectedChainId });
  if (want != null) {
    const actual = Number((await provider.getNetwork()).chainId);
    if (actual !== want) return null;
  }
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

/**
 * Bind a member's share to `beneficiary` and pay out what is stored for them.
 * A contract beneficiary re-distributes in the same transaction, so the gas
 * is explicit: lagging nodes under-estimate a cascade.
 */
export async function bindMember(
  bundle: Pick<HolonBundleRecord, "address" | "chainId">,
  input: { userId: string; beneficiary: string },
): Promise<ethers.TransactionResponse> {
  const args = bundleClaimArgs(input);
  const { provider } = await ensureChain(bundle);
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(
    bundle.address,
    [BUNDLE_CLAIM_ABI],
    signer,
  );
  return contract.claim(...args, { gasLimit: 2_000_000n });
}
