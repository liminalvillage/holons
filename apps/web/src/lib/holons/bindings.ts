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
  readBoundAddress,
} from "@holons/core/flows";

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
): Promise<BundleBindings | null> {
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
  signer: ethers.Signer,
  input: { bundleAddress: string; userId: string; beneficiary: string },
): Promise<ethers.TransactionResponse> {
  const args = bundleClaimArgs(input);
  const contract = new ethers.Contract(
    input.bundleAddress,
    [BUNDLE_CLAIM_ABI],
    signer,
  );
  return contract.claim(...args, { gasLimit: 2_000_000n });
}
