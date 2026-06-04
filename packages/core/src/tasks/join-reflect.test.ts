import { describe, expect, it, vi } from 'vitest';
import { reflectJoin, reflectLeave } from './join-reflect.js';
import type { HoloSphere } from 'holosphere';

function mockHolosphere() {
  const put = vi.fn(async () => {});
  const del = vi.fn(async () => {});
  // Mirror holosphere.createHologram: bare data → { id, soul }.
  const createHologram = vi.fn(async (holon: string, lens: string, item: any) => ({
    id: item.id,
    soul: `test-app/${holon}/${lens}/${item.id}`,
  }));
  const holosphere = {
    put,
    delete: del,
    createHologram,
    appname: 'test-app',
    isValidH3: () => false,
  } as unknown as HoloSphere;
  return { holosphere, put, del, createHologram };
}

const quest = { id: 'q1', title: 'Sweep the plaza' };

describe('reflectJoin', () => {
  it('writes a hologram into the joining member’s personal holon', async () => {
    const { holosphere, put } = mockHolosphere();

    const result = await reflectJoin({
      holosphere,
      homeHolonId: '-100200', // a group holon
      quest,
      user: { id: 235114395, firstName: 'Roberto' } as any,
    });

    expect(result).toEqual({ reflected: true, callerHolonId: '235114395' });
    expect(put).toHaveBeenCalledTimes(1);
    const [target, lens, hologram] = put.mock.calls[0];
    expect(target).toBe('235114395');
    expect(lens).toBe('quests');
    // Bare stored hologram form — a pointer back to the source holon.
    expect(hologram).toEqual({ id: 'q1', soul: 'test-app/-100200/quests/q1' });
  });

  it('skips when the quest already lives in the member’s personal holon', async () => {
    const { holosphere, put } = mockHolosphere();

    const result = await reflectJoin({
      holosphere,
      homeHolonId: '235114395',
      quest,
      user: { id: '235114395', firstName: 'Roberto' } as any,
    });

    expect(result).toEqual({ reflected: false, callerHolonId: '235114395', reason: 'same-as-home' });
    expect(put).not.toHaveBeenCalled();
  });

  it('skips when the member has no id', async () => {
    const { holosphere, put } = mockHolosphere();

    const result = await reflectJoin({
      holosphere,
      homeHolonId: '-100200',
      quest,
      user: { firstName: 'Anon' } as any,
    });

    expect(result).toEqual({ reflected: false, callerHolonId: null, reason: 'no-user-id' });
    expect(put).not.toHaveBeenCalled();
  });

  it('skips when the quest has no id', async () => {
    const { holosphere, put } = mockHolosphere();

    const result = await reflectJoin({
      holosphere,
      homeHolonId: '-100200',
      quest: { id: '' } as any,
      user: { id: 235114395 } as any,
    });

    expect(result).toEqual({ reflected: false, callerHolonId: '235114395', reason: 'no-quest-id' });
    expect(put).not.toHaveBeenCalled();
  });
});

describe('reflectLeave', () => {
  it('deletes the hologram from the leaving member’s personal holon', async () => {
    const { holosphere, del } = mockHolosphere();

    const result = await reflectLeave({
      holosphere,
      homeHolonId: '-100200',
      quest,
      user: { id: 235114395, firstName: 'Roberto' } as any,
    });

    expect(result).toEqual({ reflected: true, callerHolonId: '235114395' });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('235114395', 'quests', 'q1');
  });

  it('skips when the quest lives in the member’s personal holon', async () => {
    const { holosphere, del } = mockHolosphere();

    const result = await reflectLeave({
      holosphere,
      homeHolonId: '235114395',
      quest,
      user: { id: '235114395' } as any,
    });

    expect(result).toEqual({ reflected: false, callerHolonId: '235114395', reason: 'same-as-home' });
    expect(del).not.toHaveBeenCalled();
  });

  it('skips when the member has no id', async () => {
    const { holosphere, del } = mockHolosphere();

    const result = await reflectLeave({
      holosphere,
      homeHolonId: '-100200',
      quest,
      user: {} as any,
    });

    expect(result).toEqual({ reflected: false, callerHolonId: null, reason: 'no-user-id' });
    expect(del).not.toHaveBeenCalled();
  });
});
