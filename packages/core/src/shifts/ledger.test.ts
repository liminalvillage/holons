// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
import { describe, expect, it, vi } from 'vitest';
import { recordShiftRsvp, shiftCommitmentId } from './ledger.js';

const occurrence = {
  dTag: 'shift--100-2026-09-10-mc',
  title: 'Morning cook',
  start: Date.UTC(2026, 8, 10, 7) / 1000,
  end: Date.UTC(2026, 8, 10, 10) / 1000,
};

function db() {
  const put = vi.fn(async () => undefined);
  const del = vi.fn(async () => undefined);
  return { put, delete: del };
}

describe('recordShiftRsvp', () => {
  it('records an accepted signup as a commitment of the shift hours', async () => {
    const store = db();
    const res = await recordShiftRsvp(store, '-100', { occurrence, member: { id: 7, username: 'ada' }, status: 'accepted', at: 1 });
    expect(res.ok).toBe(true);
    expect(store.put).toHaveBeenCalledTimes(1);
    const [holon, lens, event] = store.put.mock.calls[0] as unknown as [string, string, any];
    expect(holon).toBe('-100');
    expect(lens).toBe('rea_events');
    expect(event.id).toBe(shiftCommitmentId('-100', occurrence, 7));
    expect(event.eventType).toBe('shift:accepted');
    expect(event.vfType).toBe('Commitment');
    expect(event.action).toBe('work');
    expect(event.effortQuantity).toEqual({ hasNumericalValue: 3, hasUnit: 'hour' });
    expect(event.provider.id).toBe('7');
    expect(event.context.shiftId).toBe(occurrence.dTag);
  });

  it('retracts the commitment on a cancellation', async () => {
    const store = db();
    const res = await recordShiftRsvp(store, '-100', { occurrence, member: { id: 7 }, status: 'declined' });
    expect(res.ok).toBe(true);
    expect(store.put).not.toHaveBeenCalled();
    expect(store.delete).toHaveBeenCalledWith('-100', 'rea_events', shiftCommitmentId('-100', occurrence, 7));
  });

  it('never throws', async () => {
    const store = { put: vi.fn(async () => { throw new Error('relay down'); }), delete: vi.fn() };
    const res = await recordShiftRsvp(store, '-100', { occurrence, member: { id: 7 }, status: 'accepted' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('relay down');
  });
});
