// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a holon's Bundle holds on chain — the chain's coin and every token
 * the record lists — read without an account. The kiosk has the same read
 * in its `chain.ts`; the ABI fragments and the fold are core's.
 */

import { ethers } from "ethers";
import {
  BUNDLE_HOLDINGS_ABI,
  ERC20_META_ABI,
  describeChain,
  foldHoldings,
  readBundleTokens,
  requiredChainId,
  type BundleHoldings,
  type BundleToken,
  type HolonBundleRecord,
  type RawHolding,
} from "@holons/core/flows";

/**
 * A read-only provider on the Bundle's chain: the wallet's when it is
 * there, else the chain's public endpoint; null when neither can be had.
 */
export async function readProvider(
  wallet: ethers.Provider | null,
  chainId: number | null,
): Promise<ethers.Provider | null> {
  if (wallet) {
    try {
      const actual = Number((await wallet.getNetwork()).chainId);
      if (chainId == null || actual === chainId) return wallet;
    } catch {
      // Fall through to the public endpoint.
    }
  }
  const rpc = chainId != null ? describeChain(chainId)?.rpc : null;
  return rpc
    ? new ethers.JsonRpcProvider(rpc, chainId!, { staticNetwork: true })
    : null;
}

/** The Bundle's balances; `viewerId` adds what is held for that member. */
export async function readHoldings(
  wallet: ethers.Provider | null,
  bundle: Pick<HolonBundleRecord, "address" | "chainId" | "tokens">,
  viewerId?: string | null,
): Promise<BundleHoldings | null> {
  const chainId = requiredChainId(bundle);
  const provider = await readProvider(wallet, chainId);
  if (!provider) return null;
  const actual = Number((await provider.getNetwork()).chainId);
  const code = await provider.getCode(bundle.address).catch(() => "0x");
  if (!code || code === "0x") return null;
  const c = new ethers.Contract(
    bundle.address,
    [...BUNDLE_HOLDINGS_ABI],
    provider,
  );
  const big = async (p: Promise<unknown>) => {
    try {
      return BigInt(String(await p));
    } catch {
      return 0n;
    }
  };
  const id = viewerId ? String(viewerId) : "";
  const native: RawHolding = {
    balance: await provider.getBalance(bundle.address).catch(() => 0n),
    deposited: await big(c.totalEtherDeposited()),
    mine: id ? await big(c.etherBalance(id)) : null,
  };
  const tokens = await Promise.all(
    readBundleTokens(bundle).map(async (token) => {
      const erc = new ethers.Contract(
        token.address,
        [...ERC20_META_ABI],
        provider,
      );
      const holding: RawHolding = {
        balance: await big(erc.balanceOf(bundle.address)),
        deposited: await big(c.totalDeposited(token.address)),
        mine: id ? await big(c.tokenBalance(id, token.address)) : null,
      };
      return { token, holding };
    }),
  );
  return foldHoldings({ chainId: actual, native, tokens });
}

/** An ERC-20 described by its own contract, on the Bundle's chain. */
export async function describeToken(
  wallet: ethers.Provider | null,
  chainId: number | null,
  address: string,
): Promise<BundleToken> {
  const addr = String(address ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error("That is not a token address.");
  }
  const provider = await readProvider(wallet, chainId);
  if (!provider) throw new Error("No way to read this chain.");
  const code = await provider.getCode(addr).catch(() => "0x");
  if (!code || code === "0x") {
    throw new Error("No contract at that address on this chain.");
  }
  const erc = new ethers.Contract(addr, [...ERC20_META_ABI], provider);
  const [symbol, decimals, name] = await Promise.all([
    erc.symbol().catch(() => ""),
    erc.decimals().catch(() => null),
    erc.name().catch(() => ""),
  ]);
  if (!symbol || decimals == null) {
    throw new Error("That contract is not an ERC-20 token.");
  }
  return {
    address: addr,
    symbol: String(symbol),
    decimals: Number(decimals),
    ...(name ? { name: String(name) } : {}),
  };
}
