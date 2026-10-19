// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  addRecipient,
  draftChanges,
  draftFromInputs,
  draftToSave,
  previewDraft,
  removeRecipient,
  setKeep,
  setRing,
  setRingCount,
  setSteepness,
  setResourced,
} from './split-draft.js';

const base = () =>
  draftFromInputs({
    config: { interiorPercent: 20, steepness: 50, nzones: 3 },
    zones: { projA: 1, projB: 2, ghost: 1 },
    people: { '77': 2 },
    federated: ['projA', 'projB', 'projC'],
    persons: ['88'],
    names: { projA: 'Alder', projB: 'Birch', projC: 'Cedar', '77': 'Ada', '88': 'Bo' },
  });

describe('draftFromInputs', () => {
  it('lists who is placed, ring by ring, and who could be', () => {
    const d = base();
    expect(d.recipients.map((r) => [r.name, r.kind, r.ring, r.federated])).toEqual([
      ['Alder', 'holon', 1, true],
      ['ghost', 'holon', 1, false],
      ['Ada', 'person', 2, true],
      ['Birch', 'holon', 2, true],
    ]);
    expect(d.candidates.map((r) => [r.name, r.kind])).toEqual([['Bo', 'person'], ['Cedar', 'holon']]);
    expect(d).toMatchObject({ keep: 20, steepness: 50, nzones: 3, locked: false });
  });

  it('pulls a ring past the last one in, and reads a lock', () => {
    const d = draftFromInputs({ config: { nzones: 2 }, zones: { a: 9 }, federated: ['a'], genesis: { hash: 'h', at: 1 } });
    expect(d.recipients[0].ring).toBe(2);
    expect(d.locked).toBe(true);
  });

  it('a person who is also a federation partner keeps the partner seat', () => {
    const d = draftFromInputs({ config: { nzones: 2 }, people: { p: 1 }, federated: ['p'] });
    expect(d.recipients).toEqual([{ id: 'p', name: 'p', kind: 'holon', ring: 1, federated: true }]);
  });
});

describe('editing', () => {
  it('moves, removes and places', () => {
    let d = setRing(base(), 'projA', 3);
    expect(d.recipients.find((r) => r.id === 'projA')!.ring).toBe(3);
    d = removeRecipient(d, 'projB');
    expect(d.recipients.some((r) => r.id === 'projB')).toBe(false);
    expect(d.candidates.some((r) => r.id === 'projB')).toBe(true);
    d = setRing(d, 'projC', 1);
    expect(d.recipients.find((r) => r.id === 'projC')!.ring).toBe(1);
    expect(d.candidates.some((r) => r.id === 'projC')).toBe(false);
    expect(setRing(d, 'nobody', 1)).toBe(d);
  });

  it('an unlinked holon taken off its ring is gone: it could never be placed again', () => {
    const d = removeRecipient(base(), 'ghost');
    expect([...d.recipients, ...d.candidates].some((r) => r.id === 'ghost')).toBe(false);
  });

  it('adds a party it did not know on the outermost ring', () => {
    const d = addRecipient(base(), { id: 'new', name: 'Newcomer' });
    expect(d.recipients.find((r) => r.id === 'new')).toEqual({ id: 'new', name: 'Newcomer', kind: 'holon', ring: 3, federated: true });
    expect(addRecipient(d, { id: 'new' }, 1).recipients.filter((r) => r.id === 'new')).toHaveLength(1);
    expect(addRecipient(d, { id: ' ' })).toBe(d);
  });

  it('fewer rings pull the outer seats in; the count stays between 1 and 10', () => {
    const d = setRingCount(setRing(base(), 'projA', 3), 1);
    expect(d.nzones).toBe(1);
    expect(d.recipients.every((r) => r.ring === 1)).toBe(true);
    expect(setRingCount(base(), 99).nzones).toBe(10);
    expect(setRingCount(base(), 0).nzones).toBe(1);
  });

  it('a locked draft keeps its keep, and still moves its rings', () => {
    const locked = { ...base(), locked: true };
    expect(setKeep(locked, 80)).toBe(locked);
    expect(setKeep(base(), 180).keep).toBe(100);
    expect(setSteepness(locked, 10).steepness).toBe(10);
  });
});

describe('previewDraft', () => {
  it('pays what allocate pays: keep plus the rings is everything', () => {
    const p = previewDraft(base());
    expect(p.keep).toBe(20);
    expect(p.passed).toBeCloseTo(80, 6);
    expect(p.unplaced).toBeCloseTo(0, 6);
    expect(p.rows.reduce((s, r) => s + r.percentage, 0)).toBeCloseTo(80, 6);
    expect(p.rings.map((r) => [r.ring, r.count])).toEqual([[1, 2], [2, 2], [3, 0]]);
    // Ring 1 outweighs ring 2 at this slope, and seats on one ring are equal.
    const of = (id: string) => p.rows.find((r) => r.id === id)!.percentage;
    expect(of('projA')).toBeCloseTo(of('ghost'), 6);
    expect(of('projA')).toBeGreaterThan(of('projB'));
  });

  it('with nobody placed, the rest has nowhere to go', () => {
    const p = previewDraft(draftFromInputs({ config: { interiorPercent: 30, nzones: 2 }, federated: ['a'] }));
    expect(p).toMatchObject({ keep: 30, passed: 0, unplaced: 70, rows: [] });
  });
});

describe('draftChanges and draftToSave', () => {
  it('reads back every change', () => {
    const before = base();
    let after = setKeep(before, 35);
    after = setRing(after, 'projA', 2);
    after = removeRecipient(after, 'projB');
    after = setRing(after, 'projC', 1);
    after = setSteepness(after, 70);
    expect(draftChanges(before, after)).toEqual([
      { kind: 'keep', from: 20, to: 35 },
      { kind: 'steepness', from: 50, to: 70 },
      { kind: 'added', id: 'projC', name: 'Cedar', ring: 1 },
      { kind: 'moved', id: 'projA', name: 'Alder', from: 1, to: 2 },
      { kind: 'removed', id: 'projB', name: 'Birch', ring: 2 },
    ]);
    expect(draftChanges(before, before)).toEqual([]);
  });

  it('saves holons and people in their own maps', () => {
    expect(draftToSave(base())).toEqual({
      config: { interiorPercent: 20, steepness: 50, nzones: 3, resourced: 0 },
      zones: { projA: 1, ghost: 1, projB: 2 },
      people: { '77': 2 },
    });
  });

  it('a locked draft leaves the keep out of the save', () => {
    expect(draftToSave({ ...base(), locked: true }).config).toEqual({ steepness: 50, nzones: 3, resourced: 0 });
  });
});

describe('setResourced', () => {
  it('turns the resource rule on in the preview, the changes and the save', () => {
    const before = draftFromInputs({
      config: { interiorPercent: 0, steepness: 50, nzones: 1 },
      zones: { a: 1, b: 1 },
      federated: ['a', 'b'],
      resources: { a: 3, b: 1 },
    });
    expect(before.resourced).toBe(0);
    expect(previewDraft(before).rows.map((r) => [r.id, r.percentage])).toEqual([
      ['a', 50],
      ['b', 50],
    ]);
    const after = setResourced(before, 100.4);
    expect(after.resourced).toBe(100);
    expect(previewDraft(after).rows.map((r) => [r.id, r.percentage])).toEqual([
      ['a', 75],
      ['b', 25],
    ]);
    expect(draftChanges(before, after)).toEqual([{ kind: 'resourced', from: 0, to: 100 }]);
    expect(draftToSave(after).config.resourced).toBe(100);
  });
});
