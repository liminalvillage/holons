// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Edit forms save themselves. There is no Save button to forget: a change is
// written after a short quiet spell, a burst of typing is one put, and closing
// the form writes whatever is still waiting. Only an on-chain write keeps its
// explicit button — that one costs gas and a signature, so it stays a decision.
//
// The payload is built the moment a write is due, not when it runs, so a form
// that is torn down right after `flush()` still sends what was on screen.
// Writes go out one after another, never two at once, so the last edit is the
// one that lands.

import { writable, type Readable } from "svelte/store";

export type AutosaveState = "idle" | "saving" | "saved" | "error";

/** A burst of edits inside this window becomes one write. */
const WRITE_DELAY_MS = 700;
/** How long "saved" stays on screen before the form goes quiet again. */
const SAVED_FOR_MS = 2000;

export interface Autosaver extends Readable<AutosaveState> {
  /**
   * Feed the form's current value as a key (any string that changes when the
   * form does), or null while no form is open. The first key after null is
   * the baseline — opening a form saves nothing; every later change schedules
   * a write.
   */
  watch(key: string | null): void;
  /** Mark the form changed: a write follows after a quiet spell. */
  touch(): void;
  /** Write anything still waiting now; resolves once every write landed. */
  flush(): Promise<boolean>;
  /** Forget the waiting write (the form is gone and nothing should land). */
  cancel(): void;
  /** Send the write that failed again (or whatever newer is waiting). */
  retry(): Promise<boolean>;
}

export interface AutosaveOptions {
  delay?: number;
  savedFor?: number;
}

/**
 * `build` turns the form into the record to write (null = nothing valid to
 * save yet, e.g. an empty title); `put` writes it and says whether it landed.
 */
export function createAutosave<T>(
  build: () => T | null | undefined,
  put: (value: T) => Promise<boolean>,
  opts: AutosaveOptions = {},
): Autosaver {
  const delay = opts.delay ?? WRITE_DELAY_MS;
  const savedFor = opts.savedFor ?? SAVED_FOR_MS;
  const state = writable<AutosaveState>("idle");

  let lastKey: string | null = null;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<boolean> = Promise.resolve(true);
  let inFlight = 0;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  /** The last write that did not land, kept for `retry`. */
  let failed: { value: T } | null = null;

  function send(value: T): Promise<boolean> {
    failed = null;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = null;
    state.set("saving");
    inFlight++;
    chain = chain.then(async () => {
      let ok = false;
      try {
        ok = await put(value);
      } catch (err) {
        console.error("[kiosk] autosave failed", err);
      }
      inFlight--;
      if (!ok) failed = { value };
      if (inFlight === 0 && !pending) {
        state.set(ok ? "saved" : "error");
        if (ok)
          savedTimer = setTimeout(() => {
            savedTimer = null;
            state.set("idle");
          }, savedFor);
      }
      return ok;
    });
    return chain;
  }

  function run(): Promise<boolean> {
    clearTimer();
    if (!pending) return chain;
    pending = false;
    const value = build();
    if (value == null) return chain;
    return send(value);
  }

  function touch() {
    pending = true;
    clearTimer();
    timer = setTimeout(() => void run(), delay);
  }

  return {
    subscribe: state.subscribe,
    watch(key) {
      if (key === null) {
        lastKey = null;
        return;
      }
      if (lastKey === null) {
        lastKey = key;
        return;
      }
      if (key === lastKey) return;
      lastKey = key;
      touch();
    },
    touch,
    flush: run,
    cancel() {
      clearTimer();
      pending = false;
    },
    retry() {
      if (pending || !failed) return run();
      return send(failed.value);
    },
  };
}
