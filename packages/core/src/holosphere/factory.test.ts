// The factory is where a UI asks for a lens carried on a standard Nostr kind,
// so no UI has to know the store's wire registry exists.
import { describe, expect, it } from 'vitest';
import { createHoloSphere } from './factory.js';

const APP = 'factory-test';

describe('createHoloSphere: standard wires', () => {
  it('consumes the envelope plus the protocol logs by default', () => {
    const hs = createHoloSphere({ appName: APP, store: { adapter: 'memory' } });
    expect(hs.store.wire.kinds()).toEqual([30078, 1808]);
    expect(hs.store.wire.isStandardPrimary('shifts')).toBe(false);
    expect(hs.isAppendLens('_policy')).toBe(true);
    expect(hs.isAppendLens('_checkpoints')).toBe(true);
    expect(hs.isAppendLens('tasks')).toBe(false);
  });

  it('adds a domain log, or carries none at all', () => {
    const withClaims = createHoloSphere({ appName: APP, store: { adapter: 'memory' }, appendLenses: ['flow_claims'] });
    expect(withClaims.isAppendLens('flow_claims')).toBe(true);
    expect(withClaims.isAppendLens('_policy')).toBe(true);
    const none = createHoloSphere({ appName: APP, store: { adapter: 'memory' }, appendLenses: false });
    expect(none.store.wire.kinds()).toEqual([30078]);
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
