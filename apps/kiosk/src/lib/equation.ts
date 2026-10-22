// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The holon's value equation, shared by every board that scores with it.
//
// One store, one read: the Status board, the Flows board and the editor all
// score from here, so they can never disagree about what the holon rewards.
//
// Nobody writes the equation. It is what the holon's votes decided:
// `@holons/core/governance` `foldEquation` lays every passed equation
// proposal over the base (`settings.valueEquation`, until the first pass) at
// the new moon its vote closed. The proposals are signed entries of the votes
// log, so this store folds live — the settings doc, the votes log and the
// roster — and folds again at the next close, when the equation moves on its
// own.

import { derived, writable, type Readable } from "svelte/store";
import {
  DEFAULT_EQUATION,
  migrateEquation,
  type ScoreEquation,
} from "@holons/core/scoring";
import { foldEquation, type GovernedEquation } from "@holons/core/governance";
import { getHolosphere, subscribeLens } from "$lib/holosphere";
import {
  foldVotesContext,
  loadVotesRoster,
  watchVotesLogs,
  type VotesLogs,
  type VotesRoster,
} from "$lib/governanceVotes";

const base = writable<unknown>(null);
const logs = writable<VotesLogs | null>(null);
const roster = writable<VotesRoster | null>(null);
const ready = writable(false);
/** Bumped at each close, so the fold re-runs when a vote ends. */
const tick = writable(Date.now());

let bound: string | null = null;
let offSettings: { unsubscribe: () => void } | undefined;
let offVotes: (() => void) | undefined;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

/** The whole picture: the equation in force and every proposal, judged now. */
export const governed: Readable<GovernedEquation> = derived(
  [base, logs, roster, tick],
  ([$base, $logs, $roster, $now]) => {
    const ctx =
      bound && $logs && $roster
        ? foldVotesContext(bound, $logs, $roster)
        : null;
    const memberIds = ($roster?.users ?? [])
      .map((u) => (u?.id == null ? "" : String(u.id)))
      .filter(Boolean);
    return foldEquation({
      base: $base,
      proposals: ctx?.folded.equations ?? [],
      ballots: ctx?.folded.ballots ?? {},
      memberIds,
      tally: { delegations: $roster?.delegations ?? {} },
      now: $now,
    });
  },
);

/** The holon's weights. Defaults until `equationReady` turns true. */
export const equation: Readable<ScoreEquation> = derived(governed, ($g) =>
  bound ? $g.equation : { ...DEFAULT_EQUATION },
);
/** False while the holon's own equation is still being read. */
export const equationReady: Readable<boolean> = { subscribe: ready.subscribe };

// Fold again the moment the next vote closes (a timeout, re-armed per fold).
governed.subscribe(($g) => {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  if ($g.nextCloseAt == null) return;
  // setTimeout caps at ~24.8 days; a moon can be further, so wake and re-arm.
  const wait = Math.min(
    Math.max($g.nextCloseAt - Date.now(), 0) + 1000,
    2 ** 31 - 1,
  );
  closeTimer = setTimeout(() => tick.set(Date.now()), wait);
});

/**
 * Point the store at a holon. Idempotent, so every view can call it on bind.
 *
 * There is deliberately no unbind: two boards and a settings sheet read this
 * at once, and a refcount that let the last one torn down cancel the
 * subscriptions would leave the others reading a frozen equation. They are
 * swapped when the holon changes and otherwise live as long as the session.
 */
export function bindEquation(holon: string | null): void {
  const id = holon ? String(holon) : null;
  if (id === bound) return;
  bound = id;
  offSettings?.unsubscribe();
  offSettings = undefined;
  offVotes?.();
  offVotes = undefined;
  ready.set(false);
  base.set(null);
  logs.set(null);
  roster.set(null);
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
    const doc = (await hs.get(id, "settings", id)) as Record<
      string,
      unknown
    > | null;
    if (bound !== id) return;
    base.set(migrateEquation(doc?.valueEquation ?? doc?.equation));
    roster.set(await loadVotesRoster(hs, id));
  } catch (err) {
    console.warn("[kiosk] equation: load failed", err);
  }
  if (bound !== id) return;
  ready.set(true);

  // Settings is a one-record lens, so watching it is cheap; the votes log is
  // what moves a tally. Both reach every board here live.
  offSettings = subscribeLens(hs, id, "settings", (items) => {
    if (bound !== id) return;
    const doc = (items as any[]).find((s) => String(s?.id ?? "") === id);
    const raw = doc?.valueEquation ?? doc?.equation;
    if (raw) base.set(migrateEquation(raw));
  });
  offVotes = watchVotesLogs(hs, id, (l) => {
    if (bound === id) logs.set(l);
  });
}
