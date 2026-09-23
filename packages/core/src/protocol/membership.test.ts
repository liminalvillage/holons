// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { actorsFromMembersLog, bootstrapActors, readMembersLog, resolveAcceptedActors, syncMembersLog } from './membership.js';
import { membershipOp, shuffled, testKey } from './testing.js';

const T0 = 1_760_000_000;
const holon = testKey();
const alice = testKey();
const bob = testKey();

describe('actorsFromMembersLog', () => {
  const log = [
    membershipOp({ sk: holon.sk, op: 'genesis', created_at: T0 }),
    membershipOp({ sk: holon.sk, op: 'add', pubkey: alice.pk, role: 'member', created_at: T0 + 10 }),
    membershipOp({ sk: holon.sk, op: 'add', pubkey: bob.pk, role: 'admin', created_at: T0 + 20 }),
    membershipOp({ sk: bob.sk, op: 'remove', pubkey: alice.pk, created_at: T0 + 30 }),
    membershipOp({ sk: alice.sk, op: 'add', pubkey: alice.pk, role: 'admin', created_at: T0 + 40 }), // not an admin: no effect
  ];

  it('folds genesis + admin-gated ops, as of time', () => {
    const actors = actorsFromMembersLog(shuffled(log), holon.pk)!;
    expect(actors.source).toBe('log');
    expect(actors.genesis).toBe(holon.pk);
    expect(actors.isAcceptedAt(alice.pk, T0 + 5)).toBe(false);
    expect(actors.isAcceptedAt(alice.pk, T0 + 15)).toBe(true);
    expect(actors.roleAt(alice.pk, T0 + 15)).toBe('member');
    expect(actors.isAcceptedAt(alice.pk, T0 + 35)).toBe(false); // removed by bob, an admin
    expect(actors.isAcceptedAt(alice.pk, T0 + 45)).toBe(false); // her own re-add does not count
    expect(actors.roleAt(bob.pk, T0 + 25)).toBe('admin');
    expect(actors.roleAt(holon.pk, T0)).toBe('admin');
  });

  it('is null without a genesis, and a pinned genesis ignores an impostor', () => {
    expect(actorsFromMembersLog(log.slice(1))).toBeNull();
    const impostor = testKey();
    const fake = membershipOp({ sk: impostor.sk, op: 'genesis', created_at: T0 - 100 });
    expect(actorsFromMembersLog([fake, ...log], holon.pk)!.genesis).toBe(holon.pk);
    expect(actorsFromMembersLog([fake, ...log])!.genesis).toBe(impostor.pk); // TOFU: earliest wins
  });
});

describe('bootstrap + resolve', () => {
  it('a bootstrap list is time-blind and provisional', () => {
    const a = bootstrapActors({ members: [alice.pk], admins: [holon.pk], genesis: holon.pk });
    expect(a.source).toBe('bootstrap');
    expect(a.isAcceptedAt(alice.pk, 0)).toBe(true);
    expect(a.roleAt(alice.pk, 0)).toBe('member');
    expect(a.roleAt(holon.pk, 0)).toBe('admin');
    expect(a.roleAt(bob.pk, 0)).toBeNull();
  });

  it('resolve prefers a founded log, falls back to bootstrap', () => {
    const founded = resolveAcceptedActors({
      membersLog: [membershipOp({ sk: holon.sk, op: 'genesis', created_at: T0 })],
      genesis: holon.pk,
      bootstrap: { members: [bob.pk] },
    });
    expect(founded.source).toBe('log');
    expect(founded.isAcceptedAt(bob.pk, T0)).toBe(false);
    const provisional = resolveAcceptedActors({ membersLog: [], bootstrap: { members: [bob.pk] } });
    expect(provisional.source).toBe('bootstrap');
    expect(provisional.isAcceptedAt(bob.pk, T0)).toBe(true);
  });
});

describe('syncMembersLog', () => {
  it('founds once, then adds, re-roles and removes the difference', async () => {
    const hs = createHoloSphere({ appName: 'members-sync-test', privateKey: bytesToHex(holon.sk), store: { adapter: 'memory' } });
    const H = 'h-sync';
    const first = await syncMembersLog(hs, H, new Map([[alice.pk, 'member'], [bob.pk, 'admin']]));
    expect(first).toEqual({ founded: true, added: [alice.pk, bob.pk], removed: [], changed: [] });
    expect(await hs.getMembers(H)).toEqual(new Map([[holon.pk, 'admin'], [alice.pk, 'member'], [bob.pk, 'admin']]));

    const again = await syncMembersLog(hs, H, new Map([[alice.pk, 'member'], [bob.pk, 'admin']]));
    expect(again).toEqual({ founded: false, added: [], removed: [], changed: [] });

    const changed = await syncMembersLog(hs, H, new Map([[alice.pk, 'admin']]));
    expect(changed).toEqual({ founded: false, added: [], removed: [bob.pk], changed: [alice.pk] });
    expect(await hs.getMembers(H)).toEqual(new Map([[holon.pk, 'admin'], [alice.pk, 'admin']]));

    const actors = actorsFromMembersLog(await readMembersLog(hs, H), holon.pk)!;
    expect(actors.genesis).toBe(holon.pk);
    expect(actors.roleAt(alice.pk, Math.floor(Date.now() / 1000) + 5)).toBe('admin');
    await hs.close();
  });
});
