// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import * as nip19 from 'nostr-tools/nip19';
import { latLngToCell } from 'h3-js';
import { createHoloSphere } from '../holosphere/factory.js';
import { holonAnchor } from 'holosphere/authority.js';
import {
  addHubMember,
  foundHub,
  foundingAuthority,
  hubMembers,
  isHubId,
  isTelegramChatId,
  myHubRole,
  newHubId,
  removeHubMember,
} from './founding.js';
import { testKey } from './testing.js';

const founder = testKey();
const alice = testKey();
const bob = testKey();

function instance(sk = founder.sk) {
  return createHoloSphere({ appName: 'founding-test', privateKey: bytesToHex(sk), store: { adapter: 'memory' } });
}

describe('hub ids', () => {
  it('mints prefixed, lowercase ids from the random source', () => {
    const id = newHubId(() => new Uint8Array(16).fill(0));
    expect(id).toBe('hub_aaaaaaaaaaaaaaaa');
    expect(isHubId(id)).toBe(true);
    expect(isHubId(newHubId())).toBe(true);
    expect(newHubId()).not.toBe(newHubId());
  });

  it('tells hub ids, Telegram chat ids and the rest apart', () => {
    expect(isHubId('hub_')).toBe(false);
    expect(isHubId('-1001234567890')).toBe(false);
    expect(isHubId(founder.pk)).toBe(false);
    expect(isTelegramChatId('-1001234567890')).toBe(true);
    expect(isTelegramChatId('235114395')).toBe(true);
    expect(isTelegramChatId('hub_aaaaaaaaaaaaaaaa')).toBe(false);
    expect(isTelegramChatId('liminal')).toBe(false);
  });
});

describe('foundingAuthority', () => {
  it('names who founds what', async () => {
    const hs = instance();
    expect(foundingAuthority(hs, founder.pk)).toEqual({ kind: 'self', anchor: founder.pk });
    expect(foundingAuthority(hs, latLngToCell(41.9, 12.5, 7))).toEqual({ kind: 'cell' });
    expect(foundingAuthority(hs, '-1001234567890')).toEqual({ kind: 'bot' });
    expect(foundingAuthority(hs, '235114395')).toEqual({ kind: 'bot' });
    expect(foundingAuthority(hs, 'hub_aaaaaaaaaaaaaaaa')).toEqual({ kind: 'open' });
    expect(foundingAuthority(hs, 'liminal')).toEqual({ kind: 'open' });
    await hs.close();
  });
});

describe('foundHub', () => {
  it('signs the genesis, seats members, declares the key in settings, and is idempotent', async () => {
    const hs = instance();
    const H = newHubId();
    const first = await foundHub(hs, H, {
      name: 'Orto',
      members: [[nip19.npubEncode(alice.pk), 'member'], [bob.pk, 'admin']],
    });
    expect(first).toEqual({ holon: H, anchor: founder.pk, founded: true, added: [alice.pk, bob.pk] });
    expect(holonAnchor((hs as any).store, H)).toBe(founder.pk);
    expect(foundingAuthority(hs, H)).toEqual({ kind: 'anchored', anchor: founder.pk, own: true });
    expect(await hubMembers(hs, H)).toEqual(new Map([[founder.pk, 'admin'], [alice.pk, 'member'], [bob.pk, 'admin']]));
    expect(await myHubRole(hs, H)).toBe('admin');

    const settings = (await hs.get(H, 'settings', H)) as Record<string, unknown>;
    expect(settings.id).toBe(H);
    expect(settings.name).toBe('Orto');
    expect(settings.holonPubkey).toBe(founder.pk);

    // Again: nothing re-founded, nobody unseated, the name kept.
    const again = await foundHub(hs, H);
    expect(again).toEqual({ holon: H, anchor: founder.pk, founded: false, added: [] });
    expect((await hubMembers(hs, H)).size).toBe(3);
    expect(((await hs.get(H, 'settings', H)) as Record<string, unknown>).name).toBe('Orto');
    await hs.close();
  });

  it('refuses what is not a person\'s to found', async () => {
    const hs = instance();
    await expect(foundHub(hs, founder.pk)).rejects.toThrow(/own key/);
    await expect(foundHub(hs, latLngToCell(41.9, 12.5, 7))).rejects.toThrow(/cell/);
    await expect(foundHub(hs, '-1001234567890')).rejects.toThrow(/Telegram/);
    await hs.close();
  });

  it('refuses a hub another key already founded', async () => {
    const hs = instance();
    const H = newHubId();
    await foundHub(hs, H, { name: 'Theirs' });
    await hs.login(bytesToHex(alice.sk));
    expect(foundingAuthority(hs, H)).toEqual({ kind: 'anchored', anchor: founder.pk, own: false });
    await expect(foundHub(hs, H)).rejects.toThrow(/Another key/);
    await hs.close();
  });
});

describe('members by key', () => {
  it('lets an admin seat and unseat keys, and nobody else', async () => {
    const hs = instance();
    const H = newHubId();
    await foundHub(hs, H, { members: [[alice.pk, 'member']] });

    expect(await addHubMember(hs, H, nip19.npubEncode(bob.pk))).toBe(bob.pk);
    expect((await hubMembers(hs, H)).get(bob.pk)).toBe('member');
    await expect(addHubMember(hs, H, 'not-a-key')).rejects.toThrow(/public key/);
    await expect(removeHubMember(hs, H, founder.pk)).rejects.toThrow(/own key/);

    expect(await removeHubMember(hs, H, bob.pk)).toBe(bob.pk);
    expect((await hubMembers(hs, H)).has(bob.pk)).toBe(false);

    // alice is a member, not an admin: her additions are refused up front.
    await hs.login(bytesToHex(alice.sk));
    expect(await myHubRole(hs, H)).toBe('member');
    await expect(addHubMember(hs, H, bob.pk)).rejects.toThrow(/admin/);
    await hs.close();
  });
});
