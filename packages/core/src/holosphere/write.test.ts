// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import { writeWithIdentity, createHolonWriter } from './write.js';

/** A HoloSphere stand-in that just records what `put` was called with. */
function fakeSphere(impl?: () => Promise<unknown>) {
  const calls: Array<{ holon: string; lens: string; data: any; options: any }> = [];
  const sphere = {
    put: vi.fn(async (holon: string, lens: string, data: any, options: any) => {
      calls.push({ holon, lens, data, options });
      return impl ? impl() : undefined;
    }),
  } as any;
  return { sphere, calls };
}

describe('writeWithIdentity', () => {
  it('attaches the acting identity and reports success', async () => {
    const { sphere, calls } = fakeSphere();

    const ok = await writeWithIdentity(sphere, 'h1', 'quests', { id: 'q1' }, { actingAs: '42' });

    expect(ok).toBe(true);
    expect(calls[0].options.actingAs).toBe('42');
    // Redirection is HoloSphere's default — we must not silently disable it.
    expect(calls[0].options.disableHologramRedirection).toBeUndefined();
  });

  it('passes disableHologramRedirection through when the write targets a pointer', async () => {
    const { sphere, calls } = fakeSphere();

    await writeWithIdentity(
      sphere,
      'h1',
      'quests',
      { id: 'q1', _deleted: true },
      { actingAs: '42', disableHologramRedirection: true }
    );

    expect(calls[0].options.disableHologramRedirection).toBe(true);
  });

  it('turns a denied write into false and notifies', async () => {
    const { sphere } = fakeSphere(async () => {
      throw new Error('Write access denied for this holon');
    });
    const onDenied = vi.fn();

    const ok = await writeWithIdentity(sphere, 'h1', 'quests', { id: 'q1' }, { onDenied });

    expect(ok).toBe(false);
    expect(onDenied).toHaveBeenCalledTimes(1);
  });

  it('re-throws errors that are not authorization failures', async () => {
    const { sphere } = fakeSphere(async () => {
      throw new Error('relay unreachable');
    });

    await expect(writeWithIdentity(sphere, 'h1', 'quests', { id: 'q1' })).rejects.toThrow(
      'relay unreachable'
    );
  });
});

describe('createHolonWriter', () => {
  it('forwards per-call options to the underlying write', async () => {
    const { sphere, calls } = fakeSphere();
    const writer = createHolonWriter(sphere, 'h1', { actingAs: () => '42' });

    await writer.put('quests', { id: 'q1' });
    await writer.put('quests', { id: 'q2' }, { disableHologramRedirection: true });

    expect(calls[0].options.disableHologramRedirection).toBeUndefined();
    expect(calls[1].options.disableHologramRedirection).toBe(true);
    expect(calls[1].options.actingAs).toBe('42');
  });
});
