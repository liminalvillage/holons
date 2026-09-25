// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { buildEvent } from 'holosphere/nostr-events.js';
import { createHoloSphere } from './factory.js';
import { createReadAuthority, resolveHolonAuthority, writeAcceptance } from './authority.js';
import { testKey } from '../protocol/testing.js';

const APP = 'authority-core-test';
const T0 = 1_760_000_000;
const NOW = Number.MAX_SAFE_INTEGER;

const sphere = (sk = testKey().sk, enforce?: boolean) =>
  createHoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' }, ...(enforce === undefined ? {} : { enforce }) });
const signed = (sk: Uint8Array, holon: string, lens: string, item: Record<string, unknown>, at: number) =>
  buildEvent({ holon, lens, item, sk, created_at: at, extraTags: [['n', APP]] });

describe('resolveHolonAuthority', () => {
  it('a pubkey holon is its key plus what it linked itself', async () => {
    const me = testKey(), linked = testKey(), other = testKey(), stranger = testKey();
    const hs = sphere(me.sk);
    await hs.ready();
    hs.store.apply(signed(me.sk, me.pk, 'users', { id: 'me', linkedKeys: [linked.pk] }, T0), { origin: 'remote' });
    // A users record someone else wrote into my holon does not add keys.
    hs.store.apply(signed(other.sk, me.pk, 'users', { id: 'x', linkedKeys: [stranger.pk] }, T0 + 1), { origin: 'remote' });
    const a = resolveHolonAuthority(hs, me.pk);
    expect(a.anchor).toBe(me.pk);
    expect(a.actors!.isAcceptedAt(me.pk, NOW)).toBe(true);
    expect(a.actors!.isAcceptedAt(linked.pk, NOW)).toBe(true);
    expect(a.actors!.isAcceptedAt(stranger.pk, NOW)).toBe(false);
  });

  it('a founded holon is its log, as of time', async () => {
    const bot = testKey(), member = testKey();
    const hs = sphere(bot.sk);
    await hs.ready();
    await hs.foundHolon('-200', { at: T0 });
    await hs.addMember('-200', member.pk, 'member', { at: T0 + 10 });
    const a = resolveHolonAuthority(hs, '-200');
    expect(a.anchor).toBe(bot.pk);
    expect(a.actors!.source).toBe('log');
    expect(a.actors!.isAcceptedAt(member.pk, T0 + 5)).toBe(false);
    expect(a.actors!.isAcceptedAt(member.pk, T0 + 15)).toBe(true);
  });

  it('an unfounded holon bootstraps from its anchor-signed records only', async () => {
    const bot = testKey(), trusted = testKey(), linked = testKey(), squatter = testKey(), squatted = testKey();
    const hs = sphere();
    await hs.ready();
    hs.store.apply(signed(bot.sk, '-300', 'settings', { id: '-300', holonPubkey: bot.pk, nostrTrustedPubkeys: [trusted.pk] }, T0), { origin: 'remote' });
    hs.store.apply(signed(bot.sk, '-300', 'users', { id: '42', linkedKeys: [linked.pk] }, T0 + 1), { origin: 'remote' });
    // The last writer of settings and a users record by a stranger count for nothing.
    hs.store.apply(signed(squatter.sk, '-300', 'settings', { id: '-300', holonPubkey: squatter.pk, nostrTrustedPubkeys: [squatted.pk] }, T0 + 2), { origin: 'remote' });
    hs.store.apply(signed(squatter.sk, '-300', 'users', { id: '43', linkedKeys: [squatted.pk] }, T0 + 3), { origin: 'remote' });
    const a = resolveHolonAuthority(hs, '-300');
    expect(a.anchor).toBe(bot.pk);
    expect(a.actors!.source).toBe('bootstrap');
    for (const k of [bot.pk, trusted.pk, linked.pk]) expect(a.actors!.isAcceptedAt(k, NOW)).toBe(true);
    for (const k of [squatter.pk, squatted.pk]) expect(a.actors!.isAcceptedAt(k, NOW)).toBe(false);
  });

  it('a cell and a holon nothing signed speaks for have nobody defined', async () => {
    const hs = sphere();
    await hs.ready();
    expect(resolveHolonAuthority(hs, '89283082803ffff').actors).toBeNull();
    expect(resolveHolonAuthority(hs, '-400').actors).toBeNull();
    expect(resolveHolonAuthority(hs, '').actors).toBeNull();
  });
});

describe('createReadAuthority through the factory', () => {
  it('reads collapse to accepted authors where someone is defined, and stay open elsewhere', async () => {
    const bot = testKey(), stranger = testKey();
    const hs = sphere(bot.sk);
    await hs.ready();
    expect(hs.enforceActive).toBe(true);
    await hs.foundHolon('-500', { at: T0 });
    await hs.put('-500', 'tasks', { id: 'a', title: 'by the bot' });
    hs.store.apply(signed(stranger.sk, '-500', 'tasks', { id: 'b', title: 'planted' }, T0 + 100), { origin: 'remote' });
    hs.store.apply(signed(stranger.sk, '-501', 'tasks', { id: 'b', title: 'open' }, T0 + 100), { origin: 'remote' });
    expect((await hs.getAll('-500', 'tasks')).map((t: { id: string }) => t.id)).toEqual(['a']);
    expect((await hs.getPending('-500', 'tasks')).map((t: { id: string }) => t.id)).toEqual(['b']);
    expect((await hs.getAll('-501', 'tasks')).map((t: { id: string }) => t.id)).toEqual(['b']);
  });

  it('a grant sender must count for the holon; the holon itself always does', async () => {
    const bot = testKey(), member = testKey(), stranger = testKey(), person = testKey();
    const hs = sphere(bot.sk);
    await hs.ready();
    await hs.foundHolon('-600', { at: T0 });
    await hs.addMember('-600', member.pk, 'member', { at: T0 + 1 });
    const auth = createReadAuthority({ ttlMs: 0 });
    expect(await auth.acceptGrantFrom(hs, '-600', 'quests', bot.pk)).toBe(true);
    expect(await auth.acceptGrantFrom(hs, '-600', 'quests', member.pk)).toBe(true);
    expect(await auth.acceptGrantFrom(hs, '-600', 'quests', stranger.pk)).toBe(false);
    expect(await auth.acceptGrantFrom(hs, person.pk, 'notes', person.pk)).toBe(true);
    expect(await auth.acceptGrantFrom(hs, person.pk, 'notes', stranger.pk)).toBe(false);
    expect(await auth.acceptGrantFrom(hs, '-601', 'quests', stranger.pk)).toBe(false);
  });

  it('writeAcceptance says where a key stands, exactly as the reads enforce it', async () => {
    const bot = testKey(), member = testKey(), stranger = testKey();
    const hs = sphere(bot.sk);
    await hs.ready();
    expect(await writeAcceptance(hs, '-800')).toMatchObject({ status: 'open', anchor: null, source: null });
    await hs.foundHolon('-800', { at: T0 });
    await hs.addMember('-800', member.pk, 'member', { at: T0 + 1 });
    (hs as unknown as { _readAuthority: { invalidate(): void } })._readAuthority.invalidate();
    expect(await writeAcceptance(hs, '-800')).toMatchObject({ status: 'accepted', anchor: bot.pk, source: 'log' });
    expect(await writeAcceptance(hs, '-800', member.pk)).toMatchObject({ status: 'accepted' });
    expect(await writeAcceptance(hs, '-800', stranger.pk)).toMatchObject({ status: 'held', anchor: bot.pk, source: 'log' });
    expect(await writeAcceptance(hs, stranger.pk, stranger.pk)).toMatchObject({ status: 'accepted', anchor: stranger.pk });
    expect(await writeAcceptance(hs, stranger.pk, bot.pk)).toMatchObject({ status: 'held' });
    expect(await writeAcceptance(hs, '89283082803ffff', bot.pk)).toMatchObject({ status: 'open' });
  });

  it('enforce: false reads the open graph', async () => {
    const bot = testKey(), stranger = testKey();
    const hs = sphere(bot.sk, false);
    await hs.ready();
    expect(hs.enforceActive).toBe(false);
    await hs.foundHolon('-700', { at: T0 });
    hs.store.apply(signed(stranger.sk, '-700', 'tasks', { id: 'b', title: 'planted' }, T0 + 100), { origin: 'remote' });
    expect((await hs.getAll('-700', 'tasks')).map((t: { id: string }) => t.id)).toEqual(['b']);
  });
});
