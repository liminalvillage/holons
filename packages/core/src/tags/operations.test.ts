// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { addTagEntry, tagEntries } from './operations.js';

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
});
