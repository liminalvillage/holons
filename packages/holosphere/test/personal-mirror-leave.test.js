/**
 * Personal-holon mirror + participation removal (the dashboard "leave" flow).
 *
 * Web flow under test (TaskModal in the personal-holon view, backend nostr):
 *   1. a quest lives in its home holon (authored by the bot's key)
 *   2. joining mirrored it into the member's personal holon as a hologram
 *   3. the member unticks themself: the RESOLVED record (participants
 *      removed, `_hologram` envelope still attached) is put back at the
 *      PERSONAL address — content.js must redirect the write to the source
 *   4. the mirror must survive: the personal-holon read still resolves the
 *      quest (now without the participant), and the home copy is intact —
 *      nothing may tombstone either address.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey } from '../nostr-events.js';

const APP = 'personal-mirror-test';
const HOME = '89283082803ffff';
const USER_ID = '235114395';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function eventually(fn, { timeout = 8000, step = 200 } = {}) {
  const until = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > until) return last;
    await wait(step);
  }
}

describe('personal-holon mirror survives a participation removal', () => {
  let relay;
  const dirs = [];
  const spheres = [];

  function nostrSphere({ privateKey = generateSecretKey() } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-mirror-'));
    dirs.push(dir);
    const sphere = new HoloSphere({
      appName: APP,
      privateKey,
      nostr: { relays: [relay.url], syncTimeoutMs: 3000 },
      store: { adapter: 'memory' },
    });
    spheres.push(sphere);
    return sphere;
  }

  beforeAll(async () => {
    relay = await startRelay();
  });

  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } }
    try { await relay.close(); } catch { /* closed */ }
    for (const d of dirs.splice(0)) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* tmp */ }
    }
    await wait(200);
    for (const h of (typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [])) {
      if (h?.constructor?.name === 'Socket' && typeof h.unref === 'function') h.unref();
    }
  });

  test('untick-self at the personal address redirects to the source and keeps the mirror', async () => {
    const userKey = generateSecretKey();
    const bot = nostrSphere();               // the quest's home author
    const user = nostrSphere({ privateKey: userKey }); // "the browser"

    // 1. home quest with the member as participant
    await bot.put(HOME, 'quests', {
      id: 'q1', title: 'Garden day', when: '2026-09-01T08:00:00Z',
      participants: [{ id: USER_ID, firstName: 'Roberto' }],
    });

    // 2. the join-mirror: a bare {id, soul} hologram in the personal holon
    const hologram = bot.createHologram(HOME, 'quests', { id: 'q1' });
    await bot.put(USER_ID, 'quests', hologram);

    // 3. the member's browser resolves the mirror…
    const resolved = await eventually(async () => {
      const items = await user.getAll(USER_ID, 'quests');
      const q = items.find((i) => i.id === 'q1');
      return q && !q._deleted && q.title === 'Garden day' ? q : null;
    });
    expect(resolved).toBeTruthy();
    expect(resolved._hologram?.isHologram).toBe(true);

    // …and unticks themself exactly like TaskModal does: resolved record,
    // participants emptied, _hologram envelope still attached, written at
    // the PERSONAL address.
    await user.put(USER_ID, 'quests', { ...resolved, participants: [] });
    await wait(500);

    // 4a. the write landed on the SOURCE
    const home = await eventually(async () => {
      const q = await bot.get(HOME, 'quests', 'q1');
      return q && Array.isArray(q.participants) && q.participants.length === 0 ? q : null;
    });
    expect(home).toBeTruthy();
    expect(home._deleted).toBeFalsy();
    expect(home.title).toBe('Garden day');

    // 4b. the personal mirror still resolves (not deleted, not forked)
    const mirrored = await user.getAll(USER_ID, 'quests');
    const still = mirrored.find((i) => i.id === 'q1');
    expect(still).toBeTruthy();
    expect(still._deleted).toBeFalsy();
    expect(still.participants ?? []).toEqual([]);

    // 4c. a cold reload of the member's browser still sees the mirror
    const reloaded = nostrSphere({ privateKey: userKey });
    const afterReload = await eventually(async () => {
      const items = await reloaded.getAll(USER_ID, 'quests');
      const q = items.find((i) => i.id === 'q1');
      return q && !q._deleted ? q : null;
    });
    expect(afterReload).toBeTruthy();
    expect(afterReload.participants ?? []).toEqual([]);

    // 4d. …and the bot's cold view of the home holon is intact
    const botHome = await bot.getAll(HOME, 'quests');
    expect(botHome.find((i) => i.id === 'q1')?._deleted).toBeFalsy();
  }, 30000);
});
