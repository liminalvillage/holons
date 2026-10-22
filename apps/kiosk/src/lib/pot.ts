// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The holon's Pot from the kiosk: value held on chain, divided by a rights
// table committed once per lunation, collected in one transfer.
//
// Reads need no account (the wallet's provider on the Pot's chain, else the
// chain's public endpoint). Writes are bare wallet calls, and core encodes
// everything (`potCommitment`, `potClaimArgs`, `POT_ROOT_TYPES`) so the
// chain is handed the same numbers whichever surface sent them.

import { ethers } from "ethers";
import {
  DEFAULT_POT_CHALLENGE_SECONDS,
  ERC20_META_ABI,
  POT_ABI,
  POT_BYTECODE,
  POT_CONSTRUCTOR_ABI,
  POT_ETH,
  POT_ROOT_TYPES,
  fromBaseUnits,
  nativeUnit,
  orderSignatures,
  partyKey,
  potClaimArgList,
  potConstructorArgList,
  potConstructorArgs,
  potDomain,
  potPostRootArgs,
  savePotRecord,
  treasuryLines,
  type PotToken,
  type TreasuryLine,
  type PotClaimArgs,
  type PotCommitment,
  type PotRecord,
} from "@holons/core/flows";
import {
  ChainError,
  connectedWallet,
  ensureChain,
  isRejection,
  readProvider,
} from "./chain";

/** One root as the contract holds it. */
export interface PotCommitmentState {
  epoch: number;
  root: string;
  /** The published table's entry id (hex, no 0x), or '' for none. */
  tableRef: string;
  /** Unix seconds the root was posted. */
  since: number;
  /** Unix seconds it applies (or applied). */
  appliesAt: number;
  totals: Record<string, bigint>;
}

/** One unit the Pot holds, in base units and in the unit. */
export interface PotUnit {
  unit: string;
  /** Token address; null for the chain's coin (the Pot's zero address). */
  address: string | null;
  token: string;
  decimals: number;
  received: bigint;
  holdings: bigint;
  free: bigint;
  declared: bigint;
  totalReleased: bigint;
  /** Released to the viewer's party, when one is looking. */
  mine: bigint | null;
  receivedIn: number;
  holdingsIn: number;
  freeIn: number;
}

export interface PotState {
  chainId: number;
  address: string;
  owner: string | null;
  challenge: number;
  threshold: number;
  signers: string[];
  lastEpoch: number;
  lastLunation: number;
  /** The mean lunation the chain is in now — a post is refused while it equals `lastLunation`. */
  lunationNow: number;
  active: PotCommitmentState | null;
  pending: PotCommitmentState | null;
  units: PotUnit[];
}

const big = async (p: Promise<unknown>): Promise<bigint> => {
  try {
    return BigInt(String(await p));
  } catch {
    return 0n;
  }
};

function commitmentOf(raw: any, challenge: number): PotCommitmentState | null {
  const root = String(raw?.root ?? raw?.[1] ?? "");
  if (!root || /^0x0+$/.test(root)) return null;
  const tokens: string[] = (raw?.tokens ?? raw?.[4] ?? []).map((t: unknown) =>
    String(t).toLowerCase(),
  );
  const totals: bigint[] = (raw?.totals ?? raw?.[5] ?? []).map((v: unknown) =>
    BigInt(String(v)),
  );
  const since = Number(raw?.since ?? raw?.[3] ?? 0);
  return {
    epoch: Number(raw?.epoch ?? raw?.[0] ?? 0),
    root: root.toLowerCase(),
    tableRef: String(raw?.tableRef ?? raw?.[2] ?? "")
      .replace(/^0x/, "")
      .replace(/^0+$/, ""),
    since,
    appliesAt: since + challenge,
    totals: Object.fromEntries(tokens.map((t, i) => [t, totals[i] ?? 0n])),
  };
}

/**
 * Everything the Pot says about itself and the units it holds — the chain's
 * coin and every token the holon's record lists. Null when the chain cannot
 * be read or there is no contract at the address.
 */
export async function readPotState(
  pot: PotRecord,
  tokens: readonly PotToken[],
  viewerId?: string | null,
): Promise<PotState | null> {
  const provider = await readProvider(pot.chainId);
  if (!provider) return null;
  const code = await provider.getCode(pot.address).catch(() => "0x");
  if (!code || code === "0x") return null;
  const c = new ethers.Contract(pot.address, [...POT_ABI], provider);
  const [
    owner,
    challenge,
    threshold,
    signers,
    lastEpoch,
    lastLunation,
    active,
    pending,
    block,
  ] = await Promise.all([
    c.owner().catch(() => null),
    big(c.challenge()),
    big(c.threshold()),
    c.signers().catch(() => []),
    big(c.lastEpoch()),
    big(c.lastLunation()),
    c.active().catch(() => null),
    c.pending().catch(() => null),
    provider.getBlock("latest").catch(() => null),
  ]);
  const key = viewerId ? partyKey(String(viewerId)) : null;
  const unitOf = async (
    unit: string,
    address: string | null,
    decimals: number,
  ): Promise<PotUnit> => {
    const token = address ?? POT_ETH;
    const [received, holdings, free, declared, totalReleased, mine] =
      await Promise.all([
        big(c.received(token)),
        big(c.holdings(token)),
        big(c.free(token)),
        big(c.declared(token)),
        big(c.totalReleased(token)),
        key ? big(c.released(key, token)) : Promise.resolve(null),
      ]);
    return {
      unit,
      address,
      token,
      decimals,
      received,
      holdings,
      free,
      declared,
      totalReleased,
      mine,
      receivedIn: fromBaseUnits(received, decimals),
      holdingsIn: fromBaseUnits(holdings, decimals),
      freeIn: fromBaseUnits(free, decimals),
    };
  };
  const units = await Promise.all([
    unitOf(nativeUnit(pot.chainId), null, 18),
    ...tokens.map((t) => unitOf(t.symbol, t.address.toLowerCase(), t.decimals)),
  ]);
  const ch = Number(challenge);
  return {
    chainId: pot.chainId,
    address: pot.address,
    owner: owner ? String(owner).toLowerCase() : null,
    challenge: ch,
    threshold: Number(threshold),
    signers: (signers as string[]).map((s) => String(s).toLowerCase()),
    lastEpoch: Number(lastEpoch),
    lastLunation: Number(lastLunation),
    lunationNow: Number(
      await big(
        c.lunationAt(block?.timestamp ?? Math.floor(Date.now() / 1000)),
      ),
    ),
    active: commitmentOf(active, ch),
    pending: commitmentOf(pending, ch),
    units,
  };
}

/** Unit → what the Pot received in it, in that unit: `PotSources.chain`. */
export function potReceipts(
  state: PotState | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of state?.units ?? [])
    if (u.received > 0n) out[u.unit] = u.receivedIn;
  return out;
}

async function writer(pot: Pick<PotRecord, "address" | "chainId">) {
  await connectedWallet();
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  await ensureChain(provider, pot.address, pot.chainId);
  const signer = await new ethers.BrowserProvider(
    (window as any).ethereum,
  ).getSigner();
  return {
    signer,
    contract: new ethers.Contract(pot.address, [...POT_ABI], signer),
  };
}

async function sent(label: string, run: () => Promise<any>): Promise<string> {
  try {
    const tx = await run();
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
      err?.reason ?? err?.shortMessage ?? err?.message ?? `${label} failed.`,
      "failed",
    );
  }
}

/** Deploy a Pot for `holonId`, owned by the connected wallet, and record it. */
export async function deployPotOnChain(
  store: any,
  holonId: string,
  input: {
    signers: readonly string[];
    threshold: number;
    challengeSeconds?: number;
  },
): Promise<PotRecord> {
  const owner = await connectedWallet();
  const args = potConstructorArgs({
    owner,
    holonId,
    signers: input.signers.length ? input.signers : [owner],
    threshold: input.threshold,
    challengeSeconds: input.challengeSeconds ?? DEFAULT_POT_CHALLENGE_SECONDS,
  });
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  const signer = await provider.getSigner();
  const factory = new ethers.ContractFactory(
    [POT_CONSTRUCTOR_ABI],
    POT_BYTECODE,
    signer,
  );
  let address = "";
  let txHash = "";
  try {
    const contract = await factory.deploy(...potConstructorArgList(args));
    const tx = contract.deploymentTransaction();
    txHash = String(tx?.hash ?? "");
    const receipt = await tx?.wait();
    if (receipt?.status !== 1)
      throw new ChainError("The deployment failed on chain.", "failed");
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
  return savePotRecord(store, holonId, {
    address,
    chainId,
    challenge: Number(args.challenge),
    deployedAt: Date.now(),
    txHash,
    tokens: [],
  });
}

/** Sign the lunation's commitment with the connected wallet (EIP-712 `Root`). */
export async function signCommitment(
  pot: Pick<PotRecord, "address" | "chainId">,
  commitment: PotCommitment,
): Promise<{ signer: string; signature: string }> {
  const address = await connectedWallet();
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  await ensureChain(provider, pot.address, pot.chainId);
  const signer = await new ethers.BrowserProvider(
    (window as any).ethereum,
  ).getSigner();
  try {
    const signature = await signer.signTypedData(
      potDomain(pot.chainId, pot.address),
      POT_ROOT_TYPES as never,
      {
        epoch: commitment.epoch,
        root: commitment.root,
        tableRef: commitment.tableRef,
        tokens: commitment.tokens,
        totals: commitment.totals,
      },
    );
    return { signer: address.toLowerCase(), signature };
  } catch (err: any) {
    if (isRejection(err))
      throw new ChainError("Signature rejected.", "rejected");
    throw new ChainError(
      err?.shortMessage ?? err?.message ?? "Signing failed.",
      "failed",
    );
  }
}

/** Post the commitment with the signatures gathered; the contract checks the quorum. */
export async function postRootOnChain(
  pot: Pick<PotRecord, "address" | "chainId">,
  commitment: PotCommitment,
  signatures: ReadonlyArray<{ signer: string; signature: string }>,
): Promise<string> {
  const { contract } = await writer(pot);
  const args = potPostRootArgs(commitment, orderSignatures(signatures));
  return sent("Posting the root", () => contract.postRoot(...args));
}

/** The owner withdraws the pending root. */
export async function vetoOnChain(
  pot: Pick<PotRecord, "address" | "chainId">,
): Promise<string> {
  const { contract } = await writer(pot);
  return sent("Veto", () => contract.veto());
}

/** Collect a row: anyone may send it, the Pot pays the row's address. */
export async function collectOnChain(
  pot: Pick<PotRecord, "address" | "chainId">,
  args: PotClaimArgs,
): Promise<string> {
  const { contract } = await writer(pot);
  return sent("Collecting", () => contract.claim(...potClaimArgList(args)));
}

/** Count tokens that arrived by plain transfer into the pool. */
export async function sweepOnChain(
  pot: Pick<PotRecord, "address" | "chainId">,
  token: string,
): Promise<string> {
  const { contract } = await writer(pot);
  return sent("Sweeping", () => contract.sweep(token));
}

/** Send `amount` of a token into the Pot: approve, then `deposit`. The chain's coin is a plain transfer. */
export async function depositOnChain(
  pot: Pick<PotRecord, "address" | "chainId">,
  token: string | null,
  amount: bigint,
): Promise<string> {
  const { signer, contract } = await writer(pot);
  if (!token) {
    return sent("Deposit", () =>
      signer.sendTransaction({ to: pot.address, value: amount }),
    );
  }
  const erc = new ethers.Contract(
    token,
    ["function approve(address, uint256) returns (bool)", ...ERC20_META_ABI],
    signer,
  );
  await sent("Approve", () => erc.approve(pot.address, amount));
  return sent("Deposit", () => contract.deposit(token, amount));
}

// ── The treasury ─────────────────────────────────────────────────────────
// Where the holon keeps value before it decides to distribute it: a Safe
// under the owners' threshold, or any address. Read without an account; the
// panel only shows the balances and links out to Safe{Wallet} — moving
// value into the Pot is the owners' own transaction there.

export interface TreasuryState {
  address: string;
  /** Whether there is code at the address (a Safe is a contract; a plain address is not). */
  contract: boolean;
  lines: TreasuryLine[];
}

/** What the treasury holds, per unit the Pot is read in. Null when the chain cannot be read. */
export async function readTreasury(
  pot: Pick<PotRecord, "chainId" | "tokens" | "treasury">,
): Promise<TreasuryState | null> {
  const treasury = pot.treasury;
  if (!treasury) return null;
  const provider = await readProvider(pot.chainId);
  if (!provider) return null;
  const big = async (p: Promise<unknown>) => {
    try {
      return BigInt(String(await p));
    } catch {
      return 0n;
    }
  };
  const [code, native, ...tokenBalances] = await Promise.all([
    provider.getCode(treasury.address).catch(() => "0x"),
    provider.getBalance(treasury.address).catch(() => 0n),
    ...pot.tokens.map((t) =>
      big(
        new ethers.Contract(t.address, [...ERC20_META_ABI], provider).balanceOf(
          treasury.address,
        ),
      ),
    ),
  ]);
  const tokens: Record<string, bigint> = {};
  pot.tokens.forEach(
    (t, i) => (tokens[t.address.toLowerCase()] = tokenBalances[i]),
  );
  return {
    address: treasury.address,
    contract: !!code && code !== "0x",
    lines: treasuryLines(pot.chainId, pot.tokens, { native, tokens }),
  };
}

/** An ERC-20 described by its own contract, on the Pot's chain. */
export async function describeToken(
  chainId: number | null,
  address: string,
): Promise<PotToken> {
  const addr = String(address ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new ChainError("That is not a token address.", "failed");
  }
  const provider = await readProvider(chainId);
  if (!provider)
    throw new ChainError("No way to read this chain.", "no-wallet");
  const code = await provider.getCode(addr).catch(() => "0x");
  if (!code || code === "0x") {
    throw new ChainError(
      "No contract at that address on this chain.",
      "no-contract",
    );
  }
  const erc = new ethers.Contract(addr, [...ERC20_META_ABI], provider);
  const [symbol, decimals, name] = await Promise.all([
    erc.symbol().catch(() => ""),
    erc.decimals().catch(() => null),
    erc.name().catch(() => ""),
  ]);
  if (!symbol || decimals == null) {
    throw new ChainError("That contract is not an ERC-20 token.", "failed");
  }
  return {
    address: addr,
    symbol: String(symbol),
    decimals: Number(decimals),
    ...(name ? { name: String(name) } : {}),
  };
}
