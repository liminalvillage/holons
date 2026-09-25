import {
    isSealed, kidOf, generateKey, selfKey, wrapCek, unwrapCek, cekOf,
    sealItem, unsealItem, sealSelf, unsealSelf, lockedStub, isLocked, SELF_KID, MAX_CT_BYTES,
} from '../../store/sealed.js';
import { generateSecretKey } from '../../nostr-events.js';

describe('store/sealed: NIP-44 envelope encryption', () => {
    const lensKey = generateKey();
    const cek = generateKey();
    const item = { id: 'q1', title: 'secret plan', done: false };

    test('sealItem hides the item; unsealItem opens it with the lens key or the content key', () => {
        const sealed = sealItem(item, { cek, lensKey });
        expect(isSealed(sealed)).toBe(true);
        expect(sealed.kid).toBe(kidOf(lensKey));
        expect(JSON.stringify(sealed)).not.toContain('secret plan');
        expect(JSON.stringify(sealed)).not.toContain('"id"');
        expect(unsealItem(sealed, { lensKey })).toEqual(item);
        expect(unsealItem(sealed, { cek })).toEqual(item);
        expect(cekOf(sealed, lensKey)).toEqual(cek);
    });

    test('a wrong lens key or content key fails the MAC', () => {
        const sealed = sealItem(item, { cek, lensKey });
        expect(() => unsealItem(sealed, { lensKey: generateKey() })).toThrow();
        expect(() => unsealItem(sealed, { cek: generateKey() })).toThrow();
        expect(() => unsealItem(sealed, {})).toThrow(/lens key or content key/);
    });

    test('a reused wrap keeps the content key so an item grant survives an edit', () => {
        const first = sealItem(item, { cek, lensKey });
        const edited = sealItem({ ...item, done: true }, { cek, kid: first.kid, k: first.k });
        expect(edited.k).toBe(first.k);
        expect(unsealItem(edited, { cek })).toEqual({ ...item, done: true });
        expect(unsealItem(edited, { lensKey })).toEqual({ ...item, done: true });
    });

    test('kid is a self-certifying sha256 prefix of the lens key', () => {
        expect(kidOf(lensKey)).toMatch(/^[0-9a-f]{16}$/);
        expect(kidOf(lensKey)).toBe(kidOf(lensKey));
        expect(kidOf(generateKey())).not.toBe(kidOf(lensKey));
    });

    test('isSealed rejects plaintext items and anything carrying an id', () => {
        expect(isSealed(item)).toBe(false);
        expect(isSealed({ enc: 'nip44', v: 1, kid: 'abc', ct: 'x', id: 'q1' })).toBe(false);
        expect(isSealed({ enc: 'nip44', v: 2, kid: 'abc', ct: 'x' })).toBe(false);
        expect(isSealed(null)).toBe(false);
        expect(isSealed([])).toBe(false);
    });

    test('wrapCek/unwrapCek round-trip', () => {
        expect(unwrapCek(wrapCek(cek, lensKey), lensKey)).toEqual(cek);
    });

    test('sealSelf/unsealSelf: only the same secret key opens a vault record', () => {
        const sk = generateSecretKey();
        const other = generateSecretKey();
        const vault = { id: 'lens:quests', keys: [{ kid: 'a', key: 'b' }] };
        const sealed = sealSelf(vault, sk);
        expect(sealed.kid).toBe(SELF_KID);
        expect(sealed.k).toBeUndefined();
        expect(isSealed(sealed)).toBe(true);
        expect(unsealSelf(sealed, sk)).toEqual(vault);
        expect(() => unsealSelf(sealed, other)).toThrow();
        expect(selfKey(sk)).toEqual(selfKey(sk));
        expect(selfKey(sk)).not.toEqual(selfKey(other));
    });

    test('oversized content is refused', () => {
        const big = { id: 'b', blob: 'x'.repeat(MAX_CT_BYTES) };
        expect(() => sealItem(big, { cek, lensKey })).toThrow(/limit/);
    });

    test('lockedStub carries the id and kid, and isLocked recognises it', () => {
        const sealed = sealItem(item, { cek, lensKey });
        const stub = lockedStub('q1', sealed);
        expect(stub).toEqual({ id: 'q1', _locked: true, _kid: sealed.kid });
        expect(isLocked(stub)).toBe(true);
        expect(isLocked(item)).toBe(false);
    });
});
