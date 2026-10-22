/**
 * A grant is only as good as who sent it: keys arrive from the holon's
 * anchor or a member, never from a stranger; a scope this identity owns
 * takes no foreign key; and a stranger cannot overwrite a sealed card in the
 * clear. Local-only (events are moved between stores by hand).
 */
import HoloSphere from '../holosphere.js';
import { generateSecretKey, getPublicKey } from '../nostr-events.js';
import { generateKey, kidOf } from '../store/sealed.js';
import { bytesToHex } from '@noble/hashes/utils';

const APP = 'grant-policy-test';
const H = '-100800';

describe('privacy: grant policy', () => {
  const spheres = [];
  afterAll(async () => { for (const s of spheres.splice(0)) { try { await s.close(); } catch { /* closed */ } } });
  const make = (sk) => { const s = new HoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } }); spheres.push(s); return s; };
  const copyLens = (from, to, holon, lens) => {
    for (const id of from.store.listEventIds(holon, lens)) for (const e of from.store.getEvents(holon, lens, id)) to.store.apply(e, { origin: 'remote' });
  };
  /** The owner's current key of a scope, as a grant payload. */
  const grantOf = async (owner, scope) => {
    await owner.privacy.ensureKeys(scope.holon, scope.lens);
    const v = owner.privacy._debug();
    const prefix = `${scope.holon}|${scope.lens}|${scope.item ?? ''}|`;
    const kid = v.keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).pop();
    // The vault record holds the hex key; read it back through the owner's own store.
    const vaultId = scope.item ? `${scope.lens}/${scope.item}` : scope.lens;
    const rec = owner.store.get(scope.holon, '_vault', vaultId);
    const { unsealSelf } = await import('../store/sealed.js');
    const vault = unsealSelf(JSON.parse(owner.store.events.get(rec.eventId).content), owner._privateKey);
    const key = vault.keys.find((k) => k.kid === kid).key;
    return { t: 'holons/grant', v: 2, holon: scope.holon, lens: scope.lens, ...(scope.item ? { item: scope.item } : {}), kid, key, at: new Date().toISOString() };
  };

  test('accepted from the anchor or a member, refused from a stranger or without a sender', async () => {
    const ownerSk = generateSecretKey(), ownerPub = getPublicKey(ownerSk);
    const memberSk = generateSecretKey(), memberPub = getPublicKey(memberSk);
    const strangerPub = getPublicKey(generateSecretKey());
    const owner = make(ownerSk); await owner.ready();
    const partner = make(generateSecretKey()); await partner.ready();
    await owner.foundHolon(H);
    await owner.addMember(H, memberPub);
    await owner.privacy.lock({ holon: H, lens: 'quests' });
    await owner.put(H, 'quests', { id: 'q1', title: 'alpha' });
    copyLens(owner, partner, H, '_members');
    copyLens(owner, partner, H, '_vault');
    copyLens(owner, partner, H, 'quests');
    const payload = await grantOf(owner, { holon: H, lens: 'quests' });

    expect(await partner.privacy.acceptGrant(payload, strangerPub)).toMatchObject({ accepted: false, reason: 'sender does not speak for the holon' });
    expect(await partner.privacy.acceptGrant(payload, null)).toMatchObject({ accepted: false, reason: 'no sender' });
    expect(await partner.getAll(H, 'quests')).toEqual([]);
    expect(await partner.privacy.acceptGrant(payload, memberPub)).toMatchObject({ accepted: true, kid: payload.kid });
    expect((await partner.getAll(H, 'quests')).map((q) => q.title)).toEqual(['alpha']);

    // A pasted grant the user chose to trust skips the policy.
    const other = make(generateSecretKey()); await other.ready();
    copyLens(owner, other, H, '_vault');
    copyLens(owner, other, H, 'quests');
    expect(await other.privacy.acceptGrant(payload, null, { trusted: true })).toMatchObject({ accepted: true });
    expect((await other.getAll(H, 'quests')).map((q) => q.title)).toEqual(['alpha']);

    // A personal holon: its key is the sender that counts, no log needed.
    const meSk = generateSecretKey(), mePub = getPublicKey(meSk);
    const me = make(meSk); await me.ready();
    await me.privacy.lock({ holon: mePub, lens: 'notes' });
    await me.put(mePub, 'notes', { id: 'n1', title: 'private note' });
    const friend = make(generateSecretKey()); await friend.ready();
    copyLens(me, friend, mePub, '_vault');
    copyLens(me, friend, mePub, 'notes');
    const npayload = await grantOf(me, { holon: mePub, lens: 'notes' });
    expect(await friend.privacy.acceptGrant(npayload, ownerPub)).toMatchObject({ accepted: false });
    expect(await friend.privacy.acceptGrant(npayload, mePub)).toMatchObject({ accepted: true });
    expect((await friend.getAll(mePub, 'notes')).map((n) => n.title)).toEqual(['private note']);
  });

  test('a scope this identity owns takes no foreign key', async () => {
    const ownerSk = generateSecretKey(), ownerPub = getPublicKey(ownerSk);
    const owner = make(ownerSk); await owner.ready();
    await owner.privacy.lock({ holon: ownerPub, lens: 'quests' });
    const foreign = generateKey();
    const payload = { t: 'holons/grant', v: 2, holon: ownerPub, lens: 'quests', kid: kidOf(foreign), key: bytesToHex(foreign), at: new Date().toISOString() };
    expect(await owner.privacy.acceptGrant(payload, ownerPub)).toMatchObject({ accepted: false, reason: 'own scope' });
    expect(owner.privacy._debug().keys).not.toContain(`${ownerPub}|quests||${kidOf(foreign)}`);
  });

  test('a stranger cannot write a locked card in the clear, but may write a public one', async () => {
    const ownerSk = generateSecretKey();
    const owner = make(ownerSk); await owner.ready();
    await owner.foundHolon(H);
    await owner.put(H, 'quests', { id: 'q1', title: 'alpha' });
    await owner.put(H, 'quests', { id: 'q2', title: 'beta' });
    await owner.privacy.lock({ holon: H, lens: 'quests', item: 'q1' });

    const stranger = make(generateSecretKey()); await stranger.ready();
    copyLens(owner, stranger, H, '_vault');
    copyLens(owner, stranger, H, 'quests');
    expect(stranger.isPrivate(H, 'quests', 'q1')).toBe(true);
    await expect(stranger.put(H, 'quests', { id: 'q1', title: 'overwrite' })).rejects.toThrow(/no key for/);
    await stranger.put(H, 'quests', { id: 'q2', title: 'beta edit' });
    expect(stranger.store.getEvents(H, 'quests', 'q2').some((e) => e.content.includes('beta edit'))).toBe(true);
  });
});
