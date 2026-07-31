// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  CARD_MARKER,
  cardFromQuest,
  cardFromLibraryItem,
  encodeCardText,
  parseCardText,
  questFromCard,
  libraryAddFromCard
} from './card-clipboard.js';
import type { Quest } from '../tasks/types.js';
import type { LibraryItem } from '../library/types.js';

const quest: Quest = {
  id: '123',
  title: 'Fix the greenhouse pump',
  description: 'The impeller is clogged again.',
  category: 'maintenance',
  type: 'task',
  status: 'ongoing',
  when: '2026-08-01T09:00:00.000Z',
  ends: '2026-08-01T10:00:00.000Z',
  location: 'Greenhouse 2',
  picture: 'https://example.org/pump.jpg',
  participants: [{ id: 1, username: 'anna' }],
  appreciation: [{ id: 2 }],
  dependencies: ['99'],
  orderIndex: 4,
  initiator: { id: 7, username: 'seed' },
  _holon: '-100555',
  _hologram: { sourceHolonId: '-100555' }
};

const item: LibraryItem = {
  id: 'Cordless drill',
  type: 'tool',
  borrowed: true,
  borrower: 'anna',
  borrowerId: 1,
  bookings: [{ id: 'b1', borrower: 'anna', start: '2026-07-20', end: '2026-07-27' }] as any,
  category: 'Workshop',
  description: '18V, two batteries.',
  value: 5,
  created: '2026-01-01T00:00:00.000Z',
  createdBy: 7
};

describe('cardFromQuest', () => {
  it('keeps portable fields and drops memberships, ids and provenance', () => {
    const card = cardFromQuest(quest);
    expect(card).toEqual({
      kind: 'quest',
      data: {
        title: 'Fix the greenhouse pump',
        description: 'The impeller is clogged again.',
        category: 'maintenance',
        type: 'task',
        when: '2026-08-01T09:00:00.000Z',
        ends: '2026-08-01T10:00:00.000Z',
        location: 'Greenhouse 2',
        picture: 'https://example.org/pump.jpg'
      }
    });
  });

  it('falls back to the legacy `until` end field', () => {
    const card = cardFromQuest({
      ...quest,
      ends: undefined,
      until: '2026-08-01T11:00:00.000Z'
    });
    expect(card.kind === 'quest' && card.data.ends).toBe('2026-08-01T11:00:00.000Z');
  });
});

describe('cardFromLibraryItem', () => {
  it('keeps name/type/category/description/value and drops borrow state', () => {
    const card = cardFromLibraryItem(item);
    expect(card).toEqual({
      kind: 'thing',
      data: {
        name: 'Cordless drill',
        type: 'tool',
        category: 'Workshop',
        description: '18V, two batteries.',
        value: 5
      }
    });
  });

  it('omits the default Uncategorized category and zero value', () => {
    const card = cardFromLibraryItem({
      ...item,
      category: 'Uncategorized',
      value: 0
    });
    expect(card.kind === 'thing' && card.data.category).toBeUndefined();
    expect(card.kind === 'thing' && card.data.value).toBeUndefined();
  });
});

describe('encodeCardText / parseCardText', () => {
  it('round-trips a quest card', () => {
    const card = cardFromQuest(quest);
    const text = encodeCardText(card);
    expect(text).toContain('Fix the greenhouse pump');
    expect(text).toContain(CARD_MARKER);
    expect(parseCardText(text)).toEqual(card);
  });

  it('round-trips a thing card', () => {
    const card = cardFromLibraryItem(item);
    expect(parseCardText(encodeCardText(card))).toEqual(card);
  });

  it('finds the marker inside surrounding chat text', () => {
    const card = cardFromQuest(quest);
    const text = `Anna: check this out\n> ${encodeCardText(card)}\nsent from my phone`;
    expect(parseCardText(text)).toEqual(card);
  });

  it('accepts a bare JSON payload', () => {
    const card = cardFromLibraryItem(item);
    const bare = JSON.stringify({ holons: 'card/1', ...card });
    expect(parseCardText(bare)).toEqual(card);
  });

  it('returns null for ordinary text, foreign JSON and broken markers', () => {
    expect(parseCardText('')).toBeNull();
    expect(parseCardText('just some pasted prose')).toBeNull();
    expect(parseCardText('{"holons":"card/1"}')).toBeNull();
    expect(parseCardText('{"kind":"quest","data":{"title":"x"}}')).toBeNull();
    expect(parseCardText('holons-card: {"holons":"card/1","kind":"quest"')).toBeNull();
    expect(
      parseCardText('holons-card: {"holons":"card/1","kind":"quest","data":{"title":"  "}}')
    ).toBeNull();
  });
});

describe('questFromCard', () => {
  it('builds a fresh unclaimed quest for the target holon', () => {
    const card = cardFromQuest(quest);
    if (card.kind !== 'quest') throw new Error('expected quest card');
    const q = questFromCard(card, {
      holonId: '-100999',
      initiator: { id: 42, username: 'paster' },
      now: 1_700_000_000_000
    });
    expect(q.id).toBe('');
    expect(q.holon).toBe('-100999');
    expect(q.status).toBe('ongoing');
    expect(q.title).toBe(quest.title);
    expect(q.description).toBe(quest.description);
    expect(q.category).toBe('maintenance');
    expect(q.when).toBe(quest.when);
    expect(q.ends).toBe(quest.ends);
    expect(q.location).toBe(quest.location);
    expect(q.picture).toBe(quest.picture);
    expect(q.initiator).toEqual({ id: 42, username: 'paster' });
    expect(q.participants).toEqual([]);
    expect(q.appreciation).toEqual([]);
    expect(q.dependencies).toEqual([]);
    expect(q.created).toBe(new Date(1_700_000_000_000).toISOString());
  });
});

describe('libraryAddFromCard', () => {
  it('maps a thing card to addItem inputs, stamping the pasting user', () => {
    const card = cardFromLibraryItem(item);
    if (card.kind !== 'thing') throw new Error('expected thing card');
    const { itemId, options } = libraryAddFromCard(card, {
      createdBy: 42,
      createdByUsername: 'paster'
    });
    expect(itemId).toBe('Cordless drill');
    expect(options).toEqual({
      createdBy: 42,
      createdByUsername: 'paster',
      type: 'tool',
      category: 'Workshop',
      description: '18V, two batteries.',
      value: 5
    });
  });

  it('drops an unknown type so addItem falls back to name detection', () => {
    const { options } = libraryAddFromCard({
      kind: 'thing',
      data: { name: 'Mystery box', type: 'spaceship' }
    });
    expect(options.type).toBeUndefined();
  });
});
