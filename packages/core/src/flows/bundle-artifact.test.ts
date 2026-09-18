// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  BUNDLE_BYTECODE,
  BUNDLE_CONSTRUCTOR_ABI,
  bundleConstructorArgList,
  bundleConstructorArgs,
} from './bundle-artifact.js';
import { WAD } from './contract.js';

describe('bundle artifact', () => {
  it('carries creation bytecode, not a stub', () => {
    expect(BUNDLE_BYTECODE).toMatch(/^0x60[0-9a-f]+$/);
    expect(BUNDLE_BYTECODE.length).toBeGreaterThan(30000);
    expect(BUNDLE_CONSTRUCTOR_ABI).toMatch(/^constructor\(address _owner, string _creatorUserId, string _name, uint256 _steepness, uint256 _nzones\)$/);
  });

  it('names the holon as its own creator and title, as the dashboard always has', () => {
    const owner = '0x' + 'aB'.repeat(20);
    const args = bundleConstructorArgs({ owner, holonId: -100123 as unknown as string, config: { steepness: 50, nzones: 3 } });
    expect(args).toEqual({ owner, creatorUserId: '-100123', name: '-100123', steepness: WAD / 2n, nzones: 3n });
    expect(bundleConstructorArgList(args)).toEqual([owner, '-100123', '-100123', WAD / 2n, 3n]);
  });

  it('refuses a bad owner or a missing holon', () => {
    expect(() => bundleConstructorArgs({ owner: 'nope', holonId: 'h', config: { steepness: 50, nzones: 3 } })).toThrow(/owner/);
    expect(() => bundleConstructorArgs({ owner: '0x' + '1'.repeat(40), holonId: '', config: { steepness: 50, nzones: 3 } })).toThrow(/holon/);
  });
});
