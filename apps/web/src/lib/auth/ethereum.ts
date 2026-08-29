// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Ethereum wallet sign-in (injected providers: MetaMask, Rabby, Brave, …).
//
// The wallet signs the frozen ETH_IDENTITY_MESSAGE; EOAs sign deterministically
// (RFC 6979), so hashing the signature gives stable entropy → a stable Nostr
// key per address (core `deriveNostrKeyFromEntropy`). Smart-contract wallets
// (ERC-1271) may not sign deterministically and would land on a fresh holon
// each time — the card copy names the wallets that work.

import { browser } from "$app/environment";
import { ethers } from "ethers";
import {
  ETH_IDENTITY_MESSAGE,
  deriveNostrKeyFromEntropy,
  entropyFromBytes,
} from "@holons/core/auth";
import { AuthUiError, isAbort, type ProviderLogin } from "./types";

export function isWalletAvailable(): boolean {
  return browser && !!(window as any).ethereum;
}

export function shortAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export async function signInWithEthereum(): Promise<ProviderLogin> {
  if (!isWalletAvailable()) {
    throw new AuthUiError(
      "No Ethereum wallet found. Install MetaMask, Rabby or Brave Wallet.",
      "unsupported",
    );
  }
  try {
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const address = ethers.getAddress(await signer.getAddress());
    const signature = await signer.signMessage(ETH_IDENTITY_MESSAGE);
    // Belt and braces: make sure the signature really is from this address.
    if (ethers.verifyMessage(ETH_IDENTITY_MESSAGE, signature) !== address) {
      throw new AuthUiError(
        "The wallet returned a signature for a different account.",
        "failed",
      );
    }
    const key = deriveNostrKeyFromEntropy(
      entropyFromBytes(ethers.getBytes(signature)),
      `eth:${address.toLowerCase()}`,
    );
    return {
      ...key,
      identity: {
        provider: "ethereum",
        pubkey: key.publicKey,
        subject: address,
        label: shortAddress(address),
      },
    };
  } catch (err) {
    if (err instanceof AuthUiError) throw err;
    if (isAbort(err))
      throw new AuthUiError(
        "Signature request was rejected in the wallet.",
        "cancelled",
      );
    throw new AuthUiError(
      (err as Error)?.message || "Wallet sign-in failed.",
      "failed",
    );
  }
}
