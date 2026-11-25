// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { FLOW_CLAIMS_LENS } from '../flows/claims.js';
import { holonMembers } from '../protocol/founding.js';
import { syncMembersLog } from '../protocol/membership.js';
import { testKey } from '../protocol/testing.js';
import type { Role } from '../protocol/types.js';
import {
  PREDECESSOR_PREFIX,
  SUCCESSION_LENS,
  SUCCESSOR_ID,
  isSuccessionRecord,
  readSuccessor,
  resolveHolon,
  succeedHolon,
} from './succession.js';

const B = testKey(); // the bot: anchor of both chats
const A = testKey(); // an ambassador seated in the old holon
const M = testKey(); // a member seated in the old holon
const S = testKey(); // a stranger
const hex = (k: { sk: Uint8Array }) => bytesToHex(k.sk);

const OLD = '-4123456789';
const NEW = '-1002123456789';
const PERSON = '777001';

let n = 0;
function instance(key = B) {
  // The ledger is left on (it is part of what a copy triggers); the registry
  // is a global table this spec has no use for.
  return createHoloSphere({ appName: `succession-test-${++n}`, privateKey: hex(key), store: { adapter: 'memory' }, registry: false });
}

const raw = (hs: ReturnType<typeof instance>, holon: string, lens: string, id: string) =>
  hs.get(holon, lens, id, null, { resolveHolograms: false }) as Promise<Record<string, any> | null>;

/** The old chat's holon as the bot leaves it: founded, two keys seated, some records. */
async function seedOld(hs: ReturnType<typeof instance>) {
  await syncMembersLog(hs, OLD, new Map<string, Role>([[A.pk, 'admin'], [M.pk, 'member']]), { prune: false });
  await hs.put(OLD, 'settings', { id: OLD, name: 'Orto', holonPubkey: B.pk, timezone: 'Europe/Rome' });
  await hs.put(OLD, 'quests', { id: '1', title: 'Water the beds', type: 'task', participants: [{ id: PERSON, username: 'ada' }] });
  await hs.put(OLD, 'quests', { id: '2', title: 'Fix the gate', type: 'task', participants: [] });
  await hs.put(OLD, 'library', { id: 'drill', title: 'Drill' });
}
const OLD_N = Number(OLD);
const NEW_N = Number(NEW);

describe('pure', () => {
  it('a succession record names one other holon', () => {
    expect(isSuccessionRecord({ id: SUCCESSOR_ID, holon: NEW, at: 1 })).toBe(true);
    expect(isSuccessionRecord({ id: `${PREDECESSOR_PREFIX}${OLD}`, holon: OLD, at: 1, by: B.pk })).toBe(true);
    expect(isSuccessionRecord({ id: SUCCESSOR_ID, holon: '', at: 1 })).toBe(false);
    expect(isSuccessionRecord({ id: SUCCESSOR_ID, holon: `${NEW}/settings`, at: 1 })).toBe(false);
    expect(isSuccessionRecord({ id: 'other', holon: NEW, at: 1 })).toBe(false);
    expect(isSuccessionRecord({ id: SUCCESSOR_ID, holon: NEW })).toBe(false);
    expect(isSuccessionRecord(null)).toBe(false);
  });
});

describe('succeedHolon', () => {
  it('founds the new holon with the old roster, copies the records and leaves a signed pair', async () => {
    const hs = instance();
    await seedOld(hs);
    // The person named on quest 1 holds its mirror in their own holon.
    const before = await raw(hs, PERSON, 'quests', '1');
    expect(hs.parseSoulPath(before!.soul)!.holon).toBe(OLD);

    await hs.put(OLD, 'expenses', { id: 'e1', holon: OLD, chat: OLD_N, splitWith: [OLD, PERSON], note: `paid in ${OLD}`, nested: { origin: OLD } });

    const r = await succeedHolon(hs, { from: OLD, to: NEW });
    if (!r.ok) throw new Error(r.refused);
    expect(r.founded).toBe(true);
    expect(r.seated.sort()).toEqual([A.pk, M.pk].sort());
    expect(r.copied.quests).toBe(2);
    expect(r.copied.library).toBe(1);
    expect(r.conflicts).toEqual([]);
    expect(r.failed).toEqual([]);

    const members = await holonMembers(hs, NEW);
    expect(members.get(B.pk)).toBe('admin');
    expect(members.get(A.pk)).toBe('admin');
    expect(members.get(M.pk)).toBe('member');

    expect(await raw(hs, NEW, 'quests', '1')).toMatchObject({ id: '1', title: 'Water the beds' });
    expect(await raw(hs, NEW, 'library', 'drill')).toMatchObject({ title: 'Drill' });
    // A record that named its holon names the new id — whole values only.
    expect(await raw(hs, NEW, 'expenses', 'e1')).toMatchObject({
      holon: NEW,
      chat: NEW_N,
      splitWith: [NEW, PERSON],
      note: `paid in ${OLD}`,
      nested: { origin: NEW },
    });
    // The self-keyed settings record moves to the new id and keeps its fields.
    expect(await raw(hs, NEW, 'settings', NEW)).toMatchObject({ id: NEW, name: 'Orto', timezone: 'Europe/Rome', holonPubkey: B.pk });
    expect(await raw(hs, NEW, 'settings', OLD)).toBeNull();
    // Nothing is taken away from the old holon.
    expect(await raw(hs, OLD, 'quests', '1')).toMatchObject({ title: 'Water the beds' });

    expect(await raw(hs, OLD, SUCCESSION_LENS, SUCCESSOR_ID)).toMatchObject({ holon: NEW, by: B.pk });
    expect(await raw(hs, NEW, SUCCESSION_LENS, `${PREDECESSOR_PREFIX}${OLD}`)).toMatchObject({ holon: OLD, by: B.pk });
    expect(await readSuccessor(hs, OLD)).toBe(NEW);
    expect(await readSuccessor(hs, NEW)).toBeNull();
    expect(await resolveHolon(hs, OLD)).toBe(NEW);
    expect(await resolveHolon(hs, NEW)).toBe(NEW);
    expect(await resolveHolon(hs, '-999')).toBe('-999');

    // The person's mirror now points at the card where it lives.
    expect(r.repointed).toBe(1);
    const after = await raw(hs, PERSON, 'quests', '1');
    expect(hs.parseSoulPath(after!.soul)!.holon).toBe(NEW);
  });

  it('is idempotent: a second run writes nothing new', async () => {
    const hs = instance();
    await seedOld(hs);
    // A dry run says what would happen and signs nothing.
    const dry = await succeedHolon(hs, { from: OLD, to: NEW, dryRun: true });
    if (!dry.ok) throw new Error(dry.refused);
    expect(dry.founded).toBe(true);
    expect(dry.seated.sort()).toEqual([A.pk, M.pk].sort());
    expect(dry.copied).toMatchObject({ quests: 2, library: 1, settings: 1 });
    expect(hs.listLenses(NEW)).toEqual([]);
    expect(await raw(hs, OLD, SUCCESSION_LENS, SUCCESSOR_ID)).toBeNull();
    expect(hs.parseSoulPath((await raw(hs, PERSON, 'quests', '1'))!.soul)!.holon).toBe(OLD);
    const first = await succeedHolon(hs, { from: OLD, to: NEW });
    if (!first.ok) throw new Error(first.refused);
    const second = await succeedHolon(hs, { from: OLD, to: NEW });
    if (!second.ok) throw new Error(second.refused);
    expect(second.founded).toBe(false);
    expect(second.seated).toEqual([]);
    expect(second.copied).toEqual({});
    expect(second.repointed).toBe(0);
    expect(second.kept).toBeGreaterThanOrEqual(4);
  });

  it('merges into a holon people already wrote in: its own records win, differences are reported', async () => {
    const hs = instance();
    await seedOld(hs);
    await syncMembersLog(hs, NEW, new Map<string, Role>(), { prune: false });
    await hs.put(NEW, 'settings', { id: NEW, name: 'Orto (public)', holonPubkey: B.pk });
    await hs.put(NEW, 'quests', { id: '1', title: 'A different first quest', type: 'task', participants: [] });
    await hs.put(NEW, 'quests', { id: '9', title: 'Born here', type: 'task', participants: [] });
    // Deleted in the new holon: a copy must not bring it back.
    await hs.put(NEW, 'library', { id: 'drill', title: 'Drill' });
    await hs.delete(NEW, 'library', 'drill');

    const r = await succeedHolon(hs, { from: OLD, to: NEW });
    if (!r.ok) throw new Error(r.refused);
    expect(r.founded).toBe(false);
    expect(r.conflicts).toEqual([{ lens: 'quests', id: '1' }]);
    expect(r.copied.quests).toBe(1);
    expect(r.copied.library).toBeUndefined();
    expect(await raw(hs, NEW, 'quests', '1')).toMatchObject({ title: 'A different first quest' });
    expect(await raw(hs, NEW, 'quests', '2')).toMatchObject({ title: 'Fix the gate' });
    expect(await raw(hs, NEW, 'quests', '9')).toMatchObject({ title: 'Born here' });
    expect(await raw(hs, NEW, 'library', 'drill')).toBeNull();
    // Settings: the new holon's own fields win, the old ones fill the gaps.
    expect(await raw(hs, NEW, 'settings', NEW)).toMatchObject({ name: 'Orto (public)', timezone: 'Europe/Rome' });
    // The person's mirror still points at the old card: the new holon's quest 1 is another card.
    expect(r.repointed).toBe(0);

    const forced = await succeedHolon(hs, { from: OLD, to: NEW, overwrite: true });
    if (!forced.ok) throw new Error(forced.refused);
    expect(forced.conflicts).toEqual([]);
    expect(await raw(hs, NEW, 'quests', '1')).toMatchObject({ title: 'Water the beds' });
    expect(await raw(hs, NEW, 'settings', NEW)).toMatchObject({ name: 'Orto', id: NEW });
    // A deletion made in the new holon stands even then.
    expect(await raw(hs, NEW, 'library', 'drill')).toBeNull();
  });

  it('never copies what it cannot carry faithfully: logs, reserved lenses, sealed scopes', async () => {
    const hs = instance();
    await seedOld(hs);
    await hs.append(OLD, FLOW_CLAIMS_LENS, { t: 'action', kind: 'claim', amount: 1 });
    await hs.put(OLD, 'notes', { id: 'n1', text: 'secret' });
    await hs.put(OLD, 'notes', { id: 'n2', text: 'open' });
    const sealed = new Set(['notes/n1']);
    const host = hs as unknown as { isPrivate(h: string | null, l: string, i?: string | null): boolean };
    const realIsPrivate = host.isPrivate.bind(hs);
    host.isPrivate = (h, l, i) => (h === OLD && ((l === 'diary' && !i) || sealed.has(`${l}/${i}`))) || realIsPrivate(h, l, i);
    await hs.put(OLD, 'diary', { id: 'd1', text: 'dear diary' });

    const r = await succeedHolon(hs, { from: OLD, to: NEW });
    if (!r.ok) throw new Error(r.refused);
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.lens, s.reason]));
    expect(reasons[FLOW_CLAIMS_LENS]).toBe('log');
    expect(reasons._members).toBe('reserved');
    expect(reasons.diary).toBe('sealed');
    expect(r.sealed).toEqual([{ lens: 'notes', id: 'n1' }]);
    expect(await raw(hs, NEW, 'notes', 'n2')).toMatchObject({ text: 'open' });
    expect(await raw(hs, NEW, 'notes', 'n1')).toBeNull();
    expect(await raw(hs, NEW, 'diary', 'd1')).toBeNull();
    expect(hs.listLenses(NEW)).not.toContain(FLOW_CLAIMS_LENS);
  });

  it('refuses what is not this key\'s to move', async () => {
    const hs = instance();
    await seedOld(hs);
    expect(await succeedHolon(hs, { from: OLD, to: OLD })).toEqual({ ok: false, refused: 'same' });
    expect(await succeedHolon(hs, { from: OLD, to: `${NEW}/settings` })).toEqual({ ok: false, refused: 'not-holon' });
    expect(await succeedHolon(hs, { from: OLD, to: B.pk })).toEqual({ ok: false, refused: 'not-holon' });
    expect(await succeedHolon(hs, { from: '', to: NEW })).toEqual({ ok: false, refused: 'not-holon' });
    // Nobody founded this one: there is nothing to speak for.
    expect(await succeedHolon(hs, { from: '-555', to: NEW })).toEqual({ ok: false, refused: 'not-ambassador' });

    // A member of the old holon, or a stranger, cannot move it.
    await hs.login(hex(M));
    expect(await succeedHolon(hs, { from: OLD, to: NEW })).toEqual({ ok: false, refused: 'not-ambassador' });
    await hs.login(hex(S));
    expect(await succeedHolon(hs, { from: OLD, to: NEW })).toEqual({ ok: false, refused: 'not-ambassador' });

    // A holon someone else already anchored is not a place to move into.
    await syncMembersLog(hs, '-1009', new Map<string, Role>(), { prune: false });
    await hs.login(hex(B));
    expect(await succeedHolon(hs, { from: OLD, to: '-1009' })).toEqual({ ok: false, refused: 'taken' });
    expect(await raw(hs, OLD, SUCCESSION_LENS, SUCCESSOR_ID)).toBeNull();

    // Once moved, it does not move somewhere else, and never in a circle.
    const ok = await succeedHolon(hs, { from: OLD, to: NEW });
    expect(ok.ok).toBe(true);
    expect(await succeedHolon(hs, { from: OLD, to: '-1003' })).toEqual({ ok: false, refused: 'moved' });
    expect(await succeedHolon(hs, { from: NEW, to: OLD })).toEqual({ ok: false, refused: 'cycle' });
  });

  it('a successor counts only when ambassadors of BOTH holons signed their half', async () => {
    const hs = instance();
    await seedOld(hs);
    await syncMembersLog(hs, NEW, new Map<string, Role>(), { prune: false });

    // A member plants a "successor" in the old holon.
    await hs.login(hex(M));
    await hs.put(OLD, SUCCESSION_LENS, { id: SUCCESSOR_ID, holon: '-1666', at: Date.now(), by: M.pk });
    await hs.login(hex(B));
    expect(await readSuccessor(hs, OLD)).toBeNull();

    // The old holon's ambassador names a holon that never agreed.
    await hs.put(OLD, SUCCESSION_LENS, { id: SUCCESSOR_ID, holon: NEW, at: Date.now(), by: B.pk });
    expect(await readSuccessor(hs, OLD)).toBeNull();
    expect(await resolveHolon(hs, OLD)).toBe(OLD);

    // …until the new holon's ambassador signs the other half.
    await hs.put(NEW, SUCCESSION_LENS, { id: `${PREDECESSOR_PREFIX}${OLD}`, holon: OLD, at: Date.now(), by: B.pk });
    expect(await readSuccessor(hs, OLD)).toBe(NEW);
  });

  it('follows a chain and stops at a loop', async () => {
    const hs = instance();
    const [X, Y, Z] = ['-11', '-22', '-33'];
    for (const h of [X, Y, Z]) await syncMembersLog(hs, h, new Map<string, Role>(), { prune: false });
    const pair = async (from: string, to: string) => {
      await hs.put(from, SUCCESSION_LENS, { id: SUCCESSOR_ID, holon: to, at: Date.now(), by: B.pk });
      await hs.put(to, SUCCESSION_LENS, { id: `${PREDECESSOR_PREFIX}${from}`, holon: from, at: Date.now(), by: B.pk });
    };
    await pair(X, Y);
    await pair(Y, Z);
    expect(await resolveHolon(hs, X)).toBe(Z);
    await pair(Z, X); // hand-made loop: resolution must still end
    expect([X, Y, Z]).toContain(await resolveHolon(hs, X));
  });
});
