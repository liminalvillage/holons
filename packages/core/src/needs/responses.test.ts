// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { closeNeed, respondToNeed } from './responses.js';
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
