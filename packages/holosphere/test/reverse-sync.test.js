/**
 * Reverse sync (projections phase 2): an EXTERNAL edit of a projected
 * standard-kind event — by the holon key or a trusted member key — is folded
 * back into the lens record, re-signed as our 30078, never re-projected
 * (no ratchet) and never applied from untrusted keys or our own echoes.
 * Exercised on both wires: nostr backend and gun + relay backup.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey, getPublicKey, signEvent, tag, HOLOSPHERE_KIND } from '../nostr-events.js';

const APP = 'reverse-sync-test';
const HOLON = '-1003864542239';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, { timeout = 8000, step = 100 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > until) return v;
    await wait(step);
  }
}
const dTag = (lens, id) => `holons:${lens}:${HOLON}:${id}`;

/** Minimal calendar-like hook WITH parse/merge (the real codecs live in @holons/core/nostr). */
function eventsHook(userIdFor) {
  return {
    lens: 'events',
    kinds: [31923, 31925],
    project(holon, lens, item) {
      if (!item.when) return null;
      const d = `holons:${lens}:${holon}:${item.id}`;
      return {
        primary: {
          kind: 31923, created_at: 0, content: item.description || '',
          tags: [['d', d], ['title', item.title], ['start', String(Date.parse(item.when) / 1000)], ['t', `group-${holon}`], ['n', APP]],
        },
      };
    },
    retract() { return []; },
    parse(event) {
      if (event.kind === 31923) {
        const m = /^holons:events:(.+?):([^:]+)$/.exec(tag(event, 'd') || '');
        if (!m) return null;
        return { lens: 'events', holon: m[1], id: m[2], kind: 31923, pubkey: event.pubkey, createdAt: event.created_at, patch: { title: tag(event, 'title') } };
      }
      if (event.kind === 31925) {
        const m = /^31923:[0-9a-f]{64}:holons:events:(.+?):([^:]+)$/.exec(tag(event, 'a') || '');
        if (!m) return null;
        return { lens: 'events', holon: m[1], id: m[2], kind: 31925, pubkey: event.pubkey, createdAt: event.created_at, rsvp: { pubkey: event.pubkey, userId: userIdFor(event.pubkey), status: tag(event, 'status') } };
      }
      return null;
    },
    merge(current, r) {
      if (r.rsvp) {
        if (r.rsvp.userId === undefined) return null;
        const ps = Array.isArray(current.participants) ? current.participants : [];
        const has = ps.some((p) => String(p.id) === String(r.rsvp.userId));
        if (r.rsvp.status === 'accepted') return has ? null : { ...current, participants: [...ps, { id: r.rsvp.userId }] };
        return has ? { ...current, participants: ps.filter((p) => String(p.id) !== String(r.rsvp.userId)) } : null;
      }
      if (r.patch?.title && r.patch.title !== current.title) return { ...current, title: r.patch.title };
      return null;
    },
  };
}

function usersHook(userIdFor) {
  return {
    lens: 'users', kinds: [0], requiresAuthor: 'user',
    project(holon, lens, item) {
      return { primary: { kind: 0, created_at: 0, content: JSON.stringify({ name: item.first_name }), tags: [['n', APP]] } };
    },
    retract() { return []; },
    parse(event) {
      if (event.kind !== 0) return null;
      const uid = userIdFor(event.pubkey);
      if (uid === undefined) return null;
      return { lens: 'users', holon: '', id: String(uid), kind: 0, pubkey: event.pubkey, createdAt: event.created_at, patch: { first_name: JSON.parse(event.content).name }, ownerOnly: true };
    },
    merge(current, r) { return r.patch.first_name && r.patch.first_name !== current.first_name ? { ...current, first_name: r.patch.first_name } : null; },
  };
}

function gunOptions(dirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-rev-'));
  dirs.push(dir);
  return { peers: [], axe: false, multicast: false, stats: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false };
}

describe('reverse sync on the wire', () => {
  let relay;
  let pool;
  const dirs = [];
  const spheres = [];

  beforeAll(async () => {
    relay = await startRelay();
    const { SimplePool } = await import('nostr-tools/pool');
    pool = new SimplePool();
  });
  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } }
    try { pool.close([relay.url]); } catch { /* ignore */ }
    await relay.close();
    for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
  });

  const byKind = (k) => relay.events().filter((e) => e.kind === k);
  const foreign = async (template, sk) => {
    const ev = signEvent({ ...template, created_at: template.created_at ?? Math.floor(Date.now() / 1000) + 5 }, sk);
    await Promise.allSettled(pool.publish([relay.url], ev));
    return ev;
  };

  /** One scenario, run against a sphere set up by `make(hooks, signerFor, trustedAuthors)`. */
  async function scenario(name, make) {
    const holonSk = generateSecretKey();
    const aliceSk = generateSecretKey();
    const bobSk = generateSecretKey();       // member
    const mallorySk = generateSecretKey();   // NOT trusted
    const byPubkey = new Map([[getPublicKey(aliceSk), 42], [getPublicKey(bobSk), 7]]);
    const userIdFor = (pk) => byPubkey.get(pk);
    const signerFor = (id) => (String(id) === '42' ? aliceSk : String(id) === '7' ? bobSk : null);
    const trustedAuthors = () => [getPublicKey(holonSk), ...byPubkey.keys()];
    const sphere = await make({ holonSk, hooks: [eventsHook(userIdFor), usersHook(userIdFor)], signerFor, trustedAuthors });
    spheres.push(sphere);
    const id = `${name}-ev`;
    const seen = [];
    sphere.subscribe(HOLON, 'events', (item) => { if (item && item.id === id) seen.push(item.title); });
    await sphere.put(HOLON, 'events', { id, title: 'Dinner', when: '2026-09-01T18:00:00Z', participants: [] });
    await sphere.put(HOLON, 'users', { id: 42, first_name: 'Alice' });
    const projected = await eventually(() => byKind(31923).find((e) => tag(e, 'd') === dTag('events', id)));
    expect(projected).toBeTruthy();
    const projectedCount = () => byKind(31923).filter((e) => tag(e, 'd') === dTag('events', id)).length;
    const canonical = () => byKind(HOLOSPHERE_KIND).find((e) => tag(e, 'd') === `${HOLON}/events/${id}`);

    // 1. holon key republishes the calendar event with a new title → record updates,
    //    our 30078 is refreshed, no extra 31923 emitted by the sphere (relay keeps the foreign one).
    const edit = await foreign({ kind: 31923, content: '', tags: projected.tags.map((t) => (t[0] === 'title' ? ['title', 'Dinner (moved)'] : t)) }, holonSk);
    await eventually(async () => (await sphere.get(HOLON, 'events', id))?.title === 'Dinner (moved)');
    expect((await sphere.get(HOLON, 'events', id)).title).toBe('Dinner (moved)');
    await eventually(() => JSON.parse(canonical()?.content || '{}').title === 'Dinner (moved)');
    expect(JSON.parse(canonical().content).title).toBe('Dinner (moved)');
    expect(byKind(31923).find((e) => tag(e, 'd') === dTag('events', id)).id).toBe(edit.id); // relay still holds the foreign edit
    await eventually(() => seen.includes('Dinner (moved)'));
    expect(seen.filter((t) => t === 'Dinner (moved)').length).toBe(1);

    // 2. member RSVP accepted → participant added; declined → removed; untrusted key → ignored.
    const a = `31923:${getPublicKey(holonSk)}:${dTag('events', id)}`;
    await foreign({ kind: 31925, content: '', tags: [['a', a], ['d', `rsvp-${id}`], ['status', 'accepted']] }, bobSk);
    await eventually(async () => (await sphere.get(HOLON, 'events', id))?.participants?.some((p) => String(p.id) === '7'));
    expect((await sphere.get(HOLON, 'events', id)).participants.map((p) => String(p.id))).toEqual(['7']);
    await foreign({ kind: 31925, content: '', tags: [['a', a], ['status', 'accepted']] }, mallorySk);
    await wait(400);
    expect((await sphere.get(HOLON, 'events', id)).participants.map((p) => String(p.id))).toEqual(['7']);
    await foreign({ kind: 31925, content: '', tags: [['a', a], ['status', 'declined']], created_at: Math.floor(Date.now() / 1000) + 10 }, bobSk);
    await eventually(async () => !(await sphere.get(HOLON, 'events', id))?.participants?.length);
    expect((await sphere.get(HOLON, 'events', id)).participants).toEqual([]);

    // 3. own projection echo is never re-applied: a local edit re-projects with created_at > the external edit (no ratchet),
    //    and the title is what we wrote, not what the echo says.
    const before = projectedCount();
    await sphere.put(HOLON, 'events', { ...(await sphere.get(HOLON, 'events', id)), title: 'Dinner (final)' });
    const reprojected = await eventually(() => {
      const e = byKind(31923).find((x) => tag(x, 'd') === dTag('events', id));
      return e && e.id !== edit.id ? e : null;
    });
    expect(reprojected.created_at).toBeGreaterThan(edit.created_at);
    expect(tag(reprojected, 'title')).toBe('Dinner (final)');
    await wait(400);
    expect((await sphere.get(HOLON, 'events', id)).title).toBe('Dinner (final)');
    expect(projectedCount()).toBe(before); // NIP-33 replaced, nothing extra

    // 4. kind 0 by Alice's key patches her users record; Bob's key cannot edit Alice.
    await foreign({ kind: 0, content: JSON.stringify({ name: 'Alicia' }), tags: [] }, aliceSk);
    await eventually(async () => (await sphere.get(HOLON, 'users', 42))?.first_name === 'Alicia');
    expect((await sphere.get(HOLON, 'users', 42)).first_name).toBe('Alicia');
    await foreign({ kind: 0, content: JSON.stringify({ name: 'Hijacked' }), tags: [] }, bobSk); // resolves to user 7 — no such record here
    await wait(400);
    expect((await sphere.get(HOLON, 'users', 42)).first_name).toBe('Alicia');
  }

  test('nostr backend folds external edits back into records', async () => {
    await scenario('nb', async ({ holonSk, hooks, signerFor, trustedAuthors }) => new HoloSphere({
      appName: APP, privateKey: holonSk, backend: 'nostr',
      nostr: { relays: [relay.url], syncTimeoutMs: 2000, projections: hooks, signerFor, trustedAuthors },
      gunOptions: gunOptions(dirs),
    }));
  }, 30000);

  test('gun backend + relay backup folds external edits back into records', async () => {
    await scenario('gb', async ({ holonSk, hooks, signerFor, trustedAuthors }) => {
      const sphere = new HoloSphere({ appName: APP, privateKey: holonSk, gunOptions: gunOptions(dirs) });
      await sphere.enableSigning({ relays: [relay.url], shadow: true, projections: hooks, signerFor, trustedAuthors });
      return sphere;
    });
  }, 30000);

  test('reverseSync:false keeps phase-1 behaviour', async () => {
    const holonSk = generateSecretKey();
    const sphere = new HoloSphere({
      appName: APP, privateKey: holonSk, backend: 'nostr',
      nostr: { relays: [relay.url], syncTimeoutMs: 2000, projections: [eventsHook(() => undefined)], reverseSync: false },
      gunOptions: gunOptions(dirs),
    });
    spheres.push(sphere);
    await sphere.put(HOLON, 'events', { id: 'off', title: 'Dinner', when: '2026-09-01T18:00:00Z' });
    const projected = await eventually(() => byKind(31923).find((e) => tag(e, 'd') === dTag('events', 'off')));
    await foreign({ kind: 31923, content: '', tags: projected.tags.map((t) => (t[0] === 'title' ? ['title', 'Changed'] : t)) }, holonSk);
    await wait(600);
    expect((await sphere.get(HOLON, 'events', 'off')).title).toBe('Dinner');
  }, 20000);
});
