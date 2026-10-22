// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The holon's value equation, shared by every board that scores with it.
//
// It used to be read once per surface: the Status board on bind, the Flows
// board separately, and the editor kept a third copy of its own. So retuning a
// weight moved nothing on the board behind the sheet — the numbers only caught
// up when the view was rebuilt — and two boards could disagree about what the
// holon rewards. One store, one read, one write.
//
// Edits are optimistic: the store moves on the tap, so every board re-scores at
// once, while the write itself is coalesced — holding `+` costs one put, not
// twenty. A settings echo is ignored while a local edit is still unflushed, so
// the relay cannot snap a weight back from under the finger moving it.

import { get, writable, type Readable } from "svelte/store";
import {
  DEFAULT_EQUATION,
  loadEquation,
  migrateEquation,
  saveEquation,
  type ScoreEquation,
} from "@holons/core/scoring";
import { getHolosphere, subscribeLens } from "$lib/holosphere";

export type EquationSaveState = "idle" | "saving" | "saved";

/** A burst of taps inside this window becomes one write. */
const WRITE_DELAY_MS = 700;
/** How long "saved" stays on screen before the editor goes quiet again. */
const SAVED_FOR_MS = 2000;

const current = writable<ScoreEquation>({ ...DEFAULT_EQUATION });
const ready = writable(false);
const saving = writable<EquationSaveState>("idle");

/** The holon's weights. Defaults until `equationReady` turns true. */
export const equation: Readable<ScoreEquation> = {
  subscribe: current.subscribe,
};
/** False while the holon's own equation is still being read. */
export const equationReady: Readable<boolean> = { subscribe: ready.subscribe };
/** What the editor should say about the write in flight. */
export const equationSaveState: Readable<EquationSaveState> = {
  subscribe: saving.subscribe,
};

let bound: string | null = null;
let sub: { unsubscribe: () => void } | undefined;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let savedTimer: ReturnType<typeof setTimeout> | null = null;
/** True from the first tap until the coalesced write lands. */
let unflushed = false;

/**
 * Point the store at a holon. Idempotent, so every view can call it on bind.
 *
 * There is deliberately no unbind: two boards and a settings sheet read this
 * at once, and a refcount that let the last one torn down cancel the
 * subscription would leave the others reading a frozen equation. The single
 * settings subscription is swapped when the holon changes and otherwise lives
 * as long as the session.
 */
export function bindEquation(holon: string | null): void {
  const id = holon ? String(holon) : null;
  if (id === bound) return;
  bound = id;
  sub?.unsubscribe();
  sub = undefined;
  cancelWrite();
  ready.set(false);
  current.set({ ...DEFAULT_EQUATION });
  if (!id) return;
  void attach(id);
}

async function attach(id: string): Promise<void> {
  let hs;
  try {
    hs = await getHolosphere();
  } catch (err) {
    console.warn("[kiosk] equation: could not connect", err);
    return;
  }
  if (bound !== id) return; // the holon changed while we were connecting

  try {
    const eq = await loadEquation(hs, id);
    if (bound !== id) return;
    if (!unflushed) current.set(clone(eq));
  } catch (err) {
    console.warn("[kiosk] equation: load failed", err);
  }
  if (bound !== id) return;
  ready.set(true);

  // Settings is a one-record lens, so watching it is cheap. This is what makes
  // an edit on another device — or in the bot — reach the board here.
  sub = subscribeLens(hs, id, "settings", (items) => {
    if (bound !== id || unflushed) return;
    const doc = (items as any[]).find((s) => String(s?.id ?? "") === id);
    const raw = doc?.valueEquation ?? doc?.equation;
    if (raw) current.set(migrateEquation(raw));
  });
}

/**
 * Take an edited equation: show it everywhere now, write it shortly.
 *
 * The store is set synchronously so the boards re-score on the tap; the put is
 * debounced, and `unflushed` keeps the settings echo from fighting the edit
 * until it lands.
 */
export function editEquation(next: ScoreEquation): void {
  current.set(clone(next));
  unflushed = true;
  saving.set("saving");
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => void flush(), WRITE_DELAY_MS);
}

async function flush(): Promise<void> {
  writeTimer = null;
  const id = bound;
  if (!id) {
    unflushed = false;
    saving.set("idle");
    return;
  }
  const snapshot = get(current);
  try {
    const hs = await getHolosphere();
    await saveEquation(hs, id, snapshot);
    if (bound !== id) return;
    saving.set("saved");
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => saving.set("idle"), SAVED_FOR_MS);
  } catch (err) {
    console.error("[kiosk] equation: save failed", err);
    saving.set("idle");
  } finally {
    // Only the last write in a burst clears the flag; an edit made while this
    // one was in flight has already armed another timer.
    if (!writeTimer) unflushed = false;
  }
}

function cancelWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  if (savedTimer) clearTimeout(savedTimer);
  writeTimer = null;
  savedTimer = null;
  unflushed = false;
  saving.set("idle");
}

function clone(eq: ScoreEquation): ScoreEquation {
  return { ...eq, currencies: { ...(eq.currencies ?? {}) } };
}
