// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createHoloSphere } from './factory.js';
import { roleOfSync, writeAcceptance } from './authority.js';
import { CAPABILITIES, GUARDED_SETTINGS_FIELDS, may, requiredRole, whyNot } from './capabilities.js';
import { getFederationSnapshot } from '../federation/snapshot.js';
import { testKey } from '../protocol/testing.js';

const APP = 'core-capabilities-test';
const T0 = 1_700_000_000;

function sphere(sk: string) {
  return createHoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } });
}

describe('the capability table', () => {
  it('names the tiers once', () => {
    expect(requiredRole('content')).toBe('member');
    expect(requiredRole('federation')).toBe('admin');
    expect(requiredRole('settings.guarded')).toBe('admin');
    expect(GUARDED_SETTINGS_FIELDS).toContain('valueEquation');
    expect(Object.keys(CAPABILITIES).sort()).toEqual(
      ['content', 'federation', 'members', 'policy', 'privacy.lock', 'privacy.override', 'settings.guarded'],
    );
  });

  it('may() weighs a standing or a bare role', () => {
    expect(may('member', 'content')).toBe(true);
    expect(may('member', 'federation')).toBe(false);
    expect(may('admin', 'federation')).toBe(true);
    expect(may(null, 'content')).toBe(false);
    expect(may({ status: 'open', role: null, anchor: null, source: null }, 'federation')).toBe(true);
    expect(may({ status: 'held', role: null, anchor: 'x', source: 'log' }, 'content')).toBe(false);
    expect(may({ status: 'accepted', role: 'member', anchor: 'x', source: 'log' }, 'privacy.lock')).toBe(true);
    expect(may({ status: 'accepted', role: 'member', anchor: 'x', source: 'log' }, 'privacy.override')).toBe(false);
    expect(whyNot({ status: 'accepted', role: 'member', anchor: 'x', source: 'log' }, 'federation')).toMatch(/admin/);
    expect(whyNot({ status: 'accepted', role: 'admin', anchor: 'x', source: 'log' }, 'federation')).toBeNull();
    expect(whyNot(null, 'content')).toMatch(/Sign in/);
  });
});

describe('standing carries the role', () => {
  it('writeAcceptance and roleOfSync agree with the signed log', async () => {
    const bot = testKey(), member = testKey(), stranger = testKey();
    const hs = sphere(bot.sk);
    await hs.ready();
    await hs.foundHolon('-810', { at: T0 });
    await hs.addMember('-810', member.pk, 'member', { at: T0 + 1 });
    (hs as unknown as { _readAuthority: { invalidate(): void } })._readAuthority.invalidate();
    expect(await writeAcceptance(hs, '-810')).toMatchObject({ status: 'accepted', role: 'admin' });
    expect(await writeAcceptance(hs, '-810', member.pk)).toMatchObject({ status: 'accepted', role: 'member' });
    expect(await writeAcceptance(hs, '-810', stranger.pk)).toMatchObject({ status: 'held', role: null });
    expect(await writeAcceptance(hs, '-811', stranger.pk)).toMatchObject({ status: 'open', role: null });
    expect(roleOfSync(hs, '-810', bot.pk)).toBe('admin');
    expect(roleOfSync(hs, '-810', member.pk)).toBe('member');
    expect(roleOfSync(hs, '-810', stranger.pk)).toBeNull();
    expect(roleOfSync(hs, '-811', stranger.pk)).toBeUndefined();
    expect(roleOfSync(hs, member.pk, member.pk)).toBe('admin');
    expect(may(await writeAcceptance(hs, '-810', member.pk), 'federation')).toBe(false);
    expect(may(await writeAcceptance(hs, '-810'), 'federation')).toBe(true);
  });

  it('the federation snapshot says whether an admin signed it', async () => {
    const bot = testKey();
    const hs = sphere(bot.sk);
    await hs.ready();
    await hs.foundHolon('-820', { at: T0 });
    expect((await getFederationSnapshot(hs, '-820')).endorsed).toBe(false);
    await hs.federateHolon('-820', '-821', { lensConfig: { inbound: ['quests'], outbound: [] } });
    const snap = await getFederationSnapshot(hs, '-820');
    expect(snap.endorsed).toBe(true);
    expect(snap.federated).toEqual(['-821']);
  });
});
