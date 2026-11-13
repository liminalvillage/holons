// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
import { describe, expect, it, vi } from 'vitest';
import { createHoloSphere } from './factory.js';
import { testKey } from '../protocol/testing.js';
import { foundHolon } from '../protocol/founding.js';
import {
  HOLONS_REGISTRY_TABLE,
  attachRegistry,
  hasRegistry,
  holonTypeOf,
  isRegistrableHolon,
  registryEntryFromSettings,
  searchHolons,
} from './registry.js';

const APP = 'registry-attach-test';
const fresh = (extra: Record<string, unknown> = {}) =>
  createHoloSphere({ appName: APP, privateKey: testKey().sk, store: { adapter: 'memory' }, enforce: false, ...extra });

describe('holonTypeOf', () => {
  it('names pubkeys and Telegram user ids personal, groups and keyed ids community', () => {
    expect(holonTypeOf('a'.repeat(64))).toBe('personal');
    expect(holonTypeOf('235114395')).toBe('personal');
    expect(holonTypeOf('-1003711659317')).toBe('community');
    expect(holonTypeOf('holon_fig33pftaepw96i4')).toBe('community');
  });
});

describe('isRegistrableHolon', () => {
  it('refuses addresses, map cells, system ids and blanks', () => {
    expect(isRegistrableHolon('-100123')).toBe(true);
    expect(isRegistrableHolon('-100123/settings')).toBe(false);
    expect(isRegistrableHolon('8a1fb46622dffff')).toBe(false);
    expect(isRegistrableHolon('_g')).toBe(false);
    expect(isRegistrableHolon('  ')).toBe(false);
    expect(isRegistrableHolon(null)).toBe(false);
  });
});

describe('registryEntryFromSettings', () => {
  it('keeps an existing creation time and name when the settings carry none', () => {
    const e = registryEntryFromSettings('-1', { purpose: 'p' }, { name: 'Old', created: '2024-01-01T00:00:00.000Z' });
    expect(e).toMatchObject({ id: '-1', name: 'Old', purpose: 'p', created: '2024-01-01T00:00:00.000Z', type: 'community' });
  });

  it('a stand-in name never replaces a real one', () => {
    expect(registryEntryFromSettings('-1', { name: 'unknown' }, { name: 'Lunation 84' })?.name).toBe('Lunation 84');
    expect(registryEntryFromSettings('-1', { name: 'Holon -1' }, { name: 'Lunation 84' })?.name).toBe('Lunation 84');
  });
});

describe('attachRegistry', () => {
  it('a holon whose settings are written is findable by name', async () => {
    const hs = fresh();
    expect(hasRegistry(hs)).toBe(true);
    await hs.put('-1009999', 'settings', { id: '-1009999', name: 'Olive Grove Two' });
    const hits = await searchHolons(hs, 'olive grove');
    expect(hits).toEqual([{ id: '-1009999', name: 'Olive Grove Two', type: 'community' }]);
  });

  it('a holon founded in core is registered under its name', async () => {
    const hs = fresh();
    await foundHolon(hs, 'holon_abcdefabcdef12', { name: 'Seed Library' });
    const hits = await searchHolons(hs, 'seed lib');
    expect(hits.map((h) => h.id)).toContain('holon_abcdefabcdef12');
  });

  it('a rename refreshes the entry; an unchanged save writes nothing', async () => {
    const hs = fresh();
    const spy = vi.spyOn(hs, 'writeGlobal');
    await hs.put('-1007', 'settings', { id: '-1007', name: 'A' });
    await hs.put('-1007', 'settings', { id: '-1007', name: 'A', language: 'it' });
    expect(spy).toHaveBeenCalledTimes(1);
    await hs.put('-1007', 'settings', { id: '-1007', name: 'B' });
    expect(spy).toHaveBeenCalledTimes(2);
    const row = await hs.getGlobal(HOLONS_REGISTRY_TABLE, '-1007');
    expect(row?.name).toBe('B');
  });

  it('skips non-settings lenses, addresses and map cells', async () => {
    const hs = fresh();
    const spy = vi.spyOn(hs, 'writeGlobal');
    await hs.put('-1008', 'quests', { id: 'q1', title: 't' });
    await hs.put('8a1fb46622dffff', 'settings', { id: 'x', name: 'cell' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('can be turned off for raw tooling, and attaches once', async () => {
    const hs = fresh({ registry: false });
    expect(hasRegistry(hs)).toBe(false);
    await hs.put('-1010', 'settings', { id: '-1010', name: 'Raw' });
    expect(await searchHolons(hs, 'raw')).toEqual([]);
    expect(attachRegistry(attachRegistry(hs))).toBe(hs);
  });

  it('a registry failure never blocks the settings write', async () => {
    const hs = fresh({ registry: false });
    const log = vi.fn();
    (hs as any).writeGlobal = vi.fn().mockRejectedValue(new Error('relay down'));
    attachRegistry(hs as any, { log });
    await hs.put('-1011', 'settings', { id: '-1011', name: 'X' });
    expect(log).toHaveBeenCalled();
    expect((await hs.get('-1011', 'settings', '-1011'))?.name).toBe('X');
  });
});
