// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { CARDS_TAG, addTagEntry, cardEntry, tagEntries } from './operations.js';
import { getTagEntries, tagCard } from './persistence.js';

describe('tags/operations', () => {
  it('addTagEntry creates a new tag object when none exists', () => {
    const t = addTagEntry(null, 'idea', {
      holonId: 'A',
      messageId: 1,
      messageContent: 'first',
    });
    expect(t.id).toBe('idea');
    expect(t.content).toHaveLength(1);
  });

  it('addTagEntry appends to an existing tag', () => {
    const first = addTagEntry(null, 'idea', { holonId: 'A', messageId: 1 });
    const second = addTagEntry(first, 'idea', { holonId: 'A', messageId: 2 });
    expect(second.content).toHaveLength(2);
    // original is not mutated
    expect(first.content).toHaveLength(1);
  });

  it('tagEntries tolerates null', () => {
    expect(tagEntries(null)).toEqual([]);
    expect(tagEntries({ id: 'x', content: [{ holonId: 'A', messageId: 1 }] })).toHaveLength(1);
  });

  it('cardEntry keeps the transcription and the picture', () => {
    expect(cardEntry({ holonId: -100, messageId: 7, text: '  Be kind\n', picture: 'AgACfile' })).toEqual({
      holonId: '-100',
      messageId: 7,
      messageContent: 'Be kind',
      picture: 'AgACfile',
    });
  });

  it('cardEntry drops an empty picture', () => {
    expect(cardEntry({ holonId: 'A', messageId: 1, text: 'x', picture: ' ' })).not.toHaveProperty('picture');
    expect(cardEntry({ holonId: 'A', messageId: 1, text: 'x', picture: null })).not.toHaveProperty('picture');
  });

  it('tagCard files cards under the cards keyword', async () => {
    const store = new Map<string, unknown>();
    const db = {
      get: async (h: string, l: string, k?: string | number) => store.get(`${h}/${l}/${k}`) ?? null,
      put: async (h: string, l: string, v: unknown) => store.set(`${h}/${l}/${(v as { id: string }).id}`, v),
    };
    await tagCard(db, 'A', { messageId: 1, text: 'first', picture: 'file1' });
    const tag = await tagCard(db, 'A', { messageId: 2, text: 'second' });
    expect(tag.id).toBe(CARDS_TAG);
    expect(await getTagEntries(db, 'A', 'cards')).toEqual([
      { holonId: 'A', messageId: 1, messageContent: 'first', picture: 'file1' },
      { holonId: 'A', messageId: 2, messageContent: 'second' },
    ]);
  });
});
