// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { lunationAt } from '../flows/lunation.js';
import { EMPTY_ROOT, buildCheckpoint, epochOf, foldCheckpoints, merkleRoot, verifyCheckpoint } from './checkpoint.js';
import { bootstrapActors } from './membership.js';
import { shuffled, signedEntry, testKey } from './testing.js';

const admin = testKey();
const member = testKey();

describe('merkleRoot', () => {
  it('is order-free, duplicate-free, and sensitive to one id', () => {
    const ids = ['a1', 'b2', 'c3', 'd4', 'e5'];
    const root = merkleRoot(ids);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
    expect(merkleRoot(shuffled(ids))).toBe(root);
    expect(merkleRoot([...ids, 'a1'])).toBe(root);
    expect(merkleRoot(ids.slice(1))).not.toBe(root);
    expect(merkleRoot([])).toBe(EMPTY_ROOT);
    expect(merkleRoot(['a1'])).not.toBe(EMPTY_ROOT);
  });
});

describe('checkpoints', () => {
  const now = Math.floor(Date.now() / 1000);
  const epoch = epochOf(now);
  const entries = [1, 2, 3].map((n) => signedEntry({ sk: member.sk, item: { t: 'action', kind: 'x', n }, created_at: now - n }));
  const lastMonth = signedEntry({ sk: member.sk, item: { t: 'action', kind: 'x' }, created_at: now - 40 * 86400 });

  it('epochs are lunar cycles, the same ones the flows use', () => {
    expect(epoch).toBe(lunationAt(now * 1000).index);
    expect(epochOf(now - 40 * 86400)).toBeLessThan(epoch);
  });

  it('builds over the accepted entries of one epoch and verifies against a reader\'s fold', () => {
    const cp = buildCheckpoint({ lens: 'flow_claims', epoch, accepted: shuffled([...entries, lastMonth]) });
    expect(cp.item).toMatchObject({ t: 'checkpoint', lens: 'flow_claims', epoch, count: 3, head: entries[0].id });
    expect(verifyCheckpoint(cp.item, entries)).toMatchObject({ ok: true, derivedCount: 3 });
    expect(verifyCheckpoint(cp.item, entries.slice(1))).toMatchObject({ ok: false, derivedCount: 2 });
    expect(verifyCheckpoint(cp.item, [...entries, lastMonth]).ok).toBe(true);
    const empty = buildCheckpoint({ lens: 'x', epoch: epoch - 5, accepted: entries });
    expect(empty.item).toMatchObject({ count: 0, head: null, root: EMPTY_ROOT });
  });

  it('folds the latest checkpoint per lens and epoch from recognized signers only', () => {
    const actors = bootstrapActors({ members: [member.pk], admins: [admin.pk] });
    const cp1 = buildCheckpoint({ lens: 'l', epoch, accepted: entries.slice(0, 2) });
    const cp2 = buildCheckpoint({ lens: 'l', epoch, accepted: entries });
    const log = [
      signedEntry({ sk: admin.sk, item: cp1.item as unknown as Record<string, unknown>, created_at: now + 1 }),
      signedEntry({ sk: admin.sk, item: cp2.item as unknown as Record<string, unknown>, created_at: now + 2 }),
      signedEntry({ sk: member.sk, item: { ...cp2.item, root: 'ff' } as unknown as Record<string, unknown>, created_at: now + 3 }),
    ];
    const folded = foldCheckpoints(shuffled(log), actors);
    expect(folded.size).toBe(1);
    expect(folded.get(`l|${epoch}`)?.item.root).toBe(cp2.item.root);
    expect(foldCheckpoints(log, actors, { signers: ['member'] }).get(`l|${epoch}`)?.item.root).toBe('ff');
  });
});
