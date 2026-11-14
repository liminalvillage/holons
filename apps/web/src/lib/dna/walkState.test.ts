// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { loadWalk, saveWalk, walkKey, type WalkStorage } from './walkState';

const H = 'a'.repeat(64);

function memory(): WalkStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: WalkStorage = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};

describe('walk state on a device', () => {
  it('keeps one walk per holon under dna-walk:<holon>', () => {
    const s = memory();
    saveWalk('-100', { acks: { values: H } }, s);
    expect(s.data.get('dna-walk:-100')).toBe(JSON.stringify({ acks: { values: H } }));
    expect(loadWalk('-100', s)).toEqual({ acks: { values: H } });
    expect(loadWalk('-200', s)).toEqual({ acks: {} });
    expect(walkKey('-100')).toBe('dna-walk:-100');
  });

  it('forgets the key once nothing is acknowledged', () => {
    const s = memory();
    saveWalk('x', { acks: { values: H } }, s);
    saveWalk('x', { acks: {} }, s);
    expect(s.data.size).toBe(0);
  });

  it('starts over on rubbish and never throws on blocked storage', () => {
    const s = memory();
    s.setItem('dna-walk:x', '{not json');
    expect(loadWalk('x', s)).toEqual({ acks: {} });
    s.setItem('dna-walk:x', JSON.stringify({ acks: { values: 'short', ok: H } }));
    expect(loadWalk('x', s)).toEqual({ acks: { ok: H } });
    expect(loadWalk('x', throwing)).toEqual({ acks: {} });
    expect(() => saveWalk('x', { acks: { values: H } }, throwing)).not.toThrow();
    expect(loadWalk('x', null)).toEqual({ acks: {} });
    expect(() => saveWalk('x', { acks: { values: H } }, null)).not.toThrow();
  });
});
