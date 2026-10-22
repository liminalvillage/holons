/**
 * Locking a lens seals what its owner SEES, not what the raw store holds:
 * a record enforcement hides (unsigned, or signed by a key the holon never
 * seated) must not be re-signed under the owner's key by the rewrite — that
 * would publish it as the owner's own and surface it everywhere.
 */
import HoloSphere from '../holosphere.js';
import { generateSecretKey, getPublicKey, buildEvent } from '../nostr-events.js';
import { isSealed } from '../store/sealed.js';

const HOLON = '89283082803ffff';
const LENS = 'quests';
const TS = 1700000000;
const ids = (arr) => arr.map((i) => i.id).sort();

describe('privacy: lock under enforced reads', () => {
  let sphere, Ask, Apub, Bsk;

  async function writeAs(sk, item, at) {
    const evt = buildEvent({ holon: HOLON, lens: LENS, item, sk, created_at: at });
    sphere.store.apply(evt, { origin: 'remote' });
  }

  beforeAll(async () => {
    Ask = generateSecretKey();
    Apub = getPublicKey(Ask);
    Bsk = generateSecretKey();
    sphere = new HoloSphere({ appName: 'privacy-lock-test', privateKey: Ask, store: { adapter: 'memory' } });
    await sphere.enableSigning({ relays: [], enforce: 'membership' });
    await sphere.foundHolon(HOLON, { at: TS });
    await writeAs(Ask, { id: 'mine', title: 'Owner task' }, TS + 1);
    await writeAs(Bsk, { id: 'stray', status: 'open' }, TS + 2);   // never seated: hidden, untitled
    await sphere.put(HOLON, LENS, { id: 'forged', title: 'forged' }, null, { _skipSign: true });
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch {}
    try { await sphere?.close?.(); } catch {}
  });

  test('before the lock the owner sees only what is authorized', async () => {
    expect(ids(await sphere.getAll(HOLON, LENS))).toEqual(['mine']);
  });

  test('the lock rewrites the authorized view only', async () => {
    const { rewritten } = await sphere.privacy.lock({ holon: HOLON, lens: LENS });
    expect(rewritten).toBe(1);
    const mine = sphere.store.getEvents(HOLON, LENS, 'mine');
    expect(mine[0].pubkey).toBe(Apub);
    expect(isSealed(JSON.parse(mine[0].content))).toBe(true);
    for (const id of ['stray', 'forged']) {
      expect(sphere.store.getEvents(HOLON, LENS, id).filter((e) => e.pubkey === Apub)).toHaveLength(0);
    }
    expect(ids(await sphere.getAll(HOLON, LENS))).toEqual(['mine']);
  });
});
