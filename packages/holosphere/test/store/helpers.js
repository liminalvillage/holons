// Shared helpers for the store test suites: signed kind-30078 events in the
// same shape the relay transport publishes (h/l/d + the `n` namespace tag).
import { buildEvent, generateSecretKey, getPublicKey } from '../../nostr-events.js';

export const APP = 'store-test';

export function keypair() {
    const sk = generateSecretKey();
    return { sk, pk: getPublicKey(sk) };
}

export function signed({ holon = 'h1', lens = 'tasks', item, sk, created_at, app = APP }) {
    return buildEvent({
        holon: holon === null ? '_g' : holon,
        lens,
        item,
        sk,
        created_at,
        extraTags: [['n', app]],
    });
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
