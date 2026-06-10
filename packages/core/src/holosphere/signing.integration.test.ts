/**
 * Integration: HoloSphere signing (Phase 2 authorized read) exercised through
 * the real @holons/core factory, in the harvest runtime.
 *
 * Requires the local holosphere build (the repo links it via the root
 * pnpm override `holosphere: link:../holosphere`). Proves the signing API works
 * when consumed exactly the way the UIs consume it — `createHoloSphere(...)`.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateSecretKey, getPublicKey } from 'holosphere/nostr-events';
import { createHoloSphere } from './factory.js';

const HOLON = '89283082803ffff';
const LENS = 'tasks';

describe('holosphere signing — Phase 2 authorized read via @holons/core factory', () => {
  let sphere: any;
  let dir: string;
  let Apub: string;
  let Bpub: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-sign-'));
    const Ask = generateSecretKey();
    Apub = getPublicKey(Ask);
    Bpub = getPublicKey(generateSecretKey());

    sphere = createHoloSphere({
      appName: 'harvest-sign-test',
      privateKey: Ask,
      extra: {
        gunOptions: { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false },
      },
    });

    await sphere.enableSigning({ relays: [], enforce: true });
    await sphere.foundHolon(HOLON);                                             // A = genesis admin
    await sphere.put(HOLON, LENS, { id: 't1', title: 'authorized task' });      // signed by A
    await sphere.put(HOLON, LENS, { id: 't-forged', title: 'unsigned' }, null, { _skipSign: true }); // forgery
    await sphere.addMember(HOLON, Bpub, 'member');                              // signed membership op

    await new Promise((r) => setTimeout(r, 1500));
  }, 30000);

  afterAll(async () => {
    try { sphere?.disableSigning(); } catch { /* ignore */ }
    try { await sphere?.close?.(); } catch { /* ignore */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('enforce read returns only the authorized item', async () => {
    const view = await sphere.getAll(HOLON, LENS);
    expect(view.map((i: any) => i.id).sort()).toEqual(['t1']);
  });

  it('the unsigned forgery is hidden but retained in the raw store / pending', async () => {
    const pending = await sphere.getPending(HOLON, LENS);
    expect(pending.map((i: any) => i.id)).toContain('t-forged');

    const raw = await sphere.getAll(HOLON, LENS, null, { _skipAuthorize: true });
    expect(raw.map((i: any) => i.id).sort()).toEqual(['t-forged', 't1']);
  });

  it('membership log reflects founder + added member', async () => {
    const members = await sphere.getMembers(HOLON);
    expect(members.get(Apub)).toBe('admin');
    expect(members.get(Bpub)).toBe('member');
  });
});
