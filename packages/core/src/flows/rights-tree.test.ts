// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ZERO_ADDRESS, type RightsRow } from './rights.js';
import { EMPTY_RIGHTS_ROOT, encodeRow, partyKey, rightsProof, rightsRoot, rowLeaf, verifyRightsProof } from './rights-tree.js';

const EVO = '0x' + 'e'.repeat(40);
const row = (party: string, to: string, cumulative: bigint, token = EVO): RightsRow => ({ party, to, token, cumulative });

const alice = row('alice', '0x' + 'a'.repeat(40), 600n);
const bob = row('bob', '0x' + 'b'.repeat(40), 400n);
const carol = row('carol', ZERO_ADDRESS, 1n, ZERO_ADDRESS);

describe('row encoding', () => {
  it('hashes the party id the way the Pot keys `released`', () => {
    // keccak256("alice")
    expect(partyKey('alice')).toBe('0x9c0257114eb9399a2985f8e75dad7600c5d89fe3824ffa99ec1c3eb8bf3b0501');
  });

  it('abi-encodes (bytes32, address, address, uint256) in four words', () => {
    const bytes = encodeRow(alice);
    expect(bytes.length).toBe(128);
    const hex = Buffer.from(bytes).toString('hex');
    expect(hex.slice(0, 64)).toBe(partyKey('alice').slice(2));
    expect(hex.slice(64, 128)).toBe('0'.repeat(24) + 'a'.repeat(40));
    expect(hex.slice(128, 192)).toBe('0'.repeat(24) + 'e'.repeat(40));
    expect(hex.slice(192)).toBe('0'.repeat(61) + '258'); // 600
    expect(rowLeaf(alice)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('refuses what the contract would', () => {
    expect(() => encodeRow(row('x', 'nope', 1n))).toThrow(/0x/);
    expect(() => encodeRow(row('x', ZERO_ADDRESS, -1n))).toThrow(/negative/);
  });
});

describe('root and proofs', () => {
  it('every row proves under the root, in any row order, and nothing else does', () => {
    const rows = [alice, bob, carol];
    const root = rightsRoot(rows);
    expect(root).toBe(rightsRoot([carol, alice, bob]));
    for (const r of rows) {
      const proof = rightsProof(rows, r);
      expect(proof).not.toBeNull();
      expect(verifyRightsProof(root, rowLeaf(r), proof!)).toBe(true);
    }
    const tampered = { ...alice, cumulative: 601n };
    expect(rightsProof(rows, tampered)).toBeNull();
    expect(verifyRightsProof(root, rowLeaf(tampered), rightsProof(rows, alice)!)).toBe(false);
    // a proof made for alice does not put bob under the root
    expect(verifyRightsProof(root, rowLeaf(bob), rightsProof(rows, alice)!)).toBe(false);
  });

  it('a one-row table is its own root; no rows is the empty root', () => {
    expect(rightsRoot([alice])).toBe(rowLeaf(alice));
    expect(rightsProof([alice], alice)).toEqual([]);
    expect(rightsRoot([])).toBe(EMPTY_RIGHTS_ROOT);
    expect(rightsProof([], alice)).toBeNull();
  });

  it('matches the two-row root the Foundry suite builds by hand (sorted pair)', () => {
    const [lo, hi] = [rowLeaf(alice), rowLeaf(bob)].sort();
    const root = rightsRoot([alice, bob]);
    expect(verifyRightsProof(root, lo, [hi])).toBe(true);
    expect(verifyRightsProof(root, hi, [lo])).toBe(true);
  });
});
