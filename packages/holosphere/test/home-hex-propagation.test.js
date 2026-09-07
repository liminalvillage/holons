// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The home hex as a federation partner.
 *
 * A holon federates its home H3 cell like any other partner, but with a
 * `hops` reach on the lens config. Ordinary writes to a lens configured
 * outbound to that cell then place a hologram on the cell AND on `hops`
 * coarser ancestors, with no explicit publish — that is what makes an item
 * visible on the map at more than one zoom level. Deletes retract all of it.
 *
 * The invariants worth defending here are the negative ones: a holon with only
 * ordinary partners must gain no fan-out from this (auto-propagation stays
 * opt-in for peers), and a sweep at a shared cell must only take out copies
 * this holon put there.
 */
import { parentHexagonsFor } from '../federation.js';
import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

const APP = 'home-hex-test';
const CELL = '89283082803ffff';           // res-9 cell — the "home hex"
const LENS = 'quests';
const HOPS = 5;
const REACHED = parentHexagonsFor(CELL, HOPS).parents;   // res-8 … res-4
const BEYOND = parentHexagonsFor(CELL).parents.slice(HOPS); // res-3 … res-0

describe('home hex as a federation partner', () => {
  let sphere;

  beforeAll(async () => {
    sphere = await testSphere(APP);
  });

  afterAll(async () => {
    await cleanupTestEnv();
  });

  /** The record AS STORED — never following a pointer to its source. */
  async function storedAt(holon, id) {
    const rec = await sphere.get(holon, LENS, String(id), null, {
      resolveHolograms: false,
      _skipAuthorize: true,
    });
    return rec && !rec._deleted ? rec : null;
  }

  /** Link `holon`'s home hex with the given reach and outbound lenses. */
  async function linkHomeHex(holon, { outbound = [LENS], inbound = [], hops = HOPS } = {}) {
    await sphere.federateHolon(holon, CELL, {
      lensConfig: { inbound, outbound, hops },
    });
  }

  test('the reach is exactly the hops asked for', () => {
    expect(REACHED.length).toBe(HOPS);
    expect(BEYOND.length).toBeGreaterThan(0);
  });

  test('hops persists on the partner config, and mirrors', async () => {
    const holon = 'hops-config-holon';
    await linkHomeHex(holon, { hops: 4 });

    const mine = await sphere.getFederation(holon);
    expect(mine.lensConfig[CELL].hops).toBe(4);
    expect(mine.lensConfig[CELL].outbound).toEqual([LENS]);

    // Reach describes the relationship, so the cell's mirrored record agrees
    // about it even though the lens directions are inverted.
    const theirs = await sphere.getFederation(CELL);
    expect(theirs.lensConfig[holon].hops).toBe(4);
    expect(theirs.lensConfig[holon].inbound).toEqual([LENS]);
  }, 30000);

  test('an ordinary put places a hologram at the cell and every reached ancestor', async () => {
    const holon = 'placing-holon';
    await linkHomeHex(holon);

    await sphere.put(holon, LENS, { id: 'q-place', title: 'Repair the well' });
    await new Promise((r) => setTimeout(r, 2500)); // the mirror is background

    // The canonical record stays where it was written.
    const source = await storedAt(holon, 'q-place');
    expect(source.title).toBe('Repair the well');

    // The cell holds a pointer home, stamped as ours.
    const atCell = await storedAt(CELL, 'q-place');
    expect(atCell).toBeTruthy();
    expect(atCell.soul).toContain(`/${holon}/${LENS}/q-place`);
    expect(atCell._federation.origin).toBe(holon);

    // Every ancestor within reach holds a pointer to the SAME original — not a
    // chain of pointers to the cell — stamped as the cell's, which is what lets
    // a retraction prove ownership at each level.
    for (const parent of REACHED) {
      const rec = await storedAt(parent, 'q-place');
      expect(rec).toBeTruthy();
      expect(rec.soul).toContain(`/${holon}/${LENS}/q-place`);
      expect(rec._federation.origin).toBe(CELL);
    }

    // …and it stops there.
    for (const parent of BEYOND) {
      expect(await storedAt(parent, 'q-place')).toBeNull();
    }

    // A pointer is only useful if it reads back as the item.
    const resolved = await sphere.get(REACHED[0], LENS, 'q-place');
    expect(resolved.title).toBe('Repair the well');
  }, 60000);

  test('deleting the record retracts the cell copy and every ancestor', async () => {
    const holon = 'retracting-holon';
    await linkHomeHex(holon);

    await sphere.put(holon, LENS, { id: 'q-gone', title: 'Temporary' });
    await new Promise((r) => setTimeout(r, 2500));
    expect(await storedAt(CELL, 'q-gone')).toBeTruthy();

    await sphere.delete(holon, LENS, 'q-gone', null, { awaitPropagation: true });

    expect(await storedAt(holon, 'q-gone')).toBeNull();
    expect(await storedAt(CELL, 'q-gone')).toBeNull();
    for (const parent of REACHED) {
      expect(await storedAt(parent, 'q-gone')).toBeNull();
    }
  }, 60000);

  test('hops 0 keeps the item at the exact cell', async () => {
    const holon = 'flat-holon';
    await linkHomeHex(holon, { hops: 0 });

    await sphere.put(holon, LENS, { id: 'q-flat', title: 'Doorstep only' });
    await new Promise((r) => setTimeout(r, 2500));

    // hops 0 means "no reach", so there is no automatic placement at all —
    // the caretaker gets the manual publish button, not a silent flat write.
    expect(await storedAt(CELL, 'q-flat')).toBeNull();
    for (const parent of REACHED) {
      expect(await storedAt(parent, 'q-flat')).toBeNull();
    }
  }, 60000);

  test('a lens that is not configured outbound is not mirrored', async () => {
    const holon = 'selective-holon';
    await linkHomeHex(holon, { outbound: ['offers'] });

    await sphere.put(holon, LENS, { id: 'q-private', title: 'Stays home' });
    await new Promise((r) => setTimeout(r, 2500));

    expect(await storedAt(holon, 'q-private')).toBeTruthy();
    expect(await storedAt(CELL, 'q-private')).toBeNull();
  }, 60000);

  test('a holon with no hex link gains no fan-out', async () => {
    const holon = 'unlinked-holon';

    await sphere.put(holon, LENS, { id: 'q-alone', title: 'Nowhere' });
    await new Promise((r) => setTimeout(r, 2000));

    expect(await storedAt(holon, 'q-alone')).toBeTruthy();
    expect(await storedAt(CELL, 'q-alone')).toBeNull();
  }, 60000);

  test('an ordinary partner is still never written to without an explicit publish', async () => {
    const holon = 'peer-source';
    const peer = 'peer-target';
    // A normal, non-cell partner receiving the same lens.
    await sphere.federateHolon(holon, peer, {
      lensConfig: { inbound: [], outbound: [LENS] },
    });
    // …plus a home hex, so the mirror definitely runs on this write.
    await linkHomeHex(holon);

    await sphere.put(holon, LENS, { id: 'q-scope', title: 'Map only' });
    await new Promise((r) => setTimeout(r, 2500));

    // The map got it; the peer did not. Auto-propagation stays opt-in for peers.
    expect(await storedAt(CELL, 'q-scope')).toBeTruthy();
    expect(await storedAt(peer, 'q-scope')).toBeNull();
  }, 60000);

  test('a sweep at a shared cell only retracts this holon’s copies', async () => {
    const mine = 'sharer-a';
    const theirs = 'sharer-b';
    await linkHomeHex(mine);
    await linkHomeHex(theirs);

    await sphere.put(mine, LENS, { id: 'q-mine', title: 'Mine' });
    await sphere.put(theirs, LENS, { id: 'q-theirs', title: 'Theirs' });
    await new Promise((r) => setTimeout(r, 3000));
    expect(await storedAt(CELL, 'q-mine')).toBeTruthy();
    expect(await storedAt(CELL, 'q-theirs')).toBeTruthy();

    await sphere.deleteAll(mine, LENS, null, { awaitPropagation: true });

    expect(await storedAt(CELL, 'q-mine')).toBeNull();
    expect(await storedAt(CELL, 'q-theirs')).toBeTruthy();
    expect(await storedAt(REACHED[0], 'q-theirs')).toBeTruthy();
  }, 60000);

  test('a hologram write does not re-mirror (no runaway cascade)', async () => {
    const holon = 'cascade-holon';
    await linkHomeHex(holon);

    await sphere.put(holon, LENS, { id: 'q-cascade', title: 'Once' });
    await new Promise((r) => setTimeout(r, 2500));

    // The cell mirrors us back as an inbound partner. If the cell's write
    // re-entered the federation fan-out, the item would bounce home as a
    // self-pointing hologram and destroy the original.
    const source = await storedAt(holon, 'q-cascade');
    expect(source.title).toBe('Once');
    expect(source.soul).toBeUndefined();
  }, 60000);
});
