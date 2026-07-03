// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Behavioural-parity regression tests for the pluggable-backend refactor.
// These drive the low-level ops with a fully faked holoInstance/backend so
// they are deterministic and do not depend on a live Gun mesh (unlike the
// integration suites, which need radisk/SEA and fail headless).
//
// Covered:
//   1. putNode fires hologram tracking only on a *confirmed* write — never on
//      a queued/offline write — matching the original `!ack.err` guard.
//   2. putNode honours the opaque string-KV contract: strings pass through
//      verbatim; objects are JSON-encoded.
//   3. deleteAllGlobal's password path must not resolve at its 5s safety-net
//      timeout while a real deletion is still in flight (base guarded the
//      timeout on "nothing found yet"; a naive unconditional resolve regresses).

import { jest } from '@jest/globals';
import { putNode } from '../node.js';
import { deleteAllGlobal } from '../global.js';

// Flush pending microtasks (await chains) without advancing fake timers.
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

// ---------------------------------------------------------------------------
// putNode
// ---------------------------------------------------------------------------

function makePutNodeHolo(putResult) {
  const trackCalls = [];
  const putCalls = [];
  const holo = {
    appname: 'test-app',
    isHologram: (v) => !!(v && typeof v === 'object' && typeof v.soul === 'string'),
    parseSoulPath: (soul) => (soul ? { soul } : null),
    _backend: {
      put: async (holon, lens, key, payload) => {
        putCalls.push({ holon, lens, key, payload });
        return putResult;
      },
      getNodeRef: (soul) => ({
        get: (holograms) => ({
          get: (instanceSoul) => ({
            put: (v) => trackCalls.push({ soul, holograms, instanceSoul, v }),
          }),
        }),
      }),
    },
  };
  return { holo, trackCalls, putCalls };
}

describe('putNode — backend write parity', () => {
  const hologramValue = { soul: 'test-app/a/b/c', payload: 1 };

  test('fires hologram tracking on a confirmed write (queued:false)', async () => {
    const { holo, trackCalls } = makePutNodeHolo({ ok: true, queued: false });
    const ok = await putNode(holo, 'h', 'l', { id: 'x', value: hologramValue });
    expect(ok).toBe(true);
    expect(trackCalls).toHaveLength(1);
    expect(trackCalls[0].holograms).toBe('_holograms');
    expect(trackCalls[0].instanceSoul).toBe('test-app/h/l/value');
    expect(trackCalls[0].v).toBe(true);
  });

  test('does NOT fire hologram tracking on a queued write (queued:true)', async () => {
    const { holo, trackCalls } = makePutNodeHolo({ ok: true, queued: true });
    const ok = await putNode(holo, 'h', 'l', { id: 'x', value: hologramValue });
    expect(ok).toBe(true);
    expect(trackCalls).toHaveLength(0); // regression guard for the queued-write path
  });

  test('throws and does not track when the backend write fails (ok:false)', async () => {
    const { holo, trackCalls } = makePutNodeHolo({ ok: false, queued: false });
    await expect(putNode(holo, 'h', 'l', { id: 'x', value: hologramValue }))
      .rejects.toThrow('Backend write failed');
    expect(trackCalls).toHaveLength(0);
  });

  test('stores a string value verbatim (no double-encoding)', async () => {
    const { holo, putCalls } = makePutNodeHolo({ ok: true, queued: false });
    await putNode(holo, 'h', 'l', { id: 'x', value: 'already-a-string' });
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].key).toBe('value');
    expect(putCalls[0].payload).toBe('already-a-string');
  });

  test('JSON-encodes an object value for the opaque string-KV contract', async () => {
    const { holo, putCalls } = makePutNodeHolo({ ok: true, queued: false });
    const obj = { foo: 'bar', n: 2 };
    await putNode(holo, 'h', 'l', { id: 'x', value: obj });
    expect(putCalls[0].payload).toBe(JSON.stringify(obj));
  });
});

// ---------------------------------------------------------------------------
// deleteAllGlobal — password path 5s safety-net timeout
// ---------------------------------------------------------------------------

function baseHolo(userFactory) {
  return {
    appname: 'test-app',
    userName: (t) => `user-${t}`,
    isHologram: () => false,
    parseSoulPath: () => null,
    getNodeRef: () => ({ get: () => ({ get: () => ({ put: () => {} }) }) }),
    _backend: { gun: { user: userFactory } },
  };
}

describe('deleteAllGlobal — password-path 5s safety-net timeout', () => {
  afterEach(() => jest.useRealTimers());

  test('does not resolve prematurely while a real deletion is in flight', async () => {
    jest.useFakeTimers();

    const deleteAcks = [];
    const tableData = { item1: JSON.stringify({ x: 1 }), item2: JSON.stringify({ y: 2 }), _: {} };
    const itemNode = (key) => ({
      once: (res) => res(tableData[key]),
      put: (_val, cb) => { if (cb) deleteAcks.push(cb); }, // hold the ack — slow delete
    });
    const dataPath = { once: (h) => h(tableData), get: (k) => itemNode(k), put: () => {} };
    const holo = baseHolo(() => ({
      auth: (_n, _p, cb) => cb({}),
      get: () => ({ get: () => dataPath }),
    }));

    let settled = false;
    const p = deleteAllGlobal(holo, 'tbl', 'pw').then((v) => { settled = true; return v; });

    // Auth + once() handler run: started=true, both deletes registered + pending.
    await flush();
    expect(deleteAcks).toHaveLength(2);

    // Fire the 5s safety-net. Because processing started, it must NOT resolve.
    await jest.advanceTimersByTimeAsync(6000);
    expect(settled).toBe(false); // regression guard: base's unconditional resolve would settle here

    // Let the deletes ack → real completion resolves true.
    deleteAcks.forEach((cb) => cb({}));
    await flush();
    await expect(p).resolves.toBe(true);
    expect(settled).toBe(true);
  });

  test('resolves true after the timeout when nothing was found (empty/offline)', async () => {
    jest.useFakeTimers();

    // once() never delivers → handler never runs → started stays false.
    const dataPath = { once: () => {}, get: () => ({ once: () => {}, put: () => {} }), put: () => {} };
    const holo = baseHolo(() => ({
      auth: (_n, _p, cb) => cb({}),
      get: () => ({ get: () => dataPath }),
    }));

    let settled = false;
    const p = deleteAllGlobal(holo, 'tbl', 'pw').then((v) => { settled = true; return v; });

    await flush();
    expect(settled).toBe(false); // still pending before the timeout
    await jest.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe(true); // safety-net fired because nothing started
  });
});
