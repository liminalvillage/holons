/**
 * An enforced read on a COLD store: the holon's `_members` log is pulled
 * alongside the lens, so the first read already knows who speaks for the
 * holon. Without it a fresh instance answered "nobody defined" and showed
 * every claim, where a warm one showed only the accepted ones.
 */
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { membersTimeline } from '../authority.js';
import { generateSecretKey, getPublicKey } from '../nostr-events.js';

const APP = 'cold-members-test';
const H = '-100800';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeout = 12000, step = 50) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await pred()) return true; await wait(step); }
  return false;
}

// The app's rule, as core wires it: a founded log decides; nothing signed → open.
const authority = async (holo, holon) => {
  const tl = membersTimeline(holo.store, holon);
  return tl.genesisPub ? (pub, at) => tl.isAuthorizedAt(pub, at) : null;
};

describe('enforced read on a cold store', () => {
  let relay;
  const spheres = [];
  const make = (sk, signing) => {
    const s = new HoloSphere({
      appName: APP, privateKey: sk, relays: [relay.url],
      store: { adapter: 'memory' }, nostr: { syncTimeoutMs: 3000, freshnessMs: 0, grants: false },
      ...(signing ? { signing } : {}),
    });
    spheres.push(s);
    return s;
  };

  beforeAll(async () => { relay = await startRelay(); });
  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* ignore */ } }
    try { await relay.close(); } catch { /* ignore */ }
    await wait(200);
    for (const h of (typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [])) {
      if (h?.constructor?.name === 'Socket' && typeof h.unref === 'function') h.unref();
    }
  }, 30000);

  test('the first read of a lens already enforces the holon log it has never seen', async () => {
    const founderSk = generateSecretKey(), founderPub = getPublicKey(founderSk);
    const strangerSk = generateSecretKey();

    const founder = make(founderSk, { enforce: 'authority', authority });
    await founder.ready();
    await founder.foundHolon(H);
    await founder.put(H, 'tasks', { id: 'mine', title: 'founder' });

    // A stranger writes into the same holon, unenforced on their side.
    const stranger = make(strangerSk);
    await stranger.ready();
    await stranger.put(H, 'tasks', { id: 'theirs', title: 'stranger' });

    // Everything reached the relay (a reader with no rule sees both).
    const witness = make(generateSecretKey());
    await witness.ready();
    expect(await waitFor(async () => (await witness.getAll(H, 'tasks')).length === 2)).toBe(true);

    // A COLD enforcing reader: fresh store, has never pulled `_members`.
    const reader = make(generateSecretKey(), { enforce: 'authority', authority });
    await reader.ready();
    expect(reader.store.listEventIds(H, '_members')).toEqual([]);
    const first = await reader.getAll(H, 'tasks');
    expect(first.map((t) => t.id)).toEqual(['mine']);
    expect(membersTimeline(reader.store, H).genesisPub).toBe(founderPub);
    expect((await reader.getPending(H, 'tasks')).map((t) => t.id)).toEqual(['theirs']);

    // And the single-item path agrees from cold as well.
    const reader2 = make(generateSecretKey(), { enforce: 'authority', authority });
    await reader2.ready();
    expect(await reader2.get(H, 'tasks', 'theirs')).toBeNull();
    expect((await reader2.get(H, 'tasks', 'mine')).title).toBe('founder');
  }, 30000);
});
