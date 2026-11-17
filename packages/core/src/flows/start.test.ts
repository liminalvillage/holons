// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createHoloSphere } from '../holosphere/factory.js';
import { holonRole } from '../holosphere/authority.js';
import { searchHolons } from '../holosphere/registry.js';
import { addHolonMember, holonMembers } from '../protocol/founding.js';
import { testKey } from '../protocol/testing.js';
import { loadAllocationInputs } from './cascade-load.js';
import { proposeSplit } from './split-proposals-load.js';
import { STARTER_SPLIT, startHolon } from './start.js';

async function instance(sk = testKey().sk) {
  const hs: any = createHoloSphere({ appName: 'start-test', privateKey: sk, store: { adapter: 'memory' } });
  await hs.ready();
  return hs;
}

describe('startHolon', () => {
  it('founds a named holon whose first admin is the key that started it, with the starter split', async () => {
    const hs = await instance();
    const { holon, anchor } = await startHolon(hs, {
      name: '  Seed Fund ',
      description: 'Backs gardens',
      randomBytes: () => new Uint8Array(16).fill(1),
    });
    expect(holon).toBe('holon_bbbbbbbbbbbbbbbb');
    expect(anchor).toBe(hs.currentPubkey);
    expect(await holonRole(hs, holon)).toBe('admin');
    const read = await loadAllocationInputs(hs, holon);
    expect(read.configured).toBe(true);
    expect(read.name).toBe('Seed Fund');
    expect(read.description).toBe('Backs gardens');
    expect(read.config).toMatchObject({ interiorPercent: STARTER_SPLIT.interiorPercent, nzones: 3 });
  });

  it('can be found by name in the global registry right away', async () => {
    const hs = await instance();
    const { holon } = await startHolon(hs, { name: 'River Pot', description: 'For the valley' });
    expect(await searchHolons(hs, 'river')).toEqual([{ id: holon, name: 'River Pot', type: 'pot' }]);
  });

  it('needs a name', async () => {
    await expect(startHolon(await instance(), { name: '  ' })).rejects.toThrow(/name/);
  });

  it('kickstarts the whole path: seat a project and a person, then add a second admin', async () => {
    const hs = await instance();
    const other = testKey();
    const { holon } = await startHolon(hs, { name: 'Seed Fund' });
    const { proposal } = await proposeSplit(hs, holon, {
      split: { config: { ...STARTER_SPLIT }, zones: { holon_alder: 1 }, people: { [other.pk]: 2 } },
    });
    expect(proposal?.status).toBe('applied');
    const read = await loadAllocationInputs(hs, holon);
    const seats = Object.fromEntries(read.zoned.filter((p) => p.zone >= 1).map((p) => [p.id, p.zone]));
    expect(seats).toEqual({ holon_alder: 1, [other.pk]: 2 });
    await addHolonMember(hs, holon, other.pk, 'admin');
    expect((await holonMembers(hs, holon)).get(other.pk)).toBe('admin');
  });
});
