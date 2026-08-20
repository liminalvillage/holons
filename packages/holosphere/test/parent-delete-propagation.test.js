/**
 * Deleting an H3 record retracts the copies its put fanned up the ancestry.
 *
 * A put on an H3-cell holon propagates full copies to every parent hexagon
 * (res-1 … res-0). Historically `delete` removed only the original, so the
 * record stayed readable at every coarser scale forever. These tests pin the
 * mirror behaviour — and, just as importantly, the ownership guard: a delete
 * must never take out a record at a parent that some OTHER holon put there.
 */
import HoloSphere from '../holosphere.js';
import { parentHexagonsFor } from '../federation.js';
import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

const APP = 'parent-delete-test';
const CHILD = '89283082803ffff';          // res-9 cell
const LENS = 'quests';
const PARENTS = parentHexagonsFor(CHILD).parents;

describe('parent-hexagon deletion propagation', () => {
  let sphere;

  // One sphere for the whole file: every test uses its own record ids, and a
  // fresh Gun instance per test would multiply radisk handles for no isolation
  // gain (cross-holon behaviour lives inside ONE graph — see testenv.js).
  beforeAll(async () => {
    sphere = await testSphere(APP);
  });

  afterAll(async () => {
    await cleanupTestEnv();
  });

  /** Ids visible at a parent hexagon's lens (undeleted only). */
  async function idsAt(holon) {
    const items = await sphere.getAll(holon, LENS, null, { resolveHolograms: false, _skipAuthorize: true });
    return (items || []).filter((i) => i && !i._deleted).map((i) => String(i.id)).sort();
  }

  /**
   * The record AS STORED at `holon`, without following a hologram pointer to
   * its source. `idsAt` is not usable for hologram assertions: it reads through
   * `getAll`, and a pointer whose source is already deleted resolves to nothing
   * and drops out of the result — so a copy left stranded at a parent looks
   * identical to one that was properly retracted.
   */
  async function storedAt(holon, id) {
    const rec = await sphere.get(holon, LENS, String(id), null, { resolveHolograms: false, _skipAuthorize: true });
    return rec && !rec._deleted ? rec : null;
  }

  test('the ancestry walk is the same one propagate uses', () => {
    expect(PARENTS.length).toBe(9);            // res-8 … res-0
    expect(PARENTS[0]).toBe('8828308281fffff');
    expect(PARENTS[PARENTS.length - 1]).toBe('8029fffffffffff');
    expect(parentHexagonsFor('not-a-hexagon').isValidH3).toBe(false);
    expect(parentHexagonsFor('not-a-hexagon').parents).toEqual([]);
  });

  test('put copies to every parent, delete retracts all of them', async () => {
    await sphere.put(CHILD, LENS, { id: 'q1', title: 'Repair the well' }, null, { awaitPropagation: true });

    for (const parent of PARENTS) {
      expect(await idsAt(parent)).toContain('q1');
    }

    await sphere.delete(CHILD, LENS, 'q1', null, { awaitPropagation: true });

    expect(await idsAt(CHILD)).not.toContain('q1');
    for (const parent of PARENTS) {
      expect(await idsAt(parent)).not.toContain('q1');
    }
  }, 60000);

  test("a parent's own record with the same id survives another holon's delete", async () => {
    const parent = PARENTS[0];
    await sphere.put(CHILD, LENS, { id: 'collide', title: 'child record' }, null, { awaitPropagation: true });
    // The parent hexagon holds a record of its own under the same id (an id
    // collision between two holons is entirely possible — ids are per-holon).
    await sphere.put(parent, LENS, { id: 'collide', title: 'parent OWN record' }, null, { autoPropagate: false });

    await sphere.delete(CHILD, LENS, 'collide', null, { awaitPropagation: true });

    const survivor = await sphere.get(parent, LENS, 'collide', null, { resolveHolograms: false, _skipAuthorize: true });
    expect(survivor?.title).toBe('parent OWN record');
    expect(survivor?._deleted).toBeFalsy();
  }, 60000);

  test('deleting a propagated copy does not cascade into the rest of the ancestry', async () => {
    await sphere.put(CHILD, LENS, { id: 'q2', title: 'Plant the orchard' }, null, { awaitPropagation: true });

    // Delete the copy sitting at the FIRST parent. That copy's origin is the
    // child, not this holon, so it must retract nothing further.
    await sphere.delete(PARENTS[0], LENS, 'q2', null, { awaitPropagation: true });

    expect(await idsAt(PARENTS[0])).not.toContain('q2');
    for (const parent of PARENTS.slice(1)) {
      expect(await idsAt(parent)).toContain('q2');
    }
    expect(await idsAt(CHILD)).toContain('q2');
  }, 60000);

  test('a non-H3 holon is a no-op (nothing to walk)', async () => {
    await sphere.put('my-group-holon', LENS, { id: 'q3', title: 'Local only' }, null, { awaitPropagation: true });
    const result = await sphere.propagateDeletion('my-group-holon', LENS, 'q3');
    expect(result.success).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
  }, 30000);

  test('autoPropagate:false leaves the parent copies alone', async () => {
    await sphere.put(CHILD, LENS, { id: 'q4', title: 'Keep the copies' }, null, { awaitPropagation: true });
    await sphere.delete(CHILD, LENS, 'q4', null, { autoPropagate: false, awaitPropagation: true });

    expect(await idsAt(CHILD)).not.toContain('q4');
    expect(await idsAt(PARENTS[0])).toContain('q4');
  }, 60000);

  // `needs/publish` (and `needs/settle`, `tasks/join-reflect`) propagate to the
  // parent hexagons with `useHolograms: true`, so the copy stored at each parent
  // is a bare `{ id, soul, _federation }` pointer rather than a full record. The
  // retraction sweep has to see those pointers AS STORED — resolving them would
  // hand back the source record, which carries neither `soul` nor
  // `_federation.origin`, and the ownership check would reject every one of them.
  test('a hologram-propagated copy is retracted too (sweep sees pointers, not sources)', async () => {
    const parent = PARENTS[0];
    await sphere.put(CHILD, LENS, { id: 'h1', title: 'Hologram copy' }, null, {
      awaitPropagation: true,
      propagationOptions: { useHolograms: true }
    });

    // What landed at the parent really is a pointer, not a full copy.
    expect(typeof (await storedAt(parent, 'h1'))?.soul).toBe('string');

    await sphere.delete(CHILD, LENS, 'h1', null, { awaitPropagation: true });

    for (const p of PARENTS) {
      expect(await storedAt(p, 'h1')).toBeNull();
    }
  }, 60000);

  // The `deleteAll` ordering makes this strictly worse than the single-key case:
  // the local source is gone BEFORE the sweep walks the parents, so a resolving
  // read finds a dangling soul and drops the pointer from its result entirely —
  // the sweep would never even get to the ownership check.
  test('deleteAll retracts hologram copies even though the source is already gone', async () => {
    const parent = PARENTS[0];
    await sphere.put(CHILD, LENS, { id: 'h2', title: 'Swept hologram' }, null, {
      awaitPropagation: true,
      propagationOptions: { useHolograms: true }
    });
    expect(typeof (await storedAt(parent, 'h2'))?.soul).toBe('string');

    await sphere.deleteAll(CHILD, LENS, null, { awaitPropagation: true });

    for (const p of PARENTS) {
      expect(await storedAt(p, 'h2')).toBeNull();
    }
  }, 90000);

  test('deleteAll retracts every copy this holon propagated, in one pass', async () => {
    await sphere.put(CHILD, LENS, { id: 'a1', title: 'one' }, null, { awaitPropagation: true });
    await sphere.put(CHILD, LENS, { id: 'a2', title: 'two' }, null, { awaitPropagation: true });
    const parent = PARENTS[0];
    await sphere.put(parent, LENS, { id: 'own', title: 'parent OWN record' }, null, { autoPropagate: false });

    await sphere.deleteAll(CHILD, LENS, null, { awaitPropagation: true });

    const left = await idsAt(parent);
    expect(left).not.toContain('a1');
    expect(left).not.toContain('a2');
    expect(left).toContain('own');       // the parent's own data is untouched
  }, 90000);
});
