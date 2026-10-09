// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The kiosk's one door to a chain: the browser wallet when there is one, the
// chain's public endpoint when there is not. Everything that touches a
// contract (`pot.ts`) goes through here; nothing here knows a contract.

import { ethers } from "ethers";
import { describeChain, requiredChainId } from "@holons/core/flows";
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

/**
 * Value never crosses chains. Before any write to a contract the wallet must
 * be on the chain the record names: the same address holds a different
 * contract — or nothing — on another network. The wallet is asked to switch;
 * a refusal, or a wallet that cannot, ends the write. A record that never
 * said its chain is checked for code only, and the chain found is returned
 * so the caller can record it.
 */
export async function ensureChain(
  provider: ethers.BrowserProvider,
  address: string,
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
        `This contract is on ${describeChain(want)?.name}; the wallet is on ${
          describeChain(actual)?.name
        }. Switch the wallet to ${describeChain(want)?.name} first.`,
        "wrong-network",
      );
    }
  }
  const code = await provider.getCode(address).catch(() => "0x");
  if (!code || code === "0x") {
    throw new ChainError(
      `No contract at that address on ${describeChain(actual)?.name}.`,
      "no-contract",
    );
  }
  return actual;
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

export function isRejection(err: any): boolean {
  return err?.code === 4001 || err?.code === "ACTION_REJECTED";
}

/** A read-only provider on `chainId`: the wallet's if it is there, else public. */
export async function readProvider(
  chainId: number | null,
): Promise<ethers.Provider | null> {
  if (isWalletAvailable()) {
    try {
      const p = new ethers.BrowserProvider((window as any).ethereum);
      const actual = Number((await p.getNetwork()).chainId);
      if (chainId == null || actual === chainId) return p;
    } catch {
      // Fall through to the public endpoint.
    }
  }
  const rpc = chainId != null ? describeChain(chainId)?.rpc : null;
  return rpc
    ? new ethers.JsonRpcProvider(rpc, chainId!, { staticNetwork: true })
    : null;
}
