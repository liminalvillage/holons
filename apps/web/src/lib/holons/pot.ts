// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The holon's Pot from the dashboard: value held on chain, divided by a
 * rights table committed once per lunation, collected in one transfer. The
 * same operations as the kiosk's `pot.ts`; core encodes everything.
 */

import { ethers } from "ethers";
import {
  DEFAULT_POT_CHALLENGE_SECONDS,
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
  ERC20_META_ABI,
  describeChain,
  requiredChainId,
  savePotRecord,
  treasuryLines,
  type PotClaimArgs,
  type PotCommitment,
  type PotRecord,
  type PotToken,
  type TreasuryLine,
} from "@holons/core/flows";

/**
 * A read-only provider on `chainId`: the wallet's when it is there, else
 * the chain's public endpoint; null when neither can be had.
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

/**
 * Value never crosses chains: before a write the wallet must be on the
 * chain the record names. The wallet is asked to switch; a refusal ends the
 * write. Returns the chain and a fresh provider on it (ethers caches the
 * network a provider first saw).
 */
export async function ensureChain(
  record: { chainId?: number | null } | null | undefined,
): Promise<{ chainId: number; provider: ethers.BrowserProvider }> {
  const eth = (window as any).ethereum;
  let provider = new ethers.BrowserProvider(eth);
  let actual = Number((await provider.getNetwork()).chainId);
  const want = requiredChainId(record);
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
    if (actual !== want) {
      throw new Error(
        `This contract is on ${describeChain(want)?.name}; the wallet is on ${
          describeChain(actual)?.name
        }. Switch the wallet to ${describeChain(want)?.name} first.`,
      );
    }
  }
  return { chainId: actual, provider };
}

export interface PotCommitmentState {
  epoch: number;
  root: string;
  /** The published table's entry id (hex, no 0x), or '' for none. */
  tableRef: string;
  since: number;
  appliesAt: number;
  totals: Record<string, bigint>;
}

export interface PotUnit {
  unit: string;
  address: string | null;
  token: string;
  decimals: number;
  received: bigint;
  holdings: bigint;
  free: bigint;
  declared: bigint;
  totalReleased: bigint;
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

const walletProvider = (): ethers.BrowserProvider | null =>
  typeof window !== "undefined" && (window as any).ethereum
    ? new ethers.BrowserProvider((window as any).ethereum)
    : null;

/** Everything the Pot says about itself and the units it holds. */
export async function readPotState(
  pot: PotRecord,
  tokens: readonly PotToken[],
  viewerId?: string | null,
): Promise<PotState | null> {
  const provider = await readProvider(walletProvider(), pot.chainId);
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

/** Unit → what the Pot received in it: `PotSources.chain`. */
export function potReceipts(
  state: PotState | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of state?.units ?? [])
    if (u.received > 0n) out[u.unit] = u.receivedIn;
  return out;
}

async function writer(pot: Pick<PotRecord, "address" | "chainId">) {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No Ethereum wallet in this browser.");
  await new ethers.BrowserProvider(eth).send("eth_requestAccounts", []);
  const { provider } = await ensureChain(pot);
  const signer = await provider.getSigner();
  return {
    signer,
    contract: new ethers.Contract(pot.address, [...POT_ABI], signer),
  };
}

async function sent(run: () => Promise<any>): Promise<string> {
  const tx = await run();
  const receipt = await tx.wait();
  if (receipt?.status !== 1)
    throw new Error("The transaction failed on chain.");
  return String(tx.hash);
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
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No Ethereum wallet in this browser.");
  const provider = new ethers.BrowserProvider(eth);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const owner = await signer.getAddress();
  const args = potConstructorArgs({
    owner,
    holonId,
    signers: input.signers.length ? input.signers : [owner],
    threshold: input.threshold,
    challengeSeconds: input.challengeSeconds ?? DEFAULT_POT_CHALLENGE_SECONDS,
  });
  const factory = new ethers.ContractFactory(
    [POT_CONSTRUCTOR_ABI],
    POT_BYTECODE,
    signer,
  );
  const contract = await factory.deploy(...potConstructorArgList(args));
  const tx = contract.deploymentTransaction();
  const receipt = await tx?.wait();
  if (receipt?.status !== 1) throw new Error("The deployment failed on chain.");
  const address = String(
    receipt.contractAddress ?? (await contract.getAddress()),
  );
  const chainId = Number((await provider.getNetwork()).chainId);
  return savePotRecord(store, holonId, {
    address,
    chainId,
    challenge: Number(args.challenge),
    deployedAt: Date.now(),
    txHash: String(tx?.hash ?? ""),
    tokens: [],
  });
}

/** Sign the lunation's commitment with the connected wallet (EIP-712 `Root`). */
export async function signCommitment(
  pot: Pick<PotRecord, "address" | "chainId">,
  commitment: PotCommitment,
): Promise<{ signer: string; signature: string }> {
  const { signer } = await writer(pot);
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
  return { signer: (await signer.getAddress()).toLowerCase(), signature };
}

export async function postRootOnChain(
  pot: Pick<PotRecord, "address" | "chainId">,
  commitment: PotCommitment,
  signatures: ReadonlyArray<{ signer: string; signature: string }>,
): Promise<string> {
  const { contract } = await writer(pot);
  return sent(() =>
    contract.postRoot(
      ...potPostRootArgs(commitment, orderSignatures(signatures)),
    ),
  );
}

export async function vetoOnChain(
  pot: Pick<PotRecord, "address" | "chainId">,
): Promise<string> {
  const { contract } = await writer(pot);
  return sent(() => contract.veto());
}

export async function collectOnChain(
  pot: Pick<PotRecord, "address" | "chainId">,
  args: PotClaimArgs,
): Promise<string> {
  const { contract } = await writer(pot);
  return sent(() => contract.claim(...potClaimArgList(args)));
}

export async function sweepOnChain(
  pot: Pick<PotRecord, "address" | "chainId">,
  token: string,
): Promise<string> {
  const { contract } = await writer(pot);
  return sent(() => contract.sweep(token));
}

// ── The treasury ─────────────────────────────────────────────────────────
// Where the holon keeps value before it decides to distribute it. Read
// without an account; funding the Pot is the owners' own transaction in
// Safe Wallet, then "count into the pool" on the Pot.

export interface TreasuryState {
  address: string;
  /** Whether there is code at the address (a Safe is a contract). */
  contract: boolean;
  lines: TreasuryLine[];
}

export async function readTreasury(
  pot: Pick<PotRecord, "chainId" | "tokens" | "treasury">,
): Promise<TreasuryState | null> {
  const treasury = pot.treasury;
  if (!treasury) return null;
  const provider = await readProvider(walletProvider(), pot.chainId);
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
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr))
    throw new Error("That is not a token address.");
  const provider = await readProvider(walletProvider(), chainId);
  if (!provider) throw new Error("No way to read this chain.");
  const code = await provider.getCode(addr).catch(() => "0x");
  if (!code || code === "0x")
    throw new Error("No contract at that address on this chain.");
  const erc = new ethers.Contract(addr, [...ERC20_META_ABI], provider);
  const [symbol, decimals, name] = await Promise.all([
    erc.symbol().catch(() => ""),
    erc.decimals().catch(() => null),
    erc.name().catch(() => ""),
  ]);
  if (!symbol || decimals == null)
    throw new Error("That contract is not an ERC-20 token.");
  return {
    address: addr,
    symbol: String(symbol),
    decimals: Number(decimals),
    ...(name ? { name: String(name) } : {}),
  };
}
