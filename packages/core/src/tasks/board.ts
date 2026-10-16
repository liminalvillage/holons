// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A whiteboard per task: an excalidraw.com live collaboration room, minted
// once and stored on the task as `boardUrl`. Stored, not derived: a public
// holon has no shared secret to derive from, and a private task's URL is
// sealed with the rest of the record. The room key in the URL fragment is
// Excalidraw's end-to-end key — whoever can read the task can open the board.
//
// Every surface renders the link only through `boardUrlOf`, which accepts
// nothing but this exact shape, so a federated record cannot inject an
// arbitrary href.

import type { Quest } from './types.js';

export const BOARD_FIELD = 'boardUrl';
export const BOARD_ORIGIN = 'https://excalidraw.com';

/** 10-byte room id (20 hex), 16-byte AES-128 key as unpadded base64url (22 chars). */
const BOARD_RE = /^https:\/\/excalidraw\.com\/#room=[0-9a-f]{20},[A-Za-z0-9_-]{22}$/;
const ROOM_ID_BYTES = 10;
const ROOM_KEY_BYTES = 16;

export function isBoardUrl(value: unknown): value is string {
  return typeof value === 'string' && BOARD_RE.test(value);
}

/** The task's board link, or null when it has none (or something else sits there). */
export function boardUrlOf(quest: Pick<Quest, 'boardUrl'> | null | undefined): string | null {
  const v = quest?.boardUrl;
  return isBoardUrl(v) ? v : null;
}

const randomBytes = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh room link. `random` is injectable for tests. */
export function mintBoardUrl(random: (n: number) => Uint8Array = randomBytes): string {
  const room = Array.from(random(ROOM_ID_BYTES), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${BOARD_ORIGIN}/#room=${room},${base64url(random(ROOM_KEY_BYTES))}`;
}

/** Reads and writes the task's own lens in its HOME holon (see `taskRef`). */
export interface BoardStore {
  get(key: string): Promise<unknown>;
  put(record: Record<string, unknown>): Promise<unknown>;
}

/**
 * The task's board link, minting and storing one if it has none. Reads the
 * record fresh so a link someone else already made is reused; two people
 * minting at the same instant converge on whichever write wins. Null when
 * the task is missing or the write was refused.
 */
export async function ensureTaskBoard(
  db: BoardStore,
  key: string,
  opts: { random?: (n: number) => Uint8Array } = {},
): Promise<{ url: string; minted: boolean } | null> {
  const current = (await db.get(key)) as Record<string, unknown> | null;
  if (!current || typeof current !== 'object' || current._deleted) return null;
  const existing = boardUrlOf(current as Pick<Quest, 'boardUrl'>);
  if (existing) return { url: existing, minted: false };
  const url = mintBoardUrl(opts.random);
  const ok = await db.put({ ...current, id: current.id ?? key, [BOARD_FIELD]: url });
  if (ok === false) return null;
  return { url, minted: true };
}
