import {
    isSealed, kidOf, generateKey, selfKey,
    sealItem, unsealItem, sealSelf, unsealSelf, lockedStub, isLocked, SELF_KID, MAX_CT_BYTES,
} from '../../store/sealed.js';
import { generateSecretKey } from '../../nostr-events.js';

describe('store/sealed: one key per scope', () => {
    const key = generateKey();
    const item = { id: 'q1', title: 'secret plan', done: false };

    test('sealItem hides the item; unsealItem opens it with the scope key', () => {
        const sealed = sealItem(item, key);
        expect(isSealed(sealed)).toBe(true);
        expect(sealed).toEqual({ enc: 'nip44', v: 2, kid: kidOf(key), ct: expect.any(String) });
        expect(JSON.stringify(sealed)).not.toContain('secret plan');
        expect(JSON.stringify(sealed)).not.toContain('"id"');
        expect(unsealItem(sealed, key)).toEqual(item);
    });

    test('a wrong key fails the MAC; a missing key is refused', () => {
        const sealed = sealItem(item, key);
        expect(() => unsealItem(sealed, generateKey())).toThrow();
        expect(() => unsealItem(sealed, null)).toThrow(/scope key/);
        expect(() => sealItem(item, null)).toThrow(/scope key/);
    });

    test('kid is a self-certifying sha256 prefix of the key', () => {
        expect(kidOf(key)).toMatch(/^[0-9a-f]{16}$/);
        expect(kidOf(key)).toBe(kidOf(key));
        expect(kidOf(generateKey())).not.toBe(kidOf(key));
    });

    test('isSealed rejects plaintext items, the old envelope version and anything carrying an id', () => {
        expect(isSealed(item)).toBe(false);
        expect(isSealed({ enc: 'nip44', v: 2, kid: 'abc', ct: 'x', id: 'q1' })).toBe(false);
        expect(isSealed({ enc: 'nip44', v: 1, kid: 'abc', ct: 'x', k: 'y' })).toBe(false);
        expect(isSealed(null)).toBe(false);
        expect(isSealed([])).toBe(false);
    });

    test('sealSelf/unsealSelf: only the same secret key opens a vault record', () => {
        const sk = generateSecretKey();
        const other = generateSecretKey();
        const vault = { id: 'quests', keys: [{ kid: 'a', key: 'b' }] };
        const sealed = sealSelf(vault, sk);
        expect(sealed.kid).toBe(SELF_KID);
        expect(isSealed(sealed)).toBe(true);
        expect(unsealSelf(sealed, sk)).toEqual(vault);
        expect(() => unsealSelf(sealed, other)).toThrow();
        expect(selfKey(sk)).toEqual(selfKey(sk));
        expect(selfKey(sk)).not.toEqual(selfKey(other));
    });

    test('oversized content is refused', () => {
        const big = { id: 'b', blob: 'x'.repeat(MAX_CT_BYTES) };
        expect(() => sealItem(big, key)).toThrow(/limit/);
    });

    test('lockedStub carries the id and kid, and isLocked recognises it', () => {
        const sealed = sealItem(item, key);
        const stub = lockedStub('q1', sealed);
        expect(stub).toEqual({ id: 'q1', _locked: true, _kid: sealed.kid });
        expect(isLocked(stub)).toBe(true);
        expect(isLocked(item)).toBe(false);
    });
});
