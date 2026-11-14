// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
/**
 * A guarded lens (capabilities.js GUARDED_LENSES, today the holon's DNA in
 * `genes`): under an authorized read each record is taken WHOLE from the
 * envelopes the holon's admins (as of their own time) signed.
 *  - a member's newer write is ignored, and a record only a member wrote is
 *    absent (pending, never shown);
 *  - a vouched pointer or a federated copy never counts, even when the vouch
 *    hook would accept it, and neither does an admin's own hologram;
 *  - a record an admin signed keeps counting after they are demoted;
 *  - an admin's tombstone removes it, a member's does not;
 *  - the lens can never be made private.
 */
import HoloSphere from '../holosphere.js';
import { buildEvent, generateSecretKey, getPublicKey } from '../nostr-events.js';
import { GUARDED_LENSES, CAPABILITIES, requiredRole, roleSatisfies } from '../capabilities.js';
import { NEVER_PRIVATE } from '../privacy.js';

const APP = 'guarded-lens-test';
const HOLON = '-100720';
const FOREIGN = '-100721';
const T0 = 1700000000;
const gene = (id, title, extra = {}) => ({ id, kind: 'values', title, blurb: `${title} blurb`, order: 1, ack: 'agree', alleles: [], lang: 'en', updated: '2026-11-14T00:00:00Z', ...extra });

const spheres = [];
afterAll(async () => { for (const s of spheres.splice(0)) { try { s.disableSigning?.(); } catch { /* ignore */ } try { await s.close(); } catch { /* closed */ } } });

const plant = (holo, sk, holon, lens, item, at) => {
  const evt = buildEvent({ holon, lens, item, sk, created_at: at, extraTags: [['n', APP]] });
  holo.store.apply(evt, { origin: 'remote' });
  return evt;
};

describe('capabilities: the dna action and the guarded lenses', () => {
  test('genes is guarded, admin-only and never private', () => {
    expect(GUARDED_LENSES).toEqual(['genes']);
    expect(CAPABILITIES.dna).toBe('admin');
    expect(requiredRole('dna')).toBe('admin');
    expect(roleSatisfies('member', 'dna')).toBe(false);
    expect(roleSatisfies('admin', 'dna')).toBe(true);
    for (const lens of GUARDED_LENSES) expect(NEVER_PRIVATE).toContain(lens);
  });
});

describe('signing: a guarded lens under an authority that knows roles', () => {
  const adminSk = generateSecretKey(), adminPub = getPublicKey(adminSk);
  const admin2Sk = generateSecretKey(), admin2Pub = getPublicKey(admin2Sk);
  const memberSk = generateSecretKey(), memberPub = getPublicKey(memberSk);
  const foreignSk = generateSecretKey(), foreignPub = getPublicKey(foreignSk);
  const roles = { [HOLON]: new Map([[adminPub, 'admin'], [admin2Pub, 'admin'], [memberPub, 'member']]), [FOREIGN]: new Map([[foreignPub, 'admin']]) };
  const authority = async (_holo, holon) => {
    const map = roles[String(holon)];
    if (!map) return null;
    const p = (pub) => map.has(pub);
    p.roleAt = (pub) => map.get(pub) ?? null;
    return p;
  };
  const vouched = [];
  // A vouch hook that would stand behind ANY pointer or copy: on any other
  // lens these claims count, which is what makes the guard visible.
  const vouch = async (_holo, ctx) => { vouched.push(ctx.lens); return true; };
  const make = () => {
    const s = new HoloSphere({ appName: APP, privateKey: adminSk, store: { adapter: 'memory' }, signing: { enforce: 'authority', authority, vouch } });
    spheres.push(s);
    return s;
  };

  test('a member\'s newer gene is ignored and the admin\'s version wins, whole', async () => {
    const holo = make();
    await holo.ready();
    plant(holo, adminSk, HOLON, 'genes', gene('values', 'Our values', { color: '#00aa00' }), T0);
    plant(holo, memberSk, HOLON, 'genes', gene('values', 'Values (member edit)', { color: '#ff0000', alleles: [{ id: 'a', title: 'anyone in' }] }), T0 + 10);

    const got = await holo.get(HOLON, 'genes', 'values');
    expect(got.title).toBe('Our values');
    expect(got.color).toBe('#00aa00');      // whole: not one field from the member
    expect(got.alleles).toEqual([]);
    const all = await holo.getAll(HOLON, 'genes');
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(got);
  });

  test('a gene only a member wrote is absent: pending, never shown', async () => {
    const holo = make();
    await holo.ready();
    plant(holo, memberSk, HOLON, 'genes', gene('terms', 'Member terms'), T0);
    expect(await holo.get(HOLON, 'genes', 'terms')).toBeNull();
    expect(await holo.getAll(HOLON, 'genes')).toEqual([]);
    expect((await holo.getPending(HOLON, 'genes')).map((g) => g.id)).toEqual(['terms']);
    const annotated = await holo.getAll(HOLON, 'genes', null, { includeUnverified: true });
    expect(annotated).toEqual([expect.objectContaining({ id: 'terms', _unverified: true })]);
    // The same write on an ordinary lens counts: the member is seated.
    plant(holo, memberSk, HOLON, 'quests', { id: 'q1', title: 'Water the trees' }, T0);
    expect((await holo.get(HOLON, 'quests', 'q1'))?.title).toBe('Water the trees');
  });

  test('a vouched pointer or federated copy from a foreign admin is ignored; on a plain lens it would count', async () => {
    const holo = make();
    await holo.ready();
    // The foreign holon's own gene, and a plain item, both its admin's.
    plant(holo, foreignSk, FOREIGN, 'genes', gene('purpose', 'Foreign purpose', { kind: 'purpose', ack: 'read' }), T0);
    plant(holo, foreignSk, FOREIGN, 'quests', { id: 'q9', title: 'Foreign task' }, T0);
    // Into HOLON: a hologram of each, and a federated copy of the gene.
    plant(holo, foreignSk, HOLON, 'genes', { id: 'purpose', soul: `${APP}/${FOREIGN}/genes/purpose` }, T0 + 1);
    plant(holo, foreignSk, HOLON, 'quests', { id: 'q9', soul: `${APP}/${FOREIGN}/quests/q9` }, T0 + 1);
    plant(holo, foreignSk, HOLON, 'genes', { ...gene('agreements', 'Copied agreements', { kind: 'agreements' }), _federation: { origin: FOREIGN, sourceLens: 'genes' } }, T0 + 2);

    expect((await holo.get(HOLON, 'quests', 'q9'))?.title).toBe('Foreign task');   // vouched on a plain lens
    expect(await holo.get(HOLON, 'genes', 'purpose')).toBeNull();
    expect(await holo.get(HOLON, 'genes', 'agreements')).toBeNull();
    expect(await holo.getAll(HOLON, 'genes')).toEqual([]);
    expect(vouched).not.toContain('genes');   // never even put to the hook
    // The foreign holon's own gene is its admin's and stands there.
    expect((await holo.get(FOREIGN, 'genes', 'purpose'))?.title).toBe('Foreign purpose');
  });

  test('an admin\'s own hologram or federated copy does not count either; another admin\'s plain record does', async () => {
    const holo = make();
    await holo.ready();
    plant(holo, foreignSk, FOREIGN, 'genes', gene('tools', 'Foreign tools', { kind: 'tools', ack: 'none' }), T0);
    plant(holo, adminSk, HOLON, 'genes', gene('tools', 'Our tools', { kind: 'tools', ack: 'none' }), T0 + 1);
    // A second admin points the gene elsewhere, later: the pointer is ignored.
    plant(holo, admin2Sk, HOLON, 'genes', { id: 'tools', soul: `${APP}/${FOREIGN}/genes/tools` }, T0 + 2);
    expect((await holo.get(HOLON, 'genes', 'tools'))?.title).toBe('Our tools');
    plant(holo, admin2Sk, HOLON, 'genes', { ...gene('roles', 'Copied roles', { kind: 'roles' }), _federation: { origin: FOREIGN } }, T0 + 3);
    expect(await holo.get(HOLON, 'genes', 'roles')).toBeNull();
    expect((await holo.getAll(HOLON, 'genes')).map((g) => g.title)).toEqual(['Our tools']);
    // The store keeps one claim per author per address: an admin whose own
    // newest claim is a pointer has no plain record left to count.
    plant(holo, adminSk, HOLON, 'genes', { id: 'tools', soul: `${APP}/${FOREIGN}/genes/tools` }, T0 + 4);
    expect(await holo.get(HOLON, 'genes', 'tools')).toBeNull();
  });

  test('an admin\'s tombstone removes a gene; a member\'s does not', async () => {
    const holo = make();
    await holo.ready();
    plant(holo, adminSk, HOLON, 'genes', gene('practices', 'Practices'), T0);
    plant(holo, memberSk, HOLON, 'genes', { id: 'practices', _deleted: true }, T0 + 5);
    expect((await holo.get(HOLON, 'genes', 'practices'))?.title).toBe('Practices');
    plant(holo, adminSk, HOLON, 'genes', { id: 'practices', _deleted: true }, T0 + 6);
    expect(await holo.get(HOLON, 'genes', 'practices')).toBeNull();
    expect(await holo.getAll(HOLON, 'genes')).toEqual([]);
    expect(await holo.getPending(HOLON, 'genes')).toEqual([]);   // a counted delete, not pending
  });

  test('a subscriber sees the admin\'s gene, never a member\'s overwrite', async () => {
    const holo = make();
    await holo.ready();
    plant(holo, adminSk, HOLON, 'genes', gene('values', 'Our values'), T0);
    const seen = [];
    const sub = await holo.subscribe(HOLON, 'genes', (item) => seen.push(item?.title ?? null));
    plant(holo, memberSk, HOLON, 'genes', gene('values', 'Member values'), T0 + 10);
    await new Promise((r) => setTimeout(r, 200));
    sub?.unsubscribe?.();
    expect(seen).not.toContain('Member values');
    expect(seen.filter((t) => t !== null).every((t) => t === 'Our values')).toBe(true);
  });
});

describe('signing: a guarded lens under the signed membership log (as of time)', () => {
  const Ask = generateSecretKey();
  const Bsk = generateSecretKey(), Bpub = getPublicKey(Bsk);
  const Msk = generateSecretKey(), Mpub = getPublicKey(Msk);
  let A;

  beforeAll(async () => {
    A = new HoloSphere({ appName: APP, privateKey: Ask, store: { adapter: 'memory' } });
    spheres.push(A);
    await A.enableSigning({ relays: [], enforce: 'membership' });
    await A.foundHolon(HOLON, { at: T0 });
    await A.addMember(HOLON, Bpub, 'admin', { at: T0 + 1 });
    await A.addMember(HOLON, Mpub, 'member', { at: T0 + 2 });
  }, 30000);

  test('a gene signed by an admin later demoted still counts; what they sign after does not', async () => {
    plant(A, Bsk, HOLON, 'genes', gene('values', 'Values by B'), T0 + 10);
    plant(A, Bsk, HOLON, 'genes', gene('purpose', 'Purpose by B', { kind: 'purpose', ack: 'read' }), T0 + 11);
    await A.addMember(HOLON, Bpub, 'member', { at: T0 + 20 });   // demoted
    plant(A, Bsk, HOLON, 'genes', gene('terms', 'Terms by B, demoted', { kind: 'terms' }), T0 + 31);
    plant(A, Msk, HOLON, 'genes', gene('purpose', 'Purpose by M'), T0 + 32);

    expect((await A.get(HOLON, 'genes', 'values'))?.title).toBe('Values by B');
    expect((await A.get(HOLON, 'genes', 'purpose'))?.title).toBe('Purpose by B');
    expect(await A.get(HOLON, 'genes', 'terms')).toBeNull();
    expect((await A.getAll(HOLON, 'genes')).map((g) => g.title).sort()).toEqual(['Purpose by B', 'Values by B']);
    expect((await A.getPending(HOLON, 'genes')).map((g) => g.id)).toEqual(['terms']);
    // A demoted key's rewrite replaces its own earlier claim (one claim per
    // author per address) and does not count: an admin's earlier version,
    // if any, stands; here there is none, so the gene is absent.
    plant(A, Bsk, HOLON, 'genes', gene('values', 'Values by B, demoted'), T0 + 30);
    expect(await A.get(HOLON, 'genes', 'values')).toBeNull();
    // An ordinary lens still takes the demoted key's write: they are a member.
    plant(A, Bsk, HOLON, 'quests', { id: 'q1', title: 'by B' }, T0 + 33);
    expect((await A.get(HOLON, 'quests', 'q1'))?.title).toBe('by B');
  });

  test('the founding admin\'s own put lands and reads back', async () => {
    await A.put(HOLON, 'genes', gene('agreements', 'Agreements by A', { kind: 'agreements' }));
    expect((await A.get(HOLON, 'genes', 'agreements'))?.title).toBe('Agreements by A');
  });

  test('genes can never be made private', async () => {
    expect(A.privacy.privatizable(HOLON, 'genes')).toBe(false);
    expect(() => A.privacy.assertPrivatizable(HOLON, 'genes')).toThrow(/cannot be private/);
    await expect(A.privacy.lock({ holon: HOLON, lens: 'genes' })).rejects.toThrow(/cannot be private/);
    await expect(A.privacy.lock({ holon: HOLON, lens: 'genes', item: 'values' })).rejects.toThrow(/cannot be private/);
    expect(A.privacy.isPrivate(HOLON, 'genes')).toBe(false);
  });
});
