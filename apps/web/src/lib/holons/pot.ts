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
  savePotRecord,
  type BundleToken,
  type PotClaimArgs,
  type PotCommitment,
  type PotRecord,
} from "@holons/core/flows";
import { ensureChain } from "./bindings";
import { readProvider } from "./holdings";

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
  tokens: readonly BundleToken[],
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
