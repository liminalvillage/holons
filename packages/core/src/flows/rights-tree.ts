// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rights table as the Pot sees it: a Merkle root, and one proof per row.
 *
 * Mirrors `Pot.claim` exactly, and nothing else does:
 *
 *   leaf  = keccak256(keccak256(abi.encode(keccak256(party), to, token, cumulative)))
 *   node  = keccak256(min(a, b) ‖ max(a, b))      — OpenZeppelin `MerkleProof`
 *
 * Leaves are double-hashed so no inner node can pose as a row; pairs are
 * hashed in sorted order so a proof needs no position bits; an odd node is
 * carried up as it is. Leaves are sorted before building, so two readers with
 * the same table get the same root.
 *
 * Pure, no ethers (rule 2): hex strings in, hex strings out.
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { normalizeAddress, type RightsRow } from './rights.js';

const hex = (b: Uint8Array) => '0x' + bytesToHex(b);
const unhex = (s: string) => hexToBytes(s.replace(/^0x/, ''));

/** The root of nothing — a Pot refuses it. */
export const EMPTY_RIGHTS_ROOT = '0x' + '0'.repeat(64);

/** `keccak256(party)`: how the Pot keys `released` by party id. */
export function partyKey(party: string): string {
  return hex(keccak_256(utf8ToBytes(String(party))));
}

function word(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

function uint256(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('A right cannot be negative');
  let s = value.toString(16);
  if (s.length > 64) throw new Error('A right exceeds uint256');
  if (s.length % 2) s = '0' + s;
  return word(hexToBytes(s));
}

/** `abi.encode(bytes32, address, address, uint256)` for one row. */
export function encodeRow(row: RightsRow): Uint8Array {
  const to = normalizeAddress(row.to);
  const token = normalizeAddress(row.token);
  if (!to || !token) throw new Error('A row needs 0x addresses');
  const out = new Uint8Array(128);
  out.set(unhex(partyKey(row.party)), 0);
  out.set(word(unhex(to)), 32);
  out.set(word(unhex(token)), 64);
  out.set(uint256(row.cumulative), 96);
  return out;
}

/** The leaf a row hashes to. */
export function rowLeaf(row: RightsRow): string {
  return hex(keccak_256(keccak_256(encodeRow(row))));
}

function pair(a: string, b: string): string {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const buf = new Uint8Array(64);
  buf.set(unhex(lo), 0);
  buf.set(unhex(hi), 32);
  return hex(keccak_256(buf));
}

function layersOf(leaves: string[]): string[][] {
  const layers: string[][] = [[...new Set(leaves)].sort()];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? pair(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }
  return layers;
}

/** The root over every row; `EMPTY_RIGHTS_ROOT` for no rows. */
export function rightsRoot(rows: readonly RightsRow[]): string {
  if (!rows.length) return EMPTY_RIGHTS_ROOT;
  const layers = layersOf(rows.map(rowLeaf));
  return layers[layers.length - 1][0];
}

/** The sibling path that puts `row` under the table's root; null when the row is not in it. */
export function rightsProof(rows: readonly RightsRow[], row: RightsRow): string[] | null {
  if (!rows.length) return null;
  const layers = layersOf(rows.map(rowLeaf));
  let index = layers[0].indexOf(rowLeaf(row));
  if (index < 0) return null;
  const proof: string[] = [];
  for (let d = 0; d < layers.length - 1; d++) {
    const layer = layers[d];
    const sibling = index % 2 === 0 ? index + 1 : index - 1;
    if (sibling < layer.length) proof.push(layer[sibling]);
    index = Math.floor(index / 2);
  }
  return proof;
}

/** Does `proof` put `leaf` under `root`? The same walk `MerkleProof.verify` does. */
export function verifyRightsProof(root: string, leaf: string, proof: readonly string[]): boolean {
  let node = leaf.toLowerCase();
  for (const sibling of proof) node = pair(node, sibling.toLowerCase());
  return node === root.toLowerCase();
}
