import { describe, expect, it, vi } from 'vitest';
import { reflectJoin, reflectLeave } from './join-reflect.js';
import type { HoloSphere } from 'holosphere';

function mockHolosphere({ stored = undefined as any } = {}) {
  const put = vi.fn(async () => {});
  const del = vi.fn(async () => {});
  // Mirror holosphere.createHologram: bare data → { id, soul }.
  const createHologram = vi.fn(async (holon: string, lens: string, item: any) => ({
    id: item.id,
    soul: `test-app/${holon}/${lens}/${item.id}`,
  }));
  // What reflectLeave's raw read finds in the personal holon. Default: the
  // mirror reflectJoin would have written for quest q1 in -100200.
  const record =
    stored === undefined ? { id: 'q1', soul: 'test-app/-100200/quests/q1' } : stored;
  const get = vi.fn(async () => record);
  const holosphere = {
    put,
    get,
    delete: del,
    createHologram,
    appname: 'test-app',
    isValidH3: () => false,
    isHologram: (d: any) =>
      Boolean(d && typeof d.soul === 'string' && !('title' in d)),
    parseSoulPath: (soul: string) => {
      const [appname, holon, lens, ...key] = String(soul).split('/');
      return key.length ? { appname, holon, lens, key: key.join('/') } : null;
    },
  } as unknown as HoloSphere;
  return { holosphere, put, del, get, createHologram };
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
    const { holosphere, del, get } = mockHolosphere();

    const result = await reflectLeave({
      holosphere,
      homeHolonId: '-100200',
      quest,
      user: { id: 235114395, firstName: 'Roberto' } as any,
    });

    expect(result).toEqual({ reflected: true, callerHolonId: '235114395' });
    expect(get).toHaveBeenCalledWith('235114395', 'quests', 'q1', null, {
      resolveHolograms: false,
    });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('235114395', 'quests', 'q1');
  });

  it('never deletes a REAL quest that shares the id (message-id collision)', async () => {
    const { holosphere, del } = mockHolosphere({
      stored: { id: 'q1', title: 'My own unrelated task', participants: [] },
    });

    const result = await reflectLeave({
      holosphere,
      homeHolonId: '-100200',
      quest,
      user: { id: 235114395 } as any,
    });

    expect(result).toEqual({ reflected: false, callerHolonId: '235114395', reason: 'not-a-mirror' });
    expect(del).not.toHaveBeenCalled();
  });

  it('never deletes a mirror that points at a DIFFERENT chat’s quest', async () => {
    const { holosphere, del } = mockHolosphere({
      stored: { id: 'q1', soul: 'test-app/-999999/quests/q1' },
    });

    const result = await reflectLeave({
      holosphere,
      homeHolonId: '-100200',
      quest,
      user: { id: 235114395 } as any,
    });

    expect(result).toEqual({ reflected: false, callerHolonId: '235114395', reason: 'not-a-mirror' });
    expect(del).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is stored under the id', async () => {
    const { holosphere, del } = mockHolosphere({ stored: null });

    const result = await reflectLeave({
      holosphere,
      homeHolonId: '-100200',
      quest,
      user: { id: 235114395 } as any,
    });

    expect(result).toEqual({ reflected: false, callerHolonId: '235114395', reason: 'no-mirror' });
    expect(del).not.toHaveBeenCalled();
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
