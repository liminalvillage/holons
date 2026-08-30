/**
 * Standard-kind projections: a lens with a projection hook publishes its
 * standard Nostr kind next to the unchanged kind-30078 record, retracts it
 * with a NIP-09 kind 5 on delete, and never ingests projected kinds back.
 * Exercised on both publishers: the nostr-backend transport and the
 * gun-backend relay-backup signer.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import HoloSphere from '../holosphere.js';
import { startRelay } from '../spike/mini-relay.js';
import { generateSecretKey, getPublicKey, tag, HOLOSPHERE_KIND } from '../nostr-events.js';
import { createProjector } from '../projections.js';

const APP = 'projections-test';
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

/** Minimal calendar-like hook (the real codecs live in @holons/core/nostr). */
function eventsHook() {
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
        companions: (item.participants || []).map((p) => ({
          template: { kind: 31925, created_at: 0, content: '', tags: [['a', `31923:x:${d}`], ['d', `holons:rsvp:${holon}:${item.id}`], ['status', 'accepted']] },
          authorHint: { userId: p.id },
        })),
      };
    },
    retract(holon, lens, id) {
      return [{ kind: 5, created_at: 0, content: '', tags: [['a', `31923:x:holons:${lens}:${holon}:${id}`], ['k', '31923'], ['n', APP]] }];
    },
  };
}

function gunOptions(dirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-proj-'));
  dirs.push(dir);
  return { peers: [], axe: false, multicast: false, stats: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false };
}

describe('createProjector', () => {
  const sk = generateSecretKey();
  const userSk = generateSecretKey();

  test('signs primary with the holon key, companions only with a user key, and keeps created_at monotone', () => {
    const p = createProjector({ projections: [eventsHook()], privateKey: sk, signerFor: (id) => (String(id) === '7' ? userSk : null) });
    const item = { id: 'e1', title: 'Dinner', when: '2026-09-01T18:00:00Z', participants: [{ id: 7 }, { id: 8 }] };
    const first = p.eventsForWrite(HOLON, 'events', item);
    expect(first.map((e) => e.kind)).toEqual([31923, 31925]);
    expect(first[0].pubkey).toBe(getPublicKey(sk));
    expect(first[1].pubkey).toBe(getPublicKey(userSk));
    const second = p.eventsForWrite(HOLON, 'events', item);
    expect(second[0].created_at).toBeGreaterThan(first[0].created_at);
    expect(p.eventsForWrite(HOLON, 'events', { id: 'e2', title: 'undated' })).toEqual([]);
    expect(p.eventsForWrite(HOLON, 'quests', item)).toEqual([]);
    expect(p.eventsForWrite(null, 'events', item)).toEqual([]);
    expect(p.eventsForWrite(HOLON, 'events', { ...item, _hologram: {} })).toEqual([]);
    const dels = p.eventsForDelete(HOLON, 'events', 'e1');
    expect(dels[0].kind).toBe(5);
    expect(tag(dels[0], 'a')).toContain('holons:events:');
  });

  test('a throwing hook never breaks the write', () => {
    const p = createProjector({ projections: [{ lens: 'x', kinds: [1], project() { throw new Error('boom'); }, retract() { throw new Error('boom'); } }], privateKey: sk });
    expect(p.eventsForWrite(HOLON, 'x', { id: 1 })).toEqual([]);
    expect(p.eventsForDelete(HOLON, 'x', 1)).toEqual([]);
  });
});

describe('projections on the wire', () => {
  let relay;
  const dirs = [];
  const spheres = [];

  beforeAll(async () => { relay = await startRelay(); });
  afterAll(async () => {
    for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } }
    await relay.close();
    for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
  });

  const byKind = (k) => relay.events().filter((e) => e.kind === k && tag(e, 'n') === APP);

  test('nostr backend: 31923 published next to the unchanged 30078, kind 5 on delete, never ingested', async () => {
    const sphere = new HoloSphere({
      appName: APP, privateKey: generateSecretKey(), backend: 'nostr',
      nostr: { relays: [relay.url], syncTimeoutMs: 2000, projections: [eventsHook()] },
      gunOptions: gunOptions(dirs),
    });
    spheres.push(sphere);
    await sphere.put(HOLON, 'events', { id: 'ev1', title: 'Dinner', when: '2026-09-01T18:00:00Z', description: 'Bring food' });

    const projected = await eventually(() => byKind(31923).find((e) => tag(e, 'd') === `holons:events:${HOLON}:ev1`));
    expect(projected).toBeTruthy();
    expect(tag(projected, 'title')).toBe('Dinner');
    expect(tag(projected, 't')).toBe(`group-${HOLON}`);
    const canonical = byKind(HOLOSPHERE_KIND).find((e) => tag(e, 'd') === `${HOLON}/events/ev1`);
    expect(canonical).toBeTruthy();
    expect(JSON.parse(canonical.content).title).toBe('Dinner');

    // A second sphere reading the same relay must see the record once and no projected junk.
    const reader = new HoloSphere({
      appName: APP, privateKey: generateSecretKey(), backend: 'nostr',
      nostr: { relays: [relay.url], syncTimeoutMs: 2000 }, gunOptions: gunOptions(dirs),
    });
    spheres.push(reader);
    const seen = await eventually(async () => {
      const all = await reader.getAll(HOLON, 'events');
      return all?.length ? all : null;
    });
    expect(seen.map((i) => i.id)).toEqual(['ev1']);

    await sphere.delete(HOLON, 'events', 'ev1');
    const del = await eventually(() => byKind(5).find((e) => (tag(e, 'a') || '').endsWith(`holons:events:${HOLON}:ev1`)));
    expect(del).toBeTruthy();
  });

  test('gun backend + relay backup: signer publishes projections too', async () => {
    const sphere = new HoloSphere({ appName: APP, privateKey: generateSecretKey(), gunOptions: gunOptions(dirs) });
    spheres.push(sphere);
    await sphere.enableSigning({ relays: [relay.url], shadow: true, projections: [eventsHook()] });
    await sphere.put(HOLON, 'events', { id: 'ev2', title: 'Lunch', when: '2026-09-02T12:00:00Z' });
    const projected = await eventually(() => byKind(31923).find((e) => tag(e, 'd') === `holons:events:${HOLON}:ev2`));
    expect(projected).toBeTruthy();
    expect(byKind(HOLOSPHERE_KIND).some((e) => tag(e, 'd') === `${HOLON}/events/ev2`)).toBe(true);
    await sphere.delete(HOLON, 'events', 'ev2');
    const del = await eventually(() => byKind(5).find((e) => (tag(e, 'a') || '').endsWith(`holons:events:${HOLON}:ev2`)));
    expect(del).toBeTruthy();
  });
});
