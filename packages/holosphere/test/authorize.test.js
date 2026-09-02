/**
 * Phase 2: authorized read-collapse with an as-of-time membership log.
 *
 * Timeline (TS = base seconds), holon founded by admin A:
 *   TS    A: genesis (admin)
 *   TS+1  A writes t1            -> authorized
 *   TS    (raw) t-unsigned       -> pending (no signature)
 *   TS+2  B writes t3            -> pending (B not yet a member)
 *   TS+3  A adds B (member)
 *   TS+5  B writes t4            -> authorized (B is a member as of TS+5)
 *   TS+7  A removes B
 *   TS+9  B writes t5            -> pending (B removed as of TS+9)
 */
import HoloSphere from '../holosphere.js';
import { generateSecretKey, getPublicKey, buildEvent } from '../nostr-events.js';

const HOLON = '89283082803ffff';
const LENS = 'tasks';
const TS = 1700000000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (arr) => arr.map((i) => i.id).sort();

describe('authorized read — membership mode (holon authority)', () => {
  let sphere, Ask, Bsk, Bpub;

  // simulate any key writing into the open graph: signed envelope + raw item
  async function writeAs(sk, item, at) {
    const evt = buildEvent({ holon: HOLON, lens: LENS, item, sk, created_at: at });
    sphere.store.apply(evt, { origin: 'remote' });
  }

  beforeAll(async () => {
    Ask = generateSecretKey();
    Bsk = generateSecretKey();
    Bpub = getPublicKey(Bsk);
    sphere = new HoloSphere({
      appName: 'authz-test',
      privateKey: Ask,
      store: { adapter: 'memory' },
    });
    await sphere.enableSigning({ relays: [], enforce: 'membership' });

    await sphere.foundHolon(HOLON, { at: TS });           // A = genesis admin
    await writeAs(Ask, { id: 't1', title: 'A task' }, TS + 1);
    await sphere.put(HOLON, LENS, { id: 't-unsigned', title: 'forged' }, null, { _skipSign: true });
    await writeAs(Bsk, { id: 't3', title: 'B before join' }, TS + 2);
    await sphere.addMember(HOLON, Bpub, 'member', { at: TS + 3 });
    await writeAs(Bsk, { id: 't4', title: 'B as member' }, TS + 5);
    await sphere.removeMember(HOLON, Bpub, { at: TS + 7 });
    await writeAs(Bsk, { id: 't5', title: 'B after removal' }, TS + 9);

    await wait(1500);
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
  }, 15000);

  test('enforce read returns only authorized items (as-of-time)', async () => {
    const view = await sphere.getAll(HOLON, LENS);
    // t1 (admin), t4 (B while member). NOT t3 (pre-join), t5 (post-removal), t-unsigned.
    expect(ids(view)).toEqual(['t1', 't4']);
  });

  test('the raw store still holds everything (open graph, non-destructive)', async () => {
    const raw = await sphere.getAll(HOLON, LENS, null, { _skipAuthorize: true });
    expect(ids(raw)).toEqual(['t-unsigned', 't1', 't3', 't4', 't5']);
  });

  test('pending view surfaces the dropped items', async () => {
    const pending = await sphere.getPending(HOLON, LENS);
    expect(ids(pending)).toEqual(['t-unsigned', 't3', 't5']);
  });

  test('report classifies one enforce pass', async () => {
    sphere.resetShadowReport();
    await sphere.getAll(HOLON, LENS);
    const r = sphere.getShadowReport();
    expect(r.items).toBe(5);
    expect(r.accounted).toBe(2);
    expect(r.wouldDrop).toBe(3);
    expect(r.unauthorized).toBe(2); // t3, t5 — valid B signature, not authorized at signing time
    expect(r.unsigned).toBe(1);     // t-unsigned — no envelope
  });

  test('getMembers reflects the current authorized set', async () => {
    const members = await sphere.getMembers(HOLON);
    expect(members.get(getPublicKey(Ask))).toBe('admin');
    expect(members.has(Bpub)).toBe(false); // B was removed
    expect(members.size).toBe(1);
  });
});
