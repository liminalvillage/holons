/**
 * The one capability table (capabilities.js), where the data layer applies it:
 *  - the federation record is an admin's — a member's or a stranger's newer
 *    write does not decide a holon's partners, and the first admin write
 *    adopts what was there;
 *  - the value equation is a guarded settings field;
 *  - a vault record counts from a member, and only its author or an admin
 *    retires it — an admin holding the key can unlock what a member locked.
 */
import HoloSphere from '../holosphere.js';
import { buildEvent, generateSecretKey, getPublicKey } from '../nostr-events.js';
import { isSealed, unsealSelf } from '../store/sealed.js';
import { GLOBAL_HOLON } from '../store/address.js';
import { CAPABILITIES, GUARDED_SETTINGS_FIELDS, requiredRole, roleSatisfies } from '../capabilities.js';

const APP = 'capabilities-test';
const HOLON = '-100710';
const T0 = 1700000000;

describe('capabilities: the table', () => {
  test('member and admin tiers', () => {
    expect(requiredRole('content')).toBe('member');
    expect(requiredRole('federation')).toBe('admin');
    expect(requiredRole('something-new')).toBe('admin');
    expect(roleSatisfies('member', 'privacy.lock')).toBe(true);
    expect(roleSatisfies('member', 'privacy.override')).toBe(false);
    expect(roleSatisfies('admin', 'federation')).toBe(true);
    expect(roleSatisfies(null, 'content')).toBe(false);
    expect(GUARDED_SETTINGS_FIELDS).toEqual(expect.arrayContaining(['valueEquation', 'equation', 'allocation']));
    expect(Object.keys(CAPABILITIES)).toEqual(expect.arrayContaining(['federation', 'settings.guarded', 'privacy.override']));
  });
});

describe('capabilities: the federation record is an admin\'s', () => {
  const spheres = [];
  afterAll(async () => { for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } } });

  const adminSk = generateSecretKey();
  const adminPub = getPublicKey(adminSk);
  const memberSk = generateSecretKey();
  const memberPub = getPublicKey(memberSk);
  const strangerSk = generateSecretKey();
  const roles = new Map([[adminPub, 'admin'], [memberPub, 'member']]);
  // Only HOLON has an authority; every other holon is open.
  const authority = async (_holo, holon) => {
    if (String(holon) !== HOLON) return null;
    const p = (pub) => roles.has(pub);
    p.roleAt = (pub) => roles.get(pub) ?? null;
    return p;
  };
  const make = (sk) => {
    const s = new HoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' }, signing: { enforce: 'authority', authority } });
    spheres.push(s);
    return s;
  };
  const plantGlobal = (holo, sk, item, at) => {
    const evt = buildEvent({ holon: GLOBAL_HOLON, lens: 'federation', item, sk, created_at: at, extraTags: [['n', APP]] });
    holo.store.apply(evt, { origin: 'remote' });
  };
  const record = (partners) => ({ id: HOLON, federated: partners, inbound: partners, outbound: [], lensConfig: Object.fromEntries(partners.map((p) => [p, { inbound: ['quests'], outbound: [] }])), partnerNames: {} });

  test('a member\'s or a stranger\'s newer record does not count; the admin\'s does', async () => {
    const holo = make(adminSk);
    await holo.ready();
    plantGlobal(holo, adminSk, record(['-200']), T0);
    plantGlobal(holo, memberSk, record(['-200', '-300']), T0 + 10);
    plantGlobal(holo, strangerSk, record(['-666']), T0 + 20);
    const fed = await holo.getFederation(HOLON);
    expect(fed.federated).toEqual(['-200']);
    const standing = await holo.getFederationStanding(HOLON);
    expect(standing.endorsed).toBe(true);
    expect(standing.raw.federated).toEqual(['-666']);
    // The plain global read still shows the open graph.
    expect((await holo.getGlobal('federation', HOLON)).federated).toEqual(['-666']);
  });

  test('a record nobody with the role signed is not counted, and the first admin write adopts it', async () => {
    const holo = make(adminSk);
    await holo.ready();
    plantGlobal(holo, strangerSk, record(['-444']), T0);
    expect((await holo.getFederation(HOLON)).federated).toEqual([]);
    expect((await holo.getFederationStanding(HOLON)).endorsed).toBe(false);
    // The admin links a partner: the legacy record is the base, now endorsed.
    await holo.federateHolon(HOLON, '-555', { lensConfig: { inbound: ['quests'], outbound: [] } });
    const fed = await holo.getFederation(HOLON);
    expect(fed.federated.sort()).toEqual(['-444', '-555']);
    expect((await holo.getFederationStanding(HOLON)).endorsed).toBe(true);
  });

  test('a member\'s link does not open a lens on their holon', async () => {
    const holo = make(memberSk);
    await holo.ready();
    plantGlobal(holo, adminSk, record(['-200']), T0);
    await holo.federateHolon(HOLON, '-900', { lensConfig: { inbound: ['quests'], outbound: ['quests'] } });
    expect((await holo.getFederation(HOLON)).federated).toEqual(['-200']);   // the admin's record stands
    // The holon nobody speaks for took the mirrored write: open, plain.
    expect((await holo.getFederation('-900')).federated).toEqual([HOLON]);
  });

  test('a holon nobody speaks for keeps the plain record', async () => {
    const holo = make(adminSk);
    await holo.ready();
    plantGlobal(holo, strangerSk, { id: '-7', federated: ['-8'], lensConfig: {}, partnerNames: {} }, T0);
    expect((await holo.getFederation('-7')).federated).toEqual(['-8']);
  });
});

describe('capabilities: the vault follows the table', () => {
  let A, Ask, Apub, Bsk, Bpub, Msk, Mpub, Ssk;
  const LENS = 'quests';
  const scope = { holon: HOLON, lens: LENS };
  const spheres = [];
  afterAll(async () => { for (const s of spheres.splice(0)) { try { s.disableSigning(); } catch { /* ignore */ } try { await s.close(); } catch { /* closed */ } } });

  const plant = (holo, sk, lens, item, at) => {
    const evt = buildEvent({ holon: HOLON, lens, item, sk, created_at: at, extraTags: [['n', APP]] });
    holo.store.apply(evt, { origin: 'remote' });
    return evt;
  };
  const copyLens = (from, to, lens) => {
    for (const id of from.store.listEventIds(HOLON, lens)) for (const e of from.store.getEvents(HOLON, lens, id)) to.store.apply(e, { origin: 'remote' });
  };

  beforeAll(async () => {
    Ask = generateSecretKey(); Apub = getPublicKey(Ask);
    Bsk = generateSecretKey(); Bpub = getPublicKey(Bsk);
    Msk = generateSecretKey(); Mpub = getPublicKey(Msk);
    Ssk = generateSecretKey();
    A = new HoloSphere({ appName: APP, privateKey: Ask, store: { adapter: 'memory' } });
    spheres.push(A);
    await A.enableSigning({ relays: [], enforce: 'membership' });
    await A.foundHolon(HOLON, { at: T0 });
    await A.addMember(HOLON, Bpub, 'admin', { at: T0 + 1 });
    await A.addMember(HOLON, Mpub, 'member', { at: T0 + 2 });
    await A.put(HOLON, LENS, { id: 'q1', title: 'Water the trees' });
    await A.privacy.lock(scope);
  }, 30000);

  test('a stranger\'s or a member\'s tombstone does not make the lens public', async () => {
    expect(A.privacy.isPrivate(HOLON, LENS)).toBe(true);
    plant(A, Ssk, '_vault', { id: LENS, _deleted: true }, T0 + 100);
    expect(A.privacy.isPrivate(HOLON, LENS)).toBe(true);
    plant(A, Msk, '_vault', { id: LENS, _deleted: true }, T0 + 101);
    expect(A.privacy.isPrivate(HOLON, LENS)).toBe(true);
    expect(A.privacy.owned(scope)).toBe(true);
    expect(A.privacy.lockedScopes(HOLON)).toEqual({ [LENS]: { locked: true, items: [] } });
  });

  test('a stranger cannot lock a lens of the holon', async () => {
    plant(A, Ssk, '_vault', { id: 'library', enc: 'nip44', v: 2, kid: 'self', ct: 'xx' }, T0 + 50);
    expect(A.privacy.isPrivate(HOLON, 'library')).toBe(false);
  });

  test('an admin holding the key unlocks what another key locked; a member cannot', async () => {
    // B (admin) and M (member) each see the holon's log, the sealed lens and A's vault stub.
    const vaultEvent = A.store.getEvents(HOLON, '_vault', LENS).find((e) => e.pubkey === Apub);
    const vault = unsealSelf(JSON.parse(vaultEvent.content), Ask);
    const grant = { t: 'holons/grant', v: 2, holon: HOLON, lens: LENS, kid: vault.keys[0].kid, key: vault.keys[0].key, at: new Date().toISOString() };

    const M = new HoloSphere({ appName: APP, privateKey: Msk, store: { adapter: 'memory' } });
    spheres.push(M);
    await M.enableSigning({ relays: [], enforce: 'membership' });
    for (const lens of ['_members', LENS, '_vault']) copyLens(A, M, lens);
    expect((await M.privacy.acceptGrant(grant, Apub, { trusted: true })).accepted).toBe(true);
    expect(M.privacy.holdsKey(scope)).toBe(true);
    expect(M.privacy.canManage(scope)).toBe(false);
    await expect(M.privacy.unlock(scope)).rejects.toThrow(/only an admin/);

    const B = new HoloSphere({ appName: APP, privateKey: Bsk, store: { adapter: 'memory' } });
    spheres.push(B);
    await B.enableSigning({ relays: [], enforce: 'membership' });
    for (const lens of ['_members', LENS, '_vault']) copyLens(A, B, lens);
    expect(B.privacy.isPrivate(HOLON, LENS)).toBe(true);
    expect(B.privacy.owned(scope)).toBe(false);
    // Without the key an admin cannot rewrite the items in the clear: refused.
    await B.privacy.ensureKeys(HOLON, LENS);
    await expect(B.privacy.unlock(scope)).rejects.toThrow(/hold no key/);
    expect((await B.privacy.acceptGrant(grant, Apub, { trusted: true })).accepted).toBe(true);
    expect(B.privacy.canManage(scope)).toBe(true);
    const { rewritten } = await B.privacy.unlock(scope);
    expect(rewritten).toBe(1);
    expect(B.privacy.isPrivate(HOLON, LENS)).toBe(false);
    const q1 = B.store.getEvents(HOLON, LENS, 'q1').find((e) => e.pubkey === Bpub);
    expect(isSealed(JSON.parse(q1.content))).toBe(false);
    expect(JSON.parse(q1.content).title).toBe('Water the trees');

    // Back on A: the admin's tombstone retires A's own vault too.
    copyLens(B, A, '_vault');
    expect(A.privacy.isPrivate(HOLON, LENS)).toBe(false);
    expect(A.privacy.owned(scope)).toBe(false);
  }, 30000);
});
