// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import { questKind } from '../tasks/index.js';
import { JOIN_REVIEW_LENS, dealJoinReview, joinReviewCard, joinReviewId, settleJoinReview } from './reviews.js';

const bot = testKey();
const H = 'holon_aaaaaaaaaaaaaaaa';
const HOME = '4242';
const request = { pubkey: 'AB'.repeat(32), eventId: 'e'.repeat(64) };

function instance() {
  const hs = createHoloSphere({ appName: 'holons-test', privateKey: bytesToHex(bot.sk), store: { adapter: 'memory' } });
  const h = hs as unknown as { publishNostrEvents(e: unknown): void; subscribeNostr(): () => void };
  h.publishNostrEvents = () => {};
  h.subscribeNostr = () => () => {};
  return hs;
}

describe('a join request as a card on an admin’s board', () => {
  it('is an ordinary open task of the admin, naming who asks and where', () => {
    const card = joinReviewCard(H, HOME, request, { name: 'Kamala', holonName: 'Solstice', link: 'https://hubs.network/x' });
    expect(card).toMatchObject({
      id: joinReviewId(H, request.pubkey),
      title: 'Link Kamala to Solstice',
      status: 'ongoing',
      category: 'membership',
      link: 'https://hubs.network/x',
      participants: [{ id: 4242 }],
      initiator: { id: H, username: 'Solstice' },
      joinReview: { holon: H, pubkey: request.pubkey.toLowerCase(), eventId: request.eventId },
    });
    expect(questKind(card)).toBe('task');
    // One per holon and key, whatever the key's case; a surface may word it.
    expect(joinReviewId(H, request.pubkey)).toBe(joinReviewId(H, request.pubkey.toLowerCase()));
    expect(joinReviewCard(H, HOME, request, { title: 'Collega Kamala' }).title).toBe('Collega Kamala');
  });

  it('is dealt once: a newer ask from the same key never deals a second', async () => {
    const hs = instance();
    expect(await dealJoinReview(hs, H, HOME, request, { name: 'Kamala' })).toBe(true);
    expect(await dealJoinReview(hs, H, HOME, { ...request, eventId: 'f'.repeat(64) }, { name: 'Kamala' })).toBe(false);
    const all = (await hs.getAll(HOME, JOIN_REVIEW_LENS)) as unknown[];
    expect(all).toHaveLength(1);
    await hs.close();
  });

  it('closes when the key is linked, and stays closed', async () => {
    const hs = instance();
    await dealJoinReview(hs, H, HOME, request);
    expect(await settleJoinReview(hs, H, HOME, request.pubkey)).toBe(true);
    expect(await hs.get(HOME, JOIN_REVIEW_LENS, joinReviewId(H, request.pubkey))).toMatchObject({ status: 'completed' });
    expect(await settleJoinReview(hs, H, HOME, request.pubkey)).toBe(false);
    // An admin who put the card away is not asked about that key again.
    expect(await dealJoinReview(hs, H, HOME, request)).toBe(false);
    await hs.close();
  });

  it('settling a card that was never dealt does nothing', async () => {
    const hs = instance();
    expect(await settleJoinReview(hs, H, HOME, request.pubkey)).toBe(false);
    await hs.close();
  });
});
