// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Where a person stands on a holon's walk, kept per device: the walk itself
// is core's (`@holons/core/dna` walk), this only remembers its state under
// `dna-walk:<holon>`. Every access is guarded: storage can be missing,
// full or blocked (private window, cleared site data), and the walk must
// work without it — it then starts from nothing on the next visit.

import { emptyWalkState, normalizeWalkState, type WalkState } from '@holons/core/dna';

/** The slice of `Storage` this needs; a plain object stands in for it in specs. */
export interface WalkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const walkKey = (holon: string): string => `dna-walk:${holon}`;

function defaultStorage(): WalkStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** What this device remembers of the person's walk through `holon`; a fresh walk when nothing usable. */
export function loadWalk(holon: string, storage: WalkStorage | null = defaultStorage()): WalkState {
  try {
    const raw = storage?.getItem(walkKey(holon));
    return raw ? normalizeWalkState(JSON.parse(raw)) : emptyWalkState();
  } catch {
    return emptyWalkState();
  }
}

/** Remember the walk. A walk with nothing acknowledged forgets the key. Never throws. */
export function saveWalk(holon: string, state: WalkState, storage: WalkStorage | null = defaultStorage()): void {
  try {
    if (!storage) return;
    if (Object.keys(state.acks).length === 0) storage.removeItem(walkKey(holon));
    else storage.setItem(walkKey(holon), JSON.stringify(state));
  } catch {
    /* blocked or full: the walk lives in memory for this visit */
  }
}
