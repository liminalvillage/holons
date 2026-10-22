/**
 * Signing hygiene: the envelope must attest exactly what the raw store
 * persists, and only what may be public.
 *
 *  - The envelope signs the SANITIZED, stripped payload (`dataToStore`), never
 *    the caller's raw input — otherwise enforce-mode reads resurrect read-side
 *    fields (`_meta`, `_hologram`, `_federation`) that put() deliberately strips.
 *  - Private (password) writes are never signed: envelopes live in the public
 *    `_events` namespace, so signing an encrypted-space write would leak its
 *    plaintext. Private reads bypass the signing layer for the same reason.
 *  - deleteAll() issues signed tombstones like delete() does, so a bulk-cleared
 *    lens can't be resurrected from leftover envelopes by an enforce reader.
 *  - `includeDeleted: true` surfaces signed tombstones through the enforced view.
 */
import { jest } from '@jest/globals';
import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';

jest.setTimeout(30000); // SEA auth + tombstone clock waits exceed the 5s default under load

// A non-H3 holon name: an H3 hexagon id would fire background parent-hexagon
// propagation on every put, whose timers outlive afterAll and hang Jest.
const HOLON = 'hygiene-holon';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (a) => a.map((i) => i.id).sort();

describe('signing hygiene', () => {
  let sphere;

  const envelopesOf = (lens, id) => sphere.store.getEvents(HOLON, lens, id);

  beforeAll(async () => {
    sphere = new HoloSphere({ appName: 'hygiene-test', privateKey: generateSecretKey(),
      store: { adapter: 'memory' } });
    await sphere.enableSigning({ relays: [], enforce: true });
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch { /* no signer */ }
    try { await sphere?.close?.(); } catch { /* already closed */ }
  }, 15000);

  test('the envelope attests the stored payload — stripped fields do not resurrect', async () => {
    await sphere.put(HOLON, 'tasks', {
      id: 'clean1', title: 'Weed the beds',
      _meta: { resolvedFromHologram: true, hologramSoul: 'app/h/l/k' },
    });
    await wait(300);
    const resolved = await sphere.get(HOLON, 'tasks', 'clean1'); // enforce: from the envelope
    expect(resolved?.title).toBe('Weed the beds');
    expect(resolved?._meta).toBeUndefined();
  });

  test('private (password) writes are never signed and never leak plaintext', async () => {
    const password = 'hygiene-secret-1234';
    await sphere.put(HOLON, 'secrets', { id: 's1', value: 'the plaintext' }, password);
    await wait(300);
    // no signed claim in the events table
    expect(envelopesOf('secrets', 's1')).toEqual([]);
    // enforce-mode public read must not serve the private item
    expect(await sphere.get(HOLON, 'secrets', 's1')).toBeNull();
    // a wrong password must not fall through to any envelope either
    expect(await sphere.get(HOLON, 'secrets', 's1', 'wrong-password')).toBeNull();
  });

  test('deleteAll issues signed tombstones — the lens cannot be resurrected', async () => {
    for (const id of ['b1', 'b2', 'b3']) {
      await sphere.put(HOLON, 'bulk', { id, value: `item ${id}` });
    }
    await wait(300);
    expect(ids(await sphere.getAll(HOLON, 'bulk'))).toEqual(['b1', 'b2', 'b3']);

    await wait(1100);                       // ensure tombstones are newer (1s clock)
    await sphere.deleteAll(HOLON, 'bulk');
    await wait(500);

    expect(ids(await sphere.getAll(HOLON, 'bulk'))).toEqual([]);
    expect(await sphere.get(HOLON, 'bulk', 'b1')).toBeNull();
  });

  test('includeDeleted surfaces signed tombstones through the enforced view', async () => {
    await sphere.put(HOLON, 'graves', { id: 'g1', value: 'alive' });
    await wait(1100);
    await sphere.delete(HOLON, 'graves', 'g1');
    await wait(500);

    expect(await sphere.get(HOLON, 'graves', 'g1')).toBeNull();
    const withDeleted = await sphere.getAll(HOLON, 'graves', null, { includeDeleted: true });
    const grave = withDeleted.find((i) => i.id === 'g1');
    expect(grave?._deleted).toBe(true);
    expect((await sphere.get(HOLON, 'graves', 'g1', null, { includeDeleted: true }))?._deleted).toBe(true);
  });
});
