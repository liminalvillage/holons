/**
 * A vault counts only when a member of the holon signed it (privacy.js
 * vaultRecord). A store that has pulled the holon's `_vault` but not yet its
 * `_members` log answers "nobody speaks for this holon" — and then a
 * stranger's stale vault locks the lens, so every write by a key that cannot
 * open it throws "privacy: no key" before it is even stored.
 *
 * Seen on prod 2026-11-11: a lock left by the bot's retired key made the
 * bot's /task writes to a personal holon fail until a restart. Loading the
 * keys must bring the roster along with the vault.
 */
import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';
import { isSealed } from '../store/sealed.js';

const HOLON = '777000111';
const LENS = 'quests';
const TS = 1700000000;

function eventsOf(sphere, holon, lens) {
  const out = [];
  for (const id of sphere.store.listEventIds(holon, lens)) out.push(...sphere.store.getEvents(holon, lens, id));
  return out;
}

/** A relay transport that serves a fixed set of events per lens on pull. */
function fixtureTransport(sphere, byLens) {
  const pulled = new Set();
  return {
    pulled,
    relays: ['wss://fixture.invalid'],
    async ensureSync(holon, lens) {
      pulled.add(`${holon}|${lens}`);
      for (const evt of byLens[`${holon}|${lens}`] || []) sphere.store.apply(evt, { origin: 'remote' });
    },
    async publishEvents() { return []; },
    watch() { return () => {}; },
    subscribeRaw() { return () => {}; },
    async query() { return []; },
    resync() {},
    flushOutbox() {},
    close() {},
  };
}

describe('privacy: a cold store judges a vault with the roster loaded', () => {
  const spheres = [];
  const make = (sk, app) => {
    const s = new HoloSphere({ appName: app, privateKey: sk, store: { adapter: 'memory' } });
    spheres.push(s);
    return s;
  };

  afterAll(async () => {
    for (const s of spheres) { try { await s.close?.(); } catch {} }
  });

  test("a stranger's stale vault does not block a member's write", async () => {
    const botSk = generateSecretKey();
    const oldSk = generateSecretKey();

    // The holon is founded by the bot's current key.
    const founder = make(botSk, 'cold-roster');
    await founder.ready();
    await founder.foundHolon(HOLON, { at: TS });
    const members = eventsOf(founder, HOLON, '_members');
    expect(members.length).toBeGreaterThan(0);

    // A retired key, never seated, once locked the lens.
    const old = make(oldSk, 'cold-roster');
    await old.ready();
    await old.privacy.lock({ holon: HOLON, lens: LENS });
    const vault = eventsOf(old, HOLON, '_vault');
    expect(vault.length).toBeGreaterThan(0);

    // A fresh bot process: empty store, both logs live only on the relay.
    const bot = make(botSk, 'cold-roster');
    await bot.ready();
    const relay = fixtureTransport(bot, {
      [`${HOLON}|_members`]: members,
      [`${HOLON}|_vault`]: vault,
    });
    bot._relayTransport = relay;

    await bot.put(HOLON, LENS, { id: 'asd', title: 'Asd' });

    expect(relay.pulled.has(`${HOLON}|_members`)).toBe(true);
    const [evt] = bot.store.getEvents(HOLON, LENS, 'asd');
    expect(evt).toBeDefined();
    expect(isSealed(JSON.parse(evt.content))).toBe(false);
    expect(JSON.parse(evt.content).title).toBe('Asd');
  });
});
