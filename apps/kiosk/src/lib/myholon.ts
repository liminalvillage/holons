// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How many tasks and events are still open in the signed-in person's own
// holon — the red badge on their face in the header and on the "My holon"
// link in the account menu. Followed live whichever board is on screen, so
// the person sees their own pile from anywhere. Which quests count is core's
// (`countOpenQuests`, the task wall's rule); this module only keeps it fed.

import { writable } from "svelte/store";
import { countOpenQuests, type Quest } from "@holons/core/tasks";
import type { HoloSphere } from "holosphere";
import { getHolosphere } from "./holosphere";

/** Open tasks + events in the person's own holon; 0 when signed out. */
export const myHolonOpen = writable<number>(0);

type Host = Pick<HoloSphere, "subscribeFederated">;

export interface OpenCountOptions {
  /** Re-count this often, so an event that just ended drops off. */
  intervalMs?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * Keep `onCount` fed with `holon`'s open count: after every emission of its
 * quests (its own records and the holograms it holds — not its partners'),
 * and on a slow tick. Returns a stop function that drops both.
 */
export function watchOpenCount(
  hs: Host,
  holon: string,
  onCount: (n: number) => void,
  opts: OpenCountOptions = {},
): () => void {
  const now = opts.now ?? (() => new Date());
  let items: Quest[] = [];
  let last = -1;
  const recount = () => {
    const n = countOpenQuests(items, now());
    if (n !== last) {
      last = n;
      onCount(n);
    }
  };
  const sub = hs.subscribeFederated(
    holon,
    "quests",
    (list: unknown[]) => {
      items = list as Quest[];
      recount();
    },
    { includeFederated: false },
  ) as { unsubscribe?: () => void } | undefined;
  const timer = setInterval(recount, opts.intervalMs ?? 10 * 60_000);
  return () => {
    clearInterval(timer);
    try {
      sub?.unsubscribe?.();
    } catch {
      /* best-effort teardown */
    }
  };
}

let stopBound: (() => void) | null = null;
let boundId = "";

/** Follow `holon` (the person's own id), or nothing when null. Idempotent. */
export function bindMyHolonOpen(holon: string | null): void {
  const id = holon ?? "";
  if (id === boundId) return;
  boundId = id;
  stopBound?.();
  stopBound = null;
  myHolonOpen.set(0);
  if (!id) return;
  let stop: (() => void) | null = null;
  let cancelled = false;
  stopBound = () => {
    cancelled = true;
    stop?.();
  };
  void getHolosphere().then((hs) => {
    if (cancelled) return;
    stop = watchOpenCount(hs, id, (n) => {
      if (boundId === id) myHolonOpen.set(n);
    });
  });
}
