// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { isClaimToken, readHolonClaim } from '../onboarding/index.js';
import { addHolonMember, foundHolon, holonMembers, newHolonId } from '../protocol/founding.js';
import { readMembersLog } from '../protocol/membership.js';
import { testKey } from '../protocol/testing.js';
import {
  LINKS_LENS,
  acceptTelegramLink,
  bridgeTelegramRoster,
  completeTelegramLink,
  isFreshLink,
  isLinkId,
  isLinkRecord,
  linkId,
  linkPayload,
  linkToken,
  linkedAdmins,
  linkedHolons,
  linkedTelegramChats,
  nextLinkState,
  offerTelegramLink,
  parseLinkPayload,
  readLinkAccept,
  readLinkOffer,
  unlinkChat,
  unlinkTelegram,
  type LinkRecord,
} from './index.js';

const P = testKey(); // the dashboard admin
const B = testKey(); // the bot
const M = testKey(); // a mere member of D
const S = testKey(); // a stranger
const m1 = testKey();
const m2 = testKey();
const hex = (k: { sk: Uint8Array }) => bytesToHex(k.sk);
const T = '-1001234567890';
const chat = { id: T, type: 'supergroup', title: 'Orto chat' };

describe('pure: tokens, ids, payloads', () => {
  it('a link id is a 32-hex hash of the token that is itself a valid claim key', () => {
    const t = linkToken();
    const id = linkId(t);
    expect(isLinkId(id)).toBe(true);
    expect(isClaimToken(id)).toBe(true);
    expect(linkId(t)).toBe(id);
    expect(linkId(linkToken())).not.toBe(id);
    expect(id.includes(t.slice(0, 6))).toBe(false);
    expect(() => linkId('short')).toThrow();
    expect(isLinkId('a'.repeat(64))).toBe(false);
  });

  it('a payload fits Telegram and round-trips tokens with _ and -', () => {
    const holon = newHolonId();
    for (const t of ['A_b-C_d-E_f-G_h-I_j-Kl', linkToken(), '_'.repeat(22), '-'.repeat(22)]) {
      const payload = linkPayload(holon, t);
      expect(payload.length).toBeLessThanOrEqual(64);
      expect(parseLinkPayload(payload)).toEqual({ holon, token: t });
      expect(parseLinkPayload(`/start ${payload}`)).toEqual({ holon, token: t });
      expect(parseLinkPayload(`/start@HolonsBot ${payload}`)).toEqual({ holon, token: t });
    }
    expect(parseLinkPayload(linkPayload('hub_aaaaaaaaaaaaaaaa', linkToken()))!.holon).toBe('hub_aaaaaaaaaaaaaaaa');
    expect(() => linkPayload('-1001234567890', linkToken())).toThrow();
    expect(() => linkPayload(P.pk, linkToken())).toThrow();
    expect(() => linkPayload(holon, 'nope')).toThrow();
    expect(parseLinkPayload('claim_' + linkToken())).toBeNull();
    expect(parseLinkPayload(`link_-1001_${linkToken()}`)).toBeNull();
    expect(parseLinkPayload('')).toBeNull();
  });

  it('records and states', () => {
    const r: LinkRecord = { id: 'a'.repeat(32), kind: 'telegram', status: 'offered', by: P.pk, at: 1 };
    expect(isLinkRecord(r)).toBe(true);
    expect(isLinkRecord({ ...r, status: 'maybe' })).toBe(false);
    expect(isLinkRecord({ ...r, peerAnchor: 'x' })).toBe(false);
    expect(isLinkRecord({ ...r, kind: 'discord' })).toBe(false);
    expect(isFreshLink({ at: 1000 }, 1000 + 60 * 60 * 1000)).toBe(true);
    expect(isFreshLink({ at: 1000 }, 1000 + 7 * 60 * 60 * 1000)).toBe(false);
    expect(isFreshLink({ at: 1000 + 120_000 }, 1000)).toBe(false);
    const table: Array<[Parameters<typeof nextLinkState>[0], Parameters<typeof nextLinkState>[1], ReturnType<typeof nextLinkState>]> = [
      [null, 'offer', 'offered'], ['unlinked', 'offer', 'offered'], ['offered', 'offer', null], ['linked', 'offer', null],
      ['offered', 'accept', 'accepted'], [null, 'accept', null], ['accepted', 'accept', null],
      ['offered', 'complete', 'linked'], ['accepted', 'complete', 'linked'], ['linked', 'complete', null], ['unlinked', 'complete', null],
      ['accepted', 'unlink', 'unlinked'], ['linked', 'unlink', 'unlinked'], ['offered', 'unlink', null], [null, 'unlink', null],
    ];
    for (const [from, ev, to] of table) expect(nextLinkState(from, ev), `${from} + ${ev}`).toBe(to);
  });
});

describe('the handshake, on one shared store', () => {
  it('offer → accept → complete → bridge → unlink, each side signing only its own record', async () => {
    const hs = createHoloSphere({ appName: 'linking-test', privateKey: hex(P), store: { adapter: 'memory' } });
    const D = newHolonId();
    await foundHolon(hs, D, { name: 'Orto' });
    await addHolonMember(hs, D, M.pk, 'member');

    // Only an admin offers.
    await hs.login(hex(M));
    await expect(offerTelegramLink(hs, D)).rejects.toThrow(/admin/);
    await hs.login(hex(S));
    await expect(offerTelegramLink(hs, D)).rejects.toThrow(/admin/);
    await hs.login(hex(P));
    const offer = await offerTelegramLink(hs, D);
    expect(offer.id).toBe(linkId(offer.token));
    expect(parseLinkPayload(offer.payload)).toEqual({ holon: D, token: offer.token });
    expect(offer.record).toMatchObject({ id: offer.id, status: 'offered', by: P.pk });

    // A member planting an "offer" under another id is not an offer; a stale one is not honoured.
    const planted = { id: linkId(linkToken()), kind: 'telegram', status: 'offered', by: M.pk, at: Date.now() };
    await hs.login(hex(M));
    await hs.put(D, LINKS_LENS, planted);
    const staleToken = linkToken();
    await hs.login(hex(P));
    await offerTelegramLink(hs, D, { token: staleToken, now: Date.now() - 7 * 60 * 60 * 1000 });

    // The bot judges D from the relay: only an admin-at-time offer counts.
    await hs.login(hex(B));
    expect(await readLinkOffer(hs, D, planted.id)).toBeNull();
    expect((await readLinkOffer(hs, D, offer.id))!.author).toBe(P.pk);
    expect(await acceptTelegramLink(hs, { holon: D, token: staleToken, chat, byUserId: 42 })).toEqual({ ok: false, refused: 'stale' });
    expect(await acceptTelegramLink(hs, { holon: D, token: linkToken(), chat, byUserId: 42 })).toEqual({ ok: false, refused: 'no-offer' });
    expect(await acceptTelegramLink(hs, { holon: '-100', token: offer.token, chat, byUserId: 42 })).toEqual({ ok: false, refused: 'not-holon' });

    await hs.put(T, 'settings', { id: T, name: 'Orto chat' });
    const accepted = await acceptTelegramLink(hs, { holon: D, token: offer.token, chat, byUserId: 42 });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted).toMatchObject({ holon: D, chat: T, id: offer.id, offerAuthor: P.pk });
    expect(accepted.record).toMatchObject({ status: 'accepted', peer: D, peerAnchor: P.pk, by: '42', chat: { id: T, kind: 'group', title: 'Orto chat' } });
    const tMembers = await holonMembers(hs, T);
    expect(tMembers.get(B.pk)).toBe('admin'); // founded by the bot
    expect(tMembers.get(P.pk)).toBe('admin'); // the dashboard admin, seated
    expect(await hs.get(T, 'settings', T)).toMatchObject({ holonPubkey: B.pk });
    expect((await readHolonClaim(hs, offer.id))!.holon).toBe(T);
    // Single use: the same link in another chat is refused.
    expect(await acceptTelegramLink(hs, { holon: D, token: offer.token, chat: { id: '-1009', type: 'supergroup', title: 'Other' }, byUserId: 42 })).toEqual({ ok: false, refused: 'wrong-state' });
    // The bridge does nothing before the screen seats the bot in D.
    expect(await bridgeTelegramRoster(hs, T, [m1.pk, m2.pk])).toEqual([]);
    expect((await holonMembers(hs, D)).has(m1.pk)).toBe(false);
    expect((await linkedAdmins(hs, T)).get(P.pk)).toBe('admin');

    // The screen believes only what T's anchor signed.
    await hs.login(hex(S));
    const forgedId = linkId(linkToken());
    await hs.put(T, LINKS_LENS, { id: forgedId, kind: 'telegram', status: 'accepted', peer: D, peerAnchor: S.pk, at: Date.now() });
    await hs.login(hex(P));
    expect(await readLinkAccept(hs, { holon: D, id: forgedId, chat: T })).toBeNull();
    expect(await readLinkAccept(hs, { holon: D, id: offer.id, chat: '-1009' })).toBeNull();
    const accept = await readLinkAccept(hs, { holon: D, id: offer.id, chat: T });
    expect(accept).toMatchObject({ chat: T, anchor: B.pk });
    expect(accept!.record.status).toBe('accepted');

    // A member cannot complete; the admin can, and it seats the bot key.
    await hs.login(hex(M));
    await expect(completeTelegramLink(hs, { holon: D, id: offer.id, chat: T, anchor: B.pk })).rejects.toThrow(/admin/);
    await hs.login(hex(P));
    const linked = await completeTelegramLink(hs, { holon: D, id: offer.id, chat: T, anchor: B.pk, name: 'Orto chat' });
    expect(linked).toMatchObject({ status: 'linked', peer: T, peerAnchor: B.pk, name: 'Orto chat' });
    expect(await completeTelegramLink(hs, { holon: D, id: offer.id, chat: T, anchor: B.pk })).toEqual(linked); // idempotent
    expect((await holonMembers(hs, D)).get(B.pk)).toBe('admin');
    expect((await linkedTelegramChats(hs, D)).map((r) => r.peer)).toEqual([T]);

    // Now the bot brings the chat's members in — adding only, never founding.
    await hs.login(hex(B));
    expect((await linkedHolons(hs, T)).map((r) => r.peer)).toEqual([D]);
    expect(await bridgeTelegramRoster(hs, T, [m1.pk, m2.pk, B.pk, 'junk'])).toEqual([D]);
    const dMembers = await holonMembers(hs, D);
    expect(dMembers.get(m1.pk)).toBe('member');
    expect(dMembers.get(m2.pk)).toBe('member');
    expect(dMembers.get(P.pk)).toBe('admin');
    expect(dMembers.get(M.pk)).toBe('member');
    expect((await readMembersLog(hs, D)).filter((e) => JSON.parse(e.content).op === 'genesis')).toHaveLength(1);

    // Unlink from both sides.
    await hs.login(hex(P));
    const gone = await unlinkTelegram(hs, D, offer.id);
    expect(gone!.status).toBe('unlinked');
    expect((await holonMembers(hs, D)).has(B.pk)).toBe(false);
    expect(await linkedTelegramChats(hs, D)).toEqual([]);
    expect(await unlinkTelegram(hs, D, offer.id)).toBeNull();
    await hs.login(hex(B));
    expect((await unlinkChat(hs, T, offer.id))!.status).toBe('unlinked');
    expect((await holonMembers(hs, T)).has(P.pk)).toBe(false);
    expect(await linkedHolons(hs, T)).toEqual([]);
    await hs.close();
  });
});
