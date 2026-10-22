// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Pot contract's words, and what a signer signs to commit a table.
 *
 * Every surface talks to the same contract with the same fragments: read its
 * counters, post a root (EIP-712 `Root`, `threshold` signers in ascending
 * address order), veto, settle, collect. The encoders here turn a
 * `RightsTable` into the exact arguments `Pot.postRoot` and `Pot.claim` take,
 * so the chain is handed the same numbers whichever surface sent them.
 *
 * No ethers here (rule 2): plain strings, numbers and bigints.
 */

import { normalizeAddress, type RightsRow, type RightsTable, ZERO_ADDRESS } from './rights.js';
import { rightsProof, rightsRoot } from './rights-tree.js';

/** The Pot's words, as human-readable ABI fragments. */
export const POT_ABI = [
  'function name() view returns (string)',
  'function flavor() view returns (string)',
  'function owner() view returns (address)',
  'function challenge() view returns (uint256)',
  'function threshold() view returns (uint256)',
  'function signers() view returns (address[])',
  'function isSigner(address) view returns (bool)',
  'function lastEpoch() view returns (uint256)',
  'function lastLunation() view returns (uint256)',
  'function lunationAt(uint256) view returns (uint256)',
  'function received(address) view returns (uint256)',
  'function declared(address) view returns (uint256)',
  'function totalReleased(address) view returns (uint256)',
  'function released(bytes32, address) view returns (uint256)',
  'function holdings(address) view returns (uint256)',
  'function free(address) view returns (uint256)',
  'function active() view returns (tuple(uint256 epoch, bytes32 root, bytes32 tableRef, uint256 since, address[] tokens, uint256[] totals))',
  'function pending() view returns (tuple(uint256 epoch, bytes32 root, bytes32 tableRef, uint256 since, address[] tokens, uint256[] totals))',
  'function rootDigest(uint256 epoch, bytes32 root, bytes32 tableRef, address[] tokens, uint256[] totals) view returns (bytes32)',
  'function postRoot(uint256 epoch, bytes32 root, bytes32 tableRef, address[] tokens, uint256[] totals, bytes[] signatures)',
  'function veto()',
  'function settle()',
  'function claim(string partyId, address to, address token, uint256 cumulative, bytes32[] proof)',
  'function deposit(address token, uint256 amount)',
  'function sweep(address token)',
  'function setSigners(address[] signers, uint256 threshold)',
  'event Received(address indexed token, address indexed from, uint256 amount, uint256 lunation)',
  'event RootPosted(uint256 indexed epoch, bytes32 root, bytes32 tableRef, uint256 since, uint256 lunation)',
  'event RootActive(uint256 indexed epoch, bytes32 root)',
  'event RootVetoed(uint256 indexed epoch, bytes32 root)',
  'event Released(bytes32 indexed party, string partyId, address indexed to, address indexed token, uint256 amount, uint256 cumulative)',
] as const;

/** The EIP-712 domain a Pot signs under. */
export function potDomain(chainId: number | bigint, address: string): {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
} {
  const verifyingContract = normalizeAddress(address);
  if (!verifyingContract) throw new Error('The Pot needs a 0x address');
  return { name: 'Pot', version: '1', chainId: Number(chainId), verifyingContract };
}

/** The EIP-712 types of a commitment, for `signTypedData`. */
export const POT_ROOT_TYPES = {
  Root: [
    { name: 'epoch', type: 'uint256' },
    { name: 'root', type: 'bytes32' },
    { name: 'tableRef', type: 'bytes32' },
    { name: 'tokens', type: 'address[]' },
    { name: 'totals', type: 'uint256[]' },
  ],
} as const;

/** What `postRoot` takes, less the signatures; also the `Root` message to sign. */
export interface PotCommitment {
  epoch: bigint;
  root: string;
  tableRef: string;
  /** Ascending, as the contract requires. */
  tokens: string[];
  totals: bigint[];
}

const asBytes32 = (ref: string): string => {
  const s = String(ref ?? '').trim().replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error('A table reference is 32 bytes of hex (the published entry id)');
  return '0x' + s;
};

/**
 * The commitment for a table: its root, the published entry it lives in, and
 * its totals token by token in the order the contract checks them.
 */
export function potCommitment(table: RightsTable, tableRef: string): PotCommitment {
  const tokens = Object.keys(table.totals)
    .map((t) => normalizeAddress(t))
    .filter((t): t is string => !!t)
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
  return {
    epoch: BigInt(table.epoch),
    root: rightsRoot(table.rows),
    tableRef: asBytes32(tableRef),
    tokens,
    totals: tokens.map((t) => table.totals[t] ?? 0n),
  };
}

/** The positional `postRoot` arguments; signatures in ascending signer-address order. */
export function potPostRootArgs(c: PotCommitment, signatures: readonly string[]): unknown[] {
  return [c.epoch, c.root, c.tableRef, c.tokens, c.totals, [...signatures]];
}

/** Signatures ordered the way the contract walks them — by the address that made each. */
export function orderSignatures(signed: ReadonlyArray<{ signer: string; signature: string }>): string[] {
  return [...signed]
    .map((s) => ({ signer: normalizeAddress(s.signer) ?? '', signature: s.signature }))
    .filter((s) => s.signer)
    .sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : BigInt(a.signer) > BigInt(b.signer) ? 1 : 0))
    .map((s) => s.signature);
}

/** What `claim` takes for one row, with its proof under the table's root. */
export interface PotClaimArgs {
  partyId: string;
  to: string;
  token: string;
  cumulative: bigint;
  proof: string[];
}

/** The `claim` arguments for `party` in `token`, or null when the table has no such row or the row has no address. */
export function potClaimArgs(table: RightsTable, party: string, token: string): PotClaimArgs | null {
  const t = normalizeAddress(token);
  if (!t) return null;
  const row = table.rows.find((r: RightsRow) => r.party === String(party) && r.token === t);
  if (!row || row.to === ZERO_ADDRESS) return null;
  const proof = rightsProof(table.rows, row);
  if (!proof) return null;
  return { partyId: row.party, to: row.to, token: row.token, cumulative: row.cumulative, proof };
}

export function potClaimArgList(args: PotClaimArgs): unknown[] {
  return [args.partyId, args.to, args.token, args.cumulative, args.proof];
}

/** The chain's own coin, as the Pot names it. */
export const POT_ETH = ZERO_ADDRESS;
