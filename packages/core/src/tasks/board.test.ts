// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { boardUrlOf, ensureTaskBoard, isBoardUrl, mintBoardUrl, type BoardStore } from './board.js';

/** Deterministic bytes: 0, 1, 2, … */
const counting = (n: number) => Uint8Array.from({ length: n }, (_, i) => i);
const URL0 = 'https://excalidraw.com/#room=00010203040506070809,AAECAwQFBgcICQoLDA0ODw';

function memory(initial: Record<string, Record<string, unknown>> = {}) {
  const rows = new Map(Object.entries(initial));
  const db: BoardStore = {
    get: async (key) => rows.get(key) ?? null,
    put: vi.fn(async (record) => {
      rows.set(String(record.id), record);
      return true;
    }),
  };
  return { db, rows };
}

describe('board links', () => {
  it('mints an excalidraw room: 20-hex id, 22-char base64url key', () => {
    expect(mintBoardUrl(counting)).toBe(URL0);
    const fresh = mintBoardUrl();
    expect(isBoardUrl(fresh)).toBe(true);
    expect(fresh).not.toBe(mintBoardUrl());
  });

  it('accepts nothing but that exact shape', () => {
    expect(isBoardUrl(URL0)).toBe(true);
    for (const bad of [
      'javascript:alert(1)',
      'https://evil.example/#room=00010203040506070809,AAECAwQFBgcICQoLDA0ODw',
      'http://excalidraw.com/#room=00010203040506070809,AAECAwQFBgcICQoLDA0ODw',
      'https://excalidraw.com/#room=0001020304050607080A,AAECAwQFBgcICQoLDA0ODw', // uppercase hex
      'https://excalidraw.com/#room=00010203040506070809,AAECAwQFBgcICQoLDA0OD', // 21-char key
      'https://excalidraw.com/#room=00010203040506070809,AAECAwQFBgcICQoLDA0ODw"><x',
      42,
      null,
    ]) expect(isBoardUrl(bad)).toBe(false);
    expect(boardUrlOf({ boardUrl: URL0 })).toBe(URL0);
    expect(boardUrlOf({ boardUrl: 'https://evil.example' })).toBeNull();
    expect(boardUrlOf(null)).toBeNull();
  });
});

describe('ensureTaskBoard', () => {
  it('mints once and keeps the rest of the task', async () => {
    const { db, rows } = memory({ q1: { id: 'q1', title: 'Plan the garden', participants: [{ id: 7 }] } });
    const first = await ensureTaskBoard(db, 'q1', { random: counting });
    expect(first).toEqual({ url: URL0, minted: true });
    expect(rows.get('q1')).toEqual({ id: 'q1', title: 'Plan the garden', participants: [{ id: 7 }], boardUrl: URL0 });

    const again = await ensureTaskBoard(db, 'q1');
    expect(again).toEqual({ url: URL0, minted: false });
    expect(db.put).toHaveBeenCalledTimes(1);
  });

  it('replaces a value that is not a board link', async () => {
    const { db } = memory({ q1: { id: 'q1', boardUrl: 'https://evil.example' } });
    expect(await ensureTaskBoard(db, 'q1', { random: counting })).toEqual({ url: URL0, minted: true });
  });

  it('gives null for a missing or deleted task, or a refused write', async () => {
    expect(await ensureTaskBoard(memory().db, 'q1')).toBeNull();
    expect(await ensureTaskBoard(memory({ q1: { id: 'q1', _deleted: true } }).db, 'q1')).toBeNull();
    const { db } = memory({ q1: { id: 'q1' } });
    db.put = async () => false;
    expect(await ensureTaskBoard(db, 'q1')).toBeNull();
  });

  it('two mints at once converge on the stored link', async () => {
    const { db, rows } = memory({ q1: { id: 'q1' } });
    const [a, b] = await Promise.all([ensureTaskBoard(db, 'q1'), ensureTaskBoard(db, 'q1')]);
    expect(a!.minted && b!.minted).toBe(true);
    const stored = rows.get('q1')!.boardUrl;
    expect([a!.url, b!.url]).toContain(stored);
    expect(await ensureTaskBoard(db, 'q1')).toEqual({ url: stored, minted: false });
  });
});
