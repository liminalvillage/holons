/**
 * enforce: 'authority' + roles — the money and trust fields of a holon's
 * settings come from an ADMIN's envelope. A plain member's settings write
 * still counts for every other field, so a shared record keeps working,
 * but nobody can seat themselves as admin, rewrite the split or redirect
 * the payout by writing last.
 */
import HoloSphere from '../holosphere.js';
import { buildEvent, generateSecretKey, getPublicKey } from '../nostr-events.js';
import { GUARDED_SETTINGS_FIELDS } from '../authority.js';

const APP = 'guarded-settings-test';
const HOLON = '-100700';

describe('signing: guarded settings fields', () => {
  const spheres = [];
  afterAll(async () => { for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } } });

  const adminSk = generateSecretKey();
  const adminPub = getPublicKey(adminSk);
  const memberSk = generateSecretKey();
  const memberPub = getPublicKey(memberSk);
  const roles = new Map([[adminPub, 'admin'], [memberPub, 'member']]);
  const authority = async () => {
    const p = (pub) => roles.has(pub);
    p.roleAt = (pub) => roles.get(pub) ?? null;
    return p;
  };
  const make = (sk) => {
    const s = new HoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' }, signing: { enforce: 'authority', authority } });
    spheres.push(s);
    return s;
  };
  const plant = (holo, sk, item, at) => {
    const evt = buildEvent({ holon: HOLON, lens: 'settings', item, sk, created_at: at, extraTags: [['n', APP]] });
    holo.store.apply(evt, { origin: 'remote' });
    return evt;
  };

  test('the guarded fields are the admin\'s, the rest is the newest member\'s', async () => {
    const holo = make(adminSk);
    await holo.ready();
    const t = Math.floor(Date.now() / 1000);
    plant(holo, adminSk, { id: HOLON, name: 'Grove', admin: '7', allocation: { interiorPercent: 50 }, payout: { address: '0xadmin' } }, t);
    // A member writes last: the split in their favour, themselves as admin, their wallet as payout.
    plant(holo, memberSk, { id: HOLON, name: 'Grove (renamed)', admin: '9', allocation: { interiorPercent: 100 }, payout: { address: '0xmember' }, pot: { address: '0xfake', chainId: 1 } }, t + 5);

    const got = await holo.get(HOLON, 'settings', HOLON);
    expect(got.name).toBe('Grove (renamed)');
    expect(got.admin).toBe('7');
    expect(got.allocation).toEqual({ interiorPercent: 50 });
    expect(got.payout).toEqual({ address: '0xadmin' });
    expect(got.pot).toBeUndefined(); // no admin ever wrote one
    const [all] = await holo.getAll(HOLON, 'settings');
    expect(all).toEqual(got);
  });

  test('a lens that is not settings is untouched, and so is a holon whose authority knows no roles', async () => {
    const holo = make(adminSk);
    await holo.ready();
    const t = Math.floor(Date.now() / 1000);
    const evt = buildEvent({ holon: HOLON, lens: 'tasks', item: { id: 't1', allocation: 'kept' }, sk: memberSk, created_at: t, extraTags: [['n', APP]] });
    holo.store.apply(evt, { origin: 'remote' });
    expect((await holo.get(HOLON, 'tasks', 't1')).allocation).toBe('kept');
    expect(GUARDED_SETTINGS_FIELDS).toContain('allocation');
  });
});
