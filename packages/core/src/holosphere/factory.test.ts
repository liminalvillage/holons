// The factory is where a UI asks for a lens carried on a standard Nostr kind,
// so no UI has to know the store's wire registry exists.
import { describe, expect, it } from 'vitest';
import { createHoloSphere } from './factory.js';

const APP = 'factory-test';

describe('createHoloSphere: standard wires', () => {
  it('consumes the envelope alone by default', () => {
    const hs = createHoloSphere({ appName: APP, store: { adapter: 'memory' } });
    expect(hs.store.wire.kinds()).toEqual([30078]);
    expect(hs.store.wire.isStandardPrimary('shifts')).toBe(false);
  });

  it('carries shifts on its own kinds when asked', () => {
    const hs = createHoloSphere({
      appName: APP,
      store: { adapter: 'memory' },
      standardWires: { shifts: { coordinatorPubkey: 'ab'.repeat(32) } },
    });
    expect(hs.store.wire.isStandardPrimary('shifts')).toBe(true);
    expect(hs.store.wire.kinds()).toEqual(expect.arrayContaining([30078, 31923, 31925]));
    // Kind 5 becomes consumable only once some lens owns a standard kind.
    expect(hs.store.wire.accepts(5)).toBe(true);
  });

  it('keeps the caller\'s other store options', () => {
    const hs = createHoloSphere({
      appName: APP,
      store: { adapter: 'memory', compactAfter: 7 },
      standardWires: { shifts: {} },
    });
    expect(hs.store.compactAfter).toBe(7);
  });

  it('narrows occurrences to the coordinator it was given', () => {
    const hs = createHoloSphere({
      appName: APP,
      store: { adapter: 'memory' },
      standardWires: { shifts: { coordinatorPubkey: 'ab'.repeat(32) } },
    });
    const [occurrences] = hs.store.wire.wiresFor('shifts')[0].filters('-100');
    expect(occurrences).toMatchObject({ kinds: [31923], authors: ['ab'.repeat(32)] });
  });
});
