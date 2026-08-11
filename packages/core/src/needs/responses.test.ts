// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  claimNeed,
  closeNeed,
  handoffCode,
  recordHandoffConfirmation,
  respondToNeed,
} from './responses.js';
import type { PublishedNeed } from './types.js';

const need = (status: PublishedNeed['status']): PublishedNeed =>
  ({
    id: 'need-1',
    title: 'flour 5kg',
    type: 'need',
    status,
    participants: [],
    responses: [],
  }) as PublishedNeed;

describe('respondToNeed', () => {
  it('appends the response and flips a requested need to offered', () => {
    const out = respondToNeed(need('requested'), {
      responder: { id: 7, name: 'Local Mill', holonId: 'mill-holon' },
      message: 'Fresh stone-ground, can deliver Friday',
      price: 8.5,
      currency: 'EUR',
      id: 'resp-1',
      now: 1700000000000,
    });
    expect(out.ok).toBe(true);
    expect(out.need.status).toBe('offered');
    expect(out.need.responses).toHaveLength(1);
    expect(out.response).toMatchObject({
      id: 'resp-1',
      responder: { id: 7, holonId: 'mill-holon' },
      price: 8.5,
      currency: 'EUR',
      createdAt: new Date(1700000000000).toISOString(),
    });
  });

  it('allows further responses while offered (several providers may bid)', () => {
    const first = respondToNeed(need('requested'), { responder: { id: 7 }, id: 'r1' });
    const second = respondToNeed(first.need, { responder: { id: 8 }, id: 'r2' });
    expect(second.ok).toBe(true);
    expect(second.need.responses?.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('rejects the initiator answering their own need (map-reached records look foreign)', () => {
    const mine = { ...need('requested'), initiator: { id: 7 } } as PublishedNeed;
    const out = respondToNeed(mine, { responder: { id: '7' } });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('own_need');
    expect(out.need.responses).toHaveLength(0);
  });

  it('rejects responses on claimed, fulfilled, or cancelled needs', () => {
    for (const status of ['claimed', 'fulfilled', 'cancelled'] as const) {
      const out = respondToNeed(need(status), { responder: { id: 7 } });
      expect(out.ok).toBe(false);
      expect(out.reason).toBe('closed');
      expect(out.need.responses).toHaveLength(0);
    }
  });

  it('rejects a response without a responder id and does not mutate the input', () => {
    const original = need('requested');
    const out = respondToNeed(original, { responder: {} as never });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('invalid_responder');
    expect(original.status).toBe('requested');
  });
});

describe('claimNeed', () => {
  it('accepts a response on an offered need and records the winner', () => {
    const offered = respondToNeed(need('requested'), { responder: { id: 7 }, id: 'r1' }).need;
    const out = claimNeed(offered, 'r1', 1700000000000);
    expect(out.ok).toBe(true);
    expect(out.need.status).toBe('claimed');
    expect(out.need.claimedResponseId).toBe('r1');
    expect(out.need.claimedAt).toBe(new Date(1700000000000).toISOString());
  });

  it('rejects claiming a need that is not offered', () => {
    const out = claimNeed(need('requested'), 'r1');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not_offered');
  });

  it('rejects claiming a response that does not exist', () => {
    const offered = respondToNeed(need('requested'), { responder: { id: 7 }, id: 'r1' }).need;
    const out = claimNeed(offered, 'nope');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no_such_response');
  });
});

describe('handoff', () => {
  const claimed = () => {
    const offered = respondToNeed(need('requested'), { responder: { id: 7, name: 'Anna' }, id: 'r1' }).need;
    return claimNeed(offered, 'r1').need;
  };

  it('claiming mints a random code; the legacy derivation survives for old records', () => {
    const n = claimed();
    expect(n.handoff?.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    // Legacy fallback, still used to complete pre-entropy in-flight handoffs.
    expect(handoffCode('need-1785745502672-oj4ef5')).toBe('EF5');
    expect(handoffCode('')).toBe('WQ0');
  });

  it('requester confirms without a code; provider must type the right one', () => {
    const n = claimed();
    const r = recordHandoffConfirmation(n, 'requester', { now: 1700000000000 });
    expect(r.ok).toBe(true);
    expect(r.both).toBe(false);
    expect(r.need.handoff?.requesterAt).toBe(new Date(1700000000000).toISOString());

    const bad = recordHandoffConfirmation(r.need, 'provider', { code: 'XXX' });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('bad_code');
    expect(bad.both).toBe(false);

    const good = recordHandoffConfirmation(r.need, 'provider', {
      code: n.handoff!.code.toLowerCase(),
    });
    expect(good.ok).toBe(true);
    expect(good.both).toBe(true);
  });

  it('confirmations are idempotent per side and order-independent', () => {
    const n = claimed();
    const p = recordHandoffConfirmation(n, 'provider', { code: n.handoff!.code });
    expect(p.ok).toBe(true);
    expect(p.both).toBe(false);
    const again = recordHandoffConfirmation(p.need, 'provider', { code: n.handoff!.code });
    expect(again.reason).toBe('already_confirmed');
    expect(again.both).toBe(false);
    const r = recordHandoffConfirmation(p.need, 'requester');
    expect(r.both).toBe(true);
  });

  it('rejects confirmation before the need is claimed', () => {
    const out = recordHandoffConfirmation(need('offered'), 'requester');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not_claimed');
  });
});

describe('closeNeed', () => {
  it('fulfills an open need and stamps closedAt', () => {
    const out = closeNeed(need('offered'), 'fulfilled', 1700000000000);
    expect(out.ok).toBe(true);
    expect(out.need.status).toBe('fulfilled');
    expect(out.need.closedAt).toBe(new Date(1700000000000).toISOString());
  });

  it('cancels a requested need', () => {
    expect(closeNeed(need('requested'), 'cancelled').need.status).toBe('cancelled');
  });

  it('is idempotent on the same outcome', () => {
    const out = closeNeed(need('fulfilled'), 'fulfilled');
    expect(out.ok).toBe(true);
    expect(out.need.status).toBe('fulfilled');
  });

  it('refuses to flip an already-closed need to a different outcome', () => {
    const out = closeNeed(need('cancelled'), 'fulfilled');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('already_closed');
    expect(out.need.status).toBe('cancelled');
  });
});
