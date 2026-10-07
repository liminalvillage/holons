// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { DEFAULT_POT_CHALLENGE_SECONDS, POT_BYTECODE, POT_CONSTRUCTOR_ABI, potConstructorArgList, potConstructorArgs } from './pot-artifact.js';

describe('pot artifact', () => {
  it('carries creation bytecode, not a stub', () => {
    expect(POT_BYTECODE).toMatch(/^0x6[01][0-9a-f]+$/);
    expect(POT_BYTECODE.length).toBeGreaterThan(20000);
    expect(POT_CONSTRUCTOR_ABI).toBe('constructor(address owner_, string name_, uint256 challenge_, address[] signers_, uint256 threshold_)');
  });

  it('names the holon, orders the signers and defaults the window', () => {
    const owner = '0x' + 'aB'.repeat(20);
    const hi = '0x' + 'f'.repeat(40);
    const lo = '0x' + '1'.repeat(40);
    const args = potConstructorArgs({ owner, holonId: 'holon_x', signers: [hi, lo, hi.toUpperCase().replace('0X', '0x')], threshold: 2 });
    expect(args).toEqual({ owner: owner.toLowerCase(), name: 'holon_x', challenge: BigInt(DEFAULT_POT_CHALLENGE_SECONDS), signers: [lo, hi], threshold: 2n });
    expect(potConstructorArgList(args)).toEqual([owner.toLowerCase(), 'holon_x', BigInt(DEFAULT_POT_CHALLENGE_SECONDS), [lo, hi], 2n]);
  });

  it('refuses a bad owner, no signers, a threshold out of range, a window longer than a lunation', () => {
    const owner = '0x' + '1'.repeat(40);
    expect(() => potConstructorArgs({ owner: 'nope', holonId: 'h', signers: [owner], threshold: 1 })).toThrow(/owner/);
    expect(() => potConstructorArgs({ owner, holonId: '', signers: [owner], threshold: 1 })).toThrow(/holon/);
    expect(() => potConstructorArgs({ owner, holonId: 'h', signers: [], threshold: 1 })).toThrow(/signer/);
    expect(() => potConstructorArgs({ owner, holonId: 'h', signers: [owner], threshold: 2 })).toThrow(/threshold/);
    expect(() => potConstructorArgs({ owner, holonId: 'h', signers: [owner], threshold: 1, challengeSeconds: 40 * 86400 })).toThrow(/lunation/);
  });
});
